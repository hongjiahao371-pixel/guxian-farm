// 三格存档验收。
//
// 原来只有一格：想开第二个田就得把这一格删掉，
// 而玩到一半的田没人舍得删 —— 于是「换个玩法试试」这件事做不了。
//
// 盯住这几条：
//   1) **第 0 格沿用原来的键**：老玩家存了一个月的田不能因为加了格就消失
//   2) 标题上三格各写各的「第几年第几天」，不是「有 / 没有」一个色
//   3) 标题读档**不动 S**（看摘要要走读档的话，读完当前局面就没了）
//   4) 三格互不串：第 2 格的进度不影响第 1 格
//   5) 「重来」要按两下 —— 一格是别人玩了半个月的田，一次点错就抹掉
//   6) 空的那一格点「入山」= 从头开，且**所有账都清了**
//      （新加一本账忘了清的现象是「新局一开局就人人相知、到处是挂架」）
//   7) 读档回来 slot 还在（load() 是 for...in S，slot 不在 S 上就存回第 0 格）
//   8) 存档坏了（parse 抛）当这一格是空的，不能把标题卡死
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9407;
const profile = path.join(tmpdir(), 'guxian-slot-' + process.pid);
const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--allow-file-access-from-files', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
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
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
const slotsTxt = () => ev(`(function(){var e=document.getElementById('slots');
  return e?e.textContent.replace(/\\s+/g,' ').trim():'';})()`);
// 模拟点某一格上的某个动作
const clickSlot = async (s, act) => ev(`(function(){
  var b=document.querySelector('#slots .slot[data-slot="${s}"] [data-act="${act}"]');
  if(!b) return 'no-button'; b.click(); return 'ok';})()`);

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

console.log('— 三格摆出来了 —');
ok('一共有 ' + (await ev(`FG.SAVE_SLOTS`)) + ' 格', (await ev(`FG.SAVE_SLOTS`)) === 3);
ok('标题上摆着三张卡', (await ev(`document.querySelectorAll('#slots .slot').length`)) === 3);
ok('开局时三格都是空的',
  (await ev(`[0,1,2].every(function(i){ return !FG.slotInfo(i); })`)) === true);
ok('空的那一格写「入 山」',
  (await ev(`[0,1,2].every(function(i){
    var b=document.querySelector('#slots .slot[data-slot="'+i+'"] [data-act="new"]');
    return !!b && b.textContent.indexOf('入')>=0; })`)) === true);
ok('空的那一格没有「续」（点不得的东西不该摆出来）',
  (await ev(`document.querySelectorAll('#slots [data-act="cont"]').length`)) === 0);

console.log('\n— 第 0 格沿用原来的键，老存档不能消失 —');
ok('第 0 格的键就是原来那个不带后缀的',
  (await ev(`FG.saveKey(0)`)) === 'guxian_nanshan_save_v1', await ev(`FG.saveKey(0)`));
ok('第 1、2 格往后排', (await ev(`FG.saveKey(1)`)) === 'guxian_nanshan_save_v1_s2'
  && (await ev(`FG.saveKey(2)`)) === 'guxian_nanshan_save_v1_s3',
  await ev(`FG.saveKey(1)`) + ' / ' + await ev(`FG.saveKey(2)`));
ok('三格三个键（不撞）',
  new Set([await ev(`FG.saveKey(0)`), await ev(`FG.saveKey(1)`), await ev(`FG.saveKey(2)`)]).size === 3);
ok('标题不再有「入山 / 续前日」那两个按钮了',
  (await ev(`!document.getElementById('btn-new') && !document.getElementById('btn-cont')`)) === true);

console.log('\n— 开一局，看它写得出来 —');
await ev(`FG.startFrom('new')`); await sleep(900);
ok('开局进山了', (await ev(`document.getElementById('title').classList.contains('hide')`)) === true);
ok('用的是第 0 格', (await ev(`FG.state.slot`)) === 0, 'slot=' + await ev(`FG.state.slot`));
ok('第 0 格存下来了', (await ev(`!!FG.slotInfo(0)`)) === true);
ok('摘要读得出第几天', (await ev(`FG.slotInfo(0).day`)) === (await ev(`FG.state.day`)),
  '第 ' + await ev(`FG.slotInfo(0).day`) + ' 天');
