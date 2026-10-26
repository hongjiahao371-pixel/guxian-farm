/* 人物笔触快速预览：把老农/两个村民按实际进深画在真底图上，一次看三种尺寸。
   人物是纯代码画的，改一行就得重画一次 —— 跑完整验收太慢，单独开个预览。 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = ROOT + 'dev/_fig';
const PORT = 9355;
const W = 1600, H = 900;
const PROFILE = join(tmpdir(), 'guxian-fig-profile');

mkdirSync(OUT, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  `--window-size=${W},${H}`, '--allow-file-access-from-files',
  '--user-data-dir=' + PROFILE, 'about:blank',
], { stdio: 'ignore' });

let ws, id = 0;
const pend = new Map();
function send(method, params = {}) {
  const msg = { id: ++id, method, params };
  ws.send(JSON.stringify(msg));
  return new Promise(r => pend.set(msg.id, r));
}
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const pg = list.find(t => t.type === 'page');
      if (pg) return pg.webSocketDebuggerUrl;
    } catch { }
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}
const url = await connect();
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
});
await send('Runtime.enable'); await send('Page.enable');
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const file = pathToFileURL(ROOT + 'index.html').href;
await send('Page.navigate', { url: file });
await sleep(2600);
console.log('INK 就位 =', await ev(`!!(window.FG && FG.INK && FG.INK.farmer)`));

// 主循环每帧会重画整张画布，手画的会被擦掉 —— 先把 rAF 掐掉，
// 顺带把开卷浮层收起来（它是 pointer-events:auto 的满屏浮层）
await ev(`(()=>{ window.requestAnimationFrame = function(){ return 0; };
  const t=document.getElementById('title'); if(t) t.classList.add('hide'); return 1; })()`);
await sleep(300);

const clipJson = await ev(`(()=>{
  const c = document.getElementById('game');
  const r = c.getBoundingClientRect();
  const sx = r.width/1920, sy = r.height/1080;
  const X0=300, Y0=380, X1=1520, Y1=960;
  return JSON.stringify({x:r.left+X0*sx, y:r.top+Y0*sy, width:(X1-X0)*sx, height:(Y1-Y0)*sy, scale:1});
})()`);
const clip = JSON.parse(clipJson);

// 在画布坐标系上摆：远/中/近三种进深，脚下 y 分别是 640 / 780 / 855
await ev(`(()=>{
  const c = document.getElementById('game');
  const x = c.getContext('2d');
  const F = FG.FIELD, I = FG.INK;
  const spots = [[470, 640, 0], [900, 790, 1], [1330, 860, 0]];
  for (const s of spots) {
    const u = 150 * F.scaleAtY(s[1]);
    x.save(); x.strokeStyle = 'rgba(170,40,30,.35)'; x.lineWidth = 1.5;
    x.beginPath(); x.ellipse(s[0], s[1]+3, u*0.21, u*0.045, 0, 0, 6.284);
    x.stroke(); x.restore();
    I.farmer(x, s[0], s[1], u, s[2] ? I.INK_SOFT : I.INK, s[2]);
  }
  return 'drawn';
})()`);
await sleep(200);
const s = await send('Page.captureScreenshot', { format: 'png', clip });
writeFileSync(path.join(OUT, 'figure.png'), Buffer.from(s.data, 'base64'));
console.log('已出 dev/_fig/figure.png  clip=', JSON.stringify(clip));
ws.close(); chrome.kill();
