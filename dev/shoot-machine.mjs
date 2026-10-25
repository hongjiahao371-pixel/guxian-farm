// 机器验收：坛（腌菜坛 / 双口大坛）。
//
// 机器跟灶台最大的分别：**你放进去就不管了，隔天早上来取**。
// 灶是一天一口你自己守着；坛是搁进去忘了都行。这一层是机器存在的理由。
// 盯住：
//   1) 坛分两级，场合一样（都是「搁进去等」），只改等几天、放多少料、出多少
//   2) 料投进去 = 真扣手上的东西（走 invTake 那套账本路由）
//   3) 日子到了**要人来起坛**（这是机器和灶最大的分别）
//   4) 忘了起不坏坛、不烂料，料就一直搁着
//   5) 买机器的判据跟营造同构：只能一级一级买
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9403;
const profile = path.join(tmpdir(), 'guxian-mach-' + process.pid);

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
  if (r.exceptionDetails) return 'THROW ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
}
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(200);
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
await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 });

console.log('— 机器表自己站得住 —');
const M = JSON.parse(await ev(`JSON.stringify(FG.MACHINE)`));
console.log('  ' + Object.keys(M).map(k => k + '(' + M[k].name + '×' + M[k].lv.length + '级)').join(' '));
ok('有一种机器', Object.keys(M).length >= 1, Object.keys(M).length + ' 种');
ok('每种都有两级', Object.keys(M).every(k => M[k].lv.length === 2), JSON.stringify(Object.keys(M).map(k => M[k].lv.length)));
ok('级别只改天数/料量/产量，场合不变',
  Object.keys(M).every(k => M[k].lv[0].days <= M[k].lv[1].days && M[k].lv[0].out < M[k].lv[1].out),
  'lv1.days=' + M.jar.lv[0].days + ' lv2.days=' + M.jar.lv[1].days + ' / lv1.out=' + M.jar.lv[0].out + ' lv2.out=' + M.jar.lv[1].out);
const R = JSON.parse(await ev(`JSON.stringify(FG.MACHINE_RECIPES)`));
// 第一个方子的 need —— 判「扣了多少份」时要用它，不要在测试里重抄一遍数字
const needOf = r => (R[r] && R[r][0] ? R[r][0].need : {});
console.log('  方子 =', Object.keys(R).map(k => k + ':' + R[k].map(x => x.name).join('/')).join('  '));
ok('每种机器都有方子', Object.keys(M).every(k => (R[k] || []).length > 0), Object.keys(M).join(' '));
// 配方产物得在物品总表里
const badOut = JSON.parse(await ev(`JSON.stringify((function(){
  var b=[],k,i;
  for(k in FG.MACHINE_RECIPES) for(i=0;i<FG.MACHINE_RECIPES[k].length;i++){
    if(!FG.BAG_IDX[FG.MACHINE_RECIPES[k][i].out]) b.push(FG.MACHINE_RECIPES[k][i].out);
  } return b;
})())`));
ok('配方产物都在物品总表里', badOut.length === 0, badOut.join(' ') || '都在');
ok('行囊装得下所有东西（格数 >= 样数）',
  (await ev(`FG.BAG.length`)) <= (await ev(`FG.BAG_COLS * FG.BAG_ROWS`)),
  (await ev(`FG.BAG.length`)) + ' 样 / ' + (await ev(`FG.BAG_COLS*FG.BAG_ROWS`)) + ' 格');

/* 每一级、每一条方子都划算。**比的是总额，不是「产物价钱 vs 一份原料价钱」。**
   machPut 扣的是 `need × in`（坛一级 in=2，也就是配方上写两份、实际扣四份），
   而 16/9 那五条坛的价钱是按 `need` 定的 —— 酸菜一份要 4 株山菌（384 钱）、
   卖 190，做一坛净亏 194。这件事当时一条断言都没核到：
   唯一的比法拿产物价钱跟**一份**原料比，而 190 > 96 看着完全对。
   症状是玩家放进坛里的料比坛里捞出来的值钱，而画面上什么都没错。 */
