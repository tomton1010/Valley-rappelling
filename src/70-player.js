/* ============================================================================
 * 70 · 玩家物理 / 载具切换 / 弹簧臂相机 / 输入（键鼠 + 触屏）
 * ========================================================================== */
let vehicles = null, rig = null, tilt = null, spin = null;

const player = {
  pos: null, yaw: 0, speed: 0, vy: 0,
  grounded: true, airTime: 0, coyote: 0,
  vehicle: 'bike', stamina: 1, boostT: 0,
  crashT: 0, invuln: 0, landImpact: 0, bumpT: 0, landGrace: true,
  jumpBuf: 0, steerSmooth: 0, skid: 0, camLead: 0,
  trickPitch: 0, trickYaw: 0, pitchVel: 0, yawVel: 0,
  groundPitch: 0, groundRoll: 0, ridePitch: 0, rideYaw: 0, rideRoll: 0,
  tumbleRoll: 0, lift: 0, spinY: 0.95, settle: 0,
  onRamp: null, surface: 'grass', hoverPhase: 0,
  combo: 0, comboT: 0,
  distance: 0, topSpeed: 0, airTotal: 0, smash: 0, crashes: 0,
  trickScore: 0, bonusScore: 0, ringsHit: 0,
  lastCP: -1, respawnZ: 0, dustT: 0, splashT: 0, pedalPhase: 0
};

const input = {
  accel: 0, brake: 0, steer: 0, jump: false, jumpHeld: false, sprint: false,
  up: false, down: false, left: false, right: false,
  tUp: false, tDown: false, tLeft: false, tRight: false,
  joyX: 0, joyY: 0, joyActive: false, joyId: -1,
  orbit: 0, orbitPitch: 0.06, zoom: 1, dragging: false, dragId: -1,
  lastX: 0, lastY: 0, idleT: 0, switchReq: 0, respawnReq: false
};

/* 地面查询：地形 + 木跳台 */
const GI = { y: 0, ramp: null };
// 蹄底圆周的 4 个采样方向（单位圆上的东/北/西/南）
const HOOF_RIM = [1, 0, 0, 1, -1, 0, 0, -1];
function groundInfo(x, z) {
  GI.y = heightAt(x, z);
  GI.ramp = null;
  const cs = world.chunksNear(z);
  for (let ci = 0; ci < cs.length; ci++) {
    const props = cs[ci].props;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (!p.active || p.type !== 'ramp') continue;
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > 64) continue;
      const ca = Math.cos(p.yaw), sa = Math.sin(p.yaw);
      const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
      if (Math.abs(lx) > 3.3 || lz < -4.1 || lz > 4.1) continue;
      const y = p.y + (4 - lz) / 8 * 3.2;
      if (y > GI.y) { GI.y = y; GI.ramp = p; }
    }
  }
  return GI;
}

function resetPlayer(vehKey, z) {
  player.vehicle = vehKey || player.vehicle;
  player.pos.set(pathX(z), heightAt(pathX(z), z) + 0.05, z);
  player.yaw = pathYaw(z);
  player.speed = 0; player.vy = 0;
  player.grounded = true; player.airTime = 0; player.coyote = 0;
  player.stamina = 1; player.boostT = 0;
  player.crashT = 0; player.invuln = 1.0; player.landImpact = 0; player.bumpT = 0; player.landGrace = true;
  player.jumpBuf = 0; player.steerSmooth = 0; player.skid = 0; player.camLead = 0;
  player.trickPitch = 0; player.trickYaw = 0; player.pitchVel = 0; player.yawVel = 0;
  player.groundPitch = 0; player.groundRoll = 0;
  player.settle = 0; player.lift = 0; player.tumbleRoll = 0;
  player.spinY = vehicles.spinPivot[player.vehicle];
  player.onRamp = null; player.surface = 'grass';
  player.combo = 0; player.comboT = 0;
  player.distance = 0; player.topSpeed = 0; player.airTotal = 0;
  player.smash = 0; player.crashes = 0; player.trickScore = 0; player.bonusScore = 0; player.ringsHit = 0;
  player.lastCP = -1; player.respawnZ = z;
  player.dustT = 0; player.splashT = 0; player.pedalPhase = 0;
  vehicles.setActive(player.vehicle);
  rig.position.copy(player.pos);
  rig.rotation.set(0, player.yaw, 0);
  tilt.rotation.set(0, 0, 0);
  spin.rotation.set(0, 0, 0);
  spin.position.y = player.spinY;
  vehicles.root.position.y = -player.spinY;
  FX.reset();
}

function respawn() {
  const z = player.respawnZ;
  const x = pathX(z);
  player.pos.set(x, heightAt(x, z) + 0.6, z);
  player.yaw = pathYaw(z);
  player.speed = 4; player.vy = 0;
  player.grounded = true; player.airTime = 0;
  player.crashT = 0; player.invuln = 1.6; player.bumpT = 0; player.landGrace = true;
  player.jumpBuf = 0; player.steerSmooth = 0; player.skid = 0;
  player.trickPitch = 0; player.trickYaw = 0; player.pitchVel = 0; player.yawVel = 0;
  player.combo = 0; player.comboT = 0;
  player.stamina = Math.max(player.stamina, 0.5);
  player.settle = 0; player.lift = 0; player.tumbleRoll = 0;
  tilt.rotation.set(0, 0, 0);
  spin.rotation.set(0, 0, 0);
  camState.snap = true;
  FX.burst(player.pos.x, player.pos.y + 1, player.pos.z, 22, 0x35e0ff, 6, 0.28, 0.7, 'spark');
  FX.flash('rgba(53,224,255,.5)', 0.14);
  audio.sfx('switch');
  showToast('回到检查点', 'RESPAWN');
}

function switchVehicle(key) {
  if (key === player.vehicle) return;
  const prev = player.vehicle;
  player.vehicle = key;
  vehicles.setActive(key);
  const V = VEHICLES[key];
  // 位置速度无缝衔接：仅按新载具上限裁剪
  player.speed = Math.min(player.speed, V.maxSpeed * 1.05);
  player.trickPitch = 0; player.trickYaw = 0;
  FX.burst(player.pos.x, player.pos.y + 1.1, player.pos.z, 26, 0x35e0ff, 5.5, 0.3, 0.6, 'spark');
  FX.burst(player.pos.x, player.pos.y + 1.1, player.pos.z, 12, 0xffe08a, 4, 0.24, 0.7, 'star');
  FX.ringBurst(player.pos.x, player.pos.y + 1.2, player.pos.z, 0x8ff4ff, 14, 1.1);
  FX.addRush(0.35);
  FX.flash('rgba(53,224,255,.42)', 0.1);
  audio.sfx('switch');
  updateVehicleHUD();
  showToast(V.name, prev === key ? '' : 'SWITCH · ' + V.en);
}

