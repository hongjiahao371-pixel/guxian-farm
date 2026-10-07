// 品质（品级）验收。
//
// 读法先说清楚，因为这一项有个容易搞错的地方：
// **不是「每一件东西有好坏」，是「出货箱这一箱按哪一档折钱」**。
// 逐件品质要给行囊换一套账（件数 + 档次两份）—— 那是动这个游戏最底下的
// 数据结构，这里不做。记在箱子上反而更像真的：
// **这一箱是你第几级的手艺装进去的**。早出手是低档、多跑一趟；
// 等耕的手艺上去了再出手是高档。是个真取舍。
//
// 盯住这几条：
//   1) 判据只有两个来源：耕的手艺、温窒二级。**没有随机数** ——
//      这游戏从头到尾一条伪随机，品质要是随机的就等于凭空多一个运气
//   2) 装箱的那一刻记档，之后手艺涨了**不追认**（东西装进去就定了）
//   3) 箱子清空后档也清掉，下一箱重新记
//   4) 折钱确实按 ×1 / ×1.8 / ×3，结算面板上写得出是哪一档、为什么
//   5) 存档往返 / 老档没有这一项 / 越界
//   6) 温窒二级兑现的就是品级 —— 那是它第二个存在的理由
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9382;
const profile = path.join(tmpdir(), 'guxian-q-' + process.pid);
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
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
const toast = () => ev(`document.getElementById('toast').textContent`);
const binSum = () => ev(`document.getElementById('bx-sum').textContent`);
// 把耕的手艺直接摆到某一级。手艺那一本是 S.skill[门] = {lv, pt}，
// **不是 S.skill.lv[门]** —— 写成后者 skillInit 摆出来的是 {},
// 于是 FG.state.skill.lv 是 undefined，赋 .geng 当场炸
const setGeng = lv => ev(`(function(){ FG.skillFix(); FG.state.skill.geng={lv:${lv}, pt:0};
  FG.updateHUD(); return FG.qualityNow(); })()`);
// 往箱里放 n 份某样
const put = (k, n) => ev(`(function(){ for (var i=0;i<${n};i++) FG.binMove('${k}', true, false);
  return FG.binWorth(); })()`);
const douSell = async () => ev(`FG.BAG_IDX.crop_dou.sell`);

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

console.log('— 表：三档，一档比一档高 —');
const Q = JSON.parse(await ev(`JSON.stringify(FG.QUALITY)`));
console.log('  ' + Q.map(q => q.n + ' ×' + q.x + '（' + q.need + '）').join('　'));
ok('三档', Q.length === 3, Q.length + ' 档');
ok('价钱一档比一档高', Q[0].x < Q[1].x && Q[1].x < Q[2].x, Q.map(q => q.x).join(' < '));
ok('每一档都写了「要什么才到」和「到了是什么样」',
  Q.every(q => q.need && q.n && q.note && q.note.length > 6), Q.map(q => q.need).join('　'));
ok('三档里没有随机** —— 这游戏从头到尾一条伪随机',
  (await ev(`FG.QUALITY.filter(function(q){return /随机|几率|概率/.test(q.n+q.need+q.note);}).length`)) === 0);
ok('品级记在**箱上**，不是逐件 —— 行囊一件东西只存一个份数',
  (await ev(`typeof FG.state.binQ`)) === 'number', 'S.binQ=' + await ev(`FG.state.binQ`));

console.log('— 开局：耕 1 级、本色 —');
ok('耕 1 级是本色', (await setGeng(1)) === 0, '×' + Q[0].x);
await ev(`(function(){ for (var k in FG.state.bag) delete FG.state.bag[k];
  FG.state.bag.dou=4; FG.updateHUD(); return 1})()`);
ok('箱是空的，档记着 0', (await ev(`FG.binQ()`)) === 0);
ok('放四份豆进去，箱还是本色', (await put('crop_dou', 4)) === 4 * await douSell(),
  '箱折 ' + await ev(`FG.binWorth()`) + ' / 原价 ' + 4 * await douSell());
ok('箱上记的档是 0', (await ev(`FG.binQ()`)) === 0);

console.log('— 耕 3 级：好品 —');
await ev(`(function(){ for (var k in FG.state.bin) delete FG.state.bin[k];
  FG.state.binQ=0; return 1})()`);
ok('耕 3 级判据是好品', (await setGeng(3)) === 1, '×' + Q[1].x);
await ev(`(function(){ for (var k in FG.state.bag) delete FG.state.bag[k];
  FG.state.bag.dou=4; FG.updateHUD(); return 1})()`);
ok('放进去，这一箱记成好品', (await put('crop_dou', 4)) === Math.round(4 * await douSell() * Q[1].x),
  '箱折 ' + await ev(`FG.binWorth()`) + ' / 原价 ' + 4 * await douSell());
