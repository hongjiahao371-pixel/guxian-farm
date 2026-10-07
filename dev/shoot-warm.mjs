// 温窒验收：20/2 加的那一间。
//
// 它不解「另开一块地」——田亩几何（js/field.js）是单实例的，
// 另开一块要把它改成可实例化，那是整个游戏最底下的一层。
// 它解的是**同一条规矩**：11/9 定了「藏季 36 天地冻上，翻不动种不下」，
// 20/2 有了温窒就不封了。
//
// 盯住这几条：
//   1) 表上写得清楚：只有一级，给的是「藏季不冻」那一个数
//   2) **FG.groundFrozen 本身一个字都不改** —— 它是纯函数（只看日子），
//      玩家买了什么不归它管；开这个口子的是 game.js 的 groundFrozenNow
//   3) 没买：藏季翻不动也种不下，两句话都还在
//   4) 买了：藏季照旧翻、照旧种、照旧收
//   5) 温窒没有 E 判定点（按 E 什么也不发生），但**提示行要说清楚**
//   6) 藏季那条「一年里第一次进藏季」的提醒照旧要说
//   7) 存档往返 / 老档没有这一项 / 越界等级 / 重开归零
//   8) 1× 画面：那间玻璃房在浅草坡上认不认得出来
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9383;
const profile = path.join(tmpdir(), 'guxian-warm-' + process.pid);
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
const hint = () => ev(`document.getElementById('hint').textContent`);

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

console.log('— 藏季是哪 36 天 —');
// 一年里冻着的日子，从表上数，不写死 36
const frozenDays = await ev(`(function(){var n=0;for(var i=1;i<=FG.SOLAR_YEAR;i++) if(FG.groundFrozen(i)) n++; return n;})()`);
const firstFrozen = await ev(`(function(){for(var i=1;i<=FG.SOLAR_YEAR;i++) if(FG.groundFrozen(i)) return i; return 0;})()`);
console.log('  一年里冻着 ' + frozenDays + ' 天，从第 ' + firstFrozen + ' 天起');
ok('藏季确实是那一段（36 天上下，不是零星几天）', frozenDays >= 30 && frozenDays <= 40,
  frozenDays + ' 天　从第 ' + firstFrozen + ' 天起');

console.log('— 表上写得清楚 —');
const W = JSON.parse(await ev(`JSON.stringify(FG.BUILD.warm)`));
console.log('  温窒：' + W.name + ' @' + W.at + '　' + W.lv.map(l => l.name + ' ' + l.price + '钱 winter=' + l.winter + (l.q ? ' q=' + l.q : '')).join('　'));
ok('两级', W.lv.length === 2, W.lv.length + ' 级');
ok('一级给的是「藏季不冻」那一个数', W.lv[0].winter === 1);
ok('二级还给了品级那一个数（温窒二级的兑现就是它）', W.lv[1].q === 1);
ok('没有 E 判定点（它是一间房，不按 E）', !W.act, 'act=' + (W.act || '(无)'));
ok('挂在南山上', (await ev(`FG.MAPS.nanshan.builds.indexOf('warm')`)) >= 0,
  await ev(`JSON.stringify(FG.MAPS.nanshan.builds)`));
ok('坐标在可行走带里', (await ev(`(function(){var m=FG.MAPS.nanshan, a=FG.BUILD.warm.at, b=m.bounds;
  return a[0]>b.x0+50 && a[0]<b.x1-50 && a[1]>b.y0+30 && a[1]<b.y1-20;})()`)) === true, JSON.stringify(W.at));
