// 牲畜验收：鸡舍之外的牛棚和羊圈。
//
// 9/9 那一版是「造了就每天早上下蛋」，15/9 把它改成门 + 草料双状态。
// 这一项要验的是**同一套机制在三种牲口上都成立，而且差别只在表上**：
//   鸡舍  撒一次管 3 天   出蛋，量词「枚」
//   牛棚  撒一次管 5 天   出奶，量词「罐」
//   羊圈  撒一次管 5 天   出毛，量词「团」
//
// 盯住这几条：
//   1) 牛羊撒一次管得比鸡久（表上 + 真跑一天核一遍）
//   2) 门关着没产出；开门有粮才有产出
//   3) **不惩罚，只少收**：忘关门忘撒粮只是少收，不掉血、不清零、不死
//   4) 忘了收就一直攒，一天一天往上加
//   5) 走到棚跟前按 E 的四个分支：没造 / 门关 / 有货 / 没货关门
//   6) 提示行站着就写得出门开没开、粮几天、堆几份
//   7) 二级：一趟两罐两团，提示行按二级算
//   8) 产物是加工品：能出货箱，能进坛（黄油 / 毛线）
//   9) 存档往返 / 老档没有这本账 / 越界等级
//  10) 1× 画面：牛羊鸡三样在成品显示尺寸下认不认得出来
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9386;
const profile = path.join(tmpdir(), 'guxian-live-' + process.pid);
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
// 读某样棚那一头账。门 / 粮 / 货三样
const K = async id => JSON.parse(await ev(`JSON.stringify(FG.keepState('${id}'))`));
const grain = () => ev(`(function(){var n=0,k;for(k in FG.state.bag) n+=FG.state.bag[k]; return n})()`);
// 走到棚跟前。判定点、所在哪张图都从源码拿
async function standAt(id) {
  await ev(`(function(){
    var mk=null; for (var k in FG.MAPS){ var b=FG.MAPS[k].builds||[]; if (b.indexOf('${id}')>=0) mk=k; }
    FG.gotoMap(mk);
    var b=FG.BUILD['${id}'];
    FG.state.player.x=b.at[0]; FG.state.player.y=b.at[1]+40; FG.state.walkTo=null;
    FG.updateHUD(); return 1})()`);
  await sleep(430);
}
async function nextDay(n) {
  for (let i = 0; i < (n || 1); i++) { await ev(`FG.nextDay()`); await sleep(480); }
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

console.log('— 三样棚摆在一张表上 —');
const B = JSON.parse(await ev(`JSON.stringify(FG.BUILD)`));
const KLV = JSON.parse(await ev(`JSON.stringify(FG.KEEP_LV)`));
for (const id of KLV) {
  const l = B[id].lv;
  console.log('  ' + B[id].name + '：' + l.map(x =>
    x.yield.n + ' ' + x.yield.k + '/' + x.days + '天/' + x.price + '钱/' + x.noun).join('　'));
}
ok('三样棚各自有自己的产物和量词',
  new Set(KLV.map(id => B[id].lv[0].yield.k)).size === KLV.length
  && new Set(KLV.map(id => B[id].lv[0].noun)).size === KLV.length,
  KLV.map(id => id + ':' + B[id].lv[0].yield.k + '/' + B[id].lv[0].noun).join('　'));
ok('牛羊撒一次管得比鸡久（表上）',
  B.barn.lv.every(l => l.days > B.coop.lv[0].days) && B.sheep.lv.every(l => l.days > B.coop.lv[0].days),
  '鸡 ' + B.coop.lv[0].days + '　牛 ' + B.barn.lv[0].days + '　羊 ' + B.sheep.lv[0].days + ' 天');
// 加工品得比等价的原料贵，否则玩家不如直接卖原料
for (const [k, need] of [['nai', 2], ['mao', 2]]) {
  const r = JSON.parse(await ev(`(function(){
    var a=FG.BAG_IDX['${k}'], outs=[];
    for (var m in FG.MACHINE_RECIPES) FG.MACHINE_RECIPES[m].forEach(function(r){
      if (r.need['${k}']) outs.push(r.out); });
    return JSON.stringify({sell:a.sell, outs:outs, outSell:outs.map(function(o){return FG.BAG_IDX[o].sell})});})()`));
  ok(k + ' 卖价比原料贵，也比做出来的东西便宜',
    r.sell > 0 && r.outs.length > 0 && r.outSell.every(s => s > r.sell),
    '原料 ' + r.sell + '　→　' + r.outs.map((o, i) => o + ' ' + r.outSell[i]).join(' / '));
}
const jarHas = async o => (await ev(`(function(){
  var hit=0; for (var m in FG.MACHINE_RECIPES) FG.MACHINE_RECIPES[m].forEach(function(r){ if (r.out==='${o}') hit++; });
  return hit;})()`)) > 0;
ok('奶和毛各有一条坛里的配方', await jarHas('huangyou') && await jarHas('maoxian'));

console.log('— 溪畔的两样棚，判定不和渔父、出口打架 —');
const clash = await ev(`(function(){
  var m=FG.MAPS.xipan, bad=[];
  ['barn','sheep'].forEach(function(id){
    var a=FG.BUILD[id].at, r=FG.BUILD[id].r;
    m.npcs.forEach(function(n){ var q=FG.NPCS[n];
      if (Math.abs(q.at[0]-a[0])+Math.abs(q.at[1]-a[1]) < r+150) bad.push(id+'×人'); });
    m.exits.forEach(function(e){
      if (Math.abs(e.at[0]-a[0])+Math.abs(e.at[1]-a[1]) < r+e.r) bad.push(id+'×口'); });
  });
  var a=FG.BUILD.barn.at, b=FG.BUILD.sheep.at;
  if (Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]) < FG.BUILD.barn.r+FG.BUILD.sheep.r) bad.push('牛棚×羊圈');
  return bad.join(',')||'(无)';})()`);
ok('两样棚各归各的判定圈', clash === '(无)', clash);

console.log('— 牛棚：一头牛、一罐奶、撒一次管五天 —');
// 先看没造的时候。这一段**不能顺手把 build.barn 设成 1** ——
// 设了之后提示行当然说「门关着」，而那条断言问的是「没造的时候说什么」
await ev(`(function(){
  FG.state.build.barn=0;
  for (var k in FG.state.bag) delete FG.state.bag[k];
  FG.state.bag.su=8; FG.state.gold=20000; FG.updateHUD(); return 1})()`);
await standAt('barn');
ok('没造的时候，提示行说的是「这儿空着」和能造什么', /空着/.test(await hint()) && /牛棚/.test(await hint()), await hint());
await clearToast();
await key('e');
await sleep(350);
ok('空地上按 E 不会白挤', (await ev(`FG.state.made.nai || 0`)) === 0 && (await K('barn')).gate === 0, await toast());

console.log('— 门关着：五天里一天也没有 —');
await ev(`(function(){ FG.state.build.barn=1; return 1 })()`);
await nextDay(6);
ok('造了但门关着，六天下来一罐也没有', (await K('barn')).got === 0, JSON.stringify(await K('barn')));

console.log('— 开门 + 撒粮 —');
await ev(`(function(){ for (var k in FG.state.bag) delete FG.state.bag[k]; FG.state.bag.su=8; FG.updateHUD(); return 1})()`);
await standAt('barn');
ok('门关着时提示说的是「E 开门」', (await hint()).indexOf('开门') >= 0, await hint());
const g0 = await grain();
await clearToast();
await key('e');
await sleep(400);
let kb = await K('barn');
ok('按 E 门开了', kb.gate === 1);
ok('顺手撒了粮，管五天（不是鸡舍的三天）', kb.feed === B.barn.lv[0].days,
  'feed=' + kb.feed + '（表上 ' + B.barn.lv[0].days + '）');
ok('撒粮扣掉了一捆谷', (await grain()) === g0 - 1, g0 + ' → ' + await grain());
ok('那一句写清了撒的是什么', /豆|粟|黍|稷|菊/.test(await toast()), await toast());

console.log('— 一天一罐，不去挤就一直攒 —');
await nextDay(1);
kb = await K('barn');
ok('头一天早上攒下一罐', kb.got === 1 && kb.feed === 4, JSON.stringify(kb));
ok('还没挤就不在手上', (await ev(`FG.state.made.nai || 0`)) === 0);
await nextDay(2);
kb = await K('barn');
ok('不挤不会清零，一天一天往上加', kb.got === 3, 'got=' + kb.got);
ok('粮是一天一天扣的', kb.feed === 2, 'feed=' + kb.feed);

console.log('— 走到棚跟前按 E 收 —');
await standAt('barn');
ok('提示行写得出堆着几罐', (await hint()).indexOf('3 罐') >= 0, await hint());
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 });
await sleep(200);
await shot('47-牛棚-三罐.png');
await clearToast();
await key('e');
await sleep(400);
ok('奶进了手', (await ev(`FG.state.made.nai`)) === 3, 'nai=' + await ev(`FG.state.made.nai`));
ok('草窝清空了', (await K('barn')).got === 0);
ok('那一句用的是「挤」和量词「罐」', /挤了 3 罐奶/.test(await toast()), await toast());
await clearToast();
await key('e');
await sleep(400);
ok('再按一次是关门，不多给', (await ev(`FG.state.made.nai`)) === 3 && (await K('barn')).gate === 0,
  JSON.stringify(await K('barn')));