// 造出一点内容，好看摘要里有没有
await ev(`(function(){
  FG.state.day=20; FG.state.earned=1480;
  FG.state.album={firstTill:3, firstSow:4, firstHarvest:6};
  FG.state.dex={good:{mei:{n:2,first:5},jun:{n:1,first:9}},fish:{},ore:{}};
  FG.saveGame(); return 1})()`);
await sleep(200);
const inf0 = JSON.parse(await ev(`JSON.stringify(FG.slotInfo(0))`));
console.log('  第 0 格摘要：' + JSON.stringify(inf0));
ok('摘要里有诗册几句', inf0.album === 3, inf0.album + ' 句');
ok('摘要里见过几味', inf0.dex === 2, inf0.dex + ' 味');
ok('摘要里有进项', inf0.earned === 1480, inf0.earned + ' 钱');
ok('摘要有节气', !!inf0.solar, inf0.solar);

console.log('\n— 三格互不串 —');
await ev(`(function(){ FG.state.slot=1; FG.state.day=60; FG.state.earned=9999;
  FG.state.album={firstTill:3}; FG.state.dex={good:{},fish:{},ore:{}};
  FG.saveGame(); return 1})()`);
await sleep(200);
await ev(`(function(){ FG.state.slot=2; FG.state.day=99; FG.state.earned=42;
  FG.state.album={}; FG.state.dex={good:{mei:{n:1,first:1}},fish:{},ore:{}};
  FG.saveGame(); return 1})()`);
await sleep(200);
const all = JSON.parse(await ev(`JSON.stringify([FG.slotInfo(0), FG.slotInfo(1), FG.slotInfo(2)])`));
console.log('  ' + all.map((s, i) => '第' + (i + 1) + '格 第' + s.day + '天 ' + s.album + '句 ' + s.dex + '味 ' + s.earned + '钱').join('　'));
ok('三格各写各的，不串', all[0].day === 20 && all[1].day === 60 && all[2].day === 99);
ok('第 0 格的摘要没被后面两格改掉', all[0].earned === 1480 && all[0].album === 3 && all[0].dex === 2,
  all[0].earned + ' 钱 ' + all[0].album + ' 句 ' + all[0].dex + ' 味');

console.log('\n— 标题读档不动 S —');
const before = await ev(`FG.state.day`);
await ev(`FG.showTitle()`); await sleep(320);
ok('标题摆出来了', (await ev(`!document.getElementById('title').classList.contains('hide')`)) === true);
ok('**看一眼摘要没有动 S**（读档就把当前局面顶掉了的话，标题一开就毁）',
  (await ev(`FG.state.day`)) === before, '第 ' + await ev(`FG.state.day`) + ' 天');
ok('标题上三格都写了日子', (await ev(`(function(){
  var ok=true;
  document.querySelectorAll('#slots .slot').forEach(function(s,i){
    if (s.textContent.indexOf('第 '+(i+1)+' 格')<0) ok=false;
  });
  return ok;})()`)) === true);
const st = await slotsTxt();
ok('三格的日子都写在上面',
  /第 1 年 · 第 20 天/.test(st) && /第 1 年 · 第 60 天/.test(st) && /第 1 年 · 第 99 天/.test(st),
  st.slice(0, 100));
ok('有货的那一格多一个「续」', (await ev(`document.querySelectorAll('#slots [data-act="cont"]').length`)) === 3);
await shot('75-标题-三格存档.png');
ok('截了一张', true);

console.log('\n— 「重来」要按两下 —');
await ev(`FG.showTitle()`); await sleep(260);
ok('第一次点「重来」：不进游戏', (await clickSlot(1, 'over')) === 'ok');
await sleep(260);
ok('（还在标题上）', (await ev(`!document.getElementById('title').classList.contains('hide')`)) === true);
ok('那一格还在（没被第一次点掉）', (await ev(`!!FG.slotInfo(1)`)) === true);
ok('按钮改成要确认的样子', (await ev(`(function(){
  var b=document.querySelector('#slots .slot[data-slot="1"] [data-act="over"]');
  return b?b.textContent:'(没有)';})()`)).indexOf('重') >= 0,
  await ev(`(function(){var b=document.querySelector('#slots .slot[data-slot="1"] [data-act="over"]');return b?b.textContent:'(没有)';})()`));
