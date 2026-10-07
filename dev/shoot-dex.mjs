// 图鉴（「见闻」那一页）验收。
//
// 它跟诗册是同一副面板的第四页，所以这一套盯的不是「面板开不开得起来」，
// 是几件容易静悄悄错掉的事：
//   1) **名单从 FISH / GOODS / ORE 三张表里读**，不抄一份在别处
//      （抄一份的话，加了味忘了回来加，症状是「钓上来一条图鉴上没这一味」）
//   2) 四个记口都接上了：钓 / 采 / 敲 / 狗叼
//   3) **出货箱来回搬不记** —— 挂 invGive 的话搬一次刷一次，
//      而「放进箱子再拿回来」不是「你见到了它」
//   4) 没见过的味**不排出来**（排一屏「未遇 XXX」就是待办清单）
//   5) 跨年留着：翻年只清 S.book，不清 S.dex
//   6) 老存档没有这一本账也能补出空的
//   7) 组标题不能打乱 .al-list 的两栏（flex + :nth-child(odd)）
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9401;
const profile = path.join(tmpdir(), 'guxian-dex-' + process.pid);
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
const html = () => ev(`document.getElementById('al-list').innerHTML`);

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

console.log('— 名单是从三张表里读的 —');
const D = JSON.parse(await ev(`JSON.stringify(FG.DEX)`));
const T = JSON.parse(await ev(`JSON.stringify({
  fish: Object.keys(FG.FISH).length, good: Object.keys(FG.GOODS).length, ore: Object.keys(FG.ORE).length })`));
const SRC = JSON.parse(await ev(`JSON.stringify((function(){
  var o=[]; for (var i=0;i<FG.DEX.length;i++){ var g=FG.DEX[i];
    o.push([g.cat, g.src, typeof FG[g.src], Object.keys(FG[g.src]||{}).length]); } return o;})())`));
console.log('  ' + D.map(g => g.label + ' ' + g.cat + ' ← FG.' + g.src).join('　'));
ok('三路都指得着真的表', SRC.every(r => r[2] === 'object' && r[3] > 0), JSON.stringify(SRC));
ok('三路的表都不是空的', T.fish > 0 && T.good > 0 && T.ore > 0, JSON.stringify(T));
const ALL = T.fish + T.good + T.ore;
ok('一共 ' + ALL + ' 种', ALL > 10, ALL + ' 种');
// 每一路都得在 BAG 里排得出图标来（不然那一行画不出东西）
ok('三路的每一味都在行囊里排得出图标', (await ev(`(function(){
  var bad=[];
  for (var i=0;i<FG.DEX.length;i++){ var g=FG.DEX[i], t=FG[g.src];
    for (var k in t) if(!FG.BAG_IDX[(g.cat==='ore'?'ore_':g.cat==='fish'?'fish_':'good_')+k]) bad.push(g.cat+':'+k);
  }
  return bad.join('　');})()`)) === '');

console.log('\n— 开局是空的，但得说清楚从哪儿来 —');
await ev(`FG.openAlbum()`); await sleep(300);
await ev(`document.querySelector('#al-tabs [data-p="seen"]').click()`);
await sleep(300);
ok('抬头跟着页走', (await ev(`document.getElementById('al-name').textContent`)) === '见 闻',
  await ev(`document.getElementById('al-name').textContent`));
ok('页签上带着「见过几种」', /\d/.test(await ev(`document.querySelector('#al-tabs [data-p="seen"]').textContent`)),
  await ev(`document.querySelector('#al-tabs [data-p="seen"]').textContent`));
let h = await html();
ok('空的（一样都没遇上）', /al-empty/.test(h), h.replace(/<[^>]+>/g, ' ').trim().slice(0, 60));
ok('空的时候也回一句话，不静悄悄', /抛竿/.test(h), h.replace(/<[^>]+>/g, ' ').trim().slice(0, 60));
ok('空的时候不排「未遇 XXX」', !/未遇/.test(h));
ok('页脚还写着总数（不是待办）', /山里一共\s*\d+\s*种/.test(h.replace(/\s+/g, ' ')),
  (h.match(/<div class="al-foot">[\s\S]*?<\/div>/) || [''])[0].replace(/<[^>]+>/g, ''));

console.log('\n— 四个记口都接上了 —');
// 1) 钓
const fishId = await ev(`Object.keys(FG.FISH)[0]`);
await ev(`(function(){ FG.state.day=20; FG.dexFix(); FG.state.pouch[${JSON.stringify(fishId)}]=1; FG.dexAdd('fish',${JSON.stringify(fishId)}); return 1})()`);
ok('钓上来一种 → 记上', (await ev(`JSON.stringify(FG.state.dex.fish)`)) === JSON.stringify({ [fishId]: { n: 1, first: 20 } }),
  await ev(`JSON.stringify(FG.state.dex.fish)`));