/* --------------------------- 玩家更新 --------------------------- */
function updatePlayer(dt, racing) {
  const V = VEHICLES[player.vehicle];
  const p = player;

  if (p.invuln > 0) p.invuln -= dt;
  if (p.bumpT > 0) p.bumpT -= dt;
  if (p.comboT > 0) { p.comboT -= dt; if (p.comboT <= 0) p.combo = 0; }
  if (p.boostT > 0) p.boostT -= dt;
  p.landImpact = Math.max(0, p.landImpact - dt * 3.4);

  const crashing = p.crashT > 0;
  if (crashing) p.crashT = Math.max(0, p.crashT - dt);

  /* ---- 输入解析 ---- */
  let accel = 0, brake = 0, steer = 0;
  if (racing && !crashing) {
    accel = input.accel; brake = input.brake; steer = input.steer;
  }
  const sprinting = racing && !crashing && input.sprint &&
    (p.vehicle !== 'horse' || p.stamina > 0.02);

  // 键盘转向做短促斜坡：按下 ~0.1s 到位、松手 ~0.08s 回中，
  // 手感从「开关」变成「扳机」，但峰值转向速率不变。
  const steerTarget = steer;
  p.steerSmooth = damp(p.steerSmooth, steerTarget, Math.abs(steerTarget) > Math.abs(p.steerSmooth) ? 10 : 13, dt);
  if (Math.abs(p.steerSmooth) < 0.002) p.steerSmooth = 0;

  /* ---- 体力（马） ---- */
  if (p.vehicle === 'horse') {
    if (sprinting && p.speed > 4) p.stamina = clamp(p.stamina - dt * 0.235, 0, 1);
    else p.stamina = clamp(p.stamina + dt * (p.speed < 12 ? 0.20 : 0.115), 0, 1);
  } else {
    p.stamina = clamp(p.stamina + dt * 0.3, 0, 1);
  }

  /* ---- 地面 / 坡度 ---- */
  const gi = groundInfo(p.pos.x, p.pos.z);
  const wasRamp = p.onRamp;
  p.onRamp = gi.ramp;
  const dirX = -Math.sin(p.yaw), dirZ = -Math.cos(p.yaw);
  const hAhead = heightAt(p.pos.x + dirX * 2.6, p.pos.z + dirZ * 2.6);
  const hBack = heightAt(p.pos.x - dirX * 2.6, p.pos.z - dirZ * 2.6);
  // 下坡全量重力助推；上坡限幅。±2.6m 长跨度采样会把「身后的阶地断崖」误判成
  // 陡上坡：若不限制，低速载具顶着悬崖采样会永远爬不动（永久卡死）。限到 -0.32
  // 保证任何载具满油门都能爬过台阶（最小 accel 11.5 > GRAVITY*0.32*1.05 ≈ 8.7）。
  const grade = clamp((hBack - hAhead) / 5.2, -0.32, 0.9);
  p.surface = surfaceAt(p.pos.x, p.pos.z);

  /* ----  surface 参数 ---- */
  let surfDrag = 1, surfCap = 1;
  if (p.surface === 'mud') { surfDrag = 3.4; surfCap = 0.56; }
  else if (p.surface === 'water') { surfDrag = 1.9; surfCap = 0.82; }
  else if (p.surface === 'grass') { surfDrag = 1.22; surfCap = 0.96; }

  /* ---- 纵向速度 ---- */
  if (p.grounded) {
    p.speed += GRAVITY * grade * 1.05 * dt;
    if (!crashing) {
      const boostAccel = p.boostT > 0 ? 1.5 : 1;
      p.speed += V.accel * accel * (sprinting ? V.sprintMul : 1) * boostAccel * dt;
      p.speed -= V.brake * brake * dt;
    }
    p.speed -= V.rollDrag * surfDrag * dt * (1 + p.speed * 0.018);
    p.speed -= p.speed * p.speed * 0.00085 * dt;
    if (crashing) p.speed -= 14 * dt;
    // 冲刺与加速环不叠乘：取两者中更强的一个，避免速度失控
    const cap = V.maxSpeed * Math.max(sprinting ? V.sprintMul : 1, p.boostT > 0 ? 1.3 : 1) * surfCap;
    // 软上限收紧（3.2→5.5）：陡坡重力助推仍会短暂越过上限带来「俯冲感」，
    // 但超出量被压到约一半，实测极速更贴近「极速减半」的目标，不会因重力失控。
    if (p.speed > cap) p.speed = damp(p.speed, cap, 5.5, dt);
    if (p.speed < 0) p.speed = 0;
    // 转向：低速转向弱、高速转向收敛
    const turnRate = V.turn * (0.35 + 0.65 * Math.min(1, p.speed / 10)) * (1 - 0.28 * clamp(p.speed / V.maxSpeed, 0, 1));
    p.yaw -= p.steerSmooth * turnRate * dt;
    // 自动沿坡面轻微修正朝向（下坡吸向路线，减少卡住）
    if (Math.abs(steer) < 0.05 && p.speed > 6) {
      const lateral = (heightAt(p.pos.x + dirZ * 2, p.pos.z - dirX * 2) - heightAt(p.pos.x - dirZ * 2, p.pos.z + dirX * 2)) / 4;
      p.yaw -= clamp(lateral, -0.6, 0.6) * 0.32 * dt;
    }
    p.coyote = 0.12;
    // 落地残角按「固定角速度上限」回正：小残角用指数收敛（约 0.2s 归位），
    // 大残角限制每秒转过的角度，任何帧率下都不会出现一帧抹掉 1 rad 的瞬移感。
    if (p.settle > 0) {
      const k = clamp(dt / 0.20, 0, 1);
      const cap = 6.0 * dt;
      p.trickPitch -= clamp(p.trickPitch * k, -cap, cap);
      p.trickYaw -= clamp(p.trickYaw * k, -cap, cap);
      if (Math.abs(p.trickPitch) < 0.012 && Math.abs(p.trickYaw) < 0.012) {
        p.trickPitch = 0; p.trickYaw = 0; p.settle = 0;
      }
    }
  } else {
    p.coyote -= dt;
    p.vy -= GRAVITY * dt;
    p.speed -= p.speed * 0.05 * dt;
    if (racing && !crashing) {
      // 空中特技：方向键 ↑↓ 翻转、←→ 转体，Shift 加速旋转
      const mul = input.sprint ? 1.55 : 1;
      const targetPitch = (input.tUp ? -1 : 0) + (input.tDown ? 1 : 0);
      const targetYaw = (input.tLeft ? 1 : 0) + (input.tRight ? -1 : 0);
      p.pitchVel = damp(p.pitchVel, targetPitch * 6.4 * mul * V.airControl, 9, dt);
      p.yawVel = damp(p.yawVel, targetYaw * 5.6 * mul * V.airControl, 9, dt);
    } else {
      p.pitchVel = damp(p.pitchVel, 0, 6, dt);
      p.yawVel = damp(p.yawVel, 0, 6, dt);
    }
    if (crashing) { p.pitchVel = 6.2; p.yawVel = 3.4; }
    p.trickPitch += p.pitchVel * dt;
    p.trickYaw += p.yawVel * dt;
    p.airTime += dt;
    p.airTotal += dt;
  }

  /* ---- 跳跃（带输入缓冲：落地前 0.16s 按下也算数，不再吞键） ---- */
  if (input.jump) { p.jumpBuf = 0.16; input.jump = false; }
  if (p.jumpBuf > 0) p.jumpBuf -= dt;
  if (racing && !crashing && p.jumpBuf > 0 && (p.grounded || p.coyote > 0)) {
    // 在跳台上起跳 = 最强弹射（上限固定，保证任何速度下的特技窗口一致）
    p.vy = Math.max(V.jump + p.speed * 0.075, p.onRamp ? Math.min(p.speed * 0.58, 20) : 0);
    p.grounded = false; p.coyote = 0; p.jumpBuf = 0; p.airTime = 0;
    p.trickPitch = 0; p.trickYaw = 0; p.settle = 0;
    audio.sfx('jump');
    FX.burst(p.pos.x, p.pos.y + 0.15, p.pos.z, 10, 0xd8c9a0, 3.2, 0.2, 0.45, 'dirt', 0.6);
    if (p.vehicle === 'horse') p.stamina = clamp(p.stamina - 0.06, 0, 1);
  }

  /* ---- 位移 ---- */
  const step = p.speed * dt;
  p.pos.x += dirX * step;
  p.pos.z += dirZ * step;
  p.distance += step;
  if (p.speed > p.topSpeed) p.topSpeed = p.speed;

  // 谷壁软边界：防止跑出世界
  const cx = pathX(p.pos.z);
  const off = p.pos.x - cx;
  if (Math.abs(off) > 74) {
    p.pos.x = cx + Math.sign(off) * 74;
    p.speed *= 0.86;
    const toCenter = Math.atan2(-(cx - p.pos.x), 1);
    p.yaw = damp(p.yaw, p.yaw + wrapPi(toCenter - p.yaw) * 0.5, 6, dt);
  }

  if (!p.grounded) p.pos.y += p.vy * dt;

  /* ---- 落地 / 离地判定 ---- */
  const gi2 = groundInfo(p.pos.x, p.pos.z);
  const gy = gi2.y;
  if (p.grounded) {
    // 贴地判定：把「瞬时地面下坠速度」与「平滑坡度应有的下坠速度」相比，
    // 只有明显超出（断崖 / 陡坡转折）才腾空，起伏草坡始终贴合。
    const needV = (gy - p.pos.y) / Math.max(dt, 1 / 240);
    const carryV = -p.speed * Math.max(0, grade);
    const grace = p.landGrace;
    p.landGrace = false;
    if (wasRamp && p.pos.y > gy + 0.2) {
      p.grounded = false;
      p.airTime = 0;
      p.trickPitch = 0; p.trickYaw = 0;
      p.vy = Math.min(p.speed * 0.58, 20);
      audio.sfx('jump');
      FX.burst(p.pos.x, p.pos.y, p.pos.z, 14, 0xffe08a, 4, 0.22, 0.5, 'star', 0.8);
      FX.addRush(0.25);
    } else if (!grace && p.speed > 8 && needV < carryV - 6.0) {
      p.grounded = false;
      p.airTime = 0;
      p.trickPitch = 0; p.trickYaw = 0;
      p.vy = Math.max(carryV, -18);
      FX.addRush(0.12);
    } else {
      p.pos.y = gy;
      p.vy = clamp(needV, -60, 60);
    }
  } else if (p.pos.y <= gy && p.vy <= 0) {
    landOn(gy, V);
  }
  if (p.pos.y < gy - 6) {
    // 兜底回收（掉出世界 / 极端穿深）：也要清掉空中状态，
    // 否则 airTime 残留会让马腿一直保持腾空收腿、骑手保持抱膝。
    p.pos.y = gy; p.vy = 0; p.grounded = true; p.landGrace = true;
    p.airTime = 0; p.trickPitch = 0; p.trickYaw = 0; p.settle = 0;
  }

  /* ---- 碰撞 ---- */
  if (racing) handleCollisions(dt, V);

  /* ---- 粒子：尘土 / 水花 / 推进器 ---- */
  // 急刹打滑：后轮拖出尘烟 + 侧滑标记，让「刹车」这件事看得见
  const skidding = p.grounded && brake > 0.5 && p.speed > 11 && p.surface !== 'water';
  p.skid = damp(p.skid, skidding ? clamp(p.speed / V.maxSpeed, 0, 1) : 0, skidding ? 12 : 6, dt);
  if (skidding && p.dustT <= 0) {
    const bx = p.pos.x - dirX * 1.0, bz = p.pos.z - dirZ * 1.0;
    FX.burst(bx, gy + 0.12, bz, 3, p.surface === 'mud' ? 0x6b4a2a : 0xd9bd8c,
      2.2 + p.speed * 0.08, 0.22, 0.55, 'dirt', 0.7);
  }
  p.dustT -= dt;
  if (p.grounded && p.speed > 5 && p.dustT <= 0) {
    p.dustT = 0.045;
    const bx = p.pos.x - dirX * 0.9, bz = p.pos.z - dirZ * 0.9;
    if (p.surface === 'water') {
      FX.burst(bx, gy + 0.25, bz, 5, 0xbfeeff, 3.4 + p.speed * 0.09, 0.17, 0.42, 'splash', 1.5);
      p.splashT -= dt;
      if (p.splashT <= 0) { p.splashT = 0.28; audio.sfx('splash', { gain: 0.35 }); }
    } else if (p.surface === 'mud') {
      FX.burst(bx, gy + 0.1, bz, 3, 0x6b4a2a, 2.6, 0.19, 0.5, 'dirt', 1.2);
    } else if (p.vehicle !== 'board') {
      FX.spawn(bx + rand(-0.3, 0.3), gy + 0.08, bz + rand(-0.3, 0.3),
        -dirX * 2 + rand(-1, 1), rand(0.6, 2.2), -dirZ * 2 + rand(-1, 1),
        p.surface === 'dirt' ? 0xd9bd8c : 0x9fd45f, 0.16, 0.5, 'dirt');
    }
  }
  if (p.vehicle === 'board' && p.speed > 3) {
    p.dustT -= dt * 0.5;
    if (Math.random() < 0.55) {
      FX.spawn(p.pos.x - dirX * 1.1 + rand(-0.25, 0.25), p.pos.y + 0.42, p.pos.z - dirZ * 1.1 + rand(-0.25, 0.25),
        -dirX * 3 + rand(-0.6, 0.6), rand(-0.4, 0.6), -dirZ * 3 + rand(-0.6, 0.6),
        0x35e0ff, 0.15, 0.34, 'spark');
    }
  }
  if (p.boostT > 0 && Math.random() < 0.7) {
    FX.spawn(p.pos.x + rand(-0.7, 0.7), p.pos.y + rand(0.2, 1.6), p.pos.z + rand(-0.7, 0.7),
      -dirX * 6, rand(0.5, 2.5), -dirZ * 6, 0x8ff4ff, 0.2, 0.4, 'spark');
  }

  /* ---- 载具动画（先算，因为它决定车体姿态，接地求解要用） ---- */
  p.hoverPhase += dt;
  p.pedalPhase += dt * p.speed * 0.5;
  vehicles.update(dt, {
    vehicle: p.vehicle, speed: p.speed, maxSpeed: V.maxSpeed,
    speed01: clamp(p.speed / V.maxSpeed, 0, 1.3), steer: p.steerSmooth,
    grounded: p.grounded, airborne: !p.grounded, airTime: p.airTime, vy: p.vy,
    pedal: accel > 0.1 ? 1 : 0, brake: brake > 0.1 ? 1 : 0, skid: p.skid,
    sprint: sprinting, stamina01: p.stamina,
    crashT: p.crashT > 0 ? clamp(1 - p.crashT / 1.4, 0, 1) : 0,
    landImpact: p.landImpact, trickPitch: p.trickPitch, trickYaw: p.trickYaw,
    time: gameTime, bob: Math.sin(p.hoverPhase * 2.2)
  });

  /* ---- 姿态 + 接地求解 ---- */
  // 采样跨度对齐真实轴距（±0.6~1.0m），不再用 ±2.6m 的「平均坡度」：
  // 在阶地/凸坡上，长跨度拟合出的平面会把轮子压进地里。
  const half = p.vehicle === 'board' ? 1.18 : 0.61;
  const side = p.vehicle === 'horse' ? 0.46 : 0.40;
  const hA = groundInfo(p.pos.x + dirX * half, p.pos.z + dirZ * half).y;
  const hB = groundInfo(p.pos.x - dirX * half, p.pos.z - dirZ * half).y;
  const hR = groundInfo(p.pos.x + dirZ * side, p.pos.z - dirX * side).y;
  const hL = groundInfo(p.pos.x - dirZ * side, p.pos.z + dirX * side).y;
  const targetPitch = p.grounded ? clamp(Math.atan2(hA - hB, half * 2), -0.62, 0.62) : 0;
  const targetRoll = p.grounded ? clamp(Math.atan2(hR - hL, side * 2), -0.5, 0.5) : 0;
  // 地形俯仰/侧倾放缓收敛（14/12 → 6.5/5.5）：过凸坡、阶地时车身姿态
  // 平缓过渡而不是「啪」地一下掰过去；接地抬升求解器仍保证轮子不穿地。
  p.groundPitch = damp(p.groundPitch, targetPitch, 6.5, dt);
  p.groundRoll = damp(p.groundRoll, targetRoll, 5.5, dt);

  // 车体自身的俯仰/侧倾（刹车点头、转向压弯、悬浮起伏）由载具模块给出。
  const ch = vehicles.chassis;
  const riding = p.crashT <= 0;
  // 空中特技与摔车翻滚绕「重心」旋转，而不是绕接地点 —— 后空翻读起来是
  // 空翻，不是以前轮为轴的侧手翻。落地/起身时残角平滑收敛，不再一帧抹平。
  const tumble = riding ? 0 : (1 - p.crashT / 1.4) * Math.PI * 1.6;
  p.tumbleRoll = tumble;
  const wantSpinY = vehicles.spinPivot[p.vehicle];
  p.spinY = damp(p.spinY, wantSpinY, 10, dt);

  const rideP = p.groundPitch + ch.pitch;
  const rideY = ch.yaw;
  const rideR = p.groundRoll + ch.roll;
  p.ridePitch = rideP; p.rideYaw = rideY; p.rideRoll = rideR;

  rig.position.copy(p.pos);
  rig.rotation.y = p.yaw;
  // tilt：地形贴合（绕接地点，正确）；spin：特技/翻滚（绕重心）。
  tilt.rotation.set(riding ? p.groundPitch : p.groundPitch * 0.35,
    0, riding ? p.groundRoll : p.groundRoll * 0.35);
  const trickP = riding ? p.trickPitch + ch.pitch : p.trickPitch;
  const trickY = riding ? p.trickYaw + ch.yaw : p.trickYaw;
  const trickR = riding ? ch.roll : tumble;
  spin.position.y = p.spinY;
  spin.rotation.set(trickP, trickY, trickR);
  vehicles.root.position.y = -p.spinY;

  // 精确抬升：把每个接地点变换到世界，取「陷入地面最深」的那一个，
  // 整体抬起来同样的量。凸坡、阶地、刹车点头、压弯都不会再穿模。
  rig.updateMatrixWorld(true);
  const cps = vehicles.contact[p.vehicle];
  let lift = 0;
  const mtx = vehicles.vehicles[p.vehicle].group.matrixWorld;
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    const wx = mtx.elements[0] * c[0] + mtx.elements[4] * c[1] + mtx.elements[8] * c[2] + mtx.elements[12];
    const wy = mtx.elements[1] * c[0] + mtx.elements[5] * c[1] + mtx.elements[9] * c[2] + mtx.elements[13];
    const wz = mtx.elements[2] * c[0] + mtx.elements[6] * c[1] + mtx.elements[10] * c[2] + mtx.elements[14];
    const gyi = groundInfo(wx, wz).y;
    const sink = gyi - wy;
    if (sink > lift) lift = sink;
  }
  // 马：四只蹄按各自的实时关节角求解真实世界底面。沿蹄底圆周采 4 个点，
  // 每个点用它自己的地面高度比对 —— 蹄有 17cm 直径，坡上单点采样会漏判。
  // 支撑相由此逐帧钉在地面上，摆动相自然抬起，转向倾斜时也不会啃进草里。
  if (p.vehicle === 'horse' && ch.hoofProbe) {
    const hs = vehicles.hoofs;
    for (let i = 0; i < hs.length; i++) {
      const e = hs[i].matrixWorld.elements;
      for (let k = 0; k < 4; k++) {
        const lx = HOOF_RIM[k * 2] * 0.085, lz = HOOF_RIM[k * 2 + 1] * 0.085;
        const wx = e[0] * lx + e[4] * -0.05 + e[8] * lz + e[12];
        const wy = e[1] * lx + e[5] * -0.05 + e[9] * lz + e[13];
        const wz = e[2] * lx + e[6] * -0.05 + e[10] * lz + e[14];
        const sink = groundInfo(wx, wz).y - wy;
        if (sink > lift) lift = sink;
      }
    }
  }
  if (!riding) {
    // 翻滚时用整个包围盒的 8 个角求最低点，骑手不会被甩进地里
    const bb = vehicles.tumbleBox[p.vehicle];
    for (let i = 0; i < 8; i++) {
      const cx = (i & 1) ? bb[3] : bb[0];
      const cy = (i & 2) ? bb[4] : bb[1];
      const cz = (i & 4) ? bb[5] : bb[2];
      const wx = mtx.elements[0] * cx + mtx.elements[4] * cy + mtx.elements[8] * cz + mtx.elements[12];
      const wy = mtx.elements[1] * cx + mtx.elements[5] * cy + mtx.elements[9] * cz + mtx.elements[13];
      const wz = mtx.elements[2] * cx + mtx.elements[6] * cy + mtx.elements[10] * cz + mtx.elements[14];
      const sink = groundInfo(wx, wz).y + 0.06 - wy;
      if (sink > lift) lift = sink;
    }
  }
  // 贴地时立刻补足（穿模零容忍），离地时快速衰减到 0，避免空中被地面「顶起」
  if (p.grounded || !riding) p.lift = lift;
  else p.lift = damp(p.lift, 0, 12, dt);
  if (p.lift > 0.0005) {
    rig.position.y += p.lift;
    rig.updateMatrixWorld(true);
  }
}

