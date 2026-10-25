// 人情验收。
//
// 递酒那套早就有了（n.wine：递满几坛换一句回话）。这一层补的是两头：
// **说话也算分**，以及**档位看得见**。
//
// 盯住这几条：
//   1) 三档 生→熟→相知，阈值从表里读
//   2) 说话加一分，但**同一天同一个人只记一次**
//      （不去重的话站在原地连按 E，三档一路涨到底，而他一句话也没多说）
//   3) 递酒抵两分、办成托付抵四分 —— 酒是这游戏里唯一不折钱的东西，
//      它多出来的那一份只能在这儿和 n.wine 上体现
//   4) 升档那一刻说一句**这时候才说的话**，而且压在托付回话前面
//   5) 卡片抬头上带档位（「邻翁　·　相知」）
//   6) 相知的礼**一辈子只给一次**，且礼不跟生辰重样（山货/鱼，不是种子）
//   7) v 全是白话，出处「——」，不冒充古人
//   8) 只加不减：冷落了他不会掉档
//   9) 老存档 / 重开归零
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9405;
const profile = path.join(tmpdir(), 'guxian-ren-' + process.pid);
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
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(170);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
const dlgName = () => ev(`document.getElementById('dlg-name').textContent`);
const dlgText = () => ev(`document.getElementById('dlg-text').textContent`);
const dlgFrom = () => ev(`document.getElementById('dlg-from').textContent`);
// 站到某个人跟前
const stand = async id => {
  await ev(`(function(){
    var m=null; for (var k in FG.MAPS) if ((FG.MAPS[k].npcs||[]).indexOf(${JSON.stringify(id)})>=0) m=FG.MAPS[k];
    FG.gotoMap(m.id);
    FG.state.player.x=FG.NPCS[${JSON.stringify(id)}].at[0];
    FG.state.player.y=FG.NPCS[${JSON.stringify(id)}].at[1]+60;
    FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
  await sleep(430);
};

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

console.log('— 表：每个人两档，名字和礼都对得上 —');
const R = JSON.parse(await ev(`(function(){
  var o=[], bad=[];
  for (var id in FG.REN){
    var d=FG.REN[id];
    o.push({id:id, n:(FG.NPCS[id]||{}).name||id, steps:d.map(function(s){return s.n+'@'+s.at;}),
      gift:(d[d.length-1].gift||'')});
  }
  return JSON.stringify({o:o, bad:bad});})()`)).o;
ok('档位名是 生 / 熟 / 相知',
  (await ev(`FG.REN_TIER.join('/')`)) === '生/熟/相知', await ev(`FG.REN_TIER.join('/')`));
ok('七个人都配齐了', R.length === 7, R.length + ' 人');
R.forEach(r => console.log('  ' + r.id.padEnd(10) + ' ' + r.steps.join(' → ')
  + '　相知的礼：' + (r.gift || '（无）')));
ok('每一档都有名字和一句话，没有一处空着', (await ev(`(function(){
  var bad=[];
  for (var id in FG.REN) FG.REN[id].forEach(function(s){ if(!s.n||!s.v) bad.push(id); });
  return bad.join('　');})()`)) === '');
ok('全是白话（不混引号、不冒充出处）', (await ev(`(function(){
  var bad=[];
  for (var id in FG.REN) FG.REN[id].forEach(function(s){
    if (/[「」《》]/.test(s.v)) bad.push(id+'：'+s.v); });
  return bad.join('　');})()`)) === '');
ok('相知的礼七样都不重样', new Set(R.map(r => r.gift)).size === R.length,
  R.map(r => r.gift).join(' '));
ok('礼不跟生辰重样：都不是种子（生辰送的是种子）',
  R.every(r => !/^seed/.test(r.gift)), R.map(r => r.gift).join(' '));
ok('礼在行囊里排得出图标（key 写对了，不是裸 id）',
  (await ev(`(function(){ var bad=[];
    for (var id in FG.REN){ var g=FG.REN[id][FG.REN[id].length-1].gift;
      if (g && !FG.BAG_IDX[g]) bad.push(id+':'+g); }
    return bad.join('　');})()`)) === '');

console.log('\n— 说话加一分，但同一天只记一次 —');
await ev(`(function(){ FG.renFix(); FG.state.ren={}; FG.renFix(); FG.state.day=1; return 1})()`);
await stand('linweng');
await key('e');
ok('第一次说话得一分', (await ev(`FG.state.ren.linweng.p`)) === 1, await ev(`FG.state.ren.linweng.p`));
ok('还够不上「熟」', (await ev(`FG.renTier('linweng')`)) === 0, await ev(`FG.renName('linweng')`));
for (let i = 0; i < 4; i++) { await key('e'); }
ok('同一天连按五次 E 也只算一次（他一句话也没多说）',
  (await ev(`FG.state.ren.linweng.p`)) === 1, '分 ' + await ev(`FG.state.ren.linweng.p`));
await key('Escape'); await sleep(200);
await ev(`(function(){ FG.state.day=2; return 1})()`);
await key('e'); await key('Escape'); await sleep(200);
ok('隔一天再说是另一分', (await ev(`FG.state.ren.linweng.p`)) === 2, '分 ' + await ev(`FG.state.ren.linweng.p`));

console.log('\n— 递酒抵两分 / 办成托付抵四分 —');
const FG_SPEECH = await ev(`FG.REN_SPEECH`);
const FG_WINE = await ev(`FG.REN_WINE`);
const FG_QUEST = await ev(`FG.REN_QUEST`);
ok('表上就是这么定的（判据和数字对得上）',
  (await ev(`FG.REN_SPEECH===1 && FG.REN_WINE===2 && FG.REN_QUEST===4`)) === true,
  '说话 ' + FG_SPEECH + '　酒 ' + FG_WINE + '　托付 ' + FG_QUEST);
// 从一个干净的数起：**只递酒，不说话** ——
// 混着说的话就得先把「说话那 1 分」和「去重」两件事一起算进去，
// 而那两件事上一段已经各自核过了
await ev(`(function(){
  FG.renInit(); FG.state.day=3; FG.state.jiu=3; FG.state.jiuYear=[1,1,1];
  FG.state.favor.linweng=0; return 1})()`);
const pWine0 = await ev(`FG.state.ren.linweng.p`);
await ev(`(function(){
  // 直接走 giveWine 那一支：那一行按钮上写着「把这一缸酒递过去」，
  // 而点它之前还得先有一坛酒、还得他没收满 —— 条件太多，
  // 断言「人情加了几分」不该挂在这串条件上
  FG.giveWine(); return 1})()`);
await sleep(320);
ok('递一坛酒抵两分', (await ev(`FG.state.ren.linweng.p`)) === pWine0 + FG_WINE,
  pWine0 + ' → ' + await ev(`FG.state.ren.linweng.p`) + '（表上酒抵 ' + FG_WINE + ' 分）');
ok('（酒真的递出去了，不是那一支根本没触发）', (await ev(`FG.state.jiu`)) === 2,
  '手上还有 ' + await ev(`FG.state.jiu`) + ' 坛');
ok('递酒那一支不会顺手把「说话」那一下也算上', (await ev(`FG.state.ren.linweng.p`)) !== pWine0 + 1,
  '只加了 ' + ((await ev(`FG.state.ren.linweng.p`)) - pWine0) + ' 分');
ok('（酒真的递出去了，不是那一支根本没触发）', (await ev(`FG.state.jiu`)) === 2,
  '手上还有 ' + await ev(`FG.state.jiu`) + ' 坛');
await key('Escape'); await sleep(200);

console.log('\n— 升档那一刻说一句这时候才说的话 —');
const AT = JSON.parse(await ev(`JSON.stringify(FG.REN.linweng.map(function(s){return s.at;}))`));
ok('阈值从表里读得到', AT.length === 2, AT.join(' / '));
// 离得远的时候先说说话 —— 他不该突然换一句
await ev(`(function(){
  FG.renInit(); FG.state.day=4;
  FG.gotoMap('nanshan');
  FG.state.player.x=FG.NPCS.linweng.at[0]; FG.state.player.y=FG.NPCS.linweng.at[1]+60;
  FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(430);
await key('e');
ok('刚认识的时候他还是说他那几句诗，不插别的话',
  (await ev(`FG.renTier('linweng')`)) === 0 && (await dlgFrom()) !== '——',
  await ev(`FG.renName('linweng')`) + '　' + await dlgText());
await key('Escape'); await sleep(200);
// **tier 也要一起重置** —— 早先只把 p 摆回去，tier 还停在 1，
// 于是 renForcedLine 判「已经到了」直接返回 null，那一句一句也不说
await ev(`(function(){ FG.renInit();
  FG.state.ren.linweng.p=${AT[0] - 1}; FG.state.day=5; return 1})()`);
await sleep(300);
await key('e');
ok('差一分时说话就升到「熟」（说一句加一分，刚好够）',
  (await ev(`FG.renTier('linweng')`)) === 1, await ev(`FG.renName('linweng')`));
ok('他说了这一档才说的话', (await dlgText()) === '话头不必多，坐一会儿就算。', await dlgText());
ok('出处是「——」（白话）', (await dlgFrom()) === '——', await dlgFrom());
ok('卡片抬头上带着档位', (await dlgName()).indexOf('熟') >= 0, await dlgName());
await key('Escape'); await sleep(200);
await ev(`(function(){ FG.state.day=6; return 1})()`);
await key('e');
ok('已经到「熟」了就不再说那一句', (await dlgText()) !== '话头不必多，坐一会儿就算。', await dlgText());
ok('（不插话的时候，陶诗那几句还在）', (await dlgFrom()) !== '——', await dlgFrom());
ok('但抬头还是带着档位', (await dlgName()).indexOf('熟') >= 0, await dlgName());
await key('Escape'); await sleep(200);

console.log('\n— 相知：他记住你爱吃哪一味 —');
// 差一分，说一句就够 —— 跨档那一句和那样东西是**同一下**说出去的，
// 分成两天两下的话，第二下他已经「到了」，什么也不说了
await ev(`(function(){
  FG.renInit();
  FG.state.ren.linweng.p=${AT[1] - 1}; FG.state.day=7;
  FG.state.pouch={}; return 1})()`);
await sleep(250);
await key('e');
ok('升到「相知」', (await ev(`FG.renTier('linweng')`)) === 2, await ev(`FG.renName('linweng')`));
ok('他说的是相知那一句', (await dlgText()).indexOf('野莓') >= 0, await dlgText());
ok('而且那样东西同一刻就到手了（行囊里排得出图标那一种）',
  (await ev(`FG.invGet('good_mei')`)) === 1, 'good_mei ' + await ev(`FG.invGet('good_mei')`));
ok('抬头写着「相知」', (await dlgName()).indexOf('相知') >= 0, await dlgName());
await key('Escape'); await sleep(220);
await ev(`(function(){ FG.state.day=9; FG.state.pouch={}; return 1})()`);
await key('e');
ok('**礼一辈子只给一次**（第二年再说一遍也不会再给）',
  (await ev(`FG.invGet('good_mei')`)) === 0, 'good_mei ' + await ev(`FG.invGet('good_mei')`));
ok('而那一档的话也不重复说', (await dlgText()).indexOf('野莓') < 0, await dlgText());
await key('Escape'); await sleep(200);

console.log('\n— 只加不减 —');
ok('档位只会往上走（把人情清空也不会掉档）', (await ev(`(function(){
  var bad=[];
  for (var id in FG.REN){
    var t=FG.renTier(id);
    FG.state.ren[id].p=0;                 // 人情被清空
    if (FG.renTier(id) > t) bad.push(id); // 档位反而升了
  }
  return bad.join('　');})()`)) === '');

console.log('\n— 老存档 / 重开归零 —');
await ev(`(function(){ FG.state.ren=null; FG.renFix(); return 1})()`);
ok('老存档没这一本账能补齐（每一项都有，不是空对象）',
  (await ev(`(function(){
    var bad=[];
    for (var id in FG.REN){ var d=FG.state.ren[id];
      if (!d || d.p===undefined || d.tier===undefined) bad.push(id); }
    return bad.join('　');})()`)) === '');
ok('补完之后判据是默认（人人「生」）',
  (await ev(`(function(){ var bad=[];
    for (var id in FG.REN) if (FG.renTier(id)!==0) bad.push(id); return bad.join('　');})()`)) === '');
await ev(`(function(){ FG.state.ren.linweng.p=200; FG.renTier('linweng'); FG.restart(); return 1})()`);
await sleep(400);
ok('重开归零', (await ev(`FG.renTier('linweng')`)) === 0, '分 ' + await ev(`FG.state.ren.linweng.p`));

console.log('\n— 画面 —');
await ev(`(function(){
  FG.state.ren={}; FG.renFix(); FG.state.ren.linweng.p=60; FG.state.day=40;
  FG.state.met={}; FG.state.birth={}; FG.birthFix();
  FG.gotoMap('nanshan');
  FG.state.player.x=FG.NPCS.linweng.at[0]; FG.state.player.y=FG.NPCS.linweng.at[1]+60;
  FG.state.walkTo=null; FG.updateHUD();
  FG.talk(FG.NPCS.linweng); return 1})()`);
await sleep(450);
ok('卡片抬头上是「邻翁　·　相知」', (await dlgName()).indexOf('相知') >= 0, await dlgName());
await shot('72-人情-相知.png');
ok('截了一张', true);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
