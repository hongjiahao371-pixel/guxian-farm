// 营造验收：鸡舍（动物饲养）与水渠（洒水器）。
//
// 星露谷那两样在这儿不是照搬：洒水器是「每天替你做一遍」的自动化，
// 动物是「每天给你一件东西」的产出。两条都做成**立在地上的营造**，
// 分级跟器物同构 —— 场合一点不变，只改一次做多少：
//   鸡舍：还是每天早上那几只鸡，1 枚蛋 → 2 枚蛋
//   水渠：还是每天早上浇的那些畦，2 行 → 5 行
//
// 盯住六条规矩：
//   1) 营造**不占器物架也不占键位**（#keys 到器物架只剩 57px，加不下）
//   2) 造好了手上的器物不能被改坏（买鸡舍不该把手上的锄换成鸡舍）
//   3) 东西是**明早**才有：今天造的不当场兑现
//   4) 不捡蛋不会坏，也不会清零 —— 一天一天地攒
//   5) 水渠只浇**翻过的**畦，且只浇渠道那几行，且不扣体力
//   6) 水渠没有按 E 的判定点（纯被动的，不该让玩家多走一趟）
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9377;
const profile = path.join(tmpdir(), 'guxian-build-' + process.pid);

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
  await sleep(160);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
const toast = () => ev(`document.getElementById('toast').textContent`);
// toast 淡出之后 textContent 还留在那儿。测「刚才弹的是哪一句」之前
// 先自己清一次 —— 不然读到的是上一条，那句答案看着还挺像那么回事
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
const shopOpen = () => ev(`!document.getElementById('sh').classList.contains('hide')`);
// 走到营造跟前。传的是 FG.BUILD 的 key，判定点、**所在哪张图**都从源码拿。
// 写死 gotoMap('nanshan') 的话牛棚羊圈永远站在原地 —— 而那看着像「牛棚没了」
async function standAt(id) {
  await ev(`(function(){
    var mk=null; for (var k in FG.MAPS){ var b=FG.MAPS[k].builds||[]; if (b.indexOf('${id}')>=0) mk=k; }
    FG.gotoMap(mk);
    var b=FG.BUILD['${id}'];
    FG.state.player.x=b.at[0]; FG.state.player.y=b.at[1]+40; FG.state.walkTo=null;
    return 1})()`);
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
await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

console.log('— 营造表自己站得住 —');
const B = JSON.parse(await ev(`JSON.stringify(FG.BUILD)`));
const IDS = Object.keys(B);
const BLV = JSON.parse(await ev(`JSON.stringify(FG.BUILD_LV)`));
const KLV = JSON.parse(await ev(`JSON.stringify(FG.KEEP_LV)`));
console.log('  ' + IDS.map(k => k + '(' + B[k].name + ')').join('　'));
// 营造表跟 BUILD_LV 对得上。**写死「有两样」过两年就得改**，
// 而改的时候没人会想起来还有一张表在 —— 两张表各说各话，多的那一样是查不出来的
ok('营造表和 BUILD_LV 一张不多一张不少', IDS.length === BLV.length && BLV.every(k => IDS.indexOf(k) >= 0),
  '表 ' + IDS.length + ' / 名单 ' + BLV.length + '：' + IDS.join(','));
// **每一类营造按它自己那个「给了什么」的字段来判**，不按 id 写死。
// 原来这条是 `if (k==='ditch') … else 读 yield`，加了温窒（winter）之后
// 它当场炸在 `l.yield.n` 上 —— 而症状是「营造表自己站不住」，
// 看着像表坏了，其实是判据把新那一类当成了棚。
// 写死 id 的那一版，每加一样营造都得回来改这里，改漏了就是假失败
const EFFECT = {
  yield: l => l.yield ? l.yield.n : null,     // 棚：每天几份
  rows: l => (typeof l.rows === 'number' ? l.rows : null),  // 水渠：每天几行
  winter: l => (typeof l.winter === 'number' ? l.winter : null),  // 温窒：藏季还封不封
  // 狗窝：几天跑一趟。机器也用 days，但那一张表不走这里（EFFECT 只对营造用）
  days: l => (typeof l.days === 'number' ? l.days : null)
};
const effectOf = k => Object.keys(EFFECT).filter(f => B[k].lv.some(l => EFFECT[f](l) !== null));
const yields = k => B[k].lv.every(l => !!l.yield);
console.log('  各类：' + IDS.map(k => k + '={' + effectOf(k).join(',') + '}').join('　'));
// 每一样营造**归到的类不能是空的**，而且**不能有哪个数没人认得**。
// 原先写的是「恰好一类」—— 棚本来就有两个数（产量 + 喂几天），
// 温窒二级又多一个 q，那条判据是在跟数据结构较劲。
// 真正要抓的是**漏认**：给某一级加了一个新字段而这里没跟上，
// 那么「分级只改数量」那条就会拿着旧的那几个字段去比，比出个假结论
// noun 是量词（「2 枚蛋」那个枚），q 是温窒二级的品级 —— 都不是「给多少」，
// 是「怎么称呼 / 加不加一档」，所以列在 KNOWN 里但不进 EFFECT
const KNOWN = Object.keys(EFFECT).concat(['name', 'price', 'desc', 'unit', 'noun', 'q']);
const unknown = [];
for (const k of IDS) for (const l of B[k].lv) {
  for (const f of Object.keys(l)) {
    if (KNOWN.indexOf(f) < 0) unknown.push(k + '.' + f);
  }
}
ok('每一样营造都归到至少一类', IDS.every(k => effectOf(k).length >= 1),
  IDS.map(k => k + '→' + effectOf(k).join('/')).join('　'));
ok('表上没有一个数没人认得（加了新字段这条当场抓住）', unknown.length === 0,
  unknown.join(' ') || '(都认得)');
ok('棚那几样（yield）正好是有 act 的那些',
  IDS.filter(k => yields(k)).join(',') === KLV.join(','),
  'yield 的=' + IDS.filter(k => yields(k)).join(',') + '　KEEP_LV=' + KLV.join(','));
// KEEP_LV 是 **keepUse 那一支的名单**，不是「所有能按 E 的营造」的名单。
// 反过来不成立：狗窝（17/9）也有 act，但它走 dogTake，不进棚那一套 ——
// 它没有门、没有草料、没有堆着的蛋，硬塞进 KEEP_LV 的话
// 喂食和取货会一起去动一个不存在的账。
// 所以这里只核**包含关系**，不核数量：写死 3 的话加一样狗那样的就红。
ok('KEEP_LV 里每一个都有 act（没有 act 就按 E 也管不着）',
  KLV.length > 0 && KLV.every(k => B[k].act),
  'KEEP_LV=' + KLV.join(','));
ok('有 act 却不在 KEEP_LV 的那几样，都不产棚里那些货',
  IDS.filter(k => B[k].act && KLV.indexOf(k) < 0).every(k => !yields(k)),
  '不在 KEEP_LV 里的=' + IDS.filter(k => B[k].act && KLV.indexOf(k) < 0).join(',')
  + '　有 act 的=' + IDS.filter(k => B[k].act).join(','));
ok('每一级都写了名字、价钱、说明',
  IDS.every(k => B[k].lv.every(l => l.name && l.price > 0 && l.desc && l.desc.length > 6)));
ok('每一级都比上一级贵',
  IDS.every(k => B[k].lv.every((l, i) => i === 0 || l.price > B[k].lv[i - 1].price)),
  IDS.map(k => k + ' ' + B[k].lv.map(l => l.price).join('→')).join('　'));
// 分级只改数量不改场合：每一类**用它自己那个数**，一级必须比一级多。
// 只有一级的（温窒）没有「二级比一级多」这一条可判 —— 那不是漏了，是它就一级
const shownOf = k => effectOf(k).map(f => {
  const vals = B[k].lv.map(l => EFFECT[f](l));
  return (f === 'yield' ? vals.join('→') + ' ' + B[k].lv[0].yield.k + '/天' : vals.join('→') + ' ' + f);
}).join('　');
// 有分级的每一级真的多给了（单级的不参与这一条）。,// **比的是整组效果字段，不是第一个找到的那一个** —— 温窒一级给 winter、,// 二级再加一个 q；只看 winter 的话二级跟一级一样，当场红。,// 而看着像「温窒二级白给了一级之外的东西」。,const moreOf = (k, i) => effectOf(k).filter(f => EFFECT[f](B[k].lv[i]) !== null,  && EFFECT[f](B[k].lv[i]) > EFFECT[f](B[k].lv[i - 1]));,ok('有分级的每一级真的多给了（单级的不参与这一条）',,  IDS.every(k => B[k].lv.length < 2 || B[k].lv.every((l, i) => i === 0 || moreOf(k, i).length > 0)),,  IDS.map(k => k + ' ' + B[k].lv.map((l, i) => i === 0 ? '一' : (moreOf(k, i).join('+') || '✗没多给')).join('→'),    + (B[k].lv.length < 2 ? '（单级）' : '')).join('　'));,
// 棚那一族同一场合：二级出的**是同一样东西**，只是多几份
ok('同一场合：二级出的东西跟一级是同一样，只是多几份',
  IDS.filter(yields).every(k => B[k].lv.every(l => l.yield.k === B[k].lv[0].yield.k)),
  IDS.filter(yields).map(k => k + ':' + B[k].lv.map(l => l.yield.k).join('→')).join('　'));
ok('最贵的水渠那一级也不超出一张田（5 行）', B.ditch.lv[B.ditch.lv.length - 1].rows <= 5,
  B.ditch.lv.map(l => l.rows).join(','));
ok('三样棚都有「按 E 要做的事」，水渠和温窒是纯被动的',
  KLV.every(k => B[k].act) && !B.ditch.act && !B.warm.act,
  KLV.map(k => k + '.act=' + B[k].act).join('　') + '　ditch.act=' + (B.ditch.act || '(无)')
  + '　warm.act=' + (B.warm.act || '(无)'));
// 牛羊食量大，撒一次管得比鸡久 —— 不这样的话三样棚只是换了个产出
ok('牛羊撒一次管得比鸡久', B.barn.lv.every(l => l.days > B.coop.lv[0].days) && B.sheep.lv.every(l => l.days > B.coop.lv[0].days),
  '鸡 ' + B.coop.lv[0].days + ' 天　牛 ' + B.barn.lv[0].days + ' 天　羊 ' + B.sheep.lv[0].days + ' 天');
// 营造的 id 不能跟行囊 / 器物架上的撞。
// 第一版把鸡舍叫 ji —— 而 ji 是稷种的 key，两样东西同名不同物，
// 混在一本账里是没事（营造在 S.build、稷在 S.seeds），但
// 「查一样东西在不在器物架上」那种判据会当场误判，而看着还挺有道理
const keyClash = await ev(`(function(){
  var bad=[];
  for (var b in FG.BUILD) {
    if (FG.TOOLS.map(function(t){return t.k}).indexOf(b) >= 0) bad.push(b+'×器物架');
    if (FG.BAG_IDX[b]) bad.push(b+'×行囊');
    if (FG.CROPS[b] || FG.FISH[b] || FG.GOODS[b] || FG.ORE[b] || FG.NPCS[b]) bad.push(b+'×别的表');
  }
  return bad.join(',') || '(无)';})()`);
ok('营造的 id 不跟别的东西重名', keyClash === '(无)', keyClash);
// 营造必须挂在某张图上，且坐标落在**那张图**的可行走带里。
// 写死「南山」的时候牛棚羊圈搬到溪畔就没人管了 —— 而查出来的样子是
// 「南山少了两样」，看着像有人把营造删了，不像判定写死了
const onMaps = JSON.parse(await ev(`(function(){var o={};for(var k in FG.MAPS)o[k]=FG.MAPS[k].builds||[];
  return JSON.stringify(o)})()`));
const ownerOf = {};
for (const mk in onMaps) for (const b of onMaps[mk]) ownerOf[b] = mk;
ok('每一样营造都挂在恰好一张图上',
  IDS.every(b => ownerOf[b]) && Object.keys(ownerOf).length === IDS.length
  && Object.keys(onMaps).every(mk => new Set(onMaps[mk]).size === onMaps[mk].length),
  IDS.map(b => b + '→' + ownerOf[b]).join('　'));
ok('挂着营造的图就是它们各挂在的那几张',
  Object.keys(onMaps).filter(mk => onMaps[mk].length).sort().join(',')
  === [...new Set(IDS.map(b => ownerOf[b]))].sort().join(','),
  Object.keys(onMaps).map(mk => mk + '[' + onMaps[mk].join(',') + ']').join(' '));
// 可走带从图上读，不另抄一份 1880/1056 —— 抄的那份跟图分叉了没人知道
const bnd = JSON.parse(await ev(`(function(){var o={};for(var k in FG.MAPS)o[k]=FG.MAPS[k].bounds;return JSON.stringify(o)})()`));
const inBounds = IDS.map(k => {
  const a = B[k].at, m = bnd[ownerOf[k]];
  const fit = a[0] > m.x0 + 60 && a[0] < m.x1 - 60 && a[1] > m.y0 + 40 && a[1] < m.y1 - 20;
  return k + '@' + ownerOf[k] + '=' + a + (fit ? '' : ' ✗出界');
});
ok('每个判定点都落在自己那张图的可行走带里', inBounds.every(s => s.indexOf('✗') < 0), inBounds.join('　'));

// 判定圈不能和别的判定点撞上：E 归谁看的就是这些半径。
// 半径和 NPC / 出口的坐标都从**它自己所在那张图**上读 ——
// 溪畔没有 home，写死 m.home[0] 的话那一支直接读到 undefined，算出来的距离是 NaN，
// 而 NaN < 什么 都是假的，判定会安安静静地放行
const clashes = [];
for (const k of IDS) {
  const a = B[k].at, r = B[k].r, mk = ownerOf[k];
  const ns = await ev(`(function(){
  var m=FG.MAPS['${mk}'], out=[];
  for (var i=0;i<m.npcs.length;i++){ var n=FG.NPCS[m.npcs[i]];
    out.push(['人:'+n.id, Math.abs(n.at[0]-${a[0]})+Math.abs(n.at[1]-${a[1]}), 150]); }
  for (var j=0;j<m.exits.length;j++){ var e=m.exits[j];
    out.push(['口:'+e.to, Math.abs(e.at[0]-${a[0]})+Math.abs(e.at[1]-${a[1]}), e.r]); }
  if (m.home) out.push(['归家', Math.abs(m.home[0]-${a[0]})+Math.abs(m.home[1]-${a[1]}), m.homeR]);
  return JSON.stringify(out);})()`);
  for (const [what, d, rr] of JSON.parse(ns)) {
    if (d < r + rr) clashes.push(k + ' × ' + what + ' 曼哈顿 ' + d + ' < ' + (r + rr));
  }
}
ok('判定圈不和 NPC / 出口 / 归家打架', clashes.length === 0, clashes.join('　') || '(无)');

console.log('— 货单上摆得出来 —');
const shopRows = JSON.parse(await ev(`(function(){
  var out=[]; FG.SHOP.xushi.forEach(function(r){ if (r.kind==='build')
    out.push(r.b+':'+r.lv); }); return JSON.stringify(out)})()`));
// 「一样两格」——**温窒只有一级**（它解的是藏季那条封冻，一级就解完了）。
// 所以这里核的是「每一级都上了货单」，不是「每样两格」。
// 写死 IDS.length*2 的话，加一样单级营造当场红，而症状是「营造没上货单」
const multiLv = IDS.filter(b => B[b].lv.length > 1);
ok('每一级都上了货单（单级的只占一格）',
  shopRows.length === IDS.length + multiLv.length
  && IDS.every(b => shopRows.indexOf(b + ':1') >= 0)
  && multiLv.every(b => shopRows.indexOf(b + ':2') >= 0),
  shopRows.join('　') + '　（单级：' + IDS.filter(b => B[b].lv.length < 2).join(',') + '）');
// 营造不进器物架、不占键位 —— #keys 到器物架只剩 57px，加不了第九格
const tray = JSON.parse(await ev(`JSON.stringify(FG.TOOLS.map(function(t){return t.k}))`));
ok('营造不进器物架（也不该占键位）', !IDS.some(k => tray.indexOf(k) >= 0), tray.join(','));
ok('键位条没有跟着变', (await ev(`document.getElementById('keys').textContent.indexOf('1-8') >= 0`)) === true,
  await ev(`document.getElementById('keys').textContent`));

console.log('— 开局：一块地都还没起 —');
ok('四样都还没造', (await ev(`(function(){var n=0;for(var i=0;i<FG.BUILD_LV.length;i++)
  if (FG.state.build[FG.BUILD_LV[i]]===0) n++; return n})()`)) === IDS.length,
  await ev(`JSON.stringify(FG.state.build)`));
ok('三样草窝都是空的（门关、没粮、没堆货）',
  (await ev(`(function(){var n=0;for(var i=0;i<FG.KEEP_LV.length;i++){
    var o=FG.keepState(FG.KEEP_LV[i]);
    if(o.got===0&&o.feed===0&&o.gate===0) n++;} return n})()`)) === KLV.length,
  await ev(`JSON.stringify(FG.state.keep)`));

console.log('— 没造的时候，地上也有话说 —');
await standAt('coop');
ok('鸡舍那个位置有判定', (await ev(`(FG.nearBuild()||{}).id`)) === 'coop',
  await ev(`(FG.nearBuild()||{}).id`));
ok('提示行说了这儿能造什么', (await hint()).indexOf('鸡舍') >= 0, await hint());
await clearToast();
await ev(`FG.coopTake()`);
await sleep(200);
ok('空地上按 E 不会白捡', (await ev(`FG.state.made.dan || 0`)) === 0 && (await ev(`FG.keepState('coop').got`)) === 0,
  await toast());

console.log('— 墟市：只能一级一级买 —');
await ev(`FG.state.gold = 20000`);
await ev(`(function(){
  FG.gotoMap('xushi');
  var n=FG.NPCS.xushi;
  FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+40; FG.state.walkTo=null; return 1})()`);
await sleep(430);
await key('b');
await sleep(400);
ok('铺子开得起来', await shopOpen());
// 价钱在**画出来的面板上**核。抄一份 FG 到 Node 侧再比，比的就是
// 「抄的那份和抄的那份」—— 而 FG 只存在于页面里，那份抄件根本不存在。
// 二级那两格一开始是锁着的，锁着的时候写的是「得先有前一个」而不是价钱，
// 所以这一条只核一级的两格；二级等买完一级之后再核（下面有）
const priceBad = [];
for (const s of shopRows.filter(x => /:1$/.test(x))) {
  const p = s.split(':');
  const want = B[p[0]].lv[0].price + ' 钱';
  const shown = await ev(`(function(){
    var rows = FG.SHOP.xushi.filter(function(r){return r.kind==='build' && r.b==='${p[0]}' && r.lv===1});
    var e = rows.length ? document.querySelector('[data-k="'+rows[0].k+'"]') : null;
    return e ? e.querySelector('u').textContent : '(不在面板上)';})()`);
  priceBad.push(s + ' 面板="' + shown + '" 表="' + want + '"' + (shown === want ? '' : ' ✗'));
}
console.log('  ' + priceBad.join('　'));
ok('样样一级都写着价钱（还没买）', priceBad.every(x => x.indexOf('✗') < 0));
// 二级那几格一开始都锁着。名单从表上扫出来 —— 写死 ['b2','b4'] 的话
// 后面加了牛棚羊圈，那两格锁没锁就没人看了
const lv2keys = JSON.parse(await ev(`(function(){
  var o=[]; FG.SHOP.xushi.forEach(function(r){ if(r.kind==='build'&&r.lv===2) o.push(r.k); });
  return JSON.stringify(o)})()`));
const locked = await ev(`(function(){
  var o=[]; ${JSON.stringify(lv2keys)}.forEach(function(k){
    var e=document.querySelector('[data-k="'+k+'"]'); o.push(k+'='+(e?e.querySelector('u').textContent:'(不在面板上)')); });
  return o.join('　');})()`);
ok('有分级的每一格二级都锁着（' + lv2keys.length + ' 格）',
  lv2keys.length === multiLv.length && /得先有前一个/.test(locked), locked);
await ev(`document.querySelector('[data-k="b2"]').click()`);
await sleep(350);
ok('点了也升不了级', (await ev(`FG.state.build.coop`)) === 0, await ev(`JSON.stringify(FG.state.build)`));
ok('钱也没被扣', (await ev(`FG.state.gold`)) === 20000);
// 面板加到十几格还放得下。**上下两条边都要看**：
// .overlay 是居中 flex，面板比视口高的时候上沿顶出 y=0，
// 头两行直接看不见 —— 而只看 bottom 的话它正好等于 vh，看着一切正常
const shBox = JSON.parse(await ev(`(function(){
  var l=document.getElementById('sh-list'), s=document.getElementById('sh');
  var sr=s.getBoundingClientRect();
  return JSON.stringify({listH:Math.round(l.getBoundingClientRect().height), scrollH:l.scrollHeight,
    top:Math.round(sr.top), bottom:Math.round(sr.bottom), vh:innerHeight});})()`));
ok('整份货单上下都没掉出画面（' + (await ev('FG.SHOP.xushi.length')) + ' 格）',
  shBox.top >= 0 && shBox.bottom <= shBox.vh, JSON.stringify(shBox));
ok('放不下时是自己滚动，不是砍掉几格', shBox.scrollH >= shBox.listH,
  '可视 ' + shBox.listH + ' / 内容 ' + shBox.scrollH);

console.log('— 买下鸡舍 —');
const selA = await ev(`FG.state.sel`);
const goldA = await ev(`FG.state.gold`);
const coopPrice = B.coop.lv[0].price;
await ev(`document.querySelector('[data-k="b1"]').click()`);
await sleep(400);
ok('鸡舍到手', (await ev(`FG.state.build.coop`)) === 1, await ev(`JSON.stringify(FG.state.build)`));
ok('扣的正好是标价', (await ev(`FG.state.gold`)) === goldA - coopPrice,
  goldA + ' -> ' + await ev(`FG.state.gold`) + '（标价 ' + coopPrice + '）');
ok('手上的器物没被改坏', (await ev(`FG.state.sel`)) === selA,
  selA + ' -> ' + await ev(`FG.state.sel`));
ok('器物架上也没有多出一格',
  (await ev(`document.querySelectorAll('#tray .slot').length`)) === (await ev(`FG.TOOLS.length`)),
  await ev(`document.querySelectorAll('#tray .slot').length`) + ' 格');
ok('今天不当场下蛋', (await ev(`FG.keepState('coop').got`)) === 0, await ev(`FG.keepState('coop').got`));
ok('买完一级：这一格写「已经造好了」，它自己的二级解锁写价钱，别人家的二级还锁着',
  (await ev(`(function(){
    var o=[];
    [['coop',1],['coop',2],['ditch',1],['ditch',2],['barn',1],['sheep',1]].forEach(function(p){
      var r=FG.SHOP.xushi.filter(function(x){return x.kind==='build'&&x.b===p[0]&&x.lv===p[1]})[0];
      var e=document.querySelector('[data-k="'+r.k+'"]');
      o.push(p[0]+p[1]+'='+(e?e.querySelector('u').textContent:'?'));});
    return o.join('　');})()`)) === 'coop1=已经造好了　coop2=' + B.coop.lv[1].price + ' 钱　ditch1=' + B.ditch.lv[0].price + ' 钱　ditch2=得先有前一个　barn1=' + B.barn.lv[0].price + ' 钱　sheep1=' + B.sheep.lv[0].price + ' 钱',
  await ev(`(function(){
    var o=[];
    [['coop',1],['coop',2],['ditch',1],['ditch',2],['barn',1],['sheep',1]].forEach(function(p){
      var r=FG.SHOP.xushi.filter(function(x){return x.kind==='build'&&x.b===p[0]&&x.lv===p[1]})[0];
      var e=document.querySelector('[data-k="'+r.k+'"]');
      o.push(p[0]+p[1]+'='+(e?e.querySelector('u').textContent:'?'));});
    return o.join('　');})()`));
// 买完货单**还开着**（buy() 末尾会重画一次）。开着的时候 E 被面板吃掉 ——
// 不关掉就走过去按 E，捡蛋那一步会静悄悄地什么都没发生，
// 而看着像「鸡舍不灵」
ok('买完货单还开着', await shopOpen());
ok('开着的时候 E 被面板吃掉（不是鸡舍不灵）', (await ev(`(function(){
  var e=document.getElementById('sh'); return e && getComputedStyle(e).pointerEvents !== 'none';})()`)) === true);
await key('Escape');
await sleep(400);
ok('Esc 关掉了货单', (await shopOpen()) === false);

console.log('— 门关着就不下蛋 —');
await ev(`(function(){ FG.gotoMap('nanshan', [900,800]); return 1 })()`);
await sleep(300);
await ev(`FG.nextDay()`);
await sleep(500);
ok('门关着的时候草窝是空的', (await ev(`FG.keepState('coop').got`)) === 0, await ev(`FG.keepState('coop').got`));
ok('还没捡，蛋不在手上', (await ev(`FG.state.made.dan || 0`)) === 0);

console.log('— 开门 + 撒粮 —');
// 撒粮要吃收成 —— 行囊里得有谷。新局只有种子没谷，
// 不先给几束谷的话按 E 只开门不开粮，而那看着像「撒粮这一下没实现」
await ev(`(function(){ FG.state.bag.dou=6; FG.state.bag.su=6; FG.updateHUD(); return 1})()`);
await standAt('coop');
ok('门关着时提示说的是「E 开门」', (await hint()).indexOf('开门') >= 0, await hint());
await clearToast();
await key('e');
await sleep(400);
ok('按 E 把门开了', (await ev(`FG.keepState('coop').gate`)) === 1);
ok('顺手撒了粮（够三天）', (await ev(`FG.keepState('coop').feed`)) === 3, 'feed=' + await ev(`FG.keepState('coop').feed`));
// 判「撒粮扣了」要看**比撒之前少了**，不要死写「剩几束」——
// 撒之前给了多少是测试自己定的，写死一个数等于把「给了多少」和
// 「该扣多少」在测试里又对了一遍
ok('撒粮真的扣了一把谷', (await ev(`(function(){
  var s=0,k; for(k in FG.state.bag) s+=FG.state.bag[k];
  return s; })()`)) < 12,
  '谷从 12 束变成 ' + await ev(`(function(){var s=0,k;for(k in FG.state.bag)s+=FG.state.bag[k];return s})()`) + ' 束');

await ev(`FG.nextDay()`);
await sleep(500);
ok('第二天早上门开着有粮，就有一枚', (await ev(`FG.keepState('coop').got`)) === 1, await ev(`FG.keepState('coop').got`));
ok('还没捡，蛋不在手上', (await ev(`FG.state.made.dan || 0`)) === 0);
await ev(`FG.nextDay()`);
await sleep(500);
ok('不捡不会清零，一天一天攒', (await ev(`FG.keepState('coop').got`)) === 2, await ev(`FG.keepState('coop').got`));

console.log('— 走过去按 E 捡 —');
await standAt('coop');
ok('提示行说草窝里有几枚', (await hint()).indexOf('2 枚') >= 0, await hint());
await shot('30-鸡舍.png');
await clearToast();
await key('e');
await sleep(400);
ok('蛋进了手', (await ev(`FG.state.made.dan`)) === 2, 'dan=' + await ev(`FG.state.made.dan`));
ok('草窝清空了', (await ev(`FG.keepState('coop').got`)) === 0);
ok('并且说的是「摸出几枚」而不是别的', (await toast()).indexOf('2 枚蛋') >= 0, await toast());
await clearToast();
await key('e');
await sleep(400);
ok('再按一次不多给', (await ev(`FG.state.made.dan`)) === 2, 'dan=' + await ev(`FG.state.made.dan`));
ok('并且说清了明早再来', (await toast()).indexOf('明早') >= 0, await toast());

console.log('— 水渠：每天早上替你浇那几行 —');
// 先把地翻出来。只翻最远的两行（渠道覆盖的就是那两行）
await ev(`(function(){
  for (var r=0;r<FG.FIELD.ROWS;r++) for (var c=0;c<FG.FIELD.COLS;c++) FG.state.plots[r][c].tilled = (r<2);
  return 1})()`);
const wet0 = await ev(`(function(){var n=0;for(var r=0;r<2;r++)for(var c=0;c<FG.FIELD.COLS;c++)if(FG.state.plots[r][c].wet)n++;return n})()`);
ok('翻之前那些畦是干的', wet0 === 0, wet0 + ' 畦湿');
await ev(`(function(){ FG.state.stam = 50; FG.state.build.ditch = 1; return 1 })()`);
const stamA = await ev(`FG.state.stam`);
await ev(`FG.nextDay()`);
await sleep(500);
const wet1 = await ev(`(function(){var n=0;for(var r=0;r<2;r++)for(var c=0;c<FG.FIELD.COLS;c++)if(FG.state.plots[r][c].wet)n++;return n})()`);
const wetFar = await ev(`(function(){var n=0;for(var r=2;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++)if(FG.state.plots[r][c].wet)n++;return n})()`);
ok('第二天早上渠道那两行湿了', wet1 === 10, wet1 + ' 畦（2 行 × ' + await ev('FG.FIELD.COLS') + ' 列）');
ok('渠道管不着的那几行还是干的', wetFar === 0, wetFar + ' 畦');
ok('而且一分体力没扣（它是自动的，不是你干的活）', (await ev(`FG.state.stam`)) === 100,
  stamA + ' -> ' + await ev(`FG.state.stam`) + '（新的一天本来就回满）');
// 没翻的地不该被浇
await ev(`(function(){ for (var r=0;r<FG.FIELD.ROWS;r++) for (var c=0;c<FG.FIELD.COLS;c++){ FG.state.plots[r][c].wet=false; FG.state.plots[r][c].tilled=false; }
  for (var r2=0;r2<FG.FIELD.ROWS;r2++) for (var c2=0;c2<FG.FIELD.COLS;c2++) FG.state.plots[r2][c2].tilled = (r2<2);
  return 1})()`);
await ev(`FG.nextDay()`);
await sleep(500);
ok('翻了的那两行湿了', (await ev(`(function(){var n=0;for(var r=0;r<2;r++)for(var c=0;c<FG.FIELD.COLS;c++)if(FG.state.plots[r][c].wet)n++;return n})()`)) === 10);
ok('没翻的那三行没被浇（湿的翻过的地才种得下）',
  (await ev(`(function(){var n=0;for(var r=2;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++)if(FG.state.plots[r][c].wet)n++;return n})()`)) === 0);
// 石砌渠：五行全管
await ev(`(function(){ FG.state.build.ditch = 2; return 1 })()`);
await ev(`(function(){ for (var r=0;r<FG.FIELD.ROWS;r++) for (var c=0;c<FG.FIELD.COLS;c++) FG.state.plots[r][c].tilled = true; return 1 })()`);
await ev(`FG.nextDay()`);
await sleep(500);
ok('石砌渠把整片田都管上了',
  (await ev(`(function(){var n=0;for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++)if(FG.state.plots[r][c].wet)n++;return n})()`)) === 25,
  '25 畦');

console.log('— 水渠没有按 E 的判定点 —');
await standAt('ditch');
ok('站在水渠那儿 E 什么也不发生', (await ev(`FG.nearBuild()`)) === null,
  'nearBuild=' + await ev(`FG.nearBuild()`));
await key('e');
await sleep(350);
ok('田里的畦一个没多', (await ev(`(function(){var n=0;for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++)if(FG.state.plots[r][c].tilled)n++;return n})()`)) === 25);
ok('体力也没白扣', (await ev(`FG.state.stam`)) === 100, 'stam=' + await ev(`FG.state.stam`));
await shot('31-水渠.png');

console.log('— 蛋能出货，也能上灶 —');
const danSell = await ev(`FG.BAG_IDX['dan'].sell`);
ok('蛋在行囊总表里、价钱不是零', danSell > 0, danSell + ' 钱');
await ev(`(function(){ for (var k in FG.state.made) FG.state.made[k]=0; FG.state.made.dan = 4; return 1 })()`);
const held = await ev(`(function(){var n=0;for(var k in FG.BAG_IDX){}
  return FG.bagList().filter(function(x){return x.k==='dan'})[0].n})()`);
ok('行囊里读得到四枚蛋', held === 4, 'dan=' + held);
await ev(`(function(){ FG.state.bin.dan = 4; FG.updateHUD(); return 1 })()`);
ok('能放进出货箱', (await ev(`FG.binWorth()`)) === 4 * danSell,
  '箱 ' + await ev(`FG.binWorth()`) + ' / 应为 ' + 4 * danSell);
// 蛋羹：养鸡跟灶接上的一条线
ok('蛋羹是灶上的一条配方', (await ev(`FG.RECIPES.some(function(r){return r.out==='dangeng'})`)) === true);
ok('蛋羹在总表里排得出来', (await ev(`!!FG.BAG_IDX['dangeng']`)) === true);
await ev(`(function(){ FG.state.cookDay = 0; FG.state.bag.su = 3; FG.state.made.dan = 1; return 1 })()`);
ok('料够的时候它在「今天做得出什么」里',
  (await ev(`JSON.stringify(FG.cookable().map(function(r){return r.out}))`)).indexOf('dangeng') >= 0,
  await ev(`JSON.stringify(FG.cookable().map(function(r){return r.out}))`));
await ev(`(function(){ FG.state.made.dan = 0; return 1 })()`);
ok('蛋不够就不在',
  (await ev(`JSON.stringify(FG.cookable().map(function(r){return r.out}))`)).indexOf('dangeng') < 0);

console.log('— 画面：1× 下认不认得出来 —');
// 三个状态各截一张。放大预览页能看出细节好不好看，量不出「看不看得见」——
// 而看不见才是玩家收不到的那一半
// 截图前先把鼠标挪到画布外：悬停高亮是一整片色块，压在鸡舍上的时候
// 分不清是棚子淡还是高亮亮，而「画面上有东西」这个判断就废了
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 });
await sleep(200);
await ev(`(function(){ FG.state.build.coop=0; FG.state.build.ditch=0; return 1 })()`);
await standAt('coop');
await sleep(300);
await shot('30-鸡舍0.png');
await ev(`(function(){ FG.state.build.coop=1; return 1 })()`);
await sleep(300);
await shot('30-鸡舍1.png');
await ev(`(function(){ FG.state.build.coop=2; return 1 })()`);
await sleep(300);
await shot('30-鸡舍2.png');
await standAt('ditch');
await ev(`(function(){ FG.state.build.ditch=0; return 1 })()`);
await sleep(300);
await shot('31-水渠0.png');
await ev(`(function(){ FG.state.build.ditch=1; return 1 })()`);
await sleep(300);
await shot('31-水渠1.png');
await ev(`(function(){ FG.state.build.ditch=2; return 1 })()`);
await sleep(300);
await shot('31-水渠2.png');
ok('六个状态都截了', true);

