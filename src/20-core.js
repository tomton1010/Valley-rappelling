/* ============================================================================
 * 山谷速降  (Valley Downhill)
 * 单文件 3D 第三人称极限速降竞速 · Three.js r160 · 全程序化资源
 * 模块结构：
 *   20 引导 / 工具 / 渲染器 / 自定义泛光后期
 *   30 世界：天空、云、远山、分块地形、草浪、植被、互动地形、小镇
 *   40 载具：自行车 / 马 / 悬浮滑板 + 骑手
 *   50 音频：WebAudio 原创 BGM + 风声 + 载具音 + 音效
 *   60 特效：粒子对象池、尾迹、速度线
 *   70 玩家物理 / 相机 / 输入
 *   80 游戏流程 / HUD / 主循环
 * ========================================================================== */

/* ------------------------------ DOM 工具 ------------------------------ */
const $ = (id) => document.getElementById(id);
const DOM = {
  stage: $('stage'), fx: $('fx'), flash: $('flash'), loading: $('loading'),
  loadBar: $('loadBar'), loadText: $('loadText'), errBox: $('errBox'), errMsg: $('errMsg'),
  errDetail: $('errDetail'), btnRetry: $('btnRetry'), btnMirror: $('btnMirror'),
  menu: $('menu'), vehGrid: $('vehGrid'), btnStart: $('btnStart'), btnHowto: $('btnHowto'),
  keysHelp: $('keysHelp'), menuVolume: $('menuVolume'), menuQuality: $('menuQuality'),
  menuDifficulty: $('menuDifficulty'), menuCam: $('menuCam'),
  volVal: $('volVal'), qualVal: $('qualVal'), diffVal: $('diffVal'), camVal: $('camVal'),
  hud: $('hud'), timerVal: $('timerVal'), cpRow: $('cpRow'), lastSplit: $('lastSplit'),
  distVal: $('distVal'), distFill: $('distFill'), distTicks: $('distTicks'),
  speedo: $('speedo'), vehIcon: $('vehIcon'), vehName: $('vehName'), vehKeys: $('vehKeys'),
  staminaWrap: $('staminaWrap'), staminaFill: $('staminaFill'), boostFill: $('boostFill'),
  trickPop: $('trickPop'), trickName: $('trickName'), trickScore: $('trickScore'), trickCombo: $('trickCombo'),
  toast: $('toast'), airTag: $('airTag'), surfaceTag: $('surfaceTag'), keysHint: $('keysHint'),
  airPanel: $('airPanel'), trickDial: $('trickDial'), airState: $('airState'), airHint: $('airHint'),
  gateGuide: $('gateGuide'), ggArrow: $('ggArrow'), ggName: $('ggName'), ggDist: $('ggDist'),
  countdown: $('countdown'), cdNum: $('cdNum'), cdSub: $('cdSub'),
  pause: $('pause'), btnResume: $('btnResume'), btnRestartP: $('btnRestartP'),
  btnRespawnP: $('btnRespawnP'), btnMenuP: $('btnMenuP'),
  pauseVolume: $('pauseVolume'), pauseQuality: $('pauseQuality'), pauseCam: $('pauseCam'), pauseGrass: $('pauseGrass'),
  volVal2: $('volVal2'), qualVal2: $('qualVal2'), camVal2: $('camVal2'), grassVal: $('grassVal'),
  results: $('results'), rankBadge: $('rankBadge'), rankText: $('rankText'), resTotal: $('resTotal'),
  resTrick: $('resTrick'), resTop: $('resTop'), resAir: $('resAir'), resSmash: $('resSmash'),
  resCrash: $('resCrash'), resScore: $('resScore'), resSplits: $('resSplits'),
  btnAgain: $('btnAgain'), btnChange: $('btnChange'), resTitle: $('resTitle'),
  btnMute: $('btnMute'), muteState: $('muteState'), muteX: $('muteX'), wave1: $('wave1'), wave2: $('wave2'),
  btnPause: $('btnPause'), touch: $('touch'), joyBase: $('joyBase'), joyKnob: $('joyKnob'),
  btnJump: $('btnJump'), btnSprint: $('btnSprint'), btnSwitch: $('btnSwitch'), fpsTag: $('fpsTag')
};

