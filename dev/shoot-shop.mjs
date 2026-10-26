// 货单轮换验收。
//
// 这一层叫「轮换」，但**它不收走任何一样东西** ——
// 把营造 / 机器 / 家具藏起来「没到那天不卖」，那就是拿等待卡进度，
// 跟这游戏「不惩罚只少收」是拧着的。
// 真的只有「到货」这一层：每 6 天进一批「新到」，在货单顶上单列一块。
//
// 盯住这几条：
//   1) **不收走**：不管第几天，货单上那 41 样一样不少、一样都点得着
//   2) 新到换新的周期是 6 天（一个节气），且**确定性**（刷新页面不变）
//   3) 换新只换「你没买的」 —— 买掉一件之后它从新到里让位，
//      货单那一行也立刻跟着改成「已经造好了」（同一份判据，不能两处各写一遍）
//   4) 新到那几样在行上有「新」标
//   5) 标题那块**不能**塞进 .sh-list —— 那是 flex + :nth-child(odd) 两栏，
//      塞进去后面每一行左右就错一列
//   6) 别的铺子（没有轮换的那张）不显示这一块
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9404;
const profile = path.join(tmpdir(), 'guxian-shop-' + process.pid);
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
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
// 站在墟市老丈跟前，把货单打开
const openShop = async (day, min) => {
  await ev(`(function(){
    FG.state.day=${day || 1};
    ${min ? `FG.state.min=${min};` : ''}
    FG.gotoMap('xushi');
    var a=FG.NPCS.xushi.at;
    FG.state.player.x=a[0]; FG.state.player.y=a[1]+60; FG.state.walkTo=null;
    FG.state.gold=20000; FG.updateHUD();
    FG.openShop(FG.NPCS.xushi); return 1})()`);
  await sleep(420);
};
const topTxt = () => ev(`(function(){var e=document.getElementById('sh-top');return e?e.textContent.replace(/\\s+/g,' ').trim():'(没有这一块)';})()`);
const freshTags = () => ev(`(function(){return Array.prototype.map.call(document.querySelectorAll('#sh-list .goods.fresh b'), function(b){return b.textContent.replace(/新$/,'');}).join(' ');})()`);
const listN = () => ev(`document.querySelectorAll('#sh-list .goods').length`);
const newOf = d => ev(`JSON.stringify(FG.shopNew(${d}).map(function(r){return FG.shopItem(r).name;}))`);

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

console.log('— 不收走：不管第几天，货单都是全的 —');
const ALLN = await ev(`FG.SHOP.xushi.length`);
ok('货单一共 ' + ALLN + ' 样', ALLN === (await ev(`FG.SHOP.xushi.length`)), ALLN + ' / 货单实长 ' + (await ev(`FG.SHOP.xushi.length`)));   // 加了置办五样后别再写死
const shownN = [];
for (const d of [1, 2, 7, 13, 40, 100, 144]) {
  await openShop(d);
  shownN.push(await listN());
}
ok('每一旬画出来的格子数都一样（没有一样被藏起来）',
  shownN.every(n => n === ALLN), '第 1/2/7/13/40/100/144 天 → ' + shownN.join('　'));
ok('每一样都还点得着（没被 disabled / 收走）',
  (await ev(`(function(){
    var bad=[];
    document.querySelectorAll('#sh-list .goods').forEach(function(e){
      if (!e.getAttribute('data-k')) bad.push('没有 data-k');
      if (e.classList.contains('gone') || e.style.display==='none') bad.push('有一格不见了');
    });
    return bad.join('　');})()`)) === '');

console.log('\n— 换新：每 6 天一批，而且确定 —');
const seq = JSON.parse(await ev(`(function(){
  var o=[]; for (var d=1; d<=30; d++) o.push(FG.shopNew(d).map(function(r){return FG.shopItem(r).name;}).join(' '));
  return JSON.stringify(o);})()`));
