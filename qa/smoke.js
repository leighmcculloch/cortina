/*
 * qa/smoke.js — QA Engineer: headless integration smoke test.
 *
 * Loads the team's browser modules (car.js, track.js, vehicle.js) under a
 * minimal THREE stub + window shim, then:
 *   - builds the track and the car, checks contract fields,
 *   - constructs the Vehicle and drives it for a simulated stint,
 *   - asserts no NaN anywhere, the car accelerates & moves, sits on the road
 *     surface, track.query() returns sane fields, and grass reduces grip.
 *
 * Run: node qa/smoke.js   (exit 0 = pass)
 */

const fs = require('fs');
const path = require('path');

// ── Minimal THREE stub (enough to build geometry-only scenes) ──────────────
function Vec() { this.x = 0; this.y = 0; this.z = 0; }
Vec.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
Vec.prototype.copy = function (v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; };

function Obj3D() {
  this.position = new Vec(); this.rotation = new Vec(); this.scale = new Vec().set(1, 1, 1);
  this.children = []; this.userData = {}; this.castShadow = false; this.receiveShadow = false;
}
Obj3D.prototype.add = function () { for (var i = 0; i < arguments.length; i++) this.children.push(arguments[i]); return this; };
Obj3D.prototype.traverse = function (cb) { cb(this); this.children.forEach(function (c) { c.traverse ? c.traverse(cb) : cb(c); }); };

function Geo() {}
Geo.prototype.applyMatrix4 = function () { return this; };
Geo.prototype.setAttribute = function () { return this; };
Geo.prototype.setIndex = function () { return this; };
Geo.prototype.computeVertexNormals = function () { return this; };
Geo.prototype.translate = function () { return this; };
Geo.prototype.rotateX = function () { return this; };
Geo.prototype.dispose = function () {};

function Mat() {}

function Mat4() {}
['makeRotationX', 'makeRotationY', 'makeRotationZ', 'makeTranslation', 'makeScale', 'multiply', 'identity', 'compose']
  .forEach(function (m) { Mat4.prototype[m] = function () { return this; }; });

const THREE = {
  Group: function () { Obj3D.call(this); },
  Object3D: function () { Obj3D.call(this); },
  Mesh: function (g, m) { Obj3D.call(this); this.geometry = g; this.material = m; },
  Line: function (g, m) { Obj3D.call(this); this.geometry = g; this.material = m; },
  BoxGeometry: function () { Geo.call(this); },
  CylinderGeometry: function () { Geo.call(this); },
  PlaneGeometry: function () { Geo.call(this); },
  TorusGeometry: function () { Geo.call(this); },
  ConeGeometry: function () { Geo.call(this); },
  SphereGeometry: function () { Geo.call(this); },
  BufferGeometry: function () { Geo.call(this); },
  BufferAttribute: function (arr, item) { this.array = arr; this.itemSize = item; },
  Float32BufferAttribute: function (arr, item) { this.array = arr; this.itemSize = item; },
  MeshStandardMaterial: function (o) { Mat.call(this); Object.assign(this, o || {}); },
  MeshBasicMaterial: function (o) { Mat.call(this); Object.assign(this, o || {}); },
  MeshLambertMaterial: function (o) { Mat.call(this); Object.assign(this, o || {}); },
  LineBasicMaterial: function (o) { Mat.call(this); Object.assign(this, o || {}); },
  Color: function () { this.r = 1; this.g = 1; this.b = 1; },
  Vector3: function (x, y, z) { Vec.call(this); if (x !== undefined) this.set(x, y || 0, z || 0); },
  Matrix4: function () { Mat4.call(this); },
  DoubleSide: 2, FrontSide: 0,
};
[THREE.Group, THREE.Object3D, THREE.Mesh, THREE.Line].forEach(function (C) {
  C.prototype = Object.create(Obj3D.prototype);
});
[THREE.BoxGeometry, THREE.CylinderGeometry, THREE.PlaneGeometry, THREE.TorusGeometry,
 THREE.ConeGeometry, THREE.SphereGeometry, THREE.BufferGeometry].forEach(function (C) {
  C.prototype = Object.create(Geo.prototype);
});
THREE.Matrix4.prototype = Object.create(Mat4.prototype);
THREE.Vector3.prototype = Object.create(Vec.prototype);

// ── window shim & module loading ───────────────────────────────────────────
global.window = { GAME: {} };
global.THREE = THREE;
function load(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(code);
}
['car.js', 'track.js', 'vehicle.js'].forEach(load);
const GAME = global.window.GAME;

