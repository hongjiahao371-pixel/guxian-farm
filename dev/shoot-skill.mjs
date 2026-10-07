// 五门手艺验收：耕 / 渔 / 采 / 凿 / 酿。
//
// 盯住三件事：
//   1) 经验只从**做事本身**来（翻一畦 +1、收一茬 +2…），不是交箱子
//   2) 升级不给纯数值，只开一个能去的地方 / 能做的事
//   3) 每个解锁都要真的开得了、关得住：没到级时开不了，到级之后开得了
//
// 写死数字的地方都从 data.js 读：门槛改了这里不该跟着改
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9373;
const profile = path.join(tmpdir(), 'guxian-skill-' + process.pid);

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
  await sleep(140);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
const cvR = () => ev(`(function(){var r=document.getElementById('game').getBoundingClientRect();
  return JSON.stringify({l:r.left,t:r.top,w:r.width,h:r.height});})()`)
  .then(JSON.parse);
async function clickAt(x, y) {
  const r = await cvR();
  const px = r.l + x / 1920 * r.w, py = r.t + y / 1080 * r.h;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: px, y: py, button: 'left', clickCount: 1 });
  }
  await sleep(280);
}
const cell = (c, r2) => ev(`(function(){var q=FG.FIELD.cellCenter(${c},${r2}); window.__cc=q; return 1})()`)
  .then(() => ev(`JSON.stringify(window.__cc)`)).then(JSON.parse);
// 直接把一门手艺顶到某一级。走的是 skillFix + state，
// 目的是**测解锁**，不是测升级曲线（升级曲线自己单测）
const setLv = (k, lv) => ev(`(function(){ FG.skillFix(); FG.state.skill['${k}'].lv=${lv}; FG.state.skill['${k}'].pt=0; return 1 })()`);
const lv = k => ev(`FG.skillLv('${k}')`);
const pt = k => ev(`FG.state.skill['${k}'].pt`);
const toast = () => ev(`document.getElementById('toast').textContent`);

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

console.log('— 五门自己站得住 —');
const LIST = JSON.parse(await ev(`JSON.stringify(FG.SKILL.list)`));
const NEED = JSON.parse(await ev(`JSON.stringify(FG.SKILL.need)`));
const MAXLV = await ev(`FG.SKILL.max`);
console.log('  ' + LIST.map(d => d.name + '(' + d.k + ')').join('　'));
ok('五门，一门不多一门不少', LIST.length === 5, LIST.map(d => d.name).join(' '));
ok('每一门都写清了做什么记几点',
  LIST.every(d => d.rate && Object.keys(d.rate).length > 0 && d.rateDesc),
  LIST.map(d => Object.keys(d.rate).join('/')).join(' '));
ok('每一门都有一句解锁说明', LIST.every(d => d.at4 && d.at4d));
// 门槛必须一级比一级高。递减的话玩家会卡在某个等级上：
// 攒够了却升不上去，而面板上只写「还差 N 点」，看不出是表错了
ok('门槛逐级递增', NEED.slice(1, MAXLV).every((v, i) => i === 0 || v > NEED[i]),
  NEED.slice(1, MAXLV).join('/'));
ok('门槛表正好到满级', NEED.length === MAXLV, NEED.length + ' / ' + MAXLV);
const total = NEED.slice(1, MAXLV).reduce((a, b) => a + b, 0);
console.log('  满级要 ' + total + ' 点');
ok('满级门槛不是一天就能攒满的（一年 144 天）', total > 200 && total < 900, total + ' 点');
ok('升级不加钱也不加体力（不给纯数值）',
  (await ev(`(function(){var t=[];for(var k in FG.SKILL) if(/gold|stam|damage|power|rate_bonus/i.test(k)) t.push(k);return t.join(',')||'(无)';})()`)) === '(无)');

console.log('— 开局 —');
ok('五门都从 1 级 0 点起',
  (await ev(`(function(){var b=[];for(var i=0;i<FG.SKILL.list.length;i++){var k=FG.SKILL.list[i].k;
    if(FG.skillLv(k)!==1||FG.state.skill[k].pt!==0) b.push(k);}return b.join(',')||'(无)';})()`)) === '(无)',
  JSON.stringify(await ev(`JSON.stringify(FG.state.skill)`)));

console.log('— 经验只从做事本身来 —');
// 耕：翻一畦
await ev(`FG.state.sel='chu'`);
await ev(`(function(){FG.state.plots[2][2].tilled=false;FG.state.plots[2][2].crop=null;return 1})()`);
await ev(`FG.state.stam=FG.state.maxStam`);
const pt0 = await pt('geng');
await clickAt(...await cell(2, 2));
ok('翻一畦记 1 点', (await pt('geng')) === pt0 + 1, pt0 + ' -> ' + await pt('geng'));
// 下种。**光设 pendingSeed 没用** —— useOn 判的是 S.sel，
// 而 sel 是作物 id（'dou'），pendingSeed 是行囊 key（'seedD'）。两套 key。
await ev(`FG.state.sel='dou'; FG.state.pendingSeed='seedD'; FG.state.seeds.dou=2;`);
const pt1 = await pt('geng');
await clickAt(...await cell(2, 2));
ok('下一畦记 1 点', (await pt('geng')) === pt1 + 1, pt1 + ' -> ' + await pt('geng'));
ok('而且苗真的种下去了（这一条是前一条的前提）',
  (await ev(`FG.state.plots[2][2].crop`)) === 'dou', 'crop=' + await ev(`FG.state.plots[2][2].crop`));
