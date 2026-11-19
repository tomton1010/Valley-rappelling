/* ============================================================================
 * 30 · 世界：地形函数 / 天空 / 云 / 远山 / 分块地形 / 植被 / 互动地形 / 小镇
 * ========================================================================== */

/* --------------------------- 地形解析函数 --------------------------- */
const DESCENT_STEP = 8;
let descentTable = null;
let descentSlope = null;

function buildDescentTable() {
  const n = Math.ceil((COURSE_LEN + 4000) / DESCENT_STEP) + 2;
  descentTable = new Float32Array(n);
  descentSlope = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const t = i * DESCENT_STEP;
    const grade = BASE_GRADE * (1 - 0.92 * sstep(COURSE_LEN - 340, COURSE_LEN + 40, t));
    descentSlope[i] = grade;
    acc += grade * DESCENT_STEP;
    descentTable[i] = acc;
  }
}
function descentAt(t) {
  if (t <= 0) return t * BASE_GRADE;
  const f = t / DESCENT_STEP, i = Math.floor(f);
  const last = descentTable.length - 1;
  if (i >= last) return descentTable[last] + (t - last * DESCENT_STEP) * BASE_GRADE * 0.08;
  // 单调三次 Hermite：用相邻网格的真实坡度做切线，段与段之间坡度连续，
  // 消除原来线性插值在 8m 网格处的「折角」，基础下坡读起来是一条顺滑曲线。
  const u = f - i, u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return h00 * descentTable[i] + h10 * DESCENT_STEP * descentSlope[i]
    + h01 * descentTable[i + 1] + h11 * DESCENT_STEP * descentSlope[i + 1];
}
/* 蜿蜒的 racing line 中心 */
function pathX(z) {
  const t = -z;
  const straight = 1 - sstep(COURSE_LEN - 430, COURSE_LEN - 130, t);
  return (Math.sin(z * 0.0018) * 34 + Math.sin(z * 0.00071) * 22) * straight;
}
function pathYaw(z) {
  const d = (pathX(z - 4) - pathX(z + 4)) / 8;   // dx/d(-z)
  return Math.atan2(-d, 1);
}
/* 溪流中心：与路线交织，形成浅滩渡口 */
function streamX(z) {
  const t = -z;
  const near = 1 - sstep(COURSE_LEN - 380, COURSE_LEN - 150, t);
  return pathX(z) + Math.sin(z * 0.0032 + 0.7) * 30 * near + 46 * (1 - near);
}
/* 泥地：按 70m 单元格确定性分布，物理与生成共用同一函数。
   mudPatch 每个区块要调用数千次，原来每次都新建对象 + 求 pathX（两次 sin）。
   单元格是纯函数且数量极少（全程约 123 个），缓存后热路径只剩几次乘加。 */
const MUD_CACHE = new Map();
function mudPatch(cell) {
  const hit = MUD_CACHE.get(cell);
  if (hit !== undefined) return hit;
  let out = null;
  if (cell >= 2) {
    const r1 = hash2(cell * 31 + 7, 13), r2 = hash2(cell * 17 + 5, 29), r3 = hash2(cell * 53 + 11, 71);
    if (r3 <= 0.44) {
      const z = -(cell * 70 + r2 * 58);
      out = { x: pathX(z) + (r1 - 0.5) * 52, z, r: 7.5 + r2 * 7 };
    }
  }
  MUD_CACHE.set(cell, out);
  return out;
}
function mudAt(x, z) {
  const cell = Math.floor(-z / 70);
  let best = 0;
  for (let k = cell - 1; k <= cell + 1; k++) {
    const p = mudPatch(k);
    if (!p) continue;
    const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz;
    if (d2 < p.r * p.r) { const v = 1 - Math.sqrt(d2) / p.r; if (v > best) best = v; }
  }
  return best;
}
const TOWN_Y = { v: 0 };
let computingTownY = false;
function townBlend(x, z) {
  return sstep(COURSE_LEN - 320, COURSE_LEN - 70, -z) * (1 - sstep(62, 132, Math.abs(x)));
}
/* 世界高度场（解析式）
   三处与原实现等价但更省的改写，因为细分提高后这是构建与物理的主要开销：
   ① 两个 fbm 的最低倍频共用同一个 2×2 值噪声格点，4 个格点只哈希一次；
   ② 悬崖带只在 11m 过渡区内才求值（原来每点算 3 条，其中 2 条恒为 0）；
   ③ 河道 / 镇口的 exp 在远处直接跳过。 */
function heightField(x, z) {
  const t = -z;
  let h = START_H - descentAt(t);
  const cx = pathX(z), d = x - cx, ad = Math.abs(d);
  const wall = Math.max(0, ad - 52);
  h += wall * wall * 0.0125;
  const calm = 1 - 0.66 * Math.exp(-(d * d) / 460);

  // --- 共用的最低倍频格点：A 在 (x*0.0055, z*0.0055)，B 在 (x*0.021+11.3, ...) ---
  const ax = x * 0.0055, az = z * 0.0055;
  const axi = Math.floor(ax), azi = Math.floor(az);
  const axf = ax - axi, azf = az - azi;
  const au = axf * axf * (3 - 2 * axf), av = azf * azf * (3 - 2 * azf);
  const a00 = hash2(axi, azi), a10 = hash2(axi + 1, azi);
  const a01 = hash2(axi, azi + 1), a11 = hash2(axi + 1, azi + 1);
  // 双线性插值：两个内层 lerp 都必须用 x 向分数 au，外层才用 z 向 av。
  // 之前误把第二个内层写成 av，导致最低倍频在 z 格线处不连续（高度突跳 ±6m），
  // 正是路面「锐利台阶」的根源。改回 au 后 nA0 与 vnoise 完全等价，整场 C1 连续。
  const nA0 = lerp(lerp(a00, a10, au), lerp(a01, a11, au), av) * 2 - 1;

  const bx = x * 0.021 + 11.3, bz = z * 0.021 - 4.7;
  const bxi = Math.floor(bx), bzi = Math.floor(bz);
  const bxf = bx - bxi, bzf = bz - bzi;
  const bu = bxf * bxf * (3 - 2 * bxf), bv = bzf * bzf * (3 - 2 * bzf);
  const b00 = hash2(bxi, bzi), b10 = hash2(bxi + 1, bzi);
  const b01 = hash2(bxi, bzi + 1), b11 = hash2(bxi + 1, bzi + 1);
  const nB0 = lerp(lerp(b00, b10, bu), lerp(b01, b11, bu), bv) * 2 - 1;

  // fbm 的归一化常数是固定的：oct=3 → 1.75，oct=2 → 1.5
  const fA = (nA0 + vnoise(ax * 2.03, az * 2.03) * 0.5
    + vnoise(ax * 4.1209, az * 4.1209) * 0.25) / 1.75;
  const fB = (nB0 + vnoise(bx * 2.03, bz * 2.03) * 0.5) / 1.5;
  h += fA * 17 * calm;
  h += fB * 3.4 * calm;
  if (ad > 60) h += (ad - 60) * fbm(x * 0.01, z * 0.01, 2) * 0.34;

  // 柔和起伏谷地：原「断崖」是永久台阶，但区间剔除会在贡献仍为满值时把它整条
  // 丢掉，造成近垂直的高度回弹（解析场坡度突变 ±18）。改成两端归零的平滑脉冲
  // （先缓降、再缓升），剔除边界处值与导数都为 0，路面高度差彻底平滑过渡。
  // 幅度降低、过渡拓宽到 ±36m，读起来是连绵的浅谷而不是锐利台阶。
  const kLo = Math.ceil((t - 306) / 380), kHi = Math.floor((t - 214) / 380);
  for (let k = kLo; k <= kHi; k++) {
    if (k < 0) continue;
    const tc = 260 + k * 380;
    const r = hash2(k * 17 + 3, 91);
    const off = (r - 0.5) * 44, w = 30 + r * 20;
    const dx = (x - pathX(-tc) - off) / w;
    if (dx > 3.2 || dx < -3.2) continue;      // exp(-10.2) ≈ 3.7e-5，可忽略
    const pulse = sstep(tc - 36, tc, t) * (1 - sstep(tc, tc + 36, t));
    h -= (2.8 + r * 2.2) * pulse * Math.exp(-dx * dx);
  }
  const sd = x - streamX(z);
  if (sd < 22 && sd > -22) h -= 1.6 * Math.exp(-(sd * sd) / 42);
  const tb = townBlend(x, z);
  if (tb > 0.001 && !computingTownY) h = lerp(h, TOWN_Y.v, tb);
  return h;
}
/* 与地形网格完全一致的插值高度：物理站在「看见的那张三角面」上，
   而不是站在解析曲面上——后者在凸坡会陷进网格、在凹坡会浮空。
   已加载区块直接读它缓存的高度栅格（零噪声求值）；栅格外（远处 / 尚未生成）
   才现算 4 个角点。两条路径返回同一个数学结果，所以物理与画面永远一致。
   网格顶点：x = -CHUNK_W/2 + ix*TDX，z = zStart - iz*TDZ。对角线为 b–c。 */
let world = null;
function heightAt(x, z) {
  const gx = (x + CHUNK_W * 0.5) / TDX;
  let ix = Math.floor(gx);
  const inX = ix >= 0 && ix < SEG_X;
  if (!inX) ix = clamp(ix, 0, SEG_X - 1);
  const fx = gx - ix;
  const gz = -z / TDZ;
  let iz = Math.floor(gz);
  const fz = gz - iz;
  // 区块索引 = floor(-z / CHUNK_D)，而 CHUNK_D / TDZ === SEG_Z，故 iz 直接换算
  const ci = Math.floor(iz / SEG_Z);
  const lz = iz - ci * SEG_Z;
  let ha, hb, hc, hd;
  const c = (world && inX && fz >= 0 && fz <= 1) ? world.map.get(ci) : null;
  if (c && c.index === ci && lz < SEG_Z) {
    const b = c.hbuf, o = lz * (SEG_X + 1) + ix;
    ha = b[o]; hb = b[o + 1]; hc = b[o + SEG_X + 1]; hd = b[o + SEG_X + 2];
  } else {
    if (fz < 0 || fz > 1 || !inX) return heightField(x, z);
    const x0 = -CHUNK_W * 0.5 + ix * TDX, x1 = x0 + TDX;
    const z0 = -iz * TDZ, z1 = z0 - TDZ;
    ha = heightField(x0, z0); hb = heightField(x1, z0);
    hc = heightField(x0, z1); hd = heightField(x1, z1);
  }
  if (fx + fz <= 1) return ha + (hb - ha) * fx + (hc - ha) * fz;
  return hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
}
function waterLevel(z) { return heightAt(streamX(z), z) + 0.62; }
function surfaceAt(x, z) {
  if (mudAt(x, z) > 0.22) return 'mud';
  if (Math.abs(x - streamX(z)) < 6.4) return 'water';
  if (Math.abs(x - pathX(z)) < 6.2) return 'dirt';
  return 'grass';
}

