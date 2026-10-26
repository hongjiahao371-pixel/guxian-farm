// 溪畔验收：钓鱼时机、采集与长回来、天黑出货、回南山。
// 钓鱼要真的等咬钩，不能直接把 state 改成 bite —— 那样测的是赋值不是玩法。
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9335;
const profile = path.join(tmpdir(), 'guxian-xipan-' + process.pid);

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
      // 必须挑 type==='page'：列表里第一个不一定是页面（可能是别的 target），
      // 接错了就 Runtime.evaluate 到空白页，getElementById 全是 null
      const pg = j.find(t => t.type === 'page');
      if (pg) return [pg];
    } catch (e) { }
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}
let id = 0, ws;
const pending = new Map();
const logs = [];

function send(method, params) {
  return new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, { res, rej });
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
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(120);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
async function at(x, y) {
  await ev(`FG.state.player.x=${x}; FG.state.player.y=${y}; FG.state.walkTo=null;`);
  await sleep(150);
}
const spots = async which => (await ev(`JSON.stringify(FG.SPOTS.xipan.${which})`));

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

const file = pathToFileURL(path.join(ROOT, 'index.html')).href;
await send('Page.navigate', { url: file });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

console.log('— 走到溪畔 —');
await at(1800, 664);
await key('e');
await sleep(1000);
ok('已切到溪畔', (await ev(`FG.state.map`)) === 'xipan', await ev(`FG.state.map`));
ok('HUD 换成溪畔', (await ev(`document.getElementById('hud-map').textContent`)) === '南山溪畔');
ok('溪畔没有田', (await ev(`FG.FIELD.on`)) === false);
ok('溪畔没有归家判定', (await ev(`(function(){var m=FG.MAPS.xipan; return !m.home;})()`)) === true);
await shot('09-溪畔.png');

console.log('— 钓点与采集点 —');
const fishSpots = JSON.parse(await spots('fish'));
const pickSpots = JSON.parse(await spots('pick'));
ok('三个钓点', fishSpots.length === 3, fishSpots.map(s => s.name).join('/'));
// 数量不写死：7/9 采这门手艺在四级开了「涉水」，溪心多了一处，
// 写死 7 会变成假失败，而它本来要守的是「每个采集点都摆得出来、够得着」
ok(`采集点 = ${pickSpots.length} 个`, pickSpots.length > 0,
  pickSpots.map(s => s.k).join('/'));
// 两处站点挨太近的话，E 的归属按先判到的那个算 —— 站在荇菜那儿
// 会变成「浮漂稳住了」，画面上完全看不出哪里出了问题。
// 阈值从源码读（FG.SPOT_R），不在这里另抄一个数：抄的那个数
// 跟真实半径对不上的时候，这条断言会在「其实没问题」和「永远绿」之间二选一
const R = JSON.parse(await ev(`JSON.stringify(FG.SPOT_R)`));
const tooClose = await ev(`(function(){
  var F=FG.SPOTS.xipan.fish, P=FG.SPOTS.xipan.pick, bad=[], i, j, d, need=${R.fish}+10;
  for(i=0;i<P.length;i++) for(j=0;j<F.length;j++){
    d=Math.abs(P[i].at[0]-F[j].at[0])+Math.abs(P[i].at[1]-F[j].at[1]);
    if(d<need) bad.push(P[i].k+'@'+P[i].at+' 离 '+F[j].name+' 只有 '+d);
  }
  return bad.join(' | ')||'(无)';})()`);
ok(`每个采集点都离钓点够远（> 钓点半径 ${R.fish} + 10）`, tooClose === '(无)', tooClose);
// 要手艺才够得着的那几处，判据得在表上，而不是画在图上
const gated = JSON.parse(await ev(`(function(){
  var P=FG.SPOTS.xipan.pick, a=[], i;
  for(i=0;i<P.length;i++) if(P[i].need) a.push(P[i].k+':'+JSON.stringify(P[i].need));
  return JSON.stringify(a);})()`));
console.log('  要手艺才够得着的采集点 = ' + (gated.join('　') || '(无)'));
ok('每个钓点都落在水面那条斜带上', fishSpots.every(s => s.at[1] >= 460 && s.at[1] <= 620),
   fishSpots.map(s => s.at.join(',')).join(' / '));
const yfAt = JSON.parse(await ev(`JSON.stringify(FG.NPCS.yufu.at)`));
ok('渔父站在岸上、不在水里', yfAt[1] > 650, '渔父 y=' + yfAt[1]);
ok('渔父离西汊钓点够得着但不会挡住它',
   Math.abs(yfAt[0] - fishSpots[0].at[0]) + Math.abs(yfAt[1] - fishSpots[0].at[1]) > 150);

