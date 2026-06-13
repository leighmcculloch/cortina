// vehicle.js — 1964 Ford Cortina-class race car physics (simulation).
//
// Classic script (no ES modules). Exposes window.GAME.Vehicle.
// Physics math is PURE JS (Math + numbers only); does NOT reference THREE,
// so it can be unit-tested in Node with a stub track.
//
// Coordinate contract: right-handed, Y up, horizontal plane X/Z.
// heading h: forward = (cos h, 0, sin h); heading 0 = +X. meters/seconds/radians.
//
// CONSTRUCTION:
//   new GAME.Vehicle(track)
//   track.query(x,z) -> {height,onTrack,grip,distAlong,lateral,nearWall}
//   track.sampleByDistance(d)
//   track.start = {position:{x,y,z}, heading}
//
// PUBLIC STATE (read each frame by renderer):
//   position {x,y,z}  world position (y sits on road surface)
//   heading           rad, car yaw
//   speed             m/s signed along car forward axis (forward +)
//   velX, velZ        world-space velocity components
//   rpm               engine rpm (>= idle while running)
//   maxRpm            redline rpm
//   gear              -1 reverse, 0 neutral, 1..5
//   steerAngle        rad, actual front wheel steer angle
//   slip              0..1 magnitude of rear lateral slip (visual/audio)
//   lateralG          lateral acceleration in g
//   onTrack           bool, car currently on the track surface
//   wheelSpin         bool, driven wheels spinning faster than ground
//
// PUBLIC METHODS:
//   update(dt, input)  input = {throttle:0..1, brake:0..1, steer:-1..1,
//                               shiftUp:bool, shiftDown:bool, handbrake:bool}
//                      shiftUp/shiftDown are EDGE booleans (true only on press).
//   reset(position, heading)  place car stopped at world pos/heading, gear 1.

window.GAME = window.GAME || {};

