/*
 * track.js — Procedural recreation of the Mount Panorama Circuit (Bathurst)
 *
 * CONTRACT IMPLEMENTED:
 *   window.GAME.buildTrack(THREE) -> track
 *
 * Coordinate system: right-handed, Y-up, X/Z horizontal, meters & radians.
 *   - Heading h: forward = (cos h, 0, sin h); heading 0 points along +X.
 *   - Y is road-surface elevation (up).
 *
 * RETURNED OBJECT `track`:
 *   track.group : THREE.Group with ALL visuals (road ribbon, edge lines,
 *                 start/finish, grass, walls/barriers, grandstands, mountain).
 *   track.length: total lap distance in meters (closed loop).
 *   track.start : { position:{x,y,z}, heading } — grid spot on Pit Straight
 *                 just before the start/finish line, facing racing direction.
 *
 *   track.sampleByDistance(d) -> { x, y, z, heading, width }
 *       Centerline sample at arc-length d (wrapped modulo length).
 *
 *   track.query(x, z) -> {
 *       height   : road surface Y at (x,z), interpolated along & across,
 *       onTrack  : boolean, |lateral| <= width/2 at nearest centerline pt,
 *       grip     : 1.0 on tarmac, ramps to ~0.45 on grass past the edge,
 *       distAlong: arc-length of nearest centerline point,
 *       lateral  : signed perpendicular offset from centerline,
 *                  POSITIVE to the driver's RIGHT (relative to heading),
 *       nearWall : true if |lateral| at/beyond the wall offset (hard collision)
 *     }
 *     Implemented with distance-bucketing over a downsampled centerline so it
 *     is cheap to call many times per frame, and never returns NaN.
 *
 * APPROXIMATIONS (this is a stylised, not surveyed, recreation):
 *   - Corner radii / straight lengths are hand-tuned so the lap is ~6.2 km and
 *     the corner SEQUENCE matches the real circuit; absolute XY positions are
 *     not survey-accurate.
 *   - Elevation profile reproduces the real ~174 m vertical range and the
 *     climb-over-the-top-then-plunge character, but per-meter grades are
 *     stylised.
 *   - Walls hug the tight mountain section; elsewhere low Armco-style barriers.
 *
 * No ES modules. Classic UMD THREE (r128) assumed global. No load side effects.
 */

window.GAME = window.GAME || {};