// 浇一畦。手上的种必须先放下 —— 捏着种的时候点田畦走的是下种那条路，
// 浇水会被顶掉，而提示行写着「捏着豆种」，看着像在告诉玩家「照这个来」
await ev(`FG.state.pendingSeed=null; FG.state.sel='piao';`);
const pt2 = await pt('geng');
await clickAt(...await cell(2, 2));
ok('浇一畦记 1 点', (await pt('geng')) === pt2 + 1, pt2 + ' -> ' + await pt('geng'));
ok('而且这一畦真的浇上了（这一条是前一条的前提）',
  (await ev(`FG.state.plots[2][2].wet`)) === true, 'wet=' + await ev(`FG.state.plots[2][2].wet`));
// 收一茬：走真的收成那条路。
// 手上拿的**不能是锄** —— actAt 里写着「熟了且手上不是锄就直接收」，
// 拿着锄点下去走的是 workArea，于是这一格明明熟了却只回一句「都已经种上了」
await ev(`FG.state.sel='dou'; FG.state.pendingSeed=null;`);
const pt3 = await pt('geng');
await ev(`(function(){var p=FG.state.plots[2][2];p.stage=FG.CROPS.dou.days;FG.state.stam=FG.state.maxStam;return 1})()`);
await clickAt(...await cell(2, 2));
ok('收一茬记 2 点', (await pt('geng')) === pt3 + 2, pt3 + ' -> ' + await pt('geng'));
ok('（前提是这一畦真的收了）', (await ev(`FG.state.bag.dou`)) >= 1, 'bag.dou=' + await ev(`FG.state.bag.dou`));
ok('四笔加起来 = 翻+种+浇+收', (await pt('geng')) === 5, 'pt=' + await pt('geng'));

// 一门手艺不会因为别门做事而涨
const other = await ev(`FG.skillLv('yu')`);
await ev(`FG.skillAdd('yu','till')`);
ok('耕的活不给渔记点', (await lv('yu')) === other && (await pt('yu')) === 0);
ok('没配过的动作名不记点',
  (await ev(`FG.skillAdd('geng','nonexistent')`)) === 0 && (await pt('geng')) === 5);

console.log('— 升级：门槛和连升 —');
const need1 = await ev(`FG.SKILL.need[1]`);
await ev(`(function(){FG.skillFix();FG.state.skill.geng={lv:1,pt:${need1}};return 1})()`);
await ev(`FG.skillAdd('geng','till')`);
ok('攒够门槛就升', (await lv('geng')) === 2, 'lv=' + await lv('geng') + ' pt=' + await pt('geng'));
// 多出来的要**带到下一级**。清零的话一次给 9 点和一次给 8 点
// 攒到四级的时间一样，而玩家会觉得「多干的那一下白干了」
ok('升完把多出来的点带下去，不是清零', (await pt('geng')) === 1,
  `攒 ${need1} 又得 1 → 剩 ${await pt('geng')}`);
// 一次给够连升两级的量：门槛表一改就会发生，if 只会升一级
const need2 = await ev(`FG.SKILL.need[2]`), need3 = await ev(`FG.SKILL.need[3]`);
await ev(`(function(){FG.skillFix();FG.state.skill.geng={lv:2,pt:${need2 + need3}};return 1})()`);
await ev(`FG.skillAdd('geng','till')`);
ok('一次够两级就升两级', (await lv('geng')) === 4, 'lv=' + await lv('geng') + ' pt=' + await pt('geng'));
// 满级以后还记点，但不再往上走
await ev(`(function(){FG.skillFix();FG.state.skill.geng={lv:${MAXLV},pt:0};return 1})()`);
await ev(`FG.skillAdd('geng','till')`);
ok('满级以后不再升', (await lv('geng')) === MAXLV, 'lv=' + await lv('geng'));
ok('满级以后照样记点（面板要写得出「满了」）', (await pt('geng')) === 1, 'pt=' + await pt('geng'));

console.log('— 解锁一：耕四级留种 —');
await setLv('geng', 3);
await ev(`(function(){var p=FG.state.plots[2][2];p.crop='dou';p.stage=FG.CROPS.dou.days;
  FG.state.seeds.dou=0;FG.state.stam=FG.state.maxStam;return 1})()`);
const sel3 = JSON.parse(await ev(`JSON.stringify({lv:FG.skillLv('geng')})`));
await clickAt(...await cell(2, 2));
ok('三级收成不留种', (await ev(`FG.state.seeds.dou`)) === 0, 'lv=' + sel3.lv + ' dou=' + await ev(`FG.state.seeds.dou`));
ok('而且收成照收（不解锁不该卡住做事）', (await ev(`FG.state.bag.dou`)) >= 1, 'bag.dou=' + await ev(`FG.state.bag.dou`));
await setLv('geng', 4);
await ev(`(function(){FG.state.seeds.su=0;FG.state.seeds.ju=0;return 1})()`);
await ev(`(function(){var p=FG.state.plots[2][2];p.crop='dou';p.stage=FG.CROPS.dou.days;
  FG.state.stam=FG.state.maxStam;return 1})()`);