function setLoad(p, text) {
  DOM.loadBar.style.width = Math.round(p * 100) + '%';
  if (text) DOM.loadText.textContent = text;
}
function fatal(msg, detail) {
  DOM.loading.style.display = 'none';
  DOM.errMsg.textContent = msg;
  DOM.errDetail.textContent = detail || '';
  DOM.errBox.classList.add('show');
}
DOM.btnRetry.addEventListener('click', () => location.reload());
DOM.btnMirror.addEventListener('click', () => {
  try {
    const cur = sessionStorage.getItem('wwd_mirror');
    sessionStorage.setItem('wwd_mirror', cur === 'unpkg' ? 'jsdelivr' : 'unpkg');
  } catch (e) { /* 隐私模式下 sessionStorage 不可用：直接重载 */ }
  location.reload();
});

/* ------------------------------ 数学工具 ------------------------------ */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a || 1e-6), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const TAU = Math.PI * 2;
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const rand = (a, b) => a + Math.random() * (b - a);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}
function fbm(x, y, oct) {
  let s = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
  return s / norm;
}
function fmtTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
}

/* ------------------------------ 全局配置 ------------------------------ */
const COURSE_LEN = 3200;               // 起点 z=0 → 终点 z=-3200（全程约 2~3 分钟）
const START_H = 1450;                  // 起点海拔（终点溪谷镇约在 y≈910）
const BASE_GRADE = 0.168;              // 平均坡度
// SEG_X / SEG_Z 同时决定「渲染网格」与「物理高度」的采样密度：两者共用同一
// 格点与同一套三角形对角线，所以贴地判定与看到的坡面逐厘米一致（不会穿模）。
const CHUNK_D = 80, CHUNK_W = 260, SEG_X = 72, SEG_Z = 26;
const TDX = CHUNK_W / SEG_X, TDZ = CHUNK_D / SEG_Z;
const POOL_SIZE = 14;
const CP_Z = [-355, -705, -1060, -1415, -1765, -2120, -2475, -2830];
const FINISH_Z = -COURSE_LEN;
const GRAVITY = 26;
const IS_TOUCH = (('ontouchstart' in window) || navigator.maxTouchPoints > 0) &&
                 matchMedia('(pointer: coarse)').matches;

const QUALITY = {
  low:  { ahead: 5, behind: 1, grass: 1900, pines: 46, rocks: 26, bloom: false, shadow: 1024, msaa: 0, dpr: 1.35, clouds: 46 },
  med:  { ahead: 8, behind: 2, grass: 4200, pines: 74, rocks: 40, bloom: true,  shadow: 1536, msaa: 2, dpr: 1.75, clouds: 72 },
  high: { ahead: 10, behind: 2, grass: 6400, pines: 96, rocks: 54, bloom: true, shadow: 2048, msaa: 4, dpr: 2, clouds: 96 }
};
const DIFF = {
  easy:   { obstacles: 0.6, rings: 1.35, crates: 1.3, timeMul: 1.18, label: '悠闲' },
  normal: { obstacles: 1.0, rings: 1.0,  crates: 1.0, timeMul: 1.0,  label: '旅人' },
  hard:   { obstacles: 1.5, rings: 0.8,  crates: 0.85, timeMul: 0.86, label: '疾风' }
};

