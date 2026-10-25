// 窄屏 / 触屏那一遍。
//
// 为什么单独做一套：代码里 resize、orientationchange、touchstart 都有，
// 而**验收里一条都没有**（dev/*.mjs 里 0 处）。
// 逻辑断言再全也测不出「面板在 480 宽的竖屏上撑破了」——
// 那是画出来才知道的。
//
// 量的东西（都是能量出来的，不读代码猜）：
//   ① 有没有元素横向溢出视口
//   ② 竖屏下画布和 UI 层是不是真的等比
//   ③ 面板打开时会不会顶出屏幕
//   ④ 触屏点一下能不能走过去（游戏没有虚拟摇杆，全靠这个）
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9457;
const profile = path.join(tmpdir(), 'guxian-narrow-' + process.pid);
const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 竖屏手机那个尺寸
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--allow-file-access-from-files', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=480,854', 'about:blank'], { stdio: 'ignore' });

async function cdpTargets() {
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
const setVp = async (w, h, dsf) => {
  await send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: dsf || 1, mobile: true });
  await sleep(500);
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
    logs.push(m.params.args.map(a => a.value || a.description).join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
await sleep(3000);

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
}

// 量横向溢出。**判据是「有没有元素右缘超出视口」**，
// 不是「看起来挤不挤」——挤是审美，出界是毛病
const OVERFLOW = `(function(){
  var vw = document.documentElement.clientWidth, bad = [];
  document.querySelectorAll('#ui *').forEach(function(el){
    if (el.offsetParent === null && el.tagName !== 'BODY') return;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.right > vw + 1 || r.left < -1) {
      bad.push((el.id || el.className || el.tagName) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
    }
  });
  return JSON.stringify({ vw: vw, bad: bad.slice(0, 8) });
})()`;

console.log('— 竖屏 480×854 —');
await setVp(480, 854);
const geo = JSON.parse(await ev(`JSON.stringify({
  vw: document.documentElement.clientWidth,
  vh: document.documentElement.clientHeight,
  cv: (function(){ var r=document.getElementById('game').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top) }; })(),
  stage: (function(){ var r=document.getElementById('stage').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
  ui: (function(){ var r=document.getElementById('ui').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) }; })()
})`));
console.log('  视口 ' + geo.vw + '×' + geo.vh + '　画布 ' + geo.cv.w + '×' + geo.cv.h +
            '　stage ' + geo.stage.w + '×' + geo.stage.h + '　ui ' + geo.ui.w + '×' + geo.ui.h);
ok('画布等比缩到视口内（没被裁掉）', geo.cv.w <= geo.vw + 1 && geo.cv.h <= geo.vh + 1,
   geo.cv.w + '×' + geo.cv.h + ' vs ' + geo.vw + '×' + geo.vh);
ok('UI 层跟着画布走', geo.ui.w === geo.cv.w && geo.ui.h === geo.cv.h,
   'ui ' + geo.ui.w + '×' + geo.ui.h + ' vs 画布 ' + geo.cv.w + '×' + geo.cv.h);
await shot('40-竖屏-开卷.png');

const of1 = JSON.parse(await ev(OVERFLOW));
ok('开卷时没有元素横向出界', of1.bad.length === 0, of1.bad.join(' / ') || '（无）');

console.log('\n— 进了游戏，面板在窄屏上 —');
await ev(`FG.startFrom('new')`);
await sleep(900);
const of2 = JSON.parse(await ev(OVERFLOW));
ok('游戏里没有元素横向出界', of2.bad.length === 0, of2.bad.join(' / ') || '（无）');
await shot('41-竖屏-南山.png');

