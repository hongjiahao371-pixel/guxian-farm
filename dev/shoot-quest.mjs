// 托付验收：别人托你办一件具体的事。
//
// 盯住四条规矩：
//   1) **不设期限** —— 跨年不清、不过期
//   2) **奖励不给钱也不给诗** —— 给的是那个人多说的一段话
//   3) **两条判据（累计 / 交付）都能办成，也都能卡住**
//   4) **对话卡上的两行各自独立显隐** —— 递酒和交托不能互相吞掉
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9375;
const profile = path.join(tmpdir(), 'guxian-quest-' + process.pid);

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
  await sleep(150);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
const toast = () => ev(`document.getElementById('toast').textContent`);
const dlgOpen = () => ev(`!document.getElementById('dlg').classList.contains('hide')`);
const wineAct = () => ev(`!document.getElementById('dlg-act').classList.contains('hide')`);
const questAct = () => ev(`!document.getElementById('dlg-quest').classList.contains('hide')`);
const questActText = () => ev(`document.getElementById('dlg-quest').textContent`);
// 站到某人身边、按 E 说上话、关掉卡
// 这个人待在哪张图是从 FG.MAPS 里翻出来的 —— FG.NPCS[id] 上并没有 map 字段，
// 拿 `FG.NPCS[id].map || 'nanshan'` 会把所有人都塞进南山，然后在别的图上
// 按 E 什么反应也没有，看起来像「托付发不下来」
async function talkTo(id, close) {
  const where = await ev(`(function(){
    for (var k in FG.MAPS) if (FG.MAPS[k].npcs.indexOf('${id}') >= 0) return k;
    return '';})()`);
  if (!where) { ok('找得到 ' + id + ' 在哪张图', false, '(FG.MAPS 里没有这个人)'); return; }
  await ev(`(function(){
    FG.gotoMap('${where}');
    var n=FG.NPCS['${id}'];
    FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+40; FG.state.walkTo=null;
    return 1;})()`);
  await sleep(430);
  await key('e');
  await sleep(430);
  if (close) { await ev(`document.getElementById('dlg-x').click()`); await sleep(220); }
}
const closeDlg = async () => { await ev(`document.getElementById('dlg-x').click()`); await sleep(220); };

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

console.log('— 托付表自己站得住 —');
const QS = JSON.parse(await ev(`JSON.stringify(FG.QUESTS)`));
// 人物名单从 FG.NPCS 里读，不在测试里另抄一份 —— 抄的那份会跟源码分家，
// 而「托付挂在谁身上」这件事只有源码说了算
const NPC_IDS = JSON.parse(await ev(`JSON.stringify(Object.keys(FG.NPCS))`));
// 每个人实际站在哪张图上，也是从 FG.MAPS 读
const NPC_MAP = JSON.parse(await ev(`(function(){
  var o={}; for (var k in FG.MAPS) for (var i=0;i<FG.MAPS[k].npcs.length;i++) o[FG.MAPS[k].npcs[i]]=k;
  return JSON.stringify(o);})()`));
console.log('  ' + QS.map(q => q.from + '·' + q.id).join('　'));
ok('托付不止一条', QS.length >= 4, QS.length + ' 条');
ok('每一条都说清了托什么、要什么、给什么',
  QS.every(q => q.id && q.from && q.title && q.ask && q.done && q.need),
  QS.filter(q => !(q.id && q.from && q.title && q.ask && q.done && q.need)).map(q => q.id || '(没写 id)').join(',') || '（无）');
ok('每一条都挂在真实存在的人身上', QS.every(q => NPC_IDS.indexOf(q.from) >= 0),
  QS.filter(q => NPC_IDS.indexOf(q.from) < 0).map(q => q.from).join(',') || '（无）');
ok('每一个人都真站在某张图上（不然托付发不下来）', QS.every(q => !!NPC_MAP[q.from]),
  QS.filter(q => !NPC_MAP[q.from]).map(q => q.from).join(',') || '（无）');
