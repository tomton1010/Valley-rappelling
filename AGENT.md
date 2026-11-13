# AGENT.md — 山谷速降 (Valley Downhill)

> 给 AI 协作者的项目初始化说明。**动手改任何代码前先读完本文件。**
> 这里记录的是架构约定与硬性不变量，违反其中任何一条都会引入已经修复过的回归。

---

## 1. 这是什么

单文件 3D 第三人称极限速降竞速游戏。玩家从海拔 1450m 的高岭出发，沿 8600m 的蜿蜒山道
俯冲，穿过 8 道检查点，抵达终点溪谷镇。三种可切换载具：山地自行车 / 草原骏马 / 希卡悬浮板。

- **渲染**：Three.js **r160.1**，仅用核心，**不使用 `three/addons`**（连合并几何体都是自己实现的 `mergeGeos`）。
- **资源**：**零外部资产**。所有几何体、贴图、音频全部程序化生成。没有图片、模型、字体、音频文件。
- **美术**：旷野之息 / 吉卜力风格的三阶卡通着色（`MeshToonMaterial` + 3 像素渐变图）+ 描边 + 自定义泛光与体积光柱。
- **语言**：UI 全中文，代码注释中文。
- **平台**：桌面键鼠 + 移动触屏，同一份代码自适应。

---

## 2. 先跑这两条命令

```bash
node tools/build.mjs                    # 拼接 src/ → dist/山谷速降.html 与 index.html
node --check dist/.bundle.check.mjs     # 语法校验，必须通过
```

本地预览（**必须走 HTTP，不要用 file://**，站点版用了 ES module + importmap）：

```bash
python3 -m http.server 8080
# 打开 http://127.0.0.1:8080/
```

`dist/山谷速降.html` 是单文件版，可以直接双击打开（引擎走 CDN）。

---

## 3. 目录结构

```
src/                    ← 唯一的真实源码，改这里
  10-head.html   619 行  DOM + 全部内联 CSS + importmap 引导 + 早期错误兜底
  20-core.js     603 行  数学工具 / 全局配置 / 引擎加载 / 渲染器 / Post 后期 / 材质工厂
  30-world.js   1416 行  地形函数 / 天空云远山 / 分块地形 Chunk / 植被 / 道具 / 小镇
  40-vehicles.js 1141 行 三种载具建模 + 骑手 + 姿态动画 + 接地点定义
  50-audio.js    756 行  WebAudio 程序化 BGM / 风声 / 载具音 / 音效
  60-fx.js       361 行  粒子对象池 / 尾迹 / 速度线
  70-player.js   915 行  玩家物理 / 落地判定 / 碰撞 / 相机 / 输入
  80-game.js     811 行  游戏流程 / HUD / 主循环 / boot() / window.WWD 导出
tools/build.mjs         构建脚本（路径无关，可在任意机器运行）
index.html              构建产物 · 站点版（引擎指向 ./three.module.js）
dist/山谷速降.html       构建产物 · 单文件版（引擎走 CDN）
three.module.js         自带的 Three.js r160.1（1.27 MB）
cover.png               og:image 分享封面
_headers                Netlify / Cloudflare Pages 缓存策略
.nojekyll               GitHub Pages 关闭 Jekyll
LICENSE-THREE.txt       上游 MIT 许可证（分发引擎必须保留）
```

**`index.html` 与 `dist/` 都是产物，不要手改。** 所有修改落在 `src/`，然后重新构建。

---

## 4. 架构铁律

### 4.1 八个分片共享一个模块作用域

`tools/build.mjs` 只是把 `src/` 按文件名顺序**字符串拼接**。`10-head.html` 末尾打开
`<script type="module">`，`80-game.js` 末尾关闭它。因此：

- 分片之间**没有 import / export**，顶层 `const` / `function` 直接互相可见。
- **文件名顺序即依赖顺序**，不要重命名或调整顺序。
- 不要在任何分片里加 `import`/`export` 语句（除了 `20-core.js` 里动态 `import('three')`）。