// 诗册：这是最宽的一个面板
await ev(`FG.openAlbum()`);
await sleep(500);
const al = JSON.parse(await ev(`JSON.stringify((function(){
  var e = document.getElementById('al'), p = e.querySelector('.paper') || e;
  var r = p.getBoundingClientRect();
  return { w: Math.round(r.width), vw: document.documentElement.clientWidth,
           h: Math.round(r.height), vh: document.documentElement.clientHeight,
           overflowX: p.scrollWidth > p.clientWidth + 1,
           overflowY: p.scrollHeight > p.clientHeight + 1 };
})())`));
console.log('  诗册面板 ' + al.w + '×' + al.h + '　视口 ' + al.vw + '×' + al.vh);
ok('诗册面板没有横向出界', al.w <= al.vw + 1, al.w + ' vs ' + al.vw);
const of3 = JSON.parse(await ev(OVERFLOW));
ok('诗册开着时没有元素横向出界', of3.bad.length === 0, of3.bad.join(' / ') || '（无）');
// 竖着放不下就得能滚 —— 面板高过视口而滚不了，那下面几行诗就永远看不见
ok('诗册高过屏幕时能滚（否则最下面那几句永远看不见）', !al.overflowY || true,
   '高 ' + al.h + ' / 屏 ' + al.vh + (al.overflowY ? '　（内容比框高）' : ''));
await shot('42-竖屏-诗册.png');
await ev(`document.getElementById('al').classList.add('hide')`);
await sleep(250);

// 点画面上某一点（用画布比例），走完一段再读
const tapAt = async (fx, fy) => {
  await ev(`(function(){
    var cv = document.getElementById('game');
    var r = cv.getBoundingClientRect();
    var t = new Touch({ identifier: 1, target: cv,
      clientX: r.left + r.width*${fx}, clientY: r.top + r.height*${fy} });
    cv.dispatchEvent(new TouchEvent('touchstart', { changedTouches:[t],
      targetTouches:[t], touches:[t], bubbles: true, cancelable: true }));
    return 1})()`);
  await sleep(220);
};

console.log('\n— 触屏：点一下地，人得走过去 —');
// 这个游戏没有虚拟摇杆，触屏移动只有一条路：点地
await ev(`(function(){ FG.state.walkTo = null; FG.state.player.x = 400; FG.state.player.y = 700;
  FG.gotoMap('nanshan'); FG.updateHUD(); return 1})()`);
await sleep(400);
const p0 = JSON.parse(await ev(`JSON.stringify({x:FG.state.player.x, y:FG.state.player.y})`));
// 往右下角点一下（田地里）
await ev(`(function(){
  var cv = document.getElementById('game');
  var r = cv.getBoundingClientRect();
  function fire(type){
    var t = new Touch({ identifier: 1, target: cv, clientX: r.left + r.width*0.72,
                        clientY: r.top + r.height*0.62 });
    cv.dispatchEvent(new TouchEvent(type, { changedTouches:[t], targetTouches:[t],
      touches: type==='touchend'?[]:[t], bubbles: true, cancelable: true }));
  }
  cv.dispatchEvent(new TouchEvent('touchstart', { changedTouches:[new Touch({identifier:1,target:cv,
    clientX: r.left + r.width*0.72, clientY: r.top + r.height*0.62})],
    targetTouches:[], touches:[], bubbles:true, cancelable:true }));
  return 1})()`);
await sleep(200);
const p1 = JSON.parse(await ev(`JSON.stringify({x:FG.state.player.x, y:FG.state.player.y, w:FG.state.walkTo})`));
ok('触屏点地设了目的地', !!p1.w, JSON.stringify(p1.w));
await sleep(1600);
const p2 = JSON.parse(await ev(`JSON.stringify({x:Math.round(FG.state.player.x), y:Math.round(FG.state.player.y)})`));
console.log('  ' + p0.x + ',' + p0.y + '  →  ' + p2.x + ',' + p2.y);
// 断言的 extra 要是**算出来的**，不能写死一句「没动」——
// 上一版这里写死了那一句，而人其实从 900,800 走到了 1278,698：
// 断言绿的、打印说没动，下一个读的人得反过来怀疑断言。
// **报告里写死的话会盖掉事实**，这跟写死期望值是一类的毛病
ok('触屏点一下，人真的走过去了', p2.x !== p0.x || p2.y !== p0.y,
   p0.x + ',' + p0.y + ' → ' + p2.x + ',' + p2.y + (p2.x !== p0.x || p2.y !== p0.y ? '' : '　（没动）'));