/* 载具参数：三种手感差异明显 */
const VEHICLES = {
  bike: {
    key: 'bike', name: '山地自行车', en: 'MOUNTAIN BIKE', tag: '均衡 · BALANCED',
    desc: '蹬踏加速稳定、刹车灵敏，可主动小跳。落地避震吸收冲击，适合新手熟悉路线。',
    maxSpeed: 15.5, accel: 11.5, brake: 26, turn: 1.85, grip: 0.86, jump: 8.6,
    airControl: 0.72, crashPenalty: 0.45, rollDrag: 0.55, sprintMul: 1.16,
    stats: { 速度: 0.62, 加速: 0.6, 跳跃: 0.55, 操控: 0.85 }, color: '#ff5a3c'
  },
  horse: {
    key: 'horse', name: '草原骏马', en: 'WILD COURSER', tag: '技巧 · TECHNICAL',
    desc: '爆发式冲刺消耗体力，慢跑时恢复。跳跃最高、空中特技窗口最长，落地缓冲优秀。',
    maxSpeed: 17, accel: 13.5, brake: 20, turn: 1.62, grip: 0.78, jump: 12.4,
    airControl: 0.9, crashPenalty: 0.4, rollDrag: 0.72, sprintMul: 1.34,
    stats: { 速度: 0.74, 加速: 0.78, 跳跃: 1.0, 操控: 0.66 }, color: '#b0703c'
  },
  board: {
    key: 'board', name: '希卡悬浮板', en: 'SHEIKAH GLIDER', tag: '极速 · VELOCITY',
    desc: '最高速度与加速度，转向带漂移倾角，板底推进器留下光带。碰撞惩罚最大，需要精准走线。',
    maxSpeed: 18.75, accel: 17.5, brake: 15, turn: 1.42, grip: 0.62, jump: 9.6,
    airControl: 1.05, crashPenalty: 0.68, rollDrag: 0.44, sprintMul: 1.22,
    stats: { 速度: 1.0, 加速: 1.0, 跳跃: 0.7, 操控: 0.5 }, color: '#35e0ff'
  }
};
const VEH_ORDER = ['bike', 'horse', 'board'];

/* ------------------------------ 引擎加载 ------------------------------ */
let THREE = null;
async function loadEngine() {
  const info = window.__WWD_CDN__ || { version: '0.160.1', host: 'https://cdn.jsdelivr.net/npm/three@' };
  const primary = info.host + info.version + '/build/three.module.js';
  const backup = (info.mirror === 'unpkg'
    ? 'https://cdn.jsdelivr.net/npm/three@'
    : 'https://unpkg.com/three@') + info.version + '/build/three.module.js';
  setLoad(0.12, '正在从 CDN 召唤渲染引擎…');
  try {
    return await import('three');
  } catch (e1) {
    setLoad(0.2, '主 CDN 未响应，尝试备用线路…');
    try {
      return await import(/* @vite-ignore */ backup);
    } catch (e2) {
      try { return await import(/* @vite-ignore */ primary); } catch (e3) {
        fatal('未能从 CDN 加载 Three.js 渲染引擎，游戏无法启动。',
          'primary: ' + primary + '\n' + (e1 && e1.message) + '\nbackup: ' + backup + '\n' + (e2 && e2.message));
        return null;
      }
    }
  }
}

/* ------------------------------ 渲染核心 ------------------------------ */
let renderer, scene, camera, post, clock;
const settings = {
  quality: IS_TOUCH ? 'low' : 'med',
  difficulty: 'normal',
  volume: 0.75,
  camDist: 6.2,
  grassMul: IS_TOUCH ? 0.5 : 1,
  muted: false
};
let Q = QUALITY[settings.quality];

function initRenderer() {
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false
    });
  } catch (e) {
    fatal('这台设备暂时无法创建 WebGL 画布，山谷无法展开。',
      '请尝试：① 在浏览器设置中开启「使用硬件加速」后重启浏览器；'
      + '② 更新显卡驱动；③ 换用最新版 Chrome / Edge / Firefox / Safari 打开本文件。\n'
      + (e && e.message ? e.message : ''));
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;   // 色调映射在合成 pass 中完成
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;        // 阴影按需刷新，不逐帧重算
  renderer.setClearColor(0xbfe6f5, 1);
  DOM.stage.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    fatal('WebGL 上下文丢失（显卡资源被系统回收）。', '请点击“重新加载”重新进入山谷。');
  }, false);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd6ecf7, 260, 1020);
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.35, 1400);
  camera.position.set(0, START_H + 8, 12);
  clock = new THREE.Clock();
  return true;
}