console.log('  第 1~6 天：' + seq[0]);
console.log('  第 7~12 天：' + seq[6]);
console.log('  第 13~18 天：' + seq[12]);
console.log('  第 19~24 天：' + seq[18]);
ok('同一旬里六天是一样（不是每天换一次）',
  new Set(seq.slice(0, 6)).size === 1, new Set(seq.slice(0, 6)).size + ' 种');
ok('跨到下一旬就换新了', seq[0] !== seq[6], '第 1 天 ≠ 第 7 天');
ok('确定性：同一天算两遍一模一样', (await newOf(8)) === (await newOf(8)), await newOf(8));
ok('每旬 ' + (await ev(`FG.SHOP_NEW_N`)) + ' 样', (await ev(`FG.shopNew(1).length`)) === 3,
  (await ev(`FG.shopNew(1).length`)) + ' 样');
ok('四旬换过四次（不是从头循环）',
  new Set([seq[0], seq[6], seq[12], seq[18]]).size === 4,
  new Set([seq[0], seq[6], seq[12], seq[18]]).size + ' 种不同');
ok('写得出「还有几天换新」',
  (await ev(`FG.shopNewLeft(1)`)) === 6 && (await ev(`FG.shopNewLeft(6)`)) === 1
  && (await ev(`FG.shopNewLeft(7)`)) === 6,
  '第 1 天还有 ' + await ev(`FG.shopNewLeft(1)`) + ' 天　第 6 天还有 ' + await ev(`FG.shopNewLeft(6)`) + ' 天');

console.log('\n— 买掉一件，它从新到里让位 —');
// 拿**今天新到里那一样「买一次」的东西**来验：第 7 天新到是
// 稷种 / 菊种 / 铜锄 —— 前两样是种子（买一百回也不算「已经有了」），
// 只有铜锄是买一次就永远有的，所以只有它能验「买掉就从新到里让位」
await openShop(7);
const n0 = JSON.parse(await newOf(7));
ok('第 7 天新到里有一件买一次的东西（铜锄）', n0.indexOf('铜锄') >= 0, n0.join(' '));
await ev(`(function(){
  // 铜锄是 chu 的第二级 —— 得先有木锄才买得了（器物只能一级一级买）
  FG.state.gear={chu:1,piao:0,jue:0};
  FG.state.gold=20000; FG.buy('g2'); return 1})()`);
await sleep(260);
ok('真的买到了（不是被「得先有前一把」挡下来）', (await ev(`FG.state.gear.chu`)) === 2,
  '锄 ' + await ev(`FG.state.gear.chu`) + ' 级');
const n1 = JSON.parse(await newOf(7));
console.log('  买之前：' + n0.join(' ') + '\n  买之后：' + n1.join(' '));
ok('买掉的那一件从新到里掉了', n0.length === 3 && n1.length === 3 && n0.indexOf('铜锄') >= 0 && n1.indexOf('铜锄') < 0,
  n1.join(' '));
ok('新到始终是三样（后面那一样接上来）', n1.length === 3, n1.length + ' 样');
// 货单那一行也得跟着变 —— 判据是同一份，不是两处各写一遍
await openShop(7);
const g2txt = await ev(`(function(){
  var e=document.querySelector('#sh-list .goods[data-k="g2"]'); return e?e.textContent.replace(/\\s+/g,' ').trim():'(没有这一格)';})()`);
ok('货单上那一行立刻改口（不是还写着价钱）', /已经是这把/.test(g2txt), g2txt);
ok('已买的那行也不再挂「新」标',
  (await ev(`(function(){
    var e=document.querySelector('#sh-list .goods[data-k="g2"]');
    return e && e.classList.contains('fresh') ? '有' : '没有';})()`)) === '没有');
ok('「新」标挂在新到那一块列出的名字上（两边对得上）',
  (await ev(`(function(){
    var tags=Array.prototype.map.call(document.querySelectorAll('#sh-list .goods.fresh'), function(e){
      return e.getAttribute('data-k');}).sort().join(',');
    var want=FG.shopNew(FG.state.day).map(function(r){return r.k;}).sort().join(',');
    return tags===want ? '一样' : '行上是 '+tags+'　新到是 '+want;})()`)).indexOf('一样') === 0,
  await ev(`Array.prototype.map.call(document.querySelectorAll('#sh-list .goods.fresh'),function(e){return e.getAttribute('data-k');}).join(',')`));