/* --------------------------- 共享几何体 --------------------------- */
const GEO = {};
function buildSharedGeometries() {
  buildTerrainColors();
  // 草丛：每个实例 3 片交叉矮草叶（9 三角，双面）——矮而密，远看是草毯而不是尖刺
  const w = 0.085, hh = 0.34;
  const one = [
    -w, 0, 0, w, 0, 0, w * 0.55, hh * 0.55, 0.03,
    -w, 0, 0, w * 0.55, hh * 0.55, 0.03, -w * 0.55, hh * 0.55, 0.03,
    -w * 0.55, hh * 0.55, 0.03, w * 0.55, hh * 0.55, 0.03, 0, hh, 0.09
  ];
  const gp = new Float32Array(81);
  const bn = new Float32Array(81), bc = new Float32Array(81);
  const cBase = new THREE.Color(0x62ad3c), cTip = new THREE.Color(0x93cf58);
  // 三片叶各自的旋转 / 缩放 / 偏移，让一丛看起来是自然的一撮
  const LEAF = [
    { a: 0.00, s: 1.00, h: 1.00, ox: 0.000, oz: 0.000 },
    { a: 1.15, s: 0.88, h: 0.78, ox: 0.085, oz: -0.055 },
    { a: 2.42, s: 0.94, h: 0.90, ox: -0.070, oz: 0.065 }
  ];
  for (let b = 0; b < 3; b++) {
    const L = LEAF[b], ca = Math.cos(L.a), sa = Math.sin(L.a);
    for (let i = 0; i < 9; i++) {
      const o = b * 27 + i * 3, s = i * 3;
      const px0 = one[s] * L.s, pz0 = one[s + 2] * L.s;
      gp[o] = px0 * ca - pz0 * sa + L.ox;
      gp[o + 1] = one[s + 1] * L.h;
      gp[o + 2] = px0 * sa + pz0 * ca + L.oz;
      bn[o] = 0; bn[o + 1] = 0.55; bn[o + 2] = 0.83;
      const c = cBase.clone().lerp(cTip, Math.pow(one[s + 1] / hh, 1.6));
      bc[o] = c.r; bc[o + 1] = c.g; bc[o + 2] = c.b;
    }
  }
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  blade.setAttribute('normal', new THREE.BufferAttribute(bn, 3));
  blade.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  blade.computeBoundingSphere();
  GEO.blade = blade;

  // 松树
  const trunk = new THREE.CylinderGeometry(0.17, 0.26, 1.7, 6);
  trunk.translate(0, 0.85, 0); tintGeo(trunk, 0x7a4f28, 0.12);
  const c1 = new THREE.ConeGeometry(1.55, 2.3, 7); c1.translate(0, 2.2, 0); tintGeo(c1, 0x2f7a3f, 0.14);
  const c2 = new THREE.ConeGeometry(1.18, 2.0, 7); c2.translate(0, 3.35, 0); tintGeo(c2, 0x3d8c46, 0.14);
  const c3 = new THREE.ConeGeometry(0.78, 1.7, 7); c3.translate(0, 4.5, 0); tintGeo(c3, 0x51a957, 0.14);
  GEO.pine = mergeGeos([trunk, c1, c2, c3]);
  GEO.pine.computeVertexNormals();
  [trunk, c1, c2, c3].forEach(g => g.dispose());

  // 阔叶树
  const bt = new THREE.CylinderGeometry(0.2, 0.32, 2.0, 6); bt.translate(0, 1, 0); tintGeo(bt, 0x8a5a30, 0.1);
  const b1 = new THREE.IcosahedronGeometry(1.5, 0); b1.scale(1.1, 0.86, 1.1); b1.translate(0, 2.9, 0); tintGeo(b1, 0x74c247, 0.16);
  const b2 = new THREE.IcosahedronGeometry(1.05, 0); b2.translate(1.0, 2.4, 0.3); tintGeo(b2, 0x8ed14f, 0.16);
  const b3 = new THREE.IcosahedronGeometry(0.95, 0); b3.translate(-0.85, 2.6, -0.4); tintGeo(b3, 0x66b83e, 0.16);
  GEO.leafTree = mergeGeos([bt, b1, b2, b3]);
  GEO.leafTree.computeVertexNormals();
  [bt, b1, b2, b3].forEach(g => g.dispose());

  // 灌木
  const s1 = new THREE.IcosahedronGeometry(0.62, 0); s1.scale(1.2, 0.8, 1.1); s1.translate(0, 0.45, 0); tintGeo(s1, 0x5fae3a, 0.18);
  const s2 = new THREE.IcosahedronGeometry(0.45, 0); s2.translate(0.5, 0.35, 0.2); tintGeo(s2, 0x74c247, 0.18);
  GEO.bush = mergeGeos([s1, s2]); GEO.bush.computeVertexNormals(); [s1, s2].forEach(g => g.dispose());

  // 岩石
  const r1 = new THREE.DodecahedronGeometry(1, 0); r1.scale(1.15, 0.82, 1.0);
  tintGeo(r1, 0xc09060, 0.2);
  r1.computeVertexNormals();
  GEO.rock = r1;

  // 苔藓石遗迹（双柱 + 楣 + 断柱，顶面覆苔）：参考图里的废塔残拱
  const rp = [];
  const pl1 = new THREE.BoxGeometry(0.7, 2.6, 0.7); pl1.translate(-1.1, 1.3, 0); tintGeo(pl1, 0xb9a98c, 0.10);
  const pl2 = new THREE.BoxGeometry(0.7, 2.6, 0.7); pl2.translate(1.1, 1.3, 0); tintGeo(pl2, 0xb9a98c, 0.10);
  const pl3 = new THREE.BoxGeometry(0.7, 1.4, 0.7); pl3.translate(2.3, 0.7, 0.2); tintGeo(pl3, 0xa99878, 0.10);
  const lintel = new THREE.BoxGeometry(3.2, 0.6, 0.8); lintel.translate(0, 2.9, 0); tintGeo(lintel, 0xc4b496, 0.08);
  const moss1 = new THREE.BoxGeometry(3.24, 0.12, 0.84); moss1.translate(0, 3.24, 0); tintGeo(moss1, 0x6fbf3f, 0.16);
  const moss2 = new THREE.BoxGeometry(0.74, 0.10, 0.74); moss2.translate(-1.1, 2.65, 0); tintGeo(moss2, 0x74c247, 0.16);
  const moss3 = new THREE.BoxGeometry(0.74, 0.10, 0.74); moss3.translate(2.3, 1.45, 0.2); tintGeo(moss3, 0x8ed14f, 0.16);
  rp.push(pl1, pl2, pl3, lintel, moss1, moss2, moss3);
  GEO.ruin = mergeGeos(rp); rp.forEach(g => g.dispose());
  GEO.ruin.computeVertexNormals();

  // 瀑底泡沫盘
  const foam = new THREE.CircleGeometry(1, 14); foam.rotateX(-Math.PI / 2);
  GEO.foam = foam;

  // 木箱（箱体 + 板条）
  const parts = [];
  const box = new THREE.BoxGeometry(1.05, 1.05, 1.05); box.translate(0, 0.53, 0); tintGeo(box, 0xc08a4a, 0.08);
  parts.push(box);
  for (let i = 0; i < 2; i++) {
    const p = new THREE.BoxGeometry(1.12, 0.14, 1.12); p.translate(0, 0.2 + i * 0.66, 0); tintGeo(p, 0x8a5a2c, 0.06);
    parts.push(p);
  }
  const diag = new THREE.BoxGeometry(1.35, 0.12, 0.06); diag.rotateZ(0.72); diag.translate(0, 0.53, 0.55); tintGeo(diag, 0x8a5a2c, 0.05);
  const diag2 = diag.clone(); diag2.translate(0, 0, -1.1);
  parts.push(diag, diag2);
  GEO.crate = mergeGeos(parts); parts.forEach(g => g.dispose());

  // 栅栏（3 柱 + 2 横杆），跨度 7m
  const fp = [];
  for (let i = -1; i <= 1; i++) {
    const post = new THREE.BoxGeometry(0.22, 1.5, 0.22); post.translate(i * 3.2, 0.75, 0); tintGeo(post, 0x9c6a38, 0.08);
    fp.push(post);
  }
  for (let i = 0; i < 2; i++) {
    const rail = new THREE.BoxGeometry(7.0, 0.18, 0.13); rail.translate(0, 0.55 + i * 0.55, 0); tintGeo(rail, 0xc08a4a, 0.08);
    fp.push(rail);
  }
  GEO.fence = mergeGeos(fp); fp.forEach(g => g.dispose());

  // 弹跳蘑菇
  const stem = new THREE.CylinderGeometry(0.28, 0.4, 0.85, 8); stem.translate(0, 0.42, 0); tintGeo(stem, 0xf6ead0, 0.05);
  const cap = new THREE.SphereGeometry(1.05, 12, 8, 0, TAU, 0, Math.PI * 0.52); cap.scale(1, 0.72, 1); cap.translate(0, 0.82, 0);
  tintGeo(cap, 0xff5a5f, 0.06);
  const dots = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + 0.3, rr = 0.55 + (i % 2) * 0.24;
    const d = new THREE.SphereGeometry(0.17, 6, 5);
    d.translate(Math.cos(a) * rr, 0.82 + Math.sqrt(Math.max(0, 1 - rr * rr)) * 0.72 * 0.95, Math.sin(a) * rr);
    tintGeo(d, 0xfff6e0, 0);
    dots.push(d);
  }
  GEO.mushroom = mergeGeos([stem, cap].concat(dots));
  [stem, cap].concat(dots).forEach(g => g.dispose());

  // 木跳台（楔形，前进方向 -Z，入口 z=+4，出口 z=-4，高 3.2）
  GEO.ramp = buildRampGeometry();

  // 加速环
  GEO.ring = new THREE.TorusGeometry(2.55, 0.24, 8, 26);
  GEO.ringInner = new THREE.CircleGeometry(2.4, 24);

  // 倒木
  const log = new THREE.CylinderGeometry(0.55, 0.62, 6.2, 8); log.rotateZ(Math.PI / 2); tintGeo(log, 0x8a5a30, 0.12);
  const l1 = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 8); l1.rotateZ(Math.PI / 2); l1.translate(3.12, 0, 0); tintGeo(l1, 0xd9b070, 0.05);
  const l2 = l1.clone(); l2.translate(-6.24, 0, 0);
  GEO.log = mergeGeos([log, l1, l2]); [log, l1, l2].forEach(g => g.dispose());

  // 检查点门柱
  GEO.pillar = buildPillarGeometry();
  GEO.banner = new THREE.PlaneGeometry(11.4, 1.9, 1, 1);
  GEO.flag = new THREE.PlaneGeometry(1.5, 1.0, 4, 3);

  // 云球（明暗由着色器按「世界向上」的法线方向烘出，见 makeCloudMaterial）
  GEO.puff = new THREE.IcosahedronGeometry(1, 1);
  tintGeo(GEO.puff, 0xffffff, 0);
  fallMat = makeFallMaterial();
}

