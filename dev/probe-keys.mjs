// 试键位提示的几种写法，报出各自的高度。
// 「加了词就得同时减词」这条规矩已经踩过两次：加节气那次折行、
// 加 Tab 这次又折行。与其猜哪几个字能省，不如把候选全都量一遍。
import { spawn } from 'child_process';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9357;
const profile = path.join(tmpdir(), 'guxian-keys-' + process.pid);

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
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
await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

const CAND = [
  'WASD 走　1-8 换　E 互动　Tab 行囊　O 出货　V 诗册　M 静音',
  'WASD　1-8 换　E 互动　Tab 行囊　O 出货　V 诗册　M 静音',
  'WASD 走　1-8 换　E 互动　Tab 行囊　O 出货　V 诗册',
  'WASD 走　1-8 器物　E 互动　Tab 行囊　O 出货　V 诗册',
  'WASD　1-8 换　E 互动　Tab 行囊　O 出货　V 诗册',
  'WASD 走　1-8 换　E 互动　Tab 囊　O 货　V 诗　M 静音',
  'WASD 走动　1-8 器物　E 互动　Tab 行囊　V 诗册　M 静音'
];
// 页面里实际写的那一行，从 DOM 读，不抄
const REAL = await ev(`document.getElementById('keys').textContent`);
console.log('页面当前写的：', REAL);
const room = JSON.parse(await ev(`(function(){
  var k=document.getElementById('keys').getBoundingClientRect();
  var tr=document.getElementById('tray').getBoundingClientRect();
  var cs=getComputedStyle(document.getElementById('keys'));
  var lh=parseFloat(cs.lineHeight)||22;
  return JSON.stringify({ right:Math.round(k.right), trayL:Math.round(tr.left),
    gap:Math.round(tr.left-k.right), h:Math.round(k.height), lh:lh, maxW:cs.maxWidth });})()`));
console.log('可用宽度：', JSON.stringify(room));
let realLines = 0, realH = 0;
for (const s of CAND.concat([REAL])) {
  const r = await ev(`(function(){
    var e=document.getElementById('keys');
    e.textContent = ${JSON.stringify(s)};
    var b=e.getBoundingClientRect();
    var lh = parseFloat(getComputedStyle(e).lineHeight) || 22;
    return JSON.stringify({h:Math.round(b.height), w:Math.round(b.width), lines:Math.round(b.height/lh)});
  })()`);
  const o = JSON.parse(r);
  if (s === REAL) { realLines = o.lines; realH = o.h; }
  console.log((o.lines <= 1 ? '  一行 ' : '  ' + o.lines + '行 ') +
    'h=' + String(o.h).padStart(3) + ' w=' + String(o.w).padStart(3) + (s === REAL ? ' ← 现行' : '') + '   ' + s);
}
console.log('\n判据：');
console.log('  ' + (realLines <= 1 ? 'OK  ' : 'BAD ') + '「按了词得同时减词」—— 现行这行折成 ' + realLines + ' 行（h=' + realH + '，一行上限 ≈ ' + Math.round(room.lh * 1.35) + '）');
console.log('  ' + (room.gap >= 8 ? 'OK  ' : 'BAD ') + '#keys 右沿 ' + room.right + '，#tray 左沿 ' + room.trayL + '，中间 ' + room.gap + 'px（至少留 8px 才不显得顶在一起）');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log('\nDONE（每行的高度上限 ≈ lineHeight 22px × 1.35）');