ok('托付的 id 不重', new Set(QS.map(q => q.id)).size === QS.length);
ok('每一条都写了办成之后他说什么', QS.every(q => q.done && q.done.length > 8));
ok('没有一条发钱', !QS.some(q => JSON.stringify(q).indexOf('gold') >= 0));
ok('没有一条发诗（诗册是分数，不是任务奖品）', !QS.some(q => q.album || q.verse));
ok('两种判据都用上了（累计 / 交付）',
  QS.some(q => q.need.total) && QS.some(q => q.need.give),
  '累计 ' + QS.filter(q => q.need.total).length + ' 条 / 交付 ' + QS.filter(q => q.need.give).length + ' 条');
ok('一条托付只对应一门手艺',
  new Set(QS.map(q => q.skill)).size === QS.length, QS.map(q => q.skill).join(','));
ok('每一条都写了「够不着」时怎么说', QS.every(q => q.lock && q.lock.length > 6));
// 交付类要的东西必须真的在行囊里、真的是那一类
const bagBad = [];
for (const q of QS) {
  if (!q.need.give) continue;
  const it = await ev(`FG.BAG_IDX['${q.need.give}'] ? FG.BAG_IDX['${q.need.give}'].kind + '/' + FG.BAG_IDX['${q.need.give}'].name : '(不在行囊里)'`);
  bagBad.push(q.id + '→' + it);
}
ok('交付的那些东西都真在行囊里', !bagBad.some(s => s.indexOf('(不在行囊里)') >= 0), bagBad.join('  '));
// 累计类的 key 必须是终身计数表里有的
const totalKeys = await ev(`Object.keys(FG.state.total).join(',')`);
ok('累计类盯的数终身表里都有', QS.filter(q => q.need.total).every(q => totalKeys.split(',').indexOf(q.need.total) >= 0),
  totalKeys);

console.log('— 开局一条都还没托 —');
// 终身计数比的是「键值都对得上」，不是 JSON 串逐字相等：
// 串相等还额外要求键的顺序一致，而那是 totalInit 里的书写顺序，
// 跟「归零了没有」没关系
const totalZero = async () => (await ev(`(function(){var o={},k;for(k in FG.state.total)o[k]=FG.state.total[k];
  return Object.keys(o).sort().map(function(x){return x+'='+o[x]}).join(',')})()`));
ok('一条都没给', (await ev(`Object.keys(FG.state.quest).length`)) === 0,
  await ev(`JSON.stringify(FG.state.quest)`));
ok('终身计数从 0 起', (await totalZero()) === 'catch=0,rock=0,till=0', await totalZero());

console.log('— 一件没做过手的人，派不下活儿 —');
// 邻翁那条要翻够二十畦。没见过他、也没动过地的时候不该托付
await talkTo('linweng', false);
ok('对话卡弹出来了', await dlgOpen());
ok('第一次说话不会顺便托付', (await ev(`FG.state.quest.field`)) === undefined,
  await ev(`JSON.stringify(FG.state.quest)`));
ok('交托那一行没露出来', (await questAct()) === false);
await closeDlg();

console.log('— 动过手了，才托得下来 —');
await ev(`(function(){ FG.state.total.till = 6; return 1 })()`);
await talkTo('linweng', false);
ok('动过地之后再谈，托付下来了', (await ev(`FG.state.quest.field`)) === 'given',
  await ev(`JSON.stringify(FG.state.quest)`));
ok('但还没办成，那一行还点不着', (await questAct()) === false);
ok('卡上还是平常的回话，不是托付那句话',
  (await ev(`document.getElementById('dlg-text').textContent`)).indexOf('二十畦') < 0,
  await ev(`document.getElementById('dlg-text').textContent`));
await closeDlg();

console.log('— 累计类：办到数才亮 —');
const field = QS.find(q => q.id === 'field');
ok('数不够就不算成', (await ev(`FG.questProgress(FG.QUEST_BY('field')).done`)) === false,
  JSON.stringify(await ev(`JSON.stringify(FG.questProgress(FG.QUEST_BY('field')))`)));
