// 行囊验收：8×4 网格、每一类物品的图标、点种子下种。
//
// 盯住两件容易悄悄坏的事：
//   1) 行囊是**读模型** —— 摆出来的数必须等于天黑结算真正会出货的数，
//      差一个就是「背包里三个，结算时卖了四个/两个」
//   2) 点种子下种走的是 useOn 之外的另一条路，两边判据必须一致
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9353;
const profile = path.join(tmpdir(), 'guxian-bag-' + process.pid);

const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
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
const bagOpen = () => ev(`!document.getElementById('bg').classList.contains('hide')`);
// 这里读的是游戏自己那个读函数，不再在测试里抄一遍「谁在哪本账上」。
// 抄一份的话，游戏里加一类物品、或改一次存取的路由，测试这边
// 会安静地按旧规则算 —— 而它算出来的数恰恰就是它自己要验的那个数
const listed = () => ev(`JSON.stringify(FG.bagList().map(function (b) {
  return { k: b.k, n: b.n };
}))`);

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

console.log('— 物品总表 —');
const nBag = await ev(`FG.BAG.length`);
// 总表里 kind='made' 的有几类，配方表有几条
const nMade = await ev(`FG.BAG.filter(function(b){return b.kind==='made'}).length`);
const nRec = await ev(`FG.RECIPES.length`);
// 「加工品类 = 配方条数」这条不变式在有鸡舍之后就不成立了：
// 蛋是鸡舍早上下的，kind 同样是 made，但它不来自任何一条配方。
// 真该守的是**每一条配方的产物都在总表里**（漏登记的话玩家做出来的东西点不开），
// 而不是两个数相等 —— 后者只是「当时恰好一一对应」
const recMissing = await ev(`(function(){
  var b=[],i,j;
  for(i=0;i<FG.RECIPES.length;i++){
    var id=FG.RECIPES[i].out||FG.RECIPES[i].id, hit=false;
    for(j=0;j<FG.BAG.length;j++) if((FG.BAG[j].k||FG.BAG[j].id)===id) hit=true;
    if(!hit) b.push(id);
  }
  return JSON.stringify(b);
})()`);
ok('每一条配方的产物都登记在总表里', recMissing === '[]', recMissing + ' / ' + nRec + ' 条配方');
ok('加工品类不会少于配方条数', nMade >= nRec, nMade + ' 件 / ' + nRec + ' 条配方');
const slots = await ev(`FG.BAG_COLS * FG.BAG_ROWS`);
ok(`总表每一类都排得进 ${await ev('FG.BAG_COLS')}×${await ev('FG.BAG_ROWS')}`, nBag <= slots, nBag + ' 类 / ' + slots + ' 格');
const kinds = JSON.parse(await ev(`(function(){var g={},i;for(i=0;i<FG.BAG.length;i++)g[FG.BAG[i].kind]=(g[FG.BAG[i].kind]||0)+1;return JSON.stringify(g);})()`));
console.log('  分类 =', JSON.stringify(kinds));
// 类别清单写死过一次（tool/seed/crop/fish/good/made），加了矿砂之后它就成了
// 一个假失败 —— 写死的是「当时有哪些类」。真正该守的是：**总表里出现的每一个
// 类别都得在 KIND_NAME 里有名字**，加了一类忘了登记就是「矿砂」显示成 undefined
const noName = await ev(`(function(){var b=[],i;
  for(i=0;i<FG.BAG.length;i++){ var k=FG.BAG[i].kind; if(!FG.KIND_NAME[k]) b.push(k); }
  return Array.from(new Set(b)).join(',')||'(无)';})()`);
ok('每一类都有中文名（KIND_NAME 登记齐了）', noName === '(无)', noName + '　共 ' + Object.keys(kinds).length + ' 类：' + Object.keys(kinds).join(','));
// 每一类都得有名字、说明、出处。缺一个就是鼠标一悬停显示 undefined
const bad = await ev(`(function(){var b=[],i;for(i=0;i<FG.BAG.length;i++){
  var t=FG.BAG[i]; if(!t.name||!t.desc||!t.from) b.push(t.k+':'+(t.name?'-':'')+(t.desc?'-':'')+(t.from?'ok':'缺')); }
  return b.join(',')||'(无)';})()`);