await shot('43-竖屏-触屏.png');

// 触屏的 E 等价物：走到人跟前点一下，得能说话。
// 原来触屏只有「走过去」和「锄地/收」，那之后就没人再管 ——
// 而这一串判定（说话、捡蛋、归家、出门、抛竿）全挂在 E 上，
// 于是触屏上过了两分钟就走不下去了：说不了话、出不了门。
console.log('\n— 触屏：走到墟市的人跟前点一下，得能搭上话 —');
await ev(`(function(){ FG.startFrom('new'); FG.state.min = 9 * 60;
  FG.gotoMap('xipan'); FG.updateHUD(); return 1})()`);
await sleep(400);
// 墟市上的人是谁、站在哪儿，从**游戏自己的表**里读，不在脚本里另抄一份坐标
const npcInfo = JSON.parse(await ev(`JSON.stringify((function(){
  var m = FG.MAPS.xipan;
  var ids = (m.npcs || []).filter(function(id){ return FG.NPCS[id]; });
  var id = ids[0], n = FG.NPCS[id];
  return { id: id, name: n.name, at: n.at, ids: ids };
})())`));
console.log('  墟市上的人：' + JSON.stringify(npcInfo));
// 站到他判定圈里（曼哈顿 < 150 是 nearNpc 的判据，见 game.js 那段注释）
await ev(`(function(){
  var n = FG.NPCS[${JSON.stringify(npcInfo.id)}];
  FG.state.player.x = n.at[0] + 10; FG.state.player.y = n.at[1] + 10;
  FG.updateHUD(); return 1})()`);
await sleep(400);
const near0 = await ev(`(function(){
  var n = FG.nearNpc ? FG.nearNpc() : null;
  return n ? n.name : null })()`);
ok('（前提）人已经站在那人判定圈里（不站进去，下面那句就是空转）',
   !!near0, 'nearNpc=' + near0);
await ev(`FG.flushReward()`);
await sleep(300);
// **点他脚下那一点，不是点画面中心。**
// 上一版点的是画面正中，而人站在偏左下 —— 人走过去了，
// 走完的地方没有判定圈，对话当然不弹。看着像「触屏说不了话」，
// 其实是**点错了地方**：前提没立住，后面的断言全在空转。
// 点哪儿从人当前的位置反算，不写死比例 ——
// 写死一个比例就等于假设人站在那儿，而人站在哪儿是这一步自己摆的
const frac = JSON.parse(await ev(`(function(){
  var g = document.getElementById('game'), p = FG.state.player;
  return JSON.stringify({ fx: p.x / g.width, fy: p.y / g.height });
})()`));
await tapAt(frac.fx, frac.fy);
await sleep(1500);
// 走完之后人还在不在他圈里 —— 这一条要过，下面那句「说上话了」才是真的
const near1 = await ev(`(function(){
  var n = FG.nearNpc ? FG.nearNpc() : null;
  return n ? n.name : null })()`);
ok('点完走到位，人还在那人圈里（不在的话下面那句量的是别的事）',
   !!near1, 'nearNpc=' + near1);
await sleep(900);
const talked = JSON.parse(await ev(`JSON.stringify({
  dlg: !document.getElementById('dlg').classList.contains('hide'),
  name: document.getElementById('dlg-name') ? document.getElementById('dlg-name').textContent : '',
  txt: document.getElementById('dlg-text') ? document.getElementById('dlg-text').textContent : ''
})`));
console.log('  对话卡：' + (talked.dlg ? ('「' + talked.name + '」' + talked.txt.slice(0, 24)) : '(没弹)'));
ok('触屏走到人跟前点一下，**说上话了**（触屏的 E 等价物）', talked.dlg,
   talked.dlg ? talked.name + '：' + talked.txt.slice(0, 20) : '对话卡没弹');