console.log('— 抛竿 —');
// 站到西汊钓点的岸上
await at(fishSpots[0].at[0], fishSpots[0].at[1] + 130);
await sleep(250);
ok('钓点有垂钓提示', (await ev(`document.getElementById('hint').textContent`)).indexOf('垂钓') >= 0,
   await ev(`document.getElementById('hint').textContent`));
await key('e');
await sleep(200);
ok('抛竿成功', (await ev(`!!FG.state.fishing`)) === true);
ok('还在等钩阶段', (await ev(`FG.state.fishing.phase`)) === 'wait');

// 真等咬钩：轮询到 phase 变 bite。
// 轮询步长压到 60ms —— 咬钩窗口只有 0.75 - 0.42×hard 秒
// （溪虾 0.72s、鲫 0.67s），每一步都是在花这个窗口的钱
let waited = 0, phase = 'wait';
while (waited < 6000) { await sleep(60); waited += 60; phase = await ev(`FG.state.fishing ? FG.state.fishing.phase : 'gone'`); if (phase !== 'wait') break; }
ok('等到了咬钩', phase === 'bite', `等了 ${waited}ms，相位=${phase}`);
ok('咬钩有提竿提示', (await ev(`document.getElementById('hint').textContent`)).indexOf('提竿') >= 0);

console.log('— 提竿 —');
// **这里原来插了一张截图。** 一次 Page.captureScreenshot 的往返就够把
// 0.7 秒的窗口等穿，鱼游走了，于是后面三条断言一起红 ——
// 而红的原因是机器忙（并行跑着另一个浏览器），不是游戏错了。
// 教训跟「判据不能挂在墙上时间上」是同一条：**截图是给人看的，
// 不能夹在时序最紧的那几步中间**。改成提完竿再拍。
await key('e');
await sleep(300);
ok('收线后状态清空', (await ev(`FG.state.fishing`)) === null);
const caught = await ev(`JSON.stringify(FG.state.pouch)`);
ok('鱼进篓里了', Object.keys(JSON.parse(caught)).length >= 1, '篓=' + caught);
const cc = await ev(`FG.state.catchCount`);
ok('计数 +1', cc === 1, 'catchCount=' + cc);
await shot('11-上鱼.png');

console.log('— 咬钩不提竿，鱼会游走 —');
// 这条原来没有覆盖，而它是「窗口真的只有那么宽」唯一的证据。
// 顺带把「咬钩」那张截图挪到这里：这一段**故意**把窗口等穿，
// 所以截图爱什么时候拍都不影响判据
await at(fishSpots[0].at[0], fishSpots[0].at[1] + 130);
await key('e');
let w2 = 0, p2 = 'wait';
while (w2 < 6000) { await sleep(60); w2 += 60; p2 = await ev(`FG.state.fishing ? FG.state.fishing.phase : 'gone'`); if (p2 !== 'wait') break; }
ok('第二次也等到了咬钩', p2 === 'bite', `等了 ${w2}ms，相位=${p2}`);
// **窗口要在截图之前量。** 这一段是**故意**把鱼等跑的，
// 而截图是一次 Page.captureScreenshot 往返 —— 机器一忙，
// 截图还没回来竿就被收了，读出来的 win 是 -1。
// 「断言放在一段会自己结束的流程后面」是今天第二次了
ok('咬钩窗口不到一秒', (await ev(`FG.state.fishing ? Math.round(FG.state.fishing.win*1000) : -1`)) > 0
  && (await ev(`FG.state.fishing ? Math.round(FG.state.fishing.win*1000) : -1`)) < 1000,
  '窗口 ' + (await ev(`FG.state.fishing ? Math.round(FG.state.fishing.win*1000) : -1`)) + 'ms');
await shot('10-咬钩.png');
// 什么都不做，等它自己过窗口
let g2 = 'bite';
while (g2 === 'bite' && w2 < 6000) { await sleep(60); w2 += 60; g2 = await ev(`FG.state.fishing ? FG.state.fishing.phase : 'gone'`); }
ok('窗口过了竿就收了', (await ev(`FG.state.fishing`)) === null, '多等了 ' + w2 + 'ms');
ok('并且说了是鱼游走了', (await ev(`document.getElementById('toast').textContent`)).indexOf('游走') >= 0,
   await ev(`document.getElementById('toast').textContent`));