// 2) 采
const goodId = await ev(`Object.keys(FG.GOODS)[0]`);
await ev(`(function(){ FG.state.day=25; FG.dexAdd('good','${goodId}'); return 1})()`);
ok('采到一种 → 记上', (await ev(`FG.state.dex.good.${goodId}.n`)) === 1, await ev(`FG.state.dex.good.${goodId}.n`));
// 3) 敲
const oreId = await ev(`Object.keys(FG.ORE)[0]`);
await ev(`(function(){ FG.state.day=30; FG.dexAdd('ore','${oreId}'); return 1})()`);
ok('敲开一种 → 记上', (await ev(`FG.state.dex.ore.${oreId}.n`)) === 1, await ev(`FG.state.dex.ore.${oreId}.n`));
// 4) 狗（这一味采过一次了，n 应该是 2 —— 狗送来的也算「认出了它」）
await ev(`(function(){ FG.state.build.gou=1; FG.buildFix();
  FG.state.dog={day:0,n:2,k:'${goodId}'}; FG.dogFix();
  FG.state.day=33; FG.dexAdd('good','${goodId}'); return 1})()`);
ok('狗叼回来的那一种也算「认出了它」（n 从 1 涨到 2）', (await ev(`FG.state.dex.good.${goodId}.n`)) === 2,
  await ev(`FG.state.dex.good.${goodId}.n`));
ok('头一回的日子不因为狗而挪到第 33 天', (await ev(`FG.state.dex.good.${goodId}.first`)) === 25,
  'first=' + await ev(`FG.state.dex.good.${goodId}.first`));

console.log('\n— 进出货箱不记 —');
const before = await ev(`FG.dexCount('good')`);
const mv = await ev(`(function(){
  var k='${goodId}';
  FG.state.pouch[k]=5; FG.state.bin={};
  var log=[];
  FG.binMove('good_'+k,1); log.push('放进去 箱='+JSON.stringify(FG.state.bin)+' 手上='+FG.state.pouch[k]);
  FG.binMove('good_'+k,0); log.push('拿回来 箱='+JSON.stringify(FG.state.bin)+' 手上='+FG.state.pouch[k]);
  FG.binMove('good_'+k,1); FG.binMove('good_'+k,0);
  return log.join(' ｜ ');})()`);
console.log('  ' + mv);
ok('（东西是真的搬动了：5 份在箱里那一步读得到）', /放进去 箱=\{[^}]+\} 手上=4/.test(mv), mv);
ok('箱里来回搬了三趟，见闻没多', (await ev(`FG.dexCount('good')`)) === before,
  'before=' + before + ' after=' + await ev(`FG.dexCount('good')`));

console.log('\n— 认过的都排出来，没认的不排 —');
await ev(`(function(){
  var i, d=FG.DEX;
  FG.state.dex={good:{},fish:{},ore:{}};
  FG.state.day=7;
  // 只认一半：溪上全认，山中认三样，石里一样
  for (i in FG.FISH) FG.dexAdd('fish', i);
  var g=Object.keys(FG.GOODS); for (i=0;i<3;i++) FG.dexAdd('good', g[i]);
  var o=Object.keys(FG.ORE); FG.dexAdd('ore', o[0]);
  return 1})()`);
await ev(`FG.openAlbum(); FG.setAlPage('seen')`); await sleep(320);
h = await html();
const nf = await ev(`Object.keys(FG.FISH).length`);
ok('认过的都排出来了（溪上 ' + nf + ' 种）', (h.match(/dx-i/g) || []).length === nf + 3 + 1,
  (h.match(/dx-i/g) || []).length + ' 行');
ok('没认过的一个名字都没露', true);
const unMet = JSON.parse(await ev(`(function(){
  var out=[];
  for (var i=0;i<FG.DEX.length;i++){ var g=FG.DEX[i], t=FG[g.src];
    for (var k in t) if (!FG.state.dex[g.cat][k]) out.push(t[k].name); }
  return JSON.stringify(out);})()`));
const leak = unMet.filter(n => h.indexOf(n) >= 0);
ok('没见过的 ' + unMet.length + ' 种，一个名字都没漏进画面', leak.length === 0, leak.join('　') || '(一个都没有)');
ok('不排「未遇」', !/未遇/.test(h));
ok('每一路都带组标题', (h.match(/dx-h/g) || []).length === 3,
  h.replace(/<[^>]+>/g, '|').match(/溪[^|]*上/)?.[0] || '');
ok('写得出「见过几回」和「头一回第几天」', /见过\s*\d+\s*回/.test(h) && /头一回第\s*\d+\s*年第\s*\d+\s*天/.test(h));
ok('引的是表里自己写的 desc（鱼/山货的出处是「——」，不冒充古人）',
  !/《[^》]*》/.test(h.replace(/<[^>]+>/g, ' ')), '');
const flat = h.replace(/\s+/g, ' ');
ok('页脚三路分列都对',
  flat.indexOf('溪上 ' + nf) > 0 && flat.indexOf('山中 3') > 0 && flat.indexOf('石里 1') > 0,
  (h.match(/<div class="al-foot">[\s\S]*?<\/div>/) || [''])[0].replace(/<[^>]+>/g, ''));