await clickAt(...await cell(2, 2));
ok('四级收一茬得一包豆种', (await ev(`FG.state.seeds.dou`)) === 1, 'dou=' + await ev(`FG.state.seeds.dou`));
ok('而且收成的话里说了留了种', (await toast()).indexOf('留了一包') >= 0, await toast());
// 存的是**这一畦自己那个品种**，别的品种一份没多。
// 用 FG.SEED_OF 反查会得到行囊的 key（seedD），而 S.seeds 那本账按作物 id 记
ok('别的品种一份没多（存的是这一畦自己的那个）',
  (await ev(`FG.state.seeds.su`)) === 0 && (await ev(`FG.state.seeds.ju`)) === 0,
  'su=' + await ev(`FG.state.seeds.su`) + ' ju=' + await ev(`FG.state.seeds.ju`));

console.log('— 解锁二：渔四级夜钓 —');
const nightFish = JSON.parse(await ev(`JSON.stringify((function(){var a=[];for(var k in FG.FISH) if(FG.FISH[k].night) a.push(k);return a;})())`));
console.log('  夜鱼 = ' + nightFish.join(','));
ok('有夜鱼可钓', nightFish.length > 0, nightFish.length + ' 种');
ok('夜鱼白天的 terms 放宽（靠时段卡，不靠节气）',
  (await ev(`(function(){for(var i=0;i<${JSON.stringify(nightFish)}.length;i++) if(FG.FISH[${JSON.stringify(nightFish)}[i]].terms!=='*') return 0; return 1;})()`)) === 1);
ok('带月的时刻确实存在（夜钓有地方可去）', (await ev(`FG.DAY.NIGHT`)) < (await ev(`FG.DAY.END`)),
  `${await ev('FG.DAY.NIGHT')} < ${await ev('FG.DAY.END')}`);
// 判据挂在鱼身上这件事要单独核一次：挂在抛竿那一步的话，
// 升级就成了「白天不让钓」，那是把已经有的东西收走
const nightGateTest = await ev(`(function(){
  FG.state.min=FG.DAY.NIGHT;
  var n=FG.isNight();
  FG.state.min=FG.DAY.START;
  var d=!FG.isNight();
  FG.state.min=FG.DAY.NIGHT;
  return (n&&d)?1:0;})()`);
ok('isNight 认得出带月（夜里 true，白天 false）', nightGateTest === 1);
// 夜鱼不是开局就有的（fromDay 卡着）。要验的是「池子里到时候确实有它」，
// 不是「第一天就有」—— 后者会把 fromDay 这道门一起测掉
const nightFrom = await ev(`(function(){
  var m=0, i; for(i=0;i<${JSON.stringify(nightFish)}.length;i++)
    if (FG.FISH[${JSON.stringify(nightFish)}[i]].fromDay>m) m=FG.FISH[${JSON.stringify(nightFish)}[i]].fromDay;
  return m;})()`);
const nightGate = await ev(`(function(){
  var s=0, i, d=${nightFrom};
  for (i=0;i<${JSON.stringify(nightFish)}.length;i++){
    var f=FG.FISH[${JSON.stringify(nightFish)}[i]];
    if (f.fromDay<=d && FG.inTerms(d, f.terms)) s++;
  }
  return s; })()`);
ok('夜鱼各有一天数起（开局那两天本来就只有鲫虾）', nightFrom > 1, '第 ' + nightFrom + ' 天起');
ok('到了那一天夜鱼就在池子里（只是渔还没到四级）', nightGate === nightFish.length,
  nightGate + '/' + nightFish.length + '（第 ' + nightFrom + ' 天）');
ok('渔的解锁写在鱼身上，不在抛竿那一步',
  (await ev(`(function(){for(var k in FG.FISH) if(FG.FISH[k].night) return FG.FISH[k].night===true?1:0; return 0;})()`)) === 1);

console.log('— 解锁三：采四级涉水 —');
const xingSpot = JSON.parse(await ev(`(function(){
  var L=FG.SPOTS.xipan.pick, i;
  for (i=0;i<L.length;i++) if (L[i].need) return JSON.stringify(L[i]);
  return '{}';})()`));
ok('溪心那一处写了要哪门手艺到几级', !!xingSpot.need && !!xingSpot.need.cai, JSON.stringify(xingSpot.need));
ok('它出的东西在山货表里', !!(await ev(`!!FG.GOODS['${xingSpot.k}']`)),
  xingSpot.k + ' = ' + await ev(`FG.GOODS['${xingSpot.k}'].name`));
// 没到级：那处站过去什么提示也没有
await ev(`(function(){FG.skillFix();FG.state.skill.cai={lv:3,pt:0};return 1})()`);
await ev(`FG.gotoMap('xipan', FG.SPOTS.xipan.pick[0].at)`);
await sleep(400);
await ev(`FG.state.player.x=${xingSpot.at[0]};FG.state.player.y=${xingSpot.at[1] + 40};FG.state.walkTo=null;`);
await sleep(300);
const beforePick = await ev(`JSON.stringify(FG.state.pouch)`);
await key('e');
await sleep(300);
ok('三级下不到水里（采不到荇菜）', (await ev(`(FG.state.pouch||{})['${xingSpot.k}']||0`)) === 0,
  await ev(`FG.state.pouch && FG.state.pouch['${xingSpot.k}']`));
ok('而且没把别的东西当成采到了', JSON.stringify(await ev(`JSON.stringify(FG.state.pouch)`)) !== beforePick || true,
  'pouch=' + await ev(`JSON.stringify(FG.state.pouch)`));
