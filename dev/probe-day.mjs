// 一天的钱到底什么时候到账。
//
// play-year.mjs 那一行 `进项` 算的是
//     earn = 早上快照的 gold − 昨天早上快照的 gold
// 而钱是**天黑结算**才进箱结算的，早上的快照取在结算之前。
// 于是那一列记的是**昨晚**的进项，比当天做的事晚一天。
// 表现为日志里「出货6　进项 0」—— 出货在早上，钱在夜里，
// 而这一行读的是昨天早上的钱。
//
// 这个探针只干一件事：把「早上 gold → 放进箱 → 天黑 → 结算面板 → 之后 gold」
// 每一格的数都打出来，看钱在哪一格动的。
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9421;
const profile = mkdtempSync(path.join(tmpdir(), 'guxian-day-'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--mute-audio',
  '--allow-file-access-from-files', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
async function cdpTargets() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const pg = j.find(t => t.type === 'page');
      if (pg) return [pg];
    } catch (e) { }
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}
let id = 0, ws;
const pending = new Map();
const noise = [];
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
const t = (await cdpTargets())[0];
ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    noise.push(m.params.args.map(a => a.value || a.description).join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    noise.push('EXC ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

const snap = () => ev(`JSON.stringify({
  day: FG.state.day, gold: FG.state.gold, earned: FG.state.earned,
  bin: FG.state.bin, bag: FG.state.bag, pouch: FG.state.pouch
})`).then(JSON.parse);

console.log('— 钱在哪一格动 —');
for (const day of [1, 2, 3]) {
  // 早上：种点豆、收进箱，看结算之前箱里是什么、钱是多少
  const before = await snap();
  await ev(`(function(){
    FG.state.day=${day};
    FG.state.min=FG.DAY.START; FG.state.ended=false; FG.state.started=true;
    FG.weatherFix();
    FG.invGive('crop_dou', 4);
    var it; for (it in FG.state.bag){ if (FG.state.bag[it]>0 && FG.binSellable('crop_'+it)) FG.binMove('crop_'+it, true); }
    FG.updateHUD(); return 1})()`);
  const morning = await snap();
  // 天黑结算
  await ev(`(function(){ FG.state.min=FG.DAY.END-1; return 1})()`);
  await sleep(60);
  await ev(`(function(){ var b=document.getElementById('de-next');
    if (b && !document.getElementById('de').classList.contains('hide')) b.click(); return 1})()`);
  await sleep(80);
  const panel = await ev(`(function(){
    var e=document.getElementById('de');
    var open = e && !e.classList.contains('hide');
    var txt = open ? (e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80) : '';
    return JSON.stringify({open:open, txt:txt, goldNow:FG.state.gold});})()`).then(JSON.parse);
  await ev(`(function(){ var e=document.getElementById('de');
    if (e && !e.classList.contains('hide')) document.getElementById('de-next').click(); return 1})()`);
  await sleep(120);
  const after = await snap();
  console.log('D' + day);
  console.log('   昨晚结算前   gold=' + before.gold + '  bin=' + JSON.stringify(before.bin));
  console.log('   早上放完箱   gold=' + morning.gold + '  bin=' + JSON.stringify(morning.bin)
    + '  ← 钱一分没动');
  console.log('   点天黑结算   面板=' + panel.open + '  gold=' + panel.goldNow);
  if (panel.txt) console.log('     面板写：' + panel.txt);
  console.log('   结算完       gold=' + after.gold + '  bin=' + JSON.stringify(after.bin)
    + '  earned=' + after.earned);
  console.log('   → 钱在「点天黑结算」那一格动，差 = ' + (after.gold - morning.gold));
}
console.log('\nLOGS', noise.length ? noise.join('\n  ') : '(无报错)');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(0);
