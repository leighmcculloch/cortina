/*
 * car.js — 1964 Ford Cortina Mk1 four-door saloon model
 *
 * CONTRACT IMPLEMENTED:
 *   window.GAME.buildCortina(THREE) → THREE.Group
 *
 * Coordinate system: right-handed, Y-up, X/Z horizontal, meters & radians.
 *   - Car faces +X (front at +X, rear at -X).
 *   - Centered at origin in X and Z.
 *   - Wheels rest on y=0 ground plane; body sits above.
 *
 * Approximate dimensions: L 4.27 × W 1.59 × H 1.41 m
 *
 * userData on returned group:
 *   .wheels  = [frontLeft, frontRight, rearLeft, rearRight]  (cylinders, axle=Z)
 *              Roll via:  wheel.rotation.z += delta
 *   .steer   = [frontLeftPivot, frontRightPivot]             (Object3D pivots)
 *              Steer via: pivot.rotation.y = steerAngle
 *
 * Geometry: procedural only (BoxGeometry, CylinderGeometry).
 * Materials: MeshStandardMaterial. No external assets.
 * Wheels: CylinderGeometry with axle along Z; children of steer pivots for
 *         front pair so pivot.rotation.y correctly rotates wheel about hub.
 */

window.GAME = window.GAME || {};

