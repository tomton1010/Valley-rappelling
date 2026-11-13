/* ============================================================================
 * 80 · 游戏流程 / HUD / 设置 / 主循环 / 启动
 * ========================================================================== */
let audio = null;
let gameTime = 0;
let rafId = null;
let fpsAcc = 0, fpsFrames = 0, hudAcc = 0, gaugeAcc = 0;

const game = {
  state: 'loading',
  time: 0, cdT: 0, cdStep: 4,
  cpIndex: -1, splits: [], segStart: 0, segVeh: 'bike',
  selected: 'bike', prevState: 'race', hintT: 0, finishT: 0,
  bestSplit: Infinity
};

/* --------------------------- UI 构建 --------------------------- */
const VEH_SVG = {
  bike: `<svg viewBox="0 0 48 48" fill="none" stroke="#123c4e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="33" r="8" fill="#ff5a3c" fill-opacity=".18"/><circle cx="36" cy="33" r="8" fill="#ff5a3c" fill-opacity=".18"/>
    <path d="M12 33l7-13h9l8 13M19 20h9M24 33l4-13M17 17h5"/><circle cx="24" cy="33" r="2.2" fill="#ffb020"/>
    <path d="M31 17l3-4h4" stroke="#0e7fa8"/></svg>`,
  horse: `<svg viewBox="0 0 48 48" fill="none" stroke="#123c4e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 34c1-8 5-12 12-12h8l6-8 4 2-2 6 3 4c2 3 1 8-2 10" fill="#b0703c" fill-opacity=".22"/>
    <path d="M14 34l-2 8M22 34l-1 8M30 32l2 10M36 30l3 12"/><path d="M34 14l-3-4M38 16l4-3" stroke="#0e7fa8"/>
    <circle cx="37" cy="19" r="1.4" fill="#123c4e"/></svg>`,
  board: `<svg viewBox="0 0 48 48" fill="none" stroke="#123c4e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 26c4-4 30-4 34 0-4 4-30 4-34 0z" fill="#2b3a67" fill-opacity=".25"/>
    <path d="M12 31c4 3 20 3 24 0" stroke="#35e0ff"/><path d="M16 35h4M28 35h4" stroke="#35e0ff"/>
    <path d="M20 20l3-8h6l-2 8" stroke="#ff4fa3"/><circle cx="26" cy="10" r="3" fill="#f2e6c8"/></svg>`
};
const KEY_HINTS = [
  ['W / ↑', '加速'], ['S / ↓', '刹车'], ['A D / ← →', '转向'], ['空格', '跳跃'],
  ['Shift', '冲刺加速'], ['空中 ← ↑ ↓ →', '翻转 / 转体'], ['1 2 3 / Tab', '切换载具'],
  ['R', '回检查点'], ['P', '暂停'], ['M', '静音'], ['拖拽 / 滚轮', '环绕 / 缩放']
];

function buildMenu() {
  DOM.vehGrid.innerHTML = '';
  VEH_ORDER.forEach((key, i) => {
    const V = VEHICLES[key];
    const card = document.createElement('div');
    card.className = 'veh-card' + (key === game.selected ? ' sel' : '');
    card.dataset.veh = key;
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    const bars = Object.keys(V.stats).map((k, bi) => {
      const cls = ['gold', 'leaf', 'mag', ''][bi % 4];
      return `<div class="stat"><b>${k}</b><div class="bar ${cls}"><i style="width:${Math.round(V.stats[k] * 100)}%"></i></div></div>`;
    }).join('');
    card.innerHTML = `<div class="veh-head">${VEH_SVG[key]}<div><div class="veh-name">${V.name}</div><div class="veh-tag">${i + 1} · ${V.tag}</div></div></div>
      <div class="veh-desc">${V.desc}</div><div>${bars}</div>`;
    card.addEventListener('click', () => selectVehicle(key));
    card.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); selectVehicle(key); } });
    DOM.vehGrid.appendChild(card);
  });
  DOM.keysHelp.innerHTML = KEY_HINTS.map(h => `<span class="key"><kbd>${h[0]}</kbd>${h[1]}</span>`).join('');
  DOM.keysHint.innerHTML = KEY_HINTS.slice(0, 8).map(h => `<span class="key"><kbd>${h[0]}</kbd>${h[1]}</span>`).join('');
  DOM.cpRow.innerHTML = CP_Z.map(() => '<span class="pip"></span>').join('') +
    '<span class="pip" style="width:22px"></span><span id="cpText">0 / ' + (CP_Z.length + 1) + '</span>';
  DOM.distTicks.innerHTML = CP_Z.map(z => `<span class="tick" style="left:${(-z / COURSE_LEN * 100).toFixed(1)}%"></span>`).join('');
  updateVehicleHUD();
}

function selectVehicle(key) {
  game.selected = key;
  player.vehicle = key;
  vehicles.setActive(key);
  Array.from(DOM.vehGrid.children).forEach(c => c.classList.toggle('sel', c.dataset.veh === key));
  updateVehicleHUD();
  FX.burst(player.pos.x, player.pos.y + 1.1, player.pos.z, 20, 0x35e0ff, 5, 0.28, 0.6, 'spark');
  FX.ringBurst(player.pos.x, player.pos.y + 1.2, player.pos.z, 0xffe08a, 12, 1.0);
  audio.sfx('switch');
}