console.log('\n— 组标题不能打乱两栏 —');
// .al-item 的左右是 :nth-child(odd) 给 margin-right 定的，
// 组标题要是直接塞进 .al-list，后面每一行的奇偶就整体错一位 ——
// 版面上看得出来的是「左栏右边和右栏左边粘在一起 / 两栏宽度不一样」。
// 所以量的是**几何**：同一行里第 1、3…项该贴左边，第 2、4…项该贴右边。
const geo = JSON.parse(await ev(`(function(){
  var rows=document.querySelectorAll('#al-list .dx-row');
  var mis=[], widths=[], heights=[];
  for (var i=0;i<rows.length;i++){
    var r=rows[i], rr=r.getBoundingClientRect();
    var it=[].filter.call(r.children, function(c){return c.classList.contains('al-item');});
    var mid=rr.x + rr.width/2, nL=0, nR=0;
    for (var j=0;j<it.length;j++){
      var b=it[j].getBoundingClientRect();
      var isLeft = (b.x + b.width/2) < mid;
      if (isLeft) nL++; else nR++;
      if ((j%2===0) !== isLeft) mis.push('第 '+(i+1)+' 路第 '+(j+1)+' 项该在'+(j%2===0?'左':'右')+'边');
      widths.push(Math.round(b.width));
    }
    // 两栏高度得一样（不然右栏那格比左栏矮/高）
    if (it.length>=2) heights.push(Math.round(it[0].getBoundingClientRect().height)+'/'+Math.round(it[1].getBoundingClientRect().height));
  }
  return JSON.stringify({mis:mis, widths:widths, heights:heights, rows:rows.length,
    listW: Math.round(document.getElementById('al-list').getBoundingClientRect().width)});
})()`));
console.log('  每项宽 ' + geo.widths[0] + '　列表宽 ' + geo.listW + '　前两行高 ' + geo.heights.join(' '));
ok('左右两栏真的分开了（:nth-child(odd) 没被组标题打乱）', geo.mis.length === 0, geo.mis.join('　') || '三路都对');
ok('两栏等宽（不是挤成一小条）', geo.widths.every(w => w > geo.listW * 0.4), geo.widths[0] + ' vs 列表 ' + geo.listW);

console.log('\n— 跨年留着 / 老存档能补 —');
// 翻年那一支只调 bookInit() 清本年账。真正要验的是：
// **清本年账的时候没顺手把见闻清了** —— 它是跟着诗册那一挂的
await ev(`(function(){ FG.state.book.fish=Object.keys(FG.FISH).reduce(function(a,k){a[k]=3;return a;},{}); return 1})()`);
const preYear = await ev(`FG.dexCount('fish') + FG.dexCount('good') + FG.dexCount('ore')`);
await ev(`(function(){ FG.state.day=1; FG.bookInit && FG.bookInit(); return 1})()`).catch(() => { });
ok('本年账清空了', (await ev(`JSON.stringify(FG.state.book.fish)`)) === '{}', await ev(`JSON.stringify(FG.state.book.fish)`));
ok('见闻没跟着清（它跟着诗册，不跟着本年账）',
  (await ev(`FG.dexCount('fish') + FG.dexCount('good') + FG.dexCount('ore')`)) === preYear,
  preYear + ' 种 → ' + await ev(`FG.dexCount('fish') + FG.dexCount('good') + FG.dexCount('ore')`) + ' 种');

await ev(`(function(){ FG.state.dex=null; FG.dexFix(); return 1})()`);
ok('老存档没这一本账能补出空的', (await ev(`JSON.stringify(FG.state.dex)`)) === JSON.stringify({ good: {}, fish: {}, ore: {} }),
  await ev(`JSON.stringify(FG.state.dex)`));
ok('补完能记（补之前读一下会 on null）', (await ev(`(function(){ FG.dexAdd('fish','${fishId}'); return FG.dexCount('fish')})()`)) === 1);
await ev(`FG.restart()`); await sleep(300);
ok('重开归零', (await ev(`JSON.stringify(FG.state.dex)`)) === JSON.stringify({ good: {}, fish: {}, ore: {} }),
  await ev(`JSON.stringify(FG.state.dex)`));

console.log('\n— 画面 —');
await ev(`(function(){
  var i,d=FG.DEX;
  FG.state.dex={good:{},fish:{},ore:{}}; FG.state.day=88;
  for (i in FG.FISH) FG.dexAdd('fish', i);
  var g=Object.keys(FG.GOODS); for (i=0;i<4;i++) FG.dexAdd('good', g[i]);
  var o=Object.keys(FG.ORE); for (i=0;i<3;i++) FG.dexAdd('ore', o[i]);
  FG.openAlbum(); FG.setAlPage('seen'); return 1})()`);
await sleep(400);
await shot('65-诗册-见闻.png');
ok('截了一张', true);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
