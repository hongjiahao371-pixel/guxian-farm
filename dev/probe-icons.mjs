// 图标放大页：**只用来定位问题，不用来验收**。
// 行囊那一格只有 26px，放大看会骗人（像素农场就是这么翻的车）；
// 但反过来也成立：1× 看不清的地方，得先在这里找出来，再回 1× 复核。
// 判「一个图标好不好」永远以 1× 的行囊截图为准，这里只是放大镜。
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9363;
const profile = path.join(tmpdir(), 'guxian-ic-' + process.pid);
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
      const pg = (await r.json()).find(t => t.type === 'page');
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
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const t = (await cdpTargets())[0];
ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
await sleep(2600);

// 两栏：左 1×（行囊里真实看到的大小），右 4×（放大镜）
await ev(`(function(){
  var keys=[], i;
  for (i=0;i<FG.BAG.length;i++) if (FG.BAG[i].kind==='made') keys.push(FG.BAG[i]);
  var html='<div style="position:fixed;inset:0;background:#e8e0cc;z-index:99999;padding:18px;font:14px/1.6 serif">';
  html+='<div style="display:flex;align-items:center;margin-left:130px">';
  for (i=0;i<keys.length;i++){
    html+='<div style="width:26px;height:26px;margin-right:96px;position:relative">';
    html+='<canvas id="s'+i+'" width="26" height="26" style="width:26px;height:26px"></canvas>';
    html+='<span style="position:absolute;left:0;top:30px;font-size:11px;color:#6b5c48;white-space:nowrap">'+keys[i].name+'</span></div>';
  }
  html+='</div><div style="height:52px"></div><div style="display:flex;align-items:center;margin-left:130px">';
  for (i=0;i<keys.length;i++){
    html+='<canvas id="b'+i+'" width="104" height="104" style="width:104px;height:104px;margin-right:18px;background:#e8e0cc"></canvas>';
  }
  html+='</div></div>';
  var d=document.createElement('div'); d.innerHTML=html; document.body.appendChild(d);
  for (i=0;i<keys.length;i++){
    var a=document.getElementById('s'+i).getContext('2d');
    FG.INK.icon(a, keys[i].k, 13, 13, 26);
    var b=document.getElementById('b'+i).getContext('2d');
    b.scale(4,4);
    FG.INK.icon(b, keys[i].k, 13, 13, 26);
  }
  return 1;
})()`);
await sleep(400);
const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1300, height: 230, scale: 1 } });
writeFileSync(path.join(OUT, '54-加工品图标.png'), Buffer.from(s.data, 'base64'));
console.log('写出 shots/54-加工品图标.png');
ws.close(); chrome.kill();
try { (await import('fs')).rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log('DONE');