function updateVehicleHUD() {
  const V = VEHICLES[player.vehicle];
  DOM.vehIcon.innerHTML = VEH_SVG[player.vehicle];
  DOM.vehName.textContent = V.name;
  Array.from(DOM.vehKeys.children).forEach((el, i) => el.classList.toggle('on', VEH_ORDER[i] === player.vehicle));
  DOM.staminaWrap.classList.toggle('show', player.vehicle === 'horse');
}

function showToast(main, sub) {
  DOM.toast.innerHTML = main + (sub ? '<small>' + sub + '</small>' : '');
  DOM.toast.classList.remove('pop');
  void DOM.toast.offsetWidth;
  DOM.toast.classList.add('pop');
}
function showTrick(name, score, combo) {
  DOM.trickName.textContent = name;
  DOM.trickScore.textContent = '+' + score;
  DOM.trickCombo.textContent = combo >= 2 ? 'COMBO x' + combo + ' · ' + (Math.min(3, 1 + (combo - 1) * 0.25)).toFixed(2) + '×' : '';
  DOM.trickPop.classList.remove('pop');
  void DOM.trickPop.offsetWidth;
  DOM.trickPop.classList.add('pop');
}

/* --------------------------- 设置 --------------------------- */
function applyVolume(v, from) {
  settings.volume = clamp(v, 0, 1);
  audio.setVolume(settings.volume);
  const pct = Math.round(settings.volume * 100) + '%';
  DOM.volVal.textContent = pct; DOM.volVal2.textContent = pct;
  if (from !== 'menu') DOM.menuVolume.value = Math.round(settings.volume * 100);
  if (from !== 'pause') DOM.pauseVolume.value = Math.round(settings.volume * 100);
}
function applyQuality(q, from) {
  settings.quality = q;
  Q = QUALITY[q];
  DOM.qualVal.textContent = DOM.menuQuality.selectedOptions[0].textContent;
  DOM.qualVal2.textContent = DOM.pauseQuality.selectedOptions[0].textContent;
  if (from !== 'menu') DOM.menuQuality.value = q;
  if (from !== 'pause') DOM.pauseQuality.value = q;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
  FX.resize();
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  cloudMesh.count = Math.min(cloudMesh.userData.seeds.length, Q.clouds);
  applyFogRange();
  rebuildWorld();
}
function applyCam(v, from) {
  settings.camDist = clamp(v, 4.5, 12);
  DOM.camVal.textContent = settings.camDist.toFixed(1);
  DOM.camVal2.textContent = settings.camDist.toFixed(1);
  if (from !== 'menu') DOM.menuCam.value = Math.round(settings.camDist * 10);
  if (from !== 'pause') DOM.pauseCam.value = Math.round(settings.camDist * 10);
}
function applyGrass(v) {
  settings.grassMul = v;
  const labels = { '0': '关闭', '0.5': '稀疏', '1': '标准', '1.5': '茂密' };
  DOM.grassVal.textContent = labels[String(v)] || '标准';
  DOM.pauseGrass.value = String(v);
  rebuildWorld();
}
function applyDifficulty(d) {
  settings.difficulty = d;
  DOM.diffVal.textContent = DIFF[d].label;
  DOM.menuDifficulty.value = d;
  rebuildWorld();
}
function rebuildWorld() {
  if (!world) return;
  const ci = Math.floor(-player.pos.z / CHUNK_D);
  for (const c of world.chunks) { c.index = -99999; c.setHidden(true); }
  world.map.clear();
  world.lastCenter = -99999;
  world.ensure(ci);
  renderer.shadowMap.needsUpdate = true;
}
function toggleMute() {
  settings.muted = !settings.muted;
  audio.setMuted(settings.muted);
  DOM.muteState.textContent = settings.muted ? 'OFF' : 'ON';
  DOM.btnMute.classList.toggle('off', settings.muted);
  DOM.muteX.style.display = settings.muted ? '' : 'none';
  DOM.wave1.style.display = settings.muted ? 'none' : '';
  DOM.wave2.style.display = settings.muted ? 'none' : '';
  if (!settings.muted) audio.sfx('ui');
}

