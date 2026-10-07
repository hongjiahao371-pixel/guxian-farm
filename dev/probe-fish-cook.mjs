// 钓鱼和做菜这两支在通玩里一次都没触发，单独拿出来看是哪一步断了。
// 分三段：看 FG.cook 在不在、cookable 有没有货、抛竿那一按键有没有生效。
import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9422;
const profile = mkdtempSync(path.join(tmpdir(), 'guxian-ck-'));
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
let id = 0, ws; const pending = new Map(); const noise = [];
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
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(140);
}
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

console.log('— 做菜那一支 —');
console.log('  FG.cook 在不在 =', await ev(`typeof FG.cook`));
console.log('  FG.cookCap()  =', await ev(`JSON.stringify(FG.cookCap())`));
await ev(`(function(){ FG.invGive('crop_dou', 6); FG.updateHUD(); return 1})()`);
await sleep(200);
console.log('  给了 6 豆，cookable =', await ev(`JSON.stringify(FG.cookable().map(function(r){return r.id}))`));
const cap1 = JSON.parse(await ev(`JSON.stringify(FG.cookCap())`));
console.log('  cookCap =', JSON.stringify(cap1));
const cooked = await ev(`(function(){
  var c=FG.cookable(); if(!c.length) return 'nothing';
  return FG.cook(c[0]) ? 'cooked '+c[0].id : 'cook refused';})()`);
console.log('  cook 结果 =', cooked);
console.log('  做出来了吗 =', await ev(`JSON.stringify(FG.state.made)`));
console.log('  酿的手艺 =', await ev(`FG.state.skill.niang.lv`));
console.log('  cookCap 之后 =', await ev(`JSON.stringify(FG.cookCap())`));

console.log('\n— 抛竿那一支 —');
const spot = JSON.parse(await ev(`JSON.stringify(FG.SPOTS.xipan.fish[0])`));
console.log('  钓点 =', spot.at, '　此刻出得着鱼吗 =', await ev(`JSON.stringify(FG.fishHere())`));
await ev(`(function(){ FG.gotoMap('xipan');
  FG.state.player.x=${spot.at[0]}; FG.state.player.y=${spot.at[1]}+130;
  FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(400);
const h = await ev(`document.getElementById('hint').textContent.replace(/\\s+/g,' ').trim()`);
console.log('  站过去提示行 =', JSON.stringify(h));
console.log('  提示里有「垂钓」吗 =', /垂钓/.test(h));
await key('e');
await sleep(250);
console.log('  按 E 之后 fishing =', await ev(`JSON.stringify(FG.state.fishing)`));
if (await ev(`!!FG.state.fishing`)) {
  let w = 0, ph = 'wait';
  while (w < 7000) { await sleep(100); w += 100; ph = await ev(`FG.state.fishing ? FG.state.fishing.phase : 'gone'`); if (ph !== 'wait') break; }
  console.log('  等了', w, 'ms 相位 =', ph);
  if (ph === 'bite') { await key('e'); await sleep(250); }
  console.log('  篓 =', await ev(`JSON.stringify(FG.state.pouch)`));
  console.log('  渔的手艺 =', await ev(`FG.state.skill.yu.lv`));
}
console.log('\nLOGS', noise.length ? noise.join('\n  ') : '(无报错)');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(0);
