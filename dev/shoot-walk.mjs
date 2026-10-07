// 可走区：山、屋、竹子挡不挡得住人。
//
// 为什么单做一套：bounds 只是**一个大矩形**，而山、屋、竹子都在这个矩形里面 ——
// 只靠它，点在山腰上人就会一路走上去站着（实测能站到茅屋顶上，画布 y 454，
// 而 bounds.y0 是 400）。这种毛病玩的时候一眼就看见了，逻辑断言却看不出来。
//
// 量三样：
//   ① 人**走**进块里，会不会被推出来
//   ② 点一个块里的地方，walkTo 的目标会不会被夹到块外
//   ③ **所有判定点都不在块里** —— 挡掉一个交互点，那个功能就再也够不着了，
//      症状是「提示行说该在这儿按 E，可我站过去了没反应」，最难查的一条，
//      所以钉成断言，以后谁挪坐标都会当场看见
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9459;
const profile = path.join(tmpdir(), 'guxian-walk-' + process.pid);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--allow-file-access-from-files', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

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
const key = async k => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(140);
};
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
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
    logs.push(m.params.args.map(a => a.value || a.description).join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') });
await sleep(3000);
await ev(`FG.startFrom('new')`);
await sleep(900);

console.log('— 南山的不可走块摆好了吗 —');
const blocks = JSON.parse(await ev(`JSON.stringify(FG.MAPS.nanshan.blocks || [])`));
ok('南山有 blocks（没这块表，山和屋就只靠 bounds 拦）', blocks.length > 0,
   blocks.length + ' 块');
console.log('  ' + blocks.map(b => `[${b.join(',')}]`).join('  '));

console.log('\n— 判定点一个都不能被挡 —');
// 期望值从**各自的表**里读，不在脚本里另抄一份坐标 ——
// 抄一份的话，改了表而没改脚本，这条断言就会一直绿
const spotChk = await ev(`(function(){
  var m = FG.MAPS.nanshan, bad = [], list = [];
  function add(name, x, y){ list.push({name:name,x:x,y:y});
    if (FG.inBlock(m, x, y)) bad.push(name + '(' + x + ',' + y + ')'); }
  m.exits.forEach(function(e){ add('出口/' + e.to, e.at[0], e.at[1]); });
  add('歇脚处', m.station[0], m.station[1]);
  add('家', m.home[0], m.home[1]);
  (m.builds || []).forEach(function(id){ var d = FG.BUILD[id];
    if (d && d.at) add('营造/' + id, d.at[0], d.at[1]); });
  (m.machines || []).forEach(function(id){ var d = FG.MACHINE[id];
    if (d && d.at) add('机器/' + id, d.at[0], d.at[1]); });
  (m.npcs || []).forEach(function(id){ var d = FG.NPCS[id];
    if (d && d.at) add('NPC/' + id, d.at[0], d.at[1]); });
  if (FG.CHEST && FG.CHEST.at) add('木箱', FG.CHEST.at[0], FG.CHEST.at[1]);
  return JSON.stringify({ n: list.length, bad: bad, list: list });
})()`);
console.log('  核了 ' + JSON.parse(spotChk).n + ' 个判定点');
ok('**没有判定点被 blocks 挡住**（挡掉一个，那个功能就再也够不着）',
   JSON.parse(spotChk).bad.length === 0, JSON.parse(spotChk).bad.join(' / ') || '（无）');
// 田的四条边也要能站：田畦梯形上下沿四角
const quadChk = await ev(`(function(){
  var q = FG.MAPS.nanshan.quad, m = FG.MAPS.nanshan, bad = [];
  [[q[0],q[1]],[q[2],q[3]],[q[4],q[5]],[q[6],q[7]]].forEach(function(p){
    if (FG.inBlock(m, p[0], p[1])) bad.push('田角(' + p[0] + ',' + p[1] + ')'); });
  return JSON.stringify(bad);
})()`);
ok('田畦梯形四个角都在块外（不然头一畦就锄不到）',
   JSON.parse(quadChk).length === 0, JSON.parse(quadChk).join(' / ') || '（无）');

console.log('\n— 走进去会被推出来 —');
// 直接把人摆进块里，然后等两帧 —— 移动循环每帧都过 bounds 和 pushOut
const pushed = JSON.parse(await ev(`(function(){
  FG.gotoMap('nanshan');
  FG.state.player.x = 445; FG.state.player.y = 454;   // 茅屋顶上（用户截图里那个位置）
  FG.state.walkTo = null;
  return 1})()`));
void pushed;
await sleep(500);
const pos = JSON.parse(await ev(`JSON.stringify({
  x: Math.round(FG.state.player.x), y: Math.round(FG.state.player.y),
  inBlock: FG.inBlock(FG.MAPS.nanshan, FG.state.player.x, FG.state.player.y)
})`));
ok('人摆到茅屋顶上，两帧内被推出来了', pos.inBlock === false,
   '落点 (' + pos.x + ',' + pos.y + ')　inBlock=' + pos.inBlock);
await shot('54-推到山脚下.png');

console.log('\n— 点山不会一路顶上去 —');
const walked = JSON.parse(await ev(`(function(){
  FG.state.player.x = 900; FG.state.player.y = 800; FG.state.walkTo = null;
  FG.gotoMap('nanshan', [900, 800]);
  FG.actAt(300, 430);            // 点在茅屋后面的山坡上
  return JSON.stringify(FG.state.walkTo);
})()`));
ok('点的位置在块里时，目的地被夹到块外',
   Array.isArray(walked) && !(walked[0] > 20 && walked[0] < 560 && walked[1] > 392 && walked[1] < 612),
   'walkTo=' + JSON.stringify(walked));
// 走完看一眼人到底停在哪。
// **等足时间**：速度 210px/s，从 (900,800) 到 (300,614) 有 628px，
// 要 3 秒。上一版只等 2.6 秒，人差 70px 没走到，断言就红了 ——
// 而那是测试自己没等够，不是游戏的毛病
await sleep(4200);
const after = JSON.parse(await ev(`JSON.stringify({
  x: Math.round(FG.state.player.x), y: Math.round(FG.state.player.y),
  inBlock: FG.inBlock(FG.MAPS.nanshan, FG.state.player.x, FG.state.player.y),
  walkTo: FG.state.walkTo
})`));
ok('走完了人停在能站的地方（不是山腰上）', after.inBlock === false,
   '落点 (' + after.x + ',' + after.y + ')　walkTo=' + JSON.stringify(after.walkTo));
ok('走完了 walkTo 清了（没顶在边界上一直抖）', after.walkTo === null, JSON.stringify(after.walkTo));
await shot('55-点山之后.png');

console.log('\n— 该去的地方还去得着 —');
// 反向的一条：挡得太狠会把出口和歇脚处一起挡掉，那比站在山上更糟
for (const [nm, x, y] of [['山口', 604, 486], ['歇脚处', 1560, 450], ['蜂窠', 850, 430], ['水渠', 1120, 468]]) {
  const can = JSON.parse(await ev(`(function(){
    FG.gotoMap('nanshan', [900, 800]);
    FG.state.player.x = 900; FG.state.player.y = 800; FG.state.walkTo = null;
    FG.actAt(${x}, ${y});
    return JSON.stringify({ walkTo: FG.state.walkTo,
      blocked: FG.inBlock(FG.MAPS.nanshan, ${x}, ${y}) });
  })()`));
  ok('从田里能走到' + nm + '（点位 ' + x + ',' + y + '）',
     !can.blocked && Array.isArray(can.walkTo), JSON.stringify(can));
}
await sleep(400);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? 'FAILED ' + fails : 'DONE');
process.exit(0);
