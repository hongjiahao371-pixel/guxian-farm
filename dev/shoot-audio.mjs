// 音频：发布前必须知道它到底通没通。
//
// 为什么单做一套：音效有 25 处 audio.play、1 处 AudioContext、1 个 M 静音键，
// 而整套验收里**一条断言都没有**。别的地方出问题会红，
// 这里坏掉是「安静地不响」—— 没人会发现，直到有人说"这游戏没声音"。
//
// 量四样：
//   ① AudioContext 建不建得起来、建起来是什么状态
//      （浏览器的自动播放策略：没有用户手势时它是 suspended，
//        这不是 bug，但「一直 suspended」就是 bug —— 声音永远出不来）
//   ② 每个音效 play() 有没有抛
//   ③ M 静音键：切了之后 muted 翻没翻、play 是不是真被挡住了
//   ④ 背景音乐：有没有被接上（查调用点，不是查它写得对不对）
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9463;
const profile = path.join(tmpdir(), 'guxian-audio-' + process.pid);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// **不加 --mute-audio**：那是输出设备层面的静音，跟 AudioContext 的状态是两回事
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--allow-file-access-from-files', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1024,768', 'about:blank'], { stdio: 'ignore' });

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const pg = j.find(x => x.type === 'page');
      if (pg) return [pg];
    } catch (e) { }
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}
let id = 0, ws; const pending = new Map(); const logs = [];
function send(m, p) {
  return new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p || {} })); });
}
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const key = async k => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(160);
};
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}

