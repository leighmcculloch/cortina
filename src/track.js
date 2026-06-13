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

    var WIDE = 11.0;   // flats / Conrod / Pit straight
    var MOUNT = 7.5;   // narrow mountain top section

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
        { type: 'arc', radius: 80, sweep: -1.45, grade: 0.078, width: 10.5 },
        // short link
        { type: 'straight', len: 220, grade: 0.100, width: 10.0 },
        // The Cutting — steep left climb (the steepest grade on the lap).
        { type: 'arc', radius: 42, sweep: 1.55, grade: 0.165, width: 9.0 },
        // Climb toward Reid Park.
        { type: 'straight', len: 210, grade: 0.130, width: 9.0 },
        // Reid Park — right kink.
        { type: 'arc', radius: 110, sweep: -0.85, grade: 0.085, width: 8.5 },
        // Quarry Corner — left.
        { type: 'arc', radius: 70, sweep: 1.05, grade: 0.055, width: 8.0 },
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
        { type: 'arc', radius: 40, sweep: 1.35, grade: -0.200, width: 7.0 },
        // link down toward Forrest's Elbow
        { type: 'straight', len: 130, grade: -0.170, width: 7.5 },
        // Forrest's Elbow — left, onto Conrod.
        { type: 'arc', radius: 50, sweep: 1.10, grade: -0.110, width: 8.5 },
        // Conrod Straight — long, downhill then flattening out. Split in three
        // to taper the grade from steep to flat.
        { type: 'straight', len: 700, grade: -0.090, width: 10.0 },
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
    var WALL_MARGIN = 1.5; // wall sits this far outside the road edge

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
            color: 0x2a2c30, roughness: 0.95, metalness: 0.0
        });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        mesh.name = 'road';
        group.add(mesh);
    })();

    // ── Edge lines + start/finish ────────────────────────────────────────
    (function buildLines() {
        var N = pts.length;
        var lineMat = new THREE.LineBasicMaterial({ color: 0xf2f2f2 });
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

    // ── Grass ground plane ───────────────────────────────────────────────
    (function buildGrass() {
        // bounds
        var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (var i = 0; i < pts.length; i++) {
            if (pts[i].x < minX) minX = pts[i].x; if (pts[i].x > maxX) maxX = pts[i].x;
            if (pts[i].z < minZ) minZ = pts[i].z; if (pts[i].z > maxZ) maxZ = pts[i].z;
        }
        var pad = 200;
        var w = (maxX - minX) + pad * 2, d = (maxZ - minZ) + pad * 2;
        var geo = new THREE.PlaneGeometry(w, d);
        var mat = new THREE.MeshStandardMaterial({ color: 0x3f6b35, roughness: 1.0 });
        var grass = new THREE.Mesh(geo, mat);
        grass.rotation.x = -Math.PI / 2;
        grass.position.set((minX + maxX) / 2, -0.05, (minZ + maxZ) / 2);
        grass.receiveShadow = true;
        grass.name = 'grass';
        group.add(grass);
    })();

    // ── Walls & barriers ─────────────────────────────────────────────────
    // Mountain section (segments roughly from The Cutting through The Dipper)
    // gets close concrete walls; elsewhere low Armco-style barriers, sparser.
    (function buildWalls() {
        var wallMat = new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 0.9 });
        var armcoMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.4 });

        // Determine "mountain" range by distance: from end of Mountain Straight
        // climb up to Forrest's Elbow. Approx by elevation: high portions.
        var N = pts.length;
        var wallH = 0.9, armcoH = 0.5, segLen = 8.0;

        // place a box every `segLen` along an edge, oriented to heading.
        function placeRow(side, useWall, step) {
            var mat = useWall ? wallMat : armcoMat;
            var hgt = useWall ? wallH : armcoH;
            var margin = WALL_MARGIN;
            var i = 0;
            while (i < N) {
                var pt = pts[i];
                // wall only on the tight mountain section, barriers elsewhere.
                var isMountain = pt.y > (minY + (maxY - minY) * 0.45);
                if (useWall !== isMountain) { i += 1; continue; }
                var rx = Math.sin(pt.heading), rz = -Math.cos(pt.heading);
                var off = pt.width * 0.5 + margin;
                var box = new THREE.Mesh(
                    new THREE.BoxGeometry(step, hgt, 0.3), mat
                );
                box.position.set(
                    pt.x + rx * off * side,
                    pt.y + hgt * 0.5,
                    pt.z + rz * off * side
                );
                box.rotation.y = -pt.heading;
                box.castShadow = true;
                box.receiveShadow = true;
                group.add(box);
                i += Math.max(1, Math.round(step / STEP));
            }
        }
        placeRow(+1, true, segLen);
        placeRow(-1, true, segLen);
        placeRow(+1, false, segLen * 2); // sparser barriers on flats
        placeRow(-1, false, segLen * 2);
    })();

    // ── Grandstands near Pit Straight ────────────────────────────────────
    (function buildGrandstands() {
        var standMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.85 });
        var p0 = pts[0];
        for (var s = 0; s < 3; s++) {
            var d = 40 + s * 90;
            var c = sampleByDistance(d);
            var rx = Math.sin(c.heading), rz = -Math.cos(c.heading);
            var off = c.width * 0.5 + 14;
            var stand = new THREE.Mesh(new THREE.BoxGeometry(60, 10, 16), standMat);
            stand.position.set(c.x - rx * off, c.y + 5, c.z - rz * off);
            stand.rotation.y = -c.heading;
            stand.castShadow = true; stand.receiveShadow = true;
            group.add(stand);
        }
    })();

    // ── Suggestion of the mountain ───────────────────────────────────────
    (function buildMountain() {
        // a big low-poly cone/hill placed near the high section centroid.
        var hx = 0, hz = 0, cnt = 0;
        for (var i = 0; i < pts.length; i++) {
            if (pts[i].y > minY + (maxY - minY) * 0.7) { hx += pts[i].x; hz += pts[i].z; cnt++; }
        }
        if (cnt > 0) { hx /= cnt; hz /= cnt; }
        var mat = new THREE.MeshStandardMaterial({ color: 0x4a5d3a, roughness: 1.0, flatShading: true });
        var hill = new THREE.Mesh(new THREE.ConeGeometry(260, maxY + 40, 7), mat);
        hill.position.set(hx, (maxY) / 2 - 5, hz);
        hill.receiveShadow = true;
        group.add(hill);
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
