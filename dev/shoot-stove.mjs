// 灶台验收：配方表、够/缺料显示、一天一口、扣料不半途失败、
// 加工品出货比原料值钱、图标各不一样、存档往返、重开归零。
//
// 「一天一口」这条规矩原来挂在「酿一坛酒」上，酿只是配方表里的一条。
// 规矩归灶，配方归配方，所以这一套盯的是**面板**，不是某一条配方。
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9359;
const profile = path.join(tmpdir(), 'guxian-stove-' + process.pid);

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
async function at(x, y) {
  await ev(`FG.state.player.x=${x}; FG.state.player.y=${y}; FG.state.walkTo=null;`);
  await sleep(200);
}
const hint = () => ev(`document.getElementById('hint').textContent`);
const toast = () => ev(`document.getElementById('toast').textContent`);
const stoveShown = () => ev(`!document.getElementById('st').classList.contains('hide')`);
// 从行囊里彻底掏空再摆上这几样，好让每一条断言读到的数都是自己刚摆的
// ——「前面哪一步改过这个值」是假失败的头号来源。
//
// 这函数**不动 cookN**。它原来顺手把灶的计数清零，结果「一天一口」那一节
// 自己清了灶，再断言「今天不能再动灶」，测的是被自己抹掉的状态。
// 酒那一项要排在 made 前面：酒在物品总表里 kind 就是 'made'（只是没有 src），
// 按 kind 分会写进 made[undefined]，读回来永远是 0 坛。
// 累加一律写成 (旧值 || 0) + n：`o.newKey += 2` 在 key 不存在时算出来是 NaN
// 而不是 2（undefined + 2 = NaN），而 JSON.stringify 把 NaN 写成 null ——
// 症状是「摆进去、当天读不到、存完档读回来是个 null」，三处都指不到真正的错。
async function setInv(obj) {
  await ev(`(function(){
    var o=${JSON.stringify(obj)};
    FG.state.bag={dou:0,su:0,shu:0,ji:0,ju:0};
    FG.state.pouch={};
    FG.state.jiu=0;
    FG.state.made={};
    for (var k in o) {
      var it=FG.BAG_IDX[k]; if(!it) continue;
      if (it.k === 'jiu') FG.state.jiu += o[k];
      else if (it.kind==='crop') FG.state.bag[it.src]=(FG.state.bag[it.src]||0)+o[k];
      else if (it.kind==='made') FG.state.made[it.src]=(FG.state.made[it.src]||0)+o[k];
      else FG.state.pouch[it.src]=(FG.state.pouch[it.src]||0)+o[k];
    }
    return 1;
  })()`);
  await ev(`FG.updateHUD()`);
  await sleep(160);
}
// 面板全关掉再回门口。**屋里（hs）也在这个名单里** ——
// 19/9 之后门口按 E 是进屋，前面板开着时 E 只把它关掉，看着就像没反应
async function closeAll() {
  await ev(`(function(){
    ['st','bg','dlg','al','de','hs','rd'].forEach(function(id){
      var e=document.getElementById(id); if (e) e.classList.add('hide');
    });
    return 1;
  })()`);
  await sleep(150);
}
async function homeNow() { await closeAll(); await at(home[0], home[1]); await sleep(220); }
// **从门口进屋再点「灶」那一行**开灶。20/2 之后归家和动灶都从屋里走，
// 门口按 E 只开屋里 —— 脚本还按老路子按一下 E 就等灶面板，
// 症状是「灶面板一行都没摆出来」，看着像灶坏了
async function stoveAtHome() {
  await homeNow();
  await key('e');
  await sleep(300);
  await ev(`(function(){
    var g=document.querySelector('#hs-list .hsr[data-k="stove"]'); if (g) g.click(); return 1;})()`);
  await sleep(300);
}
// 屋里那四行里某一行的文字
const hsText = k => ev(`(function(){var g=document.querySelector('#hs-list .hsr[data-k="${k}"]');
  return g ? g.textContent.replace(/\\s+/g,' ') : '(没有这一行)';})()`);
const hsOn = k => ev(`(function(){var g=document.querySelector('#hs-list .hsr[data-k="${k}"]');
  return g ? !g.classList.contains('off') : null;})()`);