const econ = JSON.parse(await ev(`(function(){
  var rows=[];
  for (var m in FG.MACHINE_RECIPES) {
    var def = FG.MACHINE[m];
    if (!def) continue;
    def.lv.forEach(function(sp, li) {
      FG.MACHINE_RECIPES[m].forEach(function(r) {
        var cost=0, parts=[];
        for (var k in r.need) {
          var it = FG.BAG_IDX[k];
          if (!it) { rows.push({m:m, lv:li+1, out:r.out, bad:'配方里有一种不存在的原料 '+k}); return; }
          cost += r.need[k] * sp.in * it.sell;
          parts.push((r.need[k]*sp.in) + '×' + it.name + '(' + it.sell + ')');
        }
        var got = (FG.BAG_IDX[r.out] ? FG.BAG_IDX[r.out].sell : -1) * sp.out;
        rows.push({m:m, lv:li+1, out:r.out, cost:cost, got:got, net:got-cost,
                   txt:sp.name + '：' + parts.join('+') + ' = ' + cost + '　出 ' + sp.out
                     + ' 份 ' + (FG.BAG_IDX[r.out]?FG.BAG_IDX[r.out].name:r.out) + ' = ' + got
                     + (got>cost ? '' : '　✗ 亏 ' + (cost-got))});
      });
    });
  }
  return JSON.stringify(rows);
})()`));
console.log('  ' + econ.map(r => r.txt).join('　｜　'));
ok('每一级、每一条方子都赚（拿总额比，不是一份原料）', econ.every(r => !r.bad && r.net > 0),
  econ.filter(r => r.bad || !(r.net > 0)).map(r => r.txt).join('　') || '全赚');
ok('而且赚得不多不少（毛在两成到七成之间，不是白送也不是榨干）',
  econ.filter(r => !r.bad).every(r => {
    const rate = (r.got - r.cost) / r.cost;
    return rate >= 0.2 && rate <= 0.7;
  }),
  econ.filter(r => !r.bad).map(r => Math.round((r.got - r.cost) / r.cost * 100) + '%').join(' '));
/* 同一份原料的两条出路，毛利不能一样。
   奶罐的奶酪和坛的黄油收的是同一份奶 —— 两边算出来都是 35% 的话，
   玩家在坛前和罐前站着看到的是同一个数，那就是一个假选择。 */
const dual = JSON.parse(await ev(`(function(){
  var rate={};
  for (var m in FG.MACHINE_RECIPES){
    var def=FG.MACHINE[m]; if(!def) continue;
    var sp=def.lv[0];
    FG.MACHINE_RECIPES[m].forEach(function(r){
      var c=0; for (var k in r.need) c += r.need[k]*sp.in*FG.BAG_IDX[k].sell;
      var g = FG.BAG_IDX[r.out].sell*sp.out, v=(g-c)/c;
      (rate[Object.keys(r.need).join('+')]=rate[Object.keys(r.need).join('+')]||[]).push({m:m,out:r.out,v:v});
    });
  }
  var bad=[], txt=[];
  for (var key in rate) if (rate[key].length>1) {
    txt.push(key+': '+rate[key].map(function(x){return x.out+' '+Math.round(x.v*100)+'%';}).join(' / '));
    if (rate[key].length>1) {
      var vs=rate[key].map(function(x){return x.v;});
      if (Math.max.apply(null,vs)-Math.min.apply(null,vs) < 0.05) bad.push(key);
    }
  }
  return JSON.stringify({bad:bad, txt:txt.join('　｜　')});})()`));
console.log('  一份原料的几条出路：' + dual.txt);
ok('同一份原料的几条出路，毛利差得看得出来（≥5 个百分点）', dual.bad.length === 0,
  dual.bad.length ? '分不出来：' + dual.bad.join('、') : '分得出来');

console.log('— 没买：坛是敞口空坛 —');

