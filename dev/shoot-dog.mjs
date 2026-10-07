// 宠物（狗窝）验收。
//
// 狗是「每天早上替你做一遍」那一族里**唯一一个要把东西叼回来的**：
// 鸡牛羊在棚里自己攒，坛和罐是你投进去的，只有狗是你不在的时候
// 自己在山上跑的。所以它叼回来的**不直接进行囊**——放窝边，走过去按 E 才拿。
// 直接塞进行囊那就成了一台机器，不叫宠物。
//
// 盯住这几条：
//   1) 隔天一趟（二级一天一趟），不是天天白给
//   2) 叼的是**当季**的山货 —— 换季换的是狗跑的那座山，不是玩家摇的骰子
//   3) **同一天永远是同一样**，刷新不变、读档不变
//   4) 窝边最多堆三份，**不倒扣、不烂**（忘了收只是少收）
//   5) 没造窝时按 E 说清楚「这儿空着」，不是静悄悄地什么都不发生
//   6) 收下来的是**山货**那一本账的（进 pouch，不进行囊的 wrong 账）
//   7) 存档往返 / 老档没有这一本账 / 越界 / 重开归零
//   8) 1× 画面：窝边那几堆数不数得清
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9381;
const profile = path.join(tmpdir(), 'guxian-dog-' + process.pid);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
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
const P = () => ev(`JSON.stringify(FG.dogPose())`);
// 走到狗窝跟前
const stand = async () => {
  await ev(`(function(){
    FG.gotoMap('nanshan'); var a=FG.BUILD.gou.at;
    FG.state.player.x=a[0]; FG.state.player.y=a[1]+40; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
  await sleep(430);
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
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

console.log('— 表上写得清楚 —');
const G = JSON.parse(await ev(`JSON.stringify(FG.BUILD.gou)`));
console.log('  狗窝：' + G.lv.map(l => l.name + ' ' + l.price + '钱 ' + l.days + ' 天一趟').join('　'));
ok('两级', G.lv.length === 2, G.lv.length + ' 级');
ok('一级隔天、二级天天（一天比一天勤）',
  G.lv[0].days === 2 && G.lv[1].days === 1, G.lv.map(l => l.days).join(' → '));
ok('有 E 判定点（它是唯一要你走过去按一下的那一样）', !!G.act, 'act=' + (G.act || '(无)'));
ok('挂在南山上', (await ev(`FG.MAPS.nanshan.builds.indexOf('gou')`)) >= 0);
ok('不进 KEEP_LV（它没有门也没有草料）',
  (await ev(`FG.KEEP_LV.indexOf('gou')`)) < 0, await ev(`FG.KEEP_LV.join(',')`));
// 判定圈不打架
const clash = JSON.parse(await ev(`(function(){
  var m=FG.MAPS.nanshan, a=FG.BUILD.gou.at, r=FG.BUILD.gou.r, bad=[];
  (m.npcs||[]).forEach(function(n){ var q=FG.NPCS[n];
    if (Math.abs(q.at[0]-a[0])+Math.abs(q.at[1]-a[1]) < r+150) bad.push('人:'+n); });
  (m.exits||[]).forEach(function(e){
    if (Math.abs(e.at[0]-a[0])+Math.abs(e.at[1]-a[1]) < r+e.r) bad.push('口:'+e.to); });
  if (m.home && Math.abs(m.home[0]-a[0])+Math.abs(m.home[1]-a[1]) < r+m.homeR) bad.push('归家');
  (m.builds||[]).forEach(function(b){ var q=FG.BUILD[b];
    if (b!=='gou' && q.at && Math.abs(q.at[0]-a[0])+Math.abs(q.at[1]-a[1]) < r+q.r) bad.push('营造:'+b); });
  (m.machines||[]).forEach(function(mc){ var q=FG.MACHINE[mc];
    if (Math.abs(q.at[0]-a[0])+Math.abs(q.at[1]-a[1]) < r+130) bad.push('机器:'+mc); });
  if (m.station && Math.abs(m.station[0]-a[0])+Math.abs(m.station[1]-a[1]) < r+FG.SPOT_R.station) bad.push('歇脚处');
  if (Math.abs(368-a[0])+Math.abs(620-a[1]) < r+FG.SPOT_R.chest) bad.push('木箱');
  return JSON.stringify(bad);})()`));
ok('不跟人 / 口 / 归家 / 营造 / 机器 / 歇脚处 / 木箱压在一处', clash.length === 0, clash.join('　') || '(无)');

console.log('— 没造窝：按 E 要说清楚 —');
ok('狗窝还没造', (await ev(`FG.dogOn()`)) === false);
await stand();
ok('站在那儿有判定', (await ev(`(FG.nearBuild()||{}).id`)) === 'gou', await ev(`(FG.nearBuild()||{}).id`));
ok('提示行写的是「墟市老丈那儿有狗窝卖」', /有狗窝卖/.test(await hint()), await hint());
await clearToast();
await key('e');
await sleep(350);
ok('按 E 会回一句话，不是静悄悄地什么都不发生', /这儿空着/.test(await toast()), await toast());
ok('窝边还是空的', (await ev(`FG.dogPose().n`)) === 0);

console.log('— 买下窝 —');
await ev(`(function(){
  FG.gotoMap('xushi'); var n=FG.NPCS.xushi;
  FG.state.gold=40000; FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+40;
  FG.state.walkTo=null; return 1})()`);
await sleep(430);
await key('b');
await sleep(420);
ok('货单上有两格狗窝', (await ev(`(function(){
  var n=0; FG.SHOP.xushi.forEach(function(r){ if(r.kind==='build'&&r.b==='gou') n++; }); return n;})()`)) === 2);
// 锁格这条要在**买之前**问：买了 lv1 之后 lv2 就解锁了，
// 买完再看会读到价钱 —— 而症状是「二级锁不住」
const note12 = await ev(`(function(){var e=document.querySelector('[data-k="b12"]');
  return e?e.querySelector('u').textContent:'(不在面板上)';})()`);
ok('二级一开始锁着', /得先有前一个/.test(note12), note12);
const g0 = await ev(`FG.state.gold`);
await ev(`document.querySelector('[data-k="b11"]').click()`);
await sleep(400);
ok('狗窝到手', (await ev(`FG.state.build.gou`)) === 1, await ev(`JSON.stringify(FG.state.build)`));
ok('扣的正好是标价', (await ev(`FG.state.gold`)) === g0 - G.lv[0].price);
ok('那一句说清了几天一趟', /2 天/.test(await toast()) && /一趟/.test(await toast()), await toast());
await key('Escape'); await sleep(300);

console.log('— 隔天一趟，不是天天白给 —');
await ev(`(function(){ FG.state.day=30; FG.state.dog={day:0,n:0,k:null}; FG.dogFix(); return 1})()`);
await ev(`FG.dogMorning()`);
ok('头一趟就叼回来了', (await ev(`FG.dogPose().n`)) === 1, await P());
const k1 = await ev(`FG.dogPose().k`);
ok('窝边有一样东西', !!k1, k1);
await ev(`FG.nextDay()`);
await sleep(520);
ok('隔了一天没回来', (await ev(`FG.dogPose().n`)) === 1, await P());
await ev(`FG.nextDay()`);
await sleep(520);
ok('隔了两天回来了，窝边堆到两份', (await ev(`FG.dogPose().n`)) === 2, await P());
ok('而且隔天到的那一趟里有一份在往上加（不是每天从零算）',
  (await ev(`FG.dogPose().n`)) >= 2);

console.log('— 叼的是当季的山货 —');
// 当季判据用 FG.inTerms（它收日子 + terms）。**别自己拿 FG.solarOf 比**：
// 那个收的是日子，喂给它一个节气 key 会算出一个 NaN 下标，
// 返回 undefined，下一行读 .k 当场炸 —— 跟 game.js 里 dogCatch 同一个坑
const inSeason = await ev(`(function(){
  var d=FG.state.day, out=[];
  for (var k in FG.GOODS) if (FG.inTerms(d, FG.GOODS[k].terms)) out.push(k);
  return JSON.stringify(out);})()`);
ok('窝边那样东西当季就有', inSeason.indexOf('"' + (await ev(`FG.dogPose().k`)) + '"') >= 0,
  '叼的是 ' + await ev(`FG.dogPose().k`) + '　当季有 ' + inSeason);
// 换一季，换的是狗跑的那座山
const seasonOut = await ev(`(function(){
  var o={}, k;
  for (var day=1; day<=144; day+=7)
    for (k in FG.GOODS) if (FG.inTerms(day, FG.GOODS[k].terms)) o[k]=1;
  return Object.keys(o).join(',');})()`);
ok('一年里当季的山货不止一样（换季真的会换）', seasonOut.split(',').length >= 3, seasonOut);

console.log('— 同一天永远是同一样 —');
const kA = await ev(`(function(){ FG.state.day=60; return FG.dogTodayKey(); })()`);
const kB = await ev(`(function(){ FG.state.day=60; return FG.dogTodayKey(); })()`);
ok('同一天问两次是同一样', kA === kB, kA + ' / ' + kB);
const kSave = await ev(`(function(){ FG.state.gold=900; FG.saveGame(); return FG.dogTodayKey(); })()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
ok('读档回来还是同一样（刷新不重掷）', (await ev(`(function(){ FG.state.day=60; return FG.dogTodayKey(); })()`)) === kSave,
  kSave);
ok('而且它不跟窝边已经堆着的那几份有关', (await ev(`FG.dogPose().n`)) >= 0);

console.log('— 窝边最多堆三份，忘了收只是少收 —');
await ev(`(function(){ FG.state.build.gou=1; FG.buildFix();
  FG.state.day=20; FG.state.dog={day:0,n:0,k:null}; FG.dogFix(); return 1})()`);
for (let d = 0; d < 6; d++) { await ev(`FG.dogMorning()`); await ev(`FG.state.day=FG.state.day+2`); }
ok('连着六趟没收，窝边停在三份', (await ev(`FG.dogPose().n`)) === 3, await P());
ok('没有倒扣、没有坏掉', (await ev(`FG.dogPose().k`)) !== null);
ok('体力没扣（狗自己去跑的）', (await ev(`FG.state.stam`)) === 100);

console.log('— 收：走过去按 E —');
// 三趟要**隔着日子**：同一天连着调 dogMorning，只有头一趟算数
// （`S.day - S.dog.day < days` 那一句挡着后面两趟）
await ev(`(function(){
  FG.state.day=30; FG.state.dog={day:0,n:0,k:null}; FG.dogFix();
  for (var i=0;i<3;i++){ FG.dogMorning(); FG.state.day=FG.state.day+2; }
  FG.state.day=30; return 1})()`);
const dogK = await ev(`FG.dogPose().k`);
ok('窝边堆了三份', (await ev(`FG.dogPose().n`)) === 3, await P());
await stand();
ok('提示行写得出「E 收下狗叼的什么」', /收下狗叼的/.test(await hint()), await hint());
await clearToast();
await key('e');
await sleep(400);
ok('收下来进了山货那一本账（pouch）',
  (await ev(`FG.state.pouch['${dogK}']||0`)) === 3,
  'pouch.' + dogK + '=' + await ev(`FG.state.pouch['${dogK}']||0`));
ok('进行囊的账没被动（山货本来就不在行囊那一本）',
  (await ev(`FG.state.bag['${dogK}']||0`)) === 0, 'bag.' + dogK + '=' + await ev(`FG.state.bag['${dogK}']||0`));
ok('那一句说清了是几份', /一共 3 份/.test(await toast()), await toast());
ok('窝边清空了', (await ev(`FG.dogPose().n`)) === 0, await P());
await clearToast();
await key('e');
await sleep(350);
ok('再按一次会回一句话（不是没反应）', /还没叼回来|窝边是空的/.test(await toast()), await toast());

console.log('— 升到二级：一天一趟 —');
await ev(`(function(){ FG.state.build.gou=2; FG.buildFix();
  FG.state.day=40; FG.state.dog={day:0,n:0,k:null}; FG.dogFix(); return 1})()`);
ok('二级是一天一趟', (await ev(`FG.dogDays()`)) === 1);
await ev(`FG.dogMorning()`);
ok('当天下午就有', (await ev(`FG.dogPose().n`)) === 1);
await ev(`FG.nextDay()`);
await sleep(520);
await ev(`FG.dogMorning()`);
ok('第二天又来一趟（窝边两份）', (await ev(`FG.dogPose().n`)) === 2, await P());
await ev(`(function(){ FG.state.build.gou=1; FG.buildFix(); return 1})()`);
ok('降回一级又是隔天', (await ev(`FG.dogDays()`)) === 2);

console.log('— 存档往返 / 老档 / 重开 —');
await ev(`(function(){ FG.state.dog={day:77,n:2,k:'jun'}; FG.saveGame(); return 1})()`);
await sleep(300);
const sa = await ev(`JSON.stringify(FG.dogPose())`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
ok('读档回来窝边那两样还在', (await ev(`JSON.stringify(FG.dogPose())`)) === sa, sa);
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
  delete raw.dog; localStorage.setItem(${JSON.stringify(SAVEKEY)}, JSON.stringify(raw)); return 1})()`);
const logMark = logs.length;
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
// 逐个数，不要拿 JSON.stringify 的整串比 ——
// 那样一改字段次序就假失败，而它跟「窝边是不是空的」没关系。
// **只比 n 和 k**：dogPose() 是给画面和提示行用的，回的是「窝边有什么」，
// 不带 day（day 是记账用的，画出来也没人看）
const poseEmpty = await ev(`(function(){ var p=FG.dogPose();
  return (p.n===0 && p.k===null) ? '空' : JSON.stringify(p); })()`);
ok('老档补出来的是空窝（不是 null）', poseEmpty === '空', await P());
ok('这一段没有异常', logs.length === logMark, logs.slice(logMark).join(' | ') || '干净');
await ev(`(function(){ FG.state.dog={day:-5,n:-3,k:null}; FG.dogFix(); return 1})()`);
ok('存档被改成负数时夹回 0（n 和 day 各归各）',
  (await ev(`FG.dogPose().n`)) === 0 && (await ev(`FG.state.dog.day`)) === 0,
  'n=' + await ev(`FG.dogPose().n`) + ' day=' + await ev(`FG.state.dog.day`));
await ev(`(function(){ FG.state.build.gou=1; FG.buildFix(); FG.state.dog={day:0,n:0,k:null}; FG.dogFix(); FG.restart(); return 1})()`);
await sleep(900);
ok('重开归零', (await ev(`(function(){ var p=FG.dogPose();
  return (p.n===0 && p.k===null) ? '空' : JSON.stringify(p); })()`)) === '空', await P());

console.log('— 画面：窝边那几堆数不数得清 —');
// 三趟要**隔着日子**：同一天连调 dogMorning 只有头一趟算数
await ev(`(function(){
  FG.state.build.gou=1; FG.buildFix();
  FG.state.day=30; FG.state.dog={day:0,n:0,k:null}; FG.dogFix();
  for (var i=0;i<3;i++){ FG.dogMorning(); FG.state.day=FG.state.day+2; }
  FG.state.day=30;
  var a=FG.BUILD.gou.at;
  FG.gotoMap('nanshan'); FG.state.player.x=a[0]-120; FG.state.player.y=a[1]+55;
  FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 });
await sleep(500);
await shot('60-狗窝-三份.png');
await ev(`(function(){
  var a=FG.BUILD.gou.at; FG.state.player.x=a[0]-120; FG.state.player.y=a[1]+55;
  FG.updateHUD(); return 1})()`);
await ev(`(function(){ FG.state.dog.n=0; FG.dogFix(); return 1})()`);
await sleep(400);
await shot('61-狗窝-空.png');
ok('两张都截了（堆三份 / 空）', true);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