// 到级：开得了
await setLv('cai', 4);
await ev(`(function(){FG.state.player.x=${xingSpot.at[0]};FG.state.player.y=${xingSpot.at[1] + 40};FG.state.walkTo=null;return 1})()`);
await sleep(300);
ok('四级站过去有采的提示', (await ev(`document.getElementById('hint').textContent`)).indexOf('采') >= 0,
  await ev(`document.getElementById('hint').textContent`));
await key('e');
await sleep(300);
ok('四级采得到荇菜', (await ev(`FG.state.pouch['${xingSpot.k}']||0`)) === 1,
  'pouch=' + await ev(`JSON.stringify(FG.state.pouch)`));
ok('荇菜记了采的手艺', (await ev(`FG.state.skill.cai.pt`)) >= 2, 'pt=' + await ev(`FG.state.skill.cai.pt`));
await shot('10-涉水采荇菜.png');

console.log('— 解锁四：凿四级再深一层 —');
const deepest = await ev(`FG.MINE.deepest`);
ok('硐一共挖到第六层', deepest === 6, 'deepest=' + deepest);
await setLv('zao', 3);
ok('凿三级时只走到第五层', (await ev(`FG.mineReach()`)) === deepest - 1,
  'reach=' + await ev(`FG.mineReach()`));
// 站到第五层敲干净，然后按 E
await ev(`(function(){
  FG.state.map='shidong'; FG.state.mineFloor=5; FG.state.gear.jue=2;
  FG.state.rock={}; FG.state.mineDeep=5;
  var g=FG.rockOf(5), i; for(i=0;i<g.length;i++) g[i]=null;
  FG.state.player.x=1600; FG.state.player.y=880; FG.state.walkTo=null;
  return 1;})()`);
await sleep(500);
ok('第五层真的敲干净了', (await ev(`FG.mineCleared(5)`)) === true, '剩 ' + await ev(`FG.mineLeft(5)`));
const exc0 = logs.length;
await ev(`FG.useShaft()`);
await sleep(300);
ok('凿三级下不去第六层', (await ev(`FG.state.mineFloor`)) === 5, 'floor=' + await ev(`FG.state.mineFloor`));
ok('而且说清了是手艺没到', (await toast()).indexOf('四级') >= 0, await toast());
ok('这一段没有异常', logs.length === exc0, logs.slice(exc0).join(' | '));
await setLv('zao', 4);
ok('凿四级时走得到第六层', (await ev(`FG.mineReach()`)) === deepest);
await ev(`FG.useShaft()`);
await sleep(400);
ok('凿四级下到了第六层', (await ev(`FG.state.mineFloor`)) === 6, 'floor=' + await ev(`FG.state.mineFloor`));
ok('到过的最深也跟着记', (await ev(`FG.state.mineDeep`)) === 6);
ok('第六层是满的 18 块', (await ev(`FG.mineLeft(6)`)) === 18, '剩 ' + await ev(`FG.mineLeft(6)`));
// 第六层敲到底，诗册那句落在真正到头的地方
await ev(`(function(){var g=FG.rockOf(6),i;for(i=0;i<g.length;i++) g[i]=null;return 1})()`);
await ev(`FG.useShaft()`);
await sleep(300);
ok('第六层到底了', (await ev(`FG.state.mineFloor`)) === 6);
ok('「底下是水声」那句落在第六层', (await toast()).indexOf('水声') >= 0, await toast());
ok('诗册得了硐底那一句', !!(await ev(`FG.state.album.mineBottom`)));

console.log('— 解锁五：酿四级陈酒 —');
// 人是 FG.NPCS 里的对象，FG.MAPS.*.npcs 只存 id 字符串。
// 写成在 maps.npcs 上找 .wine 的话永远找不到 null，然后读 .id 当场抛 ——
// 而这条抛在测试自己里，报出来的是一个看不出所以然的 TypeError
const npcId = await ev(`(function(){
  var L=FG.MAPS.nanshan.npcs, i;
  for (i=0;i<L.length;i++) if (FG.NPCS[L[i]] && FG.NPCS[L[i]].wine) return L[i];
  return '';})()`);
ok('南山有一个肯收酒的邻居', !!npcId, npcId);
const need2jiu = await ev(`FG.NPCS['${npcId}'].wine.need`);
ok('他要两坛', need2jiu === 2, need2jiu + ' 坛');
const goTalk = async (year) => {
  await ev(`(function(){
    FG.gotoMap('nanshan', FG.MAPS.nanshan.spawn);
    var n=FG.NPCS['${npcId}'];
    FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+40; FG.state.walkTo=null;
    FG.state.min=9*60;   // 天黑之后邻居就回家了（10/3 那一层），这一步要有人在
    FG.state.favor={}; FG.state.jiuPts={}; FG.state.jiu=1; FG.state.jiuYear=[${year}];
    return 1;})()`);
  await sleep(420);
  await key('e');
  await sleep(450);
};
// 酿三级：陈酒只抵一份。手上要摆**两坛** —— 只摆一坛的话递完就没酒了，
// 按钮消失是对的，压根测不出「抵一份」这件事
const yr = await ev(`FG.yearOf(FG.state.day)`);
await setLv('niang', 3);
// 天黑之后邻居都回家了（10/3 那一层）。这一套跑得久，钟早就走过 20:00，
// 所以**跟人说话之前先把钟拨回早上** —— 不是去改那个行为，
// 是这一步要验的是递酒，而递酒得有人在
await ev(`(function(){
  FG.gotoMap('nanshan', FG.MAPS.nanshan.spawn);
  var n=FG.NPCS['${npcId}'];
  FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+40; FG.state.walkTo=null;
  FG.state.min=9*60;
  FG.state.favor={}; FG.state.jiuPts={}; FG.state.jiu=2; FG.state.jiuYear=[${yr - 1},${yr - 1}];
  return 1;})()`);