function initUI() {
  DOM.menuQuality.value = settings.quality;
  DOM.pauseQuality.value = settings.quality;
  DOM.menuDifficulty.value = settings.difficulty;
  DOM.pauseGrass.value = String(settings.grassMul);
  applyVolume(settings.volume);
  applyCam(settings.camDist);
  DOM.qualVal.textContent = DOM.menuQuality.selectedOptions[0].textContent;
  DOM.qualVal2.textContent = DOM.pauseQuality.selectedOptions[0].textContent;
  DOM.diffVal.textContent = DIFF[settings.difficulty].label;
  DOM.grassVal.textContent = settings.grassMul === 0.5 ? '稀疏' : '标准';

  DOM.menuVolume.addEventListener('input', () => applyVolume(+DOM.menuVolume.value / 100, 'menu'));
  DOM.pauseVolume.addEventListener('input', () => applyVolume(+DOM.pauseVolume.value / 100, 'pause'));
  DOM.menuQuality.addEventListener('change', () => applyQuality(DOM.menuQuality.value, 'menu'));
  DOM.pauseQuality.addEventListener('change', () => applyQuality(DOM.pauseQuality.value, 'pause'));
  DOM.menuDifficulty.addEventListener('change', () => applyDifficulty(DOM.menuDifficulty.value));
  DOM.menuCam.addEventListener('input', () => applyCam(+DOM.menuCam.value / 10, 'menu'));
  DOM.pauseCam.addEventListener('input', () => applyCam(+DOM.pauseCam.value / 10, 'pause'));
  DOM.pauseGrass.addEventListener('change', () => applyGrass(+DOM.pauseGrass.value));

  const click = (el, fn) => {
    el.addEventListener('click', (e) => { e.preventDefault(); audio.unlock(); audio.sfx('ui'); fn(); });
  };
  click(DOM.btnStart, () => startRace());
  click(DOM.btnHowto, () => {
    showToast('操作说明', IS_TOUCH
      ? '左摇杆 加速转向 · 右侧 跳跃 / 冲刺 · 空中按住冲刺 + 摇杆做特技'
      : 'W 加速 · S 刹车 · A/D 转向 · 空格 跳跃 · 空中用方向键翻转');
    DOM.keysHelp.style.display = 'flex';
    DOM.keysHelp.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  click(DOM.btnResume, () => setPaused(false));
  click(DOM.btnRestartP, () => { setPaused(false); startRace(); });
  click(DOM.btnRespawnP, () => { setPaused(false); respawn(); });
  click(DOM.btnMenuP, () => { setPaused(false); gotoMenu(); });
  click(DOM.btnAgain, () => startRace());
  click(DOM.btnChange, () => gotoMenu());
  DOM.btnMute.addEventListener('click', (e) => { e.preventDefault(); audio.unlock(); toggleMute(); });
  DOM.btnMute.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); toggleMute(); } });
  DOM.btnPause.addEventListener('click', (e) => { e.preventDefault(); audio.unlock(); togglePause(); });
  DOM.btnPause.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); togglePause(); } });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'race') setPaused(true);
  });
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => { onResize(); });
  if (IS_TOUCH) {
    DOM.touch.classList.add('show'); document.body.classList.add('touch');
    DOM.airHint.textContent = '按住冲刺 + 摇杆 做特技';
  } else DOM.fpsTag.classList.add('show');
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr, 2));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h);
  FX.resize();
}

/* --------------------------- 流程 --------------------------- */
function showScreen(el) {
  [DOM.menu, DOM.pause, DOM.results].forEach(s => s.classList.toggle('show', s === el));
}
function gotoMenu() {
  game.state = 'menu';
  game.selected = player.vehicle;
  world.reset(0);
  resetPlayer(game.selected, 0);
  camState.snap = true;
  camState.pos.set(player.pos.x + 8, player.pos.y + 4, player.pos.z + 8);
  camState.look.copy(player.pos);
  DOM.hud.classList.remove('show');
  DOM.countdown.classList.remove('show');
  DOM.touch.classList.toggle('show', IS_TOUCH);
  showScreen(DOM.menu);
  Array.from(DOM.vehGrid.children).forEach(c => c.classList.toggle('sel', c.dataset.veh === game.selected));
  audio.setPaused(false);
}
function startRace() {
  audio.unlock();
  game.state = 'countdown';
  game.time = 0;
  game.cdT = 3.35;
  game.cdStep = 4;
  game.cpIndex = -1;
  game.splits.length = 0;
  game.segStart = 0;
  game.segVeh = game.selected;
  game.hintT = 0;
  game.bestSplit = Infinity;
  world.reset(0);
  resetPlayer(game.selected, 0);
  camState.snap = true;
  camState.fov = 70;
  input.orbit = 0; input.orbitPitch = 0.06;
  input.jump = false; input.sprint = false;
  showScreen(null);
  DOM.hud.classList.add('show');
  DOM.countdown.classList.add('show');
  DOM.cdSub.textContent = '准备出发 · ' + VEHICLES[game.selected].name;
  DOM.keysHint.classList.remove('fade');
  DOM.lastSplit.textContent = '';
  DOM.touch.classList.toggle('show', IS_TOUCH);
  updateVehicleHUD();
  updateHUD(true);
  audio.setPaused(false);
}
function beginRacing() {
  game.state = 'race';
  DOM.countdown.classList.remove('show');
  game.time = 0;
  game.segStart = 0;
  showToast('出发！', 'DROP IN · 溪谷镇 ' + COURSE_LEN + 'm');
}
function setPaused(on) {
  if (on) {
    if (game.state !== 'race' && game.state !== 'countdown') return;
    game.prevState = game.state;
    game.state = 'paused';
    showScreen(DOM.pause);
    DOM.countdown.classList.remove('show');
    audio.setPaused(true);
  } else {
    if (game.state !== 'paused') return;
    game.state = game.prevState;
    showScreen(null);
    if (game.state === 'countdown') DOM.countdown.classList.add('show');
    audio.setPaused(false);
    clock.getDelta();
  }
}
function togglePause() {
  if (game.state === 'paused') setPaused(false);
  else if (game.state === 'race' || game.state === 'countdown') setPaused(true);
}

function passCheckpoint(i) {
  game.cpIndex = i;
  const split = game.time - game.segStart;
  game.splits.push({ name: i === 0 ? '起点 → 检查点 1' : '检查点 ' + i + ' → 检查点 ' + (i + 1), t: split, veh: player.vehicle });
  if (split < game.bestSplit) game.bestSplit = split;
  game.segStart = game.time;
  game.segVeh = player.vehicle;
  player.respawnZ = CP_Z[i];
  player.lastCP = i;
  player.bonusScore += 200;
  audio.sfx('checkpoint');
  showToast('检查点 ' + (i + 1) + ' / ' + CP_Z.length, 'SPLIT ' + fmtTime(split));
  DOM.lastSplit.textContent = '上次分段 ' + fmtTime(split);
  FX.flash('rgba(111,191,63,.45)', 0.12);
  FX.ringBurst(player.pos.x, player.pos.y + 1.4, player.pos.z, 0xa8e86a, 20, 2.0);
  FX.burst(player.pos.x, player.pos.y + 1.2, player.pos.z, 16, 0xffe08a, 5, 0.24, 0.8, 'star');
  updateHUD(true);
}

