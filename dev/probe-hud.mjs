// 临时探针：量 HUD 纸片和体力条数字小纸片的实际位置，别靠百分比猜。
import { spawn } from 'child_process';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9341;
const profile = path.join(tmpdir(), 'guxian-probe-' + process.pid);
const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const pg = j.find(t => t.type === 'page');
      if (pg) return pg;
    } catch (e) { }
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}
let id = 0, ws; const pend = new Map();
function send(m, p) {
  return new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p || {} })); });
}
const t = await target();
ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable');
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
await sleep(2600);
await ev(`localStorage.clear()`); await ev(`location.reload()`); await sleep(2600);
await ev(`FG.startFrom('new')`); await sleep(1200);
// 把年份也开到第 2 年（HUD 会多出「第 N 年」几个字，是最宽的时候）
await ev(`FG.state.day = 145; FG.nextDay();`);
// 有酒的时候左上纸片会多出一行 —— 那正是最容易压到体力数字的时候。
// 只量「没酒」那一档等于没量：出问题的是有酒的那一档。
await ev(`FG.state.jiu = 3; FG.updateHUD && FG.updateHUD();`);
await sleep(500);

const measure = `(function(){
  function box(sel){
    var e=document.querySelector(sel); if(!e) return null;
    var r=e.getBoundingClientRect();
    return {sel:sel, top:Math.round(r.top), bottom:Math.round(r.bottom), left:Math.round(r.left), right:Math.round(r.right), h:Math.round(r.height)};
  }
  var ui=document.getElementById('ui').getBoundingClientRect();
  return {vh:innerHeight, vw:innerWidth,
    stage:[Math.round(ui.width),Math.round(ui.height)],
    tl:box('#hud .tl'), tr:box('#hud .tr'),
    stam:box('#stam'), stamNum:box('#stam span'),
    row4:box('#hud .row4'), row5:box('#hud .row5'), row6:box('#hud .row6'),
    tray:box('#tray'), keys:box('#keys')};
})()`;

const m = JSON.parse(await ev('JSON.stringify(' + measure + ')'));
console.log(JSON.stringify(m, null, 1));
const gap = m.stamNum.top - m.tl.bottom;
console.log('\n体力数字顶 %d，HUD 纸片底 %d —— %s %d px',
  m.stamNum.top, m.tl.bottom, gap >= 0 ? '还差' : '已经压上', Math.abs(gap));
console.log('HUD 占画面高度 %s%%', (m.tl.h / m.stage[1] * 100).toFixed(1));

// 酒的那行是条件显示的：量完有酒的，再量一遍没酒的，
// 确认它藏起来时纸片会缩回去（不然就是白占一行的死高度）
await ev(`FG.state.jiu = 0; FG.updateHUD && FG.updateHUD();`);
await sleep(400);
const m0 = JSON.parse(await ev('JSON.stringify(' + measure + ')'));
console.log('\n没酒时纸片底 %d（比有酒时高 %d px）', m0.tl.bottom, m.tl.bottom - m0.tl.bottom);
console.log('没酒时离体力数字 %d px', m0.stamNum.top - m0.tl.bottom);

ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