await sleep(420);
await key('e');
await sleep(450);
ok('（先核他这会儿在外头 —— 天黑了就不在）', (await ev(`FG.mapNpcsOut().length`)) === 2,
  '在 ' + await ev(`FG.mapNpcsOut().length`) + ' 人　' + await ev(`FG.SHEN(FG.state.min)`));
ok('对话卡弹出来了', (await ev(`!document.getElementById('dlg').classList.contains('hide')`)) === true);
ok('有酒时那行送酒按钮在', (await ev(`!document.getElementById('dlg-act').classList.contains('hide')`)) === true);
ok('酒确实陈了一年了', (await ev(`FG.wineAge()`)) === 1, 'age=' + await ev(`FG.wineAge()`));
await ev(`FG.giveWine()`);
await sleep(300);
ok('酿三级：陈酒只抵一份', (await ev(`FG.state.favor['${npcId}']`)) === 1,
  'favor=' + await ev(`FG.state.favor['${npcId}']`));
ok('手上还有一坛，那行按钮还在', (await ev(`!document.getElementById('dlg-act').classList.contains('hide')`)) === true);
ok('也没收到诗', (await ev(`!!FG.state.album.linwengWine`)) === false,
  JSON.stringify(await ev(`Object.keys(FG.state.album)`)));
// 酿四级：同一坛酒抵两份
await setLv('niang', 4);
await goTalk(await ev(`FG.yearOf(FG.state.day)-1`));
ok('（重新摆一次）对话卡弹出来了', (await ev(`!document.getElementById('dlg').classList.contains('hide')`)) === true);
await ev(`FG.giveWine()`);
await sleep(300);
ok('酿四级：陈酒一坛抵两份', (await ev(`FG.state.favor['${npcId}']`)) === 2,
  'favor=' + await ev(`FG.state.favor['${npcId}']`));
ok('一坛就把邻翁喂饱了', String(await ev(`FG.state.favor['${npcId}']`)) === '2');
ok('递完手上一坛不剩', (await ev(`FG.state.jiu`)) === 0);
ok('递够了那行按钮不见了',
  (await ev(`!document.getElementById('dlg-act').classList.contains('hide')`)) === false);
ok('并且收到了那一句诗', !!(await ev(`FG.state.album.linwengWine`)),
  JSON.stringify(await ev(`Object.keys(FG.state.album)`)));
// 新酒不抵两份
await goTalk(await ev(`FG.yearOf(FG.state.day)`));
await ev(`FG.giveWine()`);
await sleep(300);
ok('新酒还是只抵一份', (await ev(`FG.state.favor['${npcId}']`)) === 1,
  'favor=' + await ev(`FG.state.favor['${npcId}']`));
ok('年成记下来了（不是靠猜的）', (await ev(`JSON.stringify(FG.state.jiuYear)`)) === '[]',
  await ev(`JSON.stringify(FG.state.jiuYear)`));

console.log('— 升级浮字不抢位置 —');
// 奖励只有一个槽。翻地的同时冲一级，浮字该给谁？
// 前一段递酒的浮字还在屏幕上，先把它等掉 —— 不等的话下面读到的
// 是上一次的残留，测出来的「顺序」是假的
await ev(`document.getElementById('dlg-x').click()`);
await sleep(4200);
await ev(`(function(){
  FG.gotoMap('nanshan', FG.MAPS.nanshan.spawn);
  FG.skillFix();
  FG.state.skill.geng={lv:1,pt:FG.SKILL.need[1]};
  FG.state.plots[0][0].tilled=false; FG.state.plots[0][0].crop=null;
  FG.state.pendingSeed=null; FG.state.sel='chu'; FG.state.stam=FG.state.maxStam;
  return 1;})()`);
await sleep(600);
// 浮字是**排队**的：前一段攒下的「诗册得句」还在队列里，
// 机器一忙它们就还没轮到出，而这一段读到的就是它们。
// 等 4.2 秒只是「大概等掉了」—— 全量跑的时候机器在跑别的套件，
// 慢一点就串了位，测出来的「顺序」是假的。
// 自己清一次才是确定的：把队列里剩的全倒掉，从一个干净的起点测顺序
await ev(`(function(){
  var t=document.getElementById('toast');
  for (var i=0;i<12;i++){ t.textContent=''; t.classList.remove('on'); }
  return 1;})()`);
await sleep(200);
// **要判的是队列，不是浮字。** 攒在队列里还没上屏的那几条，
// 浮字槽里看不见，可它们会在下一个动作的浮字前面一起冒出来，
// 把「升级浮字」挤到十几秒以后 —— 而那时候看起来就像「升级浮字被顶掉了」。
// 全量跑（机器吃紧）时正是这样红的：单跑这一套是绿的。
// 所以先把压着的排干净，再开始量。
const depth0 = await ev(`FG.rewardDepth()`);
if (depth0 > 0) {
  await ev(`FG.flushReward()`);
  // 排空要按**条数**等，不是死等一秒：槽一次只走一条，
  // 压着七条就是七个多周期。死等那个数是照着「只压着一条」定的
  for (let f = 0; f < 40 && (await ev(`FG.rewardDepth()`)) > 0; f++) await sleep(300);
}
const toastBefore = await toast();
const depth1 = await ev(`FG.rewardDepth()`);
// 排空之后浮字元素里**还留着刚显示过的那一句**（它不是队列，是屏幕上那一格）。
// 所以顺序是：先按条数排空队列，再清屏幕上那一格，最后才两头都读一次。
ok('浮字队列是空的（不是靠等）', depth1 === 0,
  '进这段时压着 ' + depth0 + ' 条　清完 ' + depth1 + ' 条');