// 读「刚才弹的是哪一句」之前先清一次。toast 淡出之后 textContent 还留在那儿，
// 不清的话读到的是上一条 —— 而那一句答案看着还挺像那么回事
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
const rowText = (id) => ev(`(function(){var g=document.querySelector('#st-list .rec[data-r="${id}"]');return g?g.textContent:'(没有这一行)'})()`);
const rowOff = (id) => ev(`(function(){var g=document.querySelector('#st-list .rec[data-r="${id}"]');return g?g.classList.contains('off'):null})()`);
const clickRow = (id) => ev(`(function(){var g=document.querySelector('#st-list .rec[data-r="${id}"]');if(!g)return 0;g.click();return 1})()`);
const nOff = () => ev(`document.querySelectorAll('#st-list .rec.off').length`);
const nRow = () => ev(`document.querySelectorAll('#st-list .rec').length`);

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

const home = JSON.parse(await ev(`JSON.stringify(FG.MAPS.nanshan.home)`));

console.log('— 配方表自己站得住 —');
const tbl = JSON.parse(await ev(`JSON.stringify((function(){
  var out=[];
  for (var i=0;i<FG.RECIPES.length;i++){
    var r=FG.RECIPES[i], bad=[];
    for (var k in r.need) if (!FG.BAG_IDX[k]) bad.push('原料 ' + k + ' 不在物品总表里');
    var o = FG.BAG_IDX[r.out];
    if (!o) bad.push('产物 ' + r.out + ' 不在物品总表里');
    else if (o.kind !== 'made') bad.push('产物 ' + r.out + ' 的类别是 ' + o.kind + '，不是 made');
    if (o && o.sell !== r.sell) bad.push('产物售价 ' + o.sell + ' 和配方写的 ' + r.sell + ' 对不上');
    if (!r.name) bad.push('没有名字');
    if (!r.n || r.n < 1) bad.push('一份的产量不是正数');
    out.push({ id:r.id, name:r.name, bad:bad });
  }
  return out;
})())`));
// 这一套盯的是**面板**，不是某一条配方。加了蛋羹之后配方从八条变九条，
// 下面凡是数「几条」的地方都从表里读 —— 写死的那个数每次加配方都会假失败一次，
// 而那不是回归
const nRecipe = await ev(`FG.RECIPES.length`);
ok('配方条数 = 表里的条数', tbl.length === nRecipe, tbl.length + ' 条 / 表里 ' + nRecipe + ' 条');
for (const r of tbl) ok('配方 ' + r.id + '（' + r.name + '）自洽', r.bad.length === 0, r.bad.join('；') || 'OK');

console.log('— 加工比原料值钱 —');
// 成本要顺着配方往回递归算：酒 sell=0，按卖价算是 0 钱，
// 那样「醋 380 > 酒 0」会永远绿着 —— 真实成本是三束黍 564，醋要低于它就是越加工越亏
const econ = JSON.parse(await ev(`JSON.stringify((function(){
  function unit(k, depth){
    if (depth > 8) return 0;
    var r=null;
    for (var i=0;i<FG.RECIPES.length;i++) if (FG.RECIPES[i].out === k) r = FG.RECIPES[i];
    if (r) {
      var c=0;
      for (var kk in r.need) c += unit(kk, depth+1) * r.need[kk];
      return c / r.n;
    }
    var it = FG.BAG_IDX[k];
    return it ? (it.sell || 0) : 0;
  }
  var out=[];
  for (var i=0;i<FG.RECIPES.length;i++){
    var r=FG.RECIPES[i];
    var c=0;
    for (var k in r.need) c += unit(k,1) * r.need[k];
    out.push({ id:r.id, name:r.name, cost:Math.round(c), sell:r.sell,
      margin: r.sell ? Math.round((r.sell/c - 1) * 100) : null });
  }
  return out;
})())`));
for (const r of econ) {
  if (r.sell === 0) {
    ok(r.name + ' 不卖钱（走人情）', true, '成本 ' + r.cost + ' 钱');
  } else {
    ok(r.name + ' 卖价比等量原料高', r.sell > r.cost,
      `原料 ${r.cost} → 卖 ${r.sell}（+${r.margin}%）`);
  }
}