function buildRampGeometry() {
  const pos = [], col = [];
  const cA = new THREE.Color(0xc08a4a), cB = new THREE.Color(0xa8703a), cSide = new THREE.Color(0x8a5a2c);
  const W = 3.2, L = 4, H = 3.2;
  const push = (p, c) => { pos.push(p[0], p[1], p[2]); col.push(c.r, c.g, c.b); };
  const tri = (a, b, c, cc) => { push(a, cc); push(b, cc); push(c, cc); };
  const quad = (a, b, c, d, cc) => { tri(a, b, c, cc); tri(a, c, d, cc); };
  const yAt = (z) => (L - z) / (2 * L) * H;
  // 顶面：8 块木板
  for (let i = 0; i < 8; i++) {
    const z0 = L - i * (2 * L / 8), z1 = L - (i + 1) * (2 * L / 8);
    const cc = i % 2 ? cA : cB;
    quad([-W, yAt(z0), z0], [W, yAt(z0), z0], [W, yAt(z1), z1], [-W, yAt(z1), z1], cc);
  }
  // 侧面
  for (const s of [-1, 1]) {
    const x = s * W;
    if (s > 0) { tri([x, 0, L], [x, 0, -L], [x, H, -L], cSide); }
    else { tri([x, 0, L], [x, H, -L], [x, 0, -L], cSide); }
  }
  // 背面 + 底面
  quad([-W, 0, -L], [W, 0, -L], [W, H, -L], [-W, H, -L], cSide);
  quad([-W, 0, L], [-W, 0, -L], [W, 0, -L], [W, 0, L], cSide);
  // 两侧护栏
  for (const s of [-1, 1]) {
    const x = s * (W + 0.12);
    const g = new THREE.BoxGeometry(0.18, 0.5, 2 * L);
    g.rotateX(-Math.atan2(H, 2 * L));
    g.translate(x, H / 2 + 0.22, 0);
    tintGeo(g, 0xf2e6c8, 0.04);
    const ng = g.toNonIndexed();
    const p = ng.attributes.position.array, c = ng.attributes.color.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < c.length; i++) col.push(c[i]);
    g.dispose(); ng.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function buildPillarGeometry() {
  const parts = [];
  const base = new THREE.BoxGeometry(1.5, 0.6, 1.5); base.translate(0, 0.3, 0); tintGeo(base, 0x8f88ad, 0.08);
  const shaft = new THREE.BoxGeometry(1.0, 5.2, 1.0); shaft.translate(0, 3.1, 0); tintGeo(shaft, 0xa9a2c4, 0.08);
  const cap = new THREE.BoxGeometry(1.5, 0.55, 1.5); cap.translate(0, 5.9, 0); tintGeo(cap, 0x8f88ad, 0.08);
  const orb = new THREE.IcosahedronGeometry(0.42, 1); orb.translate(0, 6.5, 0); tintGeo(orb, 0x35e0ff, 0);
  parts.push(base, shaft, cap, orb);
  const g = mergeGeos(parts); parts.forEach(x => x.dispose());
  return g;
}

/* --------------------------- 接地阴影 / 环境遮蔽 --------------------------- */
/* 太阳仰角只有 13°，长投影会把主体拉出去很远，脚下反而没有暗部，
   角色看着像浮在草上。这里补一张随高度衰减的软阴影贴片：
   贴地时浓而小，腾空时淡而大 —— 这也是玩家判断落点的重要视觉线索。 */
let contactShadow = null, contactShadowMat = null;
function buildContactShadow() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g2 = cv.getContext('2d');
  const grd = g2.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0.00, 'rgba(28,42,20,0.62)');
  grd.addColorStop(0.42, 'rgba(30,46,22,0.34)');
  grd.addColorStop(0.78, 'rgba(34,52,26,0.09)');
  grd.addColorStop(1.00, 'rgba(34,52,26,0)');
  g2.fillStyle = grd;
  g2.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  contactShadowMat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 1,
    blending: THREE.NormalBlending, toneMapped: false, fog: true
  });
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  contactShadow = new THREE.Mesh(geo, contactShadowMat);
  contactShadow.renderOrder = 1;
  contactShadow.frustumCulled = false;
  scene.add(contactShadow);
}

const CS_SIZE = { bike: [1.30, 2.30], horse: [1.55, 3.10], board: [1.55, 3.20] };
function updateContactShadow() {
  if (!contactShadow) return;
  const p = player;
  const gy = heightAt(p.pos.x, p.pos.z);
  const air = clamp(p.pos.y - gy, 0, 9);
  const s = CS_SIZE[p.vehicle];
  // 腾空越高：贴片越大越淡（半影扩散），落地瞬间收紧变浓
  const spread = 1 + air * 0.16;
  contactShadow.scale.set(s[0] * spread, 1, s[1] * spread);
  contactShadow.position.set(p.pos.x, gy + 0.035, p.pos.z);
  contactShadow.rotation.y = p.yaw;
  contactShadowMat.opacity = clamp(1 - air * 0.115, 0.10, 1) * (p.surface === 'water' ? 0.45 : 1);
}

/* --------------------------- 天空 / 云 / 远山 --------------------------- */
/* 太阳方向：仰角刻意压低到 ~13°，这样正常驾驶（含下坡俯角）时太阳就落在画面里，
   逆光光柱、暖色轮廓光与长投影才真正看得见；再高就永远在画面上方之外了。 */
const SUN_DIR = { x: -0.50, y: 0.235, z: -0.835 };
let sky, skyMat, cloudGroup, cloudMesh, mountainGroup, sun, hemi, fillLight, rimLight;

function buildSky() {
  const sd = new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize();
  skyMat = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color(0x12a0be) },
      mid: { value: new THREE.Color(0x4cc4d4) },
      horizon: { value: new THREE.Color(0xcfeee8) },
      low: { value: new THREE.Color(0xffe9c0) },
      sunCol: { value: new THREE.Color(0xffe0a0) },
      sunDir: { value: sd },
      time: { value: 0 }
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 zenith, mid, horizon, low, sunCol, sunDir; uniform float time;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y*0.5+0.5, 0.0, 1.0);
        vec3 c = mix(low, horizon, smoothstep(0.41, 0.500, h));
        c = mix(c, mid, smoothstep(0.495, 0.545, h));
        c = mix(c, zenith, smoothstep(0.535, 0.720, h));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunCol * pow(s, 1200.0) * 4.0;
        c += sunCol * pow(s, 26.0) * 0.34;
        c += sunCol * pow(s, 4.0) * 0.07;
        // 高层薄云带
        float band = sin(d.x*3.0 + time*0.02) * sin(d.z*2.4 - time*0.015);
        c += vec3(0.05,0.055,0.06) * smoothstep(0.55,0.85,h) * (band*0.5+0.5);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false
  });
  sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), skyMat);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  scene.add(sky);

  // 蓬松体积云（实例化球簇）
  cloudGroup = new THREE.Group();
  cloudGroup.frustumCulled = false;
  scene.add(cloudGroup);
  const maxPuffs = 140;
  cloudMesh = new THREE.InstancedMesh(GEO.puff, makeCloudMaterial(), maxPuffs);
  cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cloudMesh.frustumCulled = false;
  cloudMesh.castShadow = false;
  cloudGroup.add(cloudMesh);
  cloudMesh.userData.seeds = [];
  const rng = mulberry32(20240711);
  const dummy = new THREE.Object3D();
  const cc = new THREE.Color();
  let n = 0;
  for (let c = 0; c < 22 && n < maxPuffs; c++) {
    const ang = rng() * TAU, dist = 240 + rng() * 560;
    const bx = Math.cos(ang) * dist, bz = Math.sin(ang) * dist;
    const by = 70 + rng() * 100;
    const scale = 24 + rng() * 30;
    const puffs = 5 + Math.floor(rng() * 3);
    for (let p = 0; p < puffs && n < maxPuffs; p++) {
      const ox = (rng() - 0.5) * scale * 2.4, oy = (rng() - 0.5) * scale * 0.50, oz = (rng() - 0.5) * scale * 1.3;
      const s = scale * (0.5 + rng() * 0.6);
      dummy.position.set(bx + ox, by + oy, bz + oz);
      dummy.scale.set(s, s * (0.62 + rng() * 0.2), s);
      dummy.rotation.set(rng(), rng(), rng());
      dummy.updateMatrix();
      cloudMesh.setMatrixAt(n, dummy.matrix);
      const tint = 0.94 + rng() * 0.12;
      cc.setRGB(tint, tint * 0.995, tint);
      cloudMesh.setColorAt(n, cc);
      cloudMesh.userData.seeds.push({ y: by + oy, ph: rng() * TAU });
      n++;
    }
  }
  cloudMesh.count = Math.min(n, Q.clouds);
  cloudMesh.instanceMatrix.needsUpdate = true;
  if (cloudMesh.instanceColor) cloudMesh.instanceColor.needsUpdate = true;

  // 远山紫灰剪影（三层，无雾、向天空色偏移）
  mountainGroup = new THREE.Group();
  mountainGroup.frustumCulled = false;
  scene.add(mountainGroup);
  const layers = [
    { r: 700, h: 210, col: 0x4f8ba0, seed: 3 },
    { r: 840, h: 265, col: 0x6fa3b4, seed: 9 },
    { r: 960, h: 320, col: 0x93c0c8, seed: 17 }
  ];
  for (const L of layers) {
    const seg = 96, pos = [], col = [];
    const base = new THREE.Color(L.col), top = new THREE.Color(L.col).lerp(new THREE.Color(0xeaf4ff), 0.30);
    const rr = mulberry32(L.seed * 7717);
    const hs = [];
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * TAU;
      const v = Math.abs(fbm(Math.cos(a) * 2.2 + L.seed, Math.sin(a) * 2.2, 3));
      // 平顶台地（mesa）剪影：高度量化成台阶，远山读作一层层桌状崖而不是尖峰
      const raw = L.h * (0.22 + v * 0.85) + rr() * 12;
      hs.push(Math.round(raw / 46) * 46 + 8);
    }
    hs[seg] = hs[0];
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
      const x0 = Math.cos(a0) * L.r, z0 = Math.sin(a0) * L.r;
      const x1 = Math.cos(a1) * L.r, z1 = Math.sin(a1) * L.r;
      const y0 = hs[i], y1 = hs[i + 1];
      const push = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); };
      push(x0, -60, z0, base); push(x1, -60, z1, base); push(x1, y1, z1, top);
      push(x0, -60, z0, base); push(x1, y1, z1, top); push(x0, y0, z0, top);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.frustumCulled = false;
    mesh.renderOrder = -90 + layers.indexOf(L);
    mountainGroup.add(mesh);
  }
  buildMotes();
}