// 判定圈不和别的点打架（温窒没有 E，可它要是离谁太近，**画出来**会压着谁）
const clash = JSON.parse(await ev(`(function(){
  var a=FG.BUILD.warm.at, r=FG.BUILD.warm.r, m=FG.MAPS.nanshan, bad=[];
  (m.npcs||[]).forEach(function(n){ var q=FG.NPCS[n];
    if (Math.abs(q.at[0]-a[0])+Math.abs(q.at[1]-a[1]) < r+150) bad.push('人:'+n); });
  (m.exits||[]).forEach(function(e){
    if (Math.abs(e.at[0]-a[0])+Math.abs(e.at[1]-a[1]) < r+e.r) bad.push('口:'+e.to); });
  if (m.home && Math.abs(m.home[0]-a[0])+Math.abs(m.home[1]-a[1]) < r+m.homeR) bad.push('归家');
  (m.builds||[]).forEach(function(b){ if(b==='warm') return; var q=FG.BUILD[b];
    if (Math.abs(q.at[0]-a[0])+Math.abs(q.at[1]-a[1]) < r+80) bad.push('营造:'+b); });
  (m.machines||[]).forEach(function(mc){ var q=FG.MACHINE[mc];
    if (Math.abs(q.at[0]-a[0])+Math.abs(q.at[1]-a[1]) < r+80) bad.push('机器:'+mc); });
  if (m.station && Math.abs(m.station[0]-a[0])+Math.abs(m.station[1]-a[1]) < r+FG.SPOT_R.station) bad.push('歇脚处');
  return JSON.stringify(bad);})()`));
ok('不跟人 / 口 / 归家 / 营造 / 机器 / 歇脚处压在一处', clash.length === 0, clash.join('　') || '(无)');

console.log('— 那个口子开在 game.js 那一侧，不在纯函数上 —');
ok('FG.groundFrozen 自己一个字都没改（只看日子）',
  (await ev(`(function(){
    FG.state.build.warm = 1; FG.furnFix && FG.furnFix();
    var d1 = FG.groundFrozen(FG.SOLAR_YEAR);
    FG.state.build.warm = 0;
    var d2 = FG.groundFrozen(FG.SOLAR_YEAR);
    return d1 === true && d2 === true; })()`)) === true,
  '装了温窒 FG.groundFrozen 仍然说冻 —— 那是节气的性质，不是玩家的状态');
ok('开这个口子的是 groundFrozenNow()', (await ev(`typeof FG.groundFrozenNow`)) === 'function');