ok('并且说清了明早再来', /明早/.test(await toast()), await toast());

console.log('— 没粮了：只少收，不倒扣 —');
await ev(`(function(){ for (var k in FG.state.bag) delete FG.state.bag[k]; return 1})()`);
await ev(`(function(){ var o=FG.keepState('barn'); o.gate=1; o.feed=0; o.got=0; return 1})()`);
await nextDay(3);
kb = await K('barn');
ok('断粮三天，零产出', kb.got === 0, JSON.stringify(kb));
ok('门还是开着的（没被系统悄悄关掉）', kb.gate === 1);
ok('也没有掉血、没有死', (await ev(`FG.state.stam`)) === 100 && (await ev(`FG.state.day`)) > 1,
  'stam=' + await ev(`FG.state.stam`));
await standAt('barn');
ok('提示行直说「没有粮了」', /没有粮/.test(await hint()), await hint());
ok('「没有粮」的时候按 E 不会白收', (await ev(`FG.state.made.nai || 0`)) === 3, await toast());
// 补一把粮接着有产出：断粮不是「永久停产」
await ev(`(function(){ FG.state.bag.su=3; FG.updateHUD(); return 1})()`);
await ev(`(function(){ var o=FG.keepState('barn'); o.gate=0; return 1})()`);
await standAt('barn');
await key('e');
await sleep(400);
ok('撒把粮就接上', (await K('barn')).feed === B.barn.lv[0].days, JSON.stringify(await K('barn')));
await nextDay(1);
ok('下一早就又有产出', (await K('barn')).got === 1, JSON.stringify(await K('barn')));

