// 歇脚处验收：19/9 的交通。
//
// 原来从一处走到别处，只能走到图边那道口子按 E。这一项给每张图摆一个
// 「歇脚处」，走过去按 E 开一张「往哪儿去」的清单，直接落到别处。
//
// 盯住这几条：
//   1) 每张有地可走的图都有一个歇脚处，坐标落在自己那张图的可行走带里
//   2) 歇脚处的判定圈不和 NPC / 出口 / 归家 / 营造 / 机器 / 木箱打架
//      （E 键那一串是「先判到的赢」，挨上了就会抢走那一下）
//   3) 没修路时：碑照样画着，提示行说清楚「还没修路」
//   4) 村道通三段、石板道通五段 —— 「一级通到哪儿」是一个写在表上的数
//   5) 清单**只列去过的**地方。没去过的不在上面（否则石板道就成了传送门）
//   6) 走后山（桃花源）**永远不在清单上** —— 原书里那地方本来就不是路
//   7) 走一趟真的换图、落点在那边的歇脚处旁边
//   8) 存档往返 / 老档没有这本账 / 越界等级 / 重开归零
//   9) 1× 画面：那块碑认不认得出来
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9384;
const profile = path.join(tmpdir(), 'guxian-road-' + process.pid);
const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
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
const hint = () => ev(`document.getElementById('hint').textContent`);
// 走到某张图的歇脚处跟前
async function standStation(map) {
  await ev(`(function(){
    var m=FG.MAPS['${map}'];
    FG.gotoMap('${map}');
    FG.state.player.x=m.station[0]; FG.state.player.y=m.station[1]+46;
    FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
  await sleep(430);
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
await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

console.log('— 每张图都有一个歇脚处 —');
const STA = JSON.parse(await ev(`(function(){var o={};for(var k in FG.MAPS){
  o[k] = FG.MAPS[k].station ? {at:FG.MAPS[k].station, name:FG.MAPS[k].stationName} : null; }
  return JSON.stringify(o)})()`));
console.log('  ' + Object.keys(STA).map(k => k + (STA[k] ? '(' + STA[k].name + ')' : '(无)')).join('　'));
ok('五张图都有歇脚处，也都有名字',
  Object.keys(STA).length === 5 && Object.keys(STA).every(k => STA[k] && STA[k].at.length === 2 && STA[k].name),
  Object.keys(STA).length + ' 张图');
// 可走带从图上读
const bnd = JSON.parse(await ev(`JSON.stringify((function(){var o={};for(var k in FG.MAPS)o[k]=FG.MAPS[k].bounds;return o})())`));
const inB = Object.keys(STA).map(k => {
  const a = STA[k].at, m = bnd[k];
  const fit = a[0] > m.x0 + 50 && a[0] < m.x1 - 50 && a[1] > m.y0 + 30 && a[1] < m.y1 - 20;
  return k + '=' + a + (fit ? '' : ' ✗出界');
});
ok('每一处都落在自己那张图的可行走带里', inB.every(s => s.indexOf('✗') < 0), inB.join('　'));

// 判定圈不和任何别的判定点打架。**这一条不是保险，是必需**：
// E 键那一串是「先判到的赢」，歇脚处一旦落进谁家的圈，站着按 E 就不是它
// 木箱不在 MAPS 里（在 game.js 的 CHEST 常量上），所以单独核一次
console.log('— 歇脚处的判定圈不跟人打架 —');
const clash2 = JSON.parse(await ev(`(function(){
  var bad=[], r=FG.SPOT_R.station;
  for (var k in FG.MAPS){
    var m=FG.MAPS[k], a=m.station; if(!a) continue;
    (m.npcs||[]).forEach(function(n){ var q=FG.NPCS[n];
      if (Math.abs(q.at[0]-a[0])+Math.abs(q.at[1]-a[1]) < r+150) bad.push(k+'×人:'+n); });
    (m.exits||[]).forEach(function(e){
      if (Math.abs(e.at[0]-a[0])+Math.abs(e.at[1]-a[1]) < r+e.r) bad.push(k+'×口:'+e.to); });
    if (m.home && Math.abs(m.home[0]-a[0])+Math.abs(m.home[1]-a[1]) < r+m.homeR) bad.push(k+'×归家');
    if (m.shaft && Math.abs(m.shaft.at[0]-a[0])+Math.abs(m.shaft.at[1]-a[1]) < r+m.shaft.r) bad.push(k+'×竖井');
    (m.builds||[]).forEach(function(b){ var q=FG.BUILD[b];
      if (q.at && Math.abs(q.at[0]-a[0])+Math.abs(q.at[1]-a[1]) < r+q.r) bad.push(k+'×营造:'+b); });
    (m.machines||[]).forEach(function(mc){ var q=FG.MACHINE[mc];
      if (q.at && Math.abs(q.at[0]-a[0])+Math.abs(q.at[1]-a[1]) < r+q.r) bad.push(k+'×机器:'+mc); });
    // 刻石、钓点、采集点也得算进来。E 键那一串里它们排在歇脚处**前面**，
    // 挨上了的话站着按 E 读的是石头/抛竿，而提示行看着完全正常 ——
    // 后山那处就是这么被六方刻石抢走的（第一版摆在 [1180,760]，
    // 离「溪边刻石」[1250,838] 只有 148px）
    (FG.SPOTS[k] && FG.SPOTS[k].stele || []).forEach(function(s){
      if (Math.abs(s.at[0]-a[0])+Math.abs(s.at[1]-a[1]) < r+130) bad.push(k+'×刻石:'+s.name); });
    (FG.SPOTS[k] && FG.SPOTS[k].fish || []).forEach(function(s){
      if (Math.abs(s.at[0]-a[0])+Math.abs(s.at[1]-a[1]) < r+150) bad.push(k+'×钓点:'+s.name); });
    (FG.SPOTS[k] && FG.SPOTS[k].pick || []).forEach(function(s){
      if (Math.abs(s.at[0]-a[0])+Math.abs(s.at[1]-a[1]) < r+130) bad.push(k+'×采集:'+s.k); });
  }
  return JSON.stringify(bad);})()`));
ok('歇脚处不和 NPC / 出口 / 归家 / 竖井 / 营造 / 机器 / 刻石 / 钓点 / 采集打架',
  clash2.length === 0, clash2.join('　') || '(无)');
// 木箱那一条单独核（木箱在图上不在 MAPS 里）
ok('站在歇脚处上开不出箱子（E 不会被木箱抢走）',
  (await ev(`(function(){
    FG.gotoMap('nanshan'); var a=FG.MAPS.nanshan.station;
    FG.state.player.x=a[0]; FG.state.player.y=a[1]+46; FG.state.walkTo=null;
    return FG.nearChest() ? 0 : 1;})()`)) === 1);

console.log('— 路表：分级只改通几处 —');
const R = JSON.parse(await ev(`JSON.stringify(FG.ROAD)`));
const RL = JSON.parse(await ev(`JSON.stringify(FG.ROAD_LV)`));
const ROADS = JSON.parse(await ev(`JSON.stringify(FG.ROADS)`));
console.log('  ' + RL.map(k => k + '(' + R[k].name + '×' + R[k].lv.length + ')：' +
  R[k].lv.map(l => l.legs + ' 段').join('→')).join('　'));
ok('村道两级，一级比一级通得多',
  R.cundao.lv.length === 2 && R.cundao.lv[1].legs > R.cundao.lv[0].legs,
  R.cundao.lv.map(l => l.legs).join('→'));
ok('每一级都比上一级贵', R.cundao.lv[1].price > R.cundao.lv[0].price,
  R.cundao.lv.map(l => l.price).join('→'));
ok('最高一级也不超过表上路段的总数',
  R.cundao.lv[R.cundao.lv.length - 1].legs <= ROADS.length,
  '最高 ' + R.cundao.lv[R.cundao.lv.length - 1].legs + ' 段 / 表上 ' + ROADS.length + ' 段');
const MAPKEYS = JSON.parse(await ev(`JSON.stringify(Object.keys(FG.MAPS))`));
ok('每一段的两头都有一张地图', ROADS.every(p => p.length === 2
  && MAPKEYS.indexOf(p[0]) >= 0 && MAPKEYS.indexOf(p[1]) >= 0),
  ROADS.map(p => p.join('↔')).join('　'));
// 后山故意不通
const houshanRoads = ROADS.filter(p => p[0] === 'houshan' || p[1] === 'houshan');
ok('后山（桃花源）一段都不通', houshanRoads.length === 0,
  houshanRoads.length ? houshanRoads.map(p => p.join('↔')).join('　') : '(无)');

console.log('— 开局：还没修路 —');
ok('能通的段数是 0', (await ev(`FG.roadLegs()`)) === 0, 'legs=' + await ev(`FG.roadLegs()`));
ok('路这一本账摆成 0，不是空对象', (await ev(`FG.state.road.cundao`)) === 0,
  await ev(`JSON.stringify(FG.state.road)`));
await standStation('nanshan');
ok('站在歇脚处上有判定', (await ev(`(FG.nearStation()||{}).id`)) === 'nanshan',
  await ev(`(FG.nearStation()||{}).id`));
ok('提示行说清楚「还没修路」', /歇脚处/.test(await hint()) && /还没修路/.test(await hint()), await hint());
await clearToast();
await key('e');
await sleep(350);
ok('按 E 开的是那份清单', (await ev(`FG.stationOpen()`)) === true);
ok('清单上是「还没修路」那句话，不是空白',
  /还没修路/.test(await ev(`document.getElementById('rd-list').textContent`)),
  await ev(`document.getElementById('rd-list').textContent`));
await key('Escape');
await sleep(300);
ok('Esc 关掉了清单', (await ev(`FG.stationOpen()`)) === false);

console.log('— 墟市：买下村道 —');
await ev(`(function(){
  FG.gotoMap('xushi'); var n=FG.NPCS.xushi;
  FG.state.gold=30000; FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+40;
  FG.state.walkTo=null; return 1})()`);
await sleep(430);
await key('b');
await sleep(420);
const rows = JSON.parse(await ev(`(function(){
  var o=[]; FG.SHOP.xushi.forEach(function(r){ if (r.kind==='road') o.push(r.r+':'+r.lv); });
  return JSON.stringify(o)})()`));
ok('两格路都在货单上', rows.length === 2 && rows.indexOf('cundao:1') >= 0 && rows.indexOf('cundao:2') >= 0,
  rows.join('　'));
ok('二级一开始锁着',
  /得先有前一个/.test(await ev(`document.querySelector('[data-k="d2"]').textContent`)),
  await ev(`document.querySelector('[data-k="d2"]').textContent`));
ok('一级写着价钱',
  (await ev(`document.querySelector('[data-k="d1"]').querySelector('u').textContent`)) === R.cundao.lv[0].price + ' 钱',
  await ev(`document.querySelector('[data-k="d1"]').querySelector('u').textContent`));
const g0 = await ev(`FG.state.gold`);
await ev(`document.querySelector('[data-k="d1"]').click()`);
await sleep(400);
ok('村道到手', (await ev(`FG.state.road.cundao`)) === 1, await ev(`JSON.stringify(FG.state.road)`));
ok('扣的正好是标价', (await ev(`FG.state.gold`)) === g0 - R.cundao.lv[0].price);
ok('那一句说清了多几处', /歇脚处那张清单上多了 3 处/.test(await toast()), await toast());
ok('判据真的变成三段', (await ev(`FG.roadLegs()`)) === 3, 'legs=' + await ev(`FG.roadLegs()`));
ok('路不进器物架', !(await ev(`JSON.stringify(FG.TOOLS.map(function(t){return t.k}))`)).indexOf('cundao') >= 0,
  await ev(`JSON.stringify(FG.TOOLS.map(function(t){return t.k}))`));
await key('Escape');
await sleep(350);

console.log('— 清单只列去过的 —');
// 开局到过 南山 和 墟市（开局落在南山，买东西时进了墟市）
const vis = JSON.parse(await ev(`JSON.stringify(Object.keys(FG.state.vis))`));
ok('「到过」是落地就记的', vis.indexOf('nanshan') >= 0 && vis.indexOf('xushi') >= 0, vis.join(','));
ok('溪畔、石硐、后山都还没到过', ['xipan', 'shidong', 'houshan'].every(k => vis.indexOf(k) < 0),
  vis.join(','));
await standStation('xushi');
const l1 = JSON.parse(await ev(`JSON.stringify(FG.stationList().map(function(d){return d.to}))`));
ok('墟市的清单上只有去过的南山', l1.length === 1 && l1[0] === 'nanshan', l1.join(',') || '(空)');
await clearToast();
await key('e');
await sleep(350);
const rdText = () => ev(`document.getElementById('rd-list').textContent`);
ok('面板上那一行写得出地方名和图名',
  /山居/.test(await rdText()) && /南山茅舍/.test(await rdText()),
  (await rdText()).replace(/\s+/g, ' ').slice(0, 60));

console.log('— 走一趟真的换图 —');
const dayA = await ev(`FG.state.day`);
await ev(`document.querySelector('#rd-list .rdg[data-to="nanshan"]').click()`);
await sleep(500);
ok('到了南山', (await ev(`FG.state.map`)) === 'nanshan', 'map=' + await ev(`FG.state.map`));
ok('落点在那边歇脚处旁边（不是正压在碑上）',
  (await ev(`(function(){var a=FG.MAPS.nanshan.station;
    var d=Math.abs(FG.state.player.x-a[0])+Math.abs(FG.state.player.y-a[1]);
    return d>0 && d<=FG.SPOT_R.station;})()`)) === true,
  '离碑 ' + await ev(`(function(){var a=FG.MAPS.nanshan.station;
    return Math.abs(FG.state.player.x-a[0])+Math.abs(FG.state.player.y-a[1]);})()`) + 'px');
ok('清单自己关掉了', (await ev(`FG.stationOpen()`)) === false);
ok('那一句说的是到了哪儿', /山居|南山/.test(await toast()), await toast());
ok('走路不花体力也不花日子', (await ev(`FG.state.day`)) === dayA && (await ev(`FG.state.gold`)) === g0 - R.cundao.lv[0].price,
  'day=' + await ev(`FG.state.day`));

console.log('— 升到石板道：五段 —');
await ev(`(function(){
  FG.gotoMap('xushi'); var n=FG.NPCS.xushi;
  FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+40; FG.state.walkTo=null; return 1})()`);
await sleep(430);
await key('b');
await sleep(420);
const g1 = await ev(`FG.state.gold`);
await ev(`document.querySelector('[data-k="d2"]').click()`);
await sleep(400);
ok('石板道到手', (await ev(`FG.state.road.cundao`)) === 2, await ev(`JSON.stringify(FG.state.road)`));
ok('扣的正好是标价', (await ev(`FG.state.gold`)) === g1 - R.cundao.lv[1].price);
ok('判据变成五段', (await ev(`FG.roadLegs()`)) === 5, 'legs=' + await ev(`FG.roadLegs()`));
ok('那一句说清了多两处', /多了 2 处/.test(await toast()), await toast());
await key('Escape');
await sleep(350);

console.log('— 走一趟没去过的地方：清单上没有 —');
await standStation('nanshan');
const l2 = JSON.parse(await ev(`JSON.stringify(FG.stationList().map(function(d){return d.to}))`));
ok('南山这一页上仍然只有去过的墟市', l2.length === 1 && l2[0] === 'xushi', l2.join(',') || '(空)');
// 真的走过去溪畔，再看清单
await ev(`FG.gotoMap('xipan')`);
await sleep(400);
await standStation('xipan');
const l3 = JSON.parse(await ev(`JSON.stringify(FG.stationList().map(function(d){return d.to}))`));
ok('溪畔这页上列着南山和墟市（两段都通）',
  l3.length === 2 && l3.indexOf('nanshan') >= 0 && l3.indexOf('xushi') >= 0, l3.join(','));
// 后山的清单永远是空的
await standStation('houshan');
const l4 = JSON.parse(await ev(`JSON.stringify(FG.stationList().map(function(d){return d.to}))`));
ok('后山那处歇脚处，一处也不通', l4.length === 0, l4.join(',') || '(空)');
ok('提示行说的是「还没走过」而不是「没修路」',
  /还没走过/.test(await hint()), await hint());
await clearToast();
await key('e');
await sleep(350);
ok('面板上写的是「这几处都还没走过」',
  /还没走过/.test(await ev(`document.getElementById('rd-list').textContent`)),
  await ev(`document.getElementById('rd-list').textContent`));
await key('Escape');
await sleep(300);

console.log('— 存档往返 —');
await ev(`(function(){
  FG.state.road.cundao=2;
  FG.state.vis.nanshan=true; FG.state.vis.xushi=true; FG.state.vis.xipan=true;
  FG.saveGame(); return 1})()`);
await sleep(300);
const sa = await ev(`JSON.stringify({r:FG.state.road, v:Object.keys(FG.state.vis), legs:FG.roadLegs()})`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
const sb = await ev(`JSON.stringify({r:FG.state.road, v:Object.keys(FG.state.vis), legs:FG.roadLegs()})`);
ok('路和「到过哪些地方」原样还在', sa === sb, sa + ' / ' + sb);

console.log('— 老存档没有路这一本账 —');
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
  delete raw.road; delete raw.vis;
  localStorage.setItem(${JSON.stringify(SAVEKEY)}, JSON.stringify(raw)); return 1})()`);
const logMark = logs.length;
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
ok('路这本账补回来了（0）', (await ev(`FG.state.road.cundao`)) === 0
  && (await ev(`JSON.stringify(FG.state.road)`)) === JSON.stringify({ cundao: 0 }),
  await ev(`JSON.stringify(FG.state.road)`));
ok('判据也回到 0 段', (await ev(`FG.roadLegs()`)) === 0, 'legs=' + await ev(`FG.roadLegs()`));
ok('「到过哪些地方」这一项也在（不算 null）',
  (await ev(`typeof FG.state.vis`)) === 'object' && (await ev(`JSON.stringify(FG.state.vis)`)) !== 'null',
  await ev(`JSON.stringify(FG.state.vis)`));
ok('老档读出来不报新异常', logs.length === logMark, logs.slice(logMark).join(' | ') || '干净');
await ev(`(function(){ FG.state.road.cundao=9; FG.roadFix(); return 1 })()`);
ok('存档被改成越界等级时按「没有」算', (await ev(`FG.roadLegs()`)) === 0 && (await ev(`FG.state.road.cundao`)) === 0,
  'cundao=' + await ev(`FG.state.road.cundao`));

console.log('— 重开归零 —');
await ev(`(function(){ FG.state.road.cundao=1; FG.roadFix(); FG.restart(); return 1 })()`);
await sleep(900);
ok('重开后路归零', (await ev(`FG.state.road.cundao`)) === 0 && (await ev(`FG.roadLegs()`)) === 0,
  await ev(`JSON.stringify(FG.state.road)`));
ok('「到过哪些地方」也清了', (await ev(`Object.keys(FG.state.vis).length`)) <= 1,
  await ev(`JSON.stringify(FG.state.vis)`));

console.log('— 画面：1× 下那块碑认不认得出来 —');
// 人站远一点：提示行是压在人头上的，站在碑跟前它一定挡着碑的一半 ——
// 那样截出来的图量的是提示行，不是碑
await ev(`(function(){
  FG.gotoMap('nanshan'); FG.state.road.cundao=2; FG.roadFix();
  var a=FG.MAPS.nanshan.station;
  FG.state.player.x=a[0]-90; FG.state.player.y=a[1]+110; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 });
await sleep(500);
await shot('51-歇脚处.png');
await ev(`(function(){
  FG.gotoMap('xipan'); var a=FG.MAPS.xipan.station;
  FG.state.player.x=a[0]-90; FG.state.player.y=a[1]+110; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(500);
await shot('52-溪畔歇脚处.png');
await ev(`(function(){
  FG.gotoMap('houshan'); var a=FG.MAPS.houshan.station;
  FG.state.player.x=a[0]-90; FG.state.player.y=a[1]+110; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(500);
await shot('53-后山歇脚处.png');
ok('三张都截了', true);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
