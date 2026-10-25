// 一次性探针：问清楚 setInv 摆进去的加工品到底去哪了。
// 症状是「摆进去、当天读不到、存读档后变成 null」——三件事一起错，
// 猜不出来，直接把中间那几个值打出来。
import { spawn } from 'child_process';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9361;
const profile = path.join(tmpdir(), 'guxian-probe-stove-' + process.pid);
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
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

const show = (label, v) => console.log(label.padEnd(26), typeof v === 'string' ? v : JSON.stringify(v));

show('FG.BAG_IDX 有 bing 吗', await ev(`!!FG.BAG_IDX['bing']`));
show('FG.BAG_IDX.bing', await ev(`JSON.stringify(FG.BAG_IDX['bing']||null)`));
show('FG.BAG 里 made 的 key', await ev(`FG.BAG.filter(function(b){return b.kind==='made'}).map(function(b){return b.k}).join(',')`));

await ev(`(function(){
  FG.state.bag={dou:0,su:0,shu:0,ji:0,ju:0};
  FG.state.pouch={};
  FG.state.jiu=0;
  FG.state.made={};
  var o={bing:2, cu:1, jiu:3};
  for (var k in o) {
    var it=FG.BAG_IDX[k];
    if(!it) continue;
    if (it.k === 'jiu') FG.state.jiu += o[k];
    else if (it.kind==='crop') FG.state.bag[it.src]=(FG.state.bag[it.src]||0)+o[k];
    else if (it.kind==='made') FG.state.made[it.src]=(FG.state.made[it.src]||0)+o[k];
    else FG.state.pouch[it.src]=(FG.state.pouch[it.src]||0)+o[k];
  }
  return 1;
})()`);
show('摆完 FG.state.made', await ev(`JSON.stringify(FG.state.made)`));
show('摆完 FG.state.jiu', await ev(`FG.state.jiu`));
show('bagList 的 made', await ev(`FG.bagList().filter(function(b){return b.it.kind==='made'}).map(function(b){return b.k+':'+b.n}).join(',')`));

console.log('\n— 存一次再读 —');
await ev(`FG.saveGame()`);
await sleep(400);
show('localStorage 里的 made', await ev(`(function(){try{var o=JSON.parse(localStorage.getItem('guxian-farm-v1')||localStorage.getItem(Object.keys(localStorage)[0]));return JSON.stringify(o&&o.made);}catch(e){return '读不出来 '+e}})()`));
show('localStorage 的键', await ev(`Object.keys(localStorage).join(',')`));

ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log('\nDONE');