console.log('— 升到二级：一趟两罐 —');
await ev(`(function(){ FG.state.build.barn=2; return 1})()`);
await ev(`(function(){ var o=FG.keepState('barn'); o.got=0; o.feed=5; return 1})()`);
await nextDay(1);
ok('二级一个早上出两罐', (await K('barn')).got === 1, 'got=' + (await K('barn')).got + '（got 数的是早上，出的是 ' +
  (await K('barn')).got * B.barn.lv[1].yield.n + ' 罐）');
await standAt('barn');
ok('提示行按二级报数：两罐', (await hint()).indexOf('2 罐') >= 0, await hint());
await clearToast();
await key('e');
await sleep(400);
ok('收下来的是两罐', (await ev(`FG.state.made.nai`)) === 5, 'nai=' + await ev(`FG.state.made.nai`) + '（原来 3）');
ok('那一句说的是两罐', /挤了 2 罐奶/.test(await toast()), await toast());

console.log('— 羊圈：一头羊、一团毛，同一套 —');
await ev(`(function(){
  for (var k in FG.state.bag) delete FG.state.bag[k];
  FG.state.bag.su=8; FG.state.build.sheep=1; FG.updateHUD(); return 1})()`);
await nextDay(1);
ok('羊圈门关着也是零', (await K('sheep')).got === 0);
await standAt('sheep');
ok('门关着的时候提示说的是「E 开门」', /开门/.test(await hint()), await hint());
await key('e');
await sleep(400);
let ks = await K('sheep');
ok('开门 + 撒粮，管五天', ks.gate === 1 && ks.feed === B.sheep.lv[0].days, JSON.stringify(ks));
// 收羊这一下不能碰牛。牛那头这些天自己攒着的账一个字都不许变
await nextDay(2);
ok('两天攒两团', (await K('sheep')).got === 2, JSON.stringify(await K('sheep')));
await standAt('sheep');
ok('提示行写得出两团', (await hint()).indexOf('2 团') >= 0, await hint());
const barnBefore = JSON.stringify(await K('barn'));
await clearToast();
await key('e');
await sleep(400);
ok('毛进了手', (await ev(`FG.state.made.mao`)) === 2, 'mao=' + await ev(`FG.state.made.mao`));
ok('那一句用的是「剪」和量词「团」', /^剪了 2 团羊毛。$/.test(await toast()), await toast());
ok('在羊圈按 E，牛那一头一个字都没动',
  JSON.stringify(await K('barn')) === barnBefore, '牛 ' + JSON.stringify(await K('barn')) + '（按 E 之前 ' + barnBefore + '）');