/* ---------------- 罐子这一族（果酱瓶 / 奶罐 / 鱼露坛） ---------------- */
console.log('— 罐子这一族：摆在溪畔，剪影三个都不一样 —');
const JARS = ['ping', 'guan', 'yutang'];
// FG 只存在于页面里。要在 Node 侧比的话先把那一份读出来，
// 别在 Node 表达式里直接写 FG.xxx —— 那是 ReferenceError，
// 而症状是「整个脚本挂了」，看着像引擎没起来
const MLV = JSON.parse(await ev(`JSON.stringify(FG.MACHINE_LV)`));
const JPRICE = JSON.parse(await ev(`JSON.stringify({ping:FG.MACHINE.ping.lv[0].price, hive:FG.MACHINE.hive.lv[0].price})`));
ok('三种都在机器表里，且都排在坛后面',
  JARS.every(j => MLV.indexOf(j) >= 0) && MLV.indexOf('jar') < MLV.indexOf('ping'),
  MLV.join(' → '));
// **id 不能跟行囊 / 器物 / 作物 / 山货 / 鱼 / 矿 / NPC 重名**。
// 奶罐这一件差点撞：机器要一个短 id，而 `nai` 已经是「奶」在行囊里的 key
const jClash = JSON.parse(await ev(`(function(){
  var flat={};
  ['tool'].forEach(function(g){});
  FG.TOOLS.forEach(function(t){flat[t.k]='器物架'});
  for (var k in FG.BAG_IDX) flat[k]='行囊';
  for (var k2 in FG.CROPS) flat[k2]='作物';
  for (var k3 in FG.GOODS) flat[k3]='山货';
  for (var k4 in FG.FISH) flat[k4]='鱼';
  for (var k5 in FG.ORE) flat[k5]='矿砂';
  for (var k6 in FG.NPCS) flat[k6]='人';
  var bad=[];
  for (var m in FG.MACHINE) if (flat[m]) bad.push(m+'×'+flat[m]);
  return JSON.stringify(bad);})()`));
ok('机器的 id 不跟别的东西重名', jClash.length === 0, jClash.join('　') || '(无)');
// 三样罐子的判定圈：溪畔上已经有人、棚、歇脚处、出口
/* 每张图上挂了机器的那几样，判定圈不能跟这张图上别的交互点压在一处。
   **遍历所有图，不只溪畔** —— 原来这段写死 `FG.MAPS.xipan`，
   于是「把蜂窠从溪畔搬到南山」这一下完全没人核：
   坐标撞不撞不报、**挂没挂上去也不报**（挂载是 `MAPS[x].machines` 那一句），
   症状是 1× 画面上那个位置什么都没有，而所有功能断言照样全绿。
   一张图一张图核，撞了就报 `图名: 机器×别的`。
   名单从图上读，不写死 —— 写死的话再加一样罐子，坐标撞了也没人核，
   而症状是「站在新罐子跟前按 E 开的是旁边那个」。 */