console.log('— 每个加工品（made 类）的图标不是一个样 —');
// 这一套数的是**总表里 kind='made' 的每一件**，不是配方条数。
// 有鸡舍之后蛋也是 made，但它不来自配方 —— 按配方数去比会差一件，
// 而那不是回归。真正要守的是：made 类一件都不漏，且每一条配方的产物都在里面
const nMade = await ev(`FG.BAG.filter(function(b){return b.kind==='made'}).length`);
const icon = JSON.parse(await ev(`JSON.stringify((function(){
  var cv=document.createElement('canvas'); cv.width=40; cv.height=40;
  var cx=cv.getContext('2d'), I=FG.INK;
  function render(fn){ cx.clearRect(0,0,40,40); fn(); return cx.getImageData(0,0,40,40).data; }
  function diff(a,b){ var d=0; for (var p=3;p<a.length;p+=4) d+=Math.abs(a[p]-b[p]); return d; }
  var keys=[];
  for (var i=0;i<FG.BAG.length;i++) if (FG.BAG[i].kind==='made') keys.push(FG.BAG[i].k);
  // 兜底分支画的是种子袋。要是哪个加工品落进去了，它和这张兜底图会一模一样
  var pouch = render(function(){ I.icPouch(cx, 14, I.INK_SOFT); });
  var shots={}, vsPouch=[];
  for (i=0;i<keys.length;i++){
    shots[keys[i]] = (function(k){ return render(function(){ I.icon(cx, k, 20, 20, 28); }); })(keys[i]);
    vsPouch.push({ k: keys[i], d: diff(shots[keys[i]], pouch) });
  }
  var minPair=1e9, minName='';
  for (i=0;i<keys.length;i++) for (var j=i+1;j<keys.length;j++){
    var d=diff(shots[keys[i]], shots[keys[j]]);
    if (d<minPair){ minPair=d; minName=keys[i]+'~'+keys[j]; }
  }
  return { n: keys.length, vsPouch: vsPouch, minPair: minPair, minName: minName };
})())`));
ok('made 类一件都不漏', icon.n === nMade, icon.n + ' 件 / 表里 ' + nMade + ' 件');
ok('每一条配方的产物都画了图标', await ev(`(function(){
  var have={},i;
  for(i=0;i<FG.BAG.length;i++) if(FG.BAG[i].kind==='made') have[FG.BAG[i].k]=1;
  for(i=0;i<FG.RECIPES.length;i++) if(!have[FG.RECIPES[i].out]) return FG.RECIPES[i].out;
  return '';
})()`) === '', (await ev(`FG.RECIPES.length`)) + ' 条配方');
ok('没有一件落进兜底分支（画成种子袋）', icon.vsPouch.every(v => v.d > 3000),
  icon.vsPouch.map(v => v.k + ':' + v.d).join('  '));
ok('两两之间都分得开', icon.minPair > 3000,
  `最接近的一对 ${icon.minName} 差 ${icon.minPair}`);

console.log('— 门口：按 E 是进屋，屋里那四行各自说得清 —');
await setInv({});
await at(home[0], home[1]);
await sleep(220);
ok('空着手时门口写的是「进屋」', (await hint()).indexOf('进屋') >= 0, await hint());
await key('e');
await sleep(350);
ok('门口按 E 开的是屋里', (await ev(`FG.houseOpen()`)) === true);
ok('屋里四行：灶 / 木箱 / 诗册 / 床',
  (await ev(`document.querySelectorAll('#hs-list .hsr').length`)) === 4,
  await ev(`(function(){var o=[];document.querySelectorAll('#hs-list .hsr').forEach(function(e){
    o.push(e.getAttribute('data-k'));});return o.join(',')})()`));
ok('空着手时「灶」那一行是暗的（不是没有）', (await hsOn('stove')) === false, await hsText('stove'));
ok('「床」那一行永远亮着', (await hsOn('bed')) === true, await hsText('bed'));
ok('「诗册」那一行没砌东轩时也是暗的', (await hsOn('album')) === false, await hsText('album'));
// 暗着的行要点得动，而且要回一句话 ——
// 静悄悄地什么都不发生的话，玩家会以为这一格是坏的
await clearToast();
await ev(`(function(){ document.querySelector('#hs-list .hsr[data-k="stove"]').click(); return 1;})()`);
await sleep(300);
ok('点暗的那一行会回一句话，不是没反应', (await toast()).length > 0, await toast());
ok('而且屋里还开着（没被误关）', (await ev(`FG.houseOpen()`)) === true);
await key('Escape');
await sleep(300);
ok('Esc 出得了屋', (await ev(`FG.houseOpen()`)) === false);
await setInv({ crop_dou: 2 });
await homeNow();
ok('有豆时屋里「灶」那行亮着', (await key('e'), await sleep(320), await hsOn('stove')) === true, await hsText('stove'));
ok('那行写得出今天做得出什么', /酱/.test(await hsText('stove')), await hsText('stove'));
ok('提示行写的也是那一句（两处说的是一回事）',
  /灶还能做 1 \/ 1 口/.test(await hint()), await hint());