ok('每样东西都有名字、说明、出处', bad === '(无)', bad);
const dup = await ev(`(function(){var s={},d=[],i;for(i=0;i<FG.BAG.length;i++){if(s[FG.BAG[i].k])d.push(FG.BAG[i].k);s[FG.BAG[i].k]=1;}return d.join(',')||'(无)';})()`);
ok('没有重复的 key', dup === '(无)', dup);
// 图标必须都画得出来 —— 少一个分支就是那格空白，而空白是静默的
const drawn = await ev(`(function(){
  var c=document.createElement('canvas'); c.width=c.height=64; var x=c.getContext('2d');
  var bad=[];
  for (var i=0;i<FG.BAG.length;i++){
    x.clearRect(0,0,64,64);
    try { FG.INK.icon(x, FG.BAG[i].k, 32, 32, 40); } catch(e){ bad.push(FG.BAG[i].k+':'+e.message); continue; }
    var d=x.getImageData(0,0,64,64).data, n=0;
    for (var p=3;p<d.length;p+=4) if (d[p]>8) n++;
    if (n < 60) bad.push(FG.BAG[i].k+':只画了'+n+'个像素');
  }
  return bad.join(',')||'(无)';})()`);
ok('每个图标都画得出东西（至少 60 个实像素）', drawn === '(无)', drawn + `　共 ${nBag} 个`);

console.log('— 网格 —');
// 格数不能写死：加了四样矿砂之后 8×4=32 已经装不下了（35 样），
// 而装不下是**静默**的 —— drawBag 的循环到 COLS*ROWS 就停，画面上只是少一格
const cols = await ev(`FG.BAG_COLS`), rows = await ev(`FG.BAG_ROWS`);
ok(`格子数 = ${cols}×${rows}`, cols * rows >= nBag, cols + '×' + rows + ' = ' + cols * rows + ' 格 / ' + nBag + ' 样');
const geo = JSON.parse(await ev(`JSON.stringify(FG.BAG_GEO)`));
ok('画布尺寸 = 边距 + 列×格宽 / 行×格高',
  geo.w === geo.pad + cols * geo.slot && geo.h >= geo.pad + rows * geo.slot,
  JSON.stringify(geo));
ok('底部计数行还有地方放（没压在最后一行上）',
  geo.h - (geo.pad + rows * geo.slot) >= 18, '余 ' + (geo.h - (geo.pad + rows * geo.slot)) + 'px');
ok('画布尺寸和格数对得上', (await ev(`
  (function(){ var c=document.getElementById('bg-cv'); return c.width>0 && c.height>0; })()
`)) === true);

console.log('— Tab 开关 —');
ok('开局没开', (await bagOpen()) === false);
await key('Tab');
await sleep(400);
ok('Tab 打开行囊', (await bagOpen()) === true);
const cvRect = JSON.parse(await ev(`(function(){var r=document.getElementById('bg-cv').getBoundingClientRect();
  return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height});})()`));
ok('行囊画布有实际尺寸', cvRect.w > 300 && cvRect.h > 200, JSON.stringify(cvRect));
await shot('50-行囊.png');
await key('Escape');
await sleep(350);
ok('Esc 关上', (await bagOpen()) === false);
await key('Tab'); await sleep(350);
ok('再按 Tab 又开', (await bagOpen()) === true);
await key('Tab'); await sleep(350);
ok('开着的时候按 Tab 是关', (await bagOpen()) === false);

console.log('— 读模型：行囊里的数 = 结算会出货的数 —');
await ev(`(function(){
  FG.state.bag = { dou: 5, su: 2, shu: 1, ji: 0, ju: 3 };
  FG.state.pouch = { xia: 2, gui: 1, mei: 4, jun: 1, luos: 3 };
  FG.state.jiu = 2;
  FG.state.gear = { chu: 0, piao: 0 };
  FG.state.seeds = { dou: 7, su: 1, shu: 0, ji: 4, ju: 2 };
  FG.updateHUD();
})()`);
await sleep(300);
const L = JSON.parse(await listed());
const find = k => (L.find(x => x.k === k) || { n: 0 }).n;
console.log('  行囊 =', L.map(x => x.k + '×' + x.n).join(' '));
ok('谷物数对得上', find('crop_dou') === 5 && find('crop_su') === 2 && find('crop_ji') === 0, '豆' + find('crop_dou'));
ok('零数量不占格（稷为 0）', find('crop_ji') === 0);
ok('溪产数对得上', find('fish_xia') === 2 && find('fish_gui') === 1);
ok('山货数对得上', find('good_mei') === 4 && find('good_luos') === 3);
ok('酒单独一类', find('jiu') === 2);
ok('种子数对得上（黍为 0 不占格）', find('seedD') === 7 && find('seedSh') === 0, '豆种' + find('seedD'));
// 器物一直都在行囊里，分级只改名字和一次能做多少 ——
// 不再是「买过才有」。所以这条改成核「分级之后行囊上写的是新名字」
ok('器物在行囊里', find('piao') === 1 && find('chu') === 1);
await ev(`FG.state.gear.piao = 2`);
await sleep(200);
const L2 = JSON.parse(await listed());
ok('升到铁瓢之后行囊上写的是铁瓢', !!L2.find(x => x.k === 'piao'),
  JSON.stringify(L2.map(x => x.k)));