/* 雾范围与可视区块数绑定：远处地形边缘永远藏在雾里，看不出拼接边界 */
function applyFogRange() {
  const far = Q.ahead * CHUNK_D + 60, near = far * 0.34;
  scene.fog.near = near;
  scene.fog.far = far;
  M.setFog(near, far);
  if (waterMat) {
    waterMat.uniforms.fogNear.value = near;
    waterMat.uniforms.fogFar.value = far;
  }
  if (fallMat) {
    fallMat.uniforms.fogNear.value = near;
    fallMat.uniforms.fogFar.value = far;
  }
}

function buildLights() {
  hemi = new THREE.HemisphereLight(0xcfeef2, 0x7fb04a, 0.50);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff2d0, 1.66);
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 190;
  // 收紧到 ±32：2048 贴图下约 3.1cm/texel（原来 ±46 是 4.5cm），
  // 骑手 / 载具的接地阴影和细节轮廓明显更锐利，覆盖范围仍远大于跟拍视野。
  const S = 32;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.028;
  scene.add(sun);
  scene.add(sun.target);
  fillLight = new THREE.DirectionalLight(0x9fd8e8, 0.24);
  fillLight.position.set(60, 40, 60);
  scene.add(fillLight);
  // 暖色轮廓光：从后方勾出骑手 / 载具的金边，让主体从草甸里跳出来
  rimLight = new THREE.DirectionalLight(0xffd7a0, 0.55);
  rimLight.position.set(-34, 26, 72);
  scene.add(rimLight);
}

/* --------------------------- 云材质 --------------------------- */
/* 卡通云：按法线与「世界上方」的夹角烘出暖白顶冠 → 冷蓝底腹。
   用法线而不是顶点高度，实例可以任意翻滚而体积感始终正确。 */
function makeCloudMaterial() {
  const mat = M.toon(0xffffff, { vertexColors: true, fog: false, emissive: 0xdceaff, emissiveIntensity: 0.18 });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
      #include <normal_fragment_begin>
      {
        vec3 upView = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
        float upness = dot(normalize(normal), upView) * 0.5 + 0.5;
        vec3 crown = vec3(1.10, 1.05, 0.98);
        vec3 belly = vec3(0.52, 0.64, 0.76);
        diffuseColor.rgb *= mix(belly, crown, smoothstep(0.22, 0.88, upness));
      }`);
  };
  mat.customProgramCacheKey = () => 'wwd-cloud';
  return mat;
}

/* --------------------------- 崖壁瀑布 --------------------------- */
/* 真实几何 + 滚动水纹 shader：水从崖顶渗出、竖直拉出白练，底部落进泡沫盘。
   不是贴图假画：条带随时间向下滚动，边缘与顶/底都有衰减。 */
function makeFallMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      fogNear: { value: 260 }, fogFar: { value: 1020 }
    },
    vertexShader: `
      varying vec2 vUv; varying float vFog;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFog = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime, fogNear, fogFar;
      varying vec2 vUv; varying float vFog;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        float cell = hash(floor(vec2(vUv.x * 7.0, vUv.y * 22.0 - uTime * 3.0)));
        float streak = 0.55 + 0.45 * sin(vUv.x * 22.0 + cell * 3.0);
        float flow = fract(vUv.y * 3.0 - uTime * 1.6 + cell * 0.15);
        float body = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
        float head = smoothstep(0.0, 0.08, vUv.y);
        float foot = smoothstep(1.0, 0.90, vUv.y);
        vec3 col = mix(vec3(0.62, 0.86, 0.92), vec3(0.96, 1.0, 1.0), streak * 0.6 + flow * 0.4);
        float alpha = body * head * foot * (0.62 + 0.30 * streak);
        float f = smoothstep(fogNear, fogFar, vFog);
        gl_FragColor = vec4(mix(col, vec3(0.84, 0.94, 0.96), f), alpha * (1.0 - f * 0.85));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide
  });
}

/* --------------------------- 空气飘叶 --------------------------- */
/* 参考图里逆光飘飞的叶屑 / 光点：70 个粒子在玩家周围盒内漂移并回绕。 */
function buildMotes() {
  const N = 70;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  moteVel = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    pos[i * 3] = rand(-32, 32); pos[i * 3 + 1] = rand(0.5, 16); pos[i * 3 + 2] = rand(-32, 32);
    moteVel[i * 3] = rand(0.4, 1.3); moteVel[i * 3 + 1] = rand(-0.30, 0.15); moteVel[i * 3 + 2] = rand(-0.5, 0.5);
    c.setHex(i % 3 === 0 ? 0xffe07a : (i % 3 === 1 ? 0xcdeb72 : 0xfff4e0));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g2 = cv.getContext('2d');
  const grd = g2.createRadialGradient(16, 16, 1, 16, 16, 15);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g2.fillStyle = grd; g2.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  motes = new THREE.Points(g, new THREE.PointsMaterial({
    size: 0.26, map: tex, vertexColors: true, transparent: true, opacity: 0.85,
    depthWrite: false, sizeAttenuation: true
  }));
  motes.frustumCulled = false;
  motes.renderOrder = 3;
  scene.add(motes);
}