function finishRace() {
  game.state = 'results';
  const split = game.time - game.segStart;
  game.splits.push({ name: '检查点 ' + CP_Z.length + ' → 溪谷镇', t: split, veh: player.vehicle });
  if (split < game.bestSplit) game.bestSplit = split;
  audio.sfx('finish');
  FX.flash('rgba(255,176,32,.55)', 0.25);
  for (let i = 0; i < 5; i++) {
    FX.burst(player.pos.x + rand(-6, 6), player.pos.y + rand(2, 7), player.pos.z + rand(-6, 6),
      18, [0xffd166, 0x35e0ff, 0xff7fb8, 0xa8e86a, 0xfff4e0][i], 8, 0.3, 1.6, 'star');
  }
  const totalScore = player.trickScore + player.bonusScore;
  const par = 230 * DIFF[settings.difficulty].timeMul;
  const timeScore = clamp(par / Math.max(1, game.time), 0, 1.35) * 48;
  const styleScore = clamp(totalScore / 30000, 0, 1) * 38;
  const cleanScore = Math.max(0, 14 - player.crashes * 1.6);
  const rating = timeScore + styleScore + cleanScore;
  let rank = 'C', text = '风还在等你。再试一次，把路线走顺。';
  if (rating >= 92) { rank = 'S'; text = '风为你让路 —— 山谷记住了这个名字。'; }
  else if (rating >= 76) { rank = 'A'; text = '漂亮的速降！只差一点点就能与风齐名。'; }
  else if (rating >= 58) { rank = 'B'; text = '稳健抵达。多用跳台与加速环能更快。'; }
  DOM.rankBadge.textContent = rank;
  DOM.rankBadge.className = rank.toLowerCase();
  DOM.rankText.textContent = text;
  DOM.resTotal.textContent = fmtTime(game.time);
  DOM.resTrick.textContent = String(player.trickScore);
  DOM.resTop.textContent = String(Math.round(player.topSpeed * 3.6));
  DOM.resAir.textContent = player.airTotal.toFixed(1) + 's';
  DOM.resSmash.textContent = String(player.smash);
  DOM.resCrash.textContent = String(player.crashes);
  DOM.resScore.textContent = String(Math.round(rating));
  DOM.resTitle.textContent = '抵达溪谷镇';
  DOM.resSplits.innerHTML = game.splits.map(s =>
    `<tr class="${s.t === game.bestSplit ? 'best' : ''}"><td>${s.name}</td><td>${VEHICLES[s.veh].name}</td><td class="t">${fmtTime(s.t)}</td></tr>`
  ).join('') + `<tr><td><b>总计</b></td><td>加速环 ${player.ringsHit} · 奖励 ${player.bonusScore}</td><td class="t">${fmtTime(game.time)}</td></tr>`;
  DOM.hud.classList.remove('show');
  DOM.touch.classList.remove('show');
  showScreen(DOM.results);
  camState.snap = false;
  game.finishT = 0;
}

/* --------------------------- HUD --------------------------- */
const gaugeCtx = DOM.speedo.getContext('2d');
function drawGauge(speed01, kmh, boost) {
  const c = gaugeCtx, W = 236, H = 236, cx = W / 2, cy = H / 2 + 8, R = 92;
  c.clearRect(0, 0, W, H);
  const a0 = Math.PI * 0.78, a1 = Math.PI * 2.22;
  // 底环
  c.lineWidth = 16; c.lineCap = 'round';
  c.strokeStyle = 'rgba(11,72,96,.20)';
  c.beginPath(); c.arc(cx, cy, R, a0, a1); c.stroke();
  // 刻度
  c.lineWidth = 3;
  for (let i = 0; i <= 10; i++) {
    const a = a0 + (a1 - a0) * (i / 10);
    const r0 = R - 13, r1 = R - (i % 5 === 0 ? 24 : 19);
    c.strokeStyle = i / 10 <= speed01 ? 'rgba(255,176,32,.95)' : 'rgba(14,127,168,.45)';
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    c.stroke();
  }
  // 速度弧
  const av = a0 + (a1 - a0) * clamp(speed01, 0, 1);
  const grd = c.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, '#35e0ff'); grd.addColorStop(0.55, '#7cf7c8'); grd.addColorStop(1, '#ffb020');
  c.strokeStyle = grd; c.lineWidth = 16;
  c.shadowColor = 'rgba(53,224,255,.85)'; c.shadowBlur = 14;
  c.beginPath(); c.arc(cx, cy, R, a0, av); c.stroke();
  c.shadowBlur = 0;
  if (boost > 0) {
    c.strokeStyle = 'rgba(150,240,255,' + (0.35 + 0.4 * boost).toFixed(2) + ')';
    c.lineWidth = 5;
    c.beginPath(); c.arc(cx, cy, R + 13, a0, av); c.stroke();
  }
  // 指针
  c.strokeStyle = '#123c4e'; c.lineWidth = 5;
  c.beginPath(); c.moveTo(cx, cy);
  c.lineTo(cx + Math.cos(av) * (R - 26), cy + Math.sin(av) * (R - 26)); c.stroke();
  c.fillStyle = '#ffb020'; c.beginPath(); c.arc(cx, cy, 8, 0, TAU); c.fill();
  c.strokeStyle = '#0b4860'; c.lineWidth = 3; c.stroke();
  // 数字
  c.fillStyle = '#123c4e'; c.textAlign = 'center';
  c.font = 'bold 54px ui-monospace, Menlo, Consolas, monospace';
  c.fillText(String(Math.round(kmh)), cx, cy - 22);
  c.font = '16px ui-monospace, Menlo, Consolas, monospace';
  c.fillStyle = '#0e7fa8';
  c.fillText('KM/H', cx, cy - 4);
}