function landOn(gy, V) {
  const p = player;
  const impact = clamp(-p.vy / 22, 0, 1.4);
  p.pos.y = gy;
  p.grounded = true;
  p.landImpact = clamp(impact * 1.2, 0.15, 1);
  const airT = p.airTime;
  p.airTime = 0;
  p.vy = 0;
  p.landGrace = true;

  const flips = Math.round(Math.abs(p.trickPitch) / TAU);
  const spins = Math.round(Math.abs(p.trickYaw) / TAU);
  const resP = Math.abs(wrapPi(p.trickPitch));
  const resY = Math.abs(wrapPi(p.trickYaw));
  const attempted = Math.abs(p.trickPitch) > 0.85 || Math.abs(p.trickYaw) > 0.85;
  const clean = resP < 1.25 && resY < 1.35;

  // 短促腾空（起伏 / 小落差）不做特技判定：自动回正，绝不因为一次小颠簸而摔车
  if (p.crashT <= 0 && attempted && !clean && airT > 0.6) {
    doCrash('落地失败', 'BAD LANDING');
    return;
  }
  // 残角归到最近的整圈，再交给 settle 在 ~0.2s 内平滑收敛。
  // 以前是直接置 0，最多一帧抹掉 2.6 rad —— 看着就是「瞬移回正」。
  p.trickPitch = wrapPi(p.trickPitch);
  p.trickYaw = wrapPi(p.trickYaw);
  p.pitchVel = 0; p.yawVel = 0;
  p.settle = Math.max(Math.abs(p.trickPitch), Math.abs(p.trickYaw)) > 0.02 ? 1 : 0;
  if (p.crashT > 0) { audio.sfx('land'); return; }

  if (airT < 0.14) {
    // 起伏地形造成的微小离地：静默贴合，不触发落地反馈
    return;
  }

  if (flips + spins > 0 && clean) {
    p.combo++;
    p.comboT = 6;
    const mult = Math.min(3, 1 + (p.combo - 1) * 0.25);
    const base = flips * 320 + spins * 240 + Math.floor(airT * 45);
    const gain = Math.floor(base * mult);
    p.trickScore += gain;
    let name;
    if (flips > 0 && spins > 0) name = (flips > 1 ? '双重螺旋转体' : '螺旋转体') + ' CORKSCREW';
    else if (flips > 0) name = (p.trickPitch < 0 ? '后空翻' : '前空翻') + (flips > 1 ? ' x' + flips : '') + ' FLIP';
    else name = (spins > 1 ? spins * 360 + '°' : '360°') + ' 转体 SPIN';
    showTrick(name, gain, p.combo);
    audio.sfx('trick');
    FX.burst(p.pos.x, p.pos.y + 1.2, p.pos.z, 20, 0xffd166, 5, 0.26, 0.7, 'star');
    FX.ringBurst(p.pos.x, p.pos.y + 0.6, p.pos.z, 0xffe08a, 12, 0.9);
    FX.addRush(0.2);
    p.speed = Math.min(p.speed * 1.06 + 1.5, VEHICLES[p.vehicle].maxSpeed * 1.3);
  } else if (airT > 0.45) {
    const gain = Math.floor(airT * 32);
    p.bonusScore += gain;
    showTrick('滞空 AIRTIME ' + airT.toFixed(1) + 's', gain, 0);
    audio.sfx('land');
  } else {
    audio.sfx(impact > 0.72 ? 'hardLand' : 'land');
  }

  FX.addShake(0.22 + impact * 0.55);
  const col = p.surface === 'water' ? 0xbfeeff : (p.surface === 'mud' ? 0x6b4a2a : 0xd9bd8c);
  FX.burst(p.pos.x, gy + 0.12, p.pos.z, 8 + Math.floor(impact * 12), col, 3 + impact * 4, 0.2, 0.5,
    p.surface === 'water' ? 'splash' : 'dirt', 0.8);
  if (impact > 0.95) p.speed *= 0.9;
}