/* --------------------------- 草浪着色器 --------------------------- */
function makeGrassMaterial() {
  const mat = M.toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide });
  mat.userData.uniforms = { uTime: { value: 0 }, uWind: { value: 1 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = mat.userData.uniforms.uTime;
    shader.uniforms.uWind = mat.userData.uniforms.uWind;
    shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 iOrigin = vec3(0.0);
      #endif
      float bladeH = clamp(transformed.y / 0.34, 0.0, 1.0);
      float ph = iOrigin.x * 0.21 + iOrigin.z * 0.17;
      float gust = sin(uTime * 0.42 + iOrigin.x * 0.012 + iOrigin.z * 0.010);
      float sway = (sin(uTime * 1.7 + ph) * 0.19 + sin(uTime * 3.3 + ph * 1.9) * 0.07) * (0.55 + 0.65 * gust);
      float k = bladeH * bladeH * uWind;
      transformed.x += sway * k;
      transformed.z += sway * 0.45 * k;
      transformed.y -= abs(sway) * k * 0.12;
    `);
  };
  mat.customProgramCacheKey = () => 'wwd-grass';
  return mat;
}

function makeWaterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      cA: { value: new THREE.Color(0x4fbfe0) },
      cB: { value: new THREE.Color(0xe8fbff) },
      fogColor: { value: new THREE.Color(0xd6ecf7) },
      fogNear: { value: 260 }, fogFar: { value: 1020 }
    },
    vertexShader: `
      uniform float uTime; varying vec2 vUv; varying float vFog;
      void main(){
        vUv = uv;
        vec3 p = position;
        p.y += sin(p.x*0.8 + uTime*2.1)*0.055 + sin(p.z*0.55 - uTime*1.7)*0.045;
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        vFog = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime, fogNear, fogFar; uniform vec3 cA, cB, fogColor;
      varying vec2 vUv; varying float vFog;
      void main(){
        float rip = sin(vUv.y*150.0 - uTime*4.2) * 0.5 + 0.5;
        float rip2 = sin(vUv.y*61.0 + vUv.x*9.0 - uTime*2.1) * 0.5 + 0.5;
        float spark = pow(rip*rip2, 5.0);
        vec3 c = mix(cA, cB, 0.18 + 0.75*spark);
        float edge = smoothstep(0.0,0.16,vUv.x) * smoothstep(1.0,0.84,vUv.x);
        c = mix(c, fogColor, smoothstep(fogNear, fogFar, vFog));
        gl_FragColor = vec4(c, (0.62 + 0.3*spark) * edge);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide
  });
}

/* --------------------------- 地形区块 --------------------------- */
let TERRAIN_COLORS = null;
function buildTerrainColors() {
  TERRAIN_COLORS = {
    grassA: new THREE.Color(0x8cc843), grassB: new THREE.Color(0x5aa838),
    grassHi: new THREE.Color(0xb8e062), dirt: new THREE.Color(0x9a7448),
    gravel: new THREE.Color(0xb99a6e),
    rockA: new THREE.Color(0xc08d58), rockB: new THREE.Color(0x8a5f38),
    mud: new THREE.Color(0x6b4a28),
    sand: new THREE.Color(0xc9ad7c), town: new THREE.Color(0xa8d06a)
  };
}
let grassMat, waterMat, vegMat, propWoodMat, fallMat, motes, moteVel;

class Chunk {
  constructor() {
    this.index = -99999;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);

    // 地形网格
    const nv = (SEG_X + 1) * (SEG_Z + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    const idx = new Uint16Array(SEG_X * SEG_Z * 6);
    this.hbuf = new Float32Array(nv);
    let o = 0;
    for (let iz = 0; iz < SEG_Z; iz++) {
      for (let ix = 0; ix < SEG_X; ix++) {
        const a = iz * (SEG_X + 1) + ix, b = a + 1, c = a + SEG_X + 1, d = c + 1;
        idx[o++] = a; idx[o++] = b; idx[o++] = c;
        idx[o++] = b; idx[o++] = d; idx[o++] = c;
      }
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = g;
    this.terrain = new THREE.Mesh(g, M.toon(0xffffff, { vertexColors: true }));
    this.terrain.receiveShadow = true;
    this.terrain.castShadow = false;
    this.group.add(this.terrain);

    // 溪流
    const wg = new THREE.BufferGeometry();
    const rows = SEG_Z * 2 + 1;
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rows * 2 * 3), 3));
    const wuv = new Float32Array(rows * 2 * 2);
    const widx = new Uint16Array((rows - 1) * 6);
    o = 0;
    for (let i = 0; i < rows - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      widx[o++] = a; widx[o++] = b; widx[o++] = c;
      widx[o++] = b; widx[o++] = d; widx[o++] = c;
    }
    for (let i = 0; i < rows; i++) {
      wuv[i * 4] = 0; wuv[i * 4 + 1] = i / (rows - 1);
      wuv[i * 4 + 2] = 1; wuv[i * 4 + 3] = i / (rows - 1);
    }
    wg.setAttribute('uv', new THREE.BufferAttribute(wuv, 2));
    wg.setIndex(new THREE.BufferAttribute(widx, 1));
    this.waterGeo = wg;
    this.water = new THREE.Mesh(wg, waterMat);
    this.water.renderOrder = 2;
    this.water.frustumCulled = false;
    this.group.add(this.water);

    // 实例化植被
    this.grass = new THREE.InstancedMesh(GEO.blade, grassMat, QUALITY.high.grass);
    this.grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.grass.castShadow = false; this.grass.receiveShadow = false;
    this.grass.frustumCulled = false;
    this.group.add(this.grass);

    this.pines = new THREE.InstancedMesh(GEO.pine, vegMat, QUALITY.high.pines);
    this.pines.castShadow = true; this.pines.receiveShadow = false;
    this.group.add(this.pines);
    this.broad = new THREE.InstancedMesh(GEO.leafTree, vegMat, 40);
    this.broad.castShadow = true;
    this.group.add(this.broad);
    this.rocks = new THREE.InstancedMesh(GEO.rock, vegMat, QUALITY.high.rocks);
    this.rocks.castShadow = true; this.rocks.receiveShadow = true;
    this.group.add(this.rocks);
    this.bushes = new THREE.InstancedMesh(GEO.bush, vegMat, 60);
    this.bushes.castShadow = false;
    this.group.add(this.bushes);
    this.ruins = new THREE.InstancedMesh(GEO.ruin, vegMat, 6);
    this.ruins.castShadow = true; this.ruins.receiveShadow = true;
    this.group.add(this.ruins);

    // 崖壁瀑布（每块最多 2 条）：贴坡水练 + 瀑底泡沫
    this.falls = [];
    for (let i = 0; i < 2; i++) {
      const fm = new THREE.Mesh(new THREE.BufferGeometry(), fallMat);
      fm.renderOrder = 2; fm.visible = false; fm.frustumCulled = false;
      const foam = new THREE.Mesh(GEO.foam, new THREE.MeshBasicMaterial({
        color: 0xeaf6ff, transparent: true, opacity: 0.5, depthWrite: false
      }));
      foam.renderOrder = 2; foam.visible = false;
      this.group.add(fm); this.group.add(foam);
      this.falls.push({ mesh: fm, foam, x: 0, z: 0, y: 0, on: false });
    }

    // 互动道具池
    this.propGroup = new THREE.Group();
    this.group.add(this.propGroup);
    this.props = [];
    const addProp = (type, mesh, extra) => {
      mesh.visible = false;
      this.propGroup.add(mesh);
      const p = Object.assign({ type, mesh, active: false, broken: false, cool: 0, x: 0, z: 0, y: 0, yaw: 0, r: 1, anim: 0 }, extra || {});
      this.props.push(p);
      return p;
    };
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(GEO.ramp, propWoodMat);
      M.outline(m, 0.05); m.castShadow = true; m.receiveShadow = true;
      addProp('ramp', m, { r: 3.2 });
    }
    for (let i = 0; i < 3; i++) {
      const grp = new THREE.Group();
      const ring = new THREE.Mesh(GEO.ring, M.glow(0x35e0ff, 2.4));
      const inner = new THREE.Mesh(GEO.ringInner, M.basic(0x8ff4ff, { transparent: true, opacity: 0.2, additive: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
      grp.add(ring); grp.add(inner);
      grp.userData.ring = ring; grp.userData.inner = inner;
      addProp('ring', grp, { r: 2.9 });
    }
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(GEO.crate, propWoodMat);
      M.outline(m, 0.03); m.castShadow = true;
      addProp('crate', m, { r: 0.78 });
    }
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(GEO.fence, propWoodMat);
      M.outline(m, 0.03); m.castShadow = true;
      addProp('fence', m, { r: 3.5 });
    }
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(GEO.mushroom, propWoodMat);
      M.outline(m, 0.035); m.castShadow = true;
      addProp('mushroom', m, { r: 1.15 });
    }
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(GEO.log, propWoodMat);
      M.outline(m, 0.04); m.castShadow = true;
      addProp('log', m, { r: 0.85 });
    }
    // 检查点门
    const gate = new THREE.Group();
    const pl = new THREE.Mesh(GEO.pillar, M.toon(0xffffff, { vertexColors: true }));
    M.outline(pl, 0.05); pl.castShadow = true;
    const pr = pl.clone(); pr.position.x = 12;
    pl.position.x = 0;
    const bannerTex = canvasTexture(512, 96, (c, w, h) => {
      c.fillStyle = '#f6e7c4'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#0e7fa8'; c.lineWidth = 6; c.strokeRect(4, 4, w - 8, h - 8);
      c.fillStyle = '#123c4e'; c.font = 'bold 44px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('CHECKPOINT', w / 2, h / 2 + 2);
      c.fillStyle = '#35e0ff';
      for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(30 + i * 18, h / 2, 5, 0, TAU); c.fill(); c.beginPath(); c.arc(w - 30 - i * 18, h / 2, 5, 0, TAU); c.fill(); }
    });
    const banner = new THREE.Mesh(GEO.banner, new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide, toneMapped: false }));
    banner.position.set(6, 5.1, 0);
    const glowBar = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.14, 0.14), M.glow(0x35e0ff, 2.2));
    glowBar.position.set(6, 4.0, 0);
    gate.add(pl); gate.add(pr); gate.add(banner); gate.add(glowBar);
    gate.userData.glow = glowBar;
    this.gate = addProp('gate', gate, { r: 7 });
    this.colliders = [];
  }

  build(index) {
    this.index = index;
    const zStart = -index * CHUNK_D;
    this.group.position.set(0, 0, zStart);
    this.group.updateMatrix();
    this.group.visible = true;
    const rng = mulberry32((index + 100000) * 2654435761 >>> 0);
    const D = DIFF[settings.difficulty];

    /* ---- 地形顶点 ---- */
    const pos = this.geo.attributes.position.array;
    const col = this.geo.attributes.color.array;
    const nrm = this.geo.attributes.normal.array;
    const C = TERRAIN_COLORS;
    const tmp = new THREE.Color();
    const tmpR = new THREE.Color();
    // 高度先整块算一遍存起来：颜色里的坡度项与后面的法线都复用它，
    // 避免同一格点被重复求 fbm（细分提高后这是最大的构建开销）。
    const hbuf = this.hbuf;
    const NVX = SEG_X + 1;
    let vi = 0;
    for (let iz = 0; iz <= SEG_Z; iz++) {
      const wz = zStart - iz * TDZ;
      for (let ix = 0; ix <= SEG_X; ix++, vi++) hbuf[vi] = heightField(-CHUNK_W / 2 + ix * TDX, wz);
    }
    vi = 0;
    for (let iz = 0; iz <= SEG_Z; iz++) {
      const lz = -iz * TDZ, wz = zStart + lz;
      for (let ix = 0; ix <= SEG_X; ix++, vi++) {
        const x = -CHUNK_W / 2 + ix * TDX;
        const h = hbuf[vi];
        pos[vi * 3] = x; pos[vi * 3 + 1] = h; pos[vi * 3 + 2] = lz;
        // 颜色：草甸 / 路径 / 岩壁 / 泥地 / 溪床 / 镇口
        const n = fbm(x * 0.035, wz * 0.035, 2);
        const patch = fbm(x * 0.009 - 3.1, wz * 0.009 + 7.4, 2);
        tmp.copy(C.grassA).lerp(C.grassB, clamp(n * 0.85 + 0.5, 0, 1));
        tmp.lerp(C.grassHi, clamp(patch * 0.6 + 0.2, 0, 0.32));
        tmp.lerp(C.grassHi, clamp((h - (START_H - descentAt(-wz))) * 0.030, 0, 0.22));
        const tb = townBlend(x, wz);
        if (tb > 0) tmp.lerp(C.town, tb * 0.7);
        const dPath = Math.abs(x - pathX(wz));
        const onTrail = 1 - sstep(2.2, 7.2, dPath);
        tmp.lerp(C.dirt, onTrail);
        tmp.lerp(C.gravel, onTrail * clamp(n * 0.9 + 0.35, 0, 0.55));
        const sd = Math.abs(x - streamX(wz));
        tmp.lerp(C.sand, (1 - sstep(4.5, 9.5, sd)) * 0.85);
        const mud = mudAt(x, wz);
        if (mud > 0) tmp.lerp(C.mud, clamp(mud * 1.5, 0, 0.92));
        const hr = ix < SEG_X ? hbuf[vi + 1] : h;
        const hd = iz < SEG_Z ? hbuf[vi + NVX] : h;
        const slope = Math.abs(hr - h) + Math.abs(hd - h);
        // 砂岩崖壁：按高度做地层条带（暖赭色深浅交替），坡面越陡岩色越满
        const rockMask = clamp((slope - 1.35) * 0.40, 0, 0.9);
        if (rockMask > 0.01) {
          const band = 0.5 + 0.5 * Math.sin(h * 0.50 + patch * 2.0);
          tmpR.copy(C.rockA).lerp(C.rockB, band);
          tmp.lerp(tmpR, rockMask);
        }
        col[vi * 3] = tmp.r; col[vi * 3 + 1] = tmp.g; col[vi * 3 + 2] = tmp.b;
      }
    }
    // 解析法线：直接用高度缓冲的中心差分。比 computeVertexNormals() 更快、
    // 不分配对象，且边界顶点也拿到正确的坡向（避免块接缝出现亮暗带）。
    vi = 0;
    for (let iz = 0; iz <= SEG_Z; iz++) {
      for (let ix = 0; ix <= SEG_X; ix++, vi++) {
        const hL = hbuf[ix > 0 ? vi - 1 : vi], hR = hbuf[ix < SEG_X ? vi + 1 : vi];
        const hU = hbuf[iz > 0 ? vi - NVX : vi], hD = hbuf[iz < SEG_Z ? vi + NVX : vi];
        const sx = (ix > 0 && ix < SEG_X) ? 2 * TDX : TDX;
        const sz = (iz > 0 && iz < SEG_Z) ? 2 * TDZ : TDZ;
        let nx = (hL - hR) / sx, ny = 1, nz = (hD - hU) / sz;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nrm[vi * 3] = nx * inv; nrm[vi * 3 + 1] = ny * inv; nrm[vi * 3 + 2] = nz * inv;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.computeBoundingSphere();

    /* ---- 溪流条带 ---- */
    const wp = this.waterGeo.attributes.position.array;
    const rows = SEG_Z * 2 + 1;
    for (let i = 0; i < rows; i++) {
      const lz = -i * (CHUNK_D / (rows - 1)), wz = zStart + lz;
      const sx = streamX(wz), wy = waterLevel(wz);
      wp[i * 6] = sx - 6.6; wp[i * 6 + 1] = wy; wp[i * 6 + 2] = lz;
      wp[i * 6 + 3] = sx + 6.6; wp[i * 6 + 4] = wy; wp[i * 6 + 5] = lz;
    }
    this.waterGeo.attributes.position.needsUpdate = true;
    this.waterGeo.computeBoundingSphere();
    this.water.visible = true;

    /* ---- 碰撞体清空 ---- */
    this.colliders.length = 0;

    /* ---- 植被 ---- */
    const dummy = CHUNK_DUMMY;
    const cvar = new THREE.Color();
    const nearTown = (-zStart > COURSE_LEN - 300);
    // 草
    const grassCount = Math.min(this.grass.instanceMatrix.count,
      Math.floor(Q.grass * settings.grassMul));
    let gi = 0;
    for (let i = 0; i < grassCount; i++) {
      const wz = zStart - rng() * CHUNK_D;
      const cx = pathX(wz);                      // 路线中心只求一次（两次 sin）
      const x = cx + (rng() - 0.5) * 64;
      const d = Math.abs(x - cx);
      // 先做便宜的剔除，再算 mudAt：省掉大量哈希查表
      if (d < 4.2 || Math.abs(x - streamX(wz)) < 6.8) continue;
      const tz = wz - FINISH_Z;
      if (tz < 5 && tz > -78 && Math.abs(x) < 33) continue;   // 镇口广场留白
      if (mudAt(x, wz) > 0.3) continue;
      const h = heightAt(x, wz);
      const s = 0.62 + rng() * 0.62;
      dummy.position.set(x, h - 0.05, wz - zStart);
      dummy.rotation.set(0, rng() * TAU, (rng() - 0.5) * 0.22);
      dummy.scale.set(s * (0.85 + rng() * 0.45), s * (0.8 + rng() * 0.70), s);
      dummy.updateMatrix();
      this.grass.setMatrixAt(gi, dummy.matrix);
      const f = rng();
      if (f > 0.955) cvar.setHex(f > 0.985 ? 0xff7fb8 : (f > 0.97 ? 0xffe07a : 0xfff4e0)).multiplyScalar(1.15);
      else cvar.setRGB(0.86 + rng() * 0.30, 0.90 + rng() * 0.26, 0.80 + rng() * 0.30);
      this.grass.setColorAt(gi, cvar);
      gi++;
    }
    this.grass.count = gi;
    this.grass.instanceMatrix.needsUpdate = true;
    if (this.grass.instanceColor) this.grass.instanceColor.needsUpdate = true;

    // 松树 / 阔叶树 / 岩石 / 灌木
    const fill = (mesh, count, kind) => {
      let n = 0;
      const isRock = kind === 'rock';
      const minD = kind === 'pine' ? 9 : kind === 'broad' ? 10 : kind === 'ruin' ? 16 : isRock ? 6.5 : 6.0;
      for (let i = 0; i < count; i++) {
        const x = (rng() - 0.5) * (CHUNK_W - 8);
        const lz = -rng() * CHUNK_D, wz = zStart + lz;
        const d = Math.abs(x - pathX(wz));
        if (d < minD) continue;                 // 先做最便宜的剔除，再求 fbm
        const forest = fbm(x * 0.008 + 5.1, wz * 0.008 - 2.3, 2);
        if (kind === 'pine' && forest < 0.02) continue;
        if (kind === 'broad' && forest > 0.1) continue;
        if (Math.abs(x - streamX(wz)) < (isRock ? 3.5 : 6.2)) continue;
        if (townBlend(x, wz) > 0.35) continue;
        if (!isRock && mudAt(x, wz) > 0.35) continue;
        const h = heightAt(x, wz);
        let s;
        if (kind === 'pine') s = 0.85 + rng() * 1.15;
        else if (kind === 'broad') s = 0.8 + rng() * 0.9;
        else if (kind === 'ruin') s = 0.9 + rng() * 0.7;
        else if (isRock) s = 0.55 + rng() * 1.9;
        else s = 0.7 + rng() * 0.9;
        dummy.position.set(x, h - (isRock ? s * 0.35 : 0.12), lz);
        dummy.rotation.set(isRock ? (rng() - 0.5) * 0.5 : 0, rng() * TAU, isRock ? (rng() - 0.5) * 0.5 : 0);
        dummy.scale.set(s * (0.85 + rng() * 0.3), s * (0.85 + rng() * 0.4), s * (0.85 + rng() * 0.3));
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        const t = 0.82 + rng() * 0.36;
        cvar.setRGB(t * (0.95 + rng() * 0.1), t, t * (0.9 + rng() * 0.14));
        mesh.setColorAt(n, cvar);
        // 靠近路线的树与岩石才是碰撞体
        if (d < 30 && (kind === 'pine' || kind === 'broad' || kind === 'rock' || kind === 'ruin')) {
          const rr = kind === 'rock' ? s * 0.95 : kind === 'ruin' ? s * 1.5 : s * 0.55;
          if (kind === 'ruin' || kind !== 'rock' || s > 0.85) {
            this.colliders.push({ type: kind === 'rock' || kind === 'ruin' ? 'rock' : 'tree', x, z: wz, r: rr, y: h });
          }
        }
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    fill(this.pines, Math.floor(Q.pines * (nearTown ? 0.4 : 1)), 'pine');
    fill(this.broad, Math.floor(Q.pines * 0.42 * (nearTown ? 0.5 : 1)), 'broad');
    fill(this.rocks, Math.floor(Q.rocks * D.obstacles), 'rock');
    fill(this.bushes, Math.floor(Q.pines * 0.5), 'bush');
    fill(this.ruins, nearTown ? 1 : 3, 'ruin');

    /* ---- 崖壁瀑布：沿谷壁坡面铺一条贴地水练，从崖顶泻到阶地 ---- */
    for (const f of this.falls) { f.on = false; f.mesh.visible = false; f.foam.visible = false; }
    if (-zStart > 60 && -zStart < COURSE_LEN - 200) {
      for (const f of this.falls) {
        if (rng() > 0.62) continue;
        const side = rng() < 0.5 ? -1 : 1;
        const wz = zStart - rng() * CHUNK_D;
        const cx = pathX(wz);
        const xTop = cx + side * 58, xBot = cx + side * 30;
        const hgt = heightAt(xTop, wz) - heightAt(xBot, wz);
        if (hgt < 5) continue;
        const w = 3.0 + rng() * 2.0, SEG = 8;
        const pos = new Float32Array((SEG + 1) * 2 * 3);
        const uv = new Float32Array((SEG + 1) * 2 * 2);
        const idx = new Uint16Array(SEG * 6);
        for (let t = 0; t <= SEG; t++) {
          const x = xTop + (xBot - xTop) * (t / SEG);
          const y = heightAt(x, wz) + 0.14;
          for (let s = 0; s < 2; s++) {
            const o = (t * 2 + s) * 3;
            pos[o] = x; pos[o + 1] = y; pos[o + 2] = wz - zStart + (s ? w / 2 : -w / 2);
            const uo = (t * 2 + s) * 2;
            uv[uo] = s; uv[uo + 1] = t / SEG;
          }
          if (t < SEG) {
            const a = t * 2, b = a + 1, c = a + 2, d = a + 3, o = t * 6;
            idx[o] = a; idx[o + 1] = b; idx[o + 2] = c;
            idx[o + 3] = b; idx[o + 4] = d; idx[o + 5] = c;
          }
        }
        f.mesh.geometry.dispose();
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.computeBoundingSphere();
        f.mesh.geometry = g;
        f.on = true; f.x = xBot; f.z = wz; f.y = heightAt(xBot, wz);
        f.mesh.visible = true;
        f.foam.visible = true;
        f.foam.position.set(xBot - side * 1.5, f.y + 0.10, wz - zStart);
        f.foam.scale.set(w * 0.8, 1, w * 0.6);
      }
    }

    /* ---- 互动道具 ---- */
    for (const p of this.props) { p.active = false; p.broken = false; p.cool = 0; p.anim = 0; p.mesh.visible = false; }
    const place = (p, x, wz, yaw, yOff) => {
      const h = heightAt(x, wz);
      p.active = true; p.x = x; p.z = wz; p.y = h + (yOff || 0); p.yaw = yaw || 0;
      p.mesh.visible = true;
      p.mesh.position.set(x, p.y, wz - zStart);
      p.mesh.rotation.set(0, p.yaw, 0);
      p.mesh.scale.set(1, 1, 1);
      return p;
    };
    const usable = -zStart < COURSE_LEN - 90 && -zStart > 40;
    if (usable) {
      // 跳台：稀疏而有节奏，约每 200m 一座，落在路线上
      const rr = rng();
      const rampN = rr < 0.68 ? 0 : (rr < 0.95 ? 1 : 2);
      for (let i = 0; i < rampN && i < 2; i++) {
        const wz = zStart - 18 - i * 38 - rng() * 12;
        const x = pathX(wz) + (rng() - 0.5) * 9;
        const p = place(this.props.filter(q => q.type === 'ramp')[i], x, wz, pathYaw(wz), -0.25);
        p.mesh.position.y = p.y;
      }
      // 加速环
      const ringN = Math.round((rng() < 0.4 ? 2 : 1) * D.rings);
      const rings = this.props.filter(q => q.type === 'ring');
      for (let i = 0; i < ringN && i < rings.length; i++) {
        const wz = zStart - 30 - i * 34 - rng() * 14;
        const x = pathX(wz) + (rng() - 0.5) * 12;
        place(rings[i], x, wz, pathYaw(wz), 2.75);
      }
      // 木箱堆
      const crates = this.props.filter(q => q.type === 'crate');
      const cn = Math.min(crates.length, Math.round((2 + rng() * 4) * D.crates));
      const cz = zStart - 12 - rng() * 56;
      const cx = pathX(cz) + (rng() - 0.5) * 14;
      for (let i = 0; i < cn; i++) {
        const ox = (i % 3 - 1) * 1.15, oz = Math.floor(i / 3) * 1.15;
        const x = cx + ox, wz = cz + oz;
        const p = place(crates[i], x, wz, rng() * 0.6 - 0.3, 0);
        if (i >= 3 && cn > 4) { p.mesh.position.y = p.y + 1.06; p.y += 1.06; }
      }
      // 栅栏
      if (rng() < 0.55 * D.obstacles) {
        const fz = zStart - 20 - rng() * 48;
        const fx = pathX(fz) + (rng() - 0.5) * 10;
        place(this.props.filter(q => q.type === 'fence')[0], fx, fz, pathYaw(fz) + (rng() - 0.5) * 0.3, 0);
      }
      // 蘑菇
      const mush = this.props.filter(q => q.type === 'mushroom');
      const mn = rng() < 0.5 ? 1 : 2;
      for (let i = 0; i < mn; i++) {
        const mz = zStart - 14 - rng() * 60;
        const mx = pathX(mz) + (rng() < 0.5 ? -1 : 1) * (3 + rng() * 7);
        place(mush[i], mx, mz, rng() * TAU, -0.1);
      }
      // 倒木
      if (rng() < 0.45 * D.obstacles) {
        const lz2 = zStart - 24 - rng() * 44;
        const lx = pathX(lz2) + (rng() - 0.5) * 12;
        place(this.props.filter(q => q.type === 'log')[0], lx, lz2, pathYaw(lz2) + (rng() - 0.5) * 0.5, 0.55);
      }
    }
    // 检查点门
    for (let i = 0; i < CP_Z.length; i++) {
      const cz = CP_Z[i];
      if (cz <= zStart && cz > zStart - CHUNK_D) {
        const gx = pathX(cz);
        const p = place(this.gate, gx - 6, cz, pathYaw(cz), 0);
        p.cpIndex = i;
        p.mesh.position.set(gx - 6, heightAt(gx - 6, cz), cz - zStart);
        p.x = gx; p.z = cz;
      }
    }
    // 道具碰撞体
    for (const p of this.props) {
      if (!p.active || p.type === 'gate' || p.type === 'ring' || p.type === 'ramp') continue;
      this.colliders.push({ type: p.type, x: p.x, z: p.z, r: p.r, y: p.y, prop: p });
    }
  }

  setHidden(hide) { this.group.visible = !hide; }
}
let CHUNK_DUMMY = null;

/* --------------------------- 小镇 --------------------------- */
let town = null;
function buildTown() {
  town = new THREE.Group();
  town.position.set(0, TOWN_Y.v, FINISH_Z);
  scene.add(town);
  const rng = mulberry32(884422);
  const wallCols = [0xf3e3c0, 0xf7d9b0, 0xe8e0cf, 0xf2cfa8];
  const roofCols = [0xd45f4a, 0x3f8fb0, 0x6aa84f, 0xc9793f, 0x8a6fb0];

  const houseGeoCache = [];
  const makeHouse = (w, d, hgt, wallCol, roofCol) => {
    const parts = [];
    const body = new THREE.BoxGeometry(w, hgt, d); body.translate(0, hgt / 2, 0); tintGeo(body, wallCol, 0.05);
    parts.push(body);
    // 木梁
    for (const sx of [-1, 1]) {
      const beam = new THREE.BoxGeometry(0.22, hgt, 0.22); beam.translate(sx * (w / 2 - 0.1), hgt / 2, d / 2 - 0.1); tintGeo(beam, 0x8a5a30, 0.05);
      parts.push(beam);
      const beam2 = beam.clone(); beam2.translate(0, 0, -(d - 0.2)); parts.push(beam2);
    }
    const belt = new THREE.BoxGeometry(w + 0.1, 0.2, d + 0.1); belt.translate(0, hgt * 0.55, 0); tintGeo(belt, 0x8a5a30, 0.05);
    parts.push(belt);
    // 屋顶（三棱柱）
    const roofH = hgt * 0.62;
    const rp = [], rc = [];
    const cR = new THREE.Color(roofCol), cR2 = new THREE.Color(roofCol).multiplyScalar(0.82);
    const push = (x, y, z, c) => { rp.push(x, y, z); rc.push(c.r, c.g, c.b); };
    const tri = (a, b, c, cc) => { push(a[0], a[1], a[2], cc); push(b[0], b[1], b[2], cc); push(c[0], c[1], c[2], cc); };
    const quad = (a, b, c, dd, cc) => { tri(a, b, c, cc); tri(a, c, dd, cc); };
    const ex = w / 2 + 0.35, ez = d / 2 + 0.35, y0 = hgt, y1 = hgt + roofH;
    quad([-ex, y0, ez], [ex, y0, ez], [0, y1, ez], [0, y1, ez], cR2);
    tri([-ex, y0, -ez], [0, y1, -ez], [ex, y0, -ez], cR2);
    quad([-ex, y0, -ez], [-ex, y0, ez], [0, y1, ez], [0, y1, -ez], cR);
    quad([ex, y0, ez], [ex, y0, -ez], [0, y1, -ez], [0, y1, ez], cR);
    const roof = new THREE.BufferGeometry();
    roof.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rp), 3));
    roof.setAttribute('color', new THREE.BufferAttribute(new Float32Array(rc), 3));
    roof.computeVertexNormals();
    parts.push(roof);
    // 门
    const door = new THREE.BoxGeometry(w * 0.26, hgt * 0.52, 0.14); door.translate(0, hgt * 0.26, d / 2 + 0.02); tintGeo(door, 0x7a4f28, 0.05);
    parts.push(door);
    // 烟囱
    const ch = new THREE.BoxGeometry(0.5, roofH + 0.9, 0.5); ch.translate(w * 0.28, hgt + roofH * 0.5 + 0.4, -d * 0.2); tintGeo(ch, 0xb0a49a, 0.05);
    parts.push(ch);
    const g = mergeGeos(parts); parts.forEach(x => x.dispose());
    return { geo: g, chimX: w * 0.28, chimY: hgt + roofH + 0.85, chimZ: -d * 0.2, hgt, w, d };
  };

  const winMat = M.glow(0xffc46a, 1.75);
  const winGeo = new THREE.BoxGeometry(0.7, 0.8, 0.1);
  const houses = [];
  for (let i = 0; i < 22; i++) {
    const side = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    const w = 5.4 + rng() * 3.0, d = 5.0 + rng() * 2.6, hgt = 4.2 + rng() * 2.8;
    const info = makeHouse(w, d, hgt, wallCols[i % wallCols.length], roofCols[(i * 3) % roofCols.length]);
    houseGeoCache.push(info.geo);
    const mesh = new THREE.Mesh(info.geo, M.toon(0xffffff, { vertexColors: true }));
    M.outline(mesh, 0.05);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const px = side * (12 + rng() * 13 + (row > 5 ? 9 : 0));
    const pz = -9 - row * 13.5 - rng() * 4;
    const gy = heightAt(px, FINISH_Z + pz) - TOWN_Y.v;
    mesh.position.set(px, gy, pz);
    mesh.rotation.y = side > 0 ? -0.35 - rng() * 0.3 : 0.35 + rng() * 0.3;
    town.add(mesh);
    // 暖色窗光
    for (let k = 0; k < 2; k++) {
      const win = new THREE.Mesh(winGeo, winMat);
      win.position.set((k ? 1 : -1) * w * 0.26, hgt * 0.66, d / 2 + 0.06);
      mesh.add(win);
    }
    houses.push({ mesh, chim: new THREE.Vector3(px, gy + info.chimY, pz).add(town.position), t: rng() * 3 });
  }
  town.userData.houses = houses;
  town.userData.geoCache = houseGeoCache;

  // 风车
  const mill = new THREE.Group();
  const tower = new THREE.CylinderGeometry(2.0, 2.8, 9, 10); tower.translate(0, 4.5, 0); tintGeo(tower, 0xf0e0bd, 0.05);
  const mroof = new THREE.ConeGeometry(2.6, 2.6, 10); mroof.translate(0, 10.3, 0); tintGeo(mroof, 0xd45f4a, 0.05);
  const millBody = new THREE.Mesh(mergeGeos([tower, mroof]), M.toon(0xffffff, { vertexColors: true }));
  tower.dispose(); mroof.dispose();
  M.outline(millBody, 0.06); millBody.castShadow = true;
  mill.add(millBody);
  const blades = new THREE.Group();
  blades.position.set(0, 8.4, 2.6);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.BoxGeometry(0.3, 6.4, 0.16); arm.translate(0, 3.2, 0); tintGeo(arm, 0x8a5a30, 0.04);
    const sail = new THREE.BoxGeometry(1.3, 5.0, 0.08); sail.translate(0.85, 3.4, 0.12); tintGeo(sail, 0xf8f0dc, 0.03);
    const b = new THREE.Mesh(mergeGeos([arm, sail]), M.toon(0xffffff, { vertexColors: true }));
    arm.dispose(); sail.dispose();
    b.rotation.z = i * Math.PI / 2;
    b.castShadow = true;
    blades.add(b);
  }
  mill.add(blades);
  const mx = -27, mz = -56;
  mill.position.set(mx, heightAt(mx, FINISH_Z + mz) - TOWN_Y.v, mz);
  town.add(mill);
  town.userData.blades = blades;

  // 广场地面
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(30, 32), M.toon(0xd9b884, {}));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.04, -42);
  plaza.receiveShadow = true;
  town.add(plaza);

  // 水井
  const wellParts = [];
  const wr = new THREE.CylinderGeometry(1.3, 1.4, 1.1, 10); wr.translate(0, 0.55, 0); tintGeo(wr, 0xa9a2c4, 0.06);
  const wp1 = new THREE.BoxGeometry(0.18, 2.0, 0.18); wp1.translate(-1.1, 1.6, 0); tintGeo(wp1, 0x8a5a30, 0.05);
  const wp2 = wp1.clone(); wp2.translate(2.2, 0, 0);
  const wroof = new THREE.ConeGeometry(1.9, 1.1, 4); wroof.translate(0, 3.1, 0); wroof.rotateY(Math.PI / 4); tintGeo(wroof, 0xd45f4a, 0.05);
  wellParts.push(wr, wp1, wp2, wroof);
  const well = new THREE.Mesh(mergeGeos(wellParts), M.toon(0xffffff, { vertexColors: true }));
  wellParts.forEach(g => g.dispose());
  M.outline(well, 0.04); well.castShadow = true;
  well.position.set(6, 0, -44);
  town.add(well);

  // 路灯（暖光）
  const lampMat = M.glow(0xffcf7a, 2.0);
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    const lz = -10 - Math.floor(i / 2) * 22;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 3.4, 6), M.toon(0x6b563c));
    const lx = side * 8.5;
    post.position.set(lx, heightAt(lx, FINISH_Z + lz) - TOWN_Y.v + 1.7, lz);
    post.castShadow = true;
    town.add(post);
    const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), lampMat);
    bulb.position.set(lx, post.position.y + 1.9, lz);
    town.add(bulb);
  }

  // 终点拱门
  const arch = new THREE.Group();
  const pillarGeoL = new THREE.BoxGeometry(1.6, 8.2, 1.6); pillarGeoL.translate(-7.5, 4.1, 0); tintGeo(pillarGeoL, 0xf0e0bd, 0.05);
  const pillarGeoR = new THREE.BoxGeometry(1.6, 8.2, 1.6); pillarGeoR.translate(7.5, 4.1, 0); tintGeo(pillarGeoR, 0xf0e0bd, 0.05);
  const topBeam = new THREE.BoxGeometry(17.4, 1.5, 1.9); topBeam.translate(0, 8.6, 0); tintGeo(topBeam, 0xd45f4a, 0.05);
  const trim = new THREE.BoxGeometry(17.8, 0.35, 2.1); trim.translate(0, 7.7, 0); tintGeo(trim, 0xffb020, 0.03);
  const archMesh = new THREE.Mesh(mergeGeos([pillarGeoL, pillarGeoR, topBeam, trim]), M.toon(0xffffff, { vertexColors: true }));
  [pillarGeoL, pillarGeoR, topBeam, trim].forEach(g => g.dispose());
  M.outline(archMesh, 0.06); archMesh.castShadow = true;
  arch.add(archMesh);
  const goalTex = canvasTexture(512, 128, (c, w, h) => {
    const grd = c.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#f6e7c4'); grd.addColorStop(0.5, '#fff6dd'); grd.addColorStop(1, '#f6e7c4');
    c.fillStyle = grd; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#0e7fa8'; c.lineWidth = 8; c.strokeRect(5, 5, w - 10, h - 10);
    c.fillStyle = '#123c4e'; c.font = 'bold 62px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('GOAL', w / 2, h / 2 - 6);
    c.fillStyle = '#0e7fa8'; c.font = '20px Georgia, serif';
    c.fillText('溪 谷 镇 · RIVERDELL', w / 2, h - 26);
  });
  const goalBanner = new THREE.Mesh(new THREE.PlaneGeometry(14.6, 3.2), new THREE.MeshBasicMaterial({ map: goalTex, side: THREE.DoubleSide, toneMapped: false }));
  goalBanner.position.set(0, 6.0, 0.1);
  arch.add(goalBanner);
  const archGlow = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.18, 0.18), M.glow(0x35e0ff, 2.6));
  archGlow.position.set(0, 4.2, 0);
  arch.add(archGlow);
  const archGlow2 = archGlow.clone(); archGlow2.position.y = 2.2; arch.add(archGlow2);
  arch.position.set(0, heightAt(0, FINISH_Z) - TOWN_Y.v, 0);
  town.add(arch);
  town.userData.arch = arch;
  town.userData.archGlow = [archGlow, archGlow2];

  // 镇口旗帜
  const flagTex = canvasTexture(128, 96, (c, w, h) => {
    c.fillStyle = '#35e0ff'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#0a3d54';
    c.beginPath(); c.ellipse(w / 2, h / 2, 26, 16, 0, 0, TAU); c.fill();
    c.fillStyle = '#f6e7c4'; c.beginPath(); c.arc(w / 2, h / 2, 8, 0, TAU); c.fill();
    c.fillStyle = '#0a3d54'; c.beginPath(); c.moveTo(w / 2, h / 2 + 14); c.lineTo(w / 2 - 9, h / 2 + 30); c.lineTo(w / 2 + 9, h / 2 + 30); c.closePath(); c.fill();
  });
  const flagMat = new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide, toneMapped: false });
  town.userData.flags = [];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const fz = -6 - Math.floor(i / 2) * 14;
    const fx = side * 10.5;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5.2, 6), M.toon(0x8a5a30));
    pole.position.set(fx, heightAt(fx, FINISH_Z + fz) - TOWN_Y.v + 2.6, fz);
    town.add(pole);
    const flag = new THREE.Mesh(GEO.flag, flagMat);
    flag.position.set(fx + side * 0.78, pole.position.y + 1.9, fz);
    flag.userData.base = flag.geometry.attributes.position.array.slice();
    town.add(flag);
    town.userData.flags.push(flag);
  }
  town.visible = false;
  buildLandmark();
}