ok('两样棚的草窝是分开的两本', (await K('sheep')).got === 0 && (await ev(`FG.state.made.nai`)) === 5,
  '羊 got=' + (await K('sheep')).got + '　nai=' + await ev(`FG.state.made.nai`));

console.log('— 两样棚互不相干 —');
ok('牛那头这几天攒下的账还在', (await ev(`FG.state.made.nai`)) === 5, 'nai=' + await ev(`FG.state.made.nai`));
ok('羊那头收完了草窝也空着', (await K('sheep')).got === 0 && (await ev(`FG.state.made.mao`)) === 2);

console.log('— 产物是加工品：能出货，也能进坛 —');
for (const k of ['nai', 'mao']) {
  const s = await ev(`FG.BAG_IDX['${k}'].sell`);
  ok(k + ' 在总表里、价钱不是零', s > 0, s + ' 钱');
}
await ev(`(function(){ FG.state.bin.nai=2; FG.state.bin.mao=1; FG.updateHUD(); return 1})()`);
ok('能放进出货箱', (await ev(`FG.binWorth()`)) === 2 * (await ev(`FG.BAG_IDX.nai.sell`)) + (await ev(`FG.BAG_IDX.mao.sell`)),
  '箱 ' + await ev(`FG.binWorth()`));
ok('奶和毛在行囊里排得出来',
  (await ev(`(function(){var n=0,k;for(k in FG.BAG_IDX) if(k==='nai'||k==='mao') n++; return n})()`)) === 2);
// 坛这一本账在 S.mach.lv —— 摆到 S.build.mach 上去的话 machPut 一开头
// 就说「这儿还空着」，而那看着像「坛买回来用不了」
await ev(`(function(){
  FG.state.mach={lv:{jar:1},job:{}};
  FG.state.made.nai=4; FG.state.made.mao=4; FG.updateHUD(); return 1})()`);
// 一级坛 in=2，所以一条方子要的是 need × 2 的料
const jin = await ev(`FG.MACHINE.jar.lv[0].in`);
await ev(`FG.machPut('jar')`);
ok('四罐奶进坛，这一坛做黄油', (await ev(`FG.state.made.nai`)) === 0
  && (await ev(`FG.machJob('jar').out`)) === 'huangyou', await ev(`JSON.stringify(FG.machJob('jar'))`));
// 够不够料的那条判据和真扣的那一份必须是同一个数。
// 判 need、扣 need×in 的话，一级坛会跟玩家说「两罐够了」，
// 真按下去扣不动也不报错 —— 白得一坛黄油。
// 手上别的料要一并清干净：留着四团毛的话坛会去腌毛线，那是另一回事，
// 而这一条问的是「奶只有一半」的时候按 E 发生什么
await ev(`(function(){
  FG.state.mach={lv:{jar:1},job:{}};
  for (var k in FG.state.made) delete FG.state.made[k];
  for (var j in FG.state.pouch) delete FG.state.pouch[j];
  FG.state.made.nai=2; FG.updateHUD(); return 1})()`);
await ev(`FG.machPut('jar')`);
ok('料差一半的时候按 E 什么也不发生', (await ev(`!!FG.machJob('jar')`)) === false
  && (await ev(`FG.state.made.nai`)) === 2, 'nai=' + await ev(`FG.state.made.nai`) + '（差一半，没扣也没开工）');
// 10/4 那一轮把「手上的料不够」换成了点名缺哪一味、差几份：
// 坛有五条方子，只说「料不够」玩家不知道自己该去采哪一味
const tNeed = (await toast()).replace(/\s+/g, ' ');
ok('并且说清了缺哪一味、差多少',
  /奶/.test(tNeed) && /手上\s*2/.test(tNeed), tNeed);
ok('坛上摆的是差得最近的那一条', (await ev(`FG.machRcp('jar').out`)) === 'huangyou', await ev(`FG.machRcp('jar').out`));
// 一口坛只腌一样，所以毛线得等这一坛起了再投
await ev(`(function(){
  for (var k in FG.state.made) delete FG.state.made[k];
  FG.state.mach={lv:{jar:1},job:{}};
  FG.state.made.nai=4; FG.updateHUD(); return 1})()`);