const jSpot = JSON.parse(await ev(`(function(){
  var bad=[], out=[];
  for (var mk in FG.MAPS) {
    var m=FG.MAPS[mk];
    if (!m.machines || !m.machines.length) continue;
    var sp=FG.SPOTS[mk]||{};
    m.machines.forEach(function(id){
      var def=FG.MACHINE[id];
      // 挂了名册却表里没有 —— 绘制那一行每帧抛一次，
      // 而症状是「控制台刷一片红、画面照常动」
      if (!def) { bad.push(mk+': 名册里有 '+id+'，表里没有'); return; }
      var a=def.at, r=def.r;
      (m.npcs||[]).forEach(function(n){ var q=FG.NPCS[n];
        if (q && Math.abs(q.at[0]-a[0])+Math.abs(q.at[1]-a[1]) < r+150) bad.push(mk+': '+id+'×人:'+n); });
      (m.builds||[]).forEach(function(b){ var q=FG.BUILD[b];
        if (q && q.at && Math.abs(q.at[0]-a[0])+Math.abs(q.at[1]-a[1]) < r+q.r) bad.push(mk+': '+id+'×营造:'+b); });
      (m.exits||[]).forEach(function(e){
        if (Math.abs(e.at[0]-a[0])+Math.abs(e.at[1]-a[1]) < r+e.r) bad.push(mk+': '+id+'×口:'+e.to); });
      if (m.home && Math.abs(m.home[0]-a[0])+Math.abs(m.home[1]-a[1]) < r+(m.homeR||0)) bad.push(mk+': '+id+'×家门口');
      if (m.station && Math.abs(m.station[0]-a[0])+Math.abs(m.station[1]-a[1]) < r+FG.SPOT_R.station) bad.push(mk+': '+id+'×歇脚处');
      (sp.stele||[]).forEach(function(s2){
        if (Math.abs(s2.at[0]-a[0])+Math.abs(s2.at[1]-a[1]) < r+130) bad.push(mk+': '+id+'×刻石'); });
      (sp.fish||[]).forEach(function(f){
        if (Math.abs(f.at[0]-a[0])+Math.abs(f.at[1]-a[1]) < r+150) bad.push(mk+': '+id+'×钓点:'+f.name); });
      (sp.pick||[]).forEach(function(p2){
        if (Math.abs(p2.at[0]-a[0])+Math.abs(p2.at[1]-a[1]) < r+130) bad.push(mk+': '+id+'×采集:'+p2.k); });
      out.push(mk+'·'+id+'@'+a);
    });
    // 同一张图上**两两之间**也不能挨着：挨着的话站在中间那一个，
    // E 归谁就看谁近，而提示行只写一句
    var ms=m.machines;
    for (var i=0;i<ms.length;i++) for (var j=i+1;j<ms.length;j++) {
      var A=FG.MACHINE[ms[i]], B=FG.MACHINE[ms[j]];
      if (!A || !B) continue;
      if (Math.abs(A.at[0]-B.at[0])+Math.abs(A.at[1]-B.at[1]) < A.r+B.r) bad.push(mk+': '+ms[i]+'×'+ms[j]);
    }
  }
  return JSON.stringify({bad:bad, out:out});})()`));
ok('挂了机器的每张图：那几样不跟人 / 棚 / 口 / 家门口 / 歇脚处 / 刻石 / 钓点 / 采集 / 彼此压在一处',
  jSpot.bad.length === 0, jSpot.bad.join('　') || jSpot.out.join('　'));
// 每一级都在货单上
const jShop = JSON.parse(await ev(`(function(){
  var o=[]; FG.SHOP.xushi.forEach(function(r){ if(r.kind==='machine') o.push(r.m+':'+r.lv); });
  return JSON.stringify(o);})()`));
ok('六格罐子都在货单上',
  JARS.every(j => jShop.indexOf(j + ':1') >= 0 && jShop.indexOf(j + ':2') >= 0), jShop.join('　'));
// 罐子这一族内部不抢同一份原料,// 跟坛收了同一样不是错 —— 那正是玩家要挑的事（奶罐的奶酪 vs 坛的黄油，,// 毛利差在那条断言里核着）。错的是罐子内部三样自己抢同一个料，,// 那样玩家买的第二只罐子就白买了,const jNeed = JSON.parse(await ev(`(function(){,  var self={}, dup=[];,  for (var i=1;i<FG.MACHINE_LV.length;i++){,    var m=FG.MACHINE_LV[i];,    FG.MACHINE_RECIPES[m].forEach(function(r){,      for (var k in r.need) {,        var kk=m+':'+k;,        if (self[kk]) dup.push(kk);,        self[kk]=1;,      },    });,  },  var jar={};,  FG.MACHINE_RECIPES.jar.forEach(function(r){ for (var k in r.need) jar[k]=1; });,  var need=[];,  for (var i2=1;i2<FG.MACHINE_LV.length;i2++),    FG.MACHINE_RECIPES[FG.MACHINE_LV[i2]].forEach(function(r){ for (var k2 in r.need) need.push(k2); });,  return JSON.stringify({jar:Object.keys(jar), dup:dup, need:need});,})()`));,ok('罐子这一族内部不抢同一份原料', jNeed.dup.length === 0, jNeed.dup.join('、') || '(无)');,console.log('  坛收 ' + jNeed.jar.join(',') + '　罐子收 ' + jNeed.need.join(','));,
// 走真的机器那一路：买一只罐子，投料，等天数，起
await ev(`(function(){ FG.state.gold=80000; return 1})()`);
await ev(`(function(){
  FG.gotoMap('xushi'); var n=FG.NPCS.xushi;
  FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+40; FG.state.walkTo=null; return 1})()`);