/* --------------------------- 地平线发光塔 --------------------------- */
/* 参考图远处那座橙顶蓝环的高塔：放在赛程中段侧翼山脊上，作为途中地标。
   纯程序化几何：收分石塔 + 青色光环 + 琥珀塔顶信标，泛光自然拾取。 */
function buildLandmark() {
  const g = new THREE.Group();
  const x = 26, z = FINISH_Z - 180;
  const y = heightAt(x, z);
  const stone = M.toon(0x8a97a4);
  let r = 7, yy = 0;
  for (let i = 0; i < 6; i++) {
    const h = 12 - i * 1.2;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r, h, 8), stone);
    seg.position.y = yy + h / 2;
    g.add(seg);
    yy += h; r *= 0.82;
    if (i === 1 || i === 3 || i === 5) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.30, 6, 20), M.glow(0x35e0ff, 2.6));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = yy;
      g.add(ring);
    }
  }
  const crown = new THREE.Mesh(new THREE.ConeGeometry(r * 1.5, 6, 8), M.toon(0xd4a24a));
  crown.position.y = yy + 3;
  g.add(crown);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), M.glow(0xffb020, 3.4));
  beacon.position.y = yy + 7;
  g.add(beacon);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 0.5), stone);
    arm.position.set(Math.cos(i * 1.57) * 4, 26 + i * 7, Math.sin(i * 1.57) * 4);
    arm.rotation.y = i * 1.57;
    g.add(arm);
  }
  g.position.set(x, y - 2, z);
  scene.add(g);
}