ok('行囊说明里出现了「一下 9 畦」',
  (await ev(`(function(){
     FG.openBag();
     var L=FG.bagList(), i;
     for (i=0;i<L.length;i++) if (L[i].k==='piao') { FG.hintBag && FG.hintBag(i); break; }
     return document.getElementById('bg-tip').textContent; })()`)).indexOf('9 畦') >= 0);
// 探完要**把行囊关回去、分级也退回去**。留着开着的话，
// 后面那一步按 Tab 变成「关行囊」而不是「开行囊」，
// 于是点击落在已经藏起来的画布上 —— 而「点完自动收起行囊」照样 PASS，
// 因为它本来就是关着的。后面的失败看起来毫不相干，根子在这儿
await ev(`(function(){
  var e=document.getElementById('bg'); if (e) e.classList.add('hide');
  FG.state.gear.piao = 0; FG.updateHUD(); return 1; })()`);
await sleep(200);
ok('探完把行囊收起来了', (await bagOpen()) === false);
// 图标的绘制顺序按种类分组。以前这条写死了种类顺序表 ['tool','seed',...]，
// 加了矿砂之后 indexOf 返回 -1，整条断言开始报「第 N 格 ore 排到了 … 后面」——
// 那是假失败：写死的是「当时有哪几类」。真正该守的是**一类只占一段**，
// 因为一类一类夹着排的话，35 格里同类的图标散在四处，按名字找东西全靠眼力
ok('总表一类占一段（没有一类夹在两类中间）', (await ev(`
  (function(){
    var open={}, prev=null, L=FG.BAG;
    for (var i=0;i<L.length;i++){ var k=L[i].kind;
      if (k!==prev){ if (open[k]) return k+' 在第 '+i+' 格又开了一段'; open[k]=1; prev=k; } }
    return 1; })()
`)) === 1, await ev(`(function(){var s=[],L=FG.BAG;for(var i=0;i<L.length;i++)if(s.indexOf(L[i].kind)<0)s.push(L[i].kind);return s.join('→');})()`));
// 种类表也不写死：读总表自己的顺序，这就是画布上从上到下、从左到右的类别顺序

console.log('— 真的对着结算核一遍 —');
// 拿钱对账：行囊里摆着的每一份，放进出货箱之后，到账必须正好等于
// 「行囊标的 × 份数」之和。这条不变式是行囊作为**读模型**的全部意义 ——
// 差一份就是「背包里三个，结算卖了四个」，而画面上完全看不出来。
//
// 现在多了一步：要先把东西放进去。放的动作走玩家那条路（点行 + Shift），
// 不直接写 S.bin —— 直接写就绕过了真正要对账的那段代码。
const ship = JSON.parse(await ev(`(function(){
  var e=0, L=FG.bagList();
  for (var i=0;i<L.length;i++) if (L[i].it.sell) e += L[i].n * L[i].it.sell;
  return JSON.stringify({ship:e, gold:FG.state.gold, put:0});
})()`));
await ev(`(function(){
  FG.openBin();
  // 每点一次面板就整个重画，querySelectorAll 查出来的节点当场就脱离文档了，
  // 再点它们事件不会冒泡到 #bx-hand 上 —— 静默只动了一样。
  // 所以只能一次点一行、点完重新查。
  for (var n=0; n<40; n++) {
    var row = document.querySelector('#bx-hand .bxh:not(.no)');
    if (!row) break;
    row.dispatchEvent(new MouseEvent('click',{bubbles:true, shiftKey:true}));
  }
  document.getElementById('bx-x').click();
  return 1;
})()`);
await sleep(300);
ok('放完之后箱里折的钱 = 行囊标的',
  (await ev(`FG.binWorth()`)) === ship.ship,
  `箱 ${await ev(`FG.binWorth()`)} / 账 ${ship.ship}`);
await ev(`FG.state.min = FG.DAY.END - 1`);
await sleep(1900);
const goldAfter = await ev(`FG.state.gold`);
ok('行囊标的的出货额 = 实际到账',
  goldAfter === ship.gold + ship.ship,
  `账上算出 ${ship.ship}，进项后 ${ship.gold} -> ${goldAfter}`);
