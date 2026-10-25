// 蜂窠房 1× 截图：核它落在南山坡上画里什么地方。
// 判据是「玩家站在坡上能不能一眼看见有个东西在那儿」——
// 画过的东西被草坡/工具栏埋掉过一次，狗窝那次就是这么丢的。
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9391;
const profile = path.join(tmpdir(), 'guxian-hive-' + process.pid);
const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--allow-file-access-from-files', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
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
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
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

const A = JSON.parse(await ev(`JSON.stringify(FG.MACHINE.hive.at)`));
const U = await ev(`FG.MACHINE.hive.lv[0].unit`);

// 一级摆好
await ev(`(function(){
  FG.state.mach={lv:{hive:1},job:{}}; FG.machFix();
  FG.gotoMap('nanshan'); FG.state.player.x=${A[0] - 40}; FG.state.player.y=${A[1] + 150};
  FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(500);
await shot('62-南山-蜂窠-一级.png');

// 二级 + 窠里搁着东西
await ev(`(function(){
  FG.state.mach={lv:{hive:2},job:{hive:{out:'mi',n:2,at:FG.state.day+2,in:9}}};
  FG.gotoMap('nanshan'); FG.state.player.x=${A[0] - 40}; FG.state.player.y=${A[1] + 150};
  FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(500);
await shot('63-南山-蜂窠-二级.png');

// 近一点：站在玩家收料会站的那个位置
await ev(`(function(){
  FG.gotoMap('nanshan'); FG.state.player.x=${A[0] + 10}; FG.state.player.y=${A[1] + 170};
  FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(500);
await shot('64-南山-蜂窠-近.png');

console.log('蜂窠 at=' + JSON.stringify(A) + ' 剪影宽=' + U + '　三张截了');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(0);