function updateHUD(force) {
  const p = player;
  const remain = Math.max(0, p.pos.z - FINISH_Z);
  const prog = clamp(1 - remain / COURSE_LEN, 0, 1);
  DOM.timerVal.innerHTML = fmtTime(game.time).replace('.', '<small>.') + '</small>';
  DOM.distVal.textContent = Math.round(remain) + ' m';
  DOM.distFill.style.width = (prog * 100).toFixed(1) + '%';
  const pips = DOM.cpRow.querySelectorAll('.pip');
  for (let i = 0; i < pips.length; i++) {
    const done = i <= game.cpIndex;
    const next = i === game.cpIndex + 1;
    pips[i].classList.toggle('done', done);
    pips[i].classList.toggle('next', next && !done);
  }
  const cpText = $('cpText');
  if (cpText) cpText.textContent = (game.cpIndex + 1) + ' / ' + (CP_Z.length + 1);
  const st = DOM.staminaFill;
  st.style.width = (p.stamina * 100).toFixed(0) + '%';
  st.classList.toggle('low', p.stamina < 0.28);
  DOM.boostFill.style.width = (clamp(p.boostT / 2.4, 0, 1) * 100).toFixed(0) + '%';
  const surfNames = { mud: '泥地 · MUD', water: '浅溪 · SHALLOWS', dirt: '土径 · TRAIL', grass: '草甸 · MEADOW' };
  DOM.surfaceTag.textContent = surfNames[p.surface] || '';
  DOM.surfaceTag.classList.toggle('show', p.surface !== 'grass' && p.grounded && p.speed > 3);
  const inAir = !p.grounded && p.airTime > 0.16 && p.crashT <= 0;
  DOM.airPanel.classList.toggle('show', inAir);
  if (inAir) {
    DOM.airTag.textContent = 'AIR ' + p.airTime.toFixed(1) + 's';
    const attempted = Math.abs(p.trickPitch) > 0.85 || Math.abs(p.trickYaw) > 0.85;
    const resP = Math.abs(wrapPi(p.trickPitch)), resY = Math.abs(wrapPi(p.trickYaw));
    const clean = resP < 1.25 && resY < 1.35;
    const cls = !attempted || clean ? ((resP > 0.8 || resY > 0.9) ? 'warn' : 'ok') : 'bad';
    DOM.airState.className = cls;
    DOM.airState.textContent = cls === 'bad' ? '姿态 危险' : (cls === 'warn' ? '姿态 偏斜' : '姿态 稳');
  }
}

/* 姿态盘：外圈=翻转进度，内圈=转体进度，绿色扇区就是「能干净落地」的角度窗口。
   指针进入绿区即可松手，把原本全靠感觉的特技变成可读的仪表。 */
let dialCtx = null;
function drawTrickDial() {
  const p = player;
  if (!dialCtx) dialCtx = DOM.trickDial.getContext('2d');
  const ctx = dialCtx, S = DOM.trickDial.width, c = S / 2;
  ctx.clearRect(0, 0, S, S);
  const TAU2 = Math.PI * 2;
  const ring = (radius, width, angle, safeHalf, col) => {
    // 底环
    ctx.beginPath(); ctx.arc(c, c, radius, 0, TAU2);
    ctx.strokeStyle = 'rgba(8,40,56,.6)'; ctx.lineWidth = width; ctx.stroke();
    // 安全扇区（以 12 点为 0，顺时针为正角度）
    ctx.beginPath();
    ctx.arc(c, c, radius, -Math.PI / 2 - safeHalf, -Math.PI / 2 + safeHalf);
    ctx.strokeStyle = 'rgba(124,255,158,.5)'; ctx.lineWidth = width; ctx.stroke();
    // 已走过的角度
    const a = ((angle % TAU2) + TAU2) % TAU2;
    if (a > 0.02) {
      ctx.beginPath();
      ctx.arc(c, c, radius, -Math.PI / 2, -Math.PI / 2 + a);
      ctx.strokeStyle = col; ctx.lineWidth = width * 0.6; ctx.stroke();
    }
    // 指针
    const px = c + Math.sin(a) * radius, py = c - Math.cos(a) * radius;
    ctx.beginPath(); ctx.arc(px, py, width * 0.66, 0, TAU2);
    ctx.fillStyle = '#fff8e2'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
  };
  const resP = Math.abs(wrapPi(p.trickPitch)), resY = Math.abs(wrapPi(p.trickYaw));
  const colP = resP < 1.25 ? '#8dffa8' : '#ff8a76';
  const colY = resY < 1.35 ? '#8dffa8' : '#ff8a76';
  const flips = Math.floor(Math.abs(p.trickPitch) / TAU2);
  const spins = Math.floor(Math.abs(p.trickYaw) / TAU2);
  ring(S * 0.38, S * 0.050, p.trickPitch, 1.25, colP);
  ring(S * 0.25, S * 0.044, p.trickYaw, 1.35, colY);
  // 中心：本次滞空秒数
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 ' + Math.round(S * 0.14) + 'px Georgia, serif';
  ctx.fillStyle = '#fff8e2';
  ctx.fillText(p.airTime.toFixed(1), c, c - S * 0.015);
  ctx.font = '600 ' + Math.round(S * 0.062) + 'px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(214,244,255,.75)';
  ctx.fillText('SEC', c, c + S * 0.075);
  // 底部：已完成圈数
  ctx.font = '700 ' + Math.round(S * 0.072) + 'px ui-monospace, monospace';
  ctx.fillStyle = colP; ctx.textAlign = 'right';
  ctx.fillText('FLIP ' + flips, c - S * 0.02, S * 0.955);
  ctx.fillStyle = colY; ctx.textAlign = 'left';
  ctx.fillText('SPIN ' + spins, c + S * 0.02, S * 0.955);
}