/* --------------------------- 世界管理器 --------------------------- */
class World {
  constructor() {
    this.chunks = [];
    this.map = new Map();
    for (let i = 0; i < POOL_SIZE; i++) this.chunks.push(new Chunk());
    this.shadowTimer = 0;
    this.smokeTimer = 0;
    this.lastCenter = -99999;
    this.dummy = new THREE.Object3D();
    this.tmpV = new THREE.Vector3();
  }
  reset(centerZ) {
    this.map.clear();
    for (const c of this.chunks) { c.index = -99999; c.setHidden(true); }
    this.lastCenter = -99999;
    this.update(0, { x: 0, y: START_H, z: centerZ }, 0, true);
  }
  ensure(centerIndex) {
    if (centerIndex === this.lastCenter) return;
    this.lastCenter = centerIndex;
    const lo = centerIndex - Q.behind, hi = centerIndex + Q.ahead;
    // 释放窗口外的区块
    for (const [idx, c] of this.map) {
      if (idx < lo || idx > hi) { this.map.delete(idx); c.setHidden(true); c.index = -99999; }
    }
    for (let i = lo; i <= hi; i++) {
      if (this.map.has(i)) continue;
      let free = null;
      for (const c of this.chunks) if (c.index === -99999) { free = c; break; }
      if (!free) {
        // 回收距离最远的
        let far = null, fd = -1;
        for (const c of this.chunks) {
          const d = Math.abs(c.index - centerIndex);
          if (d > fd) { fd = d; far = c; }
        }
        this.map.delete(far.index);
        free = far;
      }
      free.build(i);
      this.map.set(i, free);
    }
  }
  chunksNear(z) {
    const i = Math.floor(-z / CHUNK_D);
    const out = [];
    for (let k = i - 1; k <= i + 1; k++) { const c = this.map.get(k); if (c) out.push(c); }
    return out;
  }
  update(dt, p, time, force) {
    const ci = Math.floor(-p.z / CHUNK_D);
    this.ensure(ci);
    // 草只在近处渲染
    for (const [idx, c] of this.map) {
      const rel = idx - ci;
      c.grass.visible = rel <= 2 && rel >= -1 && settings.grassMul > 0;
    }
    grassMat.userData.uniforms.uTime.value = time;
    grassMat.userData.uniforms.uWind.value = 1.0;
    waterMat.uniforms.uTime.value = time;
    skyMat.uniforms.time.value = time;
    fallMat.uniforms.uTime.value = time;

    // 飘叶：玩家周围盒内漂移 + 回绕，逆光里读作叶屑 / 光点
    if (motes) {
      const a = motes.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        a[i] += moteVel[i] * dt; a[i + 1] += moteVel[i + 1] * dt; a[i + 2] += moteVel[i + 2] * dt;
        if (a[i] - p.x > 32) a[i] -= 64; else if (a[i] - p.x < -32) a[i] += 64;
        if (a[i + 1] - p.y > 16) a[i + 1] -= 16; else if (a[i + 1] - p.y < -2) a[i + 1] += 16;
        if (a[i + 2] - p.z > 32) a[i + 2] -= 64; else if (a[i + 2] - p.z < -32) a[i + 2] += 64;
      }
      motes.geometry.attributes.position.needsUpdate = true;
    }