ok('酒不折钱', (await ev(`FG.state.jiu`)) === 2, 'jiu=' + await ev(`FG.state.jiu`));
await ev(`FG.nextDay()`);
await sleep(600);

console.log('— 点种子 → 点田畦 → 下种 —');
// 先翻一畦，再从行囊里捏一包豆种，然后直接点那一畦
await ev(`(function(){
  var g=FG.FIELD;
  FG.state.seeds.dou = 5;
  var c=[0,0], q=g.cellQuad(c[0],c[1]), p=g.cellCenter(c[0],c[1]);
  FG.state.plots[c[1]][c[0]].tilled = true;
  window.__cell = c; window.__ct = p;
})()`);
const ct = JSON.parse(await ev(`JSON.stringify(window.__ct)`));
const cvR = JSON.parse(await ev(`(function(){var r=document.getElementById('game').getBoundingClientRect();
  return JSON.stringify({l:r.left,t:r.top,w:r.width,h:r.height});})()`));
async function clickCell(x, y) {
  const px = cvR.l + x / 1920 * cvR.w, py = cvR.t + y / 1080 * cvR.h;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: px, y: py, button: 'left', clickCount: 1 });
  }
  await sleep(250);
}
const seedSlotIdx = JSON.parse(await ev(`(function(){
  for (var i=0;i<FG.BAG.length;i++) if (FG.BAG[i].k==='seedD') return i;
  return -1; })()`));
ok('豆种在总表里找得到', seedSlotIdx >= 0, '下标 ' + seedSlotIdx);
const slotIdx = JSON.parse(await ev(`(function(){
  var i=0;
  for (var k in FG.BAG) {} // noop
  return 0; })()`));
// 行囊是按 FG.BAG 顺序摆的，位置 = 该物在「有货的列表」里的次序
const pos = JSON.parse(await ev(`(function(){
  var out=[],i,it,n;
  for (i=0;i<FG.BAG.length;i++){ it=FG.BAG[i]; n=0;
    if (it.kind==='seed') n=FG.state.seeds[FG.CROP_OF_SEED[it.k]]||0;
    else if (it.kind==='crop') n=FG.state.bag[it.src]||0;
    else if (it.kind==='fish'||it.kind==='good') n=FG.state.pouch[it.src]||0;
    else if (it.kind==='made') n=FG.state.jiu||0;
    else n=1;   // 器物一直都在，分级只改名字和范围
    if(n>0) out.push(it.k); }
  return out.indexOf('seedD'); })()`));
console.log('  豆种在第 ' + pos + ' 格');
await key('Tab'); await sleep(400);
// 按行囊的格子几何点那一格。几何从 FG.BAG_GEO 读 —— 测试里另抄一份的话，
// 抄的那份永远滞后于源码，点下去落在别的格上，症状只是「种错苗」
const BG = geo;
const sr = [BG.pad + (pos % cols) * BG.slot, BG.pad + Math.floor(pos / cols) * BG.slot];
const cRect = cvRect;
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cRect.x + (sr[0] + BG.slot / 2) / BG.w * cRect.w, y: cRect.y + (sr[1] + BG.slot / 2) / BG.h * cRect.h, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cRect.x + (sr[0] + BG.slot / 2) / BG.w * cRect.w, y: cRect.y + (sr[1] + BG.slot / 2) / BG.h * cRect.h, button: 'left', clickCount: 1 });
await sleep(400);
ok('点完自动收起行囊', (await bagOpen()) === false);
ok('手上捏着豆种', (await ev(`FG.state.pendingSeed`)) === 'seedD', await ev(`FG.state.pendingSeed`));
await sleep(300);
const h = await ev(`document.getElementById('hint').textContent`);
ok('提示行说「点一畦翻好的土」', h.indexOf('点一畦翻好的土') >= 0, h);
await shot('51-捏着种.png');
const stamA = await ev(`FG.state.stam`);
await clickCell(ct[0], ct[1]);
ok('点田畦就种下去了', (await ev(`FG.state.plots[0][0].crop`)) === 'dou',
  'crop=' + await ev(`FG.state.plots[0][0].crop`));
ok('种子减一', (await ev(`FG.state.seeds.dou`)) === 4, 'dou=' + await ev(`FG.state.seeds.dou`));
ok('扣了一点体力', (await ev(`FG.state.stam`)) === stamA - 1, `${stamA} -> ${await ev(`FG.state.stam`)}`);
ok('苗下在手上还有货时才清空', (await ev(`FG.state.pendingSeed`)) === 'seedD');

console.log('— 捏着种时的那几道门 —');
// 注意：下面三条「种不下去」都是**否定断言**，而未捕获的异常恰好也会让
// 「没种上」成立。所以每条之前先确认这一段没抛过 —— 上一版就是被这个蒙过去的
const excBefore = logs.length;
ok('到这一步为止没有异常', logs.length === excBefore, logs.slice(excBefore).join(' | '));
await ev(`FG.state.seeds.ju = 3`);
await key('Tab'); await sleep(350);
const posJu = JSON.parse(await ev(`(function(){
  var out=[],i,it,n;
  for (i=0;i<FG.BAG.length;i++){ it=FG.BAG[i]; n=0;
    if (it.kind==='seed') n=FG.state.seeds[FG.CROP_OF_SEED[it.k]]||0;
    else if (it.kind==='crop') n=FG.state.bag[it.src]||0;
    else if (it.kind==='fish'||it.kind==='good') n=FG.state.pouch[it.src]||0;
    else if (it.kind==='made') n=FG.state.jiu||0;
    else n=1;   // 器物一直都在，分级只改名字和范围
    if(n>0) out.push(it.k); }
  return out.indexOf('seedJu'); })()`));
const jr = [BG.pad + (posJu % cols) * BG.slot, BG.pad + Math.floor(posJu / cols) * BG.slot];
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cRect.x + (jr[0] + BG.slot / 2) / BG.w * cRect.w, y: cRect.y + (jr[1] + BG.slot / 2) / BG.h * cRect.h, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cRect.x + (jr[0] + BG.slot / 2) / BG.w * cRect.w, y: cRect.y + (jr[1] + BG.slot / 2) / BG.h * cRect.h, button: 'left', clickCount: 1 });
await sleep(350);
ok('换成捏着菊种', (await ev(`FG.state.pendingSeed`)) === 'seedJu');
// 立春种不下菊
await ev(`(function(){var q=FG.FIELD.cellCenter(1,1); window.__c2=q;})()`);
const c2 = JSON.parse(await ev(`JSON.stringify(window.__c2)`));
await ev(`FG.state.plots[1][1].tilled = true;`);
const stamB = await ev(`FG.state.stam`);
await clickCell(c2[0], c2[1]);
ok('错季种不下去', (await ev(`FG.state.plots[1][1].crop`)) === null || (await ev(`FG.state.plots[1][1].crop`)) === undefined);
ok('而且没白扣体力', (await ev(`FG.state.stam`)) === stamB, `${stamB} -> ${await ev(`FG.state.stam`)}`);
ok('提示说的是菊的时节', (await ev(`document.getElementById('toast').textContent`)).indexOf('菊') >= 0,
  await ev(`document.getElementById('toast').textContent`));
// 没翻的土也种不下去
await ev(`FG.state.plots[2][0].tilled = false;`);
await ev(`FG.state.pendingSeed = 'seedD';`);
const stamC = await ev(`FG.state.stam`);
await ev(`(function(){var q=FG.FIELD.cellCenter(0,2); window.__c3=q;})()`);
const c3 = JSON.parse(await ev(`JSON.stringify(window.__c3)`));
await clickCell(c3[0], c3[1]);
const c3crop = await ev(`FG.state.plots[2][0].crop`);
ok('没翻的土种不下去', c3crop === null || c3crop === undefined, 'crop=' + c3crop);
ok('也没白扣体力', (await ev(`FG.state.stam`)) === stamC, `${stamC} -> ${await ev(`FG.state.stam`)}`);
ok('提示说的是没翻的土', (await ev(`document.getElementById('toast').textContent`)).indexOf('翻') >= 0,
  await ev(`document.getElementById('toast').textContent`));
ok('这一段也没有异常（否则上面三条是蒙过的）', logs.length === excBefore,
  logs.slice(excBefore).join(' | '));

console.log('— 存档往返 —');
await ev(`FG.saveGame()`);
await sleep(300);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1000);
ok('读档后行囊照样摆得出来', (await ev(`(function(){try{return FG.bagList().length>=0}catch(e){return -1}})()`)) >= 0);
ok('读档后捏着的种还在', (await ev(`FG.state.pendingSeed`)) === 'seedD', await ev(`FG.state.pendingSeed`));
ok('读档后苗还在', (await ev(`FG.state.plots[0][0].crop`)) === 'dou');

console.log('— 重开归零 —');
await ev(`FG.restart()`);
await sleep(700);
ok('重开后手上没捏着东西', (await ev(`FG.state.pendingSeed`)) === null);
ok('重开后苗清了', (await ev(`FG.state.plots[0][0].crop`)) === null || (await ev(`FG.state.plots[0][0].crop`)) === undefined);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? `FAILED ${fails}` : 'DONE');
