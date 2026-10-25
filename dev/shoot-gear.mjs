// 器物分级验收：场合不变，变的只有一次做得多少。
//
// 盯住这几条：
//   1) 锄永远翻土、瓢永远浇水 —— 分级不给新用途（这是和「器物无等级」那条老
//      规矩的和解条件，破了这条整个分级就得重做）
//   2) 木锄 1×1、铜锄 1×3、铁锄 3×3，而且**只在田内**取，越界的那部分不算
//   3) 体力按真动到的畦数照扣，一分不少一分不多
//   4) 体力不够就整片不动 —— 不能只翻了一半
//   5) 铁锄一框九畦，鼠标停着时九格都要亮出来
//   6) 只能一级一级买，攒够钱也跳不过去
//   7) 器物架和行囊上写的是**现在这把**的名字
//   8) 翻好没下种的畦浇不得 —— 浇了既不扣力气也不改地，
//      而且回话说的是「没苗」不是「没翻」（这两件事在藏季差着 36 天）
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9367;
const profile = path.join(tmpdir(), 'guxian-gear-' + process.pid);
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
      const pg = (await r.json()).find(t => t.type === 'page');
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
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
}
// 真按一个键。合成 KeyboardEvent 派到 document 上也能冒泡到 window，
// 但游戏里那个 listener 是挂在 window 上的，而合成事件不走浏览器的
// 默认动作 —— 一旦哪边改成读 e.isTrusted 或 e.code，合成事件就整个失灵
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(160);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
// 点一格，走 actAt 那条路（和玩家点田畦同一条）
async function clickCell(col, row) {
  await ev(`(function(){
    var q=FG.FIELD.cellCenter(${col},${row});
    var r=document.querySelector('canvas');
    var b=r.getBoundingClientRect();
    var x=b.left + q[0]*b.width/r.width;
    var y=b.top  + q[1]*b.height/r.height;
    r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:x,clientY:y}));
    return 1;
  })()`);
  await sleep(300);
}
const tilledCount = () => ev(`FG.state.plots.flat().filter(function(p){return p.tilled}).length`);
const wetCount = () => ev(`FG.state.plots.flat().filter(function(p){return p.wet}).length`);
const stam = () => ev(`FG.state.stam`);
const sel = () => ev(`FG.state.sel`);
const gold = () => ev(`FG.state.gold`);
const gearChu = () => ev(`FG.state.gear.chu`);
const toast = () => ev(`document.getElementById('toast').textContent`);
const trayName = (k) => ev(`document.querySelector('#tray .slot[data-k="${k}"] b').textContent`);
const reset = () => ev(`(function(){
  FG.state.plots.forEach(function(r){ r.forEach(function(p){ p.tilled=false; p.wet=false; p.crop=null; p.stage=0; }); });
  FG.state.stam = FG.state.maxStam;
  FG.updateHUD(); return 1;
})()`);

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
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

const GEAR = JSON.parse(await ev(`JSON.stringify(FG.GEAR)`));
const G0 = JSON.parse(await ev(`JSON.stringify(FG.GEAR0)`));
const STAM = JSON.parse(await ev(`JSON.stringify(FG.GEAR_STAM)`));
const field = JSON.parse(await ev(`JSON.stringify({COLS:FG.FIELD.COLS, ROWS:FG.FIELD.ROWS})`));
console.log('  田 = ' + field.COLS + '×' + field.ROWS + '　每畦力气 = ' + JSON.stringify(STAM));

// 改完分级要叫一次重画。只改 S 不会触发任何 DOM 更新，
// 那一刻去量器物架上的字，量到的是上一把 —— 看着像「升级没反映」
// 套一层 IIFE：Runtime.evaluate 里顶层写 return 是非法的，会报
// 「Illegal return statement」，而这条错误长得跟游戏崩了没什么两样
const setGear = async (k, lv) => {
  await ev(`(function(){ FG.state.gear['${k}'] = ${lv}; FG.updateHUD(); return 1; })()`);
  await sleep(200);
};
const setSel = async (k) => {
  await ev(`(function(){ FG.state.sel = '${k}'; FG.updateHUD(); return 1; })()`);
  await sleep(150);
};

console.log('— 开局是木的 —');
ok('锄 0 级是木锄 1×1',
  (await ev(`FG.gearOf('chu').name`)) === G0.chu.name &&
  (await ev(`FG.gearOf('chu').w`)) === 1 &&
  (await ev(`FG.gearOf('chu').h`)) === 1,
  await ev(`JSON.stringify(FG.gearOf('chu'))`));