await ev(`FG.machPut('jar')`);
await ev(`(function(){ FG.state.day = FG.machJob('jar').at; return 1})()`);
await ev(`FG.machTake('jar')`);
ok('起了坛得黄油', (await ev(`FG.state.made.huangyou`)) > 0, 'huangyou=' + await ev(`FG.state.made.huangyou || 0`));
// 手上还留着一罐黄油，坛上也该挑**做得出来的那一条**
await ev(`(function(){ FG.state.made.mao=4; FG.updateHUD(); return 1})()`);
ok('手里有黄油也不挡着做毛线',
  (await ev(`FG.machRcp('jar').out`)) === 'maoxian', await ev(`FG.machRcp('jar').out`));
await ev(`FG.machPut('jar')`);
ok('四团毛进坛，这一坛做毛线', (await ev(`FG.state.made.mao`)) === 0
  && (await ev(`FG.machJob('jar').out`)) === 'maoxian', await ev(`JSON.stringify(FG.machJob('jar'))`));
console.log('  一级坛 in=' + jin + '，所以黄油要 ' + 2 * jin + ' 罐奶、毛线要 ' + 2 * jin + ' 团毛');

console.log('— 存档往返 —');
await ev(`(function(){
  FG.state.build.barn=2; FG.state.build.sheep=1;
  var a=FG.keepState('barn'); a.gate=1; a.feed=4; a.got=2;
  var b=FG.keepState('sheep'); b.gate=0; b.feed=3; b.got=1;
  FG.state.made.nai=3; FG.state.made.mao=2; FG.saveGame(); return 1})()`);
await sleep(300);
const sa = await ev(`JSON.stringify({b:FG.state.build,k:FG.state.keep,d:FG.state.made})`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
const sb = await ev(`JSON.stringify({b:FG.state.build,k:FG.state.keep,d:FG.state.made})`);
ok('三样棚的等级和那本账原样还在', sa === sb, sa + ' / ' + sb);

console.log('— 老存档没有棚这本账 —');
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
  delete raw.keep; localStorage.setItem(${JSON.stringify(SAVEKEY)}, JSON.stringify(raw)); return 1})()`);
const logMark = logs.length;
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
ok('这本账补回来了（三样都在、都是零）',
  (await ev(`(function(){var o=FG.state.keep;
    if (!o || typeof o!=='object') return 0;
    for (var i=0;i<FG.KEEP_LV.length;i++){var q=o[FG.KEEP_LV[i]];
      if (!q || q.gate!==0 || q.feed!==0 || q.got!==0) return 0;}
    return 1;})()`)) === 1,
  await ev(`JSON.stringify(FG.state.keep)`));
ok('老档读出来不报新异常', logs.length === logMark, logs.slice(logMark).join(' | ') || '干净');
await ev(`(function(){ FG.state.build.barn=9; FG.nextDay(); return 1 })()`);
await sleep(450);
ok('存档被改成越界等级时按「没有」算', (await K('barn')).got === 0, JSON.stringify(await K('barn')));

console.log('— 重开归零 —');
await ev(`FG.restart()`);
await sleep(900);
ok('重开后三样棚都没造', (await ev(`(function(){for(var i=0;i<FG.KEEP_LV.length;i++)
  if (FG.state.build[FG.KEEP_LV[i]]!==0) return 0; return 1})()`)) === 1,
  await ev(`JSON.stringify(FG.state.build)`));
ok('三样草窝都空了', (await ev(`JSON.stringify(FG.state.keep)`)) ===
  (await ev(`(function(){var o={};for(var i=0;i<FG.KEEP_LV.length;i++)o[FG.KEEP_LV[i]]={gate:0,feed:0,got:0};return JSON.stringify(o)})()`)),
  await ev(`JSON.stringify(FG.state.keep)`));
ok('奶和毛也没了', (await ev(`FG.state.made.nai || 0`)) === 0 && (await ev(`FG.state.made.mao || 0`)) === 0);

console.log('— 画面：1× 下三样认不认得出来 —');
await ev(`(function(){
  FG.gotoMap('xipan');
  FG.state.build.barn=1; FG.state.build.sheep=1;
  var a=FG.keepState('barn'); a.gate=1; a.feed=5; a.got=1;
  var b=FG.keepState('sheep'); b.gate=1; b.feed=5; b.got=1;
  FG.state.player.x=760; FG.state.player.y=1050; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 });
await sleep(500);
await shot('48-溪畔-牛羊.png');
ok('溪畔同框截了一张', true);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