/* --------------------------- 下一道门指示器 --------------------------- */
/* 门在画面里就悬在门楣上方；被山坡挡住或出了画面就贴到屏幕边缘并转箭头指路。
   高速下坡时视野只有几百米，没有它很容易错过检查点门。 */
let GG_V = null;
const GG_AVOID = ['.hud-tl', '.hud-tr', '.hud-br', '#keysHint', '#airPanel'];
function updateGateGuide() {
  const el = DOM.gateGuide;
  const i = game.cpIndex + 1;
  const isFinish = i >= CP_Z.length;
  const gz = isFinish ? FINISH_Z : CP_Z[i];
  const gx = pathX(gz);
  const dist = Math.max(0, player.pos.z - gz);
  if (dist < 26) { el.classList.remove('show'); return; }
  const W = window.innerWidth, H = window.innerHeight;
  const hw = el.offsetWidth * 0.5 + 6, hh = el.offsetHeight * 0.5 + 6;
  // 先读 HUD 占位（读在写之前，避免同一帧里反复触发重排）
  const blocks = [];
  for (const sel of GG_AVOID) {
    const q = DOM.hud.querySelector(sel);
    // 空中姿态盘淡出时仍占位（opacity 过渡），所以按实际不透明度判断，
    // 而不是 .show 类——否则落地那一瞬间指示器会闪到盘面下面。
    if (!q || (sel === '#airPanel' && parseFloat(getComputedStyle(q).opacity) < 0.05)) continue;
    // 用视口矩形而不是 offsetLeft/offsetTop：#airPanel 靠 translateX(-50%)
    // 居中，offsetLeft 是它的左边缘起点（屏幕中线），会把避让区整体右移半宽。
    const r = q.getBoundingClientRect();
    blocks.push([r.left - hw, r.top - hh, r.right + hw, r.bottom + hh]);
  }
  const v = GG_V.set(gx, heightAt(gx, gz) + 6.4, gz).project(camera);
  let sx = v.x * 0.5 + 0.5, sy = 0.5 - v.y * 0.5;
  const behind = v.z > 1;
  if (behind) { sx = 1 - sx; sy = 1 - sy; }
  // 骑手本体也要让开：竖屏时门的投影常落在主体附近，别把车挡住
  const pv = GG_V.set(player.pos.x, player.pos.y + 1.2, player.pos.z).project(camera);
  if (pv.z <= 1) {
    const px = (pv.x * 0.5 + 0.5) * W, py = (0.5 - pv.y * 0.5) * H;
    blocks.push([px - 30 - hw, py - 46 - hh, px + 30 + hw, py + 46 + hh]);
  }
  const padX = Math.min(96, W * 0.16), padT = Math.min(120, H * 0.24), padB = Math.min(150, H * 0.3);
  const rawX = sx * W, rawY = sy * H;
  let cx = clamp(rawX, padX, W - padX), cy = clamp(rawY, padT, H - padB);
  // 贴边时若压在 HUD 面板上，沿位移最小的方向让开；推开后可能又压到另一块，
  // 所以最多迭代三轮直到没有重叠（单轮会在竖屏 / 空中面板同时出现时漏判）。
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const b of blocks) {
      if (cx <= b[0] || cx >= b[2] || cy <= b[1] || cy >= b[3]) continue;
      const dl = cx - b[0], dr = b[2] - cx, dt2 = cy - b[1], db = b[3] - cy;
      const m = Math.min(dl, dr, dt2, db);
      if (m === dl) cx = b[0]; else if (m === dr) cx = b[2];
      else if (m === dt2) cy = b[1]; else cy = b[3];
      cx = clamp(cx, hw, W - hw); cy = clamp(cy, hh, H - hh);
      moved = true;
    }
    if (!moved) break;
  }
  // 位移超过 2px 才算「贴边」：亚像素抖动不该让箭头突然翻转指向
  const off = behind || Math.abs(cx - rawX) > 2 || Math.abs(cy - rawY) > 2;
  el.classList.add('show');
  el.classList.toggle('near', !off && dist < 220);
  el.style.transform = 'translate(-50%,-50%) translate(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px)';
  // 箭头：贴边时指向门的方向；门在画面内时朝下点在门楣上
  const ang = off ? Math.atan2(rawY - cy, rawX - cx) + Math.PI / 2 : Math.PI;
  DOM.ggArrow.style.transform = 'rotate(' + ang.toFixed(3) + 'rad)';
  DOM.ggName.textContent = isFinish ? 'FINISH' : 'CP ' + (i + 1);
  DOM.ggDist.textContent = Math.round(dist) + ' m';
}