### 4.2 `THREE` 在 boot() 里才被赋值

`20-core.js` 顶层是 `let THREE = null`，引擎加载完成后才赋值。
**任何顶层代码都不能直接 `new THREE.xxx`**，否则拿到 null。
所有几何体/材质构建必须放在函数里，由 `boot()` 在引擎就绪后调用。

### 4.3 引擎加载有双 CDN 回退

`10-head.html` 动态注入 importmap（必须在任何 module 解析前）：
主 jsdelivr → 备用 unpkg，错误面板有「切换备用 CDN」按钮，选择存在 `sessionStorage.wwd_mirror`。
站点版把 importmap 的 `three` 改成 `./three.module.js`，**这一步由构建脚本完成**，
所以 `src/10-head.html` 里始终保留 CDN 写法。改动了那行或 `theme-color` meta，
构建脚本会报错提示同步——这是故意的，不要绕过。

---

## 5. 地形与物理（最容易踩坑的部分）

### 5.1 两个高度函数，用途严格区分

| 函数 | 用途 | 说明 |
|---|---|---|
| `heightField(x,z)` | **只用于生成网格顶点** | 解析式，含噪声/悬崖/河道/镇口混合 |
| `heightAt(x,z)` | **所有物理与摆放必须用它** | 读已加载区块的 `hbuf` 栅格，做三角形插值 |

**物理必须站在「看见的那张三角面」上。** `heightAt` 对已加载区块直接读缓存高度栅格，
并按与渲染网格完全相同的对角线（b–c）插值；栅格外才现算 4 个角点。
两条路径数学等价，所以物理与画面逐厘米一致。

> 已实测：射线打网格与 `heightAt` 的最大偏差 **0.0000 m**。
> **不要**为了「更平滑」把物理改成直接调用 `heightField`——那会让凸坡陷进网格、凹坡浮空。

网格参数（`20-core.js`）：`CHUNK_W=260, CHUNK_D=80, SEG_X=72, SEG_Z=26`
→ 单格 `TDX≈3.611m, TDZ≈3.077m`。渲染与物理共用这套格点，改细分要同时考虑两者。

### 5.2 双线性插值的因子不能写错（历史重大 bug）

`heightField` 里两个 fbm 的最低倍频共用格点以省哈希。**两个内层 `lerp` 都必须用 x 向分数**：

```js
const nA0 = lerp(lerp(a00, a10, au), lerp(a01, a11, au), av) * 2 - 1;
//                                                  ^^ 必须是 au，不是 av
const nB0 = lerp(lerp(b00, b10, bu), lerp(b01, b11, bu), bv) * 2 - 1;
```

曾经误写成 `av`/`bv`，导致最低倍频在**每条 z 格线处高度突跳约 ±6m**
（解析场坡度峰值 12.07、曲率峰值 24.4），表现为路面上凭空出现的锐利台阶。
修正后 `nA0` 与 `vnoise(ax,az)` 完全等价，整场 C1 连续。
**改这段务必保持两个内层因子一致。**

### 5.3 悬崖必须是两端归零的脉冲

`heightField` 的起伏谷地特征每 380m 一个（`tc = 260 + k*380`）：

```js
const pulse = sstep(tc - 36, tc, t) * (1 - sstep(tc, tc + 36, t));
h -= (2.8 + r * 2.2) * pulse * Math.exp(-dx * dx);
```

原实现是**永久台阶** `sstep(cz+3, cz-8, z)`，而区间剔除会在贡献仍为满值时把整条丢掉，
造成近垂直的高度回弹。现在两端值与导数都为 0，剔除边界安全。
**不要改回永久台阶，也不要在贡献非零处做硬剔除。**

### 5.4 基础下坡用单调三次 Hermite

`descentAt(t)` 在 8m 网格（`DESCENT_STEP`）上用 `descentTable` + `descentSlope`
做 Hermite 插值，段与段坡度连续。原来是线性插值，每个 8m 网格处有折角。
`buildDescentTable()` 必须同时填 `descentSlope`，否则切线错误。