window.GAME.buildTrack = function (THREE) {

    // ─────────────────────────────────────────────────────────────────────
    // 1. SEGMENT DEFINITION
    //    The lap as an ordered list of straights and arcs forming a closed
    //    loop. Grades are expressed as rise/run (dy/dx along the path).
    //    Widths are FULL track width in meters at the start of the segment;
    //    they lerp to the next segment's start width across the segment.
    //
    //    Arc sweep: +ve = left turn (heading increases), -ve = right turn.
    //    (forward = (cos h, sin h) in XZ → increasing h curves toward +Z-ish;
    //     "left" for a +X-facing car is toward +Z, which is heading increase.)
    // ─────────────────────────────────────────────────────────────────────

    var WIDE = 15.0;   // flats / Conrod / Pit straight (widened)
    var MOUNT = 11.0;  // narrow mountain top / Esses section (widened)

    // Each segment:
    //   {type:'straight', len, grade, width}
    //   {type:'arc', radius, sweep, grade, width}   sweep in radians (signed)
    // Lengths/radii tuned so the integrated lap is ~6.2 km and the elevation
    // profile spans ~174 m (low at Pit/Hell ~ 0, high at Brock's Skyline).
    var segs = [
        // Pit Straight (start/finish is at the very beginning of the loop),
        // gently downhill toward Hell Corner.
        { type: 'straight', len: 640, grade: -0.010, width: WIDE },
        // Hell Corner — sharp left hairpin onto Mountain Straight.
        { type: 'arc', radius: 34, sweep: 1.95, grade: -0.005, width: WIDE },
        // Mountain Straight — long climb.
        { type: 'straight', len: 870, grade: 0.090, width: WIDE },
        // Griffins Bend — right, still climbing.
        { type: 'arc', radius: 80, sweep: -1.45, grade: 0.078, width: 14.0 },
        // short link
        { type: 'straight', len: 220, grade: 0.100, width: 13.5 },
        // The Cutting — steep left climb (the steepest grade on the lap).
        { type: 'arc', radius: 42, sweep: 1.55, grade: 0.165, width: 12.5 },
        // Climb toward Reid Park.
        { type: 'straight', len: 210, grade: 0.130, width: 12.5 },
        // Reid Park — right kink.
        { type: 'arc', radius: 110, sweep: -0.85, grade: 0.085, width: 12.0 },
        // Quarry Corner — left.
        { type: 'arc', radius: 70, sweep: 1.05, grade: 0.055, width: 11.5 },
        // Sulman Park run, easing the climb.
        { type: 'straight', len: 250, grade: 0.045, width: MOUNT },
        // McPhillamy Park — long right sweep along the top ridge.
        { type: 'arc', radius: 200, sweep: -0.95, grade: 0.018, width: MOUNT },
        // Brock's Skyline — left, the HIGH POINT of the circuit.
        { type: 'arc', radius: 60, sweep: 1.25, grade: -0.012, width: MOUNT },
        // Begin the plunge: short straight dropping away.
        { type: 'straight', len: 160, grade: -0.150, width: MOUNT },
        // The Esses — flick right…
        { type: 'arc', radius: 60, sweep: -0.95, grade: -0.180, width: MOUNT },
        // …then left, dropping fast.
        { type: 'arc', radius: 55, sweep: 1.05, grade: -0.180, width: MOUNT },
        // The Dipper — tight off-camber left, steep descent.
        { type: 'arc', radius: 40, sweep: 1.35, grade: -0.200, width: 10.5 },
        // link down toward Forrest's Elbow
        { type: 'straight', len: 130, grade: -0.170, width: 11.0 },
        // Forrest's Elbow — left, onto Conrod.
        { type: 'arc', radius: 50, sweep: 1.10, grade: -0.110, width: 12.0 },
        // Conrod Straight — long, downhill then flattening out. Split in three
        // to taper the grade from steep to flat.
        { type: 'straight', len: 700, grade: -0.090, width: 13.5 },
        { type: 'straight', len: 880, grade: -0.035, width: WIDE },
        { type: 'straight', len: 640, grade: -0.006, width: WIDE },
        // The Chase — chicane: right then left.
        { type: 'arc', radius: 90, sweep: -0.80, grade: -0.004, width: WIDE },
        { type: 'arc', radius: 85, sweep: 0.80, grade: -0.004, width: WIDE },
        // short link to Murray's
        { type: 'straight', len: 230, grade: -0.003, width: WIDE },
        // Murray's Corner — left, back onto Pit Straight. The remaining sweep
        // and length are tuned by the closure pass below so the loop closes.
        { type: 'arc', radius: 55, sweep: 1.30, grade: 0.0, width: WIDE },
        { type: 'straight', len: 100, grade: 0.0, width: WIDE }
    ];

    // ─────────────────────────────────────────────────────────────────────
    // 2. INTEGRATE THE CENTERLINE
    //    Walk the segments, emitting dense points. We integrate in the XZ
    //    plane using heading, accumulating elevation from grade and the
    //    horizontal step. The raw loop will not perfectly close in XYZ (it is
    //    a stylised layout); we apply a small affine drift-correction after so
    //    that start == end for x, z and y, keeping the query/sample API clean.
    // ─────────────────────────────────────────────────────────────────────

    var STEP = 4.0;   // target spacing between centerline points (m)
    var pts = [];     // {x,y,z,heading,width,dist}

    var x = 0, y = 0, z = 0, h = 0, dist = 0;

    function pushPoint(width) {
        pts.push({ x: x, y: y, z: z, heading: h, width: width, dist: dist });
    }

    pushPoint(segs[0].width);

    for (var si = 0; si < segs.length; si++) {
        var s = segs[si];
        var wStart = s.width;
        var wEnd = segs[(si + 1) % segs.length].width;

        if (s.type === 'straight') {
            var n = Math.max(1, Math.round(s.len / STEP));
            var dl = s.len / n;
            for (var i = 0; i < n; i++) {
                var t = (i + 1) / n;
                x += Math.cos(h) * dl;
                z += Math.sin(h) * dl;
                y += s.grade * dl;
                dist += dl;
                pushPoint(wStart + (wEnd - wStart) * t);
            }
        } else { // arc
            var arcLen = Math.abs(s.radius * s.sweep);
            var n2 = Math.max(2, Math.round(arcLen / STEP));
            var dSweep = s.sweep / n2;
            var dl2 = arcLen / n2;
            for (var j = 0; j < n2; j++) {
                var t2 = (j + 1) / n2;
                // advance heading by half-step, move, then half-step again
                h += dSweep * 0.5;
                x += Math.cos(h) * dl2;
                z += Math.sin(h) * dl2;
                h += dSweep * 0.5;
                y += s.grade * dl2;
                dist += dl2;
                pushPoint(wStart + (wEnd - wStart) * t2);
            }
        }
    }

    // Drop the duplicated final point if it coincides with the start dist.
    // The last pushed point is the geometric end of the loop (≈ start).
    var rawLen = dist;

    // ── Closure correction ────────────────────────────────────────────────
    // Distribute the XYZ closing error linearly along the loop so the path
    // returns exactly to the origin. Heading is left as-is (visual only).
    var endP = pts[pts.length - 1];
    var ex = endP.x - pts[0].x;
    var ez = endP.z - pts[0].z;
    var ey = endP.y - pts[0].y;
    for (var k = 0; k < pts.length; k++) {
        var f = pts[k].dist / rawLen;
        pts[k].x -= ex * f;
        pts[k].z -= ez * f;
        pts[k].y -= ey * f;
    }
    // Remove the now-redundant closing point (same place & dist as a wrap).
    pts.pop();

    var LENGTH = rawLen; // closed-loop arc length

    // Elevation stats (for reporting / scenery scaling).
    var minY = Infinity, maxY = -Infinity;
    for (var m = 0; m < pts.length; m++) {
        if (pts[m].y < minY) minY = pts[m].y;
        if (pts[m].y > maxY) maxY = pts[m].y;
    }
    // Shift so the lowest point of the circuit sits a little above y=0 grass.
    var yShift = -minY;
    for (var m2 = 0; m2 < pts.length; m2++) pts[m2].y += yShift;
    minY += yShift; maxY += yShift;

    // ─────────────────────────────────────────────────────────────────────
    // 3. SPATIAL INDEX for query() — bucket centerline points by integer XZ
    //    cell so query does a small local scan, not a full pass.
    // ─────────────────────────────────────────────────────────────────────
    var CELL = 30; // m
    var buckets = {};
    function cellKey(cx, cz) { return cx + ',' + cz; }
    for (var p = 0; p < pts.length; p++) {
        var cx0 = Math.floor(pts[p].x / CELL);
        var cz0 = Math.floor(pts[p].z / CELL);
        var key = cellKey(cx0, cz0);
        (buckets[key] || (buckets[key] = [])).push(p);
    }

    function nearestIndex(qx, qz) {
        var cx0 = Math.floor(qx / CELL);
        var cz0 = Math.floor(qz / CELL);
        var best = -1, bestD = Infinity;
        // search 3x3 neighbourhood; widen if empty.
        for (var ring = 1; ring <= 4 && best < 0; ring++) {
            for (var dcx = -ring; dcx <= ring; dcx++) {
                for (var dcz = -ring; dcz <= ring; dcz++) {
                    var b = buckets[cellKey(cx0 + dcx, cz0 + dcz)];
                    if (!b) continue;
                    for (var bi = 0; bi < b.length; bi++) {
                        var idx = b[bi];
                        var ddx = pts[idx].x - qx;
                        var ddz = pts[idx].z - qz;
                        var d2 = ddx * ddx + ddz * ddz;
                        if (d2 < bestD) { bestD = d2; best = idx; }
                    }
                }
            }
        }
        if (best < 0) {
            // Fallback: full scan (robustness guarantee).
            for (var fi = 0; fi < pts.length; fi++) {
                var fdx = pts[fi].x - qx, fdz = pts[fi].z - qz;
                var fd2 = fdx * fdx + fdz * fdz;
                if (fd2 < bestD) { bestD = fd2; best = fi; }
            }
        }
        return best;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. PHYSICS QUERY
    // ─────────────────────────────────────────────────────────────────────
    var WALL_MARGIN = 2.0; // wall sits this far outside the (now wider) road edge

    function query(qx, qz) {
        if (!isFinite(qx) || !isFinite(qz)) { qx = pts[0].x; qz = pts[0].z; }
        var ni = nearestIndex(qx, qz);
        // Refine: check the segment to the neighbour on both sides and project.
        var prev = (ni - 1 + pts.length) % pts.length;
        var next = (ni + 1) % pts.length;

        // pick the adjacent point whose segment the query projects onto best
        function project(aIdx, bIdx) {
            var a = pts[aIdx], b = pts[bIdx];
            var abx = b.x - a.x, abz = b.z - a.z;
            var len2 = abx * abx + abz * abz;
            var t = len2 > 1e-9 ? ((qx - a.x) * abx + (qz - a.z) * abz) / len2 : 0;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            var px = a.x + abx * t, pz = a.z + abz * t;
            var dx = qx - px, dz = qz - pz;
            return { t: t, px: px, pz: pz, d2: dx * dx + dz * dz, a: a, b: b };
        }
        var pr = project(prev, ni);
        var nx2 = project(ni, next);
        var seg = pr.d2 <= nx2.d2 ? pr : nx2;
        var a = seg.a, b = seg.b, t = seg.t;

        // Interpolated centerline values
        var cx = seg.px, cz = seg.pz;
        var height = a.y + (b.y - a.y) * t;
        var width = a.width + (b.width - a.width) * t;
        var distAlong = a.dist + (b.dist - a.dist) * t;

        // Heading along the segment (from a->b direction; robust).
        var hdx = b.x - a.x, hdz = b.z - a.z;
        var heading;
        if (hdx * hdx + hdz * hdz > 1e-9) heading = Math.atan2(hdz, hdx);
        else heading = a.heading;

        // Signed lateral: positive to the DRIVER'S RIGHT.
        // Right of heading h is direction (sin h, -cos h) in XZ.
        var rightX = Math.sin(heading), rightZ = -Math.cos(heading);
        var ox = qx - cx, oz = qz - cz;
        var lateral = ox * rightX + oz * rightZ;

        var half = width * 0.5;
        var absL = Math.abs(lateral);
        var onTrack = absL <= half;

        // grip ramps from 1.0 at edge to 0.45 over 4 m of grass.
        var grip;
        if (absL <= half) grip = 1.0;
        else {
            var over = (absL - half) / 4.0;
            if (over > 1) over = 1;
            grip = 1.0 - 0.55 * over;
        }

        var nearWall = absL >= (half + WALL_MARGIN);

        return {
            height: height,
            onTrack: onTrack,
            grip: grip,
            distAlong: distAlong,
            lateral: lateral,
            nearWall: nearWall
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. sampleByDistance
    // ─────────────────────────────────────────────────────────────────────
    function sampleByDistance(d) {
        var L = LENGTH;
        d = ((d % L) + L) % L;
        // binary search over pts[].dist (monotonic increasing)
        var lo = 0, hi = pts.length - 1;
        if (d >= pts[hi].dist) {
            // between last point and wrap to first
            var a0 = pts[hi], b0 = pts[0];
            var span = L - a0.dist;
            var t0 = span > 1e-6 ? (d - a0.dist) / span : 0;
            return lerpPt(a0, b0, t0, L);
        }
        while (lo < hi - 1) {
            var mid = (lo + hi) >> 1;
            if (pts[mid].dist <= d) lo = mid; else hi = mid;
        }
        var a = pts[lo], b = pts[hi];
        var seg = b.dist - a.dist;
        var t = seg > 1e-6 ? (d - a.dist) / seg : 0;
        return lerpPt(a, b, t, L);
    }
    function lerpPt(a, b, t, L) {
        var hdx = b.x - a.x, hdz = b.z - a.z;
        var heading = (hdx * hdx + hdz * hdz > 1e-9) ? Math.atan2(hdz, hdx) : a.heading;
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: a.z + (b.z - a.z) * t,
            heading: heading,
            width: a.width + (b.width - a.width) * t
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. VISUALS
    // ─────────────────────────────────────────────────────────────────────
    var group = new THREE.Group();
    group.name = 'MountPanorama';

    function edgeOffset(pt, side) {
        // side = +1 right, -1 left. returns {x,z}
        var rx = Math.sin(pt.heading), rz = -Math.cos(pt.heading);
        var half = pt.width * 0.5;
        return { x: pt.x + rx * half * side, z: pt.z + rz * half * side };
    }

    // ── Road ribbon ──────────────────────────────────────────────────────
    (function buildRoad() {
        var N = pts.length;
        var positions = new Float32Array(N * 2 * 3);
        var indices = [];
        for (var i = 0; i < N; i++) {
            var pt = pts[i];
            var l = edgeOffset(pt, -1);
            var r = edgeOffset(pt, +1);
            var o = i * 6;
            positions[o + 0] = l.x; positions[o + 1] = pt.y + 0.02; positions[o + 2] = l.z;
            positions[o + 3] = r.x; positions[o + 4] = pt.y + 0.02; positions[o + 5] = r.z;
        }
        for (var k = 0; k < N; k++) {
            var a = k * 2, b = ((k + 1) % N) * 2;
            // two triangles per quad: (aL,aR,bR),(aL,bR,bL)
            indices.push(a, a + 1, b + 1);
            indices.push(a, b + 1, b);
        }
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        var mat = new THREE.MeshStandardMaterial({
            color: 0x121214, roughness: 0.85, metalness: 0.0
        });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        mesh.name = 'road';
        group.add(mesh);
    })();

    // ── Edge lines + start/finish ────────────────────────────────────────
    (function buildLines() {
        var N = pts.length;
        var lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
        for (var side = -1; side <= 1; side += 2) {
            var verts = [];
            for (var i = 0; i <= N; i++) {
                var pt = pts[i % N];
                var inset = (pt.width * 0.5 - 0.25) / (pt.width * 0.5);
                var rx = Math.sin(pt.heading), rz = -Math.cos(pt.heading);
                var off = pt.width * 0.5 * inset * side;
                verts.push(pt.x + rx * off, pt.y + 0.04, pt.z + rz * off);
            }
            var g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
            group.add(new THREE.Line(g, lineMat));
        }
        // start/finish line: a white bar across the road at dist≈0.
        var p0 = pts[0];
        var sfMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        var sf = new THREE.Mesh(new THREE.PlaneGeometry(p0.width, 1.2), sfMat);
        sf.rotation.x = -Math.PI / 2;
        sf.rotation.z = -p0.heading;
        sf.position.set(p0.x, p0.y + 0.05, p0.z);
        sf.name = 'startFinish';
        group.add(sf);
    })();

    // ── Track bounds (shared by grass / scenery placement) ────────────────
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (var bi = 0; bi < pts.length; bi++) {
        if (pts[bi].x < minX) minX = pts[bi].x; if (pts[bi].x > maxX) maxX = pts[bi].x;
        if (pts[bi].z < minZ) minZ = pts[bi].z; if (pts[bi].z > maxZ) maxZ = pts[bi].z;
    }
    var midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;

    // ── Grass ground: large two-tone lush green base + patchwork verges ───
    (function buildGrass() {
        var pad = 320;
        var w = (maxX - minX) + pad * 2, d = (maxZ - minZ) + pad * 2;
        // Base plane — lush natural green.
        var geo = new THREE.PlaneGeometry(w, d, 1, 1);
        var matA = new THREE.MeshStandardMaterial({ color: 0x4f7a2f, roughness: 1.0 });
        var grass = new THREE.Mesh(geo, matA);
        grass.rotation.x = -Math.PI / 2;
        grass.position.set(midX, -0.08, midZ);
        grass.receiveShadow = true;
        grass.name = 'grass';
        group.add(grass);

        // Subtly different green patches scattered over the infield/verges to
        // break up the flat colour. Share one geometry + material.
        var patchGeo = new THREE.PlaneGeometry(1, 1);
        var matB = new THREE.MeshStandardMaterial({ color: 0x5d8c39, roughness: 1.0 });
        var patches = new THREE.InstancedMesh(patchGeo, matB, 90);
        var dummy = new THREE.Object3D();
        var seed = 1337;
        function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
        for (var i = 0; i < 90; i++) {
            var px = midX + (rnd() - 0.5) * (w * 0.9);
            var pz = midZ + (rnd() - 0.5) * (d * 0.9);
            var sc = 40 + rnd() * 120;
            dummy.position.set(px, -0.06, pz);
            dummy.rotation.set(-Math.PI / 2, 0, rnd() * Math.PI);
            dummy.scale.set(sc, sc * (0.6 + rnd() * 0.8), 1);
            dummy.updateMatrix();
            patches.setMatrixAt(i, dummy.matrix);
        }
        patches.name = 'grassPatches';
        group.add(patches);
    })();

    // Helper: is this centerline point on the tight, high mountain section?
    var mountainThresh = minY + (maxY - minY) * 0.45;
    function isMountainPt(pt) { return pt.y > mountainThresh; }

    // ── Walls & barriers ─────────────────────────────────────────────────
    // Mountain section gets close concrete walls (dark base, white capping);
    // the flats/straights get steel Armco guardrail with sponsor boards.
    (function buildWalls() {
        var N = pts.length;

        // --- Concrete walls (mountain) : dark base box + white top cap. ---
        var wallBaseMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.95 });
        var wallCapMat = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.85 });
        var wallH = 0.95, capH = 0.18, wallStep = 8.0, wallThick = 0.3;
        var wallBaseGeo = new THREE.BoxGeometry(wallStep, wallH, wallThick);
        var wallCapGeo = new THREE.BoxGeometry(wallStep, capH, wallThick + 0.06);

        function placeWall(side) {
            var i = 0;
            while (i < N) {
                var pt = pts[i];
                if (!isMountainPt(pt)) { i += 1; continue; }
                var rx = Math.sin(pt.heading), rz = -Math.cos(pt.heading);
                var off = pt.width * 0.5 + WALL_MARGIN;
                var bx = pt.x + rx * off * side, bz = pt.z + rz * off * side;
                var base = new THREE.Mesh(wallBaseGeo, wallBaseMat);
                base.position.set(bx, pt.y + wallH * 0.5, bz);
                base.rotation.y = -pt.heading;
                base.castShadow = true; base.receiveShadow = true;
                group.add(base);
                var cap = new THREE.Mesh(wallCapGeo, wallCapMat);
                cap.position.set(bx, pt.y + wallH + capH * 0.5, bz);
                cap.rotation.y = -pt.heading;
                group.add(cap);
                i += Math.max(1, Math.round(wallStep / STEP));
            }
        }
        placeWall(+1); placeWall(-1);

        // --- Armco guardrail (flats) : steel rail + posts + sponsor boards. ---
        var railMat = new THREE.MeshStandardMaterial({ color: 0xc7ccd1, roughness: 0.45, metalness: 0.6 });
        var postMat = new THREE.MeshStandardMaterial({ color: 0x6b7077, roughness: 0.7, metalness: 0.4 });
        var armStep = 14.0, railH = 0.55;
        var railGeo = new THREE.BoxGeometry(armStep, 0.28, 0.12);
        var postGeo = new THREE.BoxGeometry(0.12, railH, 0.12);
        // A few sponsor-board colours to cycle through.
        var boardMats = [
            new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.7 }),
            new THREE.MeshStandardMaterial({ color: 0x1c63b8, roughness: 0.7 }),
            new THREE.MeshStandardMaterial({ color: 0xf2c014, roughness: 0.7 }),
            new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.7 }),
            new THREE.MeshStandardMaterial({ color: 0x21a35a, roughness: 0.7 })
        ];
        var boardGeo = new THREE.BoxGeometry(armStep, 0.7, 0.06);

        function placeArmco(side) {
            var i = 0, boardCount = 0;
            while (i < N) {
                var pt = pts[i];
                if (isMountainPt(pt)) { i += 1; continue; }
                var rx = Math.sin(pt.heading), rz = -Math.cos(pt.heading);
                var off = pt.width * 0.5 + WALL_MARGIN;
                var bx = pt.x + rx * off * side, bz = pt.z + rz * off * side;
                var rail = new THREE.Mesh(railGeo, railMat);
                rail.position.set(bx, pt.y + railH, bz);
                rail.rotation.y = -pt.heading;
                rail.castShadow = true; rail.receiveShadow = true;
                group.add(rail);
                var post = new THREE.Mesh(postGeo, postMat);
                post.position.set(bx, pt.y + railH * 0.5, bz);
                post.rotation.y = -pt.heading;
                group.add(post);
                // sponsor board behind the rail, every other panel.
                if ((boardCount++ & 1) === 0) {
                    var board = new THREE.Mesh(boardGeo, boardMats[(boardCount >> 1) % boardMats.length]);
                    var boff = off + 0.25;
                    board.position.set(
                        pt.x + rx * boff * side,
                        pt.y + railH + 0.55,
                        pt.z + rz * boff * side
                    );
                    board.rotation.y = -pt.heading;
                    group.add(board);
                }
                i += Math.max(1, Math.round(armStep / STEP));
            }
        }
        placeArmco(+1); placeArmco(-1);
    })();

    // ── Red-and-white ripple kerbs at corner apexes/exits ─────────────────
    (function buildKerbs() {
        var redMat = new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.8 });
        var whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.8 });
        var stripLen = 1.4, kerbW = 0.9;
        var redGeo = new THREE.BoxGeometry(stripLen, 0.10, kerbW);
        var whiteGeo = new THREE.BoxGeometry(stripLen, 0.10, kerbW);
        var N = pts.length;
        // Lay alternating strips on BOTH edges through the curvier points
        // (heading change between neighbours indicates a corner).
        var stripIdx = 0;
        for (var i = 0; i < N; i++) {
            var pt = pts[i];
            var nxt = pts[(i + 1) % N];
            var dh = Math.atan2(Math.sin(nxt.heading - pt.heading), Math.cos(nxt.heading - pt.heading));
            if (Math.abs(dh) < 0.012) continue; // straightish → skip
            var rx = Math.sin(pt.heading), rz = -Math.cos(pt.heading);
            for (var side = -1; side <= 1; side += 2) {
                var off = pt.width * 0.5 + kerbW * 0.5 - 0.15;
                var mat = (stripIdx & 1) ? whiteMat : redMat;
                var geo = (stripIdx & 1) ? whiteGeo : redGeo;
                var k = new THREE.Mesh(geo, mat);
                k.position.set(pt.x + rx * off * side, pt.y + 0.05, pt.z + rz * off * side);
                k.rotation.y = -pt.heading;
                k.receiveShadow = true;
                group.add(k);
            }
            stripIdx++;
        }
    })();

    // ── Tyre-bundle barriers (rings of dark tyres) at a few corners ───────
    (function buildTyreStacks() {
        var tyreMat = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.95 });
        var tyreGeo = new THREE.TorusGeometry(0.42, 0.20, 6, 10);
        // Choose corner apex distances around the lap.
        var spots = [0.10, 0.27, 0.46, 0.58, 0.72, 0.88];
        for (var s = 0; s < spots.length; s++) {
            var c = sampleByDistance(LENGTH * spots[s]);
            var rx = Math.sin(c.heading), rz = -Math.cos(c.heading);
            var off = c.width * 0.5 + WALL_MARGIN + 1.2;
            var bx = c.x + rx * off, bz = c.z + rz * off;
            // a small bundle: a few stacks side by side, two tyres high.
            for (var col = 0; col < 4; col++) {
                var along = (col - 1.5) * 0.95;
                var tx = bx + Math.cos(c.heading) * along;
                var tz = bz + Math.sin(c.heading) * along;
                for (var row = 0; row < 2; row++) {
                    var t = new THREE.Mesh(tyreGeo, tyreMat);
                    t.position.set(tx, c.y + 0.22 + row * 0.42, tz);
                    t.rotation.x = Math.PI / 2; // lay flat (hole up)
                    t.castShadow = true;
                    group.add(t);
                }
            }
        }
    })();

    // ── Pit-straight complex: garages, pit wall, control tower, grandstands ─
    // Convention here: LEFT of racing direction (side = -1) is the pit/paddock
    // side; RIGHT (side = +1) holds the spectator grandstands.
    (function buildPitStraight() {
        function at(d) { return sampleByDistance(((d % LENGTH) + LENGTH) % LENGTH); }

        // --- Row of pit garages (left side, just behind a low pit wall). ---
        var garageBodyMat = new THREE.MeshStandardMaterial({ color: 0xdadee2, roughness: 0.85 });
        var garageRoofMat = new THREE.MeshStandardMaterial({ color: 0x394049, roughness: 0.8 });
        var pitWallMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.8 });
        var garageGeo = new THREE.BoxGeometry(8, 5, 12);
        var garageRoofGeo = new THREE.BoxGeometry(8.4, 0.5, 12.4);
        for (var g = 0; g < 8; g++) {
            var d = 70 + g * 9;
            var c = at(d);
            var rx = Math.sin(c.heading), rz = -Math.cos(c.heading);
            var off = c.width * 0.5 + 11;
            var bx = c.x - rx * off, bz = c.z - rz * off;
            var body = new THREE.Mesh(garageGeo, garageBodyMat);
            body.position.set(bx, c.y + 2.5, bz);
            body.rotation.y = -c.heading;
            body.castShadow = true; body.receiveShadow = true;
            group.add(body);
            var roof = new THREE.Mesh(garageRoofGeo, garageRoofMat);
            roof.position.set(bx, c.y + 5.25, bz);
            roof.rotation.y = -c.heading;
            group.add(roof);
        }
        // low pit wall between garages and track.
        var pitWallGeo = new THREE.BoxGeometry(80, 1.0, 0.4);
        for (var pw = 0; pw < 1; pw++) {
            var cw = at(70 + 3.5 * 9);
            var rxw = Math.sin(cw.heading), rzw = -Math.cos(cw.heading);
            var offw = cw.width * 0.5 + WALL_MARGIN + 0.6;
            var wall = new THREE.Mesh(pitWallGeo, pitWallMat);
            wall.position.set(cw.x - rxw * offw, cw.y + 0.5, cw.z - rzw * offw);
            wall.rotation.y = -cw.heading;
            wall.receiveShadow = true;
            group.add(wall);
        }

        // --- Multi-storey control tower near start/finish (left side). ---
        var towerMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.8 });
        var towerGlassMat = new THREE.MeshStandardMaterial({ color: 0x2b3a4a, roughness: 0.3, metalness: 0.5 });
        var ct = at(10);
        var rxt = Math.sin(ct.heading), rzt = -Math.cos(ct.heading);
        var offt = ct.width * 0.5 + 16;
        var tbx = ct.x - rxt * offt, tbz = ct.z - rzt * offt;
        var tower = new THREE.Mesh(new THREE.BoxGeometry(10, 18, 9), towerMat);
        tower.position.set(tbx, ct.y + 9, tbz);
        tower.rotation.y = -ct.heading;
        tower.castShadow = true; tower.receiveShadow = true;
        group.add(tower);
        // glass band at the top (race control gallery).
        var gallery = new THREE.Mesh(new THREE.BoxGeometry(10.4, 3.5, 9.4), towerGlassMat);
        gallery.position.set(tbx, ct.y + 16, tbz);
        gallery.rotation.y = -ct.heading;
        group.add(gallery);

        // --- Grandstand blocks (right side) with a suggestion of spectators. ---
        var standMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.85 });
        var roofMat = new THREE.MeshStandardMaterial({ color: 0xb0241f, roughness: 0.7 });
        var seatGeo = new THREE.BoxGeometry(60, 8, 14);
        var standRoofGeo = new THREE.BoxGeometry(62, 0.6, 17);
        // Tiny instanced "spectators": pale dots speckling the seating bank.
        var crowdGeo = new THREE.BoxGeometry(0.4, 0.5, 0.4);
        var crowdMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c4, roughness: 1.0 });
        var seedC = 99;
        function rc() { seedC = (seedC * 1103515245 + 12345) & 0x7fffffff; return seedC / 0x7fffffff; }
        for (var s = 0; s < 3; s++) {
            var ds = 60 + s * 95;
            var cs = at(ds);
            var rxs = Math.sin(cs.heading), rzs = -Math.cos(cs.heading);
            var offs = cs.width * 0.5 + 16;
            var sbx = cs.x + rxs * offs, sbz = cs.z + rzs * offs;
            var stand = new THREE.Mesh(seatGeo, standMat);
            stand.position.set(sbx, cs.y + 4, sbz);
            stand.rotation.y = -cs.heading;
            stand.castShadow = true; stand.receiveShadow = true;
            group.add(stand);
            var sroof = new THREE.Mesh(standRoofGeo, roofMat);
            sroof.position.set(sbx, cs.y + 9, sbz - rzs * 0);
            sroof.rotation.y = -cs.heading;
            group.add(sroof);
            // spectator dots across the front face of the stand.
            var rows = 6, cols = 40, crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, rows * cols);
            var fwdX = Math.cos(cs.heading), fwdZ = Math.sin(cs.heading);
            var n = 0, dummyc = new THREE.Object3D();
            for (var r = 0; r < rows; r++) {
                for (var co = 0; co < cols; co++) {
                    var along = (co / (cols - 1) - 0.5) * 56;
                    var hgt = cs.y + 1.5 + r * 1.0;
                    var inset = 6.8 - r * 0.5; // tiered toward track
                    var cxp = sbx + fwdX * along - rxs * inset;
                    var czp = sbz + fwdZ * along - rzs * inset;
                    // jitter so the crowd looks speckled, not gridded.
                    dummyc.position.set(cxp + (rc() - 0.5) * 0.6, hgt + (rc() - 0.5) * 0.3, czp + (rc() - 0.5) * 0.6);
                    dummyc.updateMatrix();
                    crowd.setMatrixAt(n, dummyc.matrix);
                    n++;
                }
            }
            crowd.name = 'crowd';
            group.add(crowd);
        }

        // --- Light poles (tall, curved-arm streetlights) along pit straight. ---
        var poleMat = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.6, metalness: 0.6 });
        var lampMat = new THREE.MeshStandardMaterial({
            color: 0xffffff, roughness: 0.4,
            emissive: 0xfff2cc, emissiveIntensity: 0.6
        });
        var poleGeo = new THREE.CylinderGeometry(0.18, 0.22, 9, 8);
        var armGeo = new THREE.CylinderGeometry(0.12, 0.12, 3, 8);
        var lampGeo = new THREE.BoxGeometry(1.0, 0.25, 0.5);
        for (var lp = 0; lp < 7; lp++) {
            var dl = 50 + lp * 80;
            var cl = at(dl);
            var rxl = Math.sin(cl.heading), rzl = -Math.cos(cl.heading);
            var offl = cl.width * 0.5 + 6;
            var pbx = cl.x + rxl * offl, pbz = cl.z + rzl * offl; // right side
            var pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.set(pbx, cl.y + 4.5, pbz);
            pole.castShadow = true;
            group.add(pole);
            // curved arm reaching toward the track (-side direction).
            var arm = new THREE.Mesh(armGeo, poleMat);
            arm.position.set(pbx - rxl * 1.5, cl.y + 9, pbz - rzl * 1.5);
            arm.rotation.z = Math.PI / 2;
            arm.rotation.y = -cl.heading;
            group.add(arm);
            var lamp = new THREE.Mesh(lampGeo, lampMat);
            lamp.position.set(pbx - rxl * 3, cl.y + 8.8, pbz - rzl * 3);
            lamp.rotation.y = -cl.heading;
            group.add(lamp);
        }
    })();

    // Centroid of the high mountain section (used by the hill + lettering).
    var hillX = 0, hillZ = 0, hillCnt = 0;
    for (var hi = 0; hi < pts.length; hi++) {
        if (pts[hi].y > minY + (maxY - minY) * 0.7) { hillX += pts[hi].x; hillZ += pts[hi].z; hillCnt++; }
    }
    if (hillCnt > 0) { hillX /= hillCnt; hillZ /= hillCnt; } else { hillX = midX; hillZ = midZ; }

    // ── The hill itself + the iconic MOUNT PANORAMA hillside lettering ─────
    (function buildMountain() {
        var mat = new THREE.MeshStandardMaterial({ color: 0x4f6b3a, roughness: 1.0, flatShading: true });
        var hill = new THREE.Mesh(new THREE.ConeGeometry(280, maxY + 50, 8), mat);
        hill.position.set(hillX, (maxY) / 2 - 5, hillZ);
        hill.receiveShadow = true;
        group.add(hill);

        // MOUNT PANORAMA lettering on a plane angled onto the hillside, facing
        // back toward the circuit. CanvasTexture when a DOM exists; otherwise a
        // plain white material fallback so the build never throws in Node.
        var letterMat;
        var canTex = null;
        if (typeof document !== 'undefined') {
            try {
                var canvas = document.createElement('canvas');
                canvas.width = 1024; canvas.height = 256;
                var ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, 1024, 256);
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 150px Arial, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('MOUNT PANORAMA', 512, 128);
                    canTex = new THREE.CanvasTexture(canvas);
                }
            } catch (e) { canTex = null; }
        }
        if (canTex) {
            letterMat = new THREE.MeshBasicMaterial({ map: canTex, transparent: true });
        } else {
            letterMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        }
        var sign = new THREE.Mesh(new THREE.PlaneGeometry(180, 45), letterMat);
        // sit it up on the hillside, above the high section, tilted to the slope.
        sign.position.set(hillX, maxY + 35, hillZ - 120);
        sign.rotation.x = -Math.PI / 6;
        sign.name = 'mountPanoramaSign';
        group.add(sign);
    })();

    // ── Distant blue-grey ranges encircling the circuit on the horizon ────
    (function buildRanges() {
        var mat = new THREE.MeshStandardMaterial({
            color: 0x6b7d94, roughness: 1.0, flatShading: true,
            emissive: 0x2a3340, emissiveIntensity: 0.25
        });
        var rad = Math.max(maxX - minX, maxZ - minZ) * 0.5 + 900;
        var ridges = 26;
        var geo = new THREE.ConeGeometry(1, 1, 5); // unit cone, scaled per instance
        var ranges = new THREE.InstancedMesh(geo, mat, ridges);
        var dummy = new THREE.Object3D();
        var seed = 7;
        function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
        for (var i = 0; i < ridges; i++) {
            var ang = (i / ridges) * Math.PI * 2 + rnd() * 0.15;
            var rr = rad + (rnd() - 0.5) * 250;
            var px = midX + Math.cos(ang) * rr;
            var pz = midZ + Math.sin(ang) * rr;
            var hgt = 220 + rnd() * 260;
            var wid = 500 + rnd() * 500;
            dummy.position.set(px, hgt * 0.5 - 40, pz);
            dummy.rotation.set(0, rnd() * Math.PI, 0);
            dummy.scale.set(wid, hgt, wid);
            dummy.updateMatrix();
            ranges.setMatrixAt(i, dummy.matrix);
        }
        ranges.name = 'ranges';
        group.add(ranges);
    })();

    // ── Eucalyptus / gum trees (instanced trunks + canopies) ──────────────
    (function buildTrees() {
        // Shared geometry/material; two InstancedMeshes (trunks + canopies).
        var trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 7, 6);
        var canopyGeo = new THREE.SphereGeometry(2.4, 7, 6);
        var trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a8472, roughness: 0.95 });
        var canopyMat = new THREE.MeshStandardMaterial({ color: 0x5a6e3a, roughness: 1.0 });

        var COUNT = 340;
        var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, COUNT);
        var canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, COUNT);
        var dT = new THREE.Object3D(), dC = new THREE.Object3D();
        var seed = 4242;
        function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

        var N = pts.length, placed = 0;
        // Most trees cluster along the mountain descent and Conrod; the rest
        // scatter through the outfield. Walk the centerline, drop trees beyond
        // the barriers, jittered, on alternating sides.
        var guard = 0;
        while (placed < COUNT && guard < COUNT * 12) {
            guard++;
            var i = (Math.floor(rnd() * N)) % N;
            var pt = pts[i];
            // density: mountain section + the back half (Conrod-ish) favoured.
            var onMountain = isMountainPt(pt);
            var keepProb = onMountain ? 0.95 : 0.55;
            if (rnd() > keepProb) continue;
            var side = rnd() < 0.5 ? -1 : 1;
            var rx = Math.sin(pt.heading), rz = -Math.cos(pt.heading);
            // distance out beyond the barrier; trees set back from the track.
            var out = pt.width * 0.5 + WALL_MARGIN + 6 + rnd() * 60;
            var jitterAlong = (rnd() - 0.5) * 10;
            var fwdX = Math.cos(pt.heading), fwdZ = Math.sin(pt.heading);
            var tx = pt.x + rx * out * side + fwdX * jitterAlong;
            var tz = pt.z + rz * out * side + fwdZ * jitterAlong;
            var ty = pt.y; // approximate ground at this centerline elevation
            var sc = 0.7 + rnd() * 1.1; // vary scale
            var rot = rnd() * Math.PI * 2;

            dT.position.set(tx, ty + 3.5 * sc, tz);
            dT.rotation.set(0, rot, 0);
            dT.scale.set(sc, sc, sc);
            dT.updateMatrix();
            trunks.setMatrixAt(placed, dT.matrix);

            dC.position.set(tx, ty + (7 + 1.6) * sc, tz);
            dC.rotation.set(0, rot, 0);
            // slightly squashed/elongated canopy for a gum-tree silhouette.
            dC.scale.set(sc * (0.9 + rnd() * 0.4), sc * (1.1 + rnd() * 0.5), sc * (0.9 + rnd() * 0.4));
            dC.updateMatrix();
            canopies.setMatrixAt(placed, dC.matrix);
            placed++;
        }
        // Hide any unused instances (if we somehow under-filled) by scaling to 0.
        for (var u = placed; u < COUNT; u++) {
            dT.position.set(0, -1000, 0); dT.scale.set(0.0001, 0.0001, 0.0001); dT.updateMatrix();
            trunks.setMatrixAt(u, dT.matrix);
            canopies.setMatrixAt(u, dT.matrix);
        }
        trunks.castShadow = true; canopies.castShadow = true;
        trunks.name = 'treeTrunks'; canopies.name = 'treeCanopies';
        group.add(trunks);
        group.add(canopies);
    })();

    // ─────────────────────────────────────────────────────────────────────
    // 7. START / GRID
    //    Just before the start/finish line, on the racing centerline.
    // ─────────────────────────────────────────────────────────────────────
    var startD = LENGTH - 15;   // 15 m before the line
    var startC = sampleByDistance(startD);
    var start = {
        position: { x: startC.x, y: startC.y, z: startC.z },
        heading: startC.heading
    };

    // ─────────────────────────────────────────────────────────────────────
    // 8. RETURN
    // ─────────────────────────────────────────────────────────────────────
    return {
        group: group,
        length: LENGTH,
        start: start,
        sampleByDistance: sampleByDistance,
        query: query,
        // exposed for debugging / tooling (not part of the core contract)
        _centerline: pts,
        _elevation: { min: minY, max: maxY }
    };
};