await ev(`(function(){ FG.state.total.till = ${field.need.n}; return 1 })()`);
ok('够数了就成', (await ev(`FG.questProgress(FG.QUEST_BY('field')).done`)) === true,
  JSON.stringify(await ev(`JSON.stringify(FG.questProgress(FG.QUEST_BY('field')))`)));
await talkTo('linweng', false);
ok('再来找他，那一行亮了', (await questAct()) === true, await questActText());
ok('而且写明了是办哪件事', (await questActText()).indexOf(field.title) >= 0, await questActText());
ok('卡上换成他办成之后要说的话',
  (await ev(`document.getElementById('dlg-text').textContent`)) === field.done,
  await ev(`document.getElementById('dlg-text').textContent`));
await shot('20-托付可交了.png');
// 钱和诗都不该动。写死「发完还是 500」「还是 3 句」是在赌一个会变的数——
// 诗册加了句什么、初始钱改过，这条就变成一条永远红的假失败
const favorA = await ev(`FG.state.favor.linweng || 0`);
const goldA = await ev(`FG.state.gold`);
const albA = await ev(`Object.keys(FG.state.album).sort().join(',')`);
await ev(`document.getElementById('dlg-quest').click()`);
await sleep(450);
ok('点了之后记成办成', (await ev(`FG.state.quest.field`)) === 'done',
  await ev(`JSON.stringify(FG.state.quest)`));
ok('好感 +1', (await ev(`FG.state.favor.linweng || 0`)) === favorA + 1,
  favorA + ' -> ' + await ev(`FG.state.favor.linweng || 0`));
ok('那一行立刻收起来了', (await questAct()) === false);
ok('累计类不扣东西', (await ev(`FG.state.total.till`)) === field.need.n);
ok('而且不发钱', (await ev(`FG.state.gold`)) === goldA, goldA + ' -> ' + await ev(`FG.state.gold`));
ok('也不多一句诗', (await ev(`Object.keys(FG.state.album).sort().join(',')`)) === albA,
  albA + ' -> ' + await ev(`Object.keys(FG.state.album).sort().join(',')`));
await closeDlg();
await talkTo('linweng', false);
ok('再谈也不重复托付', (await ev(`FG.state.quest.field`)) === 'done' && (await questAct()) === false);
await closeDlg();

console.log('— 交付类：要东西，点了就扣 —');
await ev(`(function(){
  FG.state.gold=9999; FG.state.gear.jue=1; FG.state.ore={tong:3};
  FG.state.favor={}; FG.state.jiuPts={}; return 1})()`);
const ingot = QS.find(q => q.id === 'ingot');
await talkTo('xushi', false);
ok('老丈把话说出来了', (await ev(`FG.state.quest.ingot`)) === 'given',
  await ev(`JSON.stringify(FG.state.quest)`));
ok('手上不够，那一行不亮', (await questAct()) === false,
  JSON.stringify(await ev(`JSON.stringify(FG.questProgress(FG.QUEST_BY('ingot')))`)));
await closeDlg();
await ev(`(function(){ FG.state.ore.tong = ${ingot.need.n}; return 1 })()`);
await talkTo('xushi', false);
ok('凑够了那一行就亮', (await questAct()) === true, await questActText());
const oreA = await ev(`FG.state.ore.tong`);
await ev(`document.getElementById('dlg-quest').click()`);
await sleep(450);
ok('交付类**真的扣了**', (await ev(`FG.state.ore.tong`)) === oreA - ingot.need.n,
  oreA + ' -> ' + await ev(`FG.state.ore.tong`));
ok('记成办成', (await ev(`FG.state.quest.ingot`)) === 'done');
ok('发的是本子，不是那袋货（那袋货该从行囊读）', (await ev(`FG.state.gold`)) === 9999);
await closeDlg();