    // 近处瀑布底部的水雾
    this.mistTimer = (this.mistTimer || 0) - dt;
    if (this.mistTimer <= 0) {
      this.mistTimer = 0.24;
      for (const [idx, c] of this.map) {
        for (const f of c.falls) {
          if (!f.on || Math.abs(p.z - f.z) > 90) continue;
          FX.spawn(f.x + rand(-1, 1), f.y + 0.4, f.z + rand(-1, 1),
            rand(-0.6, 0.6), rand(0.8, 1.6), rand(-0.6, 0.6),
            0xeaf6ff, rand(0.6, 1.1), 1.6, 'smoke');
        }
      }
    }

    // 道具动画
    for (const [idx, c] of this.map) {
      for (const pr of c.props) {
        if (!pr.active) continue;
        if (pr.type === 'ring') {
          pr.mesh.rotation.z = time * 0.9 + pr.x;
          const pulse = 0.86 + Math.sin(time * 3.4 + pr.z) * 0.1;
          pr.mesh.userData.inner.scale.setScalar(pulse);
          pr.mesh.userData.inner.material.opacity = pr.cool > 0 ? 0.05 : 0.18 + Math.sin(time * 4 + pr.z) * 0.06;
          if (pr.cool > 0) { pr.cool -= dt; if (pr.cool <= 0) pr.mesh.visible = true; }
        } else if (pr.type === 'mushroom' && pr.anim > 0) {
          pr.anim = Math.max(0, pr.anim - dt * 3.2);
          const s = 1 + Math.sin(pr.anim * Math.PI) * 0.35;
          pr.mesh.scale.set(s, 2 - s, s);
        } else if (pr.type === 'gate') {
          pr.mesh.userData.glow.scale.x = 1 + Math.sin(time * 2.6) * 0.02;
        }
      }
    }

    // 天空 / 云 / 远山跟随相机
    sky.position.copy(camera.position);
    mountainGroup.position.set(camera.position.x, camera.position.y - 230, camera.position.z);
    cloudGroup.position.set(
      camera.position.x + Math.sin(time * 0.013) * 40,
      camera.position.y - 30,
      camera.position.z + Math.cos(time * 0.011) * 40
    );
    cloudGroup.rotation.y = time * 0.004;

    // 小镇
    const townDist = Math.abs(p.z - FINISH_Z);
    town.visible = townDist < 760;
    if (town.visible) {
      town.userData.blades.rotation.z += dt * 0.55;
      for (let i = 0; i < town.userData.flags.length; i++) {
        const f = town.userData.flags[i];
        const arr = f.geometry.attributes.position.array;
        const base = f.userData.base;
        for (let v = 0; v < arr.length; v += 3) {
          const u = (base[v] + 0.75) / 1.5;
          arr[v + 2] = base[v + 2] + Math.sin(time * 5 + u * 5 + i) * 0.16 * u;
          arr[v + 1] = base[v + 1] + Math.sin(time * 4.2 + u * 4 + i) * 0.05 * u;
        }
        f.geometry.attributes.position.needsUpdate = true;
      }
      const gl = 1.9 + Math.sin(time * 2.2) * 0.5;
      town.userData.archGlow.forEach(g => g.material.color.setHex(0x35e0ff).multiplyScalar(gl));
      // 炊烟
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0 && townDist < 420) {
        this.smokeTimer = 0.16;
        const hs = town.userData.houses;
        const h = hs[Math.floor(Math.random() * hs.length)];
        FX.spawn(h.chim.x + rand(-0.2, 0.2), h.chim.y, h.chim.z + rand(-0.2, 0.2),
          rand(-0.25, 0.25), rand(1.1, 1.9), rand(-0.25, 0.25),
          0xd8d2c8, rand(0.5, 0.9), 2.8, 'smoke');
      }
    }

    // 阳光与阴影跟随（阴影贴图固定尺寸、按需刷新）
    const tx = Math.round(p.x / 4) * 4, tz = Math.round(p.z / 4) * 4;
    const ty = heightAt(tx, tz);
    sun.target.position.set(tx, ty, tz);
    sun.position.set(tx + SUN_DIR.x * 95, ty + SUN_DIR.y * 95, tz + SUN_DIR.z * 95);
    fillLight.position.set(tx + 60, ty + 50, tz + 70);
    fillLight.target.position.set(tx, ty, tz);
    this.shadowTimer -= dt;
    if (this.shadowTimer <= 0 || force) {
      this.shadowTimer = 0.1;
      renderer.shadowMap.needsUpdate = true;
    }
  }
}