console.log('— 存档往返 —');
await ev(`(function(){ FG.state.build.coop=1; FG.state.build.ditch=2; FG.keepState('coop').got=3; FG.state.made.dan=5; FG.saveGame(); return 1 })()`);
await sleep(300);
const sa = await ev(`JSON.stringify({b:FG.state.build,e:FG.keepState('coop').got,d:FG.state.made.dan})`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
const sb = await ev(`JSON.stringify({b:FG.state.build,e:FG.keepState('coop').got,d:FG.state.made.dan})`);
ok('造到几级原样还在', sa === sb, sa + ' / ' + sb);

console.log('— 老存档没有营造这一本账 —');
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
  delete raw.build; delete raw.keep;
  localStorage.setItem(${JSON.stringify(SAVEKEY)}, JSON.stringify(raw)); return 1})()`);
const logMark = logs.length;
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
ok('老档读出来样样都归零，不是 null',
  (await ev(`(function(){for(var i=0;i<FG.BUILD_LV.length;i++) if(FG.state.build[FG.BUILD_LV[i]]!==0) return 0; return 1})()`)) === 1,
  await ev(`JSON.stringify(FG.state.build)`));
// keepState 内部会补，所以问它 typeof 永远是 number —— 那等于没验。
// 要验的是「补出来的是不是三样都在」，直接读存档上那本账
ok('草窝这本账也补上了（三样都在、都是零）',
  (await ev(`(function(){
    var o=FG.state.keep;
    if (!o || typeof o!=='object') return '不是对象';
    for (var i=0;i<FG.KEEP_LV.length;i++){ var q=o[FG.KEEP_LV[i]];
      if (!q || q.gate!==0 || q.feed!==0 || q.got!==0) return FG.KEEP_LV[i]+'='+JSON.stringify(q); }
    return 'ok';})()`)) === 'ok',
  await ev(`JSON.stringify(FG.state.keep)`));
ok('老档读出来不报新异常', logs.length === logMark, logs.slice(logMark).join(' | ') || '干净');
// 越界的等级也不能照单全收
await ev(`(function(){ FG.state.build.coop = 7; FG.nextDay(); return 1 })()`);
await sleep(400);
ok('存档被改成越界等级时按「没有」算',
  (await ev(`FG.keepState('coop').got`)) === 0,
  'got=' + await ev(`FG.keepState('coop').got`) + '（level=7 是越界的）');

console.log('— 重开归零 —');
await ev(`FG.restart()`);
await sleep(900);
ok('重开后样样都没造', (await ev(`(function(){for(var i=0;i<FG.BUILD_LV.length;i++) if(FG.state.build[FG.BUILD_LV[i]]!==0) return 0; return 1})()`)) === 1,
  await ev(`JSON.stringify(FG.state.build)`));
ok('草窝也空了', (await ev(`JSON.stringify(FG.state.keep)`)) ===
  (await ev(`(function(){var o={};for(var i=0;i<FG.KEEP_LV.length;i++)o[FG.KEEP_LV[i]]={gate:0,feed:0,got:0};return JSON.stringify(o)})()`)),
  await ev(`JSON.stringify(FG.state.keep)`));
ok('蛋也没了', (await ev(`JSON.stringify(FG.state.made)`)) === '{}', await ev(`JSON.stringify(FG.state.made)`));

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