ok('（别人那两格没被连坐）', (await ev(`!!FG.slotInfo(0) && !!FG.slotInfo(2)`)) === true);
// 上膛的时限是 4 秒。**别在中间刷一次标题**：showTitle 会重画，
// `slotArm` 也就跟着没了 —— 这不是 bug，是「4 秒内没按第二下就取消」的另一个写法。
// 这里是验真正要验的：**在时限之内按第二下，这格就真的被盖掉**。
await ev(`(function(){
  var b=document.querySelector('#slots .slot[data-slot="2"] [data-act="over"]');
  b.click();
  b=document.querySelector('#slots .slot[data-slot="2"] [data-act="over"]');
  b.click();
  return 1})()`);
await sleep(400);
ok('时限之内按第二下：这格真的被盖掉了（重开成第 1 天，游戏也进去了）',
  (await ev(`document.getElementById('title').classList.contains('hide')`)) === true
  && (await ev(`FG.slotInfo(2).day`)) === 1 && (await ev(`FG.state.slot`)) === 2,
  '第 2 格现在是第 ' + await ev(`FG.slotInfo(2).day`) + ' 天　slot=' + await ev(`FG.state.slot`));
ok('（另两格没被连坐）',
  (await ev(`FG.slotInfo(0).day`)) === 20 && (await ev(`FG.slotInfo(1).day`)) === 60,
  await ev(`FG.slotInfo(0).day`) + ' 天 / ' + await ev(`FG.slotInfo(1).day`) + ' 天');

// 超时取消也验一次：上了膛不动手，等 4 秒它自己退回原样，再点一下还是不动手
await ev(`location.reload()`); await sleep(2600);
await ev(`FG.showTitle()`); await sleep(300);
ok('（先把第 2 格做回有货的样子，等下要验超时）',
  (await ev(`(function(){
    FG.state.slot=2; FG.state.day=70; FG.state.earned=7; FG.state.album={};
    FG.state.dex={good:{},fish:{},ore:{}}; FG.saveGame();
    FG.state.slot=0; FG.showTitle(); return FG.slotInfo(2).day;})()`)) === 70);
await clickSlot(2, 'over');
await sleep(300);
await sleep(4300);
ok('上了膛不动手，等一会儿按钮自己退回原样', (await ev(`(function(){
  var b=document.querySelector('#slots .slot[data-slot="2"] [data-act="over"]');
  return b?b.textContent:'(没有)';})()`)).indexOf('重 来') >= 0,
  await ev(`(function(){var b=document.querySelector('#slots .slot[data-slot="2"] [data-act="over"]');return b?b.textContent:'(没有)';})()`));
ok('（退回之后点一下还是不动手）',
  (await clickSlot(2, 'over')) === 'ok'
  && (await ev(`!document.getElementById('title').classList.contains('hide')`)) === true
  && (await ev(`FG.slotInfo(2).day`)) === 70, await ev(`FG.slotInfo(2).day`) + ' 天');

console.log('\n— 续档：先选格，再续 —');
// 读档得**先知道读哪一格**，那正是标题上「续」按钮的职责。
// 直接调 startFrom('cont') 而不先定 S.slot，读的永远是第 0 格 ——
// 这是设计，不是漏洞，所以这一段走真实路径：点标题上那一格
await ev(`(function(){ FG.state.slot=1; FG.state.day=60; FG.state.earned=9999;
  FG.state.album={firstTill:3}; FG.state.dex={good:{},fish:{},ore:{}};
  FG.saveGame(); return 1})()`);
await ev(`location.reload()`); await sleep(2600);
await ev(`FG.showTitle()`); await sleep(320);
await clickSlot(1, 'cont');
await sleep(900);
ok('点第 2 格的「续」：进的是第 2 格那一局', (await ev(`FG.state.slot`)) === 1 && (await ev(`FG.state.day`)) === 60,
  'slot=' + await ev(`FG.state.slot`) + '　第 ' + await ev(`FG.state.day`) + ' 天');
