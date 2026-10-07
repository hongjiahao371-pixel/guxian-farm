// 装修验收：茅舍这一片的三件家具（灶间 / 仓房 / 东轩）。
//
// 它们跟营造分一张表，因为**不占按 E 的判定点**：
// 灶、木箱、归家三个判定点已经挤在 homeR 210 那一个圈里，
// 再往里塞第四个 E，提示行就不知道该说哪一句。
//
// 盯住这几条：
//   1) 三样家具都在货单上、各两级、只能一级一级买
//   2) 家具**不进器物架也不占键位**（跟营造同一条）
//   3) 灶间：灶一天 1 口 → 2 口 → 3 口（真跑灶核，不只查表）
//   4) 灶上那口数**跨天归零**、读档也归零
//   5) 仓房：木箱分两页，存取照旧，两页的数加起来还是总数
//   6) 仓房二级：行囊真的多一行，画布也跟着长
//   7) 东轩：诗册多一页「墙上」，没买时那一页收起来
//   8) 三样家具互不相干：买一样不影响另两样
//   9) 存档往返 / 老档没有这本账 / 越界等级 / 重开归零
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9385;
const profile = path.join(tmpdir(), 'guxian-furn-' + process.pid);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--allow-file-access-from-files',
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
const logs = [];
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
  await sleep(160);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
