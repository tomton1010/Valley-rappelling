/* ============================================================================
 * 山谷速降 · 构建脚本
 *
 * src/ 下的 8 个分片按文件名顺序拼接成单一 HTML。分片之间共享同一个
 * <script type="module"> 作用域，彼此不用 import/export，因此顺序即依赖顺序。
 *
 * 产出两份：
 *   dist/山谷速降.html  单文件版，引擎走 CDN（jsdelivr，失败回退 unpkg）
 *   index.html          站点版，引擎指向随仓库自带的 ./three.module.js
 *
 * 用法：node tools/build.mjs
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARTS = [
  '10-head.html', '20-core.js', '30-world.js', '40-vehicles.js',
  '50-audio.js', '60-fx.js', '70-player.js', '80-game.js'
];

let out = '';
for (const p of PARTS) {
  const t = fs.readFileSync(path.join(ROOT, 'src', p), 'utf8');
  out += t;
  if (!t.endsWith('\n')) out += '\n';
}

const mod = out.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!mod) {
  console.error('构建失败：未找到 <script type="module"> 块，检查 src/10-head.html 与 src/80-game.js');
  process.exit(1);
}

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', '山谷速降.html'), out);

// 站点版：把 importmap 的 three 指向本地引擎，并补上分享用的社交元信息。
const CDN_ENTRY = "'three': host + VER + '/build/three.module.js',";
if (!out.includes(CDN_ENTRY)) {
  console.error('构建失败：src/10-head.html 中的 importmap 入口已变化，请同步本脚本');
  process.exit(1);
}
const META_ANCHOR = '<meta name="theme-color" content="#7fd3f2" />';
if (!out.includes(META_ANCHOR)) {
  console.error('构建失败：src/10-head.html 中的 theme-color 锚点已变化，请同步本脚本');
  process.exit(1);
}
const site = out
  .replace(CDN_ENTRY, "'three': './three.module.js',")
  .replace(META_ANCHOR, META_ANCHOR + `
<meta name="description" content="山谷速降 · 单文件 3D 第三人称极限速降竞速。骑山地车、骏马或悬浮板，从苍翠高岭一路俯冲抵达溪谷镇。" />
<meta property="og:type" content="website" />
<meta property="og:title" content="山谷速降 | Valley Downhill" />
<meta property="og:description" content="3D 第三人称极限速降竞速 · 三种载具 · 8 道检查点 · 全程序化画面" />
<meta property="og:image" content="cover.png" />
<meta name="twitter:card" content="summary_large_image" />`);
fs.writeFileSync(path.join(ROOT, 'index.html'), site);

// 抽出模块体供 `node --check` 做语法校验（浏览器 API 不影响解析）。
const checkPath = path.join(ROOT, 'dist', '.bundle.check.mjs');
fs.writeFileSync(checkPath, mod[1]);

console.log('单文件版  dist/山谷速降.html  ', out.length, 'bytes');
console.log('站点版    index.html           ', site.length, 'bytes');
console.log('模块体    dist/.bundle.check.mjs', mod[1].split('\n').length, 'lines');
console.log('下一步语法校验：node --check dist/.bundle.check.mjs');