// ── Assertion helpers ──────────────────────────────────────────────────────
let failures = 0;
function ok(cond, msg) { if (!cond) { failures++; console.error('  ✗ ' + msg); } else { console.log('  ✓ ' + msg); } }
function num(v) { return typeof v === 'number' && isFinite(v); }
function finiteVec(v) { return v && num(v.x) && num(v.y) && num(v.z); }

console.log('— Module presence —');
ok(typeof GAME.buildCortina === 'function', 'GAME.buildCortina defined');
ok(typeof GAME.buildTrack === 'function', 'GAME.buildTrack defined');
ok(typeof GAME.Vehicle === 'function', 'GAME.Vehicle defined');

console.log('— Car model —');
const car = GAME.buildCortina(THREE);
ok(car && car.children.length > 0, 'car group has children');
ok(car.userData.wheels && car.userData.wheels.length === 4, 'car.userData.wheels has 4 wheels');
ok(car.userData.steer && car.userData.steer.length === 2, 'car.userData.steer has 2 front pivots');

console.log('— Track —');
const track = GAME.buildTrack(THREE);
ok(track.group && track.group.children.length > 0, 'track.group has scenery');
ok(num(track.length) && track.length > 4000, 'track.length sane (' + (track.length | 0) + ' m)');
ok(track.start && finiteVec(track.start.position) && num(track.start.heading), 'track.start valid');
const q0 = track.query(track.start.position.x, track.start.position.z);
ok(q0 && num(q0.height) && typeof q0.onTrack === 'boolean' && num(q0.grip) && num(q0.distAlong) && num(q0.lateral), 'track.query returns sane fields at start');
ok(q0.onTrack === true && q0.grip > 0.8, 'start point is on tarmac (grip ' + q0.grip.toFixed(2) + ')');
const sBy = track.sampleByDistance(track.length * 0.5);
ok(finiteVec(sBy) && num(sBy.heading), 'sampleByDistance returns finite point');
// off-track far away should be low grip
const far = track.query(track.start.position.x + 9000, track.start.position.z + 9000);
ok(far && num(far.grip) && far.grip < 0.7, 'far-field query reports reduced grip (' + far.grip.toFixed(2) + ')');

console.log('— Vehicle simulation —');
const v = new GAME.Vehicle(track);
v.reset(track.start.position, track.start.heading);
ok(finiteVec(v.position) && num(v.heading) && num(v.speed), 'vehicle initial state finite');
['rpm', 'maxRpm', 'gear', 'steerAngle', 'onTrack'].forEach(function (f) {
  ok(f in v, 'vehicle exposes .' + f);
});

const startX = v.position.x, startZ = v.position.z;
let maxSpeed = 0, nanSeen = false, gearUsed = {};
const dt = 1 / 60;
for (let i = 0; i < 60 * 30; i++) { // 30 s
  // gentle throttle, small steer wiggle, occasional upshift
  const input = {
    throttle: 1, brake: 0,
    steer: 0.12 * Math.sin(i / 90),
    shiftUp: (v.rpm > (v.maxRpm * 0.92) && v.gear < 5),
    shiftDown: false, handbrake: false
  };
  v.update(dt, input);
  if (!finiteVec(v.position) || !num(v.heading) || !num(v.speed) || !num(v.rpm)) { nanSeen = true; break; }
  maxSpeed = Math.max(maxSpeed, v.speed);
  gearUsed[v.gear] = true;
}
ok(!nanSeen, 'no NaN over 30 s of simulation');
const moved = Math.hypot(v.position.x - startX, v.position.z - startZ);
ok(moved > 50, 'car travelled a meaningful distance (' + moved.toFixed(0) + ' m)');
ok(maxSpeed > 8, 'car reached speed (' + (maxSpeed * 3.6).toFixed(0) + ' km/h top)');
ok(Object.keys(gearUsed).length >= 2, 'gearbox shifted through gears (' + Object.keys(gearUsed).sort().join(',') + ')');
const qEnd = track.query(v.position.x, v.position.z);
ok(Math.abs(v.position.y - qEnd.height) < 1.5, 'car sits on the road surface (Δy ' + Math.abs(v.position.y - qEnd.height).toFixed(2) + ' m)');

console.log('\n' + (failures === 0 ? 'SMOKE TEST PASSED ✅' : 'SMOKE TEST FAILED ❌  (' + failures + ' failure(s))'));
process.exit(failures === 0 ? 0 : 1);