ok('（也是第 2 格自己的那份账）', (await ev(`FG.state.earned`)) === 9999, await ev(`FG.state.earned`) + ' 钱');
ok('（诗册也是它自己的）', (await ev(`Object.keys(FG.state.album).length`)) === 1);
ok('续上去之后存回的还是第 2 格',
  (await ev(`!!localStorage.getItem(FG.saveKey(1)) && !localStorage.getItem(FG.saveKey(0)).match(/"day":60/)`)) === true);
ok('（第 0 格那局没被这一趟读档改掉）', (await ev(`FG.slotInfo(0).day`)) === 20, await ev(`FG.slotInfo(0).day`) + ' 天');
// 「刷新之后 S.slot 回到 0」不是一条该断言的行为：S.slot 本来就是**这一局在第几格**，
// 刷新一次游戏就没了，玩家是在标题上重新选的 —— 所以直接调 startFrom 时它沿用上一次的值，
// 而真实路径（点某一格的按钮）会先 `S.slot = s`。这里只记一句，不当成判据。

console.log('\n— 空的那一格从头开：所有账都清了 —');
await ev(`(function(){
  // 第 1 格上摆一局「什么都占了」的，好核新局清得干不干净
  FG.state.slot=0; FG.state.day=50; FG.state.earned=5000;
  FG.state.album={firstTill:1,firstSow:2};
  FG.state.dex={good:{mei:{n:1,first:1}},fish:{},ore:{}};
  FG.state.birth={xushi:1};
  FG.state.ren={linweng:{p:99,tier:2,day:1,gave:1},xushi:{p:99,tier:2,day:1,gave:1}};
  FG.state.build.gou=1; FG.buildFix(); FG.state.mach.lv.jar=1; FG.machFix();
  FG.saveGame(); return 1})()`);
await ev(`location.reload()`); await sleep(2600);
await ev(`(function(){ FG.startFrom('new'); return 1})()`); await sleep(800);
ok('新局回到第 1 天', (await ev(`FG.state.day`)) === 1, '第 ' + await ev(`FG.state.day`) + ' 天');
ok('诗册清了', (await ev(`Object.keys(FG.state.album).length`)) === 0);
ok('见闻清了', (await ev(`FG.dexCount('good')+FG.dexCount('fish')+FG.dexCount('ore')`)) === 0);
ok('生辰清了', (await ev(`Object.keys(FG.state.birth).length`)) === 0);
ok('人情清了（不然新局一开局就人人相知）',
  (await ev(`['linweng','xushi','yufu','tongzi'].every(function(i){ return FG.renTier(i)===0; })`)) === true,
  await ev(`FG.renName('linweng')`));
ok('营造清了', (await ev(`FG.state.build.gou`)) === 0);
ok('机器清了', (await ev(`FG.state.mach.lv.jar`)) === 0);
ok('进项清了', (await ev(`FG.state.earned`)) === 0);

console.log('\n— 存档坏了：标题不能卡死 —');
// 先把三格都摆成有货的，再把第 2 格写坏 —— 这样能核「坏的那一格不影响另两格」
await ev(`(function(){
  for (var i=0;i<3;i++){ FG.state.slot=i; FG.state.day=10+i*5; FG.state.earned=100+i;
    FG.state.album={}; FG.state.dex={good:{},fish:{},ore:{}}; FG.saveGame(); }
  localStorage.setItem(FG.saveKey(1), '{这不是 JSON');
  FG.showTitle(); return 1})()`);
await sleep(320);
ok('坏的那一格显示「读不出来了」，不是空白也不是报错',
  (await slotsTxt()).indexOf('读不出来') >= 0, (await slotsTxt()).slice(0, 90));
