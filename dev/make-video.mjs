// 把 video/raw/ 里的截图合成教学视频。
//
// 分两步：
//   1) 每个镜头用**浏览器**排一张 1920×1080 的成片帧 ——
//      烫金标题、章节号、说明、暗角全在这一层。
//      走浏览器而不是 ffmpeg drawtext：中文排版要字距、发光、竖排分隔线，
//      drawtext 得自己算字宽，还要指到具体字体文件；而浏览器里
//      用的是游戏**自己那套字体**（STKaiti 楷体），跟画面里已有的字是一路的。
//   2) ffmpeg 给每张帧做慢推（zoompan），再用 xfade 串起来。
//
// 慢推而不是硬切：参考片全程没有一下是「啪」地换画面，全在慢慢漂。
// 用法：node dev/make-video.mjs
import { spawn, execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'video', 'raw');
const FRAMES = path.join(ROOT, 'video', 'frames');
const FFMPEG = 'C:\\Users\\19819\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe';
if (!existsSync(FRAMES)) mkdirSync(FRAMES, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9456;
const profile = path.join(tmpdir(), 'guxian-vid2-' + process.pid);
const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--allow-file-access-from-files', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
async function cdpTargets() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const pg = j.find(x => x.type === 'page');
      if (pg) return [pg];
    } catch (e) { }
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}
let id = 0, ws; const pending = new Map();
function send(method, params) {
  return new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
}
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

// ——— 每个镜头的文案 ———
// gold 是烫金，dim 是暖灰。跟参考片一个路子：金字做主字，灰字做辅字。
const SCENES = [
  { f: '01-开卷', no: '', cn: '归　园', sub: '南山茅舍　·　星露谷的骨架，陶渊明的皮',
    chip: '三格存档　·　开卷即入山' },
  { f: '02-入山', no: '一', cn: '入山', sub: '一畦一畦翻出来，这就是往后一整年的样子',
    chip: 'WASD 走动　·　点田用器物　·　E 说话' },
  { f: '03-耕作', no: '二', cn: '耕作', sub: '翻土、下种、浇水。二十四节气说了算，不是你说了算',
    chip: '1–8 换器物　·　锄翻土　·　瓢浇水' },
  { f: '04-诗册', no: '三', cn: '诗册', sub: '每做成一件从没做过的事，收一句陶诗，注上出处',
    chip: 'V 打开　·　二十七句　·　跨年不清' },
  { f: '05-行状', no: '四', cn: '五门手艺', sub: '耕渔采凿酿。每一门到四级开一个场合，不给纯数值',
    chip: '行状页　·　四级解锁' },
  { f: '06-夜钓', no: '五', cn: '带月', sub: '渔到四级，溪里另出两种夜鱼。全游戏唯一要改作息才拿得到的',
    chip: '带月 20:00 之后　·　咬钩窗口不到一秒' },
  { f: '07-石硐', no: '六', cn: '石硐', sub: '六层，一百零八块。凿到四级才走得通最底下那层',
    chip: '山是有尽的' },
  { f: '08-结语', no: '', cn: '种豆南山下', sub: '草盛豆苗稀', chip: '一年 144 天　·　二十四节气一轮' },
];

