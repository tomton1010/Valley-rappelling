/* ---------------------------------------------------------------------------
 * 40-vehicles.js — procedural rideable vehicles + shared stylized rider.
 * Zelda BotW / Ghibli toon look. Three.js primitives only, no external assets.
 * Models FACE -Z. root origin y = 0 is the ground contact plane. 1 unit = 1 m.
 * Pasted into one shared ES module scope: single top-level declaration only.
 * ------------------------------------------------------------------------- */
function buildVehicles(THREE, M) {
  /* ======================= palette ======================= */
  const C_CREAM = 0xf2e6c8;
  const C_INK = 0x2a2038;
  const C_CYAN = 0x35e0ff;
  const C_MAGENTA = 0xff4fa3;
  const C_AMBER = 0xffb020;
  const C_DEEPBLUE = 0x2b3a67;
  const C_CHESTNUT = 0xb0703c;
  const C_TUNIC = 0x4aa83c;   // 参考图的草绿束腰外衣
  const C_REDORANGE = 0xff5a3c;
  const C_MANE = 0x4a2f1c;
  const C_SADDLETEAL = 0x2fb6a8;
  const C_BOOT = 0x6b4a2f;
  const C_CAPE = 0x7a4a28;   // 皮革色披风：读作背包布，与绿衣暖土色搭配
  const C_SCARF = 0xe8453a;   // 暖红围巾：与冷色披风互补，跑动时最醒目

  const TAU = Math.PI * 2;
  const PI = Math.PI;

  /* ======================= build-time scratch ======================= */
  const _up = new THREE.Vector3(0, 1, 0);
  const _dir = new THREE.Vector3();
  const _ik = new Float64Array(2);

  /* ======================= materials (built once) =======================
   * M.toon / M.basic are CACHED and shared with the other fragments, and
   * M.outline reuses three shared outline materials — those belong to
   * M.disposeAll(), so dispose() below must not free them. Only the glow
   * materials here are exclusively ours. */
  const ownedMats = [];
  function ownGlow(hex, mult) {
    const base = M.glow(hex, mult);
    const m = base.clone();   // board/rider-owned copy; never mutate a shared M mat
    base.dispose();
    ownedMats.push(m);
    return m;
  }
  // Same ownership rule for toon materials whose opacity we animate per-frame.
  // The cached original stays in M's cache for everyone else; only the clone is
  // ours, so dispose() frees the clone and M.disposeAll() frees the original.
  function ownToon(hex, o) {
    const m = M.toon(hex, o).clone();
    ownedMats.push(m);
    return m;
  }

  const matFrame = M.toon(C_REDORANGE);
  const matCream = M.toon(C_CREAM);
  // 辐条 + 高速模糊盘独占材质：10 根辐条在 60fps、30m/s 下每帧转 ~80°，
  // 会出现「倒转轮」频闪。超过阈值就把辐条淡出、换成半透明圆盘，
  // 眼睛读到的是转动模糊而不是错误方向的离散帧。
  const matSpoke = ownToon(C_CREAM, { transparent: true, opacity: 1, depthWrite: false });
  const matBlurDisc = ownToon(C_CREAM, { transparent: true, opacity: 0, depthWrite: false });
  const matInk = M.toon(C_INK);
  const matTunic = M.toon(C_TUNIC);
  const matAmber = M.toon(C_AMBER);
  const matMagenta = M.toon(C_MAGENTA);
  const matChestnut = M.toon(C_CHESTNUT);
  const matChestnutDark = M.toon(0x8f5a30);
  const matMane = M.toon(C_MANE);
  const matSaddle = M.toon(C_SADDLETEAL);
  const matBlue = M.toon(C_DEEPBLUE);
  const matBoot = M.toon(C_BOOT);
  const matCape = M.toon(C_CAPE, { side: THREE.DoubleSide });
  const matScarf = M.toon(C_SCARF, { side: THREE.DoubleSide });
  const matLens = M.toon(0x20303a);   // 护目镜深色镜片（参考图的风镜）

  // Board owns its own glow materials so pulsing never mutates shared M mats.
  const matBoardStrip = ownGlow(C_CYAN, 2.6);
  const matBoardThrL = ownGlow(C_CYAN, 2.6);
  const matBoardThrR = ownGlow(C_CYAN, 2.6);
  const matBoardNose = ownGlow(C_MAGENTA, 2.2);
  const glowStripBase = matBoardStrip.color.clone();
  const glowThrBase = matBoardThrL.color.clone();
  const glowNoseBase = matBoardNose.color.clone();

  /* ======================= tiny build helpers ======================= */
  function mk(geo, mat, parent, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = false;
    if (x !== undefined) m.position.set(x, y, z);
    if (parent) parent.add(m);
    return m;
  }

  function mkGlow(geo, mat, parent, x, y, z) {
    const m = mk(geo, mat, parent, x, y, z);
    m.castShadow = false;
    return m;
  }

  // Outline only readable silhouettes; never tiny parts. Outline children are
  // the only Mesh children a Mesh ever gets in this rig, so this is unambiguous.
  function ink(m, thickness) {
    M.outline(m, thickness);
    for (let i = 0; i < m.children.length; i++) {
      m.children[i].castShadow = false;
      m.children[i].receiveShadow = false;
    }
    return m;
  }

  function joint(parent, x, y, z) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  }

  // Cylinder stretched between two points (build-time only allocations).
  function tube(parent, ax, ay, az, bx, by, bz, r, mat, seg) {
    _dir.set(bx - ax, by - ay, bz - az);
    const len = _dir.length() || 0.001;
    const g = new THREE.CylinderGeometry(r, r, len, seg || 7);
    const m = mk(g, mat, parent, (ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    m.quaternion.setFromUnitVectors(_up, _dir.divideScalar(len));
    return m;
  }

  // Merge helper: normalise to non-indexed so any M.mergeGeos impl works,
  // then free the intermediates immediately (they never enter the scene).
  function mergeParts(geos) {
    const flat = [];
    for (let i = 0; i < geos.length; i++) {
      const g = geos[i];
      if (g.index) {
        const n = g.toNonIndexed();
        g.dispose();
        flat.push(n);
      } else {
        flat.push(g);
      }
    }
    const out = M.mergeGeos(flat);
    for (let i = 0; i < flat.length; i++) flat[i].dispose();
    return out;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a || 1e-6), 0, 1); return t * t * (3 - 2 * t); }

  /* Two-bone IK in the sagittal (YZ) plane. Limbs rest pointing -Y, so a
   * POSITIVE rotation.x swings a limb FORWARD (-Z). `sign` = +1 places the
   * middle joint forward (knee), -1 places it backward (elbow).
   * Writes [rootAngle, midAngle] into the shared _ik array. Zero allocation. */
  function ik2(dy, dz, l1, l2, sign) {
    let d = Math.sqrt(dy * dy + dz * dz);
    const maxD = (l1 + l2) * 0.998;
    const minD = Math.abs(l1 - l2) + 0.03;
    if (d > maxD) d = maxD; else if (d < minD) d = minD;
    const base = Math.atan2(-dz, -dy);
    const ca = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const ck = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);
    _ik[0] = base + sign * Math.acos(ca);
    _ik[1] = -sign * (PI - Math.acos(ck));
  }

  /* ======================= root ======================= */
  const root = new THREE.Group();
  root.name = 'vehiclesRoot';

  const bikeGroup = new THREE.Group(); bikeGroup.name = 'bike';
  const horseGroup = new THREE.Group(); horseGroup.name = 'horse';
  const boardGroup = new THREE.Group(); boardGroup.name = 'board';
  const riderGroup = new THREE.Group(); riderGroup.name = 'rider';
  root.add(bikeGroup, horseGroup, boardGroup, riderGroup);
  // YXZ so trick yaw / pitch / roll compose readably.
  bikeGroup.rotation.order = 'YXZ';
  horseGroup.rotation.order = 'YXZ';
  boardGroup.rotation.order = 'YXZ';
  riderGroup.rotation.order = 'YXZ';

  /* =====================================================================
   * 1. BIKE — balanced. Wheel radius 0.42 (outer), tyre tube 0.075.
   * =================================================================== */
  const WHEEL_R = 0.42;
  const TYRE_TUBE = 0.075;
  const TORUS_R = WHEEL_R - TYRE_TUBE;   // outer radius == WHEEL_R -> touches y=0
  const RIM_R = 0.30;
  const AXLE_Z = 0.60;
  const BB_Y = 0.38, BB_Z = 0.06;
  const CRANK_R = 0.14;
  const BAR_Y = 1.06, BAR_Z = -0.32, BAR_HALF = 0.28;

  function buildWheel(parent, z) {
    const w = new THREE.Group();
    w.position.set(0, WHEEL_R, z);
    parent.add(w);

    // Everything authored in the XY plane, then baked to YZ (axle along X).
    const tyreG = new THREE.TorusGeometry(TORUS_R, TYRE_TUBE, 12, 40);
    tyreG.rotateY(PI * 0.5);
    ink(mk(tyreG, matInk, w), 0.03);

    const rimG = new THREE.TorusGeometry(RIM_R, 0.024, 8, 36);
    rimG.rotateY(PI * 0.5);
    mk(rimG, matCream, w);

    const hubG = new THREE.CylinderGeometry(0.05, 0.05, 0.11, 12);
    hubG.rotateZ(PI * 0.5);
    mk(hubG, matAmber, w);

    // 10 spokes merged ONCE into a single mesh that spins with the wheel.
    const spokes = [];
    for (let i = 0; i < 10; i++) {
      const g = new THREE.CylinderGeometry(0.011, 0.011, RIM_R - 0.045, 4);
      g.translate(0, (RIM_R + 0.045) * 0.5, 0);
      g.rotateZ((i / 10) * TAU);
      spokes.push(g);
    }
    const spokeG = mergeParts(spokes);
    spokeG.rotateY(PI * 0.5);
    const spokeM = mk(spokeG, matSpoke, w);
    spokeM.castShadow = false; // too thin to matter
    spokeM.renderOrder = 1;

    // 高速替身：一张淡奶白圆盘。低速完全透明，高速接过来当运动模糊。
    const discG = new THREE.CircleGeometry(RIM_R - 0.012, 28);
    discG.rotateY(PI * 0.5);
    const disc = mk(discG, matBlurDisc, w);
    disc.castShadow = false;
    disc.renderOrder = 1;
    return w;
  }

  const wheelRear = buildWheel(bikeGroup, AXLE_Z);
  const wheelFront = buildWheel(bikeGroup, -AXLE_Z);

  // Double-triangle frame.
  const SEAT_Y = 0.86, SEAT_Z = 0.30;
  const HEAD_Y = 0.94, HEAD_Z = -0.36;
  const CROWN_Y = 0.70, CROWN_Z = -0.48;
  tube(bikeGroup, 0, SEAT_Y, SEAT_Z, 0, HEAD_Y, HEAD_Z, 0.032, matFrame);        // top tube
  tube(bikeGroup, 0, BB_Y, BB_Z, 0, CROWN_Y, CROWN_Z, 0.038, matFrame);          // down tube
  tube(bikeGroup, 0, BB_Y, BB_Z, 0, SEAT_Y, SEAT_Z, 0.034, matFrame);            // seat tube
  tube(bikeGroup, 0, CROWN_Y, CROWN_Z, 0, HEAD_Y, HEAD_Z, 0.045, matCream);      // head tube
  for (let s = -1; s <= 1; s += 2) {
    tube(bikeGroup, s * 0.055, BB_Y, BB_Z, s * 0.05, WHEEL_R, AXLE_Z, 0.021, matFrame);   // chain stay
    tube(bikeGroup, s * 0.05, SEAT_Y, SEAT_Z, s * 0.05, WHEEL_R, AXLE_Z, 0.018, matCream); // seat stay
  }

  // Fork + cockpit (this whole group compresses on landImpact).
  const forkGroup = new THREE.Group();
  bikeGroup.add(forkGroup);
  const crownG = new THREE.BoxGeometry(0.17, 0.06, 0.10);
  mk(crownG, matCream, forkGroup, 0, CROWN_Y, CROWN_Z);
  for (let s = -1; s <= 1; s += 2) {
    tube(forkGroup, s * 0.062, CROWN_Y - 0.02, CROWN_Z, s * 0.062, WHEEL_R + 0.03, -AXLE_Z + 0.008, 0.026, matFrame);
  }
  tube(forkGroup, 0, CROWN_Y, CROWN_Z, 0, HEAD_Y + 0.02, HEAD_Z, 0.028, matInk);  // steerer
  tube(forkGroup, 0, HEAD_Y + 0.02, HEAD_Z, 0, BAR_Y, BAR_Z, 0.030, matInk);      // stem
  const barG = new THREE.CylinderGeometry(0.022, 0.022, BAR_HALF * 2, 8);
  barG.rotateZ(PI * 0.5);
  mk(barG, matCream, forkGroup, 0, BAR_Y, BAR_Z);
  for (let s = -1; s <= 1; s += 2) {
    const gG = new THREE.CylinderGeometry(0.032, 0.032, 0.11, 8);
    gG.rotateZ(PI * 0.5);
    mk(gG, matMagenta, forkGroup, s * (BAR_HALF - 0.055), BAR_Y, BAR_Z);
  }

  // Saddle + post.
  tube(bikeGroup, 0, SEAT_Y, SEAT_Z, 0, SEAT_Y + 0.07, SEAT_Z + 0.01, 0.022, matInk);
  const saddleG = new THREE.SphereGeometry(1, 14, 9);
  const saddle = mk(saddleG, matInk, bikeGroup, 0, SEAT_Y + 0.09, SEAT_Z + 0.02);
  saddle.scale.set(0.085, 0.045, 0.19);
  ink(saddle, 0.02);

  // Crank: chainring + two arms 180 deg apart + two pedals (kept level).
  const crankGroup = new THREE.Group();
  crankGroup.position.set(0, BB_Y, BB_Z);
  bikeGroup.add(crankGroup);
  const ringG = new THREE.TorusGeometry(0.115, 0.012, 5, 20);
  ringG.rotateY(PI * 0.5);
  mk(ringG, matAmber, crankGroup, 0.045, 0, 0);
  const pedals = [];
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const armG = new THREE.BoxGeometry(0.026, CRANK_R + 0.03, 0.05);
    mk(armG, matCream, crankGroup, s * 0.075, s * CRANK_R * 0.5, 0);
    const pArm = joint(crankGroup, s * 0.075, s * CRANK_R, 0);
    const pG = new THREE.BoxGeometry(0.085, 0.022, 0.13);
    mk(pG, matInk, pArm, s * 0.03, 0, 0);
    pedals.push(pArm);
  }

  /* =====================================================================
   * 2. HORSE — technical. Chestnut, withers ~1.45, body length ~2.1.
   * =================================================================== */
  const H_BODY_Y = 1.02;
  const bodyG = new THREE.CapsuleGeometry(0.40, 1.25, 6, 16);
  bodyG.rotateX(PI * 0.5);
  const horseBody = mk(bodyG, matChestnut, horseGroup, 0, H_BODY_Y, 0);
  ink(horseBody, 0.035);

  const rumpG = new THREE.SphereGeometry(1, 16, 11);
  const rump = mk(rumpG, matChestnut, horseGroup, 0, H_BODY_Y + 0.03, 0.72);
  rump.scale.set(0.40, 0.40, 0.36);

  // Angled neck + tapered head.
  const neckGroup = joint(horseGroup, 0, 1.28, -0.66);
  const neckG = new THREE.CylinderGeometry(0.17, 0.25, 0.62, 12);
  const neck = mk(neckG, matChestnut, neckGroup, 0, 0.24, -0.20);
  neck.rotation.x = -0.62;
  ink(neck, 0.032);

  const headGroup = joint(neckGroup, 0, 0.50, -0.42);
  const headG = new THREE.CylinderGeometry(0.115, 0.175, 0.50, 10);
  headG.rotateX(PI * 0.5);
  const horseHead = mk(headG, matChestnut, headGroup, 0, -0.02, -0.16);
  horseHead.rotation.x = 0.42;
  ink(horseHead, 0.028);
  const muzzleG = new THREE.SphereGeometry(1, 12, 9);
  const muzzle = mk(muzzleG, matChestnutDark, headGroup, 0, -0.14, -0.40);
  muzzle.scale.set(0.115, 0.10, 0.12);
  for (let s = -1; s <= 1; s += 2) {
    const earG = new THREE.ConeGeometry(0.055, 0.15, 7);
    const ear = mk(earG, matChestnut, headGroup, s * 0.095, 0.16, 0.02);
    ear.rotation.set(-0.2, 0, s * 0.22);
    const eyeG = new THREE.SphereGeometry(0.033, 9, 7);
    const eye = mk(eyeG, matInk, headGroup, s * 0.125, 0.02, -0.14);
    eye.castShadow = false;
  }

  // Dark mane: row of small tapered boxes along the neck's crest.
  const maneParts = [];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const g = new THREE.BoxGeometry(0.075, 0.20 - t * 0.06, 0.13);
    g.translate(0, 0.10, 0);
    const o = joint(neckGroup, 0, 0.10 + t * 0.44, -0.03 - t * 0.38);
    const m = mk(g, matMane, o, 0, 0, 0);
    m.rotation.x = -0.55;
    maneParts.push(m);
  }

  // Segmented tail (3 chained segments).
  const tailSegs = [];
  let tailParent = joint(horseGroup, 0, 1.24, 0.98);
  for (let i = 0; i < 3; i++) {
    const r = 0.085 - i * 0.022;
    const g = new THREE.CylinderGeometry(r * 0.75, r, 0.30, 8);
    mk(g, matMane, tailParent, 0, -0.15, 0);
    tailSegs.push(tailParent);
    tailParent = joint(tailParent, 0, -0.30, 0);
  }

  // Tack: teal saddle over a cream blanket, girth, bit, reins.
  const blanketG = new THREE.BoxGeometry(0.74, 0.055, 0.88);
  mk(blanketG, matCream, horseGroup, 0, 1.36, 0.04);
  const hSaddleG = new THREE.SphereGeometry(1, 14, 10);
  const hSaddle = mk(hSaddleG, matSaddle, horseGroup, 0, 1.42, 0.02);
  hSaddle.scale.set(0.28, 0.10, 0.34);
  ink(hSaddle, 0.025);
  const girthG = new THREE.TorusGeometry(0.40, 0.028, 5, 18);
  girthG.rotateY(PI * 0.5);
  mk(girthG, matSaddle, horseGroup, 0, H_BODY_Y, 0.02);
  const bitG = new THREE.CylinderGeometry(0.022, 0.022, 0.24, 7);
  bitG.rotateZ(PI * 0.5);
  mk(bitG, matAmber, headGroup, 0, -0.13, -0.36);
  // Reins run from the bit back to where the rider's hands sit.
  for (let s = -1; s <= 1; s += 2) {
    tube(horseGroup, s * 0.10, 1.60, -1.44, s * 0.20, 1.62, -0.36, 0.014, matMane, 5);
  }

  // Four legs: upper + lower + hoof on a joint chain.
  const H_UPPER = 0.46, H_LOWER = 0.42;
  const horseLegs = [];
  const hoofs = [];
  const legFront = [0, 0, 1, 1];
  const legPhase = [0.0, 0.15, 0.50, 0.65]; // four-beat gallop offsets
  for (let i = 0; i < 4; i++) {
    const front = legFront[i] === 1;
    const sx = (i % 2 === 0) ? 1 : -1;
    const hip = joint(horseGroup, sx * 0.23, 0.98, front ? -0.60 : 0.62);
    const upG = new THREE.CylinderGeometry(0.085, 0.13, H_UPPER, 9);
    ink(mk(upG, matChestnut, hip, 0, -H_UPPER * 0.5, 0), 0.026);
    const knee = joint(hip, 0, -H_UPPER, 0);
    const loG = new THREE.CylinderGeometry(0.055, 0.075, H_LOWER, 8);
    mk(loG, matChestnutDark, knee, 0, -H_LOWER * 0.5, 0);
    const ankle = joint(knee, 0, -H_LOWER, 0);
    const hoofG = new THREE.CylinderGeometry(0.075, 0.085, 0.10, 12);
    const hoof = mk(hoofG, matInk, ankle, 0, -0.05, 0);
    hoof.name = 'hoof' + i;
    hoofs.push(hoof);
    horseLegs.push(hip, knee, ankle); // flat: [hip0,knee0,ankle0, hip1,...]
  }

  /* =====================================================================
   * 3. HOVERBOARD — speed. Deck 2.4 x 0.72, hovers 0.55.
   * =================================================================== */
  const HOVER_Y = 0.55;
  const DECK_LEN = 2.4, DECK_W = 0.72, DECK_BOX_LEN = 1.70, CAP_R = 0.35;
  const deckG = new THREE.BoxGeometry(DECK_W, 0.09, DECK_BOX_LEN);
  const deck = mk(deckG, matBlue, boardGroup, 0, 0, 0);
  ink(deck, 0.03);
  const capG = new THREE.SphereGeometry(1, 16, 10);
  const noseCap = mk(capG, matBlue, boardGroup, 0, 0, -DECK_BOX_LEN * 0.5);
  noseCap.scale.set(DECK_W * 0.5, 0.045, CAP_R);
  const tailCap = mk(capG, matBlue, boardGroup, 0, 0, DECK_BOX_LEN * 0.5);
  tailCap.scale.set(DECK_W * 0.5, 0.045, CAP_R);
  for (let s = -1; s <= 1; s += 2) {
    const railG = new THREE.BoxGeometry(0.05, 0.055, DECK_BOX_LEN + 0.10);
    mk(railG, matMagenta, boardGroup, s * (DECK_W * 0.5 - 0.022), 0.018, 0);
    const padG = new THREE.BoxGeometry(0.46, 0.022, 0.40);
    mk(padG, matCream, boardGroup, 0, 0.055, s * 0.34);
    const finG = new THREE.BoxGeometry(0.035, 0.16, 0.34);
    const fin = mk(finG, matMagenta, boardGroup, s * (DECK_W * 0.5 + 0.03), -0.03, 0.52);
    fin.rotation.set(0, 0, s * 0.30);
    const nozG = new THREE.CylinderGeometry(0.10, 0.125, 0.24, 12);
    nozG.rotateX(PI * 0.5);
    mk(nozG, matBlue, boardGroup, s * 0.21, -0.01, DECK_LEN * 0.5 - 0.24);
  }
  const stripG = new THREE.BoxGeometry(0.44, 0.022, 1.90);
  const glowStrip = mkGlow(stripG, matBoardStrip, boardGroup, 0, -0.056, 0);
  const thrDiscs = [];
  const thrMats = [matBoardThrL, matBoardThrR];
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const dG = new THREE.CircleGeometry(0.098, 18);
    thrDiscs.push(mkGlow(dG, thrMats[i], boardGroup, s * 0.21, -0.01, DECK_LEN * 0.5 - 0.11));
  }
  const noseGlowG = new THREE.BoxGeometry(0.30, 0.020, 0.09);
  const noseGlow = mkGlow(noseGlowG, matBoardNose, boardGroup, 0, 0.03, -DECK_BOX_LEN * 0.5 - 0.20);

  // World-space trail anchor at the rear underside.
  const boardRearAnchor = new THREE.Object3D();
  boardRearAnchor.name = 'boardRearAnchor';
  boardRearAnchor.position.set(0, -0.07, DECK_LEN * 0.5 - 0.05);
  boardGroup.add(boardRearAnchor);

  /* =====================================================================
   * 4. RIDER — one shared rig, re-posed per vehicle (~1.7 m tall).
   * =================================================================== */
  const R_THIGH = 0.40, R_SHIN = 0.38;
  const R_UPPER = 0.27, R_FORE = 0.25;
  const SHO_X = 0.20, SHO_Y = 0.42;   // shoulder position in torso space
  const HIP_X = 0.11, HIP_Y = -0.02;

  const rig = new THREE.Group();            // pose root (hips)
  riderGroup.add(rig);

  const pelvisG = new THREE.BoxGeometry(0.26, 0.16, 0.20);
  mk(pelvisG, matCream, rig, 0, -0.02, 0);

  const torso = joint(rig, 0, 0.02, 0);
  // 圆润胸廓：上宽下窄，10 段圆周（原来 4 段是个菱形盒子），前后略扁。
  const torsoG = new THREE.CylinderGeometry(0.185, 0.145, 0.48, 10);
  const torsoMesh = mk(torsoG, matTunic, torso, 0, 0.24, 0);
  torsoMesh.scale.set(1, 1, 0.72);
  ink(torsoMesh, 0.028);
  // 腰带：旅人装束的层次感。
  const beltG = new THREE.TorusGeometry(0.15, 0.026, 6, 18);
  beltG.rotateX(PI * 0.5);
  const belt = mk(beltG, matBoot, torso, 0, 0.055, 0);
  belt.scale.set(1, 1, 0.72);
  const buckleG = new THREE.BoxGeometry(0.05, 0.045, 0.03);
  mk(buckleG, matAmber, torso, 0, 0.055, -0.115);

  const neckJ = joint(torso, 0, 0.50, 0);
  const neckRG = new THREE.CylinderGeometry(0.055, 0.065, 0.07, 8);
  mk(neckRG, matCream, neckJ, 0, 0.02, 0);
  const riderHead = joint(neckJ, 0, 0.12, 0);
  const headRG = new THREE.SphereGeometry(0.15, 16, 12);
  ink(mk(headRG, matCream, riderHead, 0, 0, 0), 0.026);
  const helmetG = new THREE.SphereGeometry(0.176, 18, 12, 0, TAU, 0, PI * 0.62);
  const helmet = mk(helmetG, matTunic, riderHead, 0, 0.005, 0.008);
  ink(helmet, 0.026);
  const visorG = new THREE.BoxGeometry(0.27, 0.055, 0.05);
  mk(visorG, matLens, riderHead, 0, 0.015, -0.145);
  // 头盔下的发束 + 护目镜带：头部不再是光球，多了旅人的轮廓细节。
  const hairG = new THREE.SphereGeometry(0.10, 12, 10);
  const hair = mk(hairG, matMane, riderHead, 0, -0.055, 0.10);
  hair.scale.set(1.15, 0.72, 0.95);
  const goggleG = new THREE.TorusGeometry(0.158, 0.018, 6, 22);
  goggleG.rotateX(PI * 0.5);
  mk(goggleG, matInk, riderHead, 0, 0.05, 0.006);

  // Arms: shoulder -> elbow -> wrist chains.
  const armJ = [];
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const sho = joint(torso, s * SHO_X, SHO_Y, 0);
    // 肩甲：坐在肩关节枢轴上，抬臂时几乎不动，读作护肩。
    const padG = new THREE.SphereGeometry(0.085, 12, 10);
    const pad = mk(padG, matTunic, sho, 0, 0.015, 0);
    pad.scale.set(1, 0.82, 1);
    ink(pad, 0.02);
    const upG = new THREE.CylinderGeometry(0.052, 0.062, R_UPPER, 10);
    ink(mk(upG, matTunic, sho, 0, -R_UPPER * 0.5, 0), 0.022);
    const elb = joint(sho, 0, -R_UPPER, 0);
    mk(new THREE.SphereGeometry(0.05, 10, 8), matTunic, elb, 0, 0, 0);   // 肘垫
    const foG = new THREE.CylinderGeometry(0.045, 0.052, R_FORE, 10);
    mk(foG, matCream, elb, 0, -R_FORE * 0.5, 0);
    const wri = joint(elb, 0, -R_FORE, 0);
    mk(new THREE.CylinderGeometry(0.053, 0.053, 0.05, 10), matBoot, wri, 0, -0.005, 0);  // 护腕
    const handG = new THREE.SphereGeometry(0.06, 12, 10);
    mk(handG, matBoot, wri, 0, -0.045, 0);                              // 手套
    armJ.push(sho, elb, wri);
  }

  // Legs: hip -> knee -> ankle chains.
  const legJ = [];
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const hip = joint(rig, s * HIP_X, HIP_Y, 0);
    const thG = new THREE.CylinderGeometry(0.072, 0.088, R_THIGH, 10);
    ink(mk(thG, matCream, hip, 0, -R_THIGH * 0.5, 0), 0.024);
    const kne = joint(hip, 0, -R_THIGH, 0);
    const kneePadG = new THREE.SphereGeometry(0.062, 12, 10);
    const kneePad = mk(kneePadG, matTunic, kne, 0, 0, -0.012);
    kneePad.scale.set(1, 0.9, 1.12);
    ink(kneePad, 0.018);
    const shG = new THREE.CylinderGeometry(0.058, 0.070, R_SHIN, 10);
    ink(mk(shG, matCream, kne, 0, -R_SHIN * 0.5, 0), 0.022);
    const ank = joint(kne, 0, -R_SHIN, 0);
    mk(new THREE.CylinderGeometry(0.073, 0.073, 0.06, 10), matBoot, ank, 0, 0.0, 0);   // 靴口
    const bootG = new THREE.BoxGeometry(0.115, 0.10, 0.24);
    ink(mk(bootG, matBoot, ank, 0, -0.05, -0.045), 0.022);
    mk(new THREE.BoxGeometry(0.125, 0.035, 0.27), matInk, ank, 0, -0.10, -0.05);       // 靴底
    legJ.push(hip, kne, ank);
  }

  // Cape: tapered short mantle, double-sided toon, vertex-animated.
  const capeJ = joint(torso, 0, 0.42, 0.11);
  const capeGeo = new THREE.PlaneGeometry(0.40, 0.60, 5, 6);
  capeGeo.translate(0, -0.30, 0);            // hang from the shoulders
  {
    const pa = capeGeo.attributes.position.array;
    for (let i = 0; i < pa.length; i += 3) {
      const t = Math.max(0, Math.min(1, -pa[i + 1] / 0.60));
      pa[i] *= 0.80 + t * 0.85;              // narrow at the neck, flared at the hem
      pa[i + 2] += 0.05 + t * t * 0.20;      // rests away from the back
    }
    capeGeo.computeVertexNormals();
  }
  const cape = mk(capeGeo, matCape, capeJ, 0, 0, 0);
  cape.frustumCulled = false;                // vertices move every frame
  const capePos = capeGeo.attributes.position;
  const capeNrm = capeGeo.attributes.normal;
  const capeArr = capePos.array;             // reused Float32Array
  const capeNrmArr = capeNrm.array;
  const capeBase = new Float32Array(capeArr);
  const capeIdx = capeGeo.index.array;
  const capeVertCount = capePos.count;
  const capeIdxCount = capeGeo.index.count;

  // Scarf: a wrapped collar + two wind-driven tails. The tails are ONE indexed
  // cloth mesh (two strips) so a single vertex pass + normal recompute drives
  // both. Warm red against the cool cape; streams backward as speed rises.
  const scarfJ = joint(torso, 0, 0.50, 0.02);
  const collarG = new THREE.TorusGeometry(0.082, 0.028, 8, 20);
  collarG.rotateX(PI * 0.5);
  ink(mk(collarG, matScarf, scarfJ, 0, 0, 0), 0.016);
  mk(new THREE.SphereGeometry(0.045, 10, 8), matScarf, scarfJ, 0.045, -0.02, 0.075);  // 结
  const SCARF_LEN = 0.38, SCARF_SX = 2, SCARF_SY = 6;
  const scarfGeo = new THREE.BufferGeometry();
  {
    const cols = SCARF_SX + 1, rowsN = SCARF_SY + 1, perTail = cols * rowsN;
    const verts = new Float32Array(perTail * 2 * 3);
    const norms = new Float32Array(perTail * 2 * 3);
    const idx = [];
    let vp = 0;
    for (let s = 0; s < 2; s++) {
      const cx = s === 0 ? -0.045 : 0.05;
      const base = s * perTail;
      for (let iy = 0; iy < rowsN; iy++) {
        const t = iy / SCARF_SY;
        const y = -t * SCARF_LEN;
        const w = 0.07 * (1 - t * 0.30);          // 末端略收
        const z = 0.06 + t * 0.26;                // 越过肩胛向后垂落
        for (let ix = 0; ix < cols; ix++) {
          verts[vp] = cx + (ix / SCARF_SX - 0.5) * w;
          verts[vp + 1] = y; verts[vp + 2] = z;
          norms[vp + 2] = 1; vp += 3;
        }
      }
      for (let iy = 0; iy < SCARF_SY; iy++) {
        for (let ix = 0; ix < SCARF_SX; ix++) {
          const a = base + iy * cols + ix, b = a + 1, c = a + cols, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
    }
    scarfGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    scarfGeo.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
    scarfGeo.setIndex(idx);
    scarfGeo.computeVertexNormals();
  }
  const scarfTails = mk(scarfGeo, matScarf, scarfJ, 0, 0, 0);
  scarfTails.castShadow = false;
  scarfTails.frustumCulled = false;
  const scarfPos = scarfGeo.attributes.position;
  const scarfNrm = scarfGeo.attributes.normal;
  const scarfArr = scarfPos.array;
  const scarfNrmArr = scarfNrm.array;
  const scarfBase = new Float32Array(scarfArr);
  const scarfIdx = scarfGeo.index.array;
  const scarfVertCount = scarfPos.count;
  const scarfIdxCount = scarfGeo.index.count;

  /* ======================= animation state (build-time) ======================= */
  let activeKey = 'bike';
  let wheelAngle = 0;
  let crankAngle = 0;
  let gaitPhase = 0;
  let impX = 0, impV = 0;      // landing suspension spring
  let capeFlare = 0;
  let hoverY = HOVER_Y;
  let switchT = 1;             // 0→1 pop on mid-run vehicle switch
  let spokeFade = 1;

  // Chassis attitude read back by the player so the contact-plane solver can
  // lift the rig by exactly the amount the wheels / hooves / deck would sink.
  const chassis = { y: 0, pitch: 0, yaw: 0, roll: 0, hoofProbe: false };
  // 底盘姿态的平滑状态：刹车点头、转向压弯、步态俯仰都经它缓动，
  // 倾角不会一帧掰到位。chY（悬挂起伏）不平滑，保留弹跳的鲜活感。
  const chS = { pitch: 0, yaw: 0, roll: 0 };
  // 每种载具的触地点（车体局部坐标，y=0 为设计接地面）与特技/摔车旋转枢轴。
  // 自行车取前后轮接地斑；马取四蹄（步态求解后再按最低蹄抬升）；滑板取板头板尾。
  const CONTACT = {
    bike: [[0, 0, -AXLE_Z], [0, 0, AXLE_Z]],
    horse: [[0.23, 0, -0.60], [-0.23, 0, -0.60], [0.23, 0, 0.62], [-0.23, 0, 0.62]],
    board: [[0.30, -0.05, -1.18], [-0.30, -0.05, -1.18], [0.30, -0.05, 1.18], [-0.30, -0.05, 1.18]]
  };
  const SPIN_PIVOT = { bike: 0.95, horse: 1.40, board: 1.05 };
  // 摔车翻滚时用来求「最低点」的车体+骑手包围盒（车体局部坐标）
  const TUMBLE_BOX = {
    bike: [-0.42, 0, -0.78, 0.42, 1.98, 0.78],
    horse: [-0.46, 0, -1.30, 0.46, 2.45, 1.10],
    board: [-0.44, -0.10, -1.20, 0.44, 1.95, 1.20]
  };

  // Reused pose descriptor — filled each frame, never reallocated.
  const pose = {
    rigY: 0, rigZ: 0,
    torsoX: 0, torsoY: 0, headX: 0,
    shLX: 0, shLZ: 0, elL: 0, shRX: 0, shRZ: 0, elR: 0,
    hipLX: 0, hipLZ: 0, kneeL: 0, ankL: 0,
    hipRX: 0, hipRZ: 0, kneeR: 0, ankR: 0,
    capeX: -0.25
  };

  const VEHICLES = {
    bike: { group: bikeGroup },
    horse: { group: horseGroup },
    board: { group: boardGroup }
  };

  function setActive(key) {
    if (key !== 'bike' && key !== 'horse' && key !== 'board') return;
    if (key !== activeKey) switchT = 0;
    activeKey = key;
    bikeGroup.visible = key === 'bike';
    horseGroup.visible = key === 'horse';
    boardGroup.visible = key === 'board';
    riderGroup.visible = true;
    if (key === 'bike') { pose.rigY = 1.13; pose.rigZ = 0.26; }
    else if (key === 'horse') { pose.rigY = 1.69; pose.rigZ = 0.06; }
    else { pose.rigY = 0.045 + 0.66; pose.rigZ = 0; }
    rig.position.set(0, pose.rigY, pose.rigZ);
  }

  /* ---------------------- per-vehicle pose solvers ---------------------- */
  // All scalar math; writes into the shared `pose` object and shared _ik.

  function poseBike(s, sp01, impact) {
    const lean = -0.50 - sp01 * 0.10 + impact * 0.22;
    // 坐垫顶面在 y≈0.995，骨盆底面在 rigY-0.10。基准留 1.5cm 余量，
    // 压缩量封到 0.055，落地缓冲全靠膝踝 IK 吸收，臀部不会插进坐垫。
    pose.rigY = 1.13 - Math.min(impact, 1) * 0.055;
    pose.rigZ = 0.26;
    pose.torsoX = lean;
    pose.torsoY = s.steer * 0.10;
    pose.headX = 0.42 + sp01 * 0.10;

    // Hands locked to the grips: solve in torso-local space (torso is X-only
    // here, so the inverse rotation is two scalar terms).
    const cl = Math.cos(lean), sl = Math.sin(lean);
    const py = BAR_Y - (pose.rigY + 0.02);
    const pz = BAR_Z - pose.rigZ;
    const ly = py * cl + pz * sl - SHO_Y;
    const lz = -py * sl + pz * cl;
    ik2(ly, lz, R_UPPER, R_FORE, -1);
    const pull = s.brake ? 0.10 : 0;
    pose.shLX = _ik[0]; pose.shRX = _ik[0];
    pose.elL = _ik[1] + pull; pose.elR = _ik[1] + pull;
    pose.shLZ = 0.16; pose.shRZ = -0.16;

    // Feet locked to the pedals (crank angle drives the whole cycle).
    for (let i = 0; i < 2; i++) {
      const a = crankAngle + (i === 0 ? 0 : PI);
      const ty = (BB_Y + CRANK_R * Math.cos(a)) - pose.rigY - HIP_Y;
      const tz = (BB_Z + CRANK_R * Math.sin(a)) - pose.rigZ;
      ik2(ty, tz, R_THIGH, R_SHIN, 1);
      const hx = _ik[0], kx = _ik[1];
      const ax = -(hx + kx) * 0.75;
      if (i === 0) { pose.hipLX = hx; pose.kneeL = kx; pose.ankL = ax; pose.hipLZ = 0.07; }
      else { pose.hipRX = hx; pose.kneeR = kx; pose.ankR = ax; pose.hipRZ = -0.07; }
    }
    pose.capeX = -0.28 - sp01 * 0.30;
  }

  function poseHorse(s, sp01, impact, gait) {
    const bob = Math.sin(gait * TAU * 2) * 0.035 * (0.35 + sp01);
    // 马鞍顶面 y≈1.52，骨盆底面 rigY-0.10：基准 1.69，压缩上限 0.05。
    pose.rigY = 1.69 + bob - Math.min(impact, 1) * 0.05;
    pose.rigZ = 0.06;
    pose.torsoX = -0.16 - sp01 * 0.14 + impact * 0.25;
    pose.torsoY = s.steer * 0.14;
    pose.headX = 0.14 + sp01 * 0.08;
    // Hands forward on the reins.
    pose.shLX = 1.02; pose.shLZ = 0.13; pose.elL = 0.62;
    pose.shRX = 1.02; pose.shRZ = -0.13; pose.elR = 0.62;
    if (s.brake) { pose.shLX = 0.80; pose.shRX = 0.80; pose.elL = 0.95; pose.elR = 0.95; pose.torsoX += 0.12; }
    // Legs bent, hugging the barrel.
    const hug = 0.62 + impact * 0.30;
    pose.hipLX = hug; pose.hipLZ = 0.22; pose.kneeL = -1.25 - impact * 0.25; pose.ankL = 0.38;
    pose.hipRX = hug; pose.hipRZ = -0.22; pose.kneeR = -1.25 - impact * 0.25; pose.ankR = 0.38;
    pose.capeX = -0.22 - sp01 * 0.34;
  }

  function poseBoard(s, sp01, impact) {
    // The rider carrier already carries the hover height, so these are LOCAL.
    const deckTop = 0.045;
    pose.rigY = deckTop + 0.66 - impact * 0.16 - sp01 * 0.05;
    pose.rigZ = 0.0;
    pose.torsoX = -0.30 - sp01 * 0.12 + impact * 0.28;
    pose.torsoY = 0.35 + s.steer * 0.16;      // sideways stance
    pose.headX = 0.24;
    // Arms out for balance.
    const spread = 1.20 + sp01 * 0.18 + Math.sin(s.time * 2.6) * 0.06;
    pose.shLX = -0.30; pose.shLZ = spread; pose.elL = 0.34;
    pose.shRX = -0.14; pose.shRZ = -spread; pose.elR = 0.30;
    // Feet planted on the deck pads, staggered stance, knees bent via IK.
    for (let i = 0; i < 2; i++) {
      const tz = (i === 0 ? -0.30 : 0.30);
      const ty = (deckTop + 0.10) - pose.rigY - HIP_Y;
      ik2(ty, tz, R_THIGH, R_SHIN, 1);
      const hx = _ik[0], kx = _ik[1];
      const ax = -(hx + kx) * 0.80;
      if (i === 0) { pose.hipLX = hx; pose.kneeL = kx; pose.ankL = ax; pose.hipLZ = 0.10; }
      else { pose.hipRX = hx; pose.kneeR = kx; pose.ankR = ax; pose.hipRZ = -0.10; }
    }
    pose.capeX = -0.30 - sp01 * 0.40;
  }

  /* ---------------------- cape vertex animation ---------------------- */
  // Reuses capeArr / capeNrmArr; normals recomputed with scalar math because
  // BufferGeometry.computeVertexNormals() allocates Vector3s in r160.
  function updateCape(time, sp01, flare, steer) {
    const amp = 0.030 + sp01 * 0.130 + flare * 0.10;
    const f = 5.0 + sp01 * 5.5;
    for (let i = 0; i < capeVertCount; i++) {
      const i3 = i * 3;
      const bx = capeBase[i3], by = capeBase[i3 + 1];
      const t = -by / 0.9;                     // 0 at shoulders, 1 at hem
      const t2 = t * t;
      const w = Math.sin(time * f + t * 4.2 + bx * 3.4);
      const w2 = Math.sin(time * f * 0.63 + t * 2.1 - bx * 2.2);
      capeArr[i3] = bx + w2 * amp * 0.45 * t - steer * 0.10 * t2;
      capeArr[i3 + 1] = by + flare * 0.26 * t2 + w * amp * 0.18 * t;
      capeArr[i3 + 2] = capeBase[i3 + 2] + w * amp * t + w2 * amp * 0.5 * t + flare * 0.62 * t2;
    }
    capePos.needsUpdate = true;

    for (let i = 0; i < capeNrmArr.length; i++) capeNrmArr[i] = 0;
    for (let k = 0; k < capeIdxCount; k += 3) {
      const a = capeIdx[k] * 3, b = capeIdx[k + 1] * 3, c = capeIdx[k + 2] * 3;
      const e1x = capeArr[b] - capeArr[a], e1y = capeArr[b + 1] - capeArr[a + 1], e1z = capeArr[b + 2] - capeArr[a + 2];
      const e2x = capeArr[c] - capeArr[a], e2y = capeArr[c + 1] - capeArr[a + 1], e2z = capeArr[c + 2] - capeArr[a + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      capeNrmArr[a] += nx; capeNrmArr[a + 1] += ny; capeNrmArr[a + 2] += nz;
      capeNrmArr[b] += nx; capeNrmArr[b + 1] += ny; capeNrmArr[b + 2] += nz;
      capeNrmArr[c] += nx; capeNrmArr[c + 1] += ny; capeNrmArr[c + 2] += nz;
    }
    for (let i = 0; i < capeVertCount; i++) {
      const i3 = i * 3;
      const nx = capeNrmArr[i3], ny = capeNrmArr[i3 + 1], nz = capeNrmArr[i3 + 2];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      capeNrmArr[i3] = nx / len; capeNrmArr[i3 + 1] = ny / len; capeNrmArr[i3 + 2] = nz / len;
    }
    capeNrm.needsUpdate = true;
  }

  /* ---------------------- scarf vertex animation ---------------------- */
  // Two tails in one mesh. Wind streams them backward + lifts them as speed
  // rises; a per-tail phase offset keeps them from moving in lockstep.
  function updateScarf(time, sp01, flare, steer) {
    const stream = 0.12 + sp01 * 0.62 + flare * 0.55;
    const amp = 0.018 + sp01 * 0.085 + flare * 0.05;
    const f = 6.5 + sp01 * 7.5;
    for (let i = 0; i < scarfVertCount; i++) {
      const i3 = i * 3;
      const bx = scarfBase[i3], by = scarfBase[i3 + 1], bz = scarfBase[i3 + 2];
      const t = -by / SCARF_LEN;               // 0 at collar, 1 at tip
      const t2 = t * t;
      const side = bx < 0 ? -1 : 1;
      const w = Math.sin(time * f + t * 5.2 + side * 1.4);
      const w2 = Math.sin(time * f * 0.68 + t * 3.1 - side * 0.9);
      scarfArr[i3] = bx + w2 * amp * 0.7 * t - steer * 0.13 * t2;
      scarfArr[i3 + 1] = by + stream * 0.42 * t2 + w * amp * 0.35 * t;
      scarfArr[i3 + 2] = bz + stream * 0.95 * t2 + w * amp * t + w2 * amp * 0.5 * t;
    }
    scarfPos.needsUpdate = true;

    for (let i = 0; i < scarfNrmArr.length; i++) scarfNrmArr[i] = 0;
    for (let k = 0; k < scarfIdxCount; k += 3) {
      const a = scarfIdx[k] * 3, b = scarfIdx[k + 1] * 3, c = scarfIdx[k + 2] * 3;
      const e1x = scarfArr[b] - scarfArr[a], e1y = scarfArr[b + 1] - scarfArr[a + 1], e1z = scarfArr[b + 2] - scarfArr[a + 2];
      const e2x = scarfArr[c] - scarfArr[a], e2y = scarfArr[c + 1] - scarfArr[a + 1], e2z = scarfArr[c + 2] - scarfArr[a + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      scarfNrmArr[a] += nx; scarfNrmArr[a + 1] += ny; scarfNrmArr[a + 2] += nz;
      scarfNrmArr[b] += nx; scarfNrmArr[b + 1] += ny; scarfNrmArr[b + 2] += nz;
      scarfNrmArr[c] += nx; scarfNrmArr[c + 1] += ny; scarfNrmArr[c + 2] += nz;
    }
    for (let i = 0; i < scarfVertCount; i++) {
      const i3 = i * 3;
      const nx = scarfNrmArr[i3], ny = scarfNrmArr[i3 + 1], nz = scarfNrmArr[i3 + 2];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      scarfNrmArr[i3] = nx / len; scarfNrmArr[i3 + 1] = ny / len; scarfNrmArr[i3 + 2] = nz / len;
    }
    scarfNrm.needsUpdate = true;
  }

  /* ======================= update ======================= */
  function update(dt, s) {
    let h = dt > 0 ? dt : 0;
    if (h > 0.05) h = 0.05;                    // stability clamp on tab-refocus
    if (s.vehicle !== activeKey) setActive(s.vehicle);

    const time = s.time;
    const speed = s.speed;
    const sp01 = clamp(s.speed01, 0, 1);
    // maxSpeed is authoritative when provided; speed01 is the fallback.
    const norm = s.maxSpeed > 0.001 ? clamp(speed / s.maxSpeed, 0, 1) : sp01;
    const drive = norm > sp01 ? norm : sp01;
    const steer = clamp(s.steer, -1, 1);
    const crash = clamp(s.crashT, 0, 1);
    const calm = 1 - crash;
    const airT = s.airTime;
    const air = (s.airborne || !s.grounded) ? clamp(airT * 4 + 0.25, 0, 1) : 0;
    const impact = clamp(s.landImpact, 0, 1);
    const stamina = clamp(s.stamina01, 0, 1);
    const sprinting = s.sprint && stamina > 0.02;

    // Landing suspension spring (overshoot + rebound), driven by landImpact.
    impV += (impact - impX) * 95 * h;
    impV *= Math.exp(-10 * h);
    impX = clamp(impX + impV * h, -0.45, 1.45);
    impV = clamp(impV, -25, 25);
    const dip = impX > 0 ? impX : impX * 0.35;

    /* ---- shared chassis attitude (applied to vehicle + rider carrier) ---- */
    let chY = 0, chRoll = 0, chPitch = 0, chYaw = 0;

    if (activeKey === 'bike') {
      const skid = clamp(s.skid || 0, 0, 1);
      // 急刹时后轮抱死：转速被掐掉，车尾轻微外甩，刹车终于「看得见」
      wheelAngle -= (speed / WHEEL_R) * h * (1 - skid * 0.92);
      // 踏频封顶 ~1.5 转/秒：真实骑行也就这个数，而且 60fps 下每帧 ≤9°，
      // 不会出现曲柄倒转的频闪；速度感交给车轮模糊与粒子。
      const crankVel = Math.min(s.pedal ? speed * 0.55 : speed * 0.12, 9.4);
      crankAngle -= crankVel * h;
      wheelRear.rotation.x = wheelAngle;
      wheelFront.rotation.x = wheelAngle;
      crankGroup.rotation.x = crankAngle;
      pedals[0].rotation.x = -crankAngle;
      pedals[1].rotation.x = -crankAngle;
      forkGroup.position.y = -clamp(dip, 0, 1) * 0.09;

      // 辐条 → 模糊盘交叉淡入淡出（8~15 m/s）。抱死时轮子几乎不转，辐条回来。
      const spokeWant = 1 - sstep(8, 15, speed * (1 - skid * 0.92));
      spokeFade += (spokeWant - spokeFade) * clamp(h * 9, 0, 1);
      matSpoke.opacity = spokeFade;
      matSpoke.visible = spokeFade > 0.02;
      matBlurDisc.opacity = (1 - spokeFade) * 0.30;
      matBlurDisc.visible = matBlurDisc.opacity > 0.01;

      chRoll = 0.32 * steer * calm;
      // +rotation.x lifts the nose, so braking dives it and accel raises it.
      chPitch = (s.brake ? -0.075 - skid * 0.07 : 0.035 * drive) * calm - dip * 0.05;
      chYaw = -steer * skid * 0.20 * calm;
      chY = s.bob * 0.05;
      chassis.hoofProbe = false;
    } else if (activeKey === 'horse') {
      // 四拍疾驰，全速 ~2.2 Hz。两条约束让它读起来是「跑」而不是「摆腿」：
      // ① 支撑相用两段 IK 把蹄底钉在地面上匀速后掠 —— 脚不再滑步；
      // ② 摆动相的髋角在两端与支撑相的角速度对齐（三次 Hermite），
      //    收腿量用 sin(πu)，在接缝处值和导数都为 0 —— 膝盖不会啪一下弹开。
      const freq = (0.55 + drive * 1.65) * (sprinting ? 1.12 : 1);
      gaitPhase += freq * h;
      if (gaitPhase > 1) gaitPhase -= Math.floor(gaitPhase);
      const amp = (0.42 + drive * 0.40) * (sprinting ? 1.15 : 1) * (0.25 + 0.75 * clamp(speed * 0.5, 0, 1));
      const sw = 0.35 + drive * 0.65;
      const DUTY = 0.42;                        // 支撑相占空比
      const REACH = 0.17 + amp * 0.13;          // 触地/离地时蹄底的水平偏移（米）
      const FOOT_DY = -(0.98 - 0.10);           // 髋关节到蹄底的垂直距离
      const SWING_T = (1 - DUTY) / freq;        // 摆动相时长（秒）
      const stanceRate = 2 * REACH / DUTY;      // 支撑相蹄底速度（米 / 周期）
      const endRate = -stanceRate * SWING_T;    // 换算到摆动相 u 的导数

      for (let i = 0; i < 4; i++) {
        const hip = horseLegs[i * 3], knee = horseLegs[i * 3 + 1], ankle = horseLegs[i * 3 + 2];
        const p = (gaitPhase + legPhase[i]) % 1;
        const front = legFront[i] === 1;
        // 链沿局部 -Y。前腿膝关节朝后弯（sign=-1），后腿跗关节朝前弯（sign=+1），
        // 这才是马的解剖朝向；四拍步态里两者交替支撑。
        const sgn = front ? 1 : -1;
        const ikSign = front ? -1 : 1;
        const baseUp = front ? 0.06 : -0.06;
        let up, lo;
        if (p < DUTY) {
          const u = p / DUTY;
          // 蹄底沿地面由前向后匀速掠过：z 从 -REACH（前方）到 +REACH（后方），高度锁定
          ik2(FOOT_DY, -REACH * (1 - 2 * u), H_UPPER, H_LOWER, ikSign);
          up = _ik[0]; lo = _ik[1];
        } else {
          const u = (p - DUTY) / (1 - DUTY);
          const u2 = u * u, u3 = u2 * u;
          // 三次 Hermite 把蹄底 z 从 +REACH 送回 -REACH，两端导数与支撑相
          // 一致（endRate），所以接缝处速度连续，不会「顿一下」。
          const z0 = REACH, z1 = -REACH, r = endRate;
          const dz = z0 * (2 * u3 - 3 * u2 + 1) + r * (u3 - 2 * u2 + u)
            + z1 * (-2 * u3 + 3 * u2) + r * (u3 - u2);
          // 抬蹄高度 sin(πu)：两端为 0，离地/触地都是软的
          const fold = Math.sin(u * PI);
          ik2(FOOT_DY + (0.16 + amp * 0.26) * fold, dz, H_UPPER, H_LOWER, ikSign);
          up = _ik[0] + baseUp * fold;
          lo = _ik[1] - sgn * amp * 0.26 * fold;
        }
        if (air > 0) {
          // 腾空收腿：前腿前折、后腿后蹬
          const tu = front ? 1.15 : -0.95;
          const tl = front ? -2.00 : -0.30;
          up = lerp(up, tu, air);
          lo = lerp(lo, tl, air);
        }
        hip.rotation.x = up;
        hip.rotation.y = steer * (front ? 0.16 : 0.06) * calm;
        knee.rotation.x = lo;
        ankle.rotation.x = -(up + lo) * 0.45;
      }
      // 腾空时不做贴地抬升（收腿姿态本来就离地），由玩家的接地求解器接管
      chassis.hoofProbe = air < 0.5;

      const gallopBob = Math.sin(gaitPhase * TAU * 2) * 0.030 * sw;
      chY = gallopBob * calm + s.bob * 0.03;
      chPitch = (Math.sin(gaitPhase * TAU) * 0.045 * sw - (s.brake ? 0.06 : 0)) * calm;
      chRoll = 0.16 * steer * calm;
      chYaw = 0.10 * steer * calm;

      neckGroup.rotation.x = Math.sin(gaitPhase * TAU + 0.6) * 0.09 * sw - air * 0.20;
      neckGroup.rotation.y = steer * 0.22 * calm;
      headGroup.rotation.x = Math.sin(gaitPhase * TAU + 1.4) * 0.06 * sw + air * 0.15;

      // Mane + tail sway scales with speed01.
      const swayA = 0.06 + sp01 * 0.30 + air * 0.20;
      for (let i = 0; i < maneParts.length; i++) {
        maneParts[i].rotation.x = -0.55 + Math.sin(time * (6 + sp01 * 6) + i * 0.7) * swayA * 0.5;
        maneParts[i].rotation.z = Math.sin(time * 4.4 + i * 0.9) * swayA * 0.35;
      }
      for (let i = 0; i < tailSegs.length; i++) {
        const seg = tailSegs[i];
        const k = 0.5 + i * 0.45;
        seg.rotation.x = (i === 0 ? -0.55 : -0.18) - air * 0.30 + Math.sin(time * (3.4 + sp01 * 4.2) + i * 0.8) * swayA * 0.4 * k;
        seg.rotation.y = Math.sin(time * (2.6 + sp01 * 3.4) + i * 0.6) * swayA * k - steer * 0.18 * k;
        seg.rotation.z = Math.cos(time * 2.2 + i * 0.5) * swayA * 0.3 * k;
      }
    } else {
      // Hoverboard: hover + slow bob, bank up to 0.45 rad, small drift yaw.
      hoverY = HOVER_Y + Math.sin(time * 2.2) * 0.07 + s.bob * 0.05 - dip * 0.10;
      chY = hoverY;
      chRoll = 0.45 * steer * calm;
      chYaw = -0.13 * steer * calm + Math.sin(time * 1.3) * 0.02 * drive;
      chPitch = (-0.05 * drive + clamp(s.vy, -12, 12) * 0.012 * air) * calm;
      chassis.hoofProbe = false;

      // Glow pulse via board-owned cloned materials + mesh scale only.
      const pulse = 0.55 + drive * 0.95 + Math.sin(time * 14) * 0.09 * drive;
      const bright = 0.70 + pulse * 0.75;
      matBoardStrip.color.copy(glowStripBase).multiplyScalar(0.80 + pulse * 0.45);
      glowStrip.scale.set(1, 1, 0.94 + pulse * 0.06);
      for (let i = 0; i < 2; i++) {
        const d = thrDiscs[i];
        const jitter = i === 0 ? 1 : 0.94;
        d.scale.setScalar(0.80 + pulse * 0.55 * jitter);
        thrMats[i].color.copy(glowThrBase).multiplyScalar(bright * jitter);
      }
      matBoardNose.color.copy(glowNoseBase).multiplyScalar(0.85 + pulse * 0.35);
      noseGlow.scale.set(1, 1, 0.9 + pulse * 0.3);
    }

    // Airborne tricks are accumulated radians from the game and are applied by
    // the player's CoM spin group — NOT here, or they would be doubled and would
    // pivot at the contact patch instead of the centre of mass.
    if (air > 0 && activeKey !== 'board') {
      chPitch += clamp(s.vy, -14, 14) * 0.010 * air * calm;
    }

    // 切换载具的入场弹跳：0.86 → 1.04 → 1，0.26s，纯缩放不改逻辑尺寸。
    if (switchT < 1) {
      switchT = Math.min(1, switchT + h / 0.26);
      const k = switchT;
      const pop = k < 0.55
        ? lerp(0.86, 1.045, k / 0.55)
        : lerp(1.045, 1, (k - 0.55) / 0.45);
      root.scale.setScalar(pop);
    } else if (root.scale.x !== 1) root.scale.setScalar(1);

    const vg = VEHICLES[activeKey].group;
    // 姿态缓动：把本帧算出的俯仰/侧倾/偏航向目标收敛，刹车、压弯、步态
    // 的倾角都平缓过渡。chY 不平滑，悬挂弹跳保持鲜活。
    chS.pitch = damp(chS.pitch, chPitch, 9, h);
    chS.roll = damp(chS.roll, chRoll, 9, h);
    chS.yaw = damp(chS.yaw, chYaw, 10, h);
    vg.position.y = chY;
    vg.rotation.set(chS.pitch, chS.yaw, chS.roll);
    // Rider carrier mirrors the chassis so the rider stays attached.
    riderGroup.position.y = chY;
    riderGroup.rotation.set(chS.pitch, chS.yaw, chS.roll);
    // 底盘姿态单独发布给玩家：接地抬升由玩家的求解器统一施加给整个 rig，
    // 这样骑手和载具一起抬，不会各自为政。
    chassis.y = chY; chassis.pitch = chS.pitch; chassis.yaw = chS.yaw; chassis.roll = chS.roll;

    /* ---------------------------- rider pose ---------------------------- */
    if (activeKey === 'bike') poseBike(s, sp01, dip);
    else if (activeKey === 'horse') poseHorse(s, sp01, dip, gaitPhase);
    else poseBoard(s, sp01, dip);

    // Airborne override on any vehicle: tuck legs, arms out, cape flares.
    if (air > 0) {
      pose.hipLX = lerp(pose.hipLX, 1.15, air);
      pose.hipRX = lerp(pose.hipRX, 1.05, air);
      pose.kneeL = lerp(pose.kneeL, -1.75, air);
      pose.kneeR = lerp(pose.kneeR, -1.65, air);
      pose.ankL = lerp(pose.ankL, 0.45, air);
      pose.ankR = lerp(pose.ankR, 0.45, air);
      pose.shLX = lerp(pose.shLX, -0.55, air);
      pose.shRX = lerp(pose.shRX, -0.55, air);
      pose.shLZ = lerp(pose.shLZ, 1.35, air);
      pose.shRZ = lerp(pose.shRZ, -1.35, air);
      pose.elL = lerp(pose.elL, 0.40, air);
      pose.elR = lerp(pose.elR, 0.40, air);
      pose.torsoX = lerp(pose.torsoX, -0.15, air * 0.6);
    }

    // Landing compression: knees + torso sink, then the spring rebounds.
    if (dip > 0.001) {
      pose.kneeL -= dip * 0.30; pose.kneeR -= dip * 0.30;
      pose.hipLX += dip * 0.22; pose.hipRX += dip * 0.22;
    }

    rig.position.set(0, pose.rigY, pose.rigZ);

    // Crash flail: limbs only. The game owns the outer rig transform.
    const flail = crash;
    const j1 = Math.sin(time * 21.0) * flail;
    const j2 = Math.sin(time * 17.3 + 1.1) * flail;
    const inv = 1 - flail;

    torso.rotation.x = pose.torsoX * inv + (-0.30 + j1 * 0.22) * flail;
    torso.rotation.y = pose.torsoY * inv + j2 * 0.30 * flail;
    torso.rotation.z = j1 * 0.25 * flail;
    riderHead.rotation.x = pose.headX * inv + (-0.45 + j2 * 0.25) * flail;
    riderHead.rotation.z = j2 * 0.30 * flail;

    armJ[0].rotation.x = pose.shLX * inv + (-2.30 + j1 * 0.45) * flail;
    armJ[0].rotation.z = pose.shLZ * inv + (1.15 + j2 * 0.35) * flail;
    armJ[1].rotation.x = pose.elL * inv + (0.55 + j2 * 0.55) * flail;
    armJ[3].rotation.x = pose.shRX * inv + (-2.30 + j2 * 0.45) * flail;
    armJ[3].rotation.z = pose.shRZ * inv + (-1.15 - j1 * 0.35) * flail;
    armJ[4].rotation.x = pose.elR * inv + (0.55 + j1 * 0.55) * flail;

    legJ[0].rotation.x = pose.hipLX * inv + (0.95 + j1 * 0.50) * flail;
    legJ[0].rotation.z = pose.hipLZ * inv + (0.70 + j2 * 0.25) * flail;
    legJ[1].rotation.x = pose.kneeL * inv + (-0.55 + j2 * 0.45) * flail;
    legJ[2].rotation.x = pose.ankL * inv + j1 * 0.30 * flail;
    legJ[3].rotation.x = pose.hipRX * inv + (-0.75 + j2 * 0.50) * flail;
    legJ[3].rotation.z = pose.hipRZ * inv + (-0.70 - j1 * 0.25) * flail;
    legJ[4].rotation.x = pose.kneeR * inv + (-0.45 + j1 * 0.45) * flail;
    legJ[5].rotation.x = pose.ankR * inv + j2 * 0.30 * flail;

    // Cape: flare ramps in while airborne, relaxes on the ground.
    const flareTarget = air * 0.9 + drive * 0.15 + flail * 0.5;
    capeFlare += (flareTarget - capeFlare) * clamp(h * 7, 0, 1);
    capeJ.rotation.x = pose.capeX - capeFlare * 0.55;
    capeJ.rotation.z = -steer * 0.18 * calm;
    updateCape(time, drive, capeFlare, steer);

    // Scarf: collar stays at the neck; tails stream in the wind. Sways with steer.
    scarfJ.rotation.z = -steer * 0.14 * calm;
    updateScarf(time, drive, capeFlare, steer);
  }

  /* ======================= dispose ======================= */
  // Every geometry under root is ours (M.outline reuses the parent's geometry).
  // Shared cached toon/outline materials are left to M.disposeAll().
  function dispose() {
    const geos = new Set();
    root.traverse(function (o) { if (o.geometry) geos.add(o.geometry); });
    geos.forEach(function (g) { g.dispose(); });
    for (let i = 0; i < ownedMats.length; i++) ownedMats[i].dispose();
    root.clear();
  }

  /* ======================= init ======================= */
  setActive('bike');
  update(0, {
    vehicle: 'bike', speed: 0, maxSpeed: 24, speed01: 0, steer: 0,
    grounded: true, airborne: false, airTime: 0, vy: 0, pedal: 0, brake: 0,
    sprint: false, stamina01: 1, crashT: 0, landImpact: 0,
    trickPitch: 0, trickYaw: 0, time: 0, bob: 0
  });

  return {
    root: root,
    vehicles: VEHICLES,
    setActive: setActive,
    update: update,
    boardRearAnchor: boardRearAnchor,
    riderHead: riderHead,
    chassis: chassis,
    contact: CONTACT,
    hoofs: hoofs,
    spinPivot: SPIN_PIVOT,
    tumbleBox: TUMBLE_BOX,
    dispose: dispose
  };
}