ok('游走的不算数：没进篓、没加计数', Object.keys(JSON.parse(await ev(`JSON.stringify(FG.state.pouch)`))).length < 2
  && (await ev(`FG.state.catchCount`)) === 1,
  '篓=' + (await ev(`JSON.stringify(FG.state.pouch)`)) + ' catchCount=' + (await ev(`FG.state.catchCount`)));

console.log('— 提早了会跑 —');
await at(fishSpots[1].at[0], fishSpots[1].at[1] + 120);
await key('e');
await sleep(150);
// **先核竿真的抛出去了**：不然第二个 E 可能抛的是竿而不是提的竿，
// 而判据照样「fishing === null」—— 绿的，测的却不是这一条
ok('（前提）竿确实抛出去了', (await ev(`!!FG.state.fishing`)) === true);
ok('还没咬钩', (await ev(`FG.state.fishing ? FG.state.fishing.phase : 'gone'`)) === 'wait');
await key('e');           // 还在等钩就提竿
await sleep(300);
ok('提早被拦住', (await ev(`FG.state.fishing`)) === null);
ok('并且给了提示', (await ev(`document.getElementById('toast').textContent`)).indexOf('提竿早') >= 0,
   await ev(`document.getElementById('toast').textContent`));
ok('提早也不算数：计数没涨', (await ev(`FG.state.catchCount`)) === 1, 'catchCount=' + (await ev(`FG.state.catchCount`)));

console.log('— 采集与长回来 —');
const node0 = pickSpots.find(s => s.k === 'mei');
await at(node0.at[0], node0.at[1] + 90);
await sleep(200);
ok('采集点有提示', (await ev(`document.getElementById('hint').textContent`)).indexOf('采') >= 0,
   await ev(`document.getElementById('hint').textContent`));
await key('e');
await sleep(300);
ok('采到野莓', (await ev(`FG.state.pouch.mei`)) === 1, 'mei=' + await ev(`FG.state.pouch.mei`));
const nk = `xipan:${node0.at[0]},${node0.at[1]}`;
ok('记下了长回来的日子', (await ev(`FG.state.picked["${nk}"]`)) === (await ev(`FG.state.day`)) + node0.back,
   'picked=' + await ev(`FG.state.picked["${nk}"]`) + ' 当天=' + await ev(`FG.state.day`) + ' back=' + node0.back);
// 立刻回去不能再采
await key('e');
await sleep(250);
ok('同一天采不到第二次', (await ev(`FG.state.pouch.mei`)) === 1, 'mei=' + await ev(`FG.state.pouch.mei`));
// 过了 back 天应该长回来
await ev(`FG.state.day = FG.state.day + ${node0.back}`);
await sleep(250);
ok('过几天长回来了', (await ev(`FG.state.picked["${nk}"] <= FG.state.day`)) === true,
   'picked=' + await ev(`FG.state.picked["${nk}"]`) + ' 当天=' + await ev(`FG.state.day`));

console.log('— 跟渔父说话 —');
await ev(`FG.state.talkIdx = 0`);
const yf = JSON.parse(await ev(`JSON.stringify(FG.NPCS.yufu.at)`));
await at(yf[0], yf[1] - 70);
await key('e'); await sleep(400);
ok('渔父对话弹出', (await ev(`!document.getElementById('dlg').classList.contains('hide')`)) === true);
// 抬头是「名字　·　档位」（10/3 加的人情那一层），核的是开头是他
ok('弹的确实是渔父', (await ev(`document.getElementById('dlg-name').textContent`)).indexOf('渔父') === 0,
   await ev(`document.getElementById('dlg-name').textContent`));
console.log('  台词 =', await ev(`document.getElementById('dlg-text').textContent`));
console.log('  出处 =', await ev(`document.getElementById('dlg-from').textContent`));
await shot('12-渔父.png');
await ev(`document.getElementById('dlg-x').click()`);
await sleep(200);