window.GAME.buildCortina = function (THREE) {

    // ── Materials ──────────────────────────────────────────────────────────
    var matBody = new THREE.MeshStandardMaterial({
        color: 0x1f6fd6,   // True Blue
        roughness: 0.35,
        metalness: 0.25
    });
    var matRoof = new THREE.MeshStandardMaterial({
        color: 0xdce8f8,   // Light / off-white roof
        roughness: 0.45,
        metalness: 0.10
    });
    var matChrome = new THREE.MeshStandardMaterial({
        color: 0xc8d0d8,   // Chrome / light metallic grey
        roughness: 0.20,
        metalness: 0.80
    });
    var matGlass = new THREE.MeshStandardMaterial({
        color: 0x1a2a3a,   // Dark tinted glass
        roughness: 0.05,
        metalness: 0.10,
        transparent: true,
        opacity: 0.45
    });
    var matHeadlight = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.05,
        metalness: 0.20,
        emissive: 0xffffee,
        emissiveIntensity: 0.3
    });
    var matTaillight = new THREE.MeshStandardMaterial({
        color: 0xcc1111,
        roughness: 0.15,
        metalness: 0.10,
        emissive: 0x880000,
        emissiveIntensity: 0.25
    });
    var matTyre = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.85,
        metalness: 0.00
    });
    var matHubcap = new THREE.MeshStandardMaterial({
        color: 0xb8c0c8,
        roughness: 0.25,
        metalness: 0.75
    });
    var matGrille = new THREE.MeshStandardMaterial({
        color: 0x333840,
        roughness: 0.60,
        metalness: 0.40
    });
    var matInterior = new THREE.MeshStandardMaterial({
        color: 0x3a2a1a,
        roughness: 0.80,
        metalness: 0.00
    });

    // ── Root group ─────────────────────────────────────────────────────────
    var group = new THREE.Group();

    // ── Shared measurements ────────────────────────────────────────────────
    var carL  = 4.27;   // total length along X
    var carW  = 1.59;   // total width  along Z
    var carH  = 1.41;   // total height

    // Wheel geometry
    var wheelR      = 0.30;   // tyre outer radius  (wheels sit on y=0)
    var wheelThick  = 0.18;   // tyre width (along Z axle)
    var hubR        = 0.13;   // hubcap radius
    var hubThick    = 0.04;

    // Longitudinal wheel positions (from car centre)
    var axleFX =  1.45;   // front axle +X
    var axleRX = -1.35;   // rear  axle -X
    var axleZ  =  0.70;   // half-track (distance from centre to wheel hub)

    // Body geometry split: sill (lower), cabin (upper)
    var sillH   = 0.55;   // height of lower body box (floor/sill region)
    var sillY   = wheelR; // bottom of sill sits at wheel-centre height — actually rest on y=0
    // We'll position sill so its bottom = 0 (ground). Wheels also rest on y=0.
    // Ground plane y=0; wheel bottom y=0 → wheel centre y=wheelR=0.30
    // Lower body (sill/floor): from y=0 to y=sillH+wheelR isn't right — keep it simple:
    //   sill box bottom = 0.10 (floor clearance), top = 0.65
    var sillBottom = 0.10;
    var sillTop    = 0.65;
    var sillActualH = sillTop - sillBottom;   // 0.55

    // Cabin sits on top of sill
    var cabinBottom = sillTop;                // 0.65
    var cabinH      = 0.62;                  // cabin walls height
    var cabinTop    = cabinBottom + cabinH;  // 1.27

    // Roof
    var roofH       = 0.14;
    var roofBottom  = cabinTop;              // 1.27
    var roofTop     = roofBottom + roofH;   // 1.41  ← matches carH

    // ── Lower body / main shell ────────────────────────────────────────────
    // Full-width lower body slab
    var sillGeo  = new THREE.BoxGeometry(carL, sillActualH, carW);
    var sillMesh = new THREE.Mesh(sillGeo, matBody);
    sillMesh.position.set(0, sillBottom + sillActualH / 2, 0);
    sillMesh.castShadow    = true;
    sillMesh.receiveShadow = true;
    group.add(sillMesh);

    // ── Cabin sides (two side panels + front + rear walls) ─────────────────
    // Rather than a single cabin box (which would block the glass opening),
    // we build a cabin beltline box slightly narrower than the roof, then
    // overlay glass panes.

    var cabinW = carW;          // same width as lower body
    var cabinL = 2.62;          // cabin length (shorter than car — boot + bonnet stick out)
    var cabinOffX = -0.08;      // cabin sits slightly rearward of centre

    var cabinGeo  = new THREE.BoxGeometry(cabinL, cabinH, cabinW);
    var cabinMesh = new THREE.Mesh(cabinGeo, matBody);
    cabinMesh.position.set(cabinOffX, cabinBottom + cabinH / 2, 0);
    cabinMesh.castShadow    = true;
    cabinMesh.receiveShadow = false;
    group.add(cabinMesh);

    // ── Roof ───────────────────────────────────────────────────────────────
    var roofW   = carW - 0.08;  // slightly in from body edge (drip rail)
    var roofL   = cabinL - 0.10;
    var roofGeo  = new THREE.BoxGeometry(roofL, roofH, roofW);
    var roofMesh = new THREE.Mesh(roofGeo, matRoof);
    roofMesh.position.set(cabinOffX, roofBottom + roofH / 2, 0);
    roofMesh.castShadow    = true;
    roofMesh.receiveShadow = false;
    group.add(roofMesh);

    // ── Windscreen (front glass) ───────────────────────────────────────────
    // Sits in front face of cabin; angled slightly (approximate with flat pane)
    var wscreenW = cabinW - 0.18;
    var wscreenH = cabinH * 0.70;
    var wscreenGeo  = new THREE.BoxGeometry(0.04, wscreenH, wscreenW);
    var wscreenMesh = new THREE.Mesh(wscreenGeo, matGlass);
    wscreenMesh.position.set(
        cabinOffX + cabinL / 2 - 0.02,
        cabinBottom + cabinH * 0.65,
        0
    );
    group.add(wscreenMesh);

    // ── Rear window ───────────────────────────────────────────────────────
    var rearGlassGeo  = new THREE.BoxGeometry(0.04, wscreenH * 0.90, wscreenW);
    var rearGlassMesh = new THREE.Mesh(rearGlassGeo, matGlass);
    rearGlassMesh.position.set(
        cabinOffX - cabinL / 2 + 0.02,
        cabinBottom + cabinH * 0.62,
        0
    );
    group.add(rearGlassMesh);

    // ── Side windows (two panes each side, front & rear door) ─────────────
    var doorGlassH = cabinH * 0.68;
    var doorGlassL = cabinL * 0.44;

    [-1, 1].forEach(function (side) {
        var zPos = side * (carW / 2);

        // Front door glass
        var fdGeo  = new THREE.BoxGeometry(doorGlassL, doorGlassH, 0.03);
        var fdMesh = new THREE.Mesh(fdGeo, matGlass);
        fdMesh.position.set(
            cabinOffX + cabinL * 0.22,
            cabinBottom + cabinH * 0.66,
            zPos
        );
        group.add(fdMesh);

        // Rear door glass
        var rdGeo  = new THREE.BoxGeometry(doorGlassL, doorGlassH * 0.95, 0.03);
        var rdMesh = new THREE.Mesh(rdGeo, matGlass);
        rdMesh.position.set(
            cabinOffX - cabinL * 0.22,
            cabinBottom + cabinH * 0.64,
            zPos
        );
        group.add(rdMesh);
    });

    // ── Bonnet (hood) ──────────────────────────────────────────────────────
    var bonnetL = carL / 2 - cabinL / 2 + cabinOffX + 0.05;  // ~0.88
    var bonnetH = 0.07;
    var bonnetY = sillTop + bonnetH / 2;
    var bonnetGeo  = new THREE.BoxGeometry(bonnetL, bonnetH, carW - 0.04);
    var bonnetMesh = new THREE.Mesh(bonnetGeo, matBody);
    bonnetMesh.position.set(
        carL / 2 - bonnetL / 2,
        bonnetY,
        0
    );
    bonnetMesh.castShadow    = true;
    bonnetMesh.receiveShadow = false;
    group.add(bonnetMesh);

    // ── Boot (trunk lid) ──────────────────────────────────────────────────
    var bootL = carL / 2 - cabinL / 2 - cabinOffX + 0.05;  // ~0.78
    var bootH = bonnetH;
    var bootGeo  = new THREE.BoxGeometry(bootL, bootH, carW - 0.04);
    var bootMesh = new THREE.Mesh(bootGeo, matBody);
    bootMesh.position.set(
        -(carL / 2 - bootL / 2),
        bonnetY,
        0
    );
    bootMesh.castShadow    = true;
    bootMesh.receiveShadow = false;
    group.add(bootMesh);

    // ── Front grille ──────────────────────────────────────────────────────
    // Cortina Mk1 has a simple horizontal-bar grille below the bonnet nose
    var grilleW = carW * 0.70;
    var grilleH = 0.10;
    var grilleGeo  = new THREE.BoxGeometry(0.05, grilleH, grilleW);
    var grilleMesh = new THREE.Mesh(grilleGeo, matGrille);
    grilleMesh.position.set(carL / 2 - 0.02, sillTop - grilleH * 0.5, 0);
    group.add(grilleMesh);

    // ── Front bumper ──────────────────────────────────────────────────────
    var bumpH = 0.10;
    var bumpD = 0.06;
    var frontBumpGeo  = new THREE.BoxGeometry(bumpD, bumpH, carW + 0.04);
    var frontBumpMesh = new THREE.Mesh(frontBumpGeo, matChrome);
    frontBumpMesh.position.set(carL / 2 + bumpD / 2 - 0.01, 0.22, 0);
    group.add(frontBumpMesh);

    // ── Rear bumper ───────────────────────────────────────────────────────
    var rearBumpGeo  = new THREE.BoxGeometry(bumpD, bumpH, carW + 0.04);
    var rearBumpMesh = new THREE.Mesh(rearBumpGeo, matChrome);
    rearBumpMesh.position.set(-(carL / 2 + bumpD / 2 - 0.01), 0.22, 0);
    group.add(rearBumpMesh);

    // ── Round headlights (front, two) ─────────────────────────────────────
    // CylinderGeometry(rTop, rBot, height, segs) — oriented along X
    var hlR = 0.095;
    var hlGeo = new THREE.CylinderGeometry(hlR, hlR, 0.06, 16);
    hlGeo.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));

    [-1, 1].forEach(function (side) {
        var hlMesh = new THREE.Mesh(hlGeo, matHeadlight);
        hlMesh.position.set(carL / 2 - 0.03, sillTop + 0.02, side * 0.52);
        group.add(hlMesh);

        // Chrome ring around headlight
        var ringGeo  = new THREE.CylinderGeometry(hlR + 0.015, hlR + 0.015, 0.03, 16);
        ringGeo.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
        var ringMesh = new THREE.Mesh(ringGeo, matChrome);
        ringMesh.position.copy(hlMesh.position);
        group.add(ringMesh);
    });

    // ── Round rear taillights (Mk1 distinctive round clusters) ───────────
    var tlR   = 0.08;
    var tlGeo = new THREE.CylinderGeometry(tlR, tlR, 0.05, 16);
    tlGeo.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));

    [-1, 1].forEach(function (side) {
        var tlMesh = new THREE.Mesh(tlGeo, matTaillight);
        tlMesh.position.set(-(carL / 2 - 0.025), sillTop + 0.02, side * 0.52);
        group.add(tlMesh);

        var trRingGeo  = new THREE.CylinderGeometry(tlR + 0.012, tlR + 0.012, 0.025, 16);
        trRingGeo.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
        var trRingMesh = new THREE.Mesh(trRingGeo, matChrome);
        trRingMesh.position.copy(tlMesh.position);
        group.add(trRingMesh);
    });

    // ── Wheel builder helper ───────────────────────────────────────────────
    // Returns { pivot, wheel } where:
    //   pivot  — Object3D at hub position (parent of wheel group)
    //   wheel  — the outer tyre mesh used for rotation (rotation.z)
    function makeWheel(xPos, zPos) {
        var pivot = new THREE.Object3D();
        pivot.position.set(xPos, wheelR, zPos);
        group.add(pivot);

        // Tyre — cylinder, open ends; axle along Z
        // CylinderGeometry default is Y-axis; rotate to align axle with Z
        var tyreGeo = new THREE.CylinderGeometry(
            wheelR, wheelR, wheelThick, 20, 1, false
        );
        tyreGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        var tyre = new THREE.Mesh(tyreGeo, matTyre);
        tyre.castShadow    = true;
        tyre.receiveShadow = true;
        pivot.add(tyre);

        // Hubcap (slightly smaller disc on outboard face)
        var capGeo = new THREE.CylinderGeometry(hubR, hubR, hubThick, 16);
        capGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        var cap = new THREE.Mesh(capGeo, matHubcap);
        // Outboard face offset along Z (positive Z = +Z side, negative = -Z side)
        var outboard = (zPos >= 0) ? 1 : -1;
        cap.position.set(0, 0, outboard * (wheelThick / 2 + hubThick / 2 - 0.005));
        pivot.add(cap);

        return { pivot: pivot, wheel: tyre };
    }

    // ── Build four wheels ──────────────────────────────────────────────────
    var fl = makeWheel( axleFX,  axleZ);   // front-left  (+Z side = driver RHD)
    var fr = makeWheel( axleFX, -axleZ);   // front-right
    var rl = makeWheel( axleRX,  axleZ);   // rear-left
    var rr = makeWheel( axleRX, -axleZ);   // rear-right

    // Rear pivots are already parented to group (no steering pivot needed)
    // Front pivots serve as steer pivots — they are already in group.

    // ── userData wiring ────────────────────────────────────────────────────
    // wheels[i] are the tyre meshes; integrator does wheel.rotation.z += delta
    // steer[i]  are the front pivot Object3Ds; integrator does pivot.rotation.y = angle
    group.userData.wheels = [fl.wheel, fr.wheel, rl.wheel, rr.wheel];
    group.userData.steer  = [fl.pivot, fr.pivot];

    // ── Simple interior hint (steering wheel, RHD — driver on +Z side) ────
    var steerColGeo  = new THREE.CylinderGeometry(0.02, 0.02, 0.28, 8);
    var steerColMesh = new THREE.Mesh(steerColGeo, matInterior);
    steerColMesh.position.set(cabinOffX + 0.38, cabinBottom + 0.22, 0.22);
    steerColMesh.rotation.x = Math.PI / 5;
    group.add(steerColMesh);

    var steerWheelGeo  = new THREE.TorusGeometry(0.11, 0.015, 8, 20);
    var steerWheelMesh = new THREE.Mesh(steerWheelGeo, matInterior);
    steerWheelMesh.position.set(
        cabinOffX + 0.38 + 0.12 * Math.sin(Math.PI / 5),
        cabinBottom + 0.22 + 0.12 * Math.cos(Math.PI / 5),
        0.22
    );
    steerWheelMesh.rotation.x = Math.PI / 5;
    group.add(steerWheelMesh);

    return group;
};