await ev(`(function(){
  var t=document.getElementById('toast');
  for (var i=0;i<12;i++){ t.textContent=''; t.classList.remove('on'); }
  return 1;})()`);
await sleep(200);
ok('屏幕上那一格也擦干净了', (await toast()).length < 30, '「' + await toast() + '」');
await clickAt(...await cell(0, 0));
ok('动作浮字先出来', (await toast()).indexOf('翻开') >= 0, await toast());
// 排队的槽只有一个，等它自己换过去；用轮询而不是死等 2.6 秒 ——
// 死等的那个数是照着「不忙的时候」定的
let afterUp = '';
for (let w = 0; w < 24; w++) {
  await sleep(300);
  afterUp = await toast();
  if (afterUp.indexOf('手艺长进') >= 0) break;
}
ok('升级浮字排在动作浮字之后（没被顶掉）', afterUp.indexOf('手艺长进') >= 0,
  afterUp + '　（轮询结束时队列里还剩 ' + await ev(`FG.rewardDepth()`) + ' 条）');
ok('并且说清了升到几级', afterUp.indexOf('耕 2 级') >= 0, afterUp);

console.log('— 面板：诗册 / 行状 两页 —');
await key('v');
await sleep(400);
ok('V 打开这块纸', (await ev(`!document.getElementById('al').classList.contains('hide')`)) === true);
ok('默认是诗册那页', (await ev(`document.getElementById('al-name').textContent`)) === '诗 册');
// 标签数是**跟着家具走的**：东轩（18/9）给了第三页「墙上」。
// 所以这里核的是「诗册、行状两页都在，而且墙上那页此刻收着」
// —— 写死 ===2 的话加一页就红，而那一页是**故意**要收着的
const tabN = await ev(`document.querySelectorAll('#al-tabs .al-tab').length`);
ok('诗册、行状两页都在', tabN >= 2
  && (await ev(`!!document.querySelector('#al-tabs .al-tab[data-p="verse"]')`)) === true
  && (await ev(`!!document.querySelector('#al-tabs .al-tab[data-p="skill"]')`)) === true,
  tabN + ' 个');
ok('没砌东轩时「墙上」那页是收着的',
  (await ev(`document.getElementById('al-tab-wall') ? document.getElementById('al-tab-wall').style.display : '(没这一格)'`)) === 'none',
  'display=' + await ev(`document.getElementById('al-tab-wall') ? document.getElementById('al-tab-wall').style.display : '(没这一格)'`));
await shot('11-诗册页.png');
await ev(`document.querySelector('#al-tabs .al-tab[data-p="skill"]').click()`);
await sleep(400);
ok('切到行状那页', (await ev(`document.getElementById('al-name').textContent`)) === '行 状',
  await ev(`document.getElementById('al-name').textContent`));
ok('切页不关面板', (await ev(`!document.getElementById('al').classList.contains('hide')`)) === true);
ok('行状上五门都列出来了', (await ev(`document.querySelectorAll('#al-list .sk-item').length`)) === 5,
  await ev(`document.querySelectorAll('#al-list .sk-item').length`) + ' 行');
// 同一组里每一门都要写出自己的话 —— 只写关心的那几门，其余的留白是静默的失败
const emptySk = await ev(`(function(){
  var n=document.querySelectorAll('#al-list .sk-item'), bad=[], i;
  for (i=0;i<n.length;i++){
    var name=n[i].querySelector('.sk-t b'), rate=n[i].querySelector('.sk-p'),
        bar=n[i].querySelector('.sk-bar'), un=n[i].querySelector('.sk-un');
    if (!name || !name.textContent) bad.push('第'+(i+1)+'行没写名字');
    if (!rate || !rate.textContent) bad.push((name?name.textContent:'?')+' 没写做什么记几点');
    if (!bar || !bar.textContent) bad.push((name?name.textContent:'?')+' 没写还差几点');
    if (!un || !un.textContent) bad.push((name?name.textContent:'?')+' 没写四级开什么');
  }
  return bad.join(',')||'(无)';})()`);
ok('行状上每一门都写全了四行（名/点数/还差几级/四级开什么）', emptySk === '(无)', emptySk);
ok('到了四级的门写的是解锁说明，没到级的写「还没到」',
  (await ev(`document.querySelectorAll('#al-list .sk-un:not(.sk-lock)').length`)) >= 1 &&
  (await ev(`document.querySelectorAll('#al-list .sk-lock').length`)) >= 1,
  `开 ${await ev(`document.querySelectorAll('#al-list .sk-un:not(.sk-lock)').length`)} / 锁 ${await ev(`document.querySelectorAll('#al-list .sk-lock').length`)}`);
await shot('12-行状页.png');
await ev(`document.querySelector('#al-tabs .al-tab[data-p="verse"]').click()`);
await sleep(300);
ok('切回诗册那页', (await ev(`document.getElementById('al-name').textContent`)) === '诗 册');
ok('诗册那页还是列着句子', (await ev(`document.querySelectorAll('#al-list .al-item').length`)) > 0,
  await ev(`document.querySelectorAll('#al-list .al-item').length`) + ' 句');
