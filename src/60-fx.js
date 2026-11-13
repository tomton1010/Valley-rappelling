/* ============================================================================
 * 60 · 特效：粒子对象池 / 悬浮板光带尾迹 / 速度线 / 屏幕反馈
 * ========================================================================== */
const FX = {
  solid: null, glow: null,
  pool: [], glowPool: [],
  dummy: null, col: null,
  trail: null, trailPts: null, trailHead: 0, trailFill: 0,
  ctx2d: null, lines: [], shake: 0, rush: 0, flashT: 0,
  MAX_SOLID: 620, MAX_GLOW: 300, TRAIL_N: 40,

  init() {
    this.dummy = new THREE.Object3D();
    this.col = new THREE.Color();
    const solidGeo = new THREE.IcosahedronGeometry(0.5, 0);
    const glowGeo = new THREE.IcosahedronGeometry(0.5, 0);
    this.solid = new THREE.InstancedMesh(solidGeo,
      new THREE.MeshBasicMaterial({ toneMapped: true }), this.MAX_SOLID);
    this.solid.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.solid.frustumCulled = false;
    this.solid.count = 0;
    this.solid.castShadow = false;
    scene.add(this.solid);
    this.glow = new THREE.InstancedMesh(glowGeo,
      new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      this.MAX_GLOW);
    this.glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glow.frustumCulled = false;
    this.glow.count = 0;
    scene.add(this.glow);

    for (let i = 0; i < this.MAX_SOLID; i++) {
      this.pool.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, g: 20, drag: 1.2, kind: 'dirt', r: 1, gc: 1, b: 1, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0 });
    }
    for (let i = 0; i < this.MAX_GLOW; i++) {
      this.glowPool.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, g: 4, drag: 1.6, kind: 'spark', r: 1, gc: 1, b: 1, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0 });
    }

    // 光带尾迹
    const N = this.TRAIL_N;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const idx = new Uint16Array((N - 1) * 6);
    let o = 0;
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx[o++] = a; idx[o++] = b; idx[o++] = c;
      idx[o++] = b; idx[o++] = d; idx[o++] = c;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.trail = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false
    }));
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.trail.renderOrder = 3;
    scene.add(this.trail);
    this.trailPts = new Float32Array(N * 3);
    this.trailHead = 0; this.trailFill = 0;

    // 落点预测标记：空中时在地面画出弹道落点 + 姿态安全色
    this.marker = new THREE.Group();
    this.marker.visible = false;
    this.marker.frustumCulled = false;
    const ringG = new THREE.RingGeometry(0.80, 1.02, 44);
    ringG.rotateX(-Math.PI / 2);
    const coreG = new THREE.CircleGeometry(0.34, 26);
    coreG.rotateX(-Math.PI / 2);
    const mkMat = (op) => new THREE.MeshBasicMaterial({
      color: 0x7cff9e, transparent: true, opacity: op, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false
    });
    this.markerRing = new THREE.Mesh(ringG, mkMat(0.95));
    this.markerCore = new THREE.Mesh(coreG, mkMat(0.42));
    this.markerRing.renderOrder = 4; this.markerCore.renderOrder = 4;
    this.marker.add(this.markerRing, this.markerCore);
    scene.add(this.marker);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.tether = new THREE.Line(tg, new THREE.LineBasicMaterial({
      color: 0x7cff9e, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, fog: false
    }));
    this.tether.frustumCulled = false;
    this.tether.visible = false;
    this.tether.renderOrder = 4;
    scene.add(this.tether);

    // 速度线
    this.ctx2d = DOM.fx.getContext('2d');
    const rr = mulberry32(7788);
    for (let i = 0; i < 46; i++) {
      this.lines.push({ a: rr() * TAU, r: 0.28 + rr() * 0.6, len: 0.06 + rr() * 0.22, w: 0.6 + rr() * 2.2, sp: 0.6 + rr() * 1.4, ph: rr() });
    }
    this.resize();
  },

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    DOM.fx.width = Math.floor(window.innerWidth * dpr);
    DOM.fx.height = Math.floor(window.innerHeight * dpr);
    DOM.fx.style.width = window.innerWidth + 'px';
    DOM.fx.style.height = window.innerHeight + 'px';
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fxW = window.innerWidth; this.fxH = window.innerHeight;
    this.fxDirty = true;
  },

  take(pool) {
    for (let i = 0; i < pool.length; i++) if (!pool[i].on) return pool[i];
    // 全满：回收剩余寿命最短的
    let best = pool[0];
    for (let i = 1; i < pool.length; i++) if (pool[i].life < best.life) best = pool[i];
    return best;
  },

  spawn(x, y, z, vx, vy, vz, colorHex, size, life, kind) {
    const additive = (kind === 'spark' || kind === 'ring' || kind === 'star' || kind === 'glow');
    const p = this.take(additive ? this.glowPool : this.pool);
    const c = this.col.set(colorHex);
    p.on = true; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.max = life; p.size = size; p.kind = kind;
    p.r = c.r; p.gc = c.g; p.b = c.b;
    p.rx = Math.random() * TAU; p.ry = Math.random() * TAU; p.rz = Math.random() * TAU;
    p.sx = rand(-6, 6); p.sy = rand(-6, 6);
    if (kind === 'smoke') { p.g = -0.9; p.drag = 0.55; }
    else if (kind === 'splash') { p.g = 20; p.drag = 1.4; }
    else if (kind === 'wood') { p.g = 26; p.drag = 0.7; }
    else if (kind === 'spark') { p.g = 5; p.drag = 2.0; }
    else if (kind === 'ring') { p.g = 0; p.drag = 3.0; }
    else if (kind === 'star') { p.g = -1.2; p.drag = 1.1; }
    else if (kind === 'grass') { p.g = 22; p.drag = 1.6; }
    else { p.g = 22; p.drag = 1.2; }
    return p;
  },

  burst(x, y, z, n, colorHex, spread, size, life, kind, upBias) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, e = Math.random() * Math.PI * 0.5;
      const s = spread * (0.35 + Math.random() * 0.9);
      this.spawn(x, y, z,
        Math.cos(a) * Math.cos(e) * s,
        Math.sin(e) * s * (upBias === undefined ? 1.1 : upBias) + spread * 0.25,
        Math.sin(a) * Math.cos(e) * s,
        colorHex, size * (0.6 + Math.random() * 0.8), life * (0.7 + Math.random() * 0.6), kind);
    }
  },

  ringBurst(x, y, z, colorHex, n, radius) {
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU;
      this.spawn(x + Math.cos(a) * radius * 0.3, y + Math.sin(a) * radius * 0.3, z,
        Math.cos(a) * radius * 2.4, Math.sin(a) * radius * 2.4, rand(-1, 1),
        colorHex, 0.22, 0.55, 'ring');
    }
  },

  update(dt, playerPos, vehicle, speed01, grounded) {
    // ---- 粒子 ----
    let n = 0;
    const d = this.dummy;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; continue; }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += p.sx * dt; p.ry += p.sy * dt;
      const t = 1 - p.life / p.max;
      let s;
      if (p.kind === 'smoke') s = p.size * (0.45 + t * 1.7) * (1 - sstep(0.65, 1, t));
      else s = p.size * (1 - t * t * 0.92);
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.rx, p.ry, p.rz);
      d.scale.setScalar(Math.max(0.0001, s));
      d.updateMatrix();
      this.solid.setMatrixAt(n, d.matrix);
      this.col.setRGB(p.r, p.gc, p.b);
      if (p.kind === 'smoke') this.col.lerp(SMOKE_TINT, t * 0.6);
      this.solid.setColorAt(n, this.col);
      n++;
    }
    this.solid.count = n;
    this.solid.instanceMatrix.needsUpdate = true;
    if (this.solid.instanceColor) this.solid.instanceColor.needsUpdate = true;

    let m = 0;
    for (let i = 0; i < this.glowPool.length; i++) {
      const p = this.glowPool[i];
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; continue; }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = 1 - p.life / p.max;
      const s = p.kind === 'ring' ? p.size * (1 + t * 2.2) * (1 - t) : p.size * (1 - t * t);
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.rx + t * 3, p.ry + t * 2, p.rz);
      d.scale.setScalar(Math.max(0.0001, s));
      d.updateMatrix();
      this.glow.setMatrixAt(m, d.matrix);
      const k = (1 - t) * 2.6;
      this.col.setRGB(p.r * k, p.gc * k, p.b * k);
      this.glow.setColorAt(m, this.col);
      m++;
    }
    this.glow.count = m;
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;

    // ---- 尾迹 ----
    const wantTrail = vehicle === 'board' && speed01 > 0.06;
    this.trail.visible = wantTrail && this.trailFill > 3;
    if (wantTrail) {
      const anchor = vehicles && vehicles.boardRearAnchor;
      let ax = playerPos.x, ay = playerPos.y + 0.5, az = playerPos.z;
      if (anchor) { anchor.getWorldPosition(TMP_V1); ax = TMP_V1.x; ay = TMP_V1.y; az = TMP_V1.z; }
      this.trailHead = (this.trailHead + 1) % this.TRAIL_N;
      this.trailPts[this.trailHead * 3] = ax;
      this.trailPts[this.trailHead * 3 + 1] = ay;
      this.trailPts[this.trailHead * 3 + 2] = az;
      this.trailFill = Math.min(this.TRAIL_N, this.trailFill + 1);
      const pos = this.trail.geometry.attributes.position.array;
      const col = this.trail.geometry.attributes.color.array;
      const N = this.TRAIL_N;
      for (let i = 0; i < N; i++) {
        const src = (this.trailHead - i + N * 2) % N;
        const has = i < this.trailFill;
        const px = has ? this.trailPts[src * 3] : ax;
        const py = has ? this.trailPts[src * 3 + 1] : ay;
        const pz = has ? this.trailPts[src * 3 + 2] : az;
        const nxt = (src - 1 + N) % N;
        let dx = this.trailPts[nxt * 3] - px, dz = this.trailPts[nxt * 3 + 2] - pz;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        const fade = (1 - i / N);
        const w = 0.42 * fade + 0.06;
        pos[i * 6] = px - dz * w; pos[i * 6 + 1] = py; pos[i * 6 + 2] = pz + dx * w;
        pos[i * 6 + 3] = px + dz * w; pos[i * 6 + 4] = py; pos[i * 6 + 5] = pz - dx * w;
        const k = fade * fade * 2.3;
        const cr = 0.16 * k, cg = 0.85 * k, cb = 1.0 * k;
        col[i * 6] = cr; col[i * 6 + 1] = cg; col[i * 6 + 2] = cb;
        col[i * 6 + 3] = cr; col[i * 6 + 4] = cg; col[i * 6 + 5] = cb;
      }
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.trail.geometry.attributes.color.needsUpdate = true;
    } else if (this.trailFill > 0) {
      this.trailFill = Math.max(0, this.trailFill - 2);
    }

    // ---- 屏幕反馈 ----
    this.shake = Math.max(0, this.shake - dt * 2.6);
    this.rush = Math.max(0, this.rush - dt * 1.5);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) DOM.flash.classList.remove('on');
    }
    this.drawLines(speed01, dt);
  },

  drawLines(speed01, dt) {
    const ctx = this.ctx2d;
    const intensity = clamp((speed01 - 0.52) / 0.48, 0, 1) * 0.75 + this.rush * 0.9;
    if (intensity <= 0.01) {
      if (this.fxDirty) { ctx.clearRect(0, 0, this.fxW, this.fxH); this.fxDirty = false; }
      return;
    }
    this.fxDirty = true;
    ctx.clearRect(0, 0, this.fxW, this.fxH);
    const cx = this.fxW / 2, cy = this.fxH * 0.52;
    const R = Math.hypot(cx, cy);
    ctx.lineCap = 'round';
    const time = performance.now() * 0.001;
    for (let i = 0; i < this.lines.length; i++) {
      const L = this.lines[i];
      const t = (time * L.sp * (0.6 + intensity) + L.ph) % 1;
      const r0 = R * (L.r * 0.55 + t * 0.75);
      const r1 = r0 + R * L.len * (0.5 + intensity);
      const a = L.a + Math.sin(time * 0.3 + i) * 0.02;
      const alpha = intensity * 0.5 * Math.sin(t * Math.PI);
      if (alpha <= 0.01) continue;
      const c = this.rush > 0.2 ? 'rgba(150,240,255,' : 'rgba(255,255,255,';
      ctx.strokeStyle = c + alpha.toFixed(3) + ')';
      ctx.lineWidth = L.w * (0.6 + intensity);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    if (this.rush > 0.05) {
      const grd = ctx.createRadialGradient(cx, cy, R * 0.25, cx, cy, R);
      grd.addColorStop(0, 'rgba(53,224,255,0)');
      grd.addColorStop(1, 'rgba(53,224,255,' + (this.rush * 0.22).toFixed(3) + ')');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, this.fxW, this.fxH);
    }
  },

  /* 空中落点预测：沿当前弹道积分到地面，画出落点圈与高度引线。
     圈的颜色 = 此刻姿态能否干净落地（绿=稳 / 琥珀=偏 / 红=会摔）。 */
  updateLanding(p, time) {
    const show = !p.grounded && p.airTime > 0.1 && p.crashT <= 0;
    this.marker.visible = show;
    this.tether.visible = show;
    if (!show) return;
    const hx = -Math.sin(p.yaw) * p.speed, hz = -Math.cos(p.yaw) * p.speed;
    let x = p.pos.x, y = p.pos.y, z = p.pos.z, vy = p.vy;
    const h = 0.075;
    let fallT = 0;
    for (let i = 0; i < 26; i++) {
      vy -= GRAVITY * h;
      x += hx * h; z += hz * h; y += vy * h;
      fallT += h;
      const g = heightAt(x, z);
      if (y <= g) { y = g; break; }
    }
    const attempted = Math.abs(p.trickPitch) > 0.85 || Math.abs(p.trickYaw) > 0.85;
    const resP = Math.abs(wrapPi(p.trickPitch)), resY = Math.abs(wrapPi(p.trickYaw));
    const clean = resP < 1.25 && resY < 1.35;
    const marginal = clean && (resP > 0.8 || resY > 0.9);
    const hex = !attempted || clean ? (marginal ? 0xffc24a : 0x7cff9e) : 0xff6a5a;
    this.markerRing.material.color.setHex(hex);
    this.markerCore.material.color.setHex(hex);
    this.tether.material.color.setHex(hex);
    const alt = Math.max(0, p.pos.y - y);
    const s = clamp(1.0 + alt * 0.055, 1, 2.3) * (1 + Math.sin(time * 7) * 0.035);
    this.marker.position.set(x, y + 0.09, z);
    this.marker.scale.setScalar(s);
    this.markerCore.material.opacity = 0.24 + 0.30 * (1 - clamp(fallT / 1.6, 0, 1));
    const ta = this.tether.geometry.attributes.position.array;
    ta[0] = p.pos.x; ta[1] = p.pos.y + 0.2; ta[2] = p.pos.z;
    ta[3] = x; ta[4] = y + 0.12; ta[5] = z;
    this.tether.geometry.attributes.position.needsUpdate = true;
    this.tether.material.opacity = clamp(0.10 + alt * 0.022, 0.1, 0.4);
  },

  addShake(v) { this.shake = Math.min(1.4, this.shake + v); },
  addRush(v) { this.rush = Math.min(1.2, this.rush + v); },
  flash(color, dur) {
    DOM.flash.style.background = 'radial-gradient(ellipse at 50% 55%, rgba(255,255,255,0) 26%, ' + color + ' 100%)';
    DOM.flash.classList.add('on');
    this.flashT = dur || 0.1;
  },
  reset() {
    for (const p of this.pool) p.on = false;
    for (const p of this.glowPool) p.on = false;
    this.solid.count = 0; this.glow.count = 0;
    this.trailFill = 0; this.trail.visible = false;
    this.marker.visible = false; this.tether.visible = false;
    this.shake = 0; this.rush = 0; this.flashT = 0;
    DOM.flash.classList.remove('on');
    this.ctx2d.clearRect(0, 0, this.fxW, this.fxH);
    this.fxDirty = false;
  }
};
let TMP_V1 = null, TMP_V2 = null, TMP_V3 = null;
const SMOKE_TINT = { r: 0.72, g: 0.86, b: 1.0, isColor: false };