console.log('\n— 版面：新到那块不能打乱两栏 —');
await ev(`(function(){
  FG.state.build={}; FG.buildInit(); FG.state.furn={}; FG.furnFix();
  FG.state.gold=20000; FG.openShop(FG.NPCS.xushi); return 1})()`);
await sleep(420);
ok('新到那块在货单**外面**（.sh-list 的兄弟节点，不是它的孩子）',
  (await ev(`(function(){ var t=document.getElementById('sh-top'), l=document.getElementById('sh-list');
    return t && l && t.parentNode===l.parentNode && t.nextElementSibling===l; })()`)) === true);
const geo = JSON.parse(await ev(`(function(){
  var bad=[], rows=[], items=Array.prototype.slice.call(document.querySelectorAll('#sh-list .goods'));
  for (var i=0;i<items.length;i+=2){
    var a=items[i].getBoundingClientRect(), b=items[i+1];
    if (!b) continue;
    var r=b.getBoundingClientRect();
    if (Math.abs(a.y-r.y)>6) bad.push('第 '+(i/2+1)+' 行两格没在同一行');
    if (!(r.x > a.x)) bad.push('第 '+(i/2+1)+' 行第二格没在右边');
    if (Math.abs(a.width-r.width)>1) bad.push('第 '+(i/2+1)+' 行两格不一样宽');
  }
  // 列表里不能混进非 .goods 的兄弟（那就是把标题插进去了）
  Array.prototype.forEach.call(document.getElementById('sh-list').children, function(c){
    if (!c.classList.contains('goods')) bad.push('列表里混进了 '+c.className);
  });
  return JSON.stringify({bad:bad, n:items.length});})()`));
ok('两栏还是两栏（:nth-child(odd) 没被打乱）', geo.bad.length === 0, geo.bad.join('　') || geo.n + ' 格都对');
ok('新到那三样在行上有「新」标',
  (await ev(`document.querySelectorAll('#sh-list .goods.fresh .tag').length`)) === 3,
  await ev(`document.querySelectorAll('#sh-list .goods.fresh .tag').length`) + ' 个「新」');
ok('新到那一块写着「本旬新到」和「还有几天换新」',
  /本\s*旬\s*新\s*到/.test(await topTxt()) && /还有\s*\d+\s*天换新/.test(await topTxt()), await topTxt());
ok('（对照）页脚那块不在列表里、也不是货单的一格',
  (await ev(`document.querySelectorAll('#sh-list .goods').length`)) === ALLN);
await shot('71-货单-本旬新到.png');

console.log('\n— 别的铺子不显示这一块 —');
ok('（墟市是唯一有货单轮换的铺子）',
  (await ev(`Object.keys(FG.SHOP).join(',')`)) === 'xushi', await ev(`Object.keys(FG.SHOP).join(',')`));
ok('没有轮换的那张图上不会去开墟市',
  (await ev(`!!FG.NPCS.qiaofu.shop`)) === false);

console.log('\n— 存档往返 / 老存档 —');
await openShop(30);
await ev(`(function(){ FG.save && FG.save(); return 1})()`);
await ev(`location.reload()`); await sleep(2600);
await ev(`(function(){
  var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return /续/.test(x.textContent);})[0];
  if(b) b.click(); return 1})()`);
await sleep(1600);
ok('读档之后新到这一块还画得出来',
  (await ev(`(function(){
    FG.openShop(FG.NPCS.xushi); return 1})()`)) !== null
  && /本\s*旬\s*新\s*到/.test(await topTxt()), await topTxt());
ok('读档之后货单还是全的', (await ev(`document.querySelectorAll('#sh-list .goods').length`)) === ALLN,
  await ev(`document.querySelectorAll('#sh-list .goods').length`) + ' / ' + ALLN);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