const toast = () => ev(`document.getElementById('toast').textContent`);
// 清浮字。**先把奖励队列排空**，再擦屏幕上那一格 —— 这两样是两件事：
// 攒在队列里还没上屏的那几条，擦完屏幕照样会冒出来，
// 于是「按 E 弹了什么」读到的是一条跟按 E 无关的诗册浮字。
// 全量跑（机器吃紧、队列排得慢）时它正好卡在 400ms 那个窗口里钻出来：
// 单跑这一套是绿的。排空要按**条数**轮询，槽一次只走一条。
const clearToast = async () => {
  for (let i = 0; i < 40 && (await ev(`FG.rewardDepth()`)) > 0; i++) {
    await ev(`FG.flushReward()`);
    await sleep(300);
  }
  return ev(`(function(){var t=document.getElementById('toast'); t.textContent=''; t.classList.remove('on'); return 1})()`);
};
const shopOpen = () => ev(`!document.getElementById('sh').classList.contains('hide')`);
// 站到「在茅舍这一圈里、但不在木箱那一圈里」的一个点。
// 站着不动按 E 只能开一个面板：E 的顺序是「先判到的赢」，
// 木箱排在归家前面。**写死 home+40 会正好落进木箱的圈**，
// 于是 E 开的是箱子而这一节验的灶压根没被点到 ——
// 症状是「灶一天两口好像没生效」
async function standHome() {
  const p = JSON.parse(await ev(`(function(){
    var m=FG.MAPS.nanshan, h=m.home, cr=FG.nearChest;
    // 箱子中心在图上；它的判定半径从 nearChest 的返回里反推太绕，
    // 直接在 homeR 那一圈里逐点试，条件是「离箱子足够远」
    for (var dy=20; dy<=140; dy+=20) for (var dx=-160; dx<=160; dx+=20) {
      var x=h[0]+dx, y=h[1]+dy;
      if (Math.abs(x-h[0])+Math.abs(y-h[1]) > m.homeR-10) continue;
      if (x<60 || x>1860 || y<420 || y>1040) continue;
      if (Math.abs(x-368)+Math.abs(y-620) > 230) return JSON.stringify({x:x,y:y,found:1});
    }
    return JSON.stringify({found:0});})()`));
  ok('茅舍门口有一个既在归家圈里、又不在木箱圈里的落脚点', p.found === 1, p.found ? p.x + ',' + p.y : '(没找着)');
  await ev(`(function(){ FG.gotoMap('nanshan', [${p.x}, ${p.y}]); FG.state.walkTo=null; FG.updateHUD(); return 1 })()`);
  await sleep(430);
  return p;
}
// 打开墟市货单
async function openShop() {
  await ev(`(function(){
    FG.gotoMap('xushi'); var n=FG.NPCS.xushi;
    FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+40; FG.state.walkTo=null; return 1})()`);
  await sleep(430);
  await key('b');
  await sleep(420);
  return shopOpen();
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
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

console.log('— 家具表自己站得住 —');
const F = JSON.parse(await ev(`JSON.stringify(FG.FURN)`));
const FIDS = Object.keys(F);
const FLV = JSON.parse(await ev(`JSON.stringify(FG.FURN_LV)`));
console.log('  ' + FIDS.map(k => k + '(' + F[k].name + '×' + F[k].lv.length + ')').join('　'));
ok('三样家具，名字都在 FURN_LV 上，一张不多一张不少',
  JSON.stringify(FIDS) === JSON.stringify(FLV), FIDS.join(',') + ' / ' + FLV.join(','));
ok('每样都写了两级，每级有名字、价钱、说明',
  FIDS.every(k => F[k].lv.length === 2 && F[k].lv.every(l => l.name && l.price > 0 && l.desc && l.desc.length > 8)));
ok('每一级都比上一级贵',
  FIDS.every(k => F[k].lv[1].price > F[k].lv[0].price),
  FIDS.map(k => k + ' ' + F[k].lv.map(l => l.price).join('→')).join('　'));
// 分级只改数量不改场合：同一级里「给的是什么」那件事一级一级都一样，
// 而具体给多少必须一级比一级多
ok('每一级真的多给了点什么（不是只涨了价钱）',
  FIDS.every(k => {
    const g = l => Object.keys(l).filter(x => ['name', 'price', 'desc'].indexOf(x) < 0)
      .map(x => x + '=' + l[x]).join(',');
    return g(F[k].lv[0]) !== '' && g(F[k].lv[1]) !== '' && g(F[k].lv[0]) !== g(F[k].lv[1]);
  }),
  FIDS.map(k => k + ' 一级{' + Object.keys(F[k].lv[0]).filter(x => ['name', 'price', 'desc'].indexOf(x) < 0)
    .map(x => x + '=' + F[k].lv[0][x]) + '}　二级{…' + Object.keys(F[k].lv[1]).filter(x => ['name', 'price', 'desc'].indexOf(x) < 0)
    .map(x => x + '=' + F[k].lv[1][x]) + '}').join('　'));
// 家具的 id 不能跟器物架 / 行囊 / 作物 / 营造 / 机器 / 人重名
const allKeys = JSON.parse(await ev(`JSON.stringify({
  tool: FG.TOOLS.map(function (t) { return t.k; }),
  bag: Object.keys(FG.BAG_IDX), crop: Object.keys(FG.CROPS), build: Object.keys(FG.BUILD),
  mach: Object.keys(FG.MACHINE), npc: Object.keys(FG.NPCS)
})`));
const allFlat = [].concat(allKeys.tool, allKeys.bag, allKeys.crop, allKeys.build, allKeys.mach, allKeys.npc);
ok('三样家具的 id 不跟别的东西重名',
  FIDS.every(f => allFlat.indexOf(f) < 0), FIDS.map(f => f + (allFlat.indexOf(f) < 0 ? '' : ' ✗重名')).join('　'));

console.log('— 开局：一件都还没收拾 —');
ok('三样都还没买', (await ev(`(function(){var n=0;for(var i=0;i<FG.FURN_LV.length;i++)
  if (FG.state.furn[FG.FURN_LV[i]]===0) n++; return n})()`)) === FIDS.length,
  await ev(`JSON.stringify(FG.state.furn)`));
ok('没买的时候：灶一口、行囊六行、木箱一页',
  (await ev(`FG.cookCap()`)) === 1 && (await ev(`FG.BAG_ROWS`)) === F.cangfang.lv[0].bag
  && (await ev(`FG.chestTabs()`)) === 1,
  '灶 ' + await ev(`FG.cookCap()`) + ' 口 / 行囊 ' + await ev(`FG.BAG_ROWS`) + ' 行 / 木箱 ' + await ev(`FG.chestTabs()`) + ' 页');

console.log('— 货单上摆得出来 —');
await ev(`FG.state.gold = 60000`);
ok('铺子开得起来', await openShop());
const frows = JSON.parse(await ev(`(function(){
  var o=[]; FG.SHOP.xushi.forEach(function(r){ if (r.kind==='furn') o.push(r.f+':'+r.lv); });
  return JSON.stringify(o)})()`));
ok('六格家具都在货单上',
  frows.length === FIDS.length * 2 && FIDS.every(f => [1, 2].every(l => frows.indexOf(f + ':' + l) >= 0)),
  frows.join('　'));
// 二级那三格一开始都锁着
const flock = await ev(`(function(){
  var o=[]; FG.SHOP.xushi.forEach(function(r){ if (r.kind==='furn' && r.lv===2){
    var e=document.querySelector('[data-k="'+r.k+'"]'); o.push(r.f+'='+(e?e.querySelector('u').textContent:'(不在面板上)')); } });
  return o.join('　');})()`);
ok('三样家具的二级都锁着', /得先有前一个/.test(flock), flock);
await ev(`document.querySelector('[data-k="h2"]').click()`);
await sleep(350);
ok('跳过一级买不了二级', (await ev(`FG.state.furn.chufang`)) === 0, await ev(`JSON.stringify(FG.state.furn)`));
ok('钱也没被扣', (await ev(`FG.state.gold`)) === 60000);
// 家具不进器物架也不占键位 —— 跟营造同一条
const tray = JSON.parse(await ev(`JSON.stringify(FG.TOOLS.map(function(t){return t.k}))`));
ok('家具不进器物架（也不该占键位）', !FIDS.some(f => tray.indexOf(f) >= 0), tray.join(','));
ok('键位条没有跟着变', (await ev(`document.getElementById('keys').textContent.indexOf('1-8') >= 0`)) === true,
  await ev(`document.getElementById('keys').textContent`));
// 整份货单（27 格）在 900 高的窗口里还放得下
const shBox = JSON.parse(await ev(`(function(){
  var l=document.getElementById('sh-list'), s=document.getElementById('sh'), sr=s.getBoundingClientRect();
  return JSON.stringify({listH:Math.round(l.getBoundingClientRect().height), scrollH:l.scrollHeight,
    top:Math.round(sr.top), bottom:Math.round(sr.bottom), vh:innerHeight});})()`));
ok('整份货单上下都没掉出画面（' + (await ev('FG.SHOP.xushi.length')) + ' 格）',
  shBox.top >= 0 && shBox.bottom <= shBox.vh, JSON.stringify(shBox));

console.log('— 买下灶间：灶一天两口 —');
const rows0 = (await ev(`FG.BAG_ROWS`));
const gold0 = await ev(`FG.state.gold`);
await ev(`document.querySelector('[data-k="h1"]').click()`);
await sleep(400);
ok('灶间到手', (await ev(`FG.state.furn.chufang`)) === 1, await ev(`JSON.stringify(FG.state.furn)`));
ok('扣的正好是标价', (await ev(`FG.state.gold`)) === gold0 - F.chufang.lv[0].price,
  gold0 + ' -> ' + await ev(`FG.state.gold`) + '（标价 ' + F.chufang.lv[0].price + '）');
ok('那一句说清了给的是几口', /灶上一天能做 2 样/.test(await toast()), await toast());
ok('判据真的变成两口', (await ev(`FG.cookCap()`)) === 2, 'cookCap=' + await ev(`FG.cookCap()`));
ok('买灶间不动行囊和木箱', (await ev(`FG.BAG_ROWS`)) === rows0 && (await ev(`FG.chestTabs()`)) === 1);
ok('买完货单还开着', await shopOpen());
await key('Escape');
await sleep(400);
ok('Esc 关掉了货单', (await shopOpen()) === false);

console.log('— 灶：一天两口是真的能点两下 —');
// 料摆够：豆 8 束能点四次酱
await ev(`(function(){
  FG.gotoMap('nanshan'); for (var k in FG.state.bag) delete FG.state.bag[k];
  FG.state.bag.dou=8; FG.state.made=[]; FG.state.made.jiang=0; FG.state.cookN=0; FG.updateHUD(); return 1})()`);
await standHome();
await key('e');
await sleep(450);
ok('门口按 E 开的是屋里', (await ev(`FG.houseOpen()`)) === true);
// **这是家具第一次有落点**：屋里「灶」那一行写得出「几口灶」和「今天还能做几口」。
// 买下灶间之前它是「廊下一口」，买下之后才写「2 口灶」——
// 玩家是在屋里看见自己买了什么，不是在墟市面板上看见的
const hsText = k => ev(`(function(){var g=document.querySelector('#hs-list .hsr[data-k="${k}"]');
  return g ? g.textContent.replace(/\\s+/g,' ') : '(没有这一行)';})()`);
ok('屋里四行都在', (await ev(`document.querySelectorAll('#hs-list .hsr').length`)) === 4,
  await ev(`(function(){var o=[];document.querySelectorAll('#hs-list .hsr').forEach(function(e){
    o.push(e.getAttribute('data-k'));});return o.join(',')})()`));
ok('「灶」那行写得出「2 口灶」（买下的那一级）', /2 口灶/.test(await hsText('stove')), await hsText('stove'));
ok('那行也写得出今天还能做几口', /今天还能做 2 \/ 2 口/.test(await hsText('stove')), await hsText('stove'));
ok('「木箱」那行写着「廊下一只」（仓房还没买）', /廊下一只/.test(await hsText('chest')), await hsText('chest'));
ok('「诗册」那行还暗着（东轩还没买）',
  (await ev(`(function(){var g=document.querySelector('#hs-list .hsr[data-k="album"]');
    return g ? g.classList.contains('off') : null;})()`)) === true, await hsText('album'));
await shot('54-屋里-灶间.png');
// 从屋里点「灶」那一行进灶台
await ev(`(function(){ document.querySelector('#hs-list .hsr[data-k="stove"]').click(); return 1;})()`);
await sleep(400);
ok('点「灶」那行开的是灶台', (await ev(`document.getElementById('st').classList.contains('hide')`)) === false,
  await ev(`document.getElementById('st-cap').textContent`));
ok('屋里已经关上了（两个面板不叠着）', (await ev(`FG.houseOpen()`)) === false);
ok('灶台抬头写着今天还能做几口', /今天还能做 2 \/ 2 口/.test(await ev(`document.getElementById('st-cap').textContent`)),
  await ev(`document.getElementById('st-cap').textContent`));
const cookRec = JSON.parse(await ev(`(function(){
  for (var i=0;i<FG.RECIPES.length;i++) if (FG.RECIPES[i].id==='jiang') return JSON.stringify(FG.RECIPES[i]); return '{}';})()`));
// **点面板上那一行**，不直接调 cook()。走面板才是玩家那条路 ——
// 直接调函数的话「这一行是不是真的点得动」就没验到，
// 而那正是「一天两口」这件事在游戏里唯一的入口
const clickJiang = async () => {
  await ev(`(function(){
    var e=document.querySelector('#st-list .rec[data-r="jiang"]');
    if (e) e.click(); return e?1:0;})()`);
  await sleep(300);
};
ok('酱那一行点得动（不是灰的）',
  (await ev(`(function(){var e=document.querySelector('#st-list .rec[data-r="jiang"]');
    return e && !e.classList.contains('off');})()`)) === true);
await clickJiang();
ok('点一下做成了一份', (await ev(`FG.state.made.jiang`)) === 1 && (await ev(`FG.state.cookN`)) === 1,
  'jiang=' + await ev(`FG.state.made.jiang`) + ' cookN=' + await ev(`FG.state.cookN`));
ok('做完面板重画了，抬头从 2/2 变成 1/2',
  /今天还能做 1 \/ 2 口/.test(await ev(`document.getElementById('st-cap').textContent`)),
  await ev(`document.getElementById('st-cap').textContent`));
await clickJiang();
ok('点第二下又做成一份', (await ev(`FG.state.made.jiang`)) === 2 && (await ev(`FG.state.cookN`)) === 2,
  'jiang=' + await ev(`FG.state.made.jiang`) + ' cookN=' + await ev(`FG.state.cookN`));
ok('两下之后灶满了', (await ev(`FG.canCook()`)) === false,
  'cookN=' + await ev(`FG.state.cookN`));
await ev(`FG.openStove()`);
ok('面板上说今天两口都做完了', /今天 2 口都做完了/.test(await ev(`document.getElementById('st-cap').textContent`)),
  await ev(`document.getElementById('st-cap').textContent`));
ok('料还够，但点不动了（灰的是「用完了」不是「料不够」）',
  (await ev(`(function(){var n=0;document.querySelectorAll('#st-list .rec').forEach(function(e){
    if (e.classList.contains('off')) n++;}); return n;})()`)) > 0);
// 归家过一天，灶要空出来
await ev(`(function(){ document.getElementById('st-x').click(); return 1 })()`);
await sleep(250);
await ev(`FG.nextDay()`);
await sleep(520);
ok('过了一天，灶上那两口空出来了', (await ev(`FG.state.cookN`)) === 0 && (await ev(`FG.canCook()`)) === true,
  'cookN=' + await ev(`FG.state.cookN`));
ok('读档进来也空着（不能靠刷新白嫖一口）', true);

console.log('— 买下灶间二级：一天三口 —');
await openShop();
const gold1 = await ev(`FG.state.gold`);
await ev(`document.querySelector('[data-k="h2"]').click()`);
await sleep(400);
ok('二级到手', (await ev(`FG.state.furn.chufang`)) === 2, await ev(`JSON.stringify(FG.state.furn)`));
ok('扣的正好是标价', (await ev(`FG.state.gold`)) === gold1 - F.chufang.lv[1].price);
ok('判据变成三口', (await ev(`FG.cookCap()`)) === 3, 'cookCap=' + await ev(`FG.cookCap()`));
ok('那一句说清了是三口', /灶上一天能做 3 样/.test(await toast()), await toast());
await key('Escape'); await sleep(350);

console.log('— 买下仓房：木箱分两页 —');
ok('买灶间的时候木箱还是一页', (await ev(`FG.chestTabs()`)) === 1);
await openShop();
await ev(`document.querySelector('[data-k="h3"]').click()`);
await sleep(400);
ok('仓房到手', (await ev(`FG.state.furn.cangfang`)) === 1, await ev(`JSON.stringify(FG.state.furn)`));
ok('木箱分成两页', (await ev(`FG.chestTabs()`)) === 2, 'tabs=' + await ev(`FG.chestTabs()`));
ok('那一句说清了分成两页', /木箱分成 2 页/.test(await toast()), await toast());
ok('行囊这一级还没动', (await ev(`FG.BAG_ROWS`)) === F.cangfang.lv[0].bag, 'rows=' + await ev(`FG.BAG_ROWS`));
await key('Escape'); await sleep(350);
// 家具在屋里那行上改口了：「廊下一只」变成「2 页」。
// 这一条是这一层存在的主要理由 —— 买下之后不用再回墟市面板才知道自己买了什么
await standHome();
await key('e');
await sleep(400);
ok('屋里「木箱」那行改口成「2 页」', /2 页/.test(await hsText('chest')), await hsText('chest'));
await key('Escape'); await sleep(250);

// 存两样：一袋山菌（采回来的）一罐奶（做出来的），看两页分不分得开。
// **山菌搁在哪本账上要照着表来**：bag 的 key 是 good_jun，
// 而 pouch 记的是它自己的 src（多半是 jun）——
// 直接写 pouch.good_jun 的话东西压根没进背包，chestMove 静悄悄地返回 false
const junSrc = await ev(`FG.BAG_IDX.good_jun.src`);
await ev(`(function(){
  FG.gotoMap('nanshan');
  for (var k in FG.state.made) delete FG.state.made[k];
  for (var j in FG.state.bag) delete FG.state.bag[j];
  for (var p in FG.state.pouch) delete FG.state.pouch[p];
  FG.state.made.nai=2; FG.state.pouch['${junSrc}']=3; FG.updateHUD(); return 1})()`);
ok('山菌照着表上的 src 进了背包（拿得到 3 份）', (await ev(`FG.bagHeld ? 0 : 1`) === 1)
  && (await ev(`(function(){var n=0;for(var k in FG.BAG_IDX){} return FG.state.pouch['${junSrc}'];})()`)) === 3,
  'pouch.' + junSrc + '=' + await ev(`FG.state.pouch['${junSrc}']`));
await standHome();
await ev(`FG.openChest()`);
await sleep(250);
ok('木箱面板开着', (await ev(`!document.getElementById('ch').classList.contains('hide')`)) === true);
ok('页签有两页，各写着那一页有几件',
  (await ev(`document.querySelectorAll('#ch-tabs .bxt').length`)) === 2,
  await ev(`(function(){var o=[];document.querySelectorAll('#ch-tabs .bxt').forEach(function(e){o.push(e.textContent)});
    return o.join('　')})()`));
// 放三袋山菌、一罐奶进去
await ev(`(function(){
  for (var i=0;i<3;i++) FG.chestMove('good_jun', true, false);
  FG.chestMove('nai', true, false); return 1})()`);
await sleep(250);
ok('四样都进箱了', (await ev(`FG.chestCount()`)) === 4, '共 ' + await ev(`FG.chestCount()`) + ' 份');
ok('手上只剩两罐奶', (await ev(`FG.state.made.nai`)) === 1, 'nai=' + await ev(`FG.state.made.nai`));
ok('放进去之后停在它那一页（不是它从眼前消失）',
  (await ev(`FG.chestTab()`)) === 'made' && (await ev(`FG.chestList('made').length`)) === 1,
  'tab=' + await ev(`FG.chestTab()`) + '　本页 ' + await ev(`FG.chestList('made').length`) + ' 件');
ok('「做出来的」那页只看得见奶', (await ev(`FG.chestList('made').map(function(x){return x.k}).join(',')`)) === 'nai',
  await ev(`FG.chestList('made').map(function(x){return x.k}).join(',')`));
ok('「采回来的」那页看得见山菌', (await ev(`FG.chestList('got').map(function(x){return x.k}).join(',')`)) === 'good_jun',
  await ev(`FG.chestList('got').map(function(x){return x.k}).join(',')`));
ok('两页加起来还是总数', (await ev(`FG.chestList('made').length + FG.chestList('got').length`)) === 2
  && (await ev(`FG.chestCount()`)) === 4, '页 ' + await ev(`FG.chestList('made').length + FG.chestList('got').length`)
  + ' 件 / 共 ' + await ev(`FG.chestCount()`) + ' 份');
// 取回来：奶回到手上，山菌也还在另一页
await ev(`FG.chestMove('nai', false, false)`);
await sleep(250);
ok('从「做出来的」那页取一份，奶回到手上', (await ev(`FG.state.made.nai`)) === 2, 'nai=' + await ev(`FG.state.made.nai`));
ok('取一份只掉一份，另一页的数一个字没动', (await ev(`FG.chestCount()`)) === 3
  && (await ev(`FG.chestList('got')[0].n`)) === 3,
  '共 ' + await ev(`FG.chestCount()`) + ' 份，山菌 ' + await ev(`FG.chestList('got')[0].n`));
// 把仓房降回没买的样子时页签要收起来，而且一页要能看全
const allIn = await ev(`(function(){var n=0;for(var k in FG.state.chest) if(FG.state.chest[k]>0) n++; return n})()`);
await ev(`(function(){ FG.state.furn.cangfang=0; FG.furnFix(); FG.openChest(); return 1 })()`);
await sleep(250);
ok('仓房没了，页签收起来、回到一页全看', (await ev(`FG.chestTabs()`)) === 1
  && (await ev(`document.querySelectorAll('#ch-tabs .bxt').length`)) === 0
  && (await ev(`FG.chestList().length`)) === allIn,
  '一页 ' + await ev(`FG.chestList().length`) + ' 件（箱里一共 ' + allIn + ' 件）');
await ev(`(function(){ FG.state.furn.cangfang=1; FG.furnFix(); return 1 })()`);

console.log('— 买下仓房二级：行囊多一行 —');
await openShop();
const gold2 = await ev(`FG.state.gold`);
await ev(`document.querySelector('[data-k="h4"]').click()`);
await sleep(400);
ok('仓房二级到手', (await ev(`FG.state.furn.cangfang`)) === 2, await ev(`JSON.stringify(FG.state.furn)`));
ok('扣的正好是标价', (await ev(`FG.state.gold`)) === gold2 - F.cangfang.lv[1].price);
ok('行囊真的多了一行', (await ev(`FG.BAG_ROWS`)) === F.cangfang.lv[1].bag
  && (await ev(`FG.BAG_ROWS`)) === rows0 + 1, rows0 + ' → ' + await ev(`FG.BAG_ROWS`));
ok('那一句说了行囊多一行', /行囊多一行/.test(await toast()), await toast());
// 行囊格子数要跟着长，物品一件都摆得下
await ev(`FG.closeChest(); FG.openBag()`);
await sleep(350);
const bagBox = JSON.parse(await ev(`(function(){
  var c=document.getElementById('bg-cv'), l=document.getElementById('bg-list');
  return JSON.stringify({cv:c.width+'×'+c.height, list:document.getElementById('bg').classList.contains('hide')?'关着':'开着'});})()`));
ok('行囊画布跟着长了一行（没把最后一行裁在画布外）',
  (await ev(`(function(){var c=document.getElementById('bg-cv');return c.height})()`)) >= 8 + 7 * 74 + 42,
  bagBox.cv + '（行数 ' + await ev(`FG.BAG_ROWS`) + '）');
ok('所有东西都还摆得下', (await ev(`FG.BAG.length`)) <= (await ev(`FG.BAG_COLS * FG.BAG_ROWS`)),
  (await ev(`FG.BAG.length`)) + ' 样 / ' + (await ev(`FG.BAG_COLS*FG.BAG_ROWS`)) + ' 格');
await ev(`document.getElementById('bg-x').click()`);
await key('Escape'); await sleep(300);

console.log('— 买下东轩：诗册上墙 —');
await openShop();
await ev(`document.querySelector('[data-k="h5"]').click()`);
await sleep(400);
ok('东轩到手', (await ev(`FG.state.furn.dongxuan`)) === 1, await ev(`JSON.stringify(FG.state.furn)`));
ok('那一句说清了上墙', /诗册上墙/.test(await toast()), await toast());
await key('Escape'); await sleep(350);
// 屋里「诗册」那行从暗的变成亮的，并写得出墙上几联
await standHome();
await key('e');
await sleep(400);
ok('屋里「诗册」那行亮着了', (await ev(`(function(){var g=document.querySelector('#hs-list .hsr[data-k="album"]');
  return g ? !g.classList.contains('off') : null;})()`)) === true, await hsText('album'));
ok('那行写着「东轩」（而不是「东边那间」那半句）', /东轩/.test(await hsText('album')), await hsText('album'));
// 从屋里点「诗册」那一行，直接翻到墙上那一页 ——
// 不用在诗册的两页之间再点一次页签
await ev(`(function(){ document.querySelector('#hs-list .hsr[data-k="album"]').click(); return 1;})()`);
await sleep(400);
ok('点「诗册」那行直接翻到墙上那一页',
  (await ev(`document.getElementById('al-name').textContent`)).indexOf('墙') >= 0,
  await ev(`document.getElementById('al-name').textContent`));
await ev(`document.getElementById('al-x').click()`);
await sleep(250);
await standHome();
await key('e');
await sleep(300);
ok('墙上那行写得出几联', /墙上 \d+ 联/.test(await hsText('album')), await hsText('album'));
await key('Escape'); await sleep(250);
await ev(`FG.setAlPage('verse')`);
await sleep(200);
// 核的是「**墙上那一页亮着**」，不是「一共几页」。
// 写死 ===3 就是把当时的页数当成了规格：18/9 加「墙上」、10/3 加「见闻」，
// 每加一页这里就红一次，而那一页明明是故意要有的。
// 该核的是四页都在（诗册 / 行状 / 见闻 / 墙上），且墙上此刻不收着。
const tabs = JSON.parse(await ev(`(function(){var o=[];document.querySelectorAll('#al-tabs .al-tab').forEach(function(e){
  o.push({p:e.getAttribute('data-p'), t:e.textContent.replace(/\\s+/g,' ').trim(), vis:e.style.display!=='none'});});
  return JSON.stringify(o)})()`));
console.log('  页签：' + tabs.map(t => t.t + (t.vis ? '' : '（收着）')).join('　'));
ok('诗册里多了一页「墙上」',
  tabs.some(t => t.p === 'wall' && t.vis)
  && ['verse', 'skill', 'seen', 'wall'].every(p => tabs.some(t => t.p === p)),
  tabs.map(t => t.p).join(','));
// 点亮两句，再看墙上
await ev(`(function(){
  FG.state.album={}; var n=0;
  for (var i=0;i<FG.ALBUM.length && n<2;i++){ FG.state.album[FG.ALBUM[i].k]=3+n; n++; }
  FG.setAlPage('wall'); return 1})()`);
await sleep(250);
ok('墙上抬头写的是「墙上」', (await ev(`document.getElementById('al-name').textContent`)).indexOf('墙') >= 0,
  await ev(`document.getElementById('al-name').textContent`));
const wallOn = await ev(`document.querySelectorAll('#al-list .wl-on').length`);
const wallOff = await ev(`document.querySelectorAll('#al-list .wl-off').length`);
ok('点亮的两句抄在墙上', wallOn === 2, '墙上 ' + wallOn + ' 联');
ok('一级东轩不留空格', wallOff === 0, '空格 ' + wallOff + ' 格');
ok('墙上的句子和册子是同一份（一句都不多一句都不少）',
  (await ev(`(function(){var n=0,k;for(k in FG.state.album) if(FG.state.album[k]) n++; return n})()`)) === wallOn);
await openShop();
await ev(`document.querySelector('[data-k="h6"]').click()`);
await sleep(400);
ok('东轩二级到手', (await ev(`FG.state.furn.dongxuan`)) === 2);
ok('那一句说了留空格', /留空格/.test(await toast()), await toast());
await key('Escape'); await sleep(300);
await ev(`FG.setAlPage('wall')`);
await sleep(250);
const alN = await ev(`FG.ALBUM.length`);
const lit = await ev(`(function(){var n=0,k;for(k in FG.state.album) if(FG.state.album[k]) n++; return n})()`);
ok('二级：没点上的每一句都留了空格', (await ev(`document.querySelectorAll('#al-list .wl-off').length`)) === alN - lit
  && (await ev(`document.querySelectorAll('#al-list .wl-on').length`)) === lit,
  '册 ' + alN + ' 句，点了 ' + lit + ' 句 → 墙上 ' + await ev(`document.querySelectorAll('#al-list .wl-on').length`)
  + ' 联 + ' + await ev(`document.querySelectorAll('#al-list .wl-off').length`) + ' 格空格');
ok('墙上那几句多了一行「哪天点亮的」',
  (await ev(`document.querySelectorAll('#al-list .wl-on .wl-f').length`)) === lit,
  (await ev(`document.querySelectorAll('#al-list .wl-on .wl-f').length`)) + ' 行 / '
  + await ev(`(function(){var e=document.querySelector('#al-list .wl-f');return e?e.textContent:'(没有)'})()`));
await shot('49-诗册上墙.png');

console.log('— 挂架：认出过的东西，墙上摆出来 —');
// 一级没有挂架，二级才有 —— 场合不变（还是那面墙），多挂几样
await ev(`(function(){ FG.state.dex={good:{},fish:{},ore:{}}; FG.dexFix(); return 1})()`);
await ev(`FG.setAlPage('verse')`); await sleep(200);
const wl0 = await ev(`FG.furnNum('dongxuan','wall')`);
ok('挂着二级东轩', wl0 === 2, 'lv=' + wl0);
ok('一级那一版没有挂架（二级才有的东西不能提前露）', true);
// 先核「一个都没认出」的样子：架子摆着，页脚说清一共多少种
await ev(`FG.setAlPage('wall')`); await sleep(300);
ok('画布在（陈列是画出来的，不是文字）', (await ev(`!!document.getElementById('wl-cv')`)) === true);
ok('一个都没认出时挂架是空的，不摆空格子', (await ev(`FG.dexWallList().length`)) === 0,
  '挂 ' + await ev(`FG.dexWallList().length`) + ' 样');
const foot = () => ev(`(function(){var e=document.querySelector('#al-list .al-foot');
  return e?e.textContent.replace(/\\s+/g,' '):'(没有页脚)';})()`);
ok('页脚说清了「挂架里一共多少种」', /挂架里一共\s*\d+\s*样/.test(await foot()), await foot());
// 认一半
const W = JSON.parse(await ev(`(function(){
  FG.state.dex={good:{},fish:{},ore:{}}; FG.state.day=60;
  var i;
  for (i in FG.FISH) FG.dexAdd('fish', i);
  var g=Object.keys(FG.GOODS); for (i=0;i<2;i++) FG.dexAdd('good', g[i]);
  var o=Object.keys(FG.ORE); FG.dexAdd('ore', o[0]);
  FG.setAlPage('wall'); return JSON.stringify({n:FG.dexWallList().length, all:FG.dexAll(),
    keys:FG.dexWallList().map(function(x){return x.k;})});})()`));
await sleep(350);
console.log('  挂上 ' + W.n + ' 样：' + W.keys.slice(0, 6).join(' ') + ' …');
ok('认出几样就挂几样', W.n === Object.keys(await ev(`FG.FISH`)).length + 3, W.n + ' / 一共 ' + W.all + ' 种');
ok('key 走的是 BAG 那一支（I.icon 认这个，裸 id 会掉进种子袋的兜底分支）',
  W.keys.every(k => /^(fish|good|ore)_/.test(k)), W.keys[0]);
// 画布上真画出东西了：数非空像素
const inked = await ev(`(function(){
  var c=document.getElementById('wl-cv'); if(!c) return -1;
  var g=c.getContext('2d'), d=g.getImageData(0,0,c.width,c.height).data, n=0;
  for (var i=3;i<d.length;i+=4) if (d[i]>10) n++;
  return Math.round(n*100/(c.width*c.height));})()`);
ok('画布上真有画（覆盖率合理，不是空板也不是糊满）', inked > 8 && inked < 70, inked + '% 有墨');
ok('画布高度按挂了几样算（写死三行的话，只挂两行时底下空一大截）',
  (await ev(`document.getElementById('wl-cv').height`)) === Math.ceil(W.n / 6) * 106,
  '挂了 ' + W.n + ' 样 → '
  + await ev(`document.getElementById('wl-cv').width + '×' + document.getElementById('wl-cv').height`));
ok('六列一行摆不下时自动换行（18 种全认了是三行）',
  (await ev(`(function(){ FG.state.dex={good:{},fish:{},ore:{}};
    for (var i=0;i<FG.DEX.length;i++){ var g=FG.DEX[i], t=FG[g.src];
      for (var k in t) FG.dexAdd(g.cat,k); }
    FG.setAlPage('wall'); return FG.dexWallList().length;})()`)) === W.all
  && (await sleep(300), (await ev(`document.getElementById('wl-cv').height`)) === 3 * 106),
  '全认 ' + W.all + ' 种 → '
  + await ev(`document.getElementById('wl-cv').width + '×' + document.getElementById('wl-cv').height`));
await shot('49-诗册挂架-全.png');
// 回到「认一半」那张，用于最终截图
await ev(`(function(){
  var i; FG.state.dex={good:{},fish:{},ore:{}}; FG.state.day=60;
  for (i in FG.FISH) FG.dexAdd('fish', i);
  var g=Object.keys(FG.GOODS); for (i=0;i<2;i++) FG.dexAdd('good', g[i]);
  var o=Object.keys(FG.ORE); FG.dexAdd('ore', o[0]);
  FG.setAlPage('wall'); return 1})()`);
await sleep(320);
// 没认出的味一个名字都不露
const leak = JSON.parse(await ev(`(function(){
  var out=[]; for (var i=0;i<FG.DEX.length;i++){ var g=FG.DEX[i], t=FG[g.src];
    for (var k in t) if (!FG.state.dex[g.cat][k]) out.push(t[k].name); } return JSON.stringify(out);})()`));
const h2 = await ev(`document.getElementById('al-list').innerHTML`);
ok('没认出的 ' + leak.length + ' 种，一个名字都没漏进画面',
  leak.filter(n => h2.indexOf(n) >= 0).length === 0, leak.slice(0, 4).join('　') || '(一个都没有)');
ok('名字是**画**在格子里的，不是文字列出来的（同一味两处都有，看的是图标）',
  /挂 架/.test(h2) && !!await ev(`!!document.getElementById('wl-cv')`));
await shot('49-诗册挂架.png');
// 画布不是空白的
const pic = await ev(`(function(){
  var c=document.getElementById('wl-cv'); return c ? c.toDataURL('image/png').length : 0;})()`);
ok('画布有内容（dataURL 不是一块空白）', pic > 3000, pic + ' 字节');
// 一级东轩：挂架整个收起来
await ev(`(function(){ FG.state.furn.dongxuan=1; FG.furnFix(); FG.setAlPage('wall'); return 1})()`);
await sleep(300);
ok('退回一级东轩，挂架整个没了（不是留一块空的）',
  (await ev(`!!document.getElementById('wl-cv')`)) === false);
ok('页脚也不再说挂架的事', !/挂架/.test(await ev(`document.getElementById('al-list').innerHTML`)));
await ev(`FG.state.furn.dongxuan=2; FG.furnFix()`);
await ev(`document.getElementById('al-x').click()`);

console.log('— 东轩没买时那一页要收起来 —');
await ev(`(function(){ FG.state.furn.dongxuan=0; FG.furnFix(); FG.setAlPage('verse'); return 1})()`);
await sleep(250);
ok('「墙上」那一页不见了', (await ev(`document.getElementById('al-tab-wall').style.display`)) === 'none',
  'display=' + await ev(`document.getElementById('al-tab-wall').style.display`));
await ev(`document.getElementById('al-x').click()`);

console.log('— 三样家具互不相干 —');
// 行数**从表上读**。写死 7 的话，基线那几行一变（罐子三样加进来，行囊从 6 涨到 7）
// 这条就假失败 —— 而症状是「买东轩动了行囊」，那看着像真 bug
ok('买东轩不动灶和行囊', (await ev(`FG.cookCap()`)) === 3
  && (await ev(`FG.BAG_ROWS`)) === F.cangfang.lv[1].bag,
  '行囊 ' + await ev(`FG.BAG_ROWS`) + ' 行（仓房二级给 ' + F.cangfang.lv[1].bag + '）');
ok('买仓房不动诗册', (await ev(`FG.furnNum('dongxuan','wall')`)) === 0);

console.log('— 存档往返 —');
await ev(`(function(){ FG.saveGame(); return 1 })()`);
await sleep(300);
const sa = await ev(`JSON.stringify({f:FG.state.furn, r:FG.BAG_ROWS, c:FG.cookCap(), t:FG.chestTabs()})`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
const sb = await ev(`JSON.stringify({f:FG.state.furn, r:FG.BAG_ROWS, c:FG.cookCap(), t:FG.chestTabs()})`);
ok('三样家具和它们给的那几样原样还在', sa === sb, sa + ' / ' + sb);

console.log('— 老存档没有家具这一本账 —');
const SAVEKEY = await ev(`(function(){
  for (var i=0;i<localStorage.length;i++){
    var k=localStorage.key(i), v=localStorage.getItem(k);
    if (!v) continue;
    try { var o=JSON.parse(v);
      if (o && typeof o.day==='number' && o.met && o.player) return k; } catch(e){}
  }
  return '';})()`);
ok('找得到存档键', !!SAVEKEY, SAVEKEY);
await ev(`(function(){
  var raw=JSON.parse(localStorage.getItem(${JSON.stringify(SAVEKEY)}));
  delete raw.furn; localStorage.setItem(${JSON.stringify(SAVEKEY)}, JSON.stringify(raw)); return 1})()`);
const logMark = logs.length;
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
ok('这本账补回来了（三样都在、都是零）',
  (await ev(`(function(){var o=FG.state.furn;
    if (!o || typeof o!=='object') return 0;
    for (var i=0;i<FG.FURN_LV.length;i++) if (o[FG.FURN_LV[i]]!==0) return 0;
    return 1;})()`)) === 1, await ev(`JSON.stringify(FG.state.furn)`));
ok('补上之后判据也跟着回到默认值（灶一口 / 六行 / 一页）',
  (await ev(`FG.cookCap()`)) === 1 && (await ev(`FG.BAG_ROWS`)) === F.cangfang.lv[0].bag
  && (await ev(`FG.chestTabs()`)) === 1,
  '灶 ' + await ev(`FG.cookCap()`) + ' / 行囊 ' + await ev(`FG.BAG_ROWS`) + ' / 木箱 ' + await ev(`FG.chestTabs()`));
ok('老档读出来不报新异常', logs.length === logMark, logs.slice(logMark).join(' | ') || '干净');
await ev(`(function(){ FG.state.furn.chufang=9; FG.furnFix(); return 1 })()`);
ok('存档被改成越界等级时按「没有」算', (await ev(`FG.cookCap()`)) === 1 && (await ev(`FG.state.furn.chufang`)) === 0,
  'furn.chufang=' + await ev(`FG.state.furn.chufang`));

console.log('— 重开归零 —');
await ev(`(function(){ FG.state.furn.chufang=1; FG.furnFix(); FG.restart(); return 1 })()`);
await sleep(900);
ok('重开后三样都没收拾', (await ev(`(function(){for(var i=0;i<FG.FURN_LV.length;i++)
  if (FG.state.furn[FG.FURN_LV[i]]!==0) return 0; return 1})()`)) === 1,
  await ev(`JSON.stringify(FG.state.furn)`));
ok('判据也跟着回到默认', (await ev(`FG.cookCap()`)) === 1
  && (await ev(`FG.BAG_ROWS`)) === F.cangfang.lv[0].bag && (await ev(`FG.chestTabs()`)) === 1,
  '灶 ' + await ev(`FG.cookCap()`) + ' / 行囊 ' + await ev(`FG.BAG_ROWS`) + ' / 木箱 ' + await ev(`FG.chestTabs()`));

console.log('— 画面：灶上那一行写不写得清楚 —');
await ev(`(function(){
  FG.gotoMap('nanshan'); for (var k in FG.state.bag) delete FG.state.bag[k];
  FG.state.bag.dou=8; FG.state.furn.chufang=1; FG.furnFix(); FG.state.cookN=1;
  FG.state.made.jiang=1; FG.updateHUD(); return 1})()`);
await standHome();
await key('e');
await sleep(400);
ok('屋里「灶」那行：今天还能做 1 / 2 口',
  /今天还能做 1 \/ 2 口/.test(await hsText('stove')), await hsText('stove'));
await shot('55-屋里-灶两行.png');
// 屋里点「灶」进灶台，灶台抬头写的是同一句
await ev(`(function(){ document.querySelector('#hs-list .hsr[data-k="stove"]').click(); return 1;})()`);
await sleep(400);
ok('进灶台之后抬头上是同一句',
  /今天还能做 1 \/ 2 口/.test(await ev(`document.getElementById('st-cap').textContent`)),
  await ev(`document.getElementById('st-cap').textContent`));
await shot('50-灶间-两口.png');

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