ok('瓢 0 级是木瓢 1×1', (await ev(`FG.gearOf('piao').name`)) === G0.piao.name);
ok('每一级都还是「做一块地」，不给新用途',
  Object.keys(GEAR).every(k => GEAR[k].every(t2 => t2.w > 0 && t2.h > 0)));
ok('越往后一次做得越多',
  Object.keys(GEAR).every(k => GEAR[k].every((t2, i) =>
    i === 0 || t2.w * t2.h > GEAR[k][i - 1].w * GEAR[k][i - 1].h)),
  GEAR.chu.map(t2 => t2.name + ' ' + t2.w + '×' + t2.h).join('　'));
ok('越往后越贵',
  Object.keys(GEAR).every(k => GEAR[k].every((t2, i) =>
    i === 0 || t2.price > GEAR[k][i - 1].price)),
  GEAR.chu.map(t2 => t2.name + ' ' + t2.price).join('　'));

console.log('— 木锄一下一畦 —');
await reset();
await setSel('chu');
const s0 = await stam();
await clickCell(2, 2);
ok('翻了一畦', (await tilledCount()) === 1, '翻了 ' + (await tilledCount()));
ok('扣了两分力气', (await stam()) === s0 - STAM.chu, s0 + ' -> ' + (await stam()));

console.log('— 铜锄一下一列三畦 —');
await setGear('chu', 1);
ok('现在叫铜锄', (await ev(`FG.gearOf('chu').name`)) === GEAR.chu[0].name,
  await ev(`FG.gearOf('chu').name`));
ok('器物架上跟着换名字', (await trayName('chu')) === GEAR.chu[0].name, await trayName('chu'));
await reset();
const s1 = await stam();
await clickCell(2, 2);
const n1 = await tilledCount();
ok('翻了三畦', n1 === GEAR.chu[0].h, '翻了 ' + n1 + ' 畦（应 ' + GEAR.chu[0].h + '）');
ok('按畦数扣力', (await stam()) === s1 - STAM.chu * n1, s1 + ' - ' + STAM.chu + '×' + n1 + ' = ' + (await stam()));
ok('三畦是竖着的一列',
  (await ev(`FG.gearCells('chu',2,2).map(function(p){return p[0]+','+p[1]}).join(' ')`)) === '2,1 2,2 2,3',
  await ev(`FG.gearCells('chu',2,2).map(function(p){return p[0]+','+p[1]}).join(' ')`));

console.log('— 铁锄一下九畦 —');
await setGear('chu', 2);
ok('现在叫铁锄', (await ev(`FG.gearOf('chu').name`)) === GEAR.chu[1].name, await trayName('chu'));
await reset();
const s2 = await stam();
await clickCell(2, 2);
const n2 = await tilledCount();
ok('翻了九畦', n2 === GEAR.chu[1].w * GEAR.chu[1].h, '翻了 ' + n2 + ' 畦');
ok('按九畦扣力', (await stam()) === s2 - STAM.chu * n2, s2 + ' - ' + STAM.chu + '×' + n2 + ' = ' + (await stam()));