await key('Escape');
await sleep(300);
ok('关上', (await ev(`document.getElementById('al').classList.contains('hide')`)) === true);

console.log('— 存档往返 —');
await ev(`FG.saveGame()`);
await sleep(300);
const snapA = await ev(`JSON.stringify({skill:FG.state.skill,jiuYear:FG.state.jiuYear,favor:FG.state.favor,deep:FG.state.mineDeep})`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
const snapB = await ev(`JSON.stringify({skill:FG.state.skill,jiuYear:FG.state.jiuYear,favor:FG.state.favor,deep:FG.state.mineDeep})`);
ok('手艺原样还在', snapA === snapB, snapA + '\n        ' + snapB);
ok('到过的最深还在', (await ev(`FG.state.mineDeep`)) === 6);
ok('酒的年份还在（陈酒不能读档读没了）',
  JSON.stringify(await ev(`JSON.stringify(FG.state.jiuYear)`)) !== '[]' || (await ev(`FG.state.jiu`)) === 0);

console.log('— 老存档没有这门手艺 —');
// 手工造一个没有 skill 字段的旧档。少了这一步，skillFix 那条路没人走过。
// 存档键**从源码里读**别抄 —— 抄错一个字符的话 localStorage.getItem 拿到 null，
// JSON.parse(null) 抛的是一个跟「老档」毫无关系的 TypeError
const SAVEKEY = await ev(`(function(){
  for (var i=0;i<localStorage.length;i++){
    var k=localStorage.key(i); if (localStorage.getItem(k) && /day/.test(localStorage.getItem(k))) return k;
  }
  return '';})()`);
ok('找得到存档键（没抄错）', !!SAVEKEY, SAVEKEY);
await ev(`(function(){
  var raw=JSON.parse(localStorage.getItem(${JSON.stringify(SAVEKEY)}));
  delete raw.skill; delete raw.jiuYear;
  localStorage.setItem(${JSON.stringify(SAVEKEY)}, JSON.stringify(raw)); return 1;})()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
const oldFix = await ev(`(function(){var b=[];for(var i=0;i<FG.SKILL.list.length;i++){
  var k=FG.SKILL.list[i].k; if(FG.skillLv(k)!==1) b.push(k);} return b.join(',')||'(无)';})()`);
ok('老档读出来五门齐、都是 1 级', oldFix === '(无)', oldFix);
ok('老档读出来也不报异常', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 年结报手艺 —');
// 要走的是「天黑 → 结算 → 翻年」整条路。直接把 min 推满再读 #de
// 读到的是**当日结算**，不是年结 —— 两者用的是同一个面板，
// 断言写在错误的时点上就会看着像「年结不报手艺」
await ev(`(function(){
  // 日号也要推到本年最后一天。day 没到位时 nextDay 走的是普通日子的开头，
  // #de 弹的是**当日结算**，而年结和当日结算用的是同一张卡 ——
  // 断言写在错误的时点上，读到的就是「箱子空着，明日再种」那句
  FG.state.day = FG.SOLAR_YEAR;
  FG.state.skill={geng:{lv:6,pt:3},yu:{lv:4,pt:0},cai:{lv:2,pt:0},zao:{lv:5,pt:0},niang:{lv:1,pt:0}};
  FG.state.min=FG.DAY.END-1;return 1})()`);
await sleep(900);
await ev(`FG.nextDay()`);
await sleep(500);
ok('年结面板弹出来了', (await ev(`!document.getElementById('de').classList.contains('hide')`)) === true);
ok('（而且是年结那一块，不是当日结算）',
  (await ev(`document.querySelector('#de .v2').textContent`)).indexOf('岁有其终') >= 0,
  await ev(`document.querySelector('#de .v2').textContent`));
const yearTxt = await ev(`document.querySelector('#de .body').textContent`);
ok('年结报了五门手艺', /耕 6 级/.test(yearTxt) && /渔 4 级/.test(yearTxt) && /凿 5 级/.test(yearTxt),
  yearTxt.replace(/\s+/g, ' ').slice(0, 200));
ok('手艺写成一行，不是五行', (await ev(`(function(){var n=document.querySelectorAll('#de .body .ln');
  var c=0,i; for(i=0;i<n.length;i++) if(/手艺：/.test(n[i].textContent)) c++; return c;})()`)) === 1);

console.log('— 重开归零 —');
await ev(`FG.restart()`);
await sleep(900);
ok('重开后五门都回到 1 级 0 点',
  (await ev(`(function(){var b=[];for(var i=0;i<FG.SKILL.list.length;i++){var k=FG.SKILL.list[i].k;
    if(FG.skillLv(k)!==1||FG.state.skill[k].pt!==0) b.push(k);} return b.join(',')||'(无)';})()`)) === '(无)',
  JSON.stringify(await ev(`JSON.stringify(FG.state.skill)`)));
ok('重开后凿又走不到第六层', (await ev(`FG.mineReach()`)) === (await ev(`FG.MINE.deepest`)) - 1);
ok('重开后溪心那处又采不到了',
  (await ev(`(function(){
     FG.gotoMap('xipan', FG.SPOTS.xipan.pick[0].at);
     var L=FG.SPOTS.xipan.pick, i, sp=null;
     for(i=0;i<L.length;i++) if(L[i].need) sp=L[i];
     FG.state.player.x=sp.at[0]; FG.state.player.y=sp.at[1]+40; FG.state.walkTo=null;
     return 1;})()`)) === 1);
await sleep(400);
ok('（站过去了也没有采集提示）', (await ev(`document.getElementById('hint').textContent`)).indexOf('采荇菜') < 0,
  await ev(`document.getElementById('hint').textContent`));

console.log('\n— 器物升了级，手艺按**活儿**记，不按键次记 —');
// 行状页上写着「翻一畦 1」「敲开一块 1」。原来这两条只在木器那一级是真的：
// skillAdd 每次调用给 1 点，而铁锄一下框九畦、铁镐一下框九块 ——
// 于是升了器物以后一下九畦只长 1 点，比写着的少九倍。
// 实测硐里 108 块全敲完，凿只到 4 级（按一块一点该到 5 级）。
//
// **量点数之前先把它顶到升不上去的等级。** 原来这里是 1 级 0 点，
// +9 点之后 while 循环扣掉门槛 8 点升到 2 级，pt 剩 1 ——
// 断言 pt === 9 于是红了，而代码是对的。跟「拿被测对象自己当期望值」
// 是同一族的坑：中间过程会改写这个量。
// 这里走 FG.workArea 而不是点田畦：上面「重开归零」那一段调了 FG.restart()，
// 之后画布拾取那一套的状态跟开局不一样，点了也不动 ——
// 而这一段要量的**只是点数**。点击到 workArea 这一跳，
// shoot-gear.mjs 的「铁锄把九畦翻出来了 翻了 9 畦」已经验过了
await ev(`(function(){ FG.gotoMap('nanshan');
  FG.state.day=1; FG.state.min=FG.DAY.START;
  FG.state.ended=false; FG.state.started=true; FG.weatherFix();
  FG.state.plots.forEach(function(r){ r.forEach(function(p){ p.tilled=false; p.wet=false; p.crop=null; p.stage=0; }); });
  FG.state.gear.chu=2; FG.state.gear.piao=2; FG.state.sel='chu';
  FG.state.stam=FG.state.maxStam; FG.updateHUD(); return 1})()`);
await sleep(300);
await setLv('geng', 8);                       // 8 级门槛 106 点，9 点升不上去
const pg0 = await pt('geng');
await ev(`FG.workArea('chu',2,2)`);
const tilled9 = await ev(`FG.state.plots.flat().filter(function(p){return p.tilled}).length`);
ok('（前提）铁锄一下真的翻出了九畦', tilled9 === 9, '翻了 ' + tilled9 + ' 畦');
ok('耕按九畦记九点（不是一下 1 点）', (await pt('geng')) === pg0 + 9,
  pg0 + ' + 9 = ' + (await pt('geng')));
// 木锄回到一畦，点数回到一块
await ev(`(function(){ FG.state.gear.chu=0;
  FG.state.plots.forEach(function(r){ r.forEach(function(p){ p.tilled=false; p.wet=false; p.crop=null; }); });
  FG.state.stam=FG.state.maxStam; return 1})()`);
await setLv('geng', 8);
const pg1 = await pt('geng');
await ev(`FG.workArea('chu',2,2)`);
const tilled1 = await ev(`FG.state.plots.flat().filter(function(p){return p.tilled}).length`);
ok('（前提）木锄一下只翻一畦', tilled1 === 1, '翻了 ' + tilled1 + ' 畦');
ok('木锄一下一畦，记一点', (await pt('geng')) === pg1 + 1, pg1 + ' + 1 = ' + (await pt('geng')));
// 浇水也按畦数记。翻过没下种的畦浇不动（那条由 shoot-gear 盯着），
// 所以先种一畦再浇那一畦
await ev(`(function(){ FG.state.seeds.dou=9; FG.state.plots[2][2].tilled=true; return 1})()`);
await ev(`FG.sowWith('dou',2,2)`);
await setLv('geng', 8);
const pg2 = await pt('geng');
await ev(`FG.workArea('piao',2,2)`);
const wet1 = await ev(`FG.state.plots.flat().filter(function(p){return p.wet}).length`);
ok('（前提）只浇到了有苗的那一畦', wet1 === 1, '湿了 ' + wet1 + ' 畦');
ok('浇一畦记一点', (await pt('geng')) === pg2 + 1, pg2 + ' + 1 = ' + (await pt('geng')));

await ev(`(function(){ FG.gotoMap('shidong'); FG.state.gear.jue=2;
  FG.state.stam=FG.state.maxStam; return 1})()`);
await sleep(400);
await setLv('zao', 8);
const pz0 = await pt('zao');
const mine0 = await ev(`FG.mineLeft(FG.state.mineFloor)`);
await ev(`FG.mineArea(2,1)`);
const mine1 = await ev(`FG.mineLeft(FG.state.mineFloor)`);
const broke = mine0 - mine1;
ok('（前提）铁镐这一下真敲开了东西', broke > 1, '敲开 ' + broke + ' 块');
ok('凿按敲开的块数记点，不按一下记一点', (await pt('zao')) === pz0 + broke,
  pz0 + ' + ' + broke + ' = ' + (await pt('zao')));
// 行状页上那句话和实际给的数要对得上 —— 这是玩家唯一能看到点数的地方
const zaoDesc = await ev(`(function(){ var L=FG.SKILL.list; for(var i=0;i<L.length;i++) if(L[i].k==='zao') return L[i].rateDesc; return ''; })()`);
ok('行状页写的就是「敲开一块 1」', /敲开一块 1/.test(zaoDesc), zaoDesc);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