/* ---- 自定义轻量泛光后期（仅依赖 three 核心，无 addons 依赖） ---- */
const QUAD_VS = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

class Post {
  constructor() {
    const gl2 = renderer.capabilities.isWebGL2;
    this.enabled = gl2;
    this.strength = 0.62;
    this.threshold = 0.86;
    const type = gl2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const opts = { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, Object.assign({ samples: Q.msaa }, opts));
    this.rtA = new THREE.WebGLRenderTarget(2, 2, Object.assign({ depthBuffer: false }, opts));
    this.rtB = new THREE.WebGLRenderTarget(2, 2, Object.assign({ depthBuffer: false }, opts));
    this.rtC = new THREE.WebGLRenderTarget(2, 2, Object.assign({ depthBuffer: false }, opts));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, threshold: { value: this.threshold } },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.2126,0.7152,0.0722));
          float k = max(0.0, l - threshold) / max(l, 1e-4);
          gl_FragColor = vec4(c * k, 1.0);
        }`,
      depthTest: false, depthWrite: false
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2(1, 0) }, res: { value: new THREE.Vector2(1, 1) } },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 dir; uniform vec2 res; varying vec2 vUv;
        void main(){
          vec2 px = dir / res;
          vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
          s += (texture2D(tDiffuse, vUv + px*1.3846).rgb + texture2D(tDiffuse, vUv - px*1.3846).rgb) * 0.316216;
          s += (texture2D(tDiffuse, vUv + px*3.2307).rgb + texture2D(tDiffuse, vUv - px*3.2307).rgb) * 0.070270;
          gl_FragColor = vec4(s, 1.0);
        }`,
      depthTest: false, depthWrite: false
    });
    this.rayMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, sunPos: { value: new THREE.Vector2(0.5, 0.5) },
        amount: { value: 0 }, density: { value: 0.62 }, decay: { value: 0.972 },
        thresh: { value: 0.92 }, seed: { value: 0 }, aspect: { value: 1 }
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 sunPos;
        uniform float amount, density, decay, thresh, seed, aspect; varying vec2 vUv;
        void main(){
          if (amount <= 0.001) { gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }
          // 屏幕空间径向采样：几何遮挡处不亮，于是自然形成被树冠 / 山脊切割的光柱。
          // 只取真正的高光（太阳盘、发光环、云冠），中亮地形不参与，否则只会糊出一层灰纱。
          const int TAPS = 32;
          vec2 stp = (vUv - sunPos) * density / float(TAPS);
          // 每像素抖动起步偏移：把离散采样的同心环打散成噪点，再由后面的模糊抹平
          float jit = fract(sin(dot(vUv, vec2(12.9898, 78.233)) + seed) * 43758.5453);
          vec2 c = vUv - stp * jit;
          float illum = 1.0;
          vec3 acc = vec3(0.0);
          for (int i = 0; i < TAPS; i++) {
            c -= stp;
            vec3 s = texture2D(tDiffuse, clamp(c, vec2(0.002), vec2(0.998))).rgb;
            float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
            float k = max(0.0, l - thresh) / max(l, 1e-4);
            acc += s * (k * k) * illum;
            illum *= decay;
          }
          // 光源附近的整体辉光：太阳压在树冠 / 山脊后时，画面里仍能读出逆光
          vec2 sd = (vUv - sunPos) * vec2(aspect, 1.0);
          float glow = exp(-dot(sd, sd) * 26.0) * 0.40;
          gl_FragColor = vec4((acc * (2.6 / float(TAPS)) + vec3(1.0, 0.93, 0.78) * glow) * amount, 1.0);
        }`,
      depthTest: false, depthWrite: false
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tBloom: { value: null }, tRays: { value: null },
        strength: { value: this.strength }, exposure: { value: 1.0 },
        vignette: { value: 0.30 }, rush: { value: 0 }, sat: { value: 1.18 },
        rayStrength: { value: 0.52 },
        rayTint: { value: new THREE.Color(0xffe6b0) },
        tint: { value: new THREE.Color(0x8fe8ff) }, time: { value: 0 }
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tDiffuse, tBloom, tRays;
        uniform float strength, exposure, vignette, rush, sat, time, rayStrength;
        uniform vec3 tint, rayTint; varying vec2 vUv;
        vec3 aces(vec3 x){
          const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
          return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
        }
        void main(){
          vec2 uv = vUv;
          vec2 d = uv - 0.5;
          float r = length(d);
          // 冲刺时的轻微径向拉伸（速度感）
          vec3 base;
          if (rush > 0.001) {
            vec3 acc = vec3(0.0);
            for (int i = 0; i < 4; i++) {
              float f = float(i) / 3.0;
              acc += texture2D(tDiffuse, uv - d * f * 0.055 * rush).rgb;
            }
            base = acc / 4.0;
          } else {
            // 镜头边缘色散：画面四角轻微分离 RGB，得到「会动的概念图」的镜头质感
            float ca = (0.0011 + rush * 0.0035) * smoothstep(0.28, 0.95, r);
            base = vec3(
              texture2D(tDiffuse, uv + d * ca).r,
              texture2D(tDiffuse, uv).g,
              texture2D(tDiffuse, uv - d * ca).b);
          }
          vec3 bloom = texture2D(tBloom, uv).rgb;
          vec3 rays = texture2D(tRays, uv).rgb;
          vec3 col = base + bloom * strength + rays * rayTint * rayStrength
                   + tint * rush * 0.10 * smoothstep(0.15, 0.7, r);
          col *= exposure;
          col = aces(col);
          float lum = dot(col, vec3(0.2126,0.7152,0.0722));
          col = mix(vec3(lum), col, sat);
          col *= 1.0 - vignette * smoothstep(0.32, 0.95, r);
          // 极轻微胶片颗粒，让画面像会动的概念图
          float g = fract(sin(dot(uv * vec2(1024.0, 768.0) + time, vec2(12.9898, 78.233))) * 43758.5453);
          col += (g - 0.5) * 0.016;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false
    });
    this.setSize(window.innerWidth, window.innerHeight);
  }
  setSize(w, h) {
    const dpr = renderer.getPixelRatio();
    const W = Math.max(2, Math.floor(w * dpr)), H = Math.max(2, Math.floor(h * dpr));
    this.rtScene.setSize(W, H);
    const bw = Math.max(2, Math.floor(W / 4)), bh = Math.max(2, Math.floor(H / 4));
    this.rtA.setSize(bw, bh); this.rtB.setSize(bw, bh); this.rtC.setSize(bw, bh);
    this.blurMat.uniforms.res.value.set(bw, bh);
    this.rayMat.uniforms.aspect.value = W / H;
  }
  render(t, rush, sunUv, rayAmount) {
    if (!this.enabled || !Q.bloom) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    renderer.setRenderTarget(this.rtScene);
    renderer.clear();
    renderer.render(scene, camera);

    this.quad.material = this.brightMat;
    this.brightMat.uniforms.tDiffuse.value = this.rtScene.texture;
    renderer.setRenderTarget(this.rtA); renderer.render(this.quadScene, this.cam);

    this.quad.material = this.blurMat;
    for (let i = 0; i < 2; i++) {
      this.blurMat.uniforms.tDiffuse.value = this.rtA.texture;
      this.blurMat.uniforms.dir.value.set(1 + i, 0);
      renderer.setRenderTarget(this.rtB); renderer.render(this.quadScene, this.cam);
      this.blurMat.uniforms.tDiffuse.value = this.rtB.texture;
      this.blurMat.uniforms.dir.value.set(0, 1 + i);
      renderer.setRenderTarget(this.rtA); renderer.render(this.quadScene, this.cam);
    }

    // 体积光柱：从原始亮部沿太阳方向做径向累积（¼ 分辨率，32 次带抖动采样）
    const amt = rayAmount || 0;
    this.quad.material = this.rayMat;
    this.rayMat.uniforms.tDiffuse.value = this.rtScene.texture;
    this.rayMat.uniforms.amount.value = amt;
    this.rayMat.uniforms.seed.value = (t * 0.61) % 10;
    if (sunUv) this.rayMat.uniforms.sunPos.value.copy(sunUv);
    renderer.setRenderTarget(this.rtB); renderer.render(this.quadScene, this.cam);

    // 光柱再横竖各糊一次：彻底消掉径向采样残留的同心纹，只留柔和光柱
    if (amt > 0.001) {
      this.quad.material = this.blurMat;
      this.blurMat.uniforms.tDiffuse.value = this.rtB.texture;
      this.blurMat.uniforms.dir.value.set(1.6, 0);
      renderer.setRenderTarget(this.rtC); renderer.render(this.quadScene, this.cam);
      this.blurMat.uniforms.tDiffuse.value = this.rtC.texture;
      this.blurMat.uniforms.dir.value.set(0, 1.6);
      renderer.setRenderTarget(this.rtB); renderer.render(this.quadScene, this.cam);
    }

    this.quad.material = this.compMat;
    this.compMat.uniforms.tDiffuse.value = this.rtScene.texture;
    this.compMat.uniforms.tBloom.value = this.rtA.texture;
    this.compMat.uniforms.tRays.value = this.rtB.texture;
    this.compMat.uniforms.rush.value = rush;
    this.compMat.uniforms.time.value = t;
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.cam);
  }
  dispose() {
    this.rtScene.dispose(); this.rtA.dispose(); this.rtB.dispose(); this.rtC.dispose();
    this.brightMat.dispose(); this.blurMat.dispose(); this.rayMat.dispose();
    this.compMat.dispose(); this.quad.geometry.dispose();
  }
}

/* ------------------------------ 材质工厂 ------------------------------ */
let M = null;
function makeMaterials() {
  // 三阶卡通渐变
  const data = new Uint8Array([112, 112, 112, 255, 180, 180, 180, 255, 255, 255, 255, 255]);
  const grad = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.generateMipmaps = false;
  grad.needsUpdate = true;

  const cache = new Map();
  const outlines = {};
  const mkOutline = (t) => new THREE.ShaderMaterial({
    uniforms: {
      thickness: { value: t }, color: { value: new THREE.Color(0x2a2038) },
      fogColor: { value: new THREE.Color(0xd6ecf7) }, fogNear: { value: 260 }, fogFar: { value: 1000 }
    },
    vertexShader: `
      uniform float thickness; varying float vFog;
      void main(){
        vec3 p = position + normal * thickness;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFog = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color, fogColor; uniform float fogNear, fogFar; varying float vFog;
      void main(){
        float f = smoothstep(fogNear, fogFar, vFog);
        gl_FragColor = vec4(mix(color, fogColor, f), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, fog: false
  });
  outlines.thin = mkOutline(0.018);
  outlines.norm = mkOutline(0.032);
  outlines.thick = mkOutline(0.06);

  const api = {
    gradient: grad,
    setFog(near, far) {
      for (const k in outlines) {
        outlines[k].uniforms.fogNear.value = near;
        outlines[k].uniforms.fogFar.value = far;
      }
    },
    toon(color, o) {
      o = o || {};
      const key = 'T' + color + '|' + (o.emissive || 0) + '|' + (o.emissiveIntensity || 0) + '|' +
        (o.vertexColors ? 1 : 0) + '|' + (o.opacity === undefined ? 1 : o.opacity) + '|' +
        (o.side || 0) + '|' + (o.transparent ? 1 : 0);
      if (cache.has(key)) return cache.get(key);
      const m = new THREE.MeshToonMaterial({
        color, gradientMap: grad,
        vertexColors: !!o.vertexColors,
        transparent: !!o.transparent,
        opacity: o.opacity === undefined ? 1 : o.opacity,
        side: o.side === undefined ? THREE.FrontSide : o.side,
        emissive: o.emissive === undefined ? 0x000000 : o.emissive,
        emissiveIntensity: o.emissiveIntensity === undefined ? 1 : o.emissiveIntensity
      });
      cache.set(key, m);
      return m;
    },
    basic(color, o) {
      o = o || {};
      const key = 'B' + color + '|' + (o.opacity === undefined ? 1 : o.opacity) + '|' + (o.side || 0) + '|' + (o.transparent ? 1 : 0);
      if (cache.has(key)) return cache.get(key);
      const m = new THREE.MeshBasicMaterial({
        color, transparent: !!o.transparent, opacity: o.opacity === undefined ? 1 : o.opacity,
        side: o.side === undefined ? THREE.FrontSide : o.side, fog: o.fog === undefined ? true : o.fog,
        depthWrite: o.depthWrite === undefined ? true : o.depthWrite,
        blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false
      });
      cache.set(key, m);
      return m;
    },
    glow(color, mult) {
      const c = new THREE.Color(color).multiplyScalar(mult === undefined ? 2.2 : mult);
      const m = new THREE.MeshBasicMaterial({ color: c, toneMapped: false, fog: false });
      return m;
    },
    outline(mesh, thickness) {
      const t = thickness === undefined ? 0.032 : thickness;
      const mat = t <= 0.022 ? outlines.thin : (t <= 0.045 ? outlines.norm : outlines.thick);
      const o = new THREE.Mesh(mesh.geometry, mat);
      o.castShadow = false; o.receiveShadow = false;
      o.renderOrder = -1;
      mesh.add(o);
      return mesh;
    },
    outlineMats: outlines,
    mergeGeos(geos) { return mergeGeos(geos); },
    disposeAll() {
      cache.forEach(m => m.dispose());
      cache.clear();
      outlines.thin.dispose(); outlines.norm.dispose(); outlines.thick.dispose();
      grad.dispose();
    }
  };
  return api;
}