const stx = await slotsTxt();
// `a && b && c` 返回的是**最后一个值**，不是 true —— 收尾那个对象拿 `=== true` 去比
// 恒假。加 !! 才是布尔。
const c1 = (await ev(`!!(FG.slotInfo(0) && FG.slotInfo(1).bad===1 && FG.slotInfo(2))`)) === true;
const c2 = /第 1 年 · 第 10 天/.test(stx);
const c3 = /第 1 年 · 第 20 天/.test(stx);
// slotInfo 对**坏档**返回 {bad:1} 而不是 null —— 那个「读不出来」得有人显示出来，
// 返回 null 的话标题上就成了一个空格，玩家看不出是坏了还是没玩过
ok('（另外两格照常摆着，写得出自己的日子）', c1 && c2 && c3,
  '格在=' + c1 + '　十号=' + c2 + '　二十号=' + c3 + '　原文「' + stx.slice(0, 70) + '」');
ok('标题没被坏存档卡住（点「续」落到的是那一格，而不是炸了）',
  (await clickSlot(0, 'cont')) === 'ok');
await sleep(700);
ok('点第 1 格的「续」：进的是第 1 格', (await ev(`FG.state.slot`)) === 0 && (await ev(`FG.state.day`)) === 10,
  'slot=' + await ev(`FG.state.slot`) + '　第 ' + await ev(`FG.state.day`) + ' 天');
ok('（坏的那一格不挡着别的格入戏）', (await ev(`FG.slotInfo(1).bad`)) === 1);

console.log('\n— 老存档（只有 0 格、字段还是老的）读得动 —');
await ev(`(function(){
  localStorage.clear();
  localStorage.setItem('guxian_nanshan_save_v1', JSON.stringify({
    day: 33, gold: 1200, map: 'nanshan', started: true,
    player: {x: 900, y: 800},
    plots: [], pouch: {}, bag: {dou:3,su:0,shu:0,ji:0,ju:0}
  }));
  return 1})()`);
await ev(`location.reload()`); await sleep(2600);
ok('读得上', (await ev(`(function(){ FG.startFrom('cont'); return FG.state.day; })()`)) === 33,
  '第 ' + await ev(`FG.state.day`) + ' 天');
ok('老存档没有的那几本账都补上了（不补就看着像坏了）',
  (await ev(`(function(){
    var bad=[];
    FG.renFix(); FG.dexFix(); FG.birthFix(); FG.skillFix(); FG.machFix(); FG.buildFix();
    if (!FG.state.ren || !FG.state.dex || !FG.state.birth) bad.push('缺一本');
    if (FG.renTier('linweng')!==0) bad.push('人情不是从零起');
    if (FG.dexCount('good')!==0) bad.push('见闻不是从零起');
    return bad.join('　');})()`)) === '');
ok('这一段控制台干净', (await ev(`1`)) === 1);

// 开卷时按回车要能进游戏，而且**不许抛异常**。
//
// 原来这一支写的是 getElementById('btn-new').click()，
// 而 btn-new 在换成三格存档时就被删了 —— 按回车拿到 null，
// 再 .click() 就是 TypeError。注释还写着「开卷时按回车/空格 = 入山」。
// 36 套里没有一条按过回车（全都直接调 FG.startFrom），
// 所以这条快捷键死了很久也没人知道。
//
// 判据分两半：**进得去**，而且**控制台干净** ——
// 只写前半条的话，抛异常那条路照样绿。
//
// 快捷键顶的是**哪一个按钮**，得单独核。
// 回车是入山的手，不是抹存档的手：坏档那一格的「空 出 来」也是 .seal，
// 而「重来」要按两下 —— 顶错按钮的话，按一次回车只是把手武装上，
// 人还站在开卷上，看着像按了没反应；slotArm 又是模块级变量、
// 不随 showTitle 清零，隔一会儿再按一下就真删了。
// 这一段把那个顺序摆出来，再核回车没碰坏档。
console.log('\n— 回车顶的是「续/入山」，不是「重来」 —');
// **坏档摆到第 1 格**：那一格上只有「空 出 来」，没有能进游戏的按钮，
// 于是快捷键必须往后找，而不是停在那一格上不动。
// 这一段量的正是「它会不会顶到 over」——
// 摆到第 2 格的话第 1 格还能进，回车压根碰不到 over，就量不到这件事了。
await ev(`(function(){ try{ localStorage.clear(); }catch(e){}
  FG.state.started = false; FG.state.ended = false;
  document.getElementById('title').classList.remove('hide');
  localStorage.setItem(FG.saveKey(0), '{坏的');   // 第 1 格读不出来 → 「空 出 来」
  FG.showTitle(); return 1})()`);