console.log('— 天黑出货 —');
// 现在钱不是「篓子空了」而是「箱里有东西」：钓上来的鱼得先放进出货箱，
// 不放的就留在篓子里过夜。这一节盯的是「放了才折钱」，
// 「没放的不折钱」在 dev/shoot-bin.mjs 里盯
const gold0 = await ev(`FG.state.gold`);
const pouch0 = await ev(`JSON.stringify(FG.state.pouch)`);
// 放箱：走公开的那条路，不直接写 S.bin —— 直接写就绕过了玩家真正会走的那段代码。
// 面板没开的时候 #bx-hand 里一行也没有，querySelector 全返回 null，
// 于是「点了没反应」，而断言只看箱里有没有东西，读起来像游戏坏了
await ev(`(function(){
  FG.openBin();
  var moved = 0;
  FG.binHeld().forEach(function (b) {
    if (!b.can) return;
    // 走和玩家点按钮同一条路。面板每点一次就整个重画，
    // 所以这里一次只点一行、点完重新查，不能先 querySelectorAll 再连点
    var row = document.querySelector('#bx-hand [data-k="' + b.k + '"]');
    if (row) { row.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); moved++; }
  });
  document.getElementById('bx-x').click();
  return moved;
})()`);
await sleep(300);
// 外面不要套 JSON.stringify：套了之后空箱会读成字符串 '""'，
// 而 '""'.length > 0 为真，断言就永远绿着
const inBin = await ev(`FG.binList().map(function (b) { return b.k + ':' + b.n; }).sort().join(',')`);
ok('钓上来的东西进了箱', inBin.length > 0, inBin || '(箱是空的)');
// 不直接调内部函数：把时钟推到日暮，走主循环里那条 endDay 路径
await ev(`FG.state.min = FG.DAY.END - 1`);
await ev(`FG.endDay()`);   // 夜游后天黑不再自动结算 —— 显式走
await sleep(1800);
ok('结算面板弹了', (await ev(`!document.getElementById('de').classList.contains('hide')`)) === true);
const body = await ev(`document.querySelector('#de .body').textContent`);
console.log('  结算 =', body.replace(/\s+/g, ' ').slice(0, 160));
ok('鱼/山货折了钱', (await ev(`FG.state.gold`)) > gold0, `${gold0} -> ${await ev(`FG.state.gold`)}`);
ok('箱出货后清空了', (await ev(`Object.keys(FG.state.bin).length`)) === 0,
  await ev(`JSON.stringify(FG.state.bin)`));
// 篓子里的键会留着、计数清零（和 S.bag 一个规矩），所以别断言成空对象
const left = JSON.parse(await ev(`JSON.stringify(FG.state.pouch)`));
ok('出货后篓子清空了', Object.values(left).every(v => v === 0), await ev(`JSON.stringify(FG.state.pouch)`));
console.log('  进货前 =', pouch0, '　进货后 =', await ev(`JSON.stringify(FG.state.pouch)`));
ok('溪畔结算不提「浇过的水」', (await ev(`document.querySelector('#de .body').textContent`)).indexOf('浇水') < 0);
ok('溪畔结算报了垂钓尾数', (await ev(`document.querySelector('#de .body').textContent`)).indexOf('垂钓 1 尾') >= 0,
   await ev(`document.querySelector('#de .body').textContent`));

console.log('— 在溪畔过夜，南山的田照样长 —');
// 踩过的坑：endDay 原来按 F.ROWS/F.COLS 循环，站在溪畔时这俩被置成 1，
// 于是南山 25 格里只有第 0 格长，整整一夜白种。
await ev(`document.getElementById('de').classList.remove('hide')`);
await ev(`FG.nextDay()`);
await sleep(600);
await ev(`
  (function () {
    var g = FG.FIELD;
    FG.gotoMap('nanshan', [900, 800]);
    // 铺满一整片：9 格都种上豆、都浇过水
    var n = 0;
    for (var r = 0; r < g.ROWS; r++) for (var c = 0; c < g.COLS; c++) {
      var pl = FG.state.plots[r][c];
      pl.tilled = true; pl.crop = 'dou'; pl.stage = 0; pl.wet = true; n++;
    }
    window.__n = n;
  })()
`);
const n2 = await ev(`window.__n`);
await ev(`FG.gotoMap('xipan', [760, 800])`);
await sleep(400);
await ev(`FG.state.min = FG.DAY.END - 1`);
await ev(`FG.endDay()`);   // 夜游后天黑不再自动结算 —— 显式走
await sleep(1800);
await ev(`FG.gotoMap('nanshan', [900, 800])`);
await sleep(400);
const grown = await ev(`(function(){var n=0,g=FG.FIELD;for(var r=0;r<g.ROWS;r++)for(var c=0;c<g.COLS;c++){if(FG.state.plots[r][c].stage>0)n++;}return n;})()`);
ok('在溪畔过夜后南山每一格都长了', grown === n2, `种了 ${n2} 格，长了 ${grown} 格`);
await shot('13-溪畔结算.png');

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? `FAILED ${fails}` : 'DONE');