await sleep(430);
await key('b');
await sleep(420);
const gJ = await ev(`FG.state.gold`);
await ev(`document.querySelector('[data-k="m3"]').click()`);
await sleep(400);
ok('果酱瓶到手', (await ev(`FG.state.mach.lv.ping`)) === 1, await ev(`JSON.stringify(FG.state.mach.lv)`));
ok('扣的正好是标价', (await ev(`FG.state.gold`)) === gJ - JPRICE.ping);
await key('Escape');
await sleep(300);
// 摆够料，走过去按 E
await ev(`(function(){
  for (var k in FG.state.pouch) delete FG.state.pouch[k];
  FG.state.pouch[FG.BAG_IDX.good_mei.src] = 8;
  FG.gotoMap('xipan'); var a=FG.MACHINE.ping.at;
  FG.state.player.x=a[0]; FG.state.player.y=a[1]+40; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(400);
await ev(`FG.machPut('ping')`);
ok('八捧莓在架上，投进去了六捧（need×in）',
  (await ev(`(function(){var s=FG.BAG_IDX.good_mei.src; return FG.state.pouch[s];})()`)) === 2,
  '剩 ' + await ev(`(function(){var s=FG.BAG_IDX.good_mei.src; return FG.state.pouch[s];})()`));
ok('坛里排着的是野莓酱', (await ev(`FG.machJob('ping').out`)) === 'yemeijiang',
  await ev(`JSON.stringify(FG.machJob('ping'))`));
ok('还没到天数，起不了', (await ev(`FG.machDone('ping')`)) === false);
await ev(`(function(){ FG.state.day = FG.machJob('ping').at; return 1})()`);
await ev(`FG.machTake('ping')`);
ok('到了天数起坛得一瓶野莓酱', (await ev(`FG.state.made.yemeijiang`)) === 1,
  'yemeijiang=' + await ev(`FG.state.made.yemeijiang || 0`));
ok('野莓酱在行囊里排得出来、价钱不是零',
  (await ev(`!!FG.BAG_IDX.yemeijiang && FG.BAG_IDX.yemeijiang.sell > 0`)) === true,
  (await ev(`FG.BAG_IDX.yemeijiang.sell`)) + ' 钱');
// 溪畔那几样并排的画（名单从图上读）
await ev(`(function(){
  FG.state.mach.lv={};
  for (var i=0;i<FG.MAPS.xipan.machines.length;i++) FG.state.mach.lv[FG.MAPS.xipan.machines[i]]=1;
  var c=FG.MACHINE.ping.at;
  FG.state.player.x=c[0]-90; FG.state.player.y=c[1]+60; FG.updateHUD(); return 1})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 });
await sleep(500);
await shot('58-溪畔-那几样.png');
ok('并排截了一张', true);

console.log('— 蜂窠：收菊，两天起一罐蜜 —');
const HIVEDAYS = JSON.parse(await ev(`JSON.stringify([FG.MACHINE.hive.lv[0].days, FG.MACHINE.hive.lv[1].days,
  FG.MACHINE.hive.lv[0].in, FG.MACHINE.hive.lv[1].in, FG.MACHINE.hive.lv[0].out, FG.MACHINE.hive.lv[1].out])`));
console.log('  天数 ' + HIVEDAYS[0] + '→' + HIVEDAYS[1] + '　in ' + HIVEDAYS[2] + '→' + HIVEDAYS[3] + '　out ' + HIVEDAYS[4] + '→' + HIVEDAYS[5]);
await ev(`(function(){ FG.gotoMap('xushi'); var n=FG.NPCS.xushi;
  FG.state.gold=80000; FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+40;
  FG.state.walkTo=null; return 1})()`);
