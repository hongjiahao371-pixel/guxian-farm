// 出货箱验收：钱是「你亲手放进去的」，不是「篮子空了」。
//
// 盯住的主题规矩：
//   1) 天黑只出货箱里的东西，手上没放的留在篮里过夜
//   2) 放得进去也要拿得回来（只进不出的箱子，第二天玩家对着空篮子发愣）
//   3) 酒放不进去 —— 放进去等于当着玩家的面把诗册的门关上，而天黑并不给它钱
//   4) 箱里空着而篮里有货时，结算面板要主动说一句话，而不是默默显示进项 0
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9365;
const profile = path.join(tmpdir(), 'guxian-bin-' + process.pid);
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
      const pg = (await r.json()).find(t => t.type === 'page');
      if (pg) return [pg];
    } catch (e) { }
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}
let id = 0, ws; const pending = new Map(); const logs = [];
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
const binShown = () => ev(`!document.getElementById('bx').classList.contains('hide')`);
const deShown = () => ev(`!document.getElementById('de').classList.contains('hide')`);
const deText = () => ev(`document.querySelector('#de .body').textContent.replace(/\\s+/g,' ')`);
// 摆库存：把手上掏空再摆上这两样，好让每条断言读到的数都是自己刚摆的
async function setInv(obj) {
  await ev(`(function(){
    var o=${JSON.stringify(obj)};
    FG.state.bag={dou:0,su:0,shu:0,ji:0,ju:0};
    FG.state.pouch={};
    FG.state.jiu=0;
    FG.state.made={};
    FG.state.bin={};
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
async function closeAll() {
  await ev(`(function(){
    ['st','bg','dlg','al','de','bx','hs'].forEach(function(id){
      var e=document.getElementById(id); if (e) e.classList.add('hide');
    });
    return 1;
  })()`);
  await sleep(150);
}
// 门口按 E 进屋，再点「床」那一行过夜。20/2 之后归家不再走门口的 E
async function goBed() {
  await key('e');
  await sleep(400);
  await ev(`(function(){ var g=document.querySelector('#hs-list .hsr[data-k="bed"]'); if(g) g.click(); return 1; })()`);
  await sleep(200);
}
const handRow = (k) => ev(`(function(){var g=document.querySelector('#bx-hand [data-k="${k}"]');return g?g.textContent:'(没有这一行)'})()`);
const binRow = (k) => ev(`(function(){var g=document.querySelector('#bx-bin [data-k="${k}"]');return g?g.textContent:'(箱里没有这一样)'})()`);
// 点箱子前必须确认面板开着。面板关着时 clickIn 找不到元素、静默返回 0，
// 而后面那些「箱里没有这一样」「手 X 箱 Y」照样成立 —— 看着像游戏没反应，
// 其实是脚本没点着东西
async function openBinNow() {
  if (!(await binShown())) { await key('o'); await sleep(350); }
  if (!(await binShown())) throw new Error('按 O 开不出出货箱');
}
// Shift+click 要带 shiftKey，这里直接派发真实鼠标事件
async function clickIn(sel, k, shift) {
  await openBinNow();
  const hit = await ev(`(function(){
    var g=document.querySelector('${sel} [data-k="${k}"]'); if(!g) return 0;
    g.dispatchEvent(new MouseEvent('click',{bubbles:true, shiftKey:${!!shift}})); return 1;
  })()`);
  if (!hit) throw new Error(`${sel} 里没有 ${k} 这一行`);
  await sleep(300);
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

const CROPS = JSON.parse(await ev(`JSON.stringify((function(){
  var o={}; for (var k in FG.CROPS) o[k]=FG.CROPS[k].sell; return o; })())`));
const home = JSON.parse(await ev(`JSON.stringify(FG.MAPS.nanshan.home)`));

console.log('— 键位 —');
ok('键位条上写着 O 出货', (await ev(`document.getElementById('keys').textContent`)).indexOf('O 出货') >= 0,
  await ev(`document.getElementById('keys').textContent`));
const kh = await ev(`(function(){var e=document.getElementById('keys');
  return Math.round(e.getBoundingClientRect().height)+'/'+Math.round(parseFloat(getComputedStyle(e).lineHeight))})()`);
ok('键位条还是一行', Number(kh.split('/')[0]) <= Number(kh.split('/')[1]) * 1.35, '高 ' + kh.split('/')[0] + 'px，上限 ' + Math.round(Number(kh.split('/')[1]) * 1.35));

console.log('— O 打开箱子 —');
await setInv({ crop_dou: 10, crop_su: 4, jiu: 2 });
await closeAll();
await key('o');
await sleep(400);
ok('箱子面板开了', (await binShown()) === true);
ok('键位条上确实有这一项', (await ev(`!!document.getElementById('bx')`)) === true);
ok('箱里一开始是空的', (await binRow('crop_dou')) === '(箱里没有这一样)');
const hDou = await handRow('crop_dou');
console.log('  豆 =', hDou);
ok('手上有豆，标着价钱', hDou.indexOf('豆') >= 0 && hDou.indexOf(String(CROPS.dou)) >= 0, hDou);
const hJiu = await handRow('jiu');
console.log('  酒 =', hJiu);
ok('酒摆出来了（让玩家看见它有）', hJiu.indexOf('酒') >= 0, hJiu);
ok('但酒写明放不进去', hJiu.indexOf('不卖钱') >= 0 && hJiu.indexOf('只能送人') >= 0, hJiu);
ok('酒那一行点不动', (await ev(`document.querySelector('#bx-hand [data-k="jiu"]').classList.contains('no')`)) === true);
await shot('60-出货箱.png');

console.log('— 点一下放一份 —');
await clickIn('#bx-hand', 'crop_dou');
ok('箱里有一份豆', (await ev(`FG.state.bin.crop_dou`)) === 1, 'bin=' + await ev(`JSON.stringify(FG.state.bin)`));
ok('手上少了一份豆', (await ev(`FG.state.bag.dou`)) === 9, 'dou=' + await ev(`FG.state.bag.dou`));
const bDou = await binRow('crop_dou');
console.log('  箱里的豆 =', bDou);
ok('箱里那行写着份数和折多少钱', bDou.indexOf('×1') >= 0 && bDou.indexOf(String(CROPS.dou)) >= 0, bDou);
ok('箱里那行写着拿回来的办法', bDou.indexOf('拿回') >= 0, bDou);

console.log('— 放得进去，也要拿得回来 —');
await clickIn('#bx-bin', 'crop_dou');
ok('箱里空了', (await ev(`!!FG.state.bin.crop_dou`)) === false, 'bin=' + await ev(`JSON.stringify(FG.state.bin)`));
ok('豆回到了手上', (await ev(`FG.state.bag.dou`)) === 10, 'dou=' + await ev(`FG.state.bag.dou`));
// 只进不出的箱子，玩家第一天就会把明天要吃的粮也卖了
ok('箱和手来回搬东西，两边都不丢', (await ev(`FG.state.bag.dou`)) + (await ev(`FG.state.bin.crop_dou||0`)) === 10,
  `手 ${await ev(`FG.state.bag.dou`)} + 箱 ${await ev(`FG.state.bin.crop_dou||0`)}`);

console.log('— Shift 全放 / 全取回 —');
await clickIn('#bx-hand', 'crop_dou', true);
ok('十份豆全进了箱', (await ev(`FG.state.bin.crop_dou`)) === 10, 'bin=' + await ev(`FG.state.bin.crop_dou`));
ok('手上一点不剩', (await ev(`FG.state.bag.dou`)) === 0, 'dou=' + await ev(`FG.state.bag.dou`));
ok('箱里折的钱是十份的价', (await ev(`FG.binWorth()`)) === CROPS.dou * 10,
  `${await ev(`FG.binWorth()`)} 钱（应为 ${CROPS.dou * 10}）`);
await clickIn('#bx-bin', 'crop_dou', true);
ok('十份全取回来了', (await ev(`FG.state.bag.dou`)) === 10 && (await ev(`FG.state.bin.crop_dou||0`)) === 0,
  `手 ${await ev(`FG.state.bag.dou`)} 箱 ${await ev(`FG.state.bin.crop_dou||0`)}`);

console.log('— 酒点不动 —');
const jiuA = await ev(`FG.state.jiu`);
await clickIn('#bx-hand', 'jiu');
await clickIn('#bx-hand', 'jiu', true);
ok('酒一坛都没进箱', (await ev(`FG.state.jiu`)) === jiuA, 'jiu=' + await ev(`FG.state.jiu`));
ok('箱里没有酒', (await ev(`!!FG.state.bin.jiu`)) === false, 'bin=' + await ev(`JSON.stringify(FG.state.bin)`));
ok('这一段没有异常', logs.length === 0, logs.join(' | ') || '干净');

console.log('— Esc 关箱 —');
await key('Escape');
await sleep(320);
ok('Esc 关掉了', (await binShown()) === false);

console.log('— 天黑只出货箱里的 —');
// 这里手上不能有酒：酒能酿醋，一有酒门口的 E 就变成「开灶」而不是「归家」，
// 脚本按 E 只会开出一个灶面板，看着像结算没触发。带酒的那条路要走
// 灶面板上的「收灶归家」，那是 shoot-stove.mjs 的事
await setInv({ crop_dou: 6, crop_su: 3 });
await closeAll();
await clickIn('#bx-hand', 'crop_dou', true);      // 放光 6 份豆，粟不放
ok('箱里只有豆', (await ev(`JSON.stringify(FG.state.bin)`)) === JSON.stringify({ crop_dou: 6 }),
  await ev(`JSON.stringify(FG.state.bin)`));
ok('粟没被顺手放进去', (await ev(`!!FG.state.bin.crop_su`)) === false,
  'bin=' + await ev(`JSON.stringify(FG.state.bin)`));
const gA = await ev(`FG.state.gold`), eA = await ev(`FG.state.earned`);
await closeAll();
await ev(`FG.state.player.x=${home[0]}; FG.state.player.y=${home[1]}; FG.state.walkTo=null;`);
await sleep(200);
await goBed();
await sleep(400);
ok('结算面板弹了', (await deShown()) === true);
ok('只折了箱里那一份的钱', (await ev(`FG.state.gold`)) === gA + CROPS.dou * 6,
  `${gA} + ${CROPS.dou * 6} = ${await ev(`FG.state.gold`)}`);
ok('箱里的豆出货了', (await ev(`FG.state.bag.dou`)) === 0, 'dou=' + await ev(`FG.state.bag.dou`));
ok('没放进箱的粟还留在篮里', (await ev(`FG.state.bag.su`)) === 3, 'su=' + await ev(`FG.state.bag.su`));
ok('箱清空了', (await ev(`Object.keys(FG.state.bin).length`)) === 0, await ev(`JSON.stringify(FG.state.bin)`));
ok('一生累计也跟着涨', (await ev(`FG.state.earned`)) === eA + CROPS.dou * 6,
  `${eA} -> ${await ev(`FG.state.earned`)}`);
ok('结算面板上只列了豆', (await deText()).indexOf('豆') >= 0 && (await deText()).indexOf('粟') < 0,
  (await deText()).slice(0, 140));
ok('这一段没有异常', logs.length === 0, logs.join(' | ') || '干净');
await shot('61-结算只出货箱里的.png');

console.log('— 箱空着而篮里有货，要说一句话 —');
await ev(`FG.nextDay()`);
await sleep(600);
await setInv({ crop_su: 4 });
const gB = await ev(`FG.state.gold`);
await closeAll();
await ev(`FG.state.player.x=${home[0]}; FG.state.player.y=${home[1]}; FG.state.walkTo=null;`);
await sleep(200);
await goBed();
await sleep(400);
const emptyTxt = await deText();
console.log('  结算 =', emptyTxt.slice(0, 160));
ok('箱空着时一文不名', (await ev(`FG.state.gold`)) === gB, `${gB} -> ${await ev(`FG.state.gold`)}`);
ok('篮子里的粟一根没少', (await ev(`FG.state.bag.su`)) === 4, 'su=' + await ev(`FG.state.bag.su`));
// 玩家第一天最容易卡在这里：看着「进项 0 钱」以为游戏坏了
ok('结算里说明白了怎么才能有钱', emptyTxt.indexOf('按 O 放箱里') >= 0, emptyTxt.slice(0, 160));
ok('这一段没有异常', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 行囊提示改口 —');
await ev(`FG.nextDay()`);
await sleep(500);
await closeAll();
await ev(`FG.openBag()`);
await sleep(300);
const tipAll = await ev(`(function(){
  var out=[];
  document.querySelectorAll('#bg-cv').forEach(function(){});
  return document.getElementById('bg-tip').textContent; })()`);
await ev(`(function(){
  // 悬停到豆那一格，把 tip 换成那一条
  var l=FG.bagList();
  for (var i=0;i<l.length;i++) if (l[i].k==='crop_su') { FG.hintBag && FG.hintBag(i); return 1; }
  return 0; })()`);
await sleep(200);
ok('行囊默认那一行不再说「天黑出货」', tipAll.indexOf('天黑') < 0, tipAll);

console.log('— 存档往返 —');
await ev(`FG.nextDay()`);
await sleep(500);
// nextDay 不会把结算面板收起来，面板开着的时候所有键都被它吃掉
await closeAll();
await setInv({ crop_dou: 5, crop_su: 5 });
await clickIn('#bx-hand', 'crop_dou', true);
await clickIn('#bx-hand', 'crop_su');
await sleep(300);
const savedBin = await ev(`JSON.stringify(FG.state.bin)`);
ok('存之前箱里是两份', savedBin === JSON.stringify({ crop_dou: 5, crop_su: 1 }), savedBin);
await ev(`FG.saveGame()`);
await sleep(300);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1000);
ok('读档后箱里的还在', (await ev(`JSON.stringify(FG.state.bin)`)) === savedBin,
  await ev(`JSON.stringify(FG.state.bin)`));
ok('读档后手上的也对', (await ev(`FG.state.bag.dou`)) === 0 && (await ev(`FG.state.bag.su`)) === 4,
  `豆 ${await ev(`FG.state.bag.dou`)} 粟 ${await ev(`FG.state.bag.su`)}`);
ok('读档后箱里的折钱还是那个数', (await ev(`FG.binWorth()`)) === CROPS.dou * 5 + CROPS.su,
  `${await ev(`FG.binWorth()`)} 钱`);

console.log('— 重开归零 —');
await ev(`FG.restart()`);
await sleep(800);
ok('重开后箱子空了', (await ev(`Object.keys(FG.state.bin).length`)) === 0,
  await ev(`JSON.stringify(FG.state.bin)`));

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? `FAILED ${fails}` : 'DONE');