### 5.5 当前地形平整度基线（回归时对照）

沿 racing line 0.5m 步长扫描：

| 指标 | 解析场 | 渲染网格 |
|---|---|---|
| maxGrade | 0.413 | 0.410 |
| maxCurv | 0.139 | 0.227 |
| meanCurv | 0.0031 | 0.0053 |

曲率 > 0.4 的点数：**0**。改动地形后这几个数不应显著变差。

---

## 6. 姿态与接地

### 6.1 倾角一律缓动，禁止瞬变

```js
// 70-player.js 地形贴合
p.groundPitch = damp(p.groundPitch, targetPitch, 6.5, dt);
p.groundRoll  = damp(p.groundRoll,  targetRoll,  5.5, dt);

// 40-vehicles.js 车体自身（刹车点头 / 转向压弯 / 步态）
chS.pitch = damp(chS.pitch, chPitch, 9, h);
chS.roll  = damp(chS.roll,  chRoll,  9, h);
chS.yaw   = damp(chS.yaw,   chYaw,  10, h);
```

`chY`（悬挂弹跳）**故意不平滑**，保持鲜活。不要顺手把它也 damp 了。

姿态分两层，不要混：
- `tilt` 组 = 地形贴合，绕**接地点**旋转。
- `spin` 组 = 空中特技 / 摔车翻滚，绕**重心**旋转（`spinPivot`）。
  特技角由玩家模块累积后施加到 `spin`，**载具模块里不要再加一遍**，否则会翻倍且轴心错误。

落地残角回正有固定角速度上限（`6.0 * dt`，即 6 rad/s），保证任何帧率下都不会一帧抹掉 1 rad。

### 6.2 接地抬升求解器：穿模零容忍

`70-player.js` 把每个接地点变换到世界，取陷入地面最深的那个，整体抬起同样的量。
- 马：额外沿 4 只蹄底圆周各采 4 点（蹄有 17cm 直径，单点采样会漏判）。
- 摔车翻滚：用整个包围盒 8 个角求最低点。
- 贴地时立刻补足，离地时 `damp(p.lift, 0, 12, dt)` 衰减。

**这个求解器不能删。** 有了它，缓动后的姿态才不会让轮子啃进地里。
基线：自行/马/滑板 `contactClear < -0.02m` 的样本数均为 **0**，马蹄最低 -0.003m。

### 6.3 极速与防卡死

极速已按需求减半：`bike 15.5 / horse 17 / board 18.75`（m/s）。
减半后曾出现自行车在 z≈-2554.8 永久卡死（后方采样得到 -0.756 的上坡坡度）。
修复靠两处，**不要回退**：
- 上坡坡度钳制 `clamp((hBack-hAhead)/5.2, -0.32, 0.9)`
- 速度上限收敛加快 `damp(p.speed, cap, 5.5, dt)`

---

## 7. 调试接口 `window.WWD`

`boot()` 末尾导出（只读引用，不影响玩法）：

```js
window.WWD = {
  version, game, player, settings, world, FX, audio, vehicles,
  THREE, renderer, scene, camera, post, input, camState,
  fn:  { pathX, pathYaw, heightAt, heightField, descentAt, surfaceAt, streamX, hash2, vnoise, fbm },
  api: { startRace, gotoMenu, respawn, switchVehicle, togglePause, toggleMute,
         finishRace, applyQuality, updatePlayer, passCheckpoint }
}
```

`game.state` 取值：`loading → menu → countdown → race ⇄ pause → results`。

自动化测试的常用套路：

```js
// 逻辑跑满速：屏蔽 GPU 提交与粒子，直接以固定 dt 驱动
WWD.post.render = () => {};
WWD.FX.update   = () => {};
WWD.api.updatePlayer(1/60, true);
WWD.world.update(1/60, WWD.player.pos, t, false);
```

