// 1:1 取景探针：不缩放地抠出洞口和刻石的真实像素。
// 验收缩略图会把「像个小柱子」和「像个柱子」看成同一个东西，
// 判断颜色/大小必须拿成品实际像素。
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9349;
const profile = path.join(tmpdir(), 'guxian-hprobe-' + process.pid);

// 窗口开成和画布一样大，缩放比才是 1
const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1920,1080', 'about:blank'
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
async function clip(name, cx, cy, w, h) {
  // 画布没铺满窗口时，页面坐标要用画布自己的 rect 换算，不能拿画布坐标直接当页面坐标。
  // clip.scale 还要除回 k，输出才是真正的 1:1 画布像素 ——
  // 不然拿到的是缩过 0.9 的图，判断大小就全不准了
  const r = JSON.parse(await ev(`(function(){var b=document.getElementById('game').getBoundingClientRect();
    return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height});})()`));
  const k = r.w / 1920;
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: r.x + (cx - w / 2) * k, y: r.y + (cy - h / 2) * k, width: w * k, height: h * k, scale: 1 / k }
  });
  writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
  console.log('  写了', name, `${w}×${h}`, `scale=${(1 / k).toFixed(3)}`);
}
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(140);
}
async function at(x, y) {
  await ev(`FG.state.player.x=${x}; FG.state.player.y=${y}; FG.state.walkTo=null;`);
  await sleep(220);
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
await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

console.log('缩放比 =', await ev(`(function(){var b=document.getElementById('game').getBoundingClientRect();
  return (b.width/1920).toFixed(4);})()`));

console.log('— 南山洞口 —');
const cave = JSON.parse(await ev(`JSON.stringify(FG.MAPS.nanshan.exits.filter(function(x){return x.cave;})[0].at)`));
await at(cave[0] + 60, cave[1] + 60);
await clip('P-南山洞口.png', cave[0], cave[1] - 40, 420, 300);

console.log('— 后山：出口洞 —');
await ev(`FG.gotoMap('houshan', [300, 700])`);
await sleep(700);
const exH = JSON.parse(await ev(`JSON.stringify(FG.MAPS.houshan.exits[0].at)`));
await at(exH[0] + 130, exH[1] + 40);
await clip('P-后山洞口.png', exH[0] + 10, exH[1] - 30, 420, 300);

console.log('— 后山：未读刻石 vs 读过的刻石 —');
const st = JSON.parse(await ev(`JSON.stringify(FG.STELES)`));
const kou = st[0], jiu = st[5];
// 人要让开：正对着站会把石头整个盖住，那样截出来的图什么也判断不了
await at(kou.at[0] + 190, kou.at[1] + 30);
await clip('P-刻石未读.png', kou.at[0], kou.at[1] - 44, 300, 230);
await at(jiu.at[0] - 190, jiu.at[1] + 30);
await key('e');   // 读掉它
await sleep(300);
await at(jiu.at[0] - 190, jiu.at[1] + 30);
await clip('P-刻石读过.png', jiu.at[0], jiu.at[1] - 44, 300, 230);
// 顺带把两块并排截一张：单独看两块都"像石头"，并排才看得出差别够不够大
await at(kou.at[0] + 190, kou.at[1] + 30);
await clip('P-刻石并排.png', (kou.at[0] + jiu.at[0]) / 2, 740, 900, 380);

ws.close(); chrome.kill();
try { (await import('fs')).rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log('DONE');