(function () {
  'use strict';

  var G = 9.81;

  // ---- Vehicle constants (lightly tuned 1964 Cortina race spec) ----
  var MASS = 1050;          // kg
  var WHEELBASE = 2.49;     // m
  var A_FRONT = 1.18;       // CG -> front axle (m)
  var B_REAR = WHEELBASE - A_FRONT; // CG -> rear axle (m)
  var CG_HEIGHT = 0.48;     // m, for weight transfer
  var TRACK_WIDTH = 1.40;   // m (not heavily used, kept for completeness)
  var WHEEL_RADIUS = 0.30;  // m (driven wheel rolling radius)
  var YAW_INERTIA = MASS * (A_FRONT * A_FRONT + B_REAR * B_REAR) * 0.55; // kg m^2 approx

  // Static axle loads (N)
  var WEIGHT = MASS * G;
  var STATIC_FRONT = WEIGHT * (B_REAR / WHEELBASE);
  var STATIC_REAR = WEIGHT * (A_FRONT / WHEELBASE);

  // ---- Drivetrain ----
  var IDLE_RPM = 900;
  var MAX_RPM = 6500;
  var GEAR_RATIOS = [-3.32, 0, 3.54, 2.32, 1.59, 1.24, 1.00]; // index: gear+1
  var FINAL_DRIVE = 3.77;
  var DRIVELINE_EFF = 0.85;

  // Engine torque curve (Nm) as function of rpm. Broad, flattish mid-range
  // hump peaking ~4400 rpm at ~172 Nm, with usable torque from idle and a
  // taper toward redline. A real Cortina race motor pulls strongly from low
  // down, so the curve must not collapse to near-zero at idle.
  var PEAK_RPM = 4400;
  var PEAK_TQ = 172;
  function engineTorque(rpm) {
    if (rpm < IDLE_RPM) rpm = IDLE_RPM;
    if (rpm > MAX_RPM) return 0; // limiter cut above redline
    // Gaussian-ish hump: wide bell so torque stays high across the mid-range
    // and is still substantial (~60% of peak) at idle for clean launches.
    var x = (rpm - PEAK_RPM) / 4200; // wide normalization
    var t = PEAK_TQ * Math.exp(-0.8 * x * x);
    // low-end floor so the engine always makes enough torque to pull away
    if (rpm < PEAK_RPM) t = Math.max(t, 0.55 * PEAK_TQ);
    // soft cut just below the limiter
    if (rpm > MAX_RPM - 400) t *= (MAX_RPM - rpm) / 400;
    if (t < 0) t = 0;
    return t;
  }

  // ---- Tyre model ----
  // Lateral force from slip angle: rises linearly then saturates at mu*load.
  // Uses a simplified Pacejka-like saturating curve.
  function tyreLateral(slipAngle, load, mu) {
    var peak = mu * load;
    // cornering stiffness shaping: tan-based normalized slip
    var B = 9.0; // stiffness
    var s = B * slipAngle;
    // saturating: peak * sin(arctan-ish). Use s/(1+|s|) style for smooth saturate.
    var f = peak * (2 / Math.PI) * Math.atan(s * 0.9);
    return f;
  }

  // Longitudinal traction limit available given vertical load and grip.
  function tractionLimit(load, mu) {
    return mu * load;
  }

  function GAMEVehicle(track) {
    this.track = track;

    // public state
    this.position = { x: 0, y: 0, z: 0 };
    this.heading = 0;
    this.speed = 0;
    this.velX = 0;
    this.velZ = 0;
    this.rpm = IDLE_RPM;
    this.maxRpm = MAX_RPM;
    this.gear = 1;
    this.steerAngle = 0;
    this.slip = 0;
    this.lateralG = 0;
    this.onTrack = true;
    this.wheelSpin = false;

    // internal
    this.yawRate = 0;       // rad/s
    this._shiftCooldown = 0;

    var s = track && track.start ? track.start : { position: { x: 0, y: 0, z: 0 }, heading: 0 };
    this.reset(s.position, s.heading);
  }

  GAMEVehicle.prototype.reset = function (position, heading) {
    this.position.x = position.x;
    this.position.y = position.y;
    this.position.z = position.z;
    this.heading = heading;
    this.speed = 0;
    this.velX = 0;
    this.velZ = 0;
    this.yawRate = 0;
    this.rpm = IDLE_RPM;
    this.gear = 1;
    this.steerAngle = 0;
    this.slip = 0;
    this.lateralG = 0;
    this.wheelSpin = false;
    this._shiftCooldown = 0;
    if (this.track && this.track.query) {
      var q = this.track.query(this.position.x, this.position.z);
      if (q && typeof q.height === 'number') this.position.y = q.height;
      this.onTrack = q ? !!q.onTrack : true;
    } else {
      this.onTrack = true;
    }
  };

  // Max steer at front wheels (rad) ~ 33 deg, reduced with speed.
  function maxSteerForSpeed(speedAbs) {
    var base = 0.58; // ~33 deg
    var reduce = 1 / (1 + speedAbs * 0.035);
    return base * reduce;
  }

  GAMEVehicle.prototype.update = function (dt, input) {
    // clamp + sub-step for stability
    if (!(dt > 0)) return;
    if (dt > 1 / 30) dt = 1 / 30;
    var steps = 1;
    if (dt > 1 / 50) steps = 2; // sub-step larger frames
    var sub = dt / steps;
    for (var i = 0; i < steps; i++) {
      this._step(sub, input, i === 0);
    }
  };

  GAMEVehicle.prototype._step = function (dt, input, firstSub) {
    var throttle = clamp01(input.throttle);
    var brake = clamp01(input.brake);
    var steerIn = clampN1(input.steer);
    var handbrake = !!input.handbrake;

    // ---- gear shifts (edge, only on first sub-step of frame) ----
    if (firstSub) {
      if (this._shiftCooldown > 0) this._shiftCooldown -= dt;
      if (input.shiftUp && this._shiftCooldown <= 0) {
        if (this.gear < 5) { this.gear++; this._shiftCooldown = 0.25; }
        else if (this.gear <= 0) { this.gear = 1; this._shiftCooldown = 0.25; }
      } else if (input.shiftDown && this._shiftCooldown <= 0) {
        if (this.gear > 1) { this.gear--; this._shiftCooldown = 0.25; }
        else if (this.gear === 1) { this.gear = 0; this._shiftCooldown = 0.25; }
        else if (this.gear === 0) { this.gear = -1; this._shiftCooldown = 0.25; }
      }
    }

    // ---- steering: rate-limited toward target, speed sensitive ----
    var speedAbs = Math.abs(this.speed);
    var maxSteer = maxSteerForSpeed(speedAbs);
    var targetSteer = steerIn * maxSteer;
    var steerRate = 4.0; // rad/s actuator
    var dSteer = targetSteer - this.steerAngle;
    var maxd = steerRate * dt;
    if (dSteer > maxd) dSteer = maxd;
    if (dSteer < -maxd) dSteer = -maxd;
    this.steerAngle += dSteer;

    // ---- surface query ----
    var q = this.track && this.track.query
      ? this.track.query(this.position.x, this.position.z)
      : { height: 0, onTrack: true, grip: 1, distAlong: 0, lateral: 0, nearWall: false };
    var surfGrip = (q && typeof q.grip === 'number') ? q.grip : 1;
    if (surfGrip < 0.05) surfGrip = 0.05;
    this.onTrack = q ? !!q.onTrack : true;
    var BASE_MU = 1.15; // race tyres
    var mu = BASE_MU * surfGrip;

    // ---- body-frame velocities ----
    var ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    // longitudinal (vx) along forward, lateral (vy) along left (perp)
    var vx = this.velX * ch + this.velZ * sh;            // forward
    var vy = -this.velX * sh + this.velZ * ch;           // leftward
    this.speed = vx;

    // ---- weight transfer ----
    // longitudinal accel from previous frame approximated via current forces;
    // use measured acceleration estimate from net long force later. For load,
    // use previous longitudinal/lateral accel stored.
    var accLong = this._lastAccLong || 0;
    var accLat = this._lastAccLat || 0;
    var dWlong = MASS * accLong * CG_HEIGHT / WHEELBASE; // +: load to rear
    var Fz_front = STATIC_FRONT - dWlong;
    var Fz_rear = STATIC_REAR + dWlong;
    // lateral transfer (affects side grip; we fold into per-axle by reducing
    // effective mu slightly when |accLat| large — combined-slip-ish)
    if (Fz_front < 0) Fz_front = 0;
    if (Fz_rear < 0) Fz_rear = 0;

    // ---- slip angles (bicycle model) ----
    var EPS = 0.6; // speed floor to avoid blowup at low speed
    var denom = Math.max(Math.abs(vx), EPS);
    var slipFront = Math.atan2(vy + A_FRONT * this.yawRate, denom) - this.steerAngle * sign(vx === 0 ? 1 : vx);
    var slipRear = Math.atan2(vy - B_REAR * this.yawRate, denom);
    // when going forward sign(vx)=1; reverse handled by atan2 with vx sign via denom we lost sign.
    // Recompute using signed vx to keep direction correct:
    var svx = vx;
    if (Math.abs(svx) < EPS) svx = (svx >= 0 ? EPS : -EPS);
    slipFront = Math.atan2(vy + A_FRONT * this.yawRate, Math.abs(svx)) * sign(svx) - this.steerAngle;
    slipRear = Math.atan2(vy - B_REAR * this.yawRate, Math.abs(svx)) * sign(svx);

    // ---- lateral tyre forces ----
    var Fyf = -tyreLateral(slipFront, Fz_front, mu);
    var Fyr = -tyreLateral(slipRear, Fz_rear, mu);

    // handbrake locks rears -> destroys rear lateral grip, easy slides
    if (handbrake) {
      Fyr *= 0.25;
    }

    // ---- drivetrain: rpm from wheel speed ----
    var gr = GEAR_RATIOS[this.gear + 1];
    var driveActive = (this.gear !== 0);
    var wheelAngular = vx / WHEEL_RADIUS; // rad/s of wheel (forward)
    if (driveActive) {
      var totalRatio = gr * FINAL_DRIVE;
      var newRpm = Math.abs(wheelAngular * totalRatio) * 60 / (2 * Math.PI);
      // blend toward computed (clutch slip near standstill keeps idle)
      if (newRpm < IDLE_RPM) newRpm = IDLE_RPM + (newRpm) * 0.0;
      this.rpm = newRpm < IDLE_RPM ? IDLE_RPM : newRpm;
    } else {
      // neutral: rpm relaxes toward idle + throttle blip
      var tgt = IDLE_RPM + throttle * (MAX_RPM - IDLE_RPM) * 0.6;
      this.rpm += (tgt - this.rpm) * Math.min(1, dt * 4);
    }
    if (this.rpm > MAX_RPM) this.rpm = MAX_RPM;
    if (this.rpm < IDLE_RPM) this.rpm = IDLE_RPM;

    // ---- drive force (longitudinal) ----
    var Fdrive = 0;
    if (driveActive) {
      var engTq = engineTorque(this.rpm) * throttle;
      var axleTq = engTq * gr * FINAL_DRIVE * DRIVELINE_EFF;
      Fdrive = axleTq / WHEEL_RADIUS;
      if (this.gear === -1) Fdrive = -Math.abs(Fdrive); // reverse pushes backward (gr negative already, ensure)
      // engine braking when off throttle
      if (throttle < 0.05) {
        var engBrakeTq = engineTorque(this.rpm) * 0.12;
        var ebForce = engBrakeTq * Math.abs(gr) * FINAL_DRIVE / WHEEL_RADIUS;
        Fdrive -= sign(vx) * ebForce;
      }
    }

    // ---- traction limit on driven (rear) axle -> wheelspin ----
    var rearTraction = tractionLimit(Fz_rear, mu);
    // budget shared with lateral (friction circle): reduce available long by lateral usage
    var latUseR = Math.min(1, Math.abs(Fyr) / Math.max(1, rearTraction));
    var longBudget = rearTraction * Math.sqrt(Math.max(0, 1 - latUseR * latUseR));
    this.wheelSpin = false;
    if (Math.abs(Fdrive) > longBudget) {
      this.wheelSpin = (throttle > 0.1 && Math.abs(Fdrive) > longBudget * 1.02);
      Fdrive = sign(Fdrive) * longBudget;
      // spinning rear also loses some lateral grip
      if (this.wheelSpin) Fyr *= 0.7;
    }

    // ---- braking with front bias + lock ----
    var Fbrake = 0;
    var frontLocked = false, rearLocked = false;
    if (brake > 0.01) {
      var maxBrakeForce = 16000 * brake; // N total capacity
      var frontBias = 0.62;
      var fBrakeF = maxBrakeForce * frontBias;
      var fBrakeR = maxBrakeForce * (1 - frontBias);
      var frontGrip = tractionLimit(Fz_front, mu);
      var rearGrip = tractionLimit(Fz_rear, mu);
      if (fBrakeF > frontGrip) { fBrakeF = frontGrip; frontLocked = true; }
      if (fBrakeR > rearGrip) { fBrakeR = rearGrip; rearLocked = true; }
      Fbrake = (fBrakeF + fBrakeR);
      // applied opposite to motion
      Fbrake = -sign(vx) * Fbrake;
      // locked front kills steering grip
      if (frontLocked) Fyf *= 0.2;
      if (rearLocked) Fyr *= 0.4;
    }

    // ---- drag & rolling resistance ----
    var rho = 1.2, Cd = 0.32, area = 1.7;
    var dragCoef = 0.5 * rho * Cd * area; // F = dragCoef * v^2
    var Fdrag = -dragCoef * vx * Math.abs(vx);
    var rollCoef = 12.0; // N per (m/s) rolling-ish + constant
    var Froll = -sign(vx) * (rollCoef * Math.abs(vx) * 0.6 + 180 * (Math.abs(vx) > 0.05 ? 1 : 0));

    // ---- sum longitudinal force ----
    var Fx = Fdrive + Fbrake + Fdrag + Froll;
    // lateral force from front steered tyre contributes to body lateral via its direction;
    // for the bicycle model, Fyf and Fyr are lateral (body-y). Front steer angle small,
    // so component along body-x is negligible; include minor:
    var Fy = Fyf * Math.cos(this.steerAngle) + Fyr;

    // ---- accelerations ----
    var accX = Fx / MASS + vy * this.yawRate;   // body forward (include centripetal coupling)
    var accY = Fy / MASS - vx * this.yawRate;   // body lateral
    // yaw moment
    var Mz = A_FRONT * (Fyf * Math.cos(this.steerAngle)) - B_REAR * Fyr;
    var yawAcc = Mz / YAW_INERTIA;

    // ---- integrate body velocities ----
    vx += accX * dt;
    vy += accY * dt;
    this.yawRate += yawAcc * dt;
    // yaw damping for stability
    this.yawRate *= (1 - Math.min(0.5, 0.8 * dt));

    // store accel estimates for next frame weight transfer
    this._lastAccLong = accX;
    this._lastAccLat = accY;

    // ---- heading update ----
    this.heading += this.yawRate * dt;
    // normalize heading
    if (this.heading > Math.PI) this.heading -= 2 * Math.PI;
    if (this.heading < -Math.PI) this.heading += 2 * Math.PI;

    // ---- back to world velocity ----
    var ch2 = Math.cos(this.heading), sh2 = Math.sin(this.heading);
    this.velX = vx * ch2 - vy * sh2;
    this.velZ = vx * sh2 + vy * ch2;
    this.speed = vx;

    // low-speed full stop to avoid jitter
    if (Math.abs(vx) < 0.02 && throttle < 0.02 && Math.abs(this.yawRate) < 0.02) {
      vx = 0; this.velX *= 0.0; this.velZ *= 0.0; this.speed = 0;
    }

    // ---- slip & lateralG outputs ----
    this.slip = Math.min(1, Math.abs(slipRear) / 0.25); // ~14deg -> full
    this.lateralG = accY / G;

    // ---- integrate position ----
    this.position.x += this.velX * dt;
    this.position.z += this.velZ * dt;

    // ---- surface coupling after move: sit on road, wall collision ----
    var q2 = this.track && this.track.query
      ? this.track.query(this.position.x, this.position.z)
      : q;
    if (q2) {
      if (typeof q2.height === 'number') this.position.y = q2.height;
      this.onTrack = !!q2.onTrack;
      var hitWall = !!q2.nearWall;
      if (hitWall) {
        this._wallCollide(q2);
      }
    }

    // NaN guard
    this._sanitize();
  };

  // Hard wall collision: push back inside, kill into-wall velocity, scrub speed.
  GAMEVehicle.prototype._wallCollide = function (q) {
    // Determine inward direction from lateral sign. lateral>0 means one side.
    // Wall normal approximated as the car's lateral (left) axis based on lateral sign.
    var ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    // left (lateral) world axis = (-sh, ch)
    var lx = -sh, lz = ch;
    var lateral = (typeof q.lateral === 'number') ? q.lateral : 0;
    // If lateral positive, car is to +left of centerline -> push toward -left (right).
    var dir = lateral >= 0 ? -1 : 1;
    var nx = lx * dir, nz = lz * dir; // inward normal

    // push position inward a little
    var push = 0.4;
    this.position.x += nx * push;
    this.position.z += nz * push;

    // velocity component into wall (along -inward = outward)
    var vInto = this.velX * (-nx) + this.velZ * (-nz);
    if (vInto > 0) {
      // remove outward (into-wall) component
      this.velX -= (-nx) * vInto;
      this.velZ -= (-nz) * vInto;
    }
    // scrub overall speed (punishing, not full stop)
    this.velX *= 0.55;
    this.velZ *= 0.55;
    // bleed yaw
    this.yawRate *= 0.4;
    // recompute body speed
    var ch2 = Math.cos(this.heading), sh2 = Math.sin(this.heading);
    this.speed = this.velX * ch2 + this.velZ * sh2;
  };

  GAMEVehicle.prototype._sanitize = function () {
    if (!isFinite(this.position.x)) this.position.x = 0;
    if (!isFinite(this.position.y)) this.position.y = 0;
    if (!isFinite(this.position.z)) this.position.z = 0;
    if (!isFinite(this.heading)) this.heading = 0;
    if (!isFinite(this.speed)) this.speed = 0;
    if (!isFinite(this.velX)) this.velX = 0;
    if (!isFinite(this.velZ)) this.velZ = 0;
    if (!isFinite(this.yawRate)) this.yawRate = 0;
    if (!isFinite(this.rpm)) this.rpm = IDLE_RPM;
    if (!isFinite(this.steerAngle)) this.steerAngle = 0;
    if (!isFinite(this.slip)) this.slip = 0;
    if (!isFinite(this.lateralG)) this.lateralG = 0;
  };

  // ---- helpers ----
  function clamp01(v) { v = +v; if (!(v > 0)) return 0; if (v > 1) return 1; return v; }
  function clampN1(v) { v = +v; if (!isFinite(v)) return 0; if (v > 1) return 1; if (v < -1) return -1; return v; }
  function sign(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }

  window.GAME.Vehicle = GAMEVehicle;
})();