---

## 8. 验收清单（改完必须自查）

1. `node tools/build.mjs && node --check dist/.bundle.check.mjs` 通过。
2. HTTP 打开 `index.html`，**控制台 0 错误**，能进菜单。
3. 三种载具**各跑完一次全程**：8 道检查点全过、`z <= -8600`、结算面板弹出。
4. 重开一次（`gotoMenu` → `startRace`），确认循环 / 监听 / 资源不重复累积。
5. 接地穿深：`contactClear < -0.02m` 样本数为 0。
6. 地形扫描指标不劣于第 5.5 节基线。
7. 手机竖屏 390×844：摇杆与仪表盘不重叠、无横向溢出。
8. 桌面与移动端都截图看一眼，确认没有遮挡 / 裁切 / 层级错误。

> 无头环境注意：软件渲染（swiftshader）只有约 1fps，真实 rAF 的 dt 很大。
> 量「每帧角度突变」这类指标时必须用固定 dt 驱动逻辑，否则会把渲染慢误判成姿态瞬变。

---

## 9. 常见任务配方

| 想改什么 | 动哪里 |
|---|---|
| 地形起伏 / 坡度 | `30-world.js` `heightField` / `buildDescentTable`；改完跑地形扫描 |
| 赛道长度 / 检查点 | `20-core.js` `COURSE_LEN` / `CP_Z`（两者要一致，HUD 与结算依赖） |
| 载具手感 | `20-core.js` `VEHICLES`（maxSpeed/accel/turn/grip/jump…） |
| 载具外观 / 骑手 | `40-vehicles.js` 建模与 `poseBike/poseHorse/poseBoard` |
| 姿态缓动快慢 | `70-player.js` 的 6.5/5.5、`40-vehicles.js` 的 9/9/10 |
| 画质档位 | `20-core.js` `QUALITY`（ahead/grass/pines/shadow/msaa/dpr/clouds） |
| 难度 | `20-core.js` `DIFF`（obstacles/rings/crates/timeMul） |
| 泛光 / 光柱 / 色调 | `20-core.js` `Post` 类的 shader |
| 草浪 / 水面 / 云 | `30-world.js` `makeGrassMaterial` / `makeWaterMaterial` / `makeCloudMaterial` |
| 音乐音效 | `50-audio.js`（全程序化，不要引入音频文件） |
| HUD / 菜单 / 结算 | `10-head.html`（DOM+CSS）+ `80-game.js`（逻辑） |

---

## 10. 禁止事项

- ❌ 引入任何外部资产（图片 / 模型 / 字体 / 音频）或除 Three.js 核心外的依赖。
- ❌ 使用 `three/addons`（OrbitControls、GLTFLoader、EffectComposer 等一律不用）。
- ❌ 手改 `index.html` 或 `dist/`——它们是构建产物。
- ❌ 把物理高度从 `heightAt` 换成 `heightField`。
- ❌ 把 §5.2 的插值因子改回 `av`/`bv`。
- ❌ 把悬崖改回永久台阶，或在贡献非零处硬剔除。
- ❌ 移除倾角缓动或接地抬升求解器。
- ❌ 给 `chY` 加平滑。
- ❌ 在分片里加 import/export，或调整分片顺序。
- ❌ 删除 `LICENSE-THREE.txt`（随引擎分发必须保留 MIT 许可证）。

---

## 11. 部署

纯静态站点，无需构建服务。根目录 `index.html` + `.nojekyll` 已备好：

- **GitHub Pages**：Settings → Pages → Source `Deploy from a branch` → `main` / `root`。
- **Netlify / Cloudflare Pages**：直接上传根目录，`_headers` 自动生效
  （引擎 immutable 长缓存，HTML 不缓存）。

站点版零外部依赖：实测屏蔽全部外网后，页面只请求 `/` 与 `/three.module.js`，
外部请求数 0，仍可完整通关。首次加载约 1.6 MB，之后引擎长期缓存。