await key('Escape');
await sleep(250);

console.log('— 面板上够的写够，缺的写缺 —');
await stoveAtHome();
ok('灶面板开了', (await stoveShown()) === true);
ok('配方都摆出来了', (await nRow()) === nRecipe, (await nRow()) + ' 行 / ' + nRecipe + ' 条');
await shot('50-灶台.png');
const tJiang = await rowText('jiang');
const tBing = await rowText('bing');
console.log('  酱 =', tJiang);
console.log('  饼 =', tBing);
ok('够料的那条写「够」', tJiang.indexOf('够：') >= 0, tJiang);
ok('缺料的那条写「缺」，还写缺几', tBing.indexOf('缺：') >= 0 && tBing.indexOf('粟') >= 0, tBing);
ok('够的那条不点不亮', (await rowOff('jiang')) === false);
ok('缺的那条按不下去', (await rowOff('bing')) === true);

console.log('— 缺料时点下去什么也不发生，也不扣东西 —');
const douA = await ev(`FG.state.bag.dou`);
await clickRow('bing');
await sleep(300);
ok('豆没被扣掉', (await ev(`FG.state.bag.dou`)) === douA, `${douA} -> ${await ev(`FG.state.bag.dou`)}`);
ok('没做出饼', (await ev(`FG.state.made.bing||0`)) === 0, 'bing=' + await ev(`FG.state.made.bing||0`));
ok('灶还没被记成用掉（不算今天动过）', (await ev(`FG.state.cookN`)) === 0, 'cookN=' + await ev(`FG.state.cookN`));

console.log('— 凑齐了才做得出来，两样原料都扣 —');
await setInv({ crop_dou: 2, crop_su: 1 });
await stoveAtHome();
ok('凑齐后饼亮着', (await rowOff('bing')) === false, await rowText('bing'));
await clickRow('bing');
await sleep(350);
ok('豆扣了', (await ev(`FG.state.bag.dou`)) === 1, 'dou=' + await ev(`FG.state.bag.dou`));
ok('粟扣了', (await ev(`FG.state.bag.su`)) === 0, 'su=' + await ev(`FG.state.bag.su`));
ok('饼做出来了', (await ev(`FG.state.made.bing`)) === 1, 'bing=' + await ev(`FG.state.made.bing`));
await shot('51-做完.png');