/* 合并几何体（保留 vertex color），避免依赖 addons */
function mergeGeos(geos) {
  const list = geos.map(g => g.index ? g.toNonIndexed() : g);
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  const c = new THREE.Color();
  for (let gi = 0; gi < list.length; gi++) {
    const g = list[gi];
    const p = g.attributes.position.array, n = g.attributes.normal ? g.attributes.normal.array : null;
    const cc = g.attributes.color ? g.attributes.color.array : null;
    const u = g.attributes.uv ? g.attributes.uv.array : null;
    const cnt = g.attributes.position.count;
    const base = g.userData.tint === undefined ? null : c.set(g.userData.tint);
    for (let i = 0; i < cnt; i++) {
      pos[(o + i) * 3] = p[i * 3]; pos[(o + i) * 3 + 1] = p[i * 3 + 1]; pos[(o + i) * 3 + 2] = p[i * 3 + 2];
      if (n) { nor[(o + i) * 3] = n[i * 3]; nor[(o + i) * 3 + 1] = n[i * 3 + 1]; nor[(o + i) * 3 + 2] = n[i * 3 + 2]; }
      if (cc) { col[(o + i) * 3] = cc[i * 3]; col[(o + i) * 3 + 1] = cc[i * 3 + 1]; col[(o + i) * 3 + 2] = cc[i * 3 + 2]; }
      else if (base) { col[(o + i) * 3] = base.r; col[(o + i) * 3 + 1] = base.g; col[(o + i) * 3 + 2] = base.b; }
      else { col[(o + i) * 3] = 1; col[(o + i) * 3 + 1] = 1; col[(o + i) * 3 + 2] = 1; }
      if (u) { uv[(o + i) * 2] = u[i * 2]; uv[(o + i) * 2 + 1] = u[i * 2 + 1]; }
    }
    o += cnt;
    if (list[gi] !== geos[gi]) list[gi].dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

/* 给几何体写入顶点色（可带随机明度抖动） */
function tintGeo(g, hex, jitter, rng) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = jitter ? 1 + ((rng ? rng() : Math.random()) - 0.5) * jitter : 1;
    arr[i * 3] = clamp(c.r * j, 0, 1); arr[i * 3 + 1] = clamp(c.g * j, 0, 1); arr[i * 3 + 2] = clamp(c.b * j, 0, 1);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/* Canvas 程序化贴图：用于旗帜 / 招牌 / 水面细节 */
function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}