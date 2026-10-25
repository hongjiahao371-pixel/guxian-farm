// 行囊图标的全览探针：把 24 样东西一次摆满，1:1 截下来。
// 24 个图标是分头画的，各自单看都「有东西」，并排才看得出区分度够不够。
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9355;
const profile = path.join(tmpdir(), 'guxian-icons-' + process.pid);

const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1600,900', 'about:blank'
], { stdio: 'ignore' });

async function cdpTargets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const j = await r.json();
      const pg = j.find(t => t.type === 'page');
      if (pg) return [pg];
    } catch (e) { }
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}
let id = 0, ws;
const pending = new Map();
function send(method, params) {
  return new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
}
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

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
await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

// 把每一样都塞上，数量各不相同，这样也能看出「×N」的位置对不对
await ev(`
  (function(){
    var S=FG.state, i, k, n=1;
    S.tools={chu:true,piao:true};
    for (k in FG.CROPS) S.bag[k]=0;
    for (k in FG.FISH) S.pouch[k]=0;
    for (k in FG.GOODS) S.pouch[k]=0;
    S.bag={dou:12,su:9,shu:1,ji:7,ju:3};
    S.pouch={xia:4,ji:6,luo:2,bian:5,li:1,gui:2,mei:8,luos:6,ling:3,ou:2,jun:1};
    S.seeds={dou:24,su:18,shu:5,ji:3,ju:2};
    S.jiu=2;
    S.gold=4321;
    FG.updateHUD();
  })()
`);
await sleep(300);
await ev(`FG.openBag()`);
await sleep(600);
const r = JSON.parse(await ev(`(function(){var b=document.getElementById('bg-cv').getBoundingClientRect();
  return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height});})()`));
const s = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 }
});
writeFileSync(path.join(OUT, 'P-行囊全览.png'), Buffer.from(s.data, 'base64'));
console.log('  写了 P-行囊全览.png', r.w + '×' + r.h);
console.log('  装着的 =', await ev(`FG.bagList().length + ' 样'`));
ws.close(); chrome.kill();
try { (await import('fs')).rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log('DONE');