console.log('— 一天一口 —');
ok('做掉一条之后面板全暗了', (await nOff()) === nRecipe, (await nOff()) + ' 暗 / ' + (await nRow()) + ' 行');
// 补满料，但今天那一口不动。补料是补料，放不放行是灶的规矩，两件事不能搅在一起
await ev(`(function(){
  FG.state.bag.shu=9; FG.state.bag.dou=9; FG.state.pouch.xia=9; FG.state.pouch.ou=9;
  FG.updateHUD(); return 1;
})()`);
await homeNow();
// 这几行是「否定断言」，前后各夹一条「控制台干净」才算数 ——
// 否则某个回调抛了异常，「什么也没发生」正好就是它们要的
ok('这一段没有异常', logs.length === 0, logs.join(' | ') || '干净');
await key('e');
await sleep(400);
ok('按下去开的是屋里不是灶', (await ev(`FG.houseOpen()`)) === true && (await stoveShown()) === false);
ok('屋里「灶」那一行今天做完了', (await hsOn('stove')) === false, await hsText('stove'));
ok('「床」那一行还亮着（回不了屋的出路没有了才对，这儿正好核）', (await hsOn('bed')) === true);
await ev(`(function(){ document.querySelector('#hs-list .hsr[data-k="bed"]').click(); return 1;})()`);
await sleep(500);
ok('结算面板弹了', (await ev(`!document.getElementById('de').classList.contains('hide')`)) === true);
ok('屋里关掉了', (await ev(`FG.houseOpen()`)) === false);
ok('酱还是一口没做', (await ev(`FG.state.made.jiang||0`)) === 0, 'jiang=' + await ev(`FG.state.made.jiang||0`));
ok('这一段也没有异常', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 过了夜又动得了 —');
await ev(`FG.nextDay()`);
await sleep(600);
await setInv({});
await homeNow();
ok('第二天灶又亮了', (await key('e'), await sleep(320), await hsOn('stove')) === false, await hsText('stove'));
await key('Escape'); await sleep(200);
await ev(`(function(){ FG.state.bag.shu=9; FG.updateHUD(); return 1; })()`);
await homeNow();
ok('有黍就动得了灶', (await key('e'), await sleep(320), await hsOn('stove')) === true, await hsText('stove'));
await key('Escape'); await sleep(200);
await stoveAtHome();
ok('面板里不再全暗', (await nOff()) < nRecipe, (await nOff()) + ' 暗 / ' + nRecipe + ' 条');
const tCu = await rowText('cu');
console.log('  醋 =', tCu);
ok('醋缺酒时写缺酒', tCu.indexOf('缺：') >= 0 && tCu.indexOf('酒') >= 0, tCu);

console.log('— 酒能变醋，也能递给邻居 —');
await setInv({ jiu: 1 });
await stoveAtHome();
ok('灶面板开着', (await stoveShown()) === true);
ok('有酒时醋亮着', (await rowOff('cu')) === false, await rowText('cu'));
await clickRow('cu');
await sleep(350);
ok('酒扣了一坛', (await ev(`FG.state.jiu`)) === 0, 'jiu=' + await ev(`FG.state.jiu`));
ok('得一坛醋', (await ev(`FG.state.made.cu`)) === 1, 'cu=' + await ev(`FG.state.made.cu`));

console.log('— Esc 关灶 —');
// 上一步刚动过灶，今天灶已经记成用掉了。补料不解除它，得过一夜
await ev(`FG.nextDay()`);
await sleep(600);
await setInv({ crop_shu: 9 });
await stoveAtHome();
ok('重新开着了', (await stoveShown()) === true);
await key('Escape');
await sleep(320);
ok('Esc 关掉了', (await stoveShown()) === false);
ok('这一段也没有异常', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 手里有酒也回得了家 —');
// 这条曾经是真死路：酒能酿醋，所以只要手里有一坛酒，门口的 E 就永远是「动灶」，
// 玩家拿着留给邻翁的酒就再也回不了屋。20/2 之后 E 改成进屋、
// 归家从屋里「床」那一行走，这条路不再是唯一出路了 —— 但还得核它还通着
await ev(`FG.nextDay()`);
await sleep(600);
await setInv({ jiu: 5, bing: 3, cu: 1 });
// 天黑只出货箱里的东西，所以要先放进去 —— 这一节要的是「天黑折钱」这条路，
// 不是「天黑自动全卖」。不先放的话，结算面板会理直气壮地显示进项 0
await ev(`(function(){
  FG.openBin();
  ['bing','cu'].forEach(function(k){
    var r=document.querySelector('#bx-hand [data-k="'+k+'"]');
    if (r) r.dispatchEvent(new MouseEvent('click',{bubbles:true, shiftKey:true}));
  });
  document.getElementById('bx-x').click();
  return 1;
})()`);
await sleep(300);
const gA = await ev(`FG.state.gold`);
const eA = await ev(`FG.state.earned`);
const expSell = econ.find(r => r.id === 'bing').sell * 3 + econ.find(r => r.id === 'cu').sell;
ok('加工品进了箱', (await ev(`FG.binWorth()`)) === expSell,
  `箱 ${await ev(`FG.binWorth()`)} / 应为 ${expSell}`);
await homeNow();
ok('手里有酒，屋里「灶」那行照旧亮着', (await key('e'), await sleep(320), await hsOn('stove')) === true,
  await hsText('stove'));
ok('而「床」那行也亮着 —— 拿着酒照样回得了屋', (await hsOn('bed')) === true, await hsText('bed'));
ok('提示里点得出醋是可做的', /醋/.test(await hsText('stove')), await hsText('stove'));
await key('Escape'); await sleep(250);
await stoveAtHome();
ok('灶面板开着', (await stoveShown()) === true);
ok('「收灶归家」在面板上', (await ev(`!!document.getElementById('st-go')`)) === true);
await shot('53-收灶归家.png');
await ev(`document.getElementById('st-go').click()`);
await sleep(600);
ok('灶面板关了', (await stoveShown()) === false);
ok('天黑结算弹了', (await ev(`!document.getElementById('de').classList.contains('hide')`)) === true);
ok('加工品折的钱正好是份数×售价', (await ev(`FG.state.gold`)) === gA + expSell,
  `${gA} + ${expSell} = ${await ev(`FG.state.gold`)}`);
ok('饼出货了', (await ev(`FG.state.made.bing`)) === 0);
ok('醋出货了', (await ev(`FG.state.made.cu`)) === 0);
ok('酒没被折成钱', (await ev(`FG.state.jiu`)) === 5, 'jiu=' + await ev(`FG.state.jiu`));
ok('一生累计也跟着涨', (await ev(`FG.state.earned`)) === eA + expSell,
  `${eA} -> ${await ev(`FG.state.earned`)}`);
ok('结算面板上写得出加工品', (await ev(`document.getElementById('de').textContent`)).indexOf('饼') >= 0,
  (await ev(`document.getElementById('de').textContent`)).replace(/\s+/g, ' ').slice(0, 120));
ok('这一段也没有异常', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 行囊里摆得出加工品 —');
await ev(`FG.nextDay()`);
await sleep(600);
await setInv({ bing: 2, cu: 1, jiu: 3 });
// 比集合不比次序：行囊是按 FG.BAG 的类别顺序摆的，往配方表里插一条
// 就会把次序挪开，写死字符串的断言会在一个无关的改动上炸
const bagRows = await ev(`FG.bagList().filter(function(b){return b.it.kind==='made'})
  .map(function(b){return b.k+':'+b.n}).sort().join(',')`);
ok('行囊里读得到三样加工品', bagRows === 'bing:2,cu:1,jiu:3', bagRows);
// 容量从 data.js 读，不写死 —— 写死的话以后加一件物品，测试会拿旧数字报警
const cap = await ev(`FG.BAG_COLS * FG.BAG_ROWS`);
ok('行囊的格数够摆全部物品', (await ev(`FG.BAG.length`)) <= cap,
  `物品 ${await ev(`FG.BAG.length`)} 件 / 格子 ${cap} 个`);
await ev(`FG.openBag()`);
await sleep(400);
await shot('52-行囊里的加工品.png');
ok('行囊开得起来', (await ev(`!document.getElementById('bg').classList.contains('hide')`)) === true);
await key('Tab');
await sleep(300);
ok('Tab 关得掉', (await ev(`document.getElementById('bg').classList.contains('hide')`)) === true);

console.log('— 存档往返 —');
await setInv({ gujiang: 4 });
await ev(`FG.saveGame()`);
await sleep(300);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1000);
ok('读档后加工品还在', (await ev(`FG.state.made.gujiang`)) === 4, 'gujiang=' + await ev(`FG.state.made.gujiang`));
// [0] 可能整个是 undefined，写成 .n 会在页面里炸，炸出来的样子
// 跟「读档丢了加工品」一模一样 —— 先数个数再取值
ok('读档后行囊也读得到', (await ev(`
  (function(){ var a=FG.bagList().filter(function(b){return b.k==='gujiang'});
    return a.length + '/' + (a.length ? a[0].n : '-'); })()
`)) === '1/4', await ev(`
  (function(){ var a=FG.bagList().filter(function(b){return b.k==='gujiang'});
    return a.length + '/' + (a.length ? a[0].n : '-'); })()
`));

console.log('— 重开归零 —');
await ev(`FG.restart()`);
await sleep(800);
ok('重开后加工品没了', (await ev(`Object.keys(FG.state.made).length`)) === 0,
  JSON.stringify(await ev(`FG.state.made`)));
ok('重开后酒没了', (await ev(`FG.state.jiu`)) === 0);
ok('重开后灶上的计数也归零', (await ev(`FG.state.cookN`)) === 0, 'cookN=' + await ev(`FG.state.cookN`));
// 重开归零的反面：重开之后**该能重新动灶**。只断「清干净了」会漏掉
// 「清得太干净，把灶的日号也钉死在今天之外」这种新档第一天就动不了灶的情况
await setInv({ crop_dou: 2 });
await homeNow();
ok('重开第一天屋里「灶」那行亮着', (await key('e'), await sleep(320), await hsOn('stove')) === true,
  await hsText('stove'));
await key('Escape'); await sleep(200);
await stoveAtHome();
ok('重开第一天能开出灶面板', (await stoveShown()) === true);
await clickRow('jiang');
await sleep(350);
ok('重开第一天做得出酱', (await ev(`FG.state.made.jiang`)) === 1, 'jiang=' + await ev(`FG.state.made.jiang`));

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? `FAILED ${fails}` : 'DONE');