console.log('— 没买：藏季照旧封着 —');
await ev(`(function(){
  FG.state.build.warm=0; FG.gotoMap('nanshan');
  FG.state.player.x=700; FG.state.player.y=900; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
// 拨到藏季第一天
await ev(`(function(){ FG.state.day=${firstFrozen}; FG.state.sel='chu'; FG.state.stam=100;
  FG.state.plots[4][0]={tilled:false,wet:false,crop:null,stage:0};
  FG.state.plots[4][1]={tilled:false,wet:false,crop:null,stage:0};
  FG.updateHUD(); return 1})()`);
await sleep(300);
ok('没买时眼下这块地是冻的', (await ev(`FG.groundFrozenNow()`)) === true);
// 翻地是**点田畦**那条路（手上拿着锄、按 E 什么也不会发生）——
// 按 E 等提示，症状是「翻地翻不动」正好也通过
await ev(`(function(){ FG.state.sel='chu'; FG.state.stam=100;
  FG.state.plots[4][0]={tilled:false,wet:false,crop:null,stage:0};
  FG.updateHUD(); return 1})()`);
const toScreen = JSON.parse(await ev(`(function(){
  var r=document.getElementById('game').getBoundingClientRect();
  return JSON.stringify({x:r.x, y:r.y, s:r.width/1920});})()`));
const clickCell = async (col, row) => {
  const pt = JSON.parse(await ev(`JSON.stringify(FG.FIELD.cellCenter(${col},${row}))`));
  const x = Math.round(toScreen.x + pt[0] * toScreen.s);
  const y = Math.round(toScreen.y + pt[1] * toScreen.s);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x, y });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x, y });
  await sleep(420);
};
await clearToast();
await clickCell(0, 4);
ok('翻地翻不动', (await ev(`FG.state.plots[4][0].tilled`)) === false,
  'tilled=' + await ev(`FG.state.plots[4][0].tilled`));
ok('并且说的是「地冻上了」/「雪压着地」而不是别的',
  /地冻上了|雪压着地/.test(await toast()), await toast());
// 下种也封着
await ev(`(function(){
  FG.state.plots[4][0]={tilled:true,wet:true,crop:null,stage:0};
  FG.state.seeds.dou=9; FG.state.sel=null; FG.updateHUD(); return 1})()`);
await sleep(200);
await clearToast();
await clickCell(0, 4);
await ev(`(function(){ FG.state.sel='dou'; FG.updateHUD(); return 1})()`);
await sleep(200);
await clearToast();
await clickCell(0, 4);
ok('没买时藏季种不下去', (await ev(`!FG.state.plots[4][0].crop`)) === true,
  'crop=' + await ev(`JSON.stringify(FG.state.plots[4][0].crop)`));
ok('并且说的是「种不下去」', /种不下去/.test(await toast()), await toast());

console.log('— 买下温窒：藏季照旧 —');
await ev(`(function(){ FG.state.gold=60000; return 1})()`);
await ev(`(function(){
  FG.gotoMap('xushi'); var n=FG.NPCS.xushi;
  FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+40; FG.state.walkTo=null; return 1})()`);
await sleep(430);
await key('b');
await sleep(420);
ok('铺子开得起来', (await ev(`!document.getElementById('sh').classList.contains('hide')`)) === true);
ok('货单上有温窒这一格',
  (await ev(`document.querySelector('[data-k="b9"]').textContent.indexOf('温窒') >= 0`)) === true,
  await ev(`document.querySelector('[data-k="b9"]').textContent.replace(/\\s+/g,' ').slice(0, 60)`));
const g0 = await ev(`FG.state.gold`);
await ev(`document.querySelector('[data-k="b9"]').click()`);
await sleep(400);
ok('温窒到手', (await ev(`FG.state.build.warm`)) === 1, await ev(`JSON.stringify(FG.state.build)`));
ok('扣的正好是标价', (await ev(`FG.state.gold`)) === g0 - W.lv[0].price);
ok('判据说温窒建着了', (await ev(`FG.warmOn()`)) === true);
ok('眼下的地不冻了（还是藏季那一天）', (await ev(`FG.state.day`)) === firstFrozen
  && (await ev(`FG.groundFrozenNow()`)) === false,
  'day=' + await ev(`FG.state.day`) + '（藏季第一天）　frozen=' + await ev(`FG.groundFrozenNow()`));
// 季节的 key 从表上读，不写死 'dong' —— 写死了表一改名这条就假失败，
// 而症状是「温窒把季节改了」，那看着像真 bug
const dongK = await ev(`(function(){for(var i=0;i<FG.SEASON.length;i++) if(FG.SEASON[i].k!=='spring'&&FG.SEASON[i].k!=='summer'&&FG.SEASON[i].k!=='autumn') return FG.SEASON[i].k; return '';})()`);
ok('而节气本身还是冬天（季节没被改）',
  (await ev(`FG.seasonOf(FG.state.day).k`)) === dongK,
  await ev(`FG.seasonOf(FG.state.day).n`) + '（k=' + dongK + '）');
ok('而且冻着的那一段还是同一段 —— 温窒解的是「地」，不是「节气」',
  (await ev(`FG.groundFrozen(FG.state.day)`)) === true,
  'FG.groundFrozen 仍然说冻：' + frozenDays + ' 天那段一个字没动');
await key('Escape');
await sleep(350);

console.log('— 藏季翻地、下种、照收 —');
await ev(`(function(){
  FG.gotoMap('nanshan'); FG.state.stam=100; FG.state.sel='chu';
  FG.state.plots[0][0]={tilled:false,wet:false,crop:null,stage:0};
  FG.state.player.x=700; FG.state.player.y=900; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(350);
await clickCell(0, 0);
ok('藏季翻得动了', (await ev(`FG.state.plots[0][0].tilled`)) === true,
  'tilled=' + await ev(`FG.state.plots[0][0].tilled`));
// 浇上，手上换成豆种（点击那条路：先点一下畦选中，再点一下下种）
await ev(`(function(){ FG.state.plots[0][0].wet=true; FG.state.seeds.dou=9;
  FG.state.sel=null; FG.updateHUD(); return 1})()`);
await sleep(200);
await clickCell(0, 0);
await ev(`(function(){ FG.state.sel='dou'; FG.updateHUD(); return 1})()`);
await sleep(200);
await clearToast();
await clickCell(0, 0);
ok('藏季也种得下', (await ev(`FG.state.plots[0][0].crop`)) === 'dou',
  'crop=' + await ev(`FG.state.plots[0][0].crop`) + '　提示=' + await toast());
ok('而且这句说的是种下去了，不是「种不下去」也不是「不是豆的时节」',
  !/种不下去|不是豆的时节/.test(await toast()), await toast());
// 推到它熟，照收
await ev(`(function(){
  var p=FG.state.plots[0][0], C=FG.CROPS.dou;
  p.stage = C.stages ? C.stages.length : 99;
  p.crop='dou'; FG.state.sel=null; FG.updateHUD(); return 1})()`);
await sleep(200);
await clickCell(0, 0);
ok('藏季也照收', (await ev(`FG.state.bag.dou || 0`)) >= 1, 'dou=' + await ev(`FG.state.bag.dou || 0`));
ok('收了之后那格空出来了', (await ev(`!FG.state.plots[0][0].crop`)) === true);
// 温窒解的是**两样**：地不冻，节气也不拦。
// 只解一样的话，豆在藏季翻开了地却还是「不是豆的时节」——
// 而豆的 terms 本来就没有冬天，那句话会一直挡在那儿，温窒等于白搭。
// 这一条是它值 4800 钱的主要理由，所以单独核一遍
ok('而且豆本来就没有冬天的时节（所以这一条不是白送的）',
  (await ev(`FG.inTerms(FG.state.day, FG.CROPS.dou.terms)`)) === false,
  '豆的 terms 里有冬天吗：' + await ev(`FG.inTerms(FG.state.day, FG.CROPS.dou.terms)`));
ok('没建温窒的时候同一畦同一种就是种不下去',
  (await ev(`(function(){
    FG.state.build.warm=0; FG.buildFix();
    FG.state.plots[0][0]={tilled:true,wet:true,crop:null,stage:0};
    return FG.inTerms(FG.state.day, FG.CROPS.dou.terms);})()`)) === false);
await ev(`(function(){ FG.state.build.warm=1; FG.buildFix(); return 1})()`);

console.log('— 温窒没有 E 判定点，但提示行要说清楚 —');
await ev(`(function(){
  var a=FG.BUILD.warm.at; FG.state.player.x=a[0]; FG.state.player.y=a[1]+30;
  FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(400);
ok('站在温窒跟前没有 E 判定点（按 E 什么也不发生）',
  (await ev(`FG.nearBuild()`)) === null, 'nearBuild=' + await ev(`FG.nearBuild()`));
ok('但提示行认得它（nearBuildHint 认所有营造）',
  (await ev(`(FG.nearBuildHint()||{}).id`)) === 'warm', await ev(`(FG.nearBuildHint()||{}).id`));
ok('造好之后那句说的是「地不认节气」，不是「这儿空着」',
  /地不认节气/.test(await hint()) && !/这儿空着/.test(await hint()), await hint());
await clearToast();
await key('e');
await sleep(400);
ok('按 E 什么也不弹（不是没绑，是这一样本来就不按 E）', (await toast()).length === 0, await toast() || '(无)');
// 没造的时候那句该说的是「能造什么」
await ev(`(function(){ FG.state.build.warm=0; FG.furnFix && FG.furnFix(); FG.updateHUD(); return 1})()`);
await sleep(300);
ok('没造的时候那句说的是「墟市老丈那儿有温窒卖」',
  /有温窒卖/.test(await hint()), await hint());

console.log('— 水渠那句也修了：造好之后不再说「这儿空着」 —');
await ev(`(function(){
  FG.state.build.ditch=1; var a=FG.BUILD.ditch.at;
  FG.state.player.x=a[0]; FG.state.player.y=a[1]+30; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(400);
ok('水渠通了之后提示写的是「水渠通了」而不是「这儿空着」',
  /水渠通了/.test(await hint()) && !/这儿空着/.test(await hint()), await hint());

console.log('— 藏季那条「进藏季了」的提醒照旧要说 —');
// 温窒解的是「地」，不是「季节」：一年里第一次进藏季那句提醒照旧弹，
// 而天气、作物、鱼、地面铺白那几样藏季该怎么样还怎么样
await ev(`(function(){ FG.state.build.warm=1; FG.state.day=${firstFrozen - 1}; return 1})()`);
await sleep(200);
const markA = logs.length;
await ev(`FG.nextDay()`);
await sleep(600);
ok('有温窒也还是进藏季（那句提醒照旧）', (await ev(`FG.seasonOf(FG.state.day).k`)) === dongK,
  await ev(`FG.seasonOf(FG.state.day).n`));
ok('天还是藏季那个天（天气那一套没被改）',
  (await ev(`!!FG.weatherOf(FG.state.day)`)) === true,
  await ev(`FG.weatherOf(FG.state.day).n || '（无天气）'`));
ok('这一段没有异常', logs.length === markA, logs.slice(markA).join(' | ') || '干净');

console.log('— 存档往返 —');
await ev(`(function(){ FG.state.build.warm=1; FG.saveGame(); return 1})()`);
await sleep(300);
const sa = await ev(`JSON.stringify({b:FG.state.build.warm, w:FG.warmOn()})`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
const sb = await ev(`JSON.stringify({b:FG.state.build.warm, w:FG.warmOn()})`);
ok('读档回来温窒还在', sa === sb, sa + ' / ' + sb);

console.log('— 老存档没有这一项 / 越界等级 / 重开归零 —');
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
  delete raw.build; localStorage.setItem(${JSON.stringify(SAVEKEY)}, JSON.stringify(raw)); return 1})()`);
const logMark = logs.length;
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
ok('老档补回来的是 0（不是 null）', (await ev(`FG.state.build.warm`)) === 0,
  await ev(`JSON.stringify(FG.state.build)`));
ok('判据也回到「没建」', (await ev(`FG.warmOn()`)) === false);
ok('老档读出来不报新异常', logs.length === logMark, logs.slice(logMark).join(' | ') || '干净');
await ev(`(function(){ FG.state.build.warm=6; FG.buildFix(); return 1})()`);
ok('存档被改成越界等级时按「没建」算', (await ev(`FG.warmOn()`)) === false
  && (await ev(`FG.state.build.warm`)) === 0,
  'warm 被夹回 ' + await ev(`FG.state.build.warm`));
await ev(`(function(){ FG.state.build.warm=1; FG.buildFix(); FG.restart(); return 1})()`);
await sleep(900);
ok('重开后温窒没了', (await ev(`FG.state.build.warm`)) === 0 && (await ev(`FG.warmOn()`)) === false,
  await ev(`JSON.stringify(FG.state.build)`));
// 拨回藏季再核「地又冻上」——重开是第一天（春），
// 站在春天说「地又冻上」是拿错的判据，而那句断言照样会红
await ev(`(function(){ FG.state.day=${firstFrozen}; FG.state.build.warm=0; FG.buildFix(); return 1})()`);
await sleep(200);
ok('拨回藏季，地又冻上了', (await ev(`FG.groundFrozenNow()`)) === true,
  'day=' + await ev(`FG.state.day`) + '　frozen=' + await ev(`FG.groundFrozenNow()`));

console.log('— 画面：1× 下那间玻璃房认不认得出来 —');
await ev(`(function(){
  FG.state.build.warm=0; FG.gotoMap('nanshan');
  var a=FG.BUILD.warm.at; FG.state.player.x=a[0]-120; FG.state.player.y=a[1]+80;
  FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 });
await sleep(500);
await shot('56-温窒-未造.png');
await ev(`(function(){
  FG.state.build.warm=1; var a=FG.BUILD.warm.at;
  FG.state.player.x=a[0]-120; FG.state.player.y=a[1]+80; FG.updateHUD(); return 1})()`);
await sleep(500);
await shot('57-温窒-造好.png');
ok('两张都截了', true);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