// 成片帧。暗角 + 烫金 + 压边都写在这张 HTML 里
function frameHtml(src, sc) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1920px;height:1080px;overflow:hidden;background:#08070a}
  body{font-family:"STKaiti","KaiTi","楷体","Microsoft YaHei",serif}
  .shot{position:absolute;left:0;top:0;width:1920px;height:1080px;
        background:#000 url("file:///${src.replace(/\\/g, '/')}") center/cover no-repeat;
        filter:brightness(.86) contrast(1.04)}
  /* 压暗。参考片的底子就是「暗场里浮着发亮的 UI」——
     而游戏里最亮的是那块宣纸白的面板，不压它，金字就被吃掉了 */
  .vig{position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(130% 100% at 62% 48%, rgba(0,0,0,0) 26%, rgba(4,3,6,.60) 72%, rgba(2,2,4,.96) 100%)}
  .warm{position:absolute;inset:0;pointer-events:none;mix-blend-mode:multiply;
    background:linear-gradient(180deg, rgba(196,150,70,.26), rgba(118,82,34,.12) 46%, rgba(8,6,12,.70))}
  .lift{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;opacity:.13;
    background:radial-gradient(66% 56% at 64% 34%, rgba(228,188,112,.55), rgba(0,0,0,0) 72%)}
  /* 左侧暗幕。标题、说明、角标全落在这一块上 ——
     上一版把它们直接压在截图上，正对着诗册那块白纸，
     「每做成一件从没做过的事」那行整个读不出来 */
  .scrim{position:absolute;left:0;top:0;bottom:0;width:980px;pointer-events:none;
    background:linear-gradient(90deg, rgba(6,5,9,.95) 0%, rgba(6,5,9,.90) 42%, rgba(6,5,9,.55) 72%, rgba(6,5,9,0) 100%)}
  .band{position:absolute;left:0;right:0;height:74px;background:#060508}
  .band.t{top:0}.band.b{bottom:0}
  .bar{position:absolute;left:140px;width:640px;height:1px;
       background:linear-gradient(90deg,rgba(212,175,106,.70),rgba(212,175,106,0))}
  .ttl{position:absolute;left:186px;top:300px;display:flex;align-items:baseline;gap:24px}
  .no{font-size:28px;color:#c9a45c;letter-spacing:.22em;opacity:.92}
  .cn{font-size:76px;line-height:1;color:#ecd096;letter-spacing:.16em;
      text-shadow:0 0 40px rgba(214,172,96,.60), 0 2px 2px rgba(0,0,0,.8)}
  .sub{position:absolute;left:188px;top:412px;width:640px;font-size:27px;line-height:1.55;
       color:#cfc2aa;letter-spacing:.05em;text-shadow:0 2px 10px rgba(0,0,0,.9)}
  .chip{position:absolute;left:188px;bottom:172px;font-size:22px;color:#c0b096;letter-spacing:.10em;
        border:1px solid rgba(212,175,106,.42);padding:9px 20px;background:rgba(6,5,9,.6)}
  .vline{position:absolute;left:150px;top:296px;width:2px;height:124px;
         background:linear-gradient(180deg,rgba(212,175,106,.95),rgba(212,175,106,0))}
  </style></head><body>
    <div class="shot"></div>
    <div class="warm"></div><div class="lift"></div>
    <div class="band t"></div><div class="band b"></div>
    <div class="vig"></div><div class="scrim"></div>
    <div class="bar" style="top:236px"></div>
    <div class="bar" style="bottom:196px"></div>
    <div class="vline"></div>
    <div class="ttl">
      ${sc.no ? `<div class="no">${sc.no}</div>` : ''}
      <div class="cn">${sc.cn}</div>
    </div>
    <div class="sub">${sc.sub}</div>
    <div class="chip">${sc.chip}</div>
  </body></html>`;
}

const t = (await cdpTargets())[0];
ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
  }
});
await send('Page.enable'); await send('Runtime.enable');

console.log('— 排帧 —');
for (let i = 0; i < SCENES.length; i++) {
  const sc = SCENES[i];
  const src = path.join(RAW, sc.f + '.png');
  const html = frameHtml(src, sc);
  const tmp = path.join(FRAMES, '_t.html');
  writeFileSync(tmp, html, 'utf8');
  await send('Page.navigate', { url: pathToFileURL(tmp).href });
  await sleep(900);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(FRAMES, String(i + 1).padStart(2, '0') + '-' + sc.f + '.png');
  writeFileSync(out, Buffer.from(s.data, 'base64'));
  console.log('  帧 ' + path.basename(out));
}
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }

// ——— ffmpeg：慢推 + 叠化 ———
// 每张 3.2 秒，zoompan 从 1.0 推到 1.07 —— 参考片全程没有硬切，都是这么慢慢漂的
const files = readdirSync(FRAMES).filter(f => /^\d\d-/.test(f)).sort();
const CLIPS = [];
for (let i = 0; i < files.length; i++) {
  const out = path.join(FRAMES, 'c' + i + '.mp4');
  const alt = i % 2 === 0;                       // 一推一拉，交替着来，看不出规律
  const z = alt
    ? "min(zoom+0.00035,1.07)"                  // 慢推
    : "if(eq(on,1),1.07,max(1.001,zoom-0.00035))"; // 慢拉
  const x = alt ? "iw/2-(iw/zoom/2)" : "iw/2-(iw/zoom/2)+40*sin(on/25)";
  const y = alt ? "ih/2-(ih/zoom/2)" : "ih/2-(ih/zoom/2)-30*cos(on/30)";
  execFileSync(FFMPEG, ['-y', '-loop', '1', '-i', path.join(FRAMES, files[i]),
    '-t', '3.2', '-r', '30', '-filter_complex',
    `scale=3840:2160:flags=lanczos,zoompan=z='${z}':d=96:x='${x}':y='${y}':s=1920x1080:fps=30,setsar=1,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', out], { stdio: 'ignore' });
  CLIPS.push(out);
  console.log('  段 ' + (i + 1) + '/' + files.length);
}

// 串接交给 join-video.mjs，**这里不碰 xfade**。
//
// 原来把串接也写在下面，跟 join-video.mjs 里那份是同一个逻辑的两个副本。
// 两份会分叉——修好了其中一份，另一份还带着坑
// （少分号、offset 顶格、链尾挂 format、忘了 -y，四样都踩过）。
// 一份逻辑就放一个地方：这里只负责排帧和做段，串接去 join-video.mjs。
// 段文件也别删 —— join-video.mjs 要用；重跑一次就能覆盖
rmSync(path.join(FRAMES, '_t.html'), { force: true });
console.log('\n段文件留在 video/frames/　接着跑：node dev/join-video.mjs');
process.exit(0);