/* --------------------------- 空闲展示 --------------------------- */
function updateIdle(dt) {
  const p = player;
  p.hoverPhase += dt;
  rig.position.copy(p.pos);
  rig.rotation.y = p.yaw;
  tilt.rotation.set(0, 0, 0);
  spin.rotation.set(0, 0, 0);
  vehicles.update(dt, {
    vehicle: p.vehicle, speed: 0, maxSpeed: VEHICLES[p.vehicle].maxSpeed, speed01: 0,
    steer: 0, grounded: true, airborne: false, airTime: 0, vy: 0,
    pedal: 0, brake: 0, sprint: false, stamina01: p.stamina,
    crashT: 0, landImpact: 0, trickPitch: 0, trickYaw: 0,
    time: gameTime, bob: Math.sin(p.hoverPhase * 2.2)
  });
}

/* --------------------------- 主循环 --------------------------- */
function frame() {
  rafId = requestAnimationFrame(frame);
  let dt = clock.getDelta();
  if (dt > 0.06) dt = 0.06;
  if (dt <= 0) dt = 1 / 60;
  gameTime += dt;

  const st = game.state;
  const active = st === 'race';

  if (st === 'countdown') {
    game.cdT -= dt;
    const step = Math.ceil(game.cdT - 0.35);
    if (step !== game.cdStep && step >= 0) {
      game.cdStep = step;
      DOM.cdNum.textContent = step > 0 ? String(step) : 'GO!';
      DOM.cdNum.classList.remove('pop');
      void DOM.cdNum.offsetWidth;
      DOM.cdNum.classList.add('pop');
      audio.sfx(step > 0 ? 'countdown' : 'go');
      if (step === 0) { DOM.cdSub.textContent = '俯冲吧！'; }
    }
    if (game.cdT <= 0) beginRacing();
    updateIdle(dt);
    updateCamera(dt, 'race');
  } else if (active) {
    game.time += dt;
    game.hintT += dt;
    if (game.hintT > 13) DOM.keysHint.classList.add('fade');
    const steps = dt > 0.026 ? 2 : 1;
    for (let i = 0; i < steps; i++) updatePlayer(dt / steps, true);
    // 检查点
    for (let i = 0; i < CP_Z.length; i++) {
      if (i === game.cpIndex + 1 && player.pos.z <= CP_Z[i]) { passCheckpoint(i); break; }
    }
    if (player.pos.z <= FINISH_Z) finishRace();
    updateCamera(dt, 'race');
  } else if (st === 'menu') {
    updateIdle(dt);
    updateCamera(dt, 'menu');
  } else if (st === 'results') {
    game.finishT += dt;
    updateIdle(dt);
    updateCamera(dt, 'menu');
    if (Math.random() < 0.12) {
      FX.spawn(player.pos.x + rand(-8, 8), player.pos.y + rand(3, 9), player.pos.z + rand(-8, 8),
        rand(-1, 1), rand(-0.5, 0.6), rand(-1, 1),
        [0xffd166, 0x35e0ff, 0xff7fb8][Math.floor(Math.random() * 3)], 0.24, 2.2, 'star');
    }
  } else if (st === 'paused') {
    updateIdle(0);
  }

  // 世界 / 特效 / 音频
  world.update(st === 'paused' ? 0 : dt, player.pos, gameTime, false);
  updateContactShadow();
  const V = VEHICLES[player.vehicle];
  const speed01 = clamp(player.speed / V.maxSpeed, 0, 1.2);
  FX.update(st === 'paused' ? 0 : dt, player.pos, player.vehicle, active ? speed01 : 0, player.grounded);
  FX.updateLanding(player, gameTime);

  audio.update(dt, {
    speed: player.speed, speed01: speed01, vehicle: player.vehicle,
    grounded: player.grounded, airborne: !player.grounded,
    playing: active, menu: st === 'menu' || st === 'results', crashed: player.crashT > 0
  });

  // HUD（文本 15Hz，仪表 30Hz）
  if (st === 'race' || st === 'countdown') {
    hudAcc += dt;
    if (hudAcc > 0.066) { hudAcc = 0; updateHUD(false); }
    gaugeAcc += dt;
    if (gaugeAcc > 0.033) {
      gaugeAcc = 0;
      drawGauge(speed01, player.speed * 3.6, clamp(player.boostT / 2.4, 0, 1));
      if (!player.grounded && player.airTime > 0.16 && player.crashT <= 0) drawTrickDial();
      if (active) updateGateGuide();
    }
  }
  if (!active && st !== 'countdown') DOM.gateGuide.classList.remove('show');

  // FPS（用真实墙钟时间统计，不受 dt 钳制影响）
  fpsFrames++;
  const nowMs = performance.now();
  if (nowMs - fpsAcc >= 500) {
    if (!IS_TOUCH) DOM.fpsTag.textContent = Math.round(fpsFrames * 1000 / (nowMs - fpsAcc)) + ' FPS';
    fpsAcc = nowMs; fpsFrames = 0;
  }

  // 太阳投影到屏幕：决定体积光柱的方向与强度（背对太阳时自然淡出）
  const rayAmount = updateSunScreen();
  post.render(gameTime, clamp(FX.rush, 0, 1), SUN_UV, rayAmount);
}