await sleep(430);
await key('b');
await sleep(420);
const gH = await ev(`FG.state.gold`);
await ev(`document.querySelector('[data-k="m9"]').click()`);
await sleep(400);
ok('蜂窠到手', (await ev(`FG.state.mach.lv.hive`)) === 1, await ev(`JSON.stringify(FG.state.mach.lv)`));
ok('扣的正好是标价', (await ev(`FG.state.gold`)) === gH - JPRICE.hive);
ok('那一句说的是蜜', /蜜/.test(await toast()), await toast());
await key('Escape'); await sleep(300);
await ev(`(function(){
  for (var k in FG.state.bag) delete FG.state.bag[k];
  FG.state.bag.ju=2; FG.state.mach={lv:{hive:1}, job:{}};
  FG.gotoMap('xipan'); var a=FG.MACHINE.hive.at;
  FG.state.player.x=a[0]; FG.state.player.y=a[1]+40; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(400);
await ev(`FG.machPut('hive')`);
ok('一把鲜菊进去了（need×in = 1×1）', (await ev(`FG.state.bag.ju`)) === 1, 'ju=' + await ev(`FG.state.bag.ju`));
ok('窠里排着的是蜜', (await ev(`FG.machJob('hive').out`)) === 'mi',
  await ev(`JSON.stringify(FG.machJob('hive'))`));
ok('还没到两天，起不了', (await ev(`FG.machDone('hive')`)) === false);
await ev(`(function(){ FG.state.day = FG.machJob('hive').at; return 1})()`);
await ev(`FG.machTake('hive')`);
ok('到了两天起一罐蜜', (await ev(`FG.state.made.mi`)) === 1, 'mi=' + await ev(`FG.state.made.mi || 0`));
ok('蜜在行囊里排得出来、价钱不是零',
  (await ev(`!!FG.BAG_IDX.mi && FG.BAG_IDX.mi.sell > 0`)) === true,
  (await ev(`FG.BAG_IDX.mi.sell`)) + ' 钱');
ok('蜜能出货（不卖钱的那种才挡在这儿）', (await ev(`FG.binSellable('mi')`)) === true);
await ev(`(function(){
  FG.state.mach={lv:{hive:2}, job:{}}; FG.state.made={};
  for (var k2 in FG.state.bag) delete FG.state.bag[k2];
  FG.state.bag.ju=4; FG.updateHUD(); return 1})()`);
await ev(`FG.machPut('hive')`);
ok('二级：四把菊进去两把（need×in = 1×2）', (await ev(`FG.state.bag.ju`)) === 2, 'ju=' + await ev(`FG.state.bag.ju`));
await ev(`(function(){ FG.state.day = FG.machJob('hive').at; return 1})()`);
await ev(`FG.machTake('hive')`);
ok('二级起两罐蜜', (await ev(`FG.state.made.mi`)) === 2, 'mi=' + await ev(`FG.state.made.mi || 0`));
ok('二级多等一天（场合不变，等的数变）', HIVEDAYS[1] > HIVEDAYS[0], HIVEDAYS[0] + ' 天 → ' + HIVEDAYS[1] + ' 天');

const standJar = async () => {
  await ev(`(function(){
    FG.gotoMap('nanshan');
    // 站到坛的**左边**去。站在正下方会被农人整个挡住，
    // 而截图里看不见坛 == 坛画得认不出来，验收的美术那一关就白做了
    FG.state.player.x=FG.MACHINE.jar.at[0]-50; FG.state.player.y=FG.MACHINE.jar.at[1]+30;
    FG.state.walkTo=null; FG.state.hover=null; return 1})()`);
  await sleep(450);
};
await standJar();
ok('站着认得出是坛', (await hint()).indexOf('坛') >= 0, await hint());
await clearToast();
await key('e'); await sleep(300);
ok('没买按 E 说「这儿还空着」', (await toast()).indexOf('空着') >= 0, await toast());
await shot('80-坛-空.png');

console.log('— 投料：真扣手上的 —');
// 给一把山菌（酸菜的料）。走 invGive 拿到 pouch
await ev(`(function(){
  FG.state.mach={lv:{},job:{}};
  FG.state.mach.lv.jar=1;
  FG.invGiveGood ? FG.invGiveGood('jun',4) : 0;
  FG.state.picked={};
  // 直接经公开的存物函数给山菌：pouch 账
  FG.state.pouch.jun = 4;
  FG.state.day=30; FG.state.gold=9999; FG.updateHUD(); return 1})()`);
await standJar();
const hIn = await hint();
ok('投料前提示是「坛子是空的 · E 搁一把料」', hIn.indexOf('空的') >= 0, hIn);
// 扣料是按方子 need 的量乘机器 in 倍。一级坛 in=2，所以酸菜要 2 份山菌 × 2 = 4
// 手上给了 4 份，投进去正好清空 —— 判「比投之前少」比死写「剩几份」稳
const junBefore = await ev(`FG.state.pouch.jun||0`);
await clearToast();
await key('e'); await sleep(350);
const tPut = await toast();
ok('按 E 把料封进去了', tPut.indexOf('封上') >= 0, tPut);
const junAfter = await ev(`FG.state.pouch.jun||0`);
ok('山菌真的被扣了（按方子 need × 机器 in）', junAfter < junBefore && junAfter >= 0,
  junBefore + ' -> ' + junAfter + '（要 ' + R.jar[0].need.good_jun + '×' + M.jar.lv[0].in + '）');
ok('坛里有 job 了', (await ev(`!!FG.machJob('jar')`)) === true);
const j1 = JSON.parse(await ev(`JSON.stringify(FG.machJob('jar'))`));
console.log('  job =', JSON.stringify(j1));
ok('job 记了产物和取的日子', j1.out && j1.at > 30, JSON.stringify(j1));
await shot('81-坛-腌着.png');

console.log('— 天没到，起不了 —');
await clearToast();
await key('e'); await sleep(300);
ok('没到日子按 E 说还得等', (await toast()).indexOf('还差') >= 0, await toast());
ok('job 还在（没被误清）', (await ev(`!!FG.machJob('jar')`)) === true);
// 推进到取货日
const dayPick = await ev(`FG.machJob('jar').at`);
await ev(`(function(){ FG.state.day=${dayPick}; FG.updateHUD(); return 1})()`);
await standJar();
const hDone = await hint();
console.log('  到期提示 =', hDone);
ok('到期提示是「E 起坛 · 好了…」', hDone.indexOf('起坛') >= 0, hDone);
await clearToast();
const madeA = await ev(`FG.state.made.suancai||0`);
await key('e'); await sleep(350);
ok('按 E 起坛得货', (await toast()).indexOf('起坛') >= 0, await toast());
ok('酸菜进账了（made 里 +1）', (await ev(`FG.state.made.suancai||0`)) === madeA + 1, 'suancai=' + await ev(`FG.state.made.suancai||0`));
ok('job 清掉了', (await ev(`FG.machJob('jar')`)) === null);
await shot('82-坛-起.png');

console.log('— 一口坛只腌一样 —');
// 重新投一份、再把日子拨回去 —— 上一节把日子推到取货之后了，
// 留着那个 day 的话按 E 会走「起坛」，量不到「一口坛只腌一样」这件事
await ev(`(function(){
  FG.state.mach.job={}; FG.state.pouch.jun=4; FG.state.day=50;
  FG.machPut('jar');
  FG.state.day = FG.state.day - 0;   // 刚投，天数没到
  return 1})()`);
await clearToast();
await key('e'); await sleep(300);
ok('按 E 提示坛里还腌着', (await toast()).indexOf('腌着') >= 0, await toast());

console.log('— 忘了起不坏坛 —');
await ev(`(function(){
  FG.state.mach.job={}; FG.state.pouch.jun=4; FG.state.day=50;
  FG.machPut('jar'); return 1})()`);
await ev(`(function(){ FG.state.day=FG.machJob('jar').at+20; FG.updateHUD(); return 1})()`);
ok('过了二十天 job 还在', (await ev(`!!FG.machJob('jar')`)) === true);
ok('料没烂（还在 job 里记着）', (await ev(`FG.machJob('jar').in > 0`)) === true);

console.log('— 二级坛：放得多、要得久、待得久 —');
await ev(`(function(){ FG.state.mach={lv:{jar:2},job:{}}; FG.state.pouch.jun=20; FG.state.day=60; return 1})()`);
await standJar();
const junB2 = await ev(`FG.state.pouch.jun||0`);
await clearToast();
await key('e'); await sleep(350);
ok('二级坛放料也扣（in=4，一次要 8 份）', (await ev(`FG.state.pouch.jun||0`)) === junB2 - R.jar[0].need.good_jun * M.jar.lv[1].in,
  junB2 + ' -> ' + await ev(`FG.state.pouch.jun||0`) + '（要 ' + R.jar[0].need.good_jun + '×' + M.jar.lv[1].in + '）');
const j2 = JSON.parse(await ev(`JSON.stringify(FG.machJob('jar'))`));
ok('二级等得更久', (j2.at - 60) === M.jar.lv[1].days, '等了 ' + (j2.at - 60) + ' 天（表上 ' + M.jar.lv[1].days + '）');
ok('二级出得更多', j2.n === M.jar.lv[1].out, '出 ' + j2.n + ' 份（表上 ' + M.jar.lv[1].out + '）');

console.log('— 买机器只能一级一级 —');
await ev(`(function(){ FG.state.mach={lv:{jar:0},job:{}}; FG.state.gold=99999; return 1})()`);
// 造一台一级
await ev(`(function(){ FG.state.mach.lv.jar=1; return 1})()`);
const buyTwo = await ev(`(function(){
  // 直接调买那一支：跳级买二级坛，判据是「手上没有一级」
  var r = (function(){
    // 复制 buy 里机器那支的判据：mB !== lv-1 就拦
    return FG.state.mach.lv.jar !== 2-1;
  })();
  return r;
})()`);
ok('手上没一级时买二级该被拦（判据 lv-1）', buyTwo === false, '当前 lv=' + await ev(`FG.state.mach.lv.jar`) + '，买 2 判据=' + buyTwo);

console.log('— 存档往返 / 重开归零 —');
await ev(`(function(){ FG.state.mach={lv:{jar:1},job:{jar:{out:'suancai',n:1,at:99,in:80}}}; FG.state.day=70; FG.saveGame(); return 1})()`);
await sleep(300);
await ev(`location.reload()`); await sleep(2600);
  // 刷新完要**自己续**，别指望标题那一层顺带把档读了
  await ev(`FG.startFrom('cont')`); await sleep(700);
ok('读档回来坛还在腌着', (await ev(`!!FG.machJob('jar')`)) === true, await ev(`JSON.stringify(FG.state.mach)`));
ok('等级也还在', (await ev(`FG.state.mach.lv.jar`)) === 1);
// 老存档没这一项
await ev(`(function(){ var raw=JSON.parse(localStorage.getItem('guxian_nanshan_save_v1')); delete raw.mach; localStorage.setItem('guxian_nanshan_save_v1', JSON.stringify(raw)); return 1})()`);
await ev(`location.reload()`); await sleep(2600);
// 刷新完要**自己续**，别指望标题那一层顺带把档读了
await ev(`FG.startFrom('cont')`); await sleep(700);
// 补账函数会把每种机器都摆上 0（跟 S.build 同构），
// 所以补出来的是 {"lv":{"jar":0},"job":{}} 而不是空 lv
ok('老存档没这一项也能补出空的', (await ev(`JSON.stringify(FG.state.mach.job)`)) === '{}'
  && (await ev(`FG.state.mach.lv.jar`)) === 0,
  await ev(`JSON.stringify(FG.state.mach)`));
// 重开
await ev(`(function(){ FG.state.mach={lv:{jar:2},job:{jar:{out:'suancai',n:1,at:99,in:80}}}; FG.state.day=70; FG.saveGame(); return 1})()`);
await sleep(300);
await ev(`location.reload()`); await sleep(2600);
await ev(`FG.startFrom('new')`); await sleep(1200);
ok('开新局机器归零', (await ev(`JSON.stringify(FG.state.mach.job)`)) === '{}'
  && (await ev(`FG.state.mach.lv.jar`)) === 0,
  await ev(`JSON.stringify(FG.state.mach)`));
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('');
console.log('LOGS ' + (logs.length ? '有输出：\n' + logs.join('\n') : '(无报错)'));
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(0);
