/*
 * main.js — Lead / Integrator
 *
 * Ties the team's modules together into a running game:
 *   GAME.buildCortina(THREE)   -> the car model           (Car Modeler)
 *   GAME.buildTrack(THREE)     -> Bathurst track + physics API (Track Artist)
 *   GAME.Vehicle(track)        -> simulation physics       (Physics Engineer)
 *   GAME.createHUD(container)  -> HUD overlay               (HUD Engineer)
 *
 * Responsibilities here: renderer/scene/lights/sky, input, chase & cockpit
 * cameras, lap timing & delta, wheel/steer animation, engine audio, the rAF loop.
 *
 * Entry point: GAME.start({ gameEl, hudEl })  (called from index.html after a click).
 *
 * Conventions (shared contract): Y up; heading h => forward = (cos h, 0, sin h);
 * car model faces +X, so car.rotation.y = -heading.
 */

window.GAME = window.GAME || {};

GAME.start = function (opts) {
  var THREE = window.THREE;
  var gameEl = opts.gameEl;
  var hudEl = opts.hudEl;

  // ── Renderer ────────────────────────────────────────────────────────────
  var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
  if ('toneMapping' in renderer) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
  }
  gameEl.appendChild(renderer.domElement);

  // ── Scene, sky, fog ─────────────────────────────────────────────────────
  var scene = new THREE.Scene();
  var horizonColor = 0xcddcee;                 // hazy horizon, matches distant ranges
  scene.background = new THREE.Color(0x8ab4e8);
  scene.fog = new THREE.Fog(horizonColor, 900, 3600);
  addSky(THREE, scene);                          // gradient dome + scattered clouds

  // ── Lighting ────────────────────────────────────────────────────────────
  var hemi = new THREE.HemisphereLight(0xcfe2ff, 0x4f6a3a, 0.65);
  scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xfff1dc, 2.2);   // bright midday sun
  sun.position.set(-420, 720, 280);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  var sc = sun.shadow.camera;
  sc.near = 50; sc.far = 1800; sc.left = -260; sc.right = 260; sc.top = 260; sc.bottom = -260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);
  // gentle warm fill from the opposite side to lift shadow contrast
  var fill = new THREE.DirectionalLight(0xbcd0ec, 0.35);
  fill.position.set(380, 400, -260);
  scene.add(fill);

  // ── Track (visuals + physics query API) ─────────────────────────────────
  var track = GAME.buildTrack(THREE);
  scene.add(track.group);

  // ── Car model ───────────────────────────────────────────────────────────
  var car = GAME.buildCortina(THREE);
  scene.add(car);
  var wheels = (car.userData && car.userData.wheels) || [];
  var steerPivots = (car.userData && car.userData.steer) || [];
  var WHEEL_RADIUS = 0.30; // m — visual roll only

  // ── Physics ─────────────────────────────────────────────────────────────
  var vehicle = new GAME.Vehicle(track);
  vehicle.reset(track.start.position, track.start.heading);

  // ── HUD ─────────────────────────────────────────────────────────────────
  var hud = GAME.createHUD(hudEl);

  // ── Cameras ─────────────────────────────────────────────────────────────
  var camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.2, 4000);
  var CAM_CHASE = 0, CAM_COCKPIT = 1;
  var camMode = CAM_CHASE;
  var camPos = new THREE.Vector3();
  var camLook = new THREE.Vector3();
  var tmpV = new THREE.Vector3();
  var camReady = false;

  // ── Input ───────────────────────────────────────────────────────────────
  var keys = {};
  var edgeShiftUp = false, edgeShiftDown = false;
  var paused = false;

  function onKeyDown(e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === ' ' || k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') e.preventDefault();
    if (keys[k]) return; // ignore auto-repeat for edge actions
    keys[k] = true;
    if (k === 'e') edgeShiftUp = true;
    if (k === 'q') edgeShiftDown = true;
    if (k === 'c') camMode = (camMode === CAM_CHASE) ? CAM_COCKPIT : CAM_CHASE;
    if (k === 'h' && hud.toggleHelp) hud.toggleHelp();
    if (k === 'p') { paused = !paused; hud.setMessage(paused ? 'PAUSED' : 'GO', paused ? 100000 : 800); }
    if (k === 'r') doRespawn();
  }
  function onKeyUp(e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys[k] = false;
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function readInput() {
    var throttle = (keys['w'] || keys['ArrowUp']) ? 1 : 0;
    var brake = (keys['s'] || keys['ArrowDown']) ? 1 : 0;
    var steer = 0;
    if (keys['a'] || keys['ArrowLeft']) steer -= 1;
    if (keys['d'] || keys['ArrowRight']) steer += 1;
    var handbrake = !!keys[' '];
    if (countdown > 0) { throttle = 0; brake = 1; steer = 0; handbrake = false; }
    var input = {
      throttle: throttle, brake: brake, steer: steer,
      shiftUp: edgeShiftUp, shiftDown: edgeShiftDown, handbrake: handbrake
    };
    edgeShiftUp = false; edgeShiftDown = false;
    return input;
  }

  // ── Start countdown (3..2..1..GO) ───────────────────────────────────────
  var countdown = 3.999;
  var lastCountShown = -1;

  // ── Lap timing & delta ──────────────────────────────────────────────────
  var SPLIT = 50; // metres per delta bucket
  var nBuckets = Math.max(8, Math.ceil(track.length / SPLIT));
  var lapStartMs = 0;
  var curLapMs = 0;
  var bestLapMs = null;
  var lastLapMs = null;
  var lapNumber = 0;          // 0 until first start/finish crossing
  var prevDist = vehicle.position ? track.query(vehicle.position.x, vehicle.position.z).distAlong : 0;
  var curSplits = new Array(nBuckets).fill(null);
  var bestSplits = null;
  var timing = false;
  var clockMs = 0;

  function resetLapState() {
    lapStartMs = clockMs; curLapMs = 0; lapNumber = 0; timing = false;
    curSplits = new Array(nBuckets).fill(null);
    prevDist = track.query(vehicle.position.x, vehicle.position.z).distAlong;
  }

  function doRespawn() {
    var q = track.query(vehicle.position.x, vehicle.position.z);
    var s = track.sampleByDistance(q.distAlong);
    vehicle.reset({ x: s.x, y: s.y, z: s.z }, s.heading);
    timing = false; // current lap voided after a respawn
    curSplits = new Array(nBuckets).fill(null);
    prevDist = q.distAlong;
    hud.setMessage('RESPAWN', 1200);
  }

  function updateTiming(dt, q) {
    var L = track.length;
    var dist = q.distAlong;
    // Forward crossing of the start/finish line (dist wraps high -> low)
    var crossed = (prevDist > L * 0.75) && (dist < L * 0.25);
    if (crossed && vehicle.speed > 1) {
      if (timing) {
        // completed a timed lap
        lastLapMs = curLapMs;
        if (bestLapMs === null || curLapMs < bestLapMs) {
          bestLapMs = curLapMs;
          bestSplits = curSplits.slice();
          hud.setMessage('NEW BEST LAP!', 2500);
        } else {
          hud.setMessage('LAP ' + lapNumber + '  ' + fmt(curLapMs), 2000);
        }
      }
      lapNumber += 1;
      timing = true;
      lapStartMs = clockMs;
      curSplits = new Array(nBuckets).fill(null);
    }
    prevDist = dist;
    if (timing) {
      curLapMs = clockMs - lapStartMs;
      var b = Math.min(nBuckets - 1, Math.floor(dist / SPLIT));
      if (curSplits[b] === null) curSplits[b] = curLapMs;
    } else {
      curLapMs = 0;
    }
  }

  function currentDelta(q) {
    if (!timing || !bestSplits) return null;
    var b = Math.min(nBuckets - 1, Math.floor(q.distAlong / SPLIT));
    var ref = bestSplits[b];
    if (ref === null || ref === undefined) return null;
    return curLapMs - ref;
  }

  function fmt(ms) {
    if (ms === null || ms === undefined) return '--:--.---';
    var m = Math.floor(ms / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    var mm = Math.floor(ms % 1000);
    return m + ':' + String(s).padStart(2, '0') + '.' + String(mm).padStart(3, '0');
  }

  // ── Engine audio (simple, best-effort) ──────────────────────────────────
  var audio = null;
  (function initAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
      var osc2 = ctx.createOscillator(); osc2.type = 'square';
      var gain = ctx.createGain(); gain.gain.value = 0.0;
      var filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900;
      osc1.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      osc1.start(); osc2.start();
      if (ctx.state === 'suspended') ctx.resume();
      audio = { ctx: ctx, osc1: osc1, osc2: osc2, gain: gain, filter: filter };
    } catch (e) { audio = null; }
  })();

  function updateAudio(dt) {
    if (!audio) return;
    var rpm = vehicle.rpm || 900;
    var maxRpm = vehicle.maxRpm || 6500;
    var f = 32 + (rpm / 60) * 2.0;       // fundamental tied to rpm
    audio.osc1.frequency.setTargetAtTime(f, audio.ctx.currentTime, 0.04);
    audio.osc2.frequency.setTargetAtTime(f * 1.5, audio.ctx.currentTime, 0.04);
    audio.filter.frequency.setTargetAtTime(500 + (rpm / maxRpm) * 2600, audio.ctx.currentTime, 0.05);
    var load = vehicle.wheelSpin ? 0.16 : 0.10;
    var vol = (countdown > 0) ? 0.05 : (0.04 + load * (0.4 + 0.6 * (rpm / maxRpm)));
    audio.gain.gain.setTargetAtTime(paused ? 0.0 : vol, audio.ctx.currentTime, 0.08);
  }

  // ── Resize ──────────────────────────────────────────────────────────────
  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  // ── Apply physics state to the visible car ──────────────────────────────
  var rollAngle = 0;
  function syncCar(dt) {
    car.position.set(vehicle.position.x, vehicle.position.y, vehicle.position.z);
    car.rotation.y = -vehicle.heading;
    // wheel roll (visual)
    rollAngle -= (vehicle.speed / WHEEL_RADIUS) * dt;
    for (var i = 0; i < wheels.length; i++) {
      if (wheels[i]) wheels[i].rotation.z = rollAngle;
    }
    // front wheel steering (negate to match car.rotation.y = -heading mapping)
    for (var j = 0; j < steerPivots.length; j++) {
      if (steerPivots[j]) steerPivots[j].rotation.y = -(vehicle.steerAngle || 0);
    }
  }

  // ── Camera follow ───────────────────────────────────────────────────────
  function updateCamera(dt) {
    var h = vehicle.heading;
    var fx = Math.cos(h), fz = Math.sin(h);
    if (camMode === CAM_COCKPIT) {
      // Driver eye-point: RHD (+Z side), just behind the windscreen.
      var ex = vehicle.position.x + fx * 0.20 + (-fz) * 0.33;
      var ez = vehicle.position.z + fz * 0.20 + (fx) * 0.33;
      camPos.set(ex, vehicle.position.y + 1.12, ez);
      camLook.set(ex + fx * 12, vehicle.position.y + 1.0, ez + fz * 12);
      camera.position.copy(camPos);
      camera.lookAt(camLook);
    } else {
      var back = 7.2, up = 3.1;
      var desired = tmpV.set(
        vehicle.position.x - fx * back,
        vehicle.position.y + up,
        vehicle.position.z - fz * back
      );
      if (!camReady) { camPos.copy(desired); camReady = true; }
      var lerp = 1 - Math.pow(0.0016, dt); // frame-rate independent smoothing
      camPos.lerp(desired, lerp);
      camLook.lerp(
        camLook.set(vehicle.position.x + fx * 6, vehicle.position.y + 1.1, vehicle.position.z + fz * 6),
        1
      );
      camera.position.copy(camPos);
      camera.lookAt(vehicle.position.x + fx * 6, vehicle.position.y + 1.1, vehicle.position.z + fz * 6);
    }
    // keep the shadow frustum near the action
    sun.position.set(vehicle.position.x - 400, 650, vehicle.position.z + 300);
    sun.target.position.set(vehicle.position.x, vehicle.position.y, vehicle.position.z);
  }

  // ── Main loop ───────────────────────────────────────────────────────────
  var last = performance.now();
  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp big stalls
    if (dt < 0) dt = 0;

    if (!paused) {
      clockMs += dt * 1000;

      // countdown
      if (countdown > 0) {
        countdown -= dt;
        var n = Math.ceil(countdown - 0.999);
        if (n !== lastCountShown) {
          lastCountShown = n;
          if (n >= 1) hud.setMessage(String(n), 1000);
          else hud.setMessage('GO!', 900);
        }
        if (countdown <= 0) resetLapState();
      }

      var input = readInput();
      vehicle.update(dt, input);

      var q = track.query(vehicle.position.x, vehicle.position.z);
      if (countdown <= 0) updateTiming(dt, q);

      syncCar(dt);
      updateCamera(dt);
      updateAudio(dt);

      hud.update({
        speedKmh: Math.abs(vehicle.speed) * 3.6,
        rpm: vehicle.rpm,
        maxRpm: vehicle.maxRpm || 6500,
        gear: vehicle.gear,
        currentLapMs: timing ? curLapMs : null,
        bestLapMs: bestLapMs,
        lastLapMs: lastLapMs,
        deltaMs: currentDelta(q),
        lap: lapNumber,
        onTrack: vehicle.onTrack,
        message: null
      });
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // place camera once before first frame
  updateCamera(0.016);
  hud.setMessage('GET READY', 1200);
  requestAnimationFrame(frame);

  // ── Sky: vertical gradient dome + soft cloud billboards ───────────────────
  function addSky(THREE, scene) {
    var uniforms = {
      topColor:    { value: new THREE.Color(0x2b6fc6) },  // deep blue overhead
      midColor:    { value: new THREE.Color(0x86b6ec) },  // mid sky
      bottomColor: { value: new THREE.Color(0xdce8f4) }   // hazy horizon
    };
    var geo = new THREE.SphereGeometry(3200, 32, 16);
    var mat = new THREE.ShaderMaterial({
      uniforms: uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: [
        'varying vec3 vWorldPos;',
        'void main() {',
        '  vec4 wp = modelMatrix * vec4(position, 1.0);',
        '  vWorldPos = wp.xyz;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 topColor; uniform vec3 midColor; uniform vec3 bottomColor;',
        'varying vec3 vWorldPos;',
        'void main() {',
        '  float h = normalize(vWorldPos).y;',
        '  float up = clamp(h, 0.0, 1.0);',
        '  float dn = clamp(-h, 0.0, 1.0);',
        '  vec3 col = mix(midColor, topColor, pow(up, 0.5));',
        '  col = mix(col, bottomColor, pow(dn, 0.25));',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n')
    });
    var sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -1;
    scene.add(sky);
    addClouds(THREE, scene);
  }

  function addClouds(THREE, scene) {
    var tex = makeCloudTexture(THREE);
    if (!tex) return;
    var mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.9, depthWrite: false, fog: false
    });
    var group = new THREE.Group();
    for (var i = 0; i < 16; i++) {
      var s = 380 + Math.random() * 520;
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.6), mat);
      var ang = Math.random() * Math.PI * 2;
      var rad = 600 + Math.random() * 1900;
      plane.position.set(Math.cos(ang) * rad, 620 + Math.random() * 360, Math.sin(ang) * rad);
      plane.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.25; // mostly facing down
      plane.rotation.z = Math.random() * Math.PI;
      group.add(plane);
    }
    group.renderOrder = 0;
    scene.add(group);
  }

  function makeCloudTexture(THREE) {
    if (typeof document === 'undefined') return null;
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var ctx = c.getContext('2d');
    if (!ctx) return null;
    // a few overlapping soft white blobs -> fluffy cumulus
    for (var i = 0; i < 9; i++) {
      var x = 60 + Math.random() * 136, y = 90 + Math.random() * 76;
      var r = 30 + Math.random() * 46;
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    var t = new THREE.CanvasTexture(c);
    return t;
  }
};