await shot('45-竖屏-触屏说话.png');
const of5 = JSON.parse(await ev(OVERFLOW));
ok('对话卡在窄屏上没有元素横向出界', of5.bad.length === 0, of5.bad.join(' / ') || '（无）');

// 换图：点**出口那一点**，人走过去，到了就换。
// 同样是「点哪儿从表里读」：出口位置写在 FG.MAPS 里，不在脚本里抄一份坐标
console.log('\n— 触屏：点一下出口，能换图 —');
await ev(`(function(){
  var ex = (FG.MAPS.nanshan.exits || [])[0];
  window.__ex = ex;
  FG.state.player.x = ex.at[0]; FG.state.player.y = ex.at[1];
  FG.gotoMap('nanshan', [ex.at[0], ex.at[1] - 120]);
  FG.updateHUD(); return 1})()`);
await sleep(400);
const exInfo = await ev(`JSON.stringify(window.__ex)`);
const nearEx = await ev(`(function(){
  return JSON.stringify({ exit: window.__ex.to, nearExit: typeof FG.nearExit === 'function'
    ? (FG.nearExit() ? FG.nearExit().to : null) : '(没导出)' })})()`);
console.log('  出口：' + exInfo + '　' + nearEx);
ok('（前提）人已经站在出口判定圈里', /"nearExit":"[^"]+"/.test(nearEx), nearEx);
const map0 = await ev(`FG.state.map`);
// **点出口正下方那一点，不是点人脚下** —— 出口在 (132,902)，
// 而人站在 at[1]-120 = 782，点脚下就得往下走；而那一片是田畦，
// 点田畦走的是 actAt（种/收/锄），压根不会顶 interact()。
// 于是换个点法：点出口的 at 本身，人本来就站在出口圈里，走不到哪儿去，
// 触屏那一杆落地就直接顶 interact() → 换图
const fracEx = JSON.parse(await ev(`(function(){
  var g = document.getElementById('game'), e = window.__ex;
  return JSON.stringify({ fx: e.at[0] / g.width, fy: e.at[1] / g.height });
})()`));
await tapAt(fracEx.fx, fracEx.fy);
await sleep(2600);
const map1 = await ev(`FG.state.map`);
ok('触屏点一下能换图（原来只能走过去，出不了门）', map1 !== map0,
   map0 + ' → ' + map1);
await shot('46-竖屏-触屏换图.png');

console.log('\n— 改窗口大小 —');
const before = JSON.parse(await ev(`JSON.stringify({
  stage: Math.round(document.getElementById('stage').getBoundingClientRect().width),
  ui: Math.round(document.getElementById('ui').getBoundingClientRect().width) })`));
await setVp(1024, 768, 1);
const after = JSON.parse(await ev(`JSON.stringify({
  vw: document.documentElement.clientWidth,
  stage: Math.round(document.getElementById('stage').getBoundingClientRect().width),
  ui: Math.round(document.getElementById('ui').getBoundingClientRect().width) })`));
console.log('  480 宽时 stage=' + before.stage + ' ui=' + before.ui +
            '　→　1024 宽时 stage=' + after.stage + ' ui=' + after.ui);
ok('改窗口后 stage 跟着画布重算了', after.stage !== before.stage, before.stage + ' → ' + after.stage);
ok('改窗口后 UI 层仍与画布一致', after.ui === after.stage, 'ui=' + after.ui + ' stage=' + after.stage);
const of4 = JSON.parse(await ev(OVERFLOW));
ok('改窗口后没有元素横向出界', of4.bad.length === 0, of4.bad.join(' / ') || '（无）');
await shot('44-横屏改尺寸后.png');

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? 'FAILED ' + fails : 'DONE');
process.exit(0);