function doCrash(reason, en) {
  const p = player;
  if (p.crashT > 0 || p.invuln > 0) return;
  const V = VEHICLES[p.vehicle];
  p.crashT = 1.4;
  p.crashes++;
  p.combo = 0; p.comboT = 0;
  p.speed *= (1 - V.crashPenalty);
  p.vy = 4.2;
  p.grounded = false;
  p.trickPitch = 0; p.trickYaw = 0;
  audio.sfx('crash');
  FX.addShake(0.9);
  FX.flash('rgba(255,90,77,.42)', 0.12);
  FX.burst(p.pos.x, p.pos.y + 0.8, p.pos.z, 22, 0xd9bd8c, 5.5, 0.24, 0.7, 'dirt');
  FX.burst(p.pos.x, p.pos.y + 0.8, p.pos.z, 10, 0xff8a72, 4, 0.2, 0.6, 'spark');
  showToast(reason, en);
}

function handleCollisions(dt, V) {
  const p = player;
  const cs = world.chunksNear(p.pos.z);
  for (let ci = 0; ci < cs.length; ci++) {
    const list = cs[ci].colliders;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const dx = p.pos.x - c.x, dz = p.pos.z - c.z;
      const rr = c.r + 0.62;
      const d2 = dx * dx + dz * dz;
      if (d2 > rr * rr) continue;
      const prop = c.prop;
      if (prop && prop.broken) continue;
      if (p.pos.y > c.y + 2.6 && c.type !== 'tree') continue;

      if (c.type === 'crate' || c.type === 'fence') {
        prop.broken = true;
        prop.mesh.visible = false;
        p.smash++;
        const gain = c.type === 'crate' ? 120 : 90;
        p.bonusScore += gain;
        p.speed *= c.type === 'crate' ? 0.99 : 0.96;
        audio.sfx(c.type === 'crate' ? 'crate' : 'fence');
        FX.burst(c.x, c.y + 0.6, c.z, 16, 0xc08a4a, 5.5, 0.26, 0.85, 'wood');
        FX.burst(c.x, c.y + 0.6, c.z, 6, 0x8a5a2c, 4, 0.2, 0.7, 'wood');
        FX.burst(c.x, c.y + 0.8, c.z, 6, 0xffe08a, 3, 0.18, 0.45, 'star');
        FX.addShake(0.22);
        showTrick(c.type === 'crate' ? '木箱粉碎 SMASH' : '栅栏突破 BREAK', gain, 0);
      } else if (c.type === 'mushroom') {
        if (p.pos.y < c.y + 1.9 && prop.anim < 0.35) {
          prop.anim = 1;
          p.vy = 21.5;
          p.grounded = false; p.airTime = 0;
          p.trickPitch = 0; p.trickYaw = 0;
          p.bonusScore += 60;
          audio.sfx('mushroom');
          FX.burst(c.x, c.y + 1.1, c.z, 16, 0xff7f8f, 4.5, 0.22, 0.6, 'spark', 1.4);
          FX.burst(c.x, c.y + 1.1, c.z, 8, 0xfff4e0, 3.5, 0.18, 0.7, 'star', 1.6);
          FX.addShake(0.3);
          showTrick('蘑菇弹射 BOUNCE', 60, 0);
        }
      } else {
        // 岩石 / 树 / 倒木：沿表面滑开并摔车（低速只减速，且不会卡死在障碍上）
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d, nz = dz / d;
        p.pos.x = c.x + nx * rr;
        p.pos.z = c.z + nz * rr;
        // 把朝向沿障碍切线偏转，让载具绕过去而不是永远顶着它
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
        const dot = fx * nx + fz * nz;
        let tx = fx - nx * dot, tz = fz - nz * dot;
        let tl = Math.hypot(tx, tz);
        if (tl < 0.25) { tx = -nz; tz = nx; tl = 1; }   // 正面对撞：择一侧绕行
        const want = Math.atan2(-tx / tl, -tz / tl);
        p.yaw += wrapPi(want - p.yaw) * Math.min(1, 3.4 * dt);
        if (p.invuln <= 0 && p.crashT <= 0 && p.bumpT <= 0) {
          p.bumpT = 0.7;
          if (p.speed > 11) doCrash('撞上障碍', 'CRASH · ' + (c.type === 'rock' ? 'ROCK' : c.type === 'tree' ? 'TREE' : 'LOG'));
          else { p.speed *= 0.55; audio.sfx('land'); FX.addShake(0.3); }
        }
      }
    }
    // 加速环
    const props = cs[ci].props;
    for (let i = 0; i < props.length; i++) {
      const pr = props[i];
      if (!pr.active || pr.type !== 'ring' || pr.cool > 0) continue;
      const dx = p.pos.x - pr.x, dz = p.pos.z - pr.z, dy = (p.pos.y + 1.0) - pr.y;
      if (dx * dx + dy * dy + dz * dz < 8.4) {
        pr.cool = 9;
        pr.mesh.visible = false;
        p.boostT = 2.4;
        p.ringsHit++;
        p.bonusScore += 150;
        p.speed = Math.max(p.speed, V.maxSpeed * 1.02);
        audio.sfx('boost');
        FX.ringBurst(pr.x, pr.y, pr.z, 0x35e0ff, 22, 2.4);
        FX.burst(pr.x, pr.y, pr.z, 18, 0x8ff4ff, 7, 0.24, 0.6, 'spark');
        FX.addRush(1.0);
        FX.addShake(0.25);
        FX.flash('rgba(53,224,255,.55)', 0.12);
        showTrick('加速环 BOOST', 150, 0);
      }
    }
  }
}