ok('箱上记的档是 1', (await ev(`FG.binQ()`)) === 1);
ok('面板上写得出是哪一档、为什么、现在放进去是哪一档',
  /好 品/.test(await binSum()) && /耕的手艺 3 级/.test(await binSum()), await binSum());

console.log('— 装箱之后再涨手艺：不追认 —');
ok('耕到 6 级，现在能做上品了', (await setGeng(6)) === 2, '×' + Q[2].x);
ok('但已经装好的那一箱还是好品', (await ev(`FG.binQ()`)) === 1);
ok('折钱也还是按好品那一档', (await ev(`FG.binWorth()`)) === Math.round(4 * await douSell() * Q[1].x),
  '箱折 ' + await ev(`FG.binWorth()`));
// 把东西取回来，箱空了，再放一次 —— 这时候记的是新品级
await ev(`(function(){ for (var i=0;i<4;i++) FG.binMove('crop_dou', false, false); return 1})()`);
ok('箱一空，档就跟着清了', (await ev(`Object.keys(FG.state.bin).length`)) === 0);
ok('放回同样四份豆，这回记的是上品',
  (await put('crop_dou', 4)) === Math.round(4 * await douSell() * Q[2].x),
  '箱折 ' + await ev(`FG.binWorth()`) + '（上品 ×' + Q[2].x + '）');
ok('箱上记的档是 2', (await ev(`FG.binQ()`)) === 2);

console.log('— 一个箱子里不重记档 —');
// 清行囊之前**先看要摆什么**：清完再放一样，前一步 put 拿的是 0 份、静悄悄地
// 什么都没放进去，于是下一步「箱是空的」判错，档也就重记了一次
await ev(`(function(){ for (var k in FG.state.bin) delete FG.state.bin[k];
  FG.state.binQ=0; FG.state.skill.geng={lv:1,pt:0}; FG.skillFix();
  for (var b in FG.state.bag) delete FG.state.bag[b];
  FG.state.bag.dou=1; FG.state.bag.ji=1; FG.updateHUD(); return 1})()`);
ok('耕退回 1 级', (await ev(`FG.qualityNow()`)) === 0);
await put('crop_dou', 1);
ok('先放一份豆（记本色）', (await ev(`FG.binQ()`)) === 0 && (await ev(`Object.keys(FG.state.bin).length`)) === 1,
  '箱里 ' + await ev(`Object.keys(FG.state.bin).length`) + ' 样，档 ' + await ev(`FG.binQ()`));
await setGeng(6);
await put('crop_ji', 1);
ok('手艺涨到能出上品了，再放一份稷', (await ev(`FG.qualityNow()`)) === 2);
ok('但这一箱仍然是本色（装进去的时候就定了）', (await ev(`FG.binQ()`)) === 0,
  '箱记 ' + await ev(`FG.binQ()`) + '，现在能做 ' + await ev(`FG.qualityNow()`));
ok('整箱都按本色折', (await ev(`FG.binWorth()`))
  === Math.round(await douSell() + await ev(`FG.BAG_IDX.crop_ji.sell`)),
  '箱折 ' + await ev(`FG.binWorth()`) + '（本色，两样合起来）');

console.log('— 温窒二级：品级就是它第二个存在的理由 —');
await ev(`(function(){
  for (var k in FG.state.bin) delete FG.state.bin[k];
  FG.state.binQ=0; FG.state.build.warm=0; FG.buildFix();
  FG.state.skill.geng={lv:1,pt:0}; FG.skillFix(); return 1})()`);
ok('温窒一级不给品级（耕 1 级还是本色）', (await ev(`FG.qualityNow()`)) === 0);
await ev(`(function(){ FG.state.build.warm=1; FG.buildFix(); return 1})()`);
ok('温窒一级也不给品级', (await ev(`FG.qualityNow()`)) === 0);
await ev(`(function(){ FG.state.build.warm=2; FG.buildFix(); return 1})()`);
ok('温窒二级 +1 档，成好品', (await ev(`FG.qualityNow()`)) === 1, '×' + Q[1].x);
await ev(`(function(){ FG.state.build.warm=1; FG.buildFix(); return 1})()`);
ok('降回一级就又变本色（那一级给的是品级，不是一并给的）', (await ev(`FG.qualityNow()`)) === 0);
ok('三样凑齐时封顶在最高那一档，不越界',
  (await setGeng(10)) >= 0 && (await ev(`(function(){
    FG.state.build.warm=2; FG.buildFix(); return FG.qualityNow(); })()`)) === 2,
  '耕 10 + 温窒 2 = ' + await ev(`(function(){
    FG.state.build.warm=2; FG.buildFix(); return FG.qualityNow(); })()`));