console.log('— 够不着的时候，说清楚为什么 —');
// 采药人那条要荇菜，荇菜要采到四级才下得到水
await ev(`(function(){ FG.skillFix(); FG.state.skill.cai={lv:1,pt:0}; FG.state.pouch={};
  FG.state.gear.jue=0; return 1 })()`);
ok('没镐，硐里那条托付派不下来',
  (await ev(`FG.questLocked(FG.QUEST_BY('ingot'))`)).indexOf('镐') >= 0,
  await ev(`FG.questLocked(FG.QUEST_BY('ingot'))`));
ok('采不到四级，下水那条派不下来',
  (await ev(`FG.questLocked(FG.QUEST_BY('herb'))`)).indexOf('四级') >= 0,
  await ev(`FG.questLocked(FG.QUEST_BY('herb'))`));
ok('一句话都不是「你还不够格」那套空话',
  (await ev(`FG.questLocked(FG.QUEST_BY('herb'))`)).indexOf('够不着') >= 0,
  await ev(`FG.questLocked(FG.QUEST_BY('herb'))`));

console.log('— 五条都走一遍：每条都能托、能办成 —');
const all = [];
const btns = [];
for (const q of QS) {
  // 摆到「够得着」的状态：累计类给够数，交付类给够货，把该有的手艺和器物给上
  await ev(`(function(){
    FG.skillFix();
    FG.state.skill.geng={lv:5,pt:0}; FG.state.skill.yu={lv:5,pt:0};
    FG.state.skill.cai={lv:5,pt:0}; FG.state.skill.zao={lv:5,pt:0};
    FG.state.skill.niang={lv:5,pt:0};
    FG.state.gear.jue=1; FG.state.ore={tong:9}; FG.state.pouch={xing:3};
    FG.state.made={ganju:5}; FG.state.jiu=0; FG.state.favor={}; FG.state.jiuPts={};
    FG.state.quest={}; FG.state.total={till:99,catch:99,rock:99};
    FG.state.met={linweng:1,yufu:1,xushi:1,caiyaoren:1,tongzi:1,qiaofu:1,caijuweng:1};
    return 1})()`);
  await talkTo(q.from, false);
  const given = await ev(`FG.state.quest['${q.id}']`);
  const can = await questAct();
  if (can) {
    // 按钮那句是在 game.js 里拼的，标题是第一人称原话，
    // 套「把…这件事说了」就成病句了 —— 这里直接盯住成品
    const t = await questActText();
    // 卡必须开着量：收尾时 closeDlg 过了，clientWidth 是 0，
    // 拿 0 当分母会得到「按钮比卡还宽」这种胡说
    const w = await ev(`document.getElementById('dlg-quest').offsetWidth`);
    const inner = await ev(`(function(){var d=document.getElementById('dlg'),s=getComputedStyle(d);
      return d.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);})()`);
    btns.push(t + '　[' + w + '/' + inner + 'px]');
    if (/^把.+这件事说了$/.test(t)) ok(q.id + ' 的按钮不是病句', false, t);
    if (w > inner) ok(q.id + ' 的按钮还在卡里', false, w + ' > ' + inner);
  }
  if (given === 'given' && can) {
    await ev(`document.getElementById('dlg-quest').click()`);
    await sleep(360);
  }
  const done = await ev(`FG.state.quest['${q.id}']`);
  all.push(q.id + ' 托=' + given + ' 亮=' + can + ' 成=' + done);
  await closeDlg();
}
console.log('  ' + all.join('　'));
console.log('  按钮：' + btns.join('　'));
ok('五条都能托、能交、能记成', all.every(s => s.indexOf('托=given') >= 0 && s.indexOf('成=done') >= 0));
ok('五条的按钮都念得通（不是「把…这件事说了」那套）', btns.length === QS.length);
ok('五条的按钮都还在卡里，没有一条被撑出去',
  btns.every(s => { const m = s.match(/\[(\d+)\/(\d+)px\]/); return m && +m[1] <= +m[2]; }),
  btns.join('　'));