/* --------------------------- 相机 --------------------------- */
const camState = {
  pos: null, look: null, orbit: 0, pitch: 0.06, dist: 7, fov: 70,
  snap: true, shakeX: 0, shakeY: 0, menuAngle: 0, roll: 0, armF: 1
};

function updateCamera(dt, mode) {
  const p = player;
  const V = VEHICLES[p.vehicle];
  const speed01 = clamp(p.speed / V.maxSpeed, 0, 1.2);

  if (mode === 'menu') {
    camState.menuAngle += dt * 0.22;
    const r = 8.4 + input.zoom * 1.2;
    const a = camState.menuAngle + input.orbit;
    const target = TMP_V1.set(p.pos.x + Math.sin(a) * r, p.pos.y + 3.0 + input.orbitPitch * 5, p.pos.z + Math.cos(a) * r);
    camState.pos.lerp(target, 1 - Math.exp(-4 * dt));
    const gy = heightAt(camState.pos.x, camState.pos.z) + 1.2;
    if (camState.pos.y < gy) camState.pos.y = gy;
    camera.position.copy(camState.pos);
    camState.look.lerp(TMP_V2.set(p.pos.x, p.pos.y + 1.35, p.pos.z), 1 - Math.exp(-6 * dt));
    camera.lookAt(camState.look);
    camState.roll = damp(camState.roll, 0, 4, dt);
    camera.rotateZ(camState.roll);
    camState.fov = damp(camState.fov, 58, 4, dt);
    camera.fov = camState.fov;
    camera.updateProjectionMatrix();
    return;
  }

  // 松手自动回正
  if (!input.dragging) {
    input.idleT += dt;
    if (input.idleT > 0.9) {
      input.orbit = damp(input.orbit, 0, 2.2, dt);
      input.orbitPitch = damp(input.orbitPitch, 0.06, 1.6, dt);
    }
  }
  const airBonus = p.grounded ? 0 : clamp(p.airTime * 1.6, 0, 2.6);
  const wantDist = settings.camDist * input.zoom * (1 + speed01 * 0.16) + airBonus;
  camState.dist = damp(camState.dist, wantDist, 4.5, dt);
  // 入弯预摆：镜头朝转向方向先偏一点，弯心的障碍与跳台提前进入视野
  p.camLead = damp(p.camLead, -p.steerSmooth * 0.17 * clamp(p.speed / 14, 0, 1), 5, dt);
  const a = p.yaw + input.orbit + p.camLead;
  const h = 2.05 + input.orbitPitch * 6.0 + camState.dist * 0.10;
  // 轻微侧偏：让车架 / 马身 / 板身以 3/4 视角呈现，而不是被后轮挡成一条线
  const side = 0.95 * clamp(1 - Math.abs(input.orbit) * 0.8, 0, 1);
  const desired = TMP_V1.set(
    p.pos.x + Math.sin(a) * camState.dist + Math.cos(a) * side,
    p.pos.y + h,
    p.pos.z + Math.cos(a) * camState.dist - Math.sin(a) * side
  );
  if (camState.snap) {
    camState.pos.copy(desired);
    camState.look.set(p.pos.x, p.pos.y + 1.4, p.pos.z);
    camState.armF = 1;
    camState.snap = false;
  } else {
    const k = 1 - Math.exp(-9.5 * dt);
    camState.pos.x += (desired.x - camState.pos.x) * k;
    camState.pos.z += (desired.z - camState.pos.z) * k;
    camState.pos.y += (desired.y - camState.pos.y) * (1 - Math.exp(-6.5 * dt));
  }
  // 相机臂防穿地：从骑手胸口向镜头采样，真的被坡面 / 跳台唇挡住才把镜头拉近。
  // 注意起点必须是胸口而不是脚底，否则正常下坡也会误判成遮挡，把镜头怼到车座上。
  const pivotY = p.pos.y + 1.5;
  const armX = desired.x - p.pos.x, armZ = desired.z - p.pos.z, armY = desired.y - pivotY;
  let armF = 1;
  for (let i = 1; i <= 4; i++) {
    const f = i / 4;
    if (pivotY + armY * f < heightAt(p.pos.x + armX * f, p.pos.z + armZ * f) + 0.7) { armF = f; break; }
  }
  // 拉近快、放远慢：遮挡瞬间让开，恢复时缓缓退回去，不会来回弹
  camState.armF = armF < camState.armF ? armF : damp(camState.armF, armF, 2.2, dt);
  if (camState.armF < 0.995) {
    const f = Math.max(0.45, camState.armF);
    camState.pos.set(p.pos.x + armX * f, pivotY + armY * f, p.pos.z + armZ * f);
  }
  const camGround = heightAt(camState.pos.x, camState.pos.z) + 1.2;
  if (camState.pos.y < camGround) camState.pos.y = camGround;

  // 震屏
  const sh = FX.shake;
  camState.shakeX = (Math.random() - 0.5) * sh * 0.55;
  camState.shakeY = (Math.random() - 0.5) * sh * 0.55;
  camera.position.set(camState.pos.x + camState.shakeX, camState.pos.y + camState.shakeY, camState.pos.z);

  const dirX = -Math.sin(p.yaw), dirZ = -Math.cos(p.yaw);
  const lookAhead = 2.4 + speed01 * 2.8;
  // 空中把注视点压向预测落点方向，落地前就能看清脚下地形
  const airLook = p.grounded ? 0 : clamp(p.airTime * 0.9, 0, 1.5);
  const lt = TMP_V2.set(p.pos.x + dirX * lookAhead, p.pos.y + 1.45 + (p.grounded ? 0 : 0.4) - airLook, p.pos.z + dirZ * lookAhead);
  camState.look.lerp(lt, 1 - Math.exp(-11 * dt));
  camera.lookAt(camState.look);
  // 入弯微滚转：地平线跟着车身倾一点，转向的方向感直接从画面读出来
  const wantRoll = -p.steerSmooth * 0.045 * clamp(p.speed / 16, 0, 1) - camState.shakeX * 0.02;
  camState.roll = damp(camState.roll, wantRoll, 6, dt);
  camera.rotateZ(camState.roll);

  // 速度感 FOV：常速约 83°，冲刺 + 腾空才推到 95°，避免全程贴在上限变成鱼眼、主体缩成一点
  const wantFov = 70 + speed01 * speed01 * 13 + (p.boostT > 0 ? 5 : 0) + (p.grounded ? 0 : 2.5);
  camState.fov = damp(camState.fov, clamp(wantFov, 68, 95), 5, dt);
  if (Math.abs(camera.fov - camState.fov) > 0.01) {
    camera.fov = camState.fov;
    camera.updateProjectionMatrix();
  }
}