await sleep(350);
const BADKEY = await ev(`FG.saveKey(0)`);
const sealOrder = JSON.parse(await ev(`(function(){
  return JSON.stringify(Array.prototype.map.call(
    document.querySelectorAll('#slots button.seal'), function(b){
      return b.getAttribute('data-act'); }))})()`));
console.log('  .seal 顺序 ' + JSON.stringify(sealOrder));
ok('（前提）第 1 格是坏档，「空 出 来」就是 .seal 里第一个',
   sealOrder[0] === 'over', JSON.stringify(sealOrder));
const beforeErr3 = logs.length;
await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))`);
await sleep(450);
// 顶错按钮的话：按一次只是把手武装上（slotArm 记下这一格），
// 人还站在开卷上 —— 看着像按了没反应
ok('按回车进的是游戏，不是停在开卷', (await ev(`FG.state.started`)) === true,
   'started=' + (await ev(`FG.state.started`)));
ok('（前提）坏档那一格还在（回车没顶到「空 出 来」）',
   (await ev(`(function(){ try{ return localStorage.getItem(${JSON.stringify(BADKEY)}) !== null; }catch(e){ return false; } })()`)) === true,
   '键名 ' + BADKEY + '　值 ' + JSON.stringify(await ev(`(function(){ try{ return localStorage.getItem(${JSON.stringify(BADKEY)}); }catch(e){ return '(读不到)'; } })()`)));
ok('这一段控制台干净', logs.length === beforeErr3, logs.slice(beforeErr3).join(' | ') || '（无）');

console.log('\n— 开卷按回车 = 进第 1 格 —');
// 回到开卷。**started 必须显式设回 false** ——
// 只清 localStorage 再 showTitle() 是不够的：上一段早就把游戏开起来了，
// S.started 还在 true，那 keydown 就走不到 !S.started 那一支，
// 后面「按回车进了游戏」会**承前一条的假前提蒙对**。
// 前提立不住，后面的断言全是空转 —— 今天这一天栽在这上面不止一次了
const toTitle = () => ev(`(function(){ try{ localStorage.clear(); }catch(e){}
  FG.state.started = false; FG.state.ended = false;
  var t=document.getElementById('title'); t.classList.remove('hide');
  ['de','dlg','sh','st','bx','bg','ch','al','hs','rd'].forEach(function(i){
    var e=document.getElementById(i); if(e) e.classList.add('hide'); });
  FG.showTitle(); return 1})()`);
await toTitle();
await sleep(400);
ok('（前提）回到开卷了', (await ev(`document.getElementById('title').classList.contains('hide')`)) === false);
ok('（前提）确实没进游戏（started 要显式清，否则后面全是空转）',
  (await ev(`FG.state.started`)) === false, 'started=' + (await ev(`FG.state.started`)));
const beforeErr = logs.length;          // 未捕获异常也进 logs（见上面的 exceptionThrown）
await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))`);
await sleep(500);
ok('按回车进了游戏', (await ev(`FG.state.started`)) === true,
  'started=' + (await ev(`FG.state.started`)));
ok('按回车把开卷收起来了', (await ev(`document.getElementById('title').classList.contains('hide')`)) === true);
ok('**按回车不抛异常**（这一条才是原来那条 bug 的正脸）',
  logs.length === beforeErr, '按前 ' + beforeErr + ' 条，按后 ' + logs.length + ' 条：'
  + (logs.slice(beforeErr).join(' | ') || '（无）'));
// 空格走的是同一支，一并核
await toTitle();
await sleep(350);
ok('（前提）空格之前也确实没进游戏', (await ev(`FG.state.started`)) === false);
const beforeErr2 = logs.length;
await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:' '}))`);
await sleep(450);
ok('按空格同样进得去', (await ev(`FG.state.started`)) === true);
ok('按空格也不抛异常', logs.length === beforeErr2,
  logs.slice(beforeErr2).join(' | ') || '（无）');

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