console.log('— 递酒和交托，两行不互相吞 —');
// 只有邻翁一个人收酒，托付也挂在他身上（累计类那条）。
// 拿墟市老丈来试是试不出来的 —— 他压根不收酒，那一行永远是藏着的，
// 看着像「两行不打架」，其实一行根本没上场，等于什么都没验
await ev(`(function(){
  FG.state.quest={field:'given'}; FG.state.total={till:20,catch:0,rock:0};
  FG.state.jiu=1; FG.state.jiuYear=[1]; FG.state.favor={linweng:0}; return 1})()`);
await talkTo('linweng', false);
ok('两行同时在', (await wineAct()) === true && (await questAct()) === true,
  '酒=' + await wineAct() + ' 托=' + await questAct());
// 「两行都在」不等于「两行摆得下」。同一个 #dlg 里两个按钮挨着排，
// 挤不下就会换行或者压到右边那个「续」上，而断言全绿 —— 量几何才算
const two = JSON.parse(await ev(`(function(){
  var a=document.getElementById('dlg-act'), b=document.getElementById('dlg-quest');
  var d=document.getElementById('dlg'), s=getComputedStyle(d);
  return JSON.stringify({aL:a.offsetLeft, aR:a.offsetLeft+a.offsetWidth,
    bL:b.offsetLeft, bR:b.offsetLeft+b.offsetWidth, aT:a.offsetTop, bT:b.offsetTop,
    inner:d.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)});})()`));
ok('两行挨在一起，中间留了缝', two.aR <= two.bL && two.aR > 0,
  '酒右沿 ' + two.aR + ' / 托左沿 ' + two.bL);
ok('两行都没顶出卡', two.bR <= two.inner && two.aR <= two.inner,
  two.bR + ' / ' + two.aR + ' ≤ ' + two.inner);
ok('酒那行是递酒，托那行是托付，两行不重样',
  (await ev(`document.getElementById('dlg-act').textContent`)) !== (await questActText()),
  (await ev(`document.getElementById('dlg-act').textContent`)) + '　|　' + await questActText());
await shot('21-两行都在.png');
const jiuB = await ev(`FG.state.jiu`), tillB = await ev(`FG.state.total.till`);
await ev(`document.getElementById('dlg-act').click()`);
await sleep(400);
ok('递了酒，酒少了一坛', (await ev(`FG.state.jiu`)) === jiuB - 1,
  jiuB + ' -> ' + await ev(`FG.state.jiu`));
ok('托付还没了，累计数一件没动', (await ev(`FG.state.total.till`)) === tillB,
  tillB + ' -> ' + await ev(`FG.state.total.till`));
ok('交托那一行还在（递酒没把它吞掉）', (await questAct()) === true);
await ev(`document.getElementById('dlg-quest').click()`);
await sleep(400);
ok('接着交托，认下来了', (await ev(`FG.state.quest.field`)) === 'done');
ok('酒那行收的是自己那份，不是托付收的', (await wineAct()) === false);
ok('两行都收了', (await questAct()) === false);
await closeDlg();

console.log('— 不设期限：跨年不清 —');
await ev(`(function(){ FG.state.quest={field:'given'}; FG.state.total={till:20,catch:0,rock:0};
  return 1})()`);
await ev(`(function(){ FG.state.day = FG.SOLAR_YEAR; FG.state.min = FG.DAY.END - 1; return 1})()`);
await sleep(900);
await ev(`FG.nextDay()`);
await sleep(500);
ok('翻年了', (await ev(`FG.yearOf(FG.state.day)`)) === 2, '第 ' + await ev(`FG.yearOf(FG.state.day)`) + ' 年');
ok('托付还在（不设期限，也就没过期）', (await ev(`FG.state.quest.field`)) === 'given',
  await ev(`JSON.stringify(FG.state.quest)`));