/* --------------------------- 输入 --------------------------- */
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right'
};
/* 空中特技只认方向键：这样一直按着 W 加速也不会被迫翻转摔车 */
const TRICKMAP = { ArrowUp: 'tUp', ArrowDown: 'tDown', ArrowLeft: 'tLeft', ArrowRight: 'tRight' };
const keysDown = Object.create(null);

function refreshInputAxes() {
  const kUp = keysDown['up'], kDown = keysDown['down'], kLeft = keysDown['left'], kRight = keysDown['right'];
  input.up = !!kUp; input.down = !!kDown; input.left = !!kLeft; input.right = !!kRight;
  let steer = (kRight ? 1 : 0) - (kLeft ? 1 : 0);
  let accel = kUp ? 1 : 0, brake = kDown ? 1 : 0;
  if (input.joyActive) {
    steer = clamp(input.joyX, -1, 1);
    accel = clamp(-input.joyY, 0, 1);
    brake = clamp(input.joyY, 0, 1);
  }
  input.steer = steer;
  input.accel = accel;
  input.brake = brake;
  input.tUp = !!keysDown['tUp']; input.tDown = !!keysDown['tDown'];
  input.tLeft = !!keysDown['tLeft']; input.tRight = !!keysDown['tRight'];
  if (input.joyActive) {
    // 触屏：按住「冲刺 / 特技」时，摇杆在空中即为翻转 / 转体
    const t = input.sprint;
    input.tUp = t && input.joyY < -0.35;
    input.tDown = t && input.joyY > 0.35;
    input.tLeft = t && input.joyX < -0.35;
    input.tRight = t && input.joyX > 0.35;
  }
}