console.log('— 越出田外的那几畦不算 —');
await reset();
await clickCell(0, 0);
const n3 = await tilledCount();
ok('贴着左上角点，只翻到田里那一块', n3 === 4, '翻了 ' + n3 + ' 畦（3×3 贴角只剩 2×2）');
ok('这一段没有异常', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 体力不够就整片不动 —');
await reset();
await ev(`FG.state.stam = 5`);
await sleep(200);
await clickCell(2, 2);
ok('一畦都没翻', (await tilledCount()) === 0, '翻了 ' + (await tilledCount()));
ok('体力一点没扣', (await stam()) === 5, 'stam=' + (await stam()));
ok('提示说的是要多少力气', (await toast()).indexOf('力气') >= 0, await toast());
// 半片是最糟的一种：一半翻了一半没翻，玩家看不出哪一半做过了
await setGear('chu', 0);
await ev(`FG.state.stam = 2`);
await reset();
await ev(`FG.state.stam = 2`);
await sleep(200);
await clickCell(2, 2);
ok('木锄只够翻一畦就翻一畦，不贪', (await tilledCount()) === 1, '翻了 ' + (await tilledCount()));
ok('这一段没有异常', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 瓢也按范围来 —');
await setGear('chu', 0);
await setGear('piao', 2);
await setSel('piao');
ok('铁瓢一次九畦', (await ev(`FG.gearOf('piao').w * FG.gearOf('piao').h`)) === 9,
  await ev(`FG.gearOf('piao').w + '×' + FG.gearOf('piao').h`));
await reset();
await clickCell(2, 2);
ok('没翻过的地浇不上', (await wetCount()) === 0, '浇了 ' + (await wetCount()));
ok('并且说明了原因', (await toast()).indexOf('锄开') >= 0, await toast());
await setSel('chu');
// 先用铁锄把九畦全翻出来。少了这步，铁瓢只浇得到一畦 ——
// 不是瓢的错，是另外八畦还没翻，而那恰恰是这一段要盯的事：
// 「只浇翻过的」不能被「范围」盖住
await setGear('chu', 2);
await reset();
await clickCell(2, 2);
ok('铁锄把九畦翻出来了', (await tilledCount()) === 9, '翻了 ' + (await tilledCount()) + ' 畦');
// 原来这一段翻完九畦**空地**就开浇，浇出 0 畦，然后拿 0 当期望值去减：
// `STAM.piao * n4` 里 n4 就是刚量出来的那个 0，于是「按九畦扣力」恒真、
// 「浇过的不再浇一次」也恒真 —— 它浇了 0 畦，两条断言照样全绿。
// 而且它是绿的**好几年**：浇空地本来就是个 bug，而这条断言正是在断言那个 bug。
// 根子在于期望值用了被测对象自己。要下种，让九畦真的能浇。
await ev(`(function(){ FG.state.seeds.dou=99;
  for (var c=1;c<=3;c++) for (var r=1;r<=3;r++) FG.sowWith('dou',c,r);
  return 1})()`);
await sleep(300);
ok('九畦都下了种', (await ev(`FG.state.plots.flat().filter(function(p){return p.crop}).length`)) === 9,
  '种了 ' + (await ev(`FG.state.plots.flat().filter(function(p){return p.crop}).length`)) + ' 畦');
await setGear('piao', 2);
await setSel('piao');
const s4 = await stam();
await clickCell(2, 2);
const n4 = await wetCount();
ok('九畦一次浇完', n4 === 9, '浇了 ' + n4);
// 期望值写死 9，不许再拿量出来的 n4 去算 —— 那一支的自证就是上面那个坑
ok('按九畦扣力', (await stam()) === s4 - STAM.piao * 9, s4 + ' - ' + STAM.piao + '×9 = ' + (await stam()));
const s5 = await stam();
await clickCell(2, 2);
ok('浇过的不再浇一次', (await stam()) === s5, 'stam ' + s5 + ' -> ' + (await stam()));
ok('而且没再浇一遍', (await wetCount()) === 9, 'wet=' + (await wetCount()));
ok('这一段没有异常', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 翻好没下种的畦，浇不得 —');
// 原来 workArea 浇那一支只看 pl.tilled，不看 pl.crop，于是空地照样浇得动：
// 扣一分力气、回一句「浇过 1 畦」，而地里什么也没发生。
// 藏季那三十来天地里种不了东西，玩家手上只剩这把木瓢，于是一天天浇空地 ——
// 那是这个游戏里唯一一件「有反馈却没结果」的事，
// 而且只有它是有反馈的那个：浇过的畦会变湿，浇空地什么都不会变
await setGear('chu', 2);
await reset();
await setSel('chu');
await clickCell(2, 2);
ok('先翻出九畦空的', (await tilledCount()) === 9, '翻了 ' + (await tilledCount()) + ' 畦');
await setGear('piao', 2);
await setSel('piao');
const s6 = await stam();
await clickCell(2, 2);
ok('翻好没下种的畦一畦也浇不上', (await wetCount()) === 0, 'wet=' + (await wetCount()));
ok('一畦也浇不上，就一分力气都不扣', (await stam()) === s6, s6 + ' -> ' + (await stam()));
ok('并且说清是「没苗」，不是「没翻」', /苗/.test(await toast()) && !/锄开/.test(await toast()), await toast());
// 只种一畦，那一畦就浇得动 —— 「按有没有苗分」不能写成「整片不浇」
await ev(`(function(){ FG.sowWith('dou',2,2); return 1})()`);
await sleep(200);
ok('种下去一畦', (await ev(`FG.state.plots[2][2].crop`)) === 'dou',
  'crop=' + (await ev(`FG.state.plots[2][2].crop`)));
const s7 = await stam();
await clickCell(2, 2);
ok('八畦空的不浇，有苗的那一畦浇了', (await wetCount()) === 1, 'wet=' + (await wetCount()));
ok('只按真的动了的那一畦扣力', (await stam()) === s7 - STAM.piao,
  s7 + ' - ' + STAM.piao + ' = ' + (await stam()));
ok('这一段没有异常', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 悬停高亮的是真会动到的那几格 —');
await setGear('piao', 2);
await setGear('chu', 2);
await setSel('chu');
await ev(`FG.state.hover = [3,3]`);
await sleep(250);
ok('铁锄悬停出九格', (await ev(`(FG.hoverSpan()||[]).length`)) === 9,
  '亮了 ' + (await ev(`(FG.hoverSpan()||[]).length`)) + ' 格');
await setGear('chu', 0);
ok('木锄悬停只亮一格', (await ev(`(FG.hoverSpan()||[]).length`)) === 1,
  '亮了 ' + (await ev(`(FG.hoverSpan()||[]).length`)) + ' 格');
await setSel('dou');
ok('捏着种子时不亮一片', (await ev(`FG.hoverSpan()`)) === null, String(await ev(`FG.hoverSpan()`)));

console.log('— 墟市：只能一级一级买 —');
// 墟市 NPC 在另一张图上。nearNpc 走的是**当前这张图**的 npcs 名单，
// 所以人还在南山时按 B 只会说「这里没有可看的东西」—— 面板永远开不出来
async function openShop() {
  // NPC 坐标从 data.js 读，不手抄；抄错一次就站不到位
  const a = JSON.parse(await ev(`JSON.stringify(FG.NPCS.xushi.at)`));
  await ev(`(function(){ FG.gotoMap('xushi', FG.MAPS.xushi.spawn); return 1; })()`);
  await sleep(500);
  await ev(`FG.state.player.x=${a[0]}; FG.state.player.y=${a[1] - 60}; FG.state.walkTo=null;`);
  await sleep(250);
  await key('b');
  await sleep(450);
  return (await ev(`!document.getElementById('sh').classList.contains('hide')`)) === true;
}
ok('墟市的铺子开得起来', await openShop());
const rows = JSON.parse(await ev(`JSON.stringify([].map.call(
  document.querySelectorAll('#sh-list .goods'), function (g) {
    return { k: g.getAttribute('data-k'), t: g.textContent, owned: g.classList.contains('owned') };
  }))`));
const gearRows = rows.filter(r => /^g\d$/.test(r.k));
ok('货单上有器物', gearRows.length > 0, gearRows.map(r => r.t).join(' / '));
ok('开局时木的那把不用买',
  !rows.some(r => r.t.indexOf('木锄') >= 0 || r.t.indexOf('木瓢') >= 0));
// 这一条是看图看出来的：五种种子齐刷刷写着「得先有前一把」，
// 而那句话看上去还挺像那么回事 —— 断言只看器物那几格，全绿。
// 所以每一格都得说自己的话：要么价钱，要么**它自己那一类**的状态。
// 状态词是按类别分的：器物说「已经是这把 / 得先有前一把」，
// 营造说「已经造好了 / 得先有前一个」，机器说「已经有了 / 得先有前一个」
// —— 把几套词混成一个大正则，加了新类别那几格就会假失败，而那不是回归
const NOTE = {
  gear: /钱|已经是这把|得先有前一把/,
  build: /钱|已经造好了|得先有前一个/,
  machine: /钱|已经有了|得先有前一个/,
  // 家具（18/9 加的）。不加这一行的话那六格会掉到上面那个兜底正则上，
  // 而它们说的是「已经收拾好了 / 得先有前一个」—— 判据当场红，
  // 症状看着像「家具那几格在面板上没写价钱」
  furn: /钱|已经收拾好了|得先有前一个/,
  // 歇脚处的路（19/9 加的）。同一个坑，又踩了一次 ——
  // 教训是：加了新 kind 就**立刻**回来加这一行，别等别的套件照出来
  road: /钱|路已经通好了|得先有前一个/
};
const kindOf = await ev(`(function(){
  var L=FG.SHOP.xushi, g={}, i;
  for(i=0;i<L.length;i++) g[L[i].k]=L[i].kind;
  return JSON.stringify(g);
})()`);
const shopKind = JSON.parse(kindOf);
ok('每一格都写得出自己的价钱或状态', rows.every(r => /钱/.test(r.t) || (NOTE[shopKind[r.k]] || /钱|已经是这把|得先有前一把/).test(r.t)),
  rows.map(r => r.t.replace(/\s+/g, ' ').slice(0, 24)).join(' | '));
// 按类别各守各的：光看「有一句话」不够，得是**这一类该有的那句**
const buildRows = rows.filter(r => shopKind[r.k] === 'build');
ok('营造那几格用的是营造自己的状态词', buildRows.length > 0 &&
  buildRows.every(r => /钱|已经造好了|得先有前一个/.test(r.t)),
  buildRows.map(r => r.t.replace(/\s+/g, ' ').slice(0, 28)).join(' | '));
ok('营造没被当成器物（不会出现「得先有前一把」）', buildRows.every(r => r.t.indexOf('得先有前一把') < 0),
  buildRows.map(r => r.k).join(' '));
// 家具（18/9 加的）守自己那一套：说「已经收拾好了 / 得先有前一个」，
// 而且**不能**混进营造或器物的话
const furnRows = rows.filter(r => shopKind[r.k] === 'furn');
ok('家具那几格用的是家具自己的状态词', furnRows.length > 0 &&
  furnRows.every(r => /钱|已经收拾好了|得先有前一个/.test(r.t)),
  furnRows.map(r => r.t.replace(/\s+/g, ' ').slice(0, 28)).join(' | '));
ok('家具没被当成器物或营造', furnRows.every(r =>
  r.t.indexOf('得先有前一把') < 0 && r.t.indexOf('已经造好了') < 0),
  furnRows.map(r => r.k).join(' '));
// 歇脚处的路（19/9 加的）守自己那一套
const roadRows = rows.filter(r => shopKind[r.k] === 'road');
ok('路那几格用的是路自己的状态词', roadRows.length > 0 &&
  roadRows.every(r => /钱|路已经通好了|得先有前一个/.test(r.t)),
  roadRows.map(r => r.t.replace(/\s+/g, ' ').slice(0, 28)).join(' | '));
ok('路没被当成器物、营造或家具', roadRows.every(r =>
  r.t.indexOf('得先有前一把') < 0 && r.t.indexOf('已经造好了') < 0
  && r.t.indexOf('已经收拾好了') < 0),
  roadRows.map(r => r.k).join(' '));
ok('种子那一支都还挂着价钱', rows.filter(r => r.k.indexOf('seed') === 0)
  .every(r => /钱/.test(r.t)),
  rows.filter(r => r.k.indexOf('seed') === 0).map(r => r.t.replace(/\s+/g, ' ')).join(' | '));
ok('种子没被当成「够不着」', rows.filter(r => r.k.indexOf('seed') === 0)
  .every(r => r.t.indexOf('得先有前一把') < 0 && !r.owned));

await ev(`(function(){ FG.state.gear.chu=0; FG.state.gear.piao=0; FG.state.gold=99999; FG.updateHUD(); return 1; })()`);
await ev(`document.getElementById('sh-x').click()`);
await sleep(250);
ok('重画之后铺子还开得起来', await openShop());
const gearKey = (g, lv) => ev(`(function(){
  var L=FG.SHOP.xushi, i;
  for (i=0;i<L.length;i++) if (L[i].kind==='gear' && L[i].gear==='${g}' && L[i].lv===${lv}) return L[i].k;
  return null; })()`);
const skipSel = '#sh-list .goods[data-k="' + (await gearKey('chu', 2)) + '"]';
ok('铁锄那一格在面板上', (await ev(`!!document.querySelector(${JSON.stringify(skipSel)})`)) === true);
ok('还买不到（得先有铜锄）', (await ev(`document.querySelector(${JSON.stringify(skipSel)}).textContent`)).indexOf('得先有前一把') >= 0,
  await ev(`document.querySelector(${JSON.stringify(skipSel)}).textContent`));
await ev(`document.querySelector(${JSON.stringify(skipSel)}).click()`);
await sleep(300);
ok('点了也升不了级', (await gearChu()) === 0, 'chu=' + (await gearChu()));
ok('钱也没被扣', (await gold()) === 99999, 'gold=' + (await gold()));
await shot('70-墟市器物.png');

const cuSel = '#sh-list .goods[data-k="' + (await gearKey('chu', 1)) + '"]';
const cuPrice = GEAR.chu[0].price;
ok('铜锄写得出来价钱', (await ev(`document.querySelector(${JSON.stringify(cuSel)}).textContent`)).indexOf(String(cuPrice)) >= 0,
  await ev(`document.querySelector(${JSON.stringify(cuSel)}).textContent`));
const gBefore = await gold();
await ev(`document.querySelector(${JSON.stringify(cuSel)}).click()`);
await sleep(350);
ok('买下铜锄', (await gearChu()) === 1, 'chu=' + (await gearChu()));
ok('钱正好少了标价', (await gold()) === gBefore - cuPrice, gBefore + ' - ' + cuPrice + ' = ' + (await gold()));
ok('买完器物架上是铜锄', (await trayName('chu')) === GEAR.chu[0].name, await trayName('chu'));
ok('买完自动切到这件器物', (await sel()) === 'chu', 'sel=' + (await sel()));
ok('买完铁锄那一格解锁了', (await ev(`document.querySelector(${JSON.stringify(skipSel)}).textContent`)).indexOf('得先有前一把') < 0,
  await ev(`document.querySelector(${JSON.stringify(skipSel)}).textContent`));
ok('这一段没有异常', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 存档往返 —');
await ev(`document.getElementById('sh-x').click()`);
await sleep(200);
await ev(`FG.saveGame()`);
await sleep(300);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1000);
// 范围要在**有田的图上**量。读档停在墟市，而墟市 F.on 为假，
// gearCells 会直接返回空数组 —— 于是「读档后范围没了」和「读档后没田了」
// 长得一模一样，两条都绿，毛病就过去了
ok('读档后铜锄还在', (await ev(`FG.gearOf('chu').name`)) === GEAR.chu[0].name, await ev(`FG.gearOf('chu').name`));
ok('读档后钱还是那么多', (await gold()) === gBefore - cuPrice, 'gold=' + (await gold()));
await ev(`(function(){ FG.gotoMap('nanshan', FG.MAPS.nanshan.spawn); return 1; })()`);
await sleep(600);
ok('回到南山，范围跟着回来了', (await ev(`(FG.gearCells('chu',2,2)||[]).length`)) === GEAR.chu[0].h,
  (await ev(`(FG.gearCells('chu',2,2)||[]).length`)) + ' 格');
ok('读档之后铜锄真的翻三畦', await (async () => {
  await reset();
  await setSel('chu');
  await clickCell(2, 2);
  return (await tilledCount()) === GEAR.chu[0].h;
})(), '翻了 ' + (await tilledCount()) + ' 畦');

console.log('— 重开归零 —');
await ev(`FG.restart()`);
await sleep(800);
ok('重开后回到木锄', (await ev(`FG.gearOf('chu').name`)) === G0.chu.name, await ev(`FG.gearOf('chu').name`));
ok('重开后范围回到 1×1', (await ev(`FG.gearOf('chu').w`)) === 1 && (await ev(`FG.gearOf('chu').h`)) === 1);
ok('重开后等级是 0', (await gearChu()) === 0, 'chu=' + (await gearChu()));
ok('重开第一天照样翻得动地', await (async () => {
  await reset();
  await setSel('chu');
  await clickCell(2, 2);
  return (await tilledCount()) === 1;
})(), '翻了 ' + (await tilledCount()) + ' 畦');

console.log('— 器物架在墟市上也不留旧名字 —');
// 墟市没有田，器物架是藏着的。但藏起来不等于可以留着旧文本：
// 它一露出来就得是对的
await ev(`(function(){ FG.gotoMap('xushi', FG.MAPS.xushi.spawn); return 1; })()`);
await sleep(500);
ok('在墟市时架子是藏着的',
  (await ev(`document.getElementById('tray').style.display`)) === 'none',
  await ev(`document.getElementById('tray').style.display`));
await setGear('chu', 2);
ok('但名字已经跟着换了', (await trayName('chu')) === GEAR.chu[1].name, await trayName('chu'));
await ev(`(function(){ FG.gotoMap('nanshan', FG.MAPS.nanshan.spawn); return 1; })()`);
await sleep(600);
ok('回到南山也是这把', (await trayName('chu')) === GEAR.chu[1].name, await trayName('chu'));

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? 'FAILED ' + fails : 'DONE');