/* 太阳屏幕坐标 + 可见度（供后期光柱使用） */
const SUN_UV = { x: 0.5, y: 0.5, isVector2: false };
let sunRayAmount = 0;
function updateSunScreen() {
  TMP_V3.set(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize().multiplyScalar(600).add(camera.position);
  camera.getWorldDirection(TMP_V1);
  const facing = TMP_V1.dot(TMP_V2.set(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize());
  TMP_V3.project(camera);
  SUN_UV.x = TMP_V3.x * 0.5 + 0.5;
  SUN_UV.y = TMP_V3.y * 0.5 + 0.5;
  // 只有太阳真的进入画面（含一点边缘余量）才给光柱：
  // 否则画面里没有光源，却凭空糊出一层放射状亮纱 —— 那正是同心环纹的来源。
  const edge = Math.max(Math.abs(SUN_UV.x - 0.5), Math.abs(SUN_UV.y - 0.5));
  const onScreen = (1 - sstep(0.44, 0.66, edge)) * sstep(0.0, 0.18, facing);
  const want = clamp(facing * 1.4, 0, 1) * onScreen;
  sunRayAmount += (want - sunRayAmount) * 0.08;
  return sunRayAmount;
}

/* --------------------------- 启动 --------------------------- */
async function boot() {
  try {
    setLoad(0.05, '正在唤醒风与草原…');
    THREE = await loadEngine();
    if (!THREE) return;
    setLoad(0.3, '引擎就绪 · 铺设山谷…');
    if (!initRenderer()) return;
    M = makeMaterials();
    buildDescentTable();
    // 小镇基准高度（先排除镇口压平项求原始高度）
    computingTownY = true;
    TOWN_Y.v = heightAt(0, FINISH_Z);
    computingTownY = false;

    setLoad(0.42, '生成植被与岩石…');
    buildSharedGeometries();
    grassMat = makeGrassMaterial();
    waterMat = makeWaterMaterial();
    applyFogRange();
    vegMat = M.toon(0xffffff, { vertexColors: true });
    propWoodMat = M.toon(0xffffff, { vertexColors: true });
    CHUNK_DUMMY = new THREE.Object3D();
    TMP_V1 = new THREE.Vector3(); TMP_V2 = new THREE.Vector3(); TMP_V3 = new THREE.Vector3();
    GG_V = new THREE.Vector3();

    setLoad(0.55, '点亮天空与远山…');
    buildSky();
    buildLights();

    setLoad(0.66, '搭建溪谷镇…');
    buildTown();

    setLoad(0.74, '铺开无尽草原…');
    player.pos = new THREE.Vector3();
    camState.pos = new THREE.Vector3();
    camState.look = new THREE.Vector3();
    world = new World();
    FX.init();

    setLoad(0.85, '装配三种载具…');
    vehicles = buildVehicles(THREE, M);
    rig = new THREE.Group();
    tilt = new THREE.Group();
    tilt.rotation.order = 'YXZ';
    // spin：特技 / 摔车翻滚的枢轴组，位置在重心高度，载具根节点反向偏移，
    // 所以旋转轴心落在躯干中心而不是轮胎接地斑。
    spin = new THREE.Group();
    spin.rotation.order = 'YXZ';
    rig.add(tilt);
    tilt.add(spin);
    spin.add(vehicles.root);
    scene.add(rig);
    buildContactShadow();

    audio = new AudioEngine();
    audio.setVolume(settings.volume);

    setLoad(0.93, '校准风与相机…');
    buildMenu();
    initUI();
    initInput();
    post = new Post();
    world.reset(0);
    resetPlayer(game.selected, 0);
    camState.pos.set(player.pos.x + 8, player.pos.y + 4, player.pos.z + 8);
    camState.look.copy(player.pos);
    updateHUD(true);
    drawGauge(0, 0, 0);

    // 预热一帧，避免首次进入时的编译卡顿
    world.update(0.016, player.pos, 0, true);
    renderer.compile(scene, camera);
    post.render(0, 0);

    setLoad(1, '准备就绪');
    DOM.loading.style.display = 'none';
    gotoMenu();
    clock.start();
    fpsAcc = performance.now();
    if (rafId === null) rafId = requestAnimationFrame(frame);

    // 调试/QA 句柄（只读引用，不影响玩法）
    window.WWD = {
      version: '1.0.0', game, player, settings, world, FX, audio, vehicles,
      THREE, renderer, scene, camera, post, input, camState,
      fn: { pathX, pathYaw, heightAt, heightField, descentAt, surfaceAt, streamX, hash2, vnoise, fbm },
      api: { startRace, gotoMenu, respawn, switchVehicle, togglePause, toggleMute, finishRace, applyQuality, updatePlayer, passCheckpoint }
    };
  } catch (err) {
    console.error(err);
    fatal('初始化山谷时发生错误。', (err && err.stack) ? String(err.stack).slice(0, 900) : String(err));
  }
}

window.addEventListener('error', (e) => {
  if (game.state === 'loading') {
    fatal('页面脚本发生错误，无法启动游戏。', (e && e.message) || 'unknown');
  }
});
window.addEventListener('unhandledrejection', (e) => {
  if (game.state === 'loading') {
    fatal('资源加载被拒绝，无法启动游戏。', String((e && e.reason) || 'unknown').slice(0, 600));
  }
});

boot();
</script>
</body>
</html>