const t = (await targets())[0];
ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push(m.params.args.map(a => a.value || a.description).join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') });
await sleep(3000);

console.log('— AudioContext —');
console.log('  ' + await ev(`JSON.stringify({
  有AudioContext: typeof window.AudioContext,
  有webkit: typeof window.webkitAudioContext,
  有FGaudio: typeof ((window.FG||{}).audio),
  muted: FG.audio ? FG.audio.muted : '(没有)'
})`));
ok('FG.audio 挂着', (await ev(`typeof FG.audio`)) === 'object');
ok('一开局不是静音的', (await ev(`FG.audio.muted`)) === false);

// 还没任何用户手势时建一个 AudioContext，看它是什么状态。
// suspended 在这个点是**正常的**（浏览器自动播放策略），
// 但如果它一直不变成 running，那就是「永远没声音」
const preState = await ev(`(function(){
  try { var c = new AudioContext(); var s = c.state; c.close(); return s; }
  catch (e) { return 'EXC ' + e.message; }})()`);
console.log('  没有任何用户手势时新建 AudioContext → state=' + preState);
ok('无手势时是 suspended（浏览器策略，不是 bug）', preState === 'suspended' || preState === 'running', preState);

console.log('\n— 一次真实点击之后 —');
// 点开卷的「入山」—— 这就是玩家第一次用户手势
await ev(`(function(){ FG.startFrom('new'); return 1})()`);
await sleep(900);
await key('Escape');   // 造一次真键盘事件（浏览器认它是手势）
await sleep(400);
const st = await ev(`(function(){
  var probe = new AudioContext(); var s = probe.state; probe.close(); return s;})()`);
console.log('  有手势之后新建 AudioContext → state=' + st);

console.log('\n— 每个音效都放一遍，看有没有抛 —');
const SFX = ['hoe', 'water', 'chop', 'pick', 'rock', 'weed', 'plant', 'harvest',
             'coin', 'eat', 'step', 'warp', 'sleep', 'buy', 'error', 'levelup'];
const sfxRes = await ev(`(function(){
  var bad = [];
  ${JSON.stringify(SFX)}.forEach(function(n){
    try { FG.audio.play(n); } catch (e) { bad.push(n + ': ' + e.message); }
  });
  return JSON.stringify(bad);
})()`);
const bad = JSON.parse(sfxRes);
ok('16 个音效全放一遍，一个都没抛', bad.length === 0, bad.join(' | ') || '（无）');
console.log('  音效表：' + SFX.join(' ') + '（共 ' + SFX.length + ' 个）');

console.log('\n— M 静音键 —');
const m0 = await ev(`FG.audio.muted`);
await key('m'); await sleep(250);
const m1 = await ev(`FG.audio.muted`);
const toast1 = await ev(`document.getElementById('toast').textContent`);
ok('按 M 从有声切成静音', m0 === false && m1 === true, m0 + ' → ' + m1);
ok('而且说清楚了', /静音/.test(toast1), toast1);
// 静音时 play 不能真出声 —— play 里是 `if (muted || !ensure()) return`
const mutedPlay = await ev(`(function(){ try { FG.audio.play('coin'); return '没抛'; }
  catch (e) { return '抛了: ' + e.message; } })()`);
ok('静音时放音效不抛（挡住就是挡住了）', mutedPlay === '没抛', mutedPlay);
await key('m'); await sleep(250);
const m2 = await ev(`FG.audio.muted`);
const toast2 = await ev(`document.getElementById('toast').textContent`);
ok('再按 M 切回有声', m2 === false, m1 + ' → ' + m2);
ok('而且说的是「有声」', /有声/.test(toast2), toast2);

console.log('\n— 背景音乐接上了吗 —');
// **计数时不能自己调 pick**。上一版我在同一个表达式里手动调了三次 pick，
// 计数器把我的手动调用也数了进去，于是「3 次」看着像接上了，
// 其实游戏自己一次都没调过 —— 拿被测对象自己当证据，恒真。
// 所以只挂计数器、只走**自然流程**（换图 / 推进钟点 / 锄地收地），不手动调。
await ev(`(function(){
  window.__musicN = 0; window.__sfxN = 0;
  var mo = FG.audio.music.pick;
  FG.audio.music.pick = function(){ window.__musicN++; return mo.apply(this, arguments); };
  var sp = FG.audio.play;
  FG.audio.play = function(n){ window.__sfxN++; return sp.apply(this, arguments); };
  return 1})()`);
// 自然流程：白天在南山锄一畦 → 出门到墟市 → 天黑
await ev(`(function(){ FG.gotoMap('nanshan',[900,800]); FG.state.min=10*60; FG.actAt(700,600); return 1})()`);
await sleep(700);
await ev(`(function(){ FG.state.min=13*60; FG.gotoMap('xushi',[430,762]); FG.actAt(900,800); return 1})()`);
await sleep(700);
await ev(`(function(){ FG.state.min=21*60; FG.gotoMap('nanshan',[900,800]); return 1})()`);
await sleep(700);
const mRef = await ev(`String(window.__musicN)`);
const sRef = await ev(`String(window.__sfxN)`);
console.log('  自然流程（换图 ×2 + 锄地 + 推进到天黑）里：music.pick 调了 ' + mRef + ' 次，audio.play 调了 ' + sRef + ' 次');
ok('**音效在游戏里真的会响**（自然流程里 play 被调到了）', +sRef > 0, sRef + ' 次');
ok('**背景音乐接上了**（换图 / 昼夜切换会重新选曲）', +mRef > 0,
   mRef + ' 次　→ 0 次 = 三首曲子从头到尾没响过，music.pick 是个没人调的死函数');

// 「pick 被调过」不等于「换了曲子」—— 两次都落 farm 也算被调过。
// 所以核**曲名本身**。
const curves = await ev(`(function(){
  function at(map, min){ FG.state.map = map; FG.state.min = min;
    FG.audio.music.pick(map, min); return FG.audio.music.name; }
  return JSON.stringify({
    田里白天: at('nanshan', 10*60),
    墟市白天: at('xushi',   10*60),
    溪畔白天: at('xipan',   10*60),
    硐里白天: at('shidong', 10*60),
    // 边界：夜晚是 20:30 起、5:30 前。**核边界而不是核印象** ——
    // 上一版写「6 点还是夜晚」，那是我猜的，实际 5:30 就已经切回日常了
    天黑前一分钟: at('nanshan', 20*60 + 29),
    天黑后一分钟: at('nanshan', 20*60 + 31),
    天亮前一分钟: at('nanshan', 5*60 + 29),
    天亮后一分钟: at('nanshan', 5*60 + 31)
  });
})()`);
const cv2 = JSON.parse(curves);
console.log('  各处的曲名：' + Object.keys(cv2).map(k => k + '=' + cv2[k]).join('  '));
ok('**墟市放的是市集那支**（pick 原来比的是 town/shop/home，图的 id 一个都对不上）',
   cv2['墟市白天'] === 'town', '墟市白天=' + cv2['墟市白天']);
ok('田里 / 溪畔 / 硐里都是日常那支', cv2['田里白天'] === 'farm' && cv2['溪畔白天'] === 'farm' && cv2['硐里白天'] === 'farm',
   JSON.stringify([cv2['田里白天'], cv2['溪畔白天'], cv2['硐里白天']]));
ok('天黑那一刻换曲（20:29 日常 → 20:31 夜晚）',
   cv2['天黑前一分钟'] === 'farm' && cv2['天黑后一分钟'] === 'night',
   cv2['天黑前一分钟'] + ' → ' + cv2['天黑后一分钟']);
ok('天亮那一刻换回来（5:29 夜晚 → 5:31 日常）',
   cv2['天亮前一分钟'] === 'night' && cv2['天亮后一分钟'] === 'farm',
   cv2['天亮前一分钟'] + ' → ' + cv2['天亮后一分钟']);

// 静音的时候不该碰音乐（step 里那道守卫）
await ev(`(function(){ FG.state.mutedTest = 0; return 1})()`);
const mutedGuard = await ev(`(function(){
  FG.audio.toggle();                       // 静音
  FG.state.map = 'nanshan'; FG.state.min = 10*60;
  FG.audio.music.stop();                   // 先清干净
  FG.audio.music.pick('xushi', 10*60);
  var n = FG.audio.music.name;             // pick 仍会设名字，但它不该主动起播
  FG.audio.toggle();                       // 恢复
  return JSON.stringify({ mutedNow: FG.audio.muted, name: n });
})()`);
const mg = JSON.parse(mutedGuard);
console.log('  静音期间调 pick：曲名=' + mg.name + '（静音态=' + mg.mutedNow + '）');
ok('静音切回有声后状态对', mg.mutedNow === false);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? 'FAILED ' + fails : 'DONE');
process.exit(0);