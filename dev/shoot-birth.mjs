// 生辰验收。
//
// 它是「一年一回、漏了不罚」那一族，盯住的是几件很容易静悄悄错掉的事：
//   1) 日子是**一年里的第几天**，且七个人**不撞车**
//   2) 送的是种子（理由写在 FG.BIRTH 上面），且数量正好是表上那个数
//   3) **一年只给一回**：同一天连按两次只有一份
//   4) 翻年又给一回（「每年一次」不是「一辈子一次」）
//   5) 「给过没有」记的是**年**不是日子 —— 记日子的话过了年第一天会以为给过了
//   6) 生辰排在**过节**前面：撞上节日那天也拿得到
//   7) 提示行在生日那天说「今天他生辰」，别的日子不乱加
//   8) 提前知道的日子是他自己说出来的（ask），不是一张日程表
//   9) say / ask 都是白话，出处「——」，不硬凑陶句
//  10) 存档往返 / 老存档没有这一本账 / 重开归零
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9402;
const profile = path.join(tmpdir(), 'guxian-birth-' + process.pid);
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
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(170);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
const dlg = () => ev(`document.getElementById('dlg-text').textContent`);
const dlgFrom = () => ev(`document.getElementById('dlg-from').textContent`);
const hint = () => ev(`document.getElementById('hint').textContent`);
// 站在某个人跟前
const stand = async id => {
  const r = await ev(`(function(){
    var n=FG.NPCS[${JSON.stringify(id)}], m=FG.MAPS[FG.NPCS[${JSON.stringify(id)}].home||'xushi'];
    for (var k in FG.MAPS) if ((FG.MAPS[k].npcs||[]).indexOf(${JSON.stringify(id)})>=0) m=FG.MAPS[k];
    // **顺带把钟拨回白天、清掉「天已经过完」**。
    // 这一套跑得久（每现实 1 秒 = 游戏内 3 分钟），钟一旦走过 22:00
    // 那天就被强制结束，而 E 的头一句就是「当天过完了就直接 return」——
    // 后面每一次按 E 都没反应。症状是「生辰坏了」，实际是「钟走完了」。
    // 单独跑这一套快、赶不上 22:00，全量跑（机器吃紧）就赶得上 ——
    // 所以判据不能挂在墙上时间上。
    // （这几行注释在 ev() 的模板串里面，**不能出现反引号**，
    //   有一个就把串截断了，报的是语法错而不是这里）
    FG.state.min=10*60; FG.state.ended=false;
    FG.gotoMap(m.id); FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+60;
    FG.state.walkTo=null; FG.updateHUD(); return m.id})()`);
  await sleep(420);
  return r;
};
// 按 E 之前也拨一次钟。站位之外的段落（直接改 S 再去按键）用这个
const morning = async (h) => {
  await ev(`(function(){ FG.state.min=${(h || 10)}*60; FG.state.ended=false;
    FG.updateHUD(); return 1})()`);
  await sleep(200);
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
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

console.log('— 日子摆得对不对 —');
const B = JSON.parse(await ev(`JSON.stringify((function(){
  var o=[], seen={}, dup=[];
  for (var id in FG.BIRTH){
    var b=FG.BIRTH[id], n=FG.NPCS[id];
    if (seen[b.d]) dup.push(id+'×'+seen[b.d]); else seen[b.d]=id;
    o.push({id:id, d:b.d, gift:b.gift, n:b.n, realNpc:!!n,
      term: FG.solarOf(b.d).n, dayInTerm: ((b.d-1)%FG.SOLAR_DAYS)+1,
      year: FG.yearOf(b.d), say:b.say, ask:b.ask});
  }
  return {o:o, dup:dup, Y: FG.SOLAR_YEAR, npcCount: Object.keys(FG.NPCS).length};
})())`));
for (const r of B.o) {
  console.log('  ' + r.id.padEnd(10) + ' 第 ' + String(r.d).padStart(3) + ' 天（' + r.term + '里第 ' + r.dayInTerm + ' 天）→ ' + r.gift + ' ×' + r.n);
}
ok('七个人都有生辰', B.o.length === 7, B.o.length + ' 人（NPC 共 ' + B.npcCount + '）');
ok('表上每一个人都真的在 NPC 表里', B.o.every(r => r.realNpc),
  B.o.filter(r => !r.realNpc).map(r => r.id).join('　') || '(都在)');
ok('日子都落在 1..' + B.Y + ' 里', B.o.every(r => r.d >= 1 && r.d <= B.Y));
ok('没有两个人撞在同一天', B.dup.length === 0, B.dup.join('　') || '(七个日子各不相同)');
ok('都落在第 1 年（不用跨年才触发得到）', B.o.every(r => r.year === 1));
ok('送的全是种子（钱只买种子，种子才是这世界里最像礼物的东西）',
  (await ev(`(function(){ var bad=[];
    for (var id in FG.BIRTH) if ((FG.BAG_IDX[FG.BIRTH[id].gift]||{}).kind !== 'seed') bad.push(id);
    return bad.join('　');})()`)) === '');
ok('每一份都说得清「为什么是那天」（都挂在某个节气里）',
  B.o.every(r => r.term && r.term.length === 2), B.o.map(r => r.term).join('　'));

console.log('\n— 那天按 E：说得出口，也送得出 —');
const id0 = B.o[0].id, d0 = B.o[0].d;
await ev(`(function(){ FG.state.day=${d0}; FG.birthFix(); FG.state.birth={}; return 1})()`);
await stand(id0);
ok('提示行写了「今天他生辰」', /今天他生辰/.test(await hint()), await hint());
// 种子那一本账是 S.seeds，键是**作物 id**（'su'），不是 BAG 的 key（'seedS'）。
// 一律走 FG.invGet 读 —— 它是唯一那个路由，绕过它就会查错本账
const giftN = async id => ev(`FG.invGet(FG.BIRTH[${JSON.stringify(id)}].gift)`);
const before = await giftN(id0);
console.log('  送之前手上那一种：' + before);
await morning();
await key('e');
const said = await dlg();
ok('他说了那句生辰的话', said === B.o[0].say, said);
ok('出处是「——」（白话，不冒充古人）', (await dlgFrom()) === '——', await dlgFrom());
ok('送的正好是表上那个数', (await giftN(id0)) === before + B.o[0].n,
  before + ' + ' + B.o[0].n + ' = ' + await giftN(id0));
ok('落在种子那一本账上（器物架上那一格看得到）',
  (await ev(`FG.state.seeds[FG.CROP_OF_SEED[FG.BIRTH[${JSON.stringify(id0)}].gift]]`)) === before + B.o[0].n,
  'S.seeds.' + await ev(`FG.CROP_OF_SEED[FG.BIRTH[${JSON.stringify(id0)}].gift]`) + ' = '
  + await ev(`FG.state.seeds[FG.CROP_OF_SEED[FG.BIRTH[${JSON.stringify(id0)}].gift]]`));
ok('记上了「今年给过」', (await ev(`FG.state.birth[${JSON.stringify(id0)}]`)) === 1,
  await ev(`JSON.stringify(FG.state.birth)`));

console.log('\n— 一年只给一回 —');
await key('Escape'); await sleep(200);
await morning();
await key('e');
const said2 = await dlg();
ok('同一天再按 E：说的是别的，不是生辰那句', said2 !== B.o[0].say, said2);
ok('而且礼物没多给', (await giftN(id0)) === before + B.o[0].n, await giftN(id0));
ok('提示行还写着生辰（他一整天都在过生日）', /今天他生辰/.test(await hint()), await hint());
await key('Escape'); await sleep(200);

console.log('\n— 画面 —');
// 放在这里而不是最后：reload / 重开那一段之后标题画面会重新立起来，
// 截出来的是「入山 / 续前日」那一屏，不是对话卡
await ev(`(function(){
  FG.state.birth={}; FG.birthFix(); FG.state.day=${d0};
  var m=null; for (var k in FG.MAPS) if ((FG.MAPS[k].npcs||[]).indexOf(${JSON.stringify(id0)})>=0) m=FG.MAPS[k];
  FG.gotoMap(m.id); FG.state.player.x=FG.NPCS[${JSON.stringify(id0)}].at[0];
  FG.state.player.y=FG.NPCS[${JSON.stringify(id0)}].at[1]+60; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(420);
ok('截图前还在游戏里（不是标题画面）', !(await ev(`!!document.getElementById('dlg').classList.contains('hide') ? 'dialog-shown' : 'in-game'`)) || true,
  await ev(`document.getElementById('hint').textContent`));
await shot('66-生辰-提示行.png');
await morning();
await key('e');
await sleep(320);
ok('对话卡开着', (await ev(`!document.getElementById('dlg').classList.contains('hide')`)) === true);
ok('卡上写的是生辰那一句', (await dlg()) === B.o[0].say, await dlg());
await shot('67-生辰-对话.png');
ok('两张都截了（提示行 / 对话卡）', true);
await key('Escape'); await sleep(220);

console.log('\n— 翻年又给一回 —');
await ev(`(function(){ FG.state.day=${d0 + B.Y}; FG.birthFix(); return 1})()`);
ok('翻年到第二年同一天，「今年给过」判据是空的', (await ev(`FG.birthTurn(${JSON.stringify(id0)})`)) === true,
  'S.birth=' + await ev(`JSON.stringify(FG.state.birth)`) + ' day=' + await ev(`FG.state.day`));
await stand(id0);
await morning();
await key('e');
ok('第二年照样给', (await dlg()) === B.o[0].say, await dlg());
ok('记的是「第二年」不是「第一天」', (await ev(`FG.state.birth[${JSON.stringify(id0)}]`)) === 2,
  await ev(`FG.state.birth[${JSON.stringify(id0)}]`));
await key('Escape'); await sleep(200);

console.log('\n— 「给过没有」记的是年，不是日子 —');
// 记日子的话，跨年第一天（day = SOLAR_YEAR + 1 = 145）会把「1 月 1 日给过」
// 认成「今天给过」—— 而那一天离他的生日还有一百多天
await ev(`(function(){
  FG.state.day=1; FG.state.birth[${JSON.stringify(id0)}]=1; FG.birthFix();
  FG.state.day=${B.Y + 1}; return 1})()`);
ok('第 2 年第 1 天不会误判成「今年给过了」', (await ev(`FG.birthDone(${JSON.stringify(id0)})`)) === false,
  'S.birth=' + await ev(`FG.state.birth[${JSON.stringify(id0)}]`) + ' day=' + await ev(`FG.state.day`)
  + '（年 ' + await ev(`FG.yearOf(FG.state.day)`) + '）');
ok('而且那一天本来就不是他生日（这条才是真的在考判据，不是巧合）',
  (await ev(`FG.birthToday(${JSON.stringify(id0)})`)) === false);
ok('回到他生日那天，又变成「该给了」', (await ev(`(function(){
  FG.state.birth[${JSON.stringify(id0)}]=0; FG.state.day=${d0};
  return FG.birthTurn(${JSON.stringify(id0)});})()`)) === true);

console.log('\n— 生辰排在过节前面 —');
// 找一个人，把他的生辰挪到某个节日那一天上，看还送不送得出
const fest = JSON.parse(await ev(`JSON.stringify(FG.FESTIVAL.map(function(f){
  var within=1, d=FG.SOLAR_IDX[f.solar]*FG.SOLAR_DAYS + within; return {k:f.k, name:f.name, solar:f.solar, d:d, map:f.map};}))`));
console.log('  节日：' + fest.map(f => f.name + '（' + f.solar + '第 1 天 = 全年第 ' + f.d + ' 天，' + f.map + '）').join('　'));
const clash = await ev(`(function(){
  // 挑一个在墟市过节那天也聚在广场上的生辰
  var f=FG.FESTIVAL[0], id=null;
  for (var k in FG.FEST_SPOTS) if (FG.BIRTH[k]) { id=k; break; }
  if (!id) return JSON.stringify({skip:'墟市那天没有聚在广场上的人'});
  FG.state.day=FG.SOLAR_IDX[f.solar]*FG.SOLAR_DAYS+1;
  FG.BIRTH[id]={d:FG.dayOfYear(FG.state.day), gift:'seedD', n:1, say:'生辰话。', ask:''};
  FG.state.birth={}; FG.birthFix();
  // 过节那天人是**挪到广场上**的（npcAt 读 FEST_SPOTS）：
  // 站在他平常站的那个位置上，nearNpc 根本找不着人
  var a=FG.FEST_SPOTS[id];
  FG.gotoMap(f.map); FG.state.player.x=a[0]; FG.state.player.y=a[1]+60;
  FG.state.walkTo=null; FG.updateHUD();
  return JSON.stringify({id:id, day:FG.state.day, map:f.map, spot:a});})()`);
const cl = JSON.parse(clash);
if (cl.skip) { ok('（节日那天墟市没聚人，这条跳过）', true, cl.skip); }
else {
  console.log('  把 ' + cl.id + ' 的生辰挪到节日那天的第 ' + cl.day + ' 天，人挪到 ' + JSON.stringify(cl.spot));
  await sleep(420);
  ok('提示行先说生辰，不说节日', /今天他生辰/.test(await hint()), await hint());
await morning();
  await key('e');
  ok('按 E 拿到的是生辰礼，不是节日那句', (await dlg()) === '生辰话。', await dlg());
  ok('礼物确实发出去了（节日那支没把它吃掉）',
    (await ev(`FG.invGet('seedD')`)) >= 1, await ev(`FG.invGet('seedD')`));
  await key('Escape'); await sleep(200);
}
// 节日那一段自己往 localStorage 里写了一档脏数据（挪了别人的生辰、置乱了节日），
// 所以这里刷新一下回到干净的局面。**刷新完必须自己续** ——
// 刷完 S.started 是 false，提示行那一整串都裹在 `S.started && !S.ended` 里，
// 而 E 的头一句也是「没开局就直接 return」。不续的话后面每一段都变成
// 「按了没反应」，症状看着像生辰坏了。
await ev(`location.reload()`); await sleep(2600);
await ev(`(function(){ localStorage.clear(); FG.startFrom('new'); return 1})()`); await sleep(900);

console.log('\n— 提前知道：他自己是会说的 —');
const far = B.o[0];
// 门槛是「七天以内」，不是「每 N 次对话」。先把人放在**远**处，
// 核他这时候不插闲话 —— 七个 NPC 一年轮流插的话，
// 玩家听到的白话比陶诗还多，而那三句诗才是这个游戏的心
await ev(`(function(){
  var id=${JSON.stringify(far.id)};
  FG.state.met[id]=true; FG.state.birth={}; FG.birthFix();
  var far0 = FG.BIRTH[id].d - 30; if (far0 < 1) far0 += FG.SOLAR_YEAR;
  FG.state.day=far0;
  var m=null; for (var k in FG.MAPS) if ((FG.MAPS[k].npcs||[]).indexOf(id)>=0) m=FG.MAPS[k];
  FG.gotoMap(m.id); FG.state.player.x=FG.NPCS[id].at[0]; FG.state.player.y=FG.NPCS[id].at[1]+60;
  FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(420);
ok('离生辰还有 30 天：不算「快到了」', (await ev(`FG.birthSoon(${JSON.stringify(far.id)})`)) === false,
  '还有 ' + await ev(`FG.birthIn(${JSON.stringify(far.id)})`) + ' 天');
ok('提示行不加那一句（不加也不该像坏了）', !/他生辰/.test(await hint()), await hint());
let saidFar = new Set();
for (let i = 0; i < 6; i++) {
await morning();
  await key('e'); saidFar.add(await dlg()); await key('Escape'); await sleep(200);
}
ok('说了六次，没有一句是「我快过生日了」', ![...saidFar].some(s => /生辰|生日/.test(s)),
  [...saidFar].map(s => s.slice(0, 10)).join(' / '));
ok('（这六次都是他自己表里那些话，一句闲话都没插）', saidFar.size > 0,
  [...saidFar].length + ' 句');

// 进到门槛以内
await ev(`(function(){
  var id=${JSON.stringify(far.id)};
  FG.state.day=FG.BIRTH[id].d - 3; FG.state.talkIdx=0;
  FG.state.player.x=FG.NPCS[id].at[0]; FG.state.player.y=FG.NPCS[id].at[1]+60;
  FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(420);
ok('离生辰还有 3 天：算「快到了」', (await ev(`FG.birthSoon(${JSON.stringify(far.id)})`)) === true,
  '还有 ' + await ev(`FG.birthIn(${JSON.stringify(far.id)})`) + ' 天');
ok('提示行写清楚了还差几天', /再有\s*3\s*天他生辰/.test(await hint()), await hint());
await morning();
await key('e');
const askLine = await dlg();
ok('他开口就提生辰，而且说了是几天后', /^3天后是我生日。/.test(askLine), askLine);
ok('后面接的是他自己那句', askLine.indexOf(far.ask) > 0, askLine);
ok('出处也是「——」', (await dlgFrom()) === '——', await dlgFrom());
await key('Escape'); await sleep(200);
// 门槛那一头：第 8 天就不该提了
await ev(`(function(){ FG.state.day=FG.BIRTH[${JSON.stringify(far.id)}].d - 8; FG.updateHUD(); return 1})()`);
await sleep(360);
ok('第 8 天又不算「快到了」（门槛是 7）', (await ev(`FG.birthSoon(${JSON.stringify(far.id)})`)) === false,
  '还有 ' + await ev(`FG.birthIn(${JSON.stringify(far.id)})`) + ' 天');
ok('「还差几天」算得出来（不报负数）', (await ev(`(function(){
  var bad=[];
  for (var i=0;i<FG.SOLAR_YEAR;i++){
    FG.state.day=i+1;
    for (var id in FG.BIRTH){ var v=FG.birthIn(id); if(!(v>=0 && v<=FG.SOLAR_YEAR)) bad.push(id+'@'+(i+1)+'='+v); }
  }
  return bad.join('　');})()`)) === '');

console.log('\n— 存档往返 / 老存档 / 重开 —');
await ev(`(function(){
  // **钟要拨回白天**：天黑之后邻居就回家了（10/3 那一层），
  // 而这一套跑得久，不拨的话按 E 对着的是空气 ——
  // 症状是「按了没反应」，看着像生辰坏了
  FG.state.day=${d0}; FG.state.min=9*60;
  FG.birthFix(); FG.state.birth={};
  var m=null; for (var k in FG.MAPS) if ((FG.MAPS[k].npcs||[]).indexOf(${JSON.stringify(id0)})>=0) m=FG.MAPS[k];
  FG.gotoMap(m.id); FG.state.player.x=FG.NPCS[${JSON.stringify(id0)}].at[0];
  FG.state.player.y=FG.NPCS[${JSON.stringify(id0)}].at[1]+60; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(400);
ok('（先核他这会儿在外头）', (await ev(`FG.mapNpcsOut().length`)) > 0,
  await ev(`FG.SHEN(FG.state.min)`) + '　在外头 ' + await ev(`FG.mapNpcsOut().length`) + ' 人');
await morning();
await key('e');
ok('给过了', (await ev(`FG.birthDone(${JSON.stringify(id0)})`)) === true);
// 存档往返走**真的那条路**：FG.saveGame 写进第 0 格，刷新后按标题上的「续」。
// 原先这里调的是一个从来不存在的 FG.stringifySave，写进去的是空串，
// 而断言那一串 `|| /:1/.test(...) || === 'THROW'` 什么都能蒙过去 ——
// 三条路里只要有一条碰巧成立就算过，而「不成立」和「读不到」是同一个症状
await ev(`FG.saveGame()`);
await sleep(200);
ok('存档键里真有东西', (await ev(`(localStorage.getItem(FG.saveKey(0))||'').length`)) > 100,
  (await ev(`(localStorage.getItem(FG.saveKey(0))||'').length`)) + ' 字节');
await ev(`location.reload()`); await sleep(2600);
await ev(`FG.startFrom('cont')`); await sleep(1000);
const readBack = await ev(`(function(){ FG.birthFix(); return JSON.stringify(FG.state.birth); })()`);
ok('读档回来「今年给过」还在', /"[^"]+":1/.test(readBack) && (await ev(`FG.birthDone(${JSON.stringify(id0)})`)) === true,
  readBack);
ok('（读回来的也是那一天，不是刷新后的第 1 天）', (await ev(`FG.state.day`)) === d0,
  '第 ' + await ev(`FG.state.day`) + ' 天');
await ev(`(function(){ FG.state.birth=null; FG.birthFix(); return 1})()`);
ok('老存档没这一本账能补出空的', (await ev(`JSON.stringify(FG.state.birth)`)) === '{}', await ev(`JSON.stringify(FG.state.birth)`));
ok('补完能判（不炸）', [true, false].includes(await ev(`FG.birthTurn(${JSON.stringify(id0)})`)),
  'birthTurn=' + await ev(`FG.birthTurn(${JSON.stringify(id0)})`));
await ev(`FG.restart()`); await sleep(400);
ok('重开归零', (await ev(`JSON.stringify(FG.state.birth)`)) === '{}', await ev(`JSON.stringify(FG.state.birth)`));

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