console.log('— 天黑结算：按箱上那一档折 —');
await ev(`(function(){
  for (var k in FG.state.bin) delete FG.state.bin[k];
  FG.state.binQ=0; FG.state.build.warm=0; FG.buildFix();
  FG.state.skill.geng={lv:6,pt:0}; FG.skillFix();
  for (var k2 in FG.state.bag) delete FG.state.bag[k2];
  FG.state.bag.dou=4; FG.state.gold=1000; FG.updateHUD(); return 1})()`);
const plain = 4 * await douSell();
await put('crop_dou', 4);
const gA = await ev(`FG.state.gold`);
await ev(`(function(){ document.getElementById('bx-x').click(); return 1})()`);
await ev(`(function(){
  FG.gotoMap('nanshan'); var h=FG.MAPS.nanshan.home;
  FG.state.player.x=h[0]; FG.state.player.y=h[1]; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(350);
// 归家走屋里「床」那一行（20/2 之后）
await ev(`(function(){ FG.openHouse(); return 1})()`);
await sleep(300);
await ev(`(function(){ var g=document.querySelector('#hs-list .hsr[data-k="bed"]'); if(g) g.click(); return 1; })()`);
await sleep(700);
ok('结算面板弹了', (await ev(`!document.getElementById('de').classList.contains('hide')`)) === true);
const deTxt = await ev(`document.getElementById('de').textContent.replace(/\\s+/g,' ').trim()`);
ok('按上品折的钱（原价 ×3）', (await ev(`FG.state.gold`)) === 1000 + Math.round(plain * Q[2].x),
  1000 + ' + ' + Math.round(plain * Q[2].x) + ' = ' + await ev(`FG.state.gold`) + '（原价 ' + plain + '）');
ok('结算里写明了这一箱是上品、因为什么',
  /上 品/.test(deTxt) && /耕的手艺 6 级/.test(deTxt), deTxt.slice(0, 120));
ok('箱子清空了', (await ev(`Object.keys(FG.state.bin).length`)) === 0);
ok('档也跟着清了（下一箱重新记）', (await ev(`FG.state.binQ`)) === 0, 'binQ=' + await ev(`FG.state.binQ`));

console.log('— 存档往返 —');
await ev(`(function(){
  FG.state.bin={crop_dou:3}; FG.state.binQ=2; FG.saveGame(); return 1})()`);
await sleep(300);
const sa = await ev(`JSON.stringify({q:FG.binQ(), w:FG.binWorth()})`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
const sb = await ev(`JSON.stringify({q:FG.binQ(), w:FG.binWorth()})`);
ok('读档回来档和折钱原样', sa === sb, sa + ' / ' + sb);

console.log('— 老档没有这一项 / 越界 / 重开 —');
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
  delete raw.binQ; localStorage.setItem(${JSON.stringify(SAVEKEY)}, JSON.stringify(raw)); return 1})()`);
const logMark = logs.length;
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
ok('老档补回来的是 0（本色），不是 undefined',
  (await ev(`FG.state.binQ`)) === 0 && (await ev(`FG.binQ()`)) === 0, 'binQ=' + await ev(`FG.state.binQ`));
ok('这一段没有异常', logs.length === logMark, logs.slice(logMark).join(' | ') || '干净');
await ev(`(function(){ FG.state.binQ=7; return 1})()`);
ok('存档被改成越界档时按本色算', (await ev(`FG.binQ()`)) === 0, 'binQ 被读成 ' + await ev(`FG.binQ()`));
await ev(`FG.restart()`);
await sleep(900);
ok('重开后档归零', (await ev(`FG.state.binQ`)) === 0);

console.log('— 画面：出货箱面板上写不写得出档次 —');
await ev(`(function(){
  FG.state.skill.geng={lv:6,pt:0}; FG.skillFix();
  FG.state.build.warm=0; FG.buildFix();
  for (var k in FG.state.bag) delete FG.state.bag[k];
  FG.state.bag.dou=4; FG.state.bin={}; FG.state.binQ=0; FG.updateHUD();
  for (var i=0;i<4;i++) FG.binMove('crop_dou', true, false);
  FG.openBin(); return 1})()`);
await sleep(400);
ok('出货箱开着', (await ev(`FG.binOpen()`)) === true);
ok('那一行写着「这一箱记着 上品」', /记着 上 品/.test(await binSum()), await binSum());
// 箱里每一项也得写折后的钱。写原价、合计写折后的，
// 玩家看到「4 份豆 136 钱」而底下合计 408，会以为面板算错了
const rowsTxt = await ev(`(function(){
  return [].map.call(document.querySelectorAll('#bx-bin .bxl'), function(e){ return e.textContent; }).join('　');
})()`);
ok('箱里每一项写的是折后的钱（和合计对得上）',
  /408 钱/.test(rowsTxt), rowsTxt.replace(/\s+/g, ' '));
await shot('59-出货箱-上品.png');
ok('截了一张', true);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