function initInput() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) {
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    const axis = KEYMAP[e.code], trick = TRICKMAP[e.code];
    if (axis) { keysDown[axis] = true; e.preventDefault(); }
    if (trick) keysDown[trick] = true;
    if (axis || trick) refreshInputAxes();
    switch (e.code) {
      case 'Space':
        input.jump = true; input.jumpHeld = true; e.preventDefault();
        if (game.state === 'menu') startRace();
        break;
      case 'ShiftLeft': case 'ShiftRight': input.sprint = true; break;
      case 'Digit1': requestSwitch('bike'); break;
      case 'Digit2': requestSwitch('horse'); break;
      case 'Digit3': requestSwitch('board'); break;
      case 'Tab':
        e.preventDefault();
        requestSwitch(VEH_ORDER[(VEH_ORDER.indexOf(player.vehicle) + 1) % 3]);
        break;
      case 'KeyR': if (game.state === 'race') respawn(); break;
      case 'KeyP': case 'Escape': togglePause(); break;
      case 'KeyM': toggleMute(); break;
      case 'Enter':
        if (game.state === 'menu') startRace();
        else if (game.state === 'results') startRace();
        break;
    }
    audio.unlock();
  }, { passive: false });

  window.addEventListener('keyup', (e) => {
    const axis = KEYMAP[e.code], trick = TRICKMAP[e.code];
    if (axis) keysDown[axis] = false;
    if (trick) keysDown[trick] = false;
    if (axis || trick) refreshInputAxes();
    if (e.code === 'Space') input.jumpHeld = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = false;
  });
  window.addEventListener('blur', () => {
    for (const k in keysDown) keysDown[k] = false;
    input.sprint = false; input.jumpHeld = false;
    input.joyActive = false; input.joyX = 0; input.joyY = 0;
    DOM.joyKnob.style.transform = 'translate(0px,0px)';
    refreshInputAxes();
    if (game.state === 'race') setPaused(true);
  });

  // 相机拖拽 / 缩放
  const cv = renderer.domElement;
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', (e) => {
    if (input.dragId !== -1) return;
    input.dragging = true; input.dragId = e.pointerId;
    input.lastX = e.clientX; input.lastY = e.clientY;
    input.idleT = 0;
    cv.setPointerCapture(e.pointerId);
    audio.unlock();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!input.dragging || e.pointerId !== input.dragId) return;
    const dx = e.clientX - input.lastX, dy = e.clientY - input.lastY;
    input.lastX = e.clientX; input.lastY = e.clientY;
    input.orbit = clamp(input.orbit - dx * 0.006, -2.4, 2.4);
    input.orbitPitch = clamp(input.orbitPitch + dy * 0.004, -0.28, 0.85);
    input.idleT = 0;
  });
  const endDrag = (e) => {
    if (e.pointerId !== input.dragId) return;
    input.dragging = false; input.dragId = -1; input.idleT = 0;
    try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* 已释放 */ }
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    input.zoom = clamp(input.zoom + Math.sign(e.deltaY) * 0.09, 0.6, 2.0);
  }, { passive: false });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  // 虚拟摇杆
  const jb = DOM.joyBase;
  const joyRect = () => jb.getBoundingClientRect();
  const setJoy = (cx, cy) => {
    const r = joyRect();
    const ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2);
    const max = r.width * 0.36;
    const len = Math.hypot(ox, oy);
    const k = len > max ? max / len : 1;
    const px = ox * k, py = oy * k;
    input.joyX = clamp(px / max, -1, 1);
    input.joyY = clamp(py / max, -1, 1);
    DOM.joyKnob.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
    refreshInputAxes();
  };
  jb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    input.joyActive = true; input.joyId = e.pointerId;
    jb.setPointerCapture(e.pointerId);
    setJoy(e.clientX, e.clientY);
    audio.unlock();
  });
  jb.addEventListener('pointermove', (e) => {
    if (!input.joyActive || e.pointerId !== input.joyId) return;
    setJoy(e.clientX, e.clientY);
  });
  const joyEnd = (e) => {
    if (e.pointerId !== input.joyId) return;
    input.joyActive = false; input.joyId = -1;
    input.joyX = 0; input.joyY = 0;
    DOM.joyKnob.style.transform = 'translate(0px,0px)';
    refreshInputAxes();
  };
  jb.addEventListener('pointerup', joyEnd);
  jb.addEventListener('pointercancel', joyEnd);

  const holdBtn = (el, on, off) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('on'); el.setPointerCapture(e.pointerId); on(); audio.unlock(); });
    const up = (e) => { el.classList.remove('on'); if (off) off(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (el.hasPointerCapture && !el.hasPointerCapture(e.pointerId)) up(e); });
  };
  holdBtn(DOM.btnJump, () => { input.jump = true; input.jumpHeld = true; }, () => { input.jumpHeld = false; });
  holdBtn(DOM.btnSprint, () => { input.sprint = true; refreshInputAxes(); }, () => { input.sprint = false; refreshInputAxes(); });
  holdBtn(DOM.btnSwitch, () => {
    requestSwitch(VEH_ORDER[(VEH_ORDER.indexOf(player.vehicle) + 1) % 3]);
  }, null);
}

function requestSwitch(key) {
  if (game.state === 'race' || game.state === 'countdown') switchVehicle(key);
  else if (game.state === 'menu') selectVehicle(key);
}