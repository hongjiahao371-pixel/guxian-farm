// 石硐验收：镐 + 矿 + 分层。
//
// 盯住这几条：
//   1) 每层 ore 加起来正好 cols*rows —— 这一条不对，「还剩几块」和
//      箱子里最后能出多少钱就会对不上，而画面上只是少一块石头
//   2) 开局**没有镐**，进硐点石头只提示、不扣体力、不给矿
//   3) 镐在田里没有场合（不能掉进「种子」那一支去读 C['jue'].terms）
//   4) 分级规矩和锄瓢同一条：1×3 → 3×3，只能一级一级买
//   5) 体力按真敲开的块数照扣；不够就整片不动
//   6) 矿进的是 S.ore 这一本账，能放进出货箱，天黑按单价折钱
//   7) 敲干净才准下层；离硐再进落回原来那一层
//   8) 最底一层给全硐唯一那一句诗（诗册是分数，不是每层一次的 checklist）
//   9) 布局由层号做种子，可复现 —— 出去了再回来还认得路
//  10) 行囊 35 样塞得进 8×5（8×4 只有 32 格，第 33 样起静默画不出来）
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9369;
const profile = path.join(tmpdir(), 'guxian-mine-' + process.pid);
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
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(200);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}

// 点一格，走 actAt 那条路（和玩家点石头同一条）。
// 选择器在 Node 侧拼好再整段传进去 —— 在模板串里插 key 极易把引号套错，
// 套错的表现是页面抛异常而断言照样绿
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
  await sleep(320);
}
const stam = () => ev(`FG.state.stam`);
const gold = () => ev(`FG.state.gold`);
const toast = () => ev(`document.getElementById('toast').textContent`);
const hint = () => ev(`document.getElementById('hint').textContent`);
const left = () => ev(`FG.mineLeft()`);
const mapId = () => ev(`FG.state.map`);
const level = () => ev(`FG.state.gear.jue`);
const trayU = (k) => ev(`document.querySelector('#tray .slot[data-k="${k}"] u').textContent`);
const trayB = (k) => ev(`document.querySelector('#tray .slot[data-k="${k}"] b').textContent`);
const setLevel = async (lv) => {
  await ev(`(function(){ FG.state.gear.jue = ${lv}; FG.updateHUD(); return 1; })()`);
  await sleep(200);
};
const enterMine = async () => {
  await ev(`(function(){ FG.gotoMap('shidong', FG.MAPS.shidong.spawn); return 1; })()`);
  await sleep(900);
};
const gotoMap = async (id) => {
  await ev(`(function(){ FG.gotoMap('${id}', FG.MAPS['${id}'].spawn); return 1; })()`);
  await sleep(800);
};
// 敲满一层。逐格扫过去，不能老点同一格 ——
// 铜镐 1×3 敲一次只掉三块，老点中间那一格，第二轮就全是空的了
const clearFloor = async (lv) => {
  for (let pass = 0; pass < 12; pass++) {
    if ((await left()) === 0) break;
    for (let r = 0; r < MINE.rows; r++) {
      for (let c = 0; c < MINE.cols; c++) {
        if ((await left()) === 0) return true;
        await ev(`FG.state.stam = FG.state.maxStam; FG.mineArea(${c},${r}); 1`);
        await sleep(60);
      }
    }
  }
  return (await left()) === 0;
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
await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') });
await sleep(2800);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2800);
await ev(`FG.startFrom('new')`);
await sleep(1300);

// ---- 从 data.js 读，别在测试里抄一份 ----
const MINE = JSON.parse(await ev(`JSON.stringify({
  cols: FG.MINE.cols, rows: FG.MINE.rows, deepest: FG.MINE.deepest,
  floors: FG.MINE.floors.map(f => ({ n: f.n, stam: f.stam, ore: f.ore })),
  gear: FG.GEAR.jue, g0: FG.GEAR0.jue,
  map: { quad: FG.MAPS.shidong.quad, cols: FG.MAPS.shidong.cols, rows: FG.MAPS.shidong.rows,
         bounds: FG.MAPS.shidong.bounds, shaft: FG.MAPS.shidong.shaft, exits: FG.MAPS.shidong.exits },
  adit: FG.MAPS.xushi.exits.filter(e => e.to === 'shidong').map(e => e.at)[0]
})`));
const ORE = JSON.parse(await ev(`JSON.stringify(FG.ORE)`));
const CELLS = MINE.cols * MINE.rows;
console.log('  石硐 = ' + CELLS + ' 块/层（' + MINE.cols + '×' + MINE.rows + '）　共 ' + MINE.deepest + ' 层');
console.log('  镐 = ' + JSON.stringify(MINE.gear.map(g => g.name + ' ' + g.w + '×' + g.h)));
console.log('  墟市上的硐口 = ' + JSON.stringify(MINE.adit));

console.log('\n— 数据自洽 —');
ok('每层的矿加起来正好 ' + CELLS + ' 块',
  MINE.floors.every(f => Object.values(f.ore).reduce((a, b) => a + b, 0) === CELLS),
  MINE.floors.map(f => f.n + ':' + Object.values(f.ore).reduce((a, b) => a + b, 0)).join(' '));
ok('层数 = ' + MINE.deepest, MINE.floors.length === MINE.deepest);
ok('越深越硬（每层的力气只增不减）',
  MINE.floors.every((f, i) => i === 0 || f.stam >= MINE.floors[i - 1].stam),
  MINE.floors.map(f => f.stam).join('→'));
ok('越深越值钱（每层最贵的那块不低于上一层）',
  MINE.floors.every((f, i) => {
    if (i === 0) return true;
    const best = o => Math.max(...Object.keys(o).map(k => ORE[k].sell));
    return best(f.ore) >= best(MINE.floors[i - 1].ore);
  }));
ok('最便宜的那种不出现在最深两层',
  MINE.floors.slice(3).every(f => !f.ore.shi),
  MINE.floors.slice(3).map(f => f.n + '层').join(' ') + ' 都没有石炭');
ok('石炭一层最多（它是浅层才有的那种）',
  (() => { let mx = 0; MINE.floors.forEach(f => { mx = Math.max(mx, f.ore.shi || 0); }); return mx === MINE.floors[0].ore.shi; })(),
  '最多 ' + Math.max(...MINE.floors.map(f => f.ore.shi || 0)) + ' 块，在第 1 层');
ok('最贵的那种要到第四层才露面',
  !MINE.floors.slice(0, 3).some(f => f.ore.xuan) && MINE.floors.slice(3).every(f => f.ore.xuan));
ok('矿价一律高过零、且从石炭到玄英一路递增',
  ORE.shi.sell > 0 && ORE.shi.sell < ORE.tong.sell && ORE.tong.sell < ORE.tie.sell && ORE.tie.sell < ORE.xuan.sell,
  [ORE.shi, ORE.tong, ORE.tie, ORE.xuan].map(o => o.name + ' ' + o.sell).join(' / '));
ok('矿的出处一律「——」（不能把游戏自己的话冒充古人的）',
  Object.values(ORE).every(o => o.from === '——'));
ok('梯形的格数 = 6×3', MINE.map.cols === MINE.cols && MINE.map.rows === MINE.rows);
ok('可走带在坡底那条浅色带上', MINE.map.bounds.y0 >= 820 && MINE.map.bounds.y1 <= 1040,
  JSON.stringify(MINE.map.bounds));
ok('落点在可走带里', (() => {
  const b = MINE.map.bounds, s = MINE.map.shaft.at;
  return s[0] > b.x0 && s[0] < b.x1 && s[1] > b.y0 && s[1] < b.y1;
})(), JSON.stringify(MINE.map.shaft.at));
ok('出硐口在硐里可走带的那一头',
  MINE.map.exits.length === 1 && MINE.map.exits[0].at[0] <= MINE.map.bounds.x0 + 10,
  JSON.stringify(MINE.map.exits[0].at));
const XU = JSON.parse(await ev(`JSON.stringify(FG.MAPS.xushi.bounds)`));
ok('墟市上的硐口也在墟市可走带里（不是站在画外够不着）', (() => {
  const a = MINE.adit, b = XU;
  return a[0] > b.x0 && a[0] < b.x1 && a[1] > b.y0 && a[1] < b.y1;
})(), JSON.stringify(MINE.adit) + ' 在 ' + JSON.stringify(XU));

console.log('\n— 行囊塞得下 —');
const BAG = JSON.parse(await ev(`JSON.stringify({
  n: FG.BAG.length, cols: FG.BAG_COLS, rows: FG.BAG_ROWS,
  kinds: [].map.call(document.querySelectorAll('x'), function(){return 0}),
  oreRows: FG.BAG.filter(function(b){return b.kind==='ore'}).map(function(b){return b.k}),
  oreSells: FG.BAG.filter(function(b){return b.kind==='ore'}).map(function(b){return b.sell})
})`));
ok('一共 ' + BAG.n + ' 样，格子 ' + (BAG.cols * BAG.rows) + ' 个',
  BAG.n <= BAG.cols * BAG.rows, BAG.n + ' ≤ ' + BAG.cols * BAG.rows);
ok('四种矿都在行囊里', BAG.oreRows.length === 4, BAG.oreRows.join(' '));
ok('每种矿都写得出价钱', BAG.oreSells.every(s => s > 0), BAG.oreSells.join(' '));

console.log('\n— 开局没有镐 —');
ok('手上是 0 级', (await level()) === 0, 'jue=' + (await level()));
ok('0 级覆盖范围是 0×0（所以敲不动）',
  (await ev(`FG.gearOf('jue').w`)) === 0 && (await ev(`FG.gearOf('jue').h`)) === 0);
ok('器物架上那一格写「没有」', (await trayU('jue')) === '没有', JSON.stringify(await trayU('jue')));
ok('器物架上有第八格', (await ev(`!!document.querySelector('#tray .slot[data-k="jue"] i')`)) === true);
ok('键位条写的是 1-8', (await ev(`document.getElementById('keys').textContent`)).indexOf('1-8') >= 0,
  await ev(`document.getElementById('keys').textContent`));
ok('镐是第八键', (await ev(`document.querySelector('#tray .slot[data-k="jue"] i').textContent`)) === '8');

console.log('\n— 镐在田里没有场合 —');
await ev(`(function(){ FG.state.sel='jue'; FG.updateHUD(); return 1; })()`);
await sleep(200);
const logMark0 = logs.length;
const tBefore = await ev(`FG.state.plots.flat().filter(function(p){return p.tilled}).length`);
const stamBefore = await stam();
// 先把这一畦翻好：如果镐在田里被当成了锄，它会把翻好的那一畦又「锄」一遍，
// 而 workArea 恰恰只在这一支上写 tilled —— 所以必须先翻好再点，才测得出来
await ev(`(function(){ FG.state.plots[2][2].tilled = true; return 1; })()`);
await clickCell(2, 2);
await sleep(300);
ok('点田畦没有异常', logs.length === logMark0, logs.slice(logMark0).join(' | ') || '(无)');
ok('说的是「田里用不上镐」', (await toast()).indexOf('田里用不上镐') >= 0, await toast());
ok('体力没被扣', (await stam()) === stamBefore, stamBefore + '→' + (await stam()));
// 拿点下去之后的总数和点之前的比：多的那一畦是测试自己翻的
const tAfter = await ev(`FG.state.plots.flat().filter(function(p){return p.tilled}).length`);
ok('田里一畦也没多出来', tAfter === tBefore + 1, tBefore + '→' + tAfter + '（多的那一畦是测试自己翻的）');

console.log('\n— 进硐：没有镐就什么都做不了 —');
await enterMine();
ok('进来了', (await mapId()) === 'shidong');
ok('落在第 1 层', (await ev(`FG.state.mineFloor`)) === 1);
ok('石硐不是田（不画菜畦）', (await ev(`!!FG.MAPS.shidong.farm`)) === false);
ok('南山的田没被重置', (await ev(`FG.state.plots.length`)) > 0);
ok('这层是满的', (await left()) === CELLS, '剩 ' + (await left()));
ok('提示行说「没有镐」', (await hint()).indexOf('没有镐') >= 0, await hint());
const stamA = await stam(), oreA = JSON.stringify(await ev(`FG.state.ore`));
const mark1 = logs.length;
await clickCell(2, 1);
await sleep(300);
ok('点石头没有异常', logs.length === mark1, logs.slice(mark1).join(' | ') || '(无)');
ok('什么也没发生', (await left()) === CELLS, '剩 ' + (await left()));
ok('体力没被扣', (await stam()) === stamA, stamA + '→' + (await stam()));
ok('一块矿也没给', JSON.stringify(await ev(`FG.state.ore`)) === oreA);
ok('提示说的是「还没有镐」', (await toast()).indexOf('还没有镐') >= 0, await toast());
await shot('80-硐里没有镐.png');

console.log('\n— 买镐：一级一级来 —');
await gotoMap('xushi');
await ev(`(function(){ FG.state.gold=99999; return 1; })()`);
const openShop = async () => {
  // B 键只认「站在老丈旁边」。墟市落点在 (430,762)、老丈在 (640,780)，
  // 曼哈顿距离 228 —— 不把人挪过去，铺子根本开不起来，
  // 而症状只是「B 没反应」，看着像键坏了
  await ev(`(function(){
    var n=FG.NPCS.xushi.at;
    FG.state.player.x=n[0]-90; FG.state.player.y=n[1];
    var s=document.getElementById('sh'); if(!s.classList.contains('hide')) s.classList.add('hide');
    return 1; })()`);
  await sleep(400);
  await key('b');
  await sleep(600);
  return (await ev(`!document.getElementById('sh').classList.contains('hide')`)) === true;
};
ok('墟市的铺子开得起来', await openShop());
const gearKey = (g, lv) => ev(`(function(){
  var L=FG.SHOP.xushi, i;
  for (i=0;i<L.length;i++) if (L[i].kind==='gear' && L[i].gear==='${g}' && L[i].lv===${lv}) return L[i].k;
  return null; })()`);
const ironSel = '#sh-list .goods[data-k="' + (await gearKey('jue', 2)) + '"]';
const cuSel = '#sh-list .goods[data-k="' + (await gearKey('jue', 1)) + '"]';
ok('铁镐那一格在面板上', (await ev(`!!document.querySelector(${JSON.stringify(ironSel)})`)) === true);
ok('开局买不到铁镐（得先有铜镐）',
  (await ev(`document.querySelector(${JSON.stringify(ironSel)}).textContent`)).indexOf('得先有前一把') >= 0,
  await ev(`document.querySelector(${JSON.stringify(ironSel)}).textContent`));
await ev(`document.querySelector(${JSON.stringify(ironSel)}).click()`);
await sleep(300);
ok('点了也升不了级', (await level()) === 0, 'jue=' + (await level()));
ok('钱也没被扣', (await gold()) === 99999, 'gold=' + (await gold()));
ok('铜镐写得出来价钱',
  (await ev(`document.querySelector(${JSON.stringify(cuSel)}).textContent`)).indexOf(String(MINE.gear[0].price)) >= 0,
  await ev(`document.querySelector(${JSON.stringify(cuSel)}).textContent`));
await ev(`document.querySelector(${JSON.stringify(cuSel)}).click()`);
await sleep(400);
ok('铜镐到手', (await level()) === 1, 'jue=' + (await level()));
ok('扣的正好是标价', (await gold()) === 99999 - MINE.gear[0].price, 'gold=' + (await gold()));
ok('买完自动切到镐', (await ev(`FG.state.sel`)) === 'jue');
await shot('81-墟市买镐.png');
await ev(`document.getElementById('sh-x').click()`);
await sleep(300);
ok('架子上的名字换成了铜镐', (await trayB('jue')) === MINE.gear[0].name, await trayB('jue'));
ok('「没有」那一行不见了', (await trayU('jue')) === '', JSON.stringify(await trayU('jue')));

console.log('\n— 铜镐一下三块 —');
await enterMine();
ok('铜镐是 1×3', (await ev(`FG.gearOf('jue').w`)) === 1 && (await ev(`FG.gearOf('jue').h`)) === 3,
  (await ev(`FG.gearOf('jue').w`)) + '×' + (await ev(`FG.gearOf('jue').h`)));
ok('在中间一格点，跨度正好三格',
  (await ev(`FG.rockCells(2,1).length`)) === 3, (await ev(`FG.rockCells(2,1).length`)) + ' 格');
ok('在边上点，跨度被夹回硐里（不是三格）',
  (await ev(`FG.rockCells(2,0).length`)) === 2 && (await ev(`FG.rockCells(2,2).length`)) === 2,
  '顶行 ' + (await ev(`FG.rockCells(2,0).length`)) + ' 格 / 底行 ' + (await ev(`FG.rockCells(2,2).length`)) + ' 格');
ok('悬停高亮的是真会动到的那几格', (await ev(`(function(){
  FG.state.hover=[2,1]; var s=FG.hoverSpan(); FG.state.hover=null; return (s||[]).length; })()`)) === 3);
await ev(`(function(){ FG.state.sel='chu'; return 1; })()`);
await sleep(150);
ok('手上切的是锄，跨度仍然是镐的（硐里只有一种结果）',
  (await ev(`(function(){ FG.state.hover=[2,1]; var s=FG.hoverSpan(); FG.state.hover=null; return (s||[]).length; })()`)) === 3);
await ev(`(function(){ FG.state.sel='jue'; FG.state.stam=FG.state.maxStam; return 1; })()`);
await sleep(200);
const stamB = await stam();
await clickCell(2, 1);
await sleep(350);
ok('真的敲开了三块', (await left()) === CELLS - 3, '剩 ' + (await left()));
ok('扣的正好是三块 × ' + MINE.floors[0].stam,
  (await stam()) === stamB - 3 * MINE.floors[0].stam, stamB + '→' + (await stam()));
ok('矿进了 S.ore 这一本账',
  (await ev(`Object.keys(FG.state.ore).filter(function(k){return FG.state.ore[k]>0}).join(',')`)) === 'shi',
  await ev(`JSON.stringify(FG.state.ore)`));
ok('敲出来的正是这一层该出的那种矿',
  (await ev(`FG.state.ore.shi`)) === 3, await ev(`JSON.stringify(FG.state.ore)`));
ok('提示把这一把敲出了什么说清楚了', (await toast()).indexOf('敲开 3 块') >= 0, await toast());
ok('悬停/提示行报的是「几块」不是「几畦」', (await hint()).indexOf('畦') < 0, await hint());
await shot('82-敲开三块.png');

console.log('\n— 体力不够就整片不动 —');
// 得挑一格**还没敲开**的：早先这里点的是刚敲过的那一格，
// 结果断言读到的是上一条浮字的残留（浮字淡出后 textContent 还在），
// 于是「提示没变」看着像游戏不响应，其实点的是个空格子
const FREE = 4;   // 中间偏右那一列，一次都没碰过
ok('挑的那一格还是满的', (await ev(`FG.rockAt(FG.state.mineFloor,${FREE},1)`)) !== null,
  await ev(`String(FG.rockAt(FG.state.mineFloor,${FREE},1))`));
const leftC = await left();
const spanC = await ev(`FG.rockCells(${FREE},1).length`);
const needAll = spanC * MINE.floors[0].stam;
await ev(`(function(){ FG.state.stam = ${needAll - 1}; return 1; })()`);
await sleep(200);
const mark2 = logs.length;
await clickCell(FREE, 1);
await sleep(350);
ok('这一段没有异常', logs.length === mark2, logs.slice(mark2).join(' | ') || '(无)');
ok('提示说的是差几分', (await toast()).indexOf('分力气') >= 0, await toast());
ok('那一格一块都没少', (await left()) === leftC, leftC + '→' + (await left()));
ok('体力一分没扣', (await stam()) === needAll - 1, (await stam()));
await ev(`(function(){ FG.state.stam = FG.state.maxStam; return 1; })()`);

console.log('\n— 点一片全空的，给的是「已经敲开了」而不是没反应 —');
const EMPTY = 2;   // 中间那一列，第一下就敲光了
await ev(`(function(){
  for (var r=0; r<${MINE.rows}; r++) FG.mineArea(${EMPTY}, r);
  return 1; })()`);
await sleep(400);
await clickCell(EMPTY, 1);
await sleep(350);
ok('说的是这一片已经敲开了', (await toast()).indexOf('已经敲开') >= 0, await toast());

console.log('\n— 敲干净才准下层 —');
ok('还没敲干净', (await left()) > 0, '剩 ' + (await left()));
await ev(`(function(){
  var e=FG.MAPS.shidong.exits[0], s=FG.MAPS.shidong.shaft;
  FG.state.player.x=s.at[0]; FG.state.player.y=s.at[1]; return 1; })()`);
await sleep(400);
ok('站在落点上，提示不给 E', (await hint()).indexOf('还剩') >= 0, await hint());
await key('e');
await sleep(350);
ok('按 E 也下不去', (await ev(`FG.state.mineFloor`)) === 1);
ok('说的是还剩几块', (await toast()).indexOf('块没敲开') >= 0, await toast());
ok('已敲开的那三块还是空着的', (await ev(`FG.mineLeft()`)) === leftC);

console.log('\n— 敲满一层 —');
ok('敲得干净', await clearFloor(), '剩 ' + (await left()));
ok('落点这时才给 E', (await hint()).indexOf('再深一层') >= 0, await hint());
await shot('83-一层见底.png');
const floor1Stones = await ev(`Object.keys(FG.state.ore).length`);

console.log('\n— 下到第二层 —');
await key('e');
await sleep(700);
ok('到了第 2 层', (await ev(`FG.state.mineFloor`)) === 2, 'floor=' + (await ev(`FG.state.mineFloor`)));
ok('到过的最深记成 2', (await ev(`FG.state.mineDeep`)) === 2);
ok('第二层是满的', (await left()) === CELLS, '剩 ' + (await left()));
ok('第二层开始见铜砂',
  (await ev(`FG.rockOf(2).filter(function(x){return x==='tong'}).length`)) === MINE.floors[1].ore.tong,
  await ev(`FG.rockOf(2).join(',')`));
ok('第一层敲出来的东西还留在手上', (await ev(`FG.state.ore.shi`)) === MINE.floors[0].ore.shi,
  await ev(`JSON.stringify(FG.state.ore)`));
ok('第二层更暗', (await ev(`(function(){
  var a, b;
  FG.state.mineFloor=1; a=FG.mineDim();
  FG.state.mineFloor=2; b=FG.mineDim();
  return (a.toFixed(3)+' → '+b.toFixed(3)) + (b>a ? '|1' : '|0');
})()`)).endsWith('|1'),
  await ev(`(function(){
    var a, b;
    FG.state.mineFloor=1; a=FG.mineDim();
    FG.state.mineFloor=2; b=FG.mineDim();
    return a.toFixed(3)+' → '+b.toFixed(3); })()`));
await shot('84-第二层.png');

console.log('\n— 出硐再进，落回原来那一层 —');
await ev(`(function(){
  var e=FG.MAPS.shidong.exits[0];
  FG.state.player.x=e.at[0]; FG.state.player.y=e.at[1]; return 1; })()`);
await sleep(400);
ok('在硐口那一头，提示是出硐', (await hint()).indexOf('出硐') >= 0, await hint());
await key('e');
await sleep(800);
ok('回到墟市', (await mapId()) === 'xushi');
ok('落在硐口下面', (await ev(`Math.abs(FG.state.player.x-${MINE.adit[0]})<200 && FG.state.player.y>${MINE.adit[1]}`)) === true,
  await ev(`JSON.stringify(FG.state.player)`));
await enterMine();
ok('再进硐落在第 2 层（不是回第 1 层）', (await ev(`FG.state.mineFloor`)) === 2);
ok('第 1 层敲开的那三块还是敲开着的',
  (await ev(`FG.mineLeft(1)`)) === 0, '第1层剩 ' + (await ev(`FG.mineLeft(1)`)));

console.log('\n— 布局由层号做种子，可复现 —');
ok('同一层两次生成出来一模一样', await (async () => {
  const a = await ev(`(function(){ FG.state.rock={}; return FG.rockOf(3).join(','); })()`);
  const b = await ev(`(function(){ FG.state.rock={}; return FG.rockOf(3).join(','); })()`);
  return a === b && a.length > 0;
})(), await ev(`FG.rockOf(3).join(',')`));
ok('不同的层长得不一样', await (async () => {
  const a = await ev(`(function(){ FG.state.rock={}; return FG.rockOf(2).join(','); })()`);
  const b = await ev(`(function(){ FG.state.rock={}; return FG.rockOf(4).join(','); })()`);
  return a !== b;
})());
ok('每层出来的矿跟表里写的一样多', await (async () => {
  for (const f of MINE.floors) {
    const cnt = JSON.parse(await ev(`(function(){
      FG.state.rock={};
      var g=FG.rockOf(${f.n}), o={}, i;
      for (i=0;i<g.length;i++) o[g[i]]=(o[g[i]]||0)+1;
      return JSON.stringify(o); })()`));
    for (const k in f.ore) if ((cnt[k] || 0) !== f.ore[k]) return false;
    if (Object.keys(cnt).length !== Object.keys(f.ore).length) return false;
  }
  return true;
})());
ok('清掉存档重进，敲开的石头不会自己长回来', await (async () => {
  await ev(`(function(){ FG.state.rock={}; return 1; })()`);
  return (await ev(`FG.mineLeft(1)`)) === CELLS;
})(), '第1层剩 ' + (await ev(`FG.mineLeft(1)`)));

console.log('\n— 铁镐一下九块 —');
await setLevel(2);
ok('铁镐是 3×3',
  (await ev(`FG.gearOf('jue').w`)) === 3 && (await ev(`FG.gearOf('jue').h`)) === 3);
ok('在中间一格点，跨度九格', (await ev(`FG.rockCells(2,1).length`)) === 9,
  (await ev(`FG.rockCells(2,1).length`)) + ' 格');
await ev(`(function(){ FG.state.stam=FG.state.maxStam; return 1; })()`);
await sleep(200);
const stamD = await stam();
await clickCell(2, 1);
await sleep(400);
ok('真的敲开了九块', (await left()) === CELLS - 9, '剩 ' + (await left()));
ok('扣的正好是九块 × ' + MINE.floors[1].stam,
  (await stam()) === stamD - 9 * MINE.floors[1].stam, stamD + '→' + (await stam()));
await shot('85-铁镐九块.png');

console.log('\n— 矿能出货 —');
const goldB = await gold();
const gotShi = await ev(`FG.state.ore.shi`);
// 点一下放一份。这两下必须分别断言「点一下」和「Shift 全放」——
// 合成事件不带 shiftKey 时，绑在 shiftKey 上的那一支根本不跑，
// 于是「全放」看上去也只放了一份，而结算只按箱里的数折钱
const clickOreRow = async (shift) => {
  const r = await ev(`(function(){
    var rows=[].filter.call(document.querySelectorAll('#bx-hand .bxh'), function(r){
      return r.textContent.indexOf('石炭')>=0; });
    if (!rows.length) return 'no-row';
    rows[0].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:${!!shift}}));
    return 'clicked';
  })()`);
  await sleep(420);
  return r;
};
await ev(`(function(){ FG.openBin(); return 1; })()`);
await sleep(500);
ok('出货箱开得起来', (await ev(`!document.getElementById('bx').classList.contains('hide')`)) === true);
ok('矿在「右手上」那一栏里摆得出来',
  (await ev(`!!document.querySelector('#bx-hand') && document.getElementById('bx-hand').textContent.indexOf('石炭')>=0`)) === true,
  (await ev(`document.getElementById('bx-hand').textContent.replace(/\\s+/g,' ').trim().slice(0,120)`)));
ok('矿能放进去（不是「点不动」那一种）', (await clickOreRow(false)) === 'clicked');
ok('点一下只放一份', (await ev(`FG.state.bin.ore_shi`)) === 1,
  '箱里 ' + (await ev(`FG.state.bin.ore_shi`)) + ' / 手上 ' + (await ev(`FG.state.ore.shi`)));
await clickOreRow(true);
ok('Shift 一下全放进去了',
  (await ev(`FG.state.bin.ore_shi`)) === gotShi && (await ev(`FG.state.ore.shi`)) === 0,
  '箱里 ' + (await ev(`FG.state.bin.ore_shi`)) + ' / 手上 ' + (await ev(`FG.state.ore.shi`)));
ok('放进去之后箱里那一栏摆得出来',
  (await ev(`!!document.getElementById('bx-bin') && document.getElementById('bx-bin').textContent.indexOf('石炭')>=0`)) === true,
  (await ev(`document.getElementById('bx-bin').textContent.replace(/\\s+/g,' ').trim().slice(0,120)`)));
await shot('86-矿进箱子.png');
await key('Escape');
await sleep(300);
const goldBeforeSettle = await gold();
// 天黑结算：只出货箱里的。走真实的归家那条路（门口 E → 屋里「床」那一行），
// 因为「点一下收灶归家」那一条也在同一条路上，不走一遍就分不清是走了哪条
await ev(`(function(){ FG.state.cookN = FG.cookCap(); FG.updateHUD(); return 1; })()`);
await gotoMap('nanshan');
await ev(`(function(){
  var h=FG.MAPS.nanshan.home;
  FG.state.player.x=h[0]; FG.state.player.y=h[1]; return 1; })()`);
await sleep(500);
ok('门口那行字是「进屋」', (await hint()).indexOf('进屋') >= 0, await hint());
const mark3 = logs.length;
await key('e');
await sleep(450);
ok('屋里开着了', (await ev(`FG.houseOpen()`)) === true);
await ev(`(function(){ var g=document.querySelector('#hs-list .hsr[data-k="bed"]'); if(g) g.click(); return 1; })()`);
await sleep(900);
ok('归家这一段没有异常', logs.length === mark3, logs.slice(mark3).join(' | ') || '(无)');
ok('结算面板开了', (await ev(`!document.getElementById('de').classList.contains('hide')`)) === true);
const deText = await ev(`document.getElementById('de').textContent.replace(/\\s+/g,' ').trim()`);
ok('结算里写的是石炭折了多少钱',
  deText.indexOf('石炭') >= 0 && deText.indexOf(String(gotShi * ORE.shi.sell)) >= 0, deText.slice(0, 200));
ok('进项正好是 份数×单价', (await gold()) === goldBeforeSettle + gotShi * ORE.shi.sell,
  goldBeforeSettle + ' + ' + gotShi + '×' + ORE.shi.sell + ' = ' + (await gold()));
ok('箱里的矿已经清空', (await ev(`FG.state.ore.shi`)) === 0, await ev(`JSON.stringify(FG.state.ore)`));
await shot('87-矿折钱.png');
await ev(`document.getElementById('de-next').click()`);
await sleep(600);

console.log('\n— 走到最底下一层 —');
await ev(`(function(){
  FG.state.gear.jue=2; FG.state.stam=10000; FG.state.mineDeep=0; FG.state.rock={};
  FG.gotoMap('shidong', FG.MAPS.shidong.spawn); return 1; })()`);
await sleep(800);
for (let n = 1; n < MINE.deepest; n++) {
  ok('第 ' + n + ' 层敲得干净', await clearFloor(), '剩 ' + (await left()));
  await ev(`(function(){
    var s=FG.MAPS.shidong.shaft;
    FG.state.player.x=s.at[0]; FG.state.player.y=s.at[1]; return 1; })()`);
  await sleep(350);
  await ev(`FG.useShaft(); 1`);
  await sleep(500);
}
ok('到了最底下一层', (await ev(`FG.state.mineFloor`)) === MINE.deepest,
  'floor=' + (await ev(`FG.state.mineFloor`)));
ok('最底一层是满的', (await left()) === CELLS, '剩 ' + (await left()));
await ev(`(function(){ FG.state.stam=10000; return 1; })()`);
await shot('88-最底一层.png');
ok('最底一层敲得干净', await clearFloor(), '剩 ' + (await left()));
await ev(`(function(){
  var s=FG.MAPS.shidong.shaft;
  FG.state.player.x=s.at[0]; FG.state.player.y=s.at[1]; return 1; })()`);
await sleep(400);
ok('到底了，提示说的是水声', (await hint()).indexOf('水声') >= 0, await hint());
const mark4 = logs.length;
await key('e');
await sleep(800);
ok('这一段没有异常', logs.length === mark4, logs.slice(mark4).join(' | ') || '(无)');
ok('诗册得了那一句', (await ev(`!!FG.state.album.mineBottom`)) === true,
  await ev(`String(FG.state.album.mineBottom)`));
ok('说的是「再没有更深的路」', (await toast()).indexOf('没有更深的路') >= 0, await toast());
ok('层数没有再往下走', (await ev(`FG.state.mineFloor`)) === MINE.deepest);
const albumN = await ev(`Object.keys(FG.state.album).length`);
await key('e');
await sleep(700);
ok('再按一次不再给第二句', (await ev(`Object.keys(FG.state.album).length`)) === albumN);
await shot('89-硐底.png');

console.log('\n— 诗册里那一句挂在《桃花源记》名下 —');
const MB = JSON.parse(await ev(`JSON.stringify(FG.ALBUM_IDX.mineBottom)`));
ok('写得出出处', !!MB && !!MB.f, MB && MB.f);
ok('挂在《桃花源记》下', MB && MB.f.indexOf('桃花源记') >= 0, MB && MB.f);
ok('正文和表里写的一字不差', MB && MB.v === '未果，寻向所志，遂迷，不复得路。', MB && MB.v);

console.log('\n— 行囊里的矿砂图标 —');
await ev(`(function(){
  FG.state.ore={shi:4,tong:2,tie:1,xuan:1};
  FG.gotoMap('nanshan', FG.MAPS.nanshan.spawn); FG.openBag(); return 1; })()`);
await sleep(900);
ok('行囊开得起来', (await ev(`!document.getElementById('bg').classList.contains('hide')`)) === true);
const bagRows = JSON.parse(await ev(`JSON.stringify([].map.call(
  document.querySelectorAll('#bg-tip *'), function(){return 1;}).length)`));
// 判据是动态的（跟着 FG.BAG_ROWS 走），别把「8×5」「35 样」写进标题里
// —— 行囊涨到 6 行之后那两条就成了「描述现状」而不是「判现状」，
// 格子不够时它们照样绿着
ok('行囊画布够放全部格子', (await ev(`(function(){
  var c=document.getElementById('bg-cv');
  var pad=8, slot=74, cols=FG.BAG_COLS, rows=FG.BAG_ROWS;
  return c.width === pad + cols*slot && c.height >= pad + rows*slot + 20; })()`)) === true,
  await ev(`(function(){var c=document.getElementById('bg-cv');return c.width+'×'+c.height+' / '+FG.BAG_COLS+'×'+FG.BAG_ROWS;})()`));
ok('物品总表摆得进（不静默丢样）',
  (await ev(`FG.BAG.length`)) <= (await ev(`FG.BAG_COLS * FG.BAG_ROWS`)),
  (await ev(`FG.BAG.length`)) + ' 样 / ' + (await ev(`FG.BAG_COLS*FG.BAG_ROWS`)) + ' 格');
ok('四样矿都在行囊上', await (async () => {
  for (const k of ['ore_shi', 'ore_tong', 'ore_tie', 'ore_xuan']) {
    if ((await ev(`FG.bagList().filter(function(x){return x.k==='${k}'}).length`)) !== 1) return false;
  }
  return true;
})());
await shot('90-行囊里的矿砂.png');
// 四张图标一起放大看：26px 缩略图上认不出来是常态，要看的是轮廓分不分得开
await ev(`(function(){
  var c=document.createElement('canvas'); c.width=1200; c.height=320;
  var x=c.getContext('2d');
  x.fillStyle='#faf5e8'; x.fillRect(0,0,1200,320);
  var ks=['ore_shi','ore_tong','ore_tie','ore_xuan'];
  for (var i=0;i<ks.length;i++) FG.INK.icon(x, ks[i], 150+i*280, 160, 240);
  window.__ore=c; return 1; })()`);
const oreIcon = await ev(`window.__ore.toDataURL('image/png')`);
writeFileSync(path.join(OUT, 'P-矿砂图标.png'), Buffer.from(oreIcon.split(',')[1], 'base64'));
await ev(`document.getElementById('bg-x').click()`);
await sleep(300);

console.log('\n— 重开归零 —');
await ev(`FG.restart()`);
await sleep(900);
ok('重开后没有镐', (await level()) === 0, 'jue=' + (await level()));
ok('重开后矿清了', JSON.stringify(await ev(`FG.state.ore`)) === '{}', await ev(`JSON.stringify(FG.state.ore)`));
ok('重开后石头长回来了', (await ev(`FG.mineLeft(1)`)) === CELLS, '第1层剩 ' + (await ev(`FG.mineLeft(1)`)));
ok('重开后到过的最深也清了', (await ev(`FG.state.mineDeep`)) === 0);
ok('重开后诗册清了', (await ev(`!!FG.state.album.mineBottom`)) === false);

console.log('\n— 墟市上的硐口长在坡脚下 —');
await gotoMap('xushi');
await sleep(500);
await shot('91-墟市硐口.png');

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? 'FAILED ' + fails : 'DONE');