ok('累计数也没清零', (await ev(`FG.state.total.till`)) === 20);
ok('办成了还是办成', (await ev(`FG.questProgress(FG.QUEST_BY('field')).done`)) === true);
await ev(`document.getElementById('de-next').click()`);
await sleep(400);

console.log('— 年结报托付 —');
await ev(`(function(){ FG.state.quest={field:'done',net:'done',ingot:'given'}; return 1})()`);
// 一年的最后一天是 SOLAR_YEAR 的倍数。第二天 = SOLAR_YEAR*2，
// 写成 SOLAR_YEAR + SOLAR_YEAR 是同一件事，多一次读源码的功夫
await ev(`(function(){ FG.state.day = FG.SOLAR_YEAR * 2; FG.state.min = FG.DAY.END - 1; return 1})()`);
await sleep(900);
await ev(`FG.nextDay()`);
await sleep(500);
const yrTxt = await ev(`document.querySelector('#de .body').textContent`);
ok('年结报了办成几件', /托付办成了 2 件/.test(yrTxt), yrTxt.replace(/\s+/g, ' ').slice(0, 200));
ok('没报「还差几件」（不设期限就不该有倒计时）', yrTxt.indexOf('还差') < 0, yrTxt.replace(/\s+/g, ' ').slice(0, 200));
await ev(`document.getElementById('de-next').click()`);
await sleep(300);

console.log('— 存档往返 —');
await ev(`FG.saveGame()`);
await sleep(300);
const qa = await ev(`JSON.stringify({q:FG.state.quest,t:FG.state.total,fav:FG.state.favor})`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
const qb = await ev(`JSON.stringify({q:FG.state.quest,t:FG.state.total,fav:FG.state.favor})`);
ok('托付状态原样还在', qa === qb, qa + ' / ' + qb);
// 上面那句是整个对象比相等，好感度要单独再核一次：
// 两边**都**是 undefined 的时候那句也是绿的，看着像「读回来了」
ok('好感读回来是个真数字，不是两份都没',
  (await ev(`typeof FG.state.favor.linweng`)) === 'number' && (await ev(`FG.state.favor.linweng`)) >= 1,
  'linweng=' + await ev(`FG.state.favor.linweng`));

console.log('— 老存档没有托付这一本账 —');
// 存档键不抄：从 localStorage 里认出「值是本游戏存档」的那一个。
// 只按 /day/ 挑的话，将来多存一份别的东西就挑错键，
// 删的删的是别的东西，而这一段照旧全绿
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
  delete raw.quest; delete raw.total;
  localStorage.setItem(${JSON.stringify(SAVEKEY)}, JSON.stringify(raw)); return 1})()`);
const logMark = logs.length;
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
ok('老档读出来托付这本账是空的，不是 null',
  (await ev(`!!FG.state.quest && typeof FG.state.quest==='object'`)) === true,
  JSON.stringify(await ev(`JSON.stringify(FG.state.quest)`)));
ok('终身计数也补上了', (await ev(`!!FG.state.total && FG.state.total.till !== undefined`)) === true,
  await ev(`JSON.stringify(FG.state.total)`));
// 只看「这一段有没有新报错」。整场零报错是结尾那一行的事 ——
// 中途攒下来的旧报错会混进同一个 logs 数组，不划一刀的话
// 「老档读出来不报异常」这句话可能只是在复述前面某处的错
ok('读老档这一段没报新异常', logs.length === logMark,
  logs.slice(logMark).join(' | ') || '干净');

console.log('— 重开归零 —');
await ev(`FG.restart()`);
await sleep(900);
ok('重开后一条托付都没有', (await ev(`Object.keys(FG.state.quest).length`)) === 0,
  await ev(`JSON.stringify(FG.state.quest)`));
ok('终身计数也归零', (await totalZero()) === 'catch=0,rock=0,till=0', await totalZero());
await talkTo('linweng', false);
ok('重开后要重新托一遍', (await ev(`FG.state.quest.field`)) === undefined);
await closeDlg();

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
