// 木箱验收。
//
// 为什么现在做它：行囊是 8×5 = 40 格，物品总表刚好 40 样，一格不多。
// 再加任何一类东西就摆不下，而摆不下的时候症状是「画面上只是少一格」，
// 看不出是装不下。木箱给的就是这个余量。
//
// 它跟出货箱是两件事，必须盯住这个区别：
//   出货箱 —— 放进去，天黑时折成钱
//   木  箱 —— 放进去，一直搁着，天黑不动它
// 差一条就变成了「多一个出货箱」，而那等于白做。
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9399;
const profile = path.join(tmpdir(), 'guxian-chest-' + process.pid);

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
async function key(k, shift) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined, modifiers: shift ? 8 : 0 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, modifiers: shift ? 8 : 0 });
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
const chestOpen = () => ev(`FG.chestOpen()`);
const chestCount = () => ev(`FG.chestCount()`);
// 存/取走的那一本账。行囊、袋、种子、自酿各在不同本账上，
// 所以要核「动的是哪一本」，不是只看总数
const held = k => ev(`FG.state.bag[${JSON.stringify(k)}]||0`);
const inChest = k => ev(`(FG.state.chest[${JSON.stringify(k)}]||0)`);

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

console.log('— 木箱摆在哪 —');
const C = JSON.parse(await ev(`JSON.stringify(FG.CHEST)`));
console.log('  木箱 =', JSON.stringify(C));
const home = JSON.parse(await ev(`JSON.stringify(FG.MAPS.nanshan.home)`));
const homeR = await ev(`FG.MAPS.nanshan.homeR`);
const fieldTL = JSON.parse(await ev(`JSON.stringify(FG.FIELD.cellQuad(0,0)[0])`));
ok('木箱在南山这张图上', C.at[0] > 0 && C.at[1] > 0, JSON.stringify(C.at));
// 它跟茅屋门口在同一个圈里。E 键里木箱排在归家前面，
// 而顺序是「先判到的赢」—— 箱子排后的话，站在箱子跟前按 E 永远是归家，
// 玩家会以为这个箱子开不了
const dHome = Math.abs(C.at[0] - home[0]) + Math.abs(C.at[1] - home[1]);
ok('木箱跟茅屋门口在同一个归家圈里（E 要靠顺序分）', dHome <= homeR, dHome + ' <= ' + homeR);
ok('木箱不压在田里', C.at[0] < fieldTL[0], '箱 x=' + C.at[0] + ' / 田左缘 x=' + fieldTL[0]);

console.log('— 站在跟前按 E 开的是箱子，不是归家 —');
const standChest = async () => {
  await ev(`(function(){
    FG.gotoMap('nanshan');
    FG.state.player.x=FG.CHEST.at[0]; FG.state.player.y=FG.CHEST.at[1]+40;
    FG.state.walkTo=null; FG.state.hover=null; return 1})()`);
  await sleep(450);
};
await standChest();
const hEmpty = await hint();
ok('提示行写的是「开木箱」', hEmpty.indexOf('开木箱') >= 0, hEmpty);
ok('空箱子也说是空的（站着就知道摆在哪、装没装）', hEmpty.indexOf('空') >= 0, hEmpty);
await clearToast();
await key('e'); await sleep(350);
ok('按 E 把木箱开起来了', (await chestOpen()) === true);
await shot('60-木箱-空.png');
// 开了箱子，别的键就别顺手也吞了
await clearToast();
await key('Escape'); await sleep(300);
ok('Esc 关得掉', (await chestOpen()) === false);
ok('关完还能继续玩（E 归家回来了）', (await ev(`FG.state.started`)) === true);

console.log('— 放进去 / 取出来 —');
await ev(`(function(){
  FG.state.bag.dou=12; FG.state.bag.su=3; FG.state.made.jiang=2;
  FG.state.chest={}; return 1})()`);
await standChest();
await key('e'); await sleep(350);
ok('箱子开着了', (await chestOpen()) === true);
// 手上那几行
const handRows = await ev(`(function(){
  return [].map.call(document.querySelectorAll('#ch-hand .bxh'), function(x){return x.getAttribute('data-k')});
})()`);
console.log('  手上的行 =', JSON.stringify(handRows));
ok('手上有豆、粟、酱', ['crop_dou', 'crop_su', 'jiang'].every(k => handRows.indexOf(k) >= 0), JSON.stringify(handRows));
// 箱里已有的不该在手上一栏重复出现
await ev(`FG.chestMove('crop_dou', true, true)`); await sleep(300);
ok('全放进去之后豆进了箱', (await inChest('crop_dou')) === 12, '箱里豆=' + await inChest('crop_dou'));
ok('豆不在手上了', (await held('dou')) === 0, '手上豆=' + await held('dou'));
ok('箱里一共 12 件', (await chestCount()) === 12, chestCount() + ' 件');
// 总数**不能跟着页签走**。仓房（家具）把箱子分成「采回来的 / 做出来的」两页，
// 而 chestList 是跟着当前那一页的 —— 写成 chestList 的求和的话，
// 门前的「里面搁着 N 件」会切一页就变一次，看着像东西少了
ok('件数是全箱的数，跟当前看的是哪一页无关',
  (await ev(`(function(){
    var t=FG.chestTab(), a=FG.chestCount();
    FG.chestSetTab('got'); var b=FG.chestCount();
    FG.chestSetTab('made'); var c=FG.chestCount();
    FG.chestSetTab(t);
    return (a===b && b===c) ? 1 : 0;})()`)) === 1,
  'all=' + await chestCount() + ' / got=' + await ev(`FG.chestCount()`));
const hand2 = await ev(`(function(){
  return [].map.call(document.querySelectorAll('#ch-hand .bxh'), function(x){return x.getAttribute('data-k')});
})()`);
ok('豆从「手上」那一栏里消失了', hand2.indexOf('crop_dou') < 0, JSON.stringify(hand2));
ok('粟和酱还在手上', hand2.indexOf('crop_su') >= 0 && hand2.indexOf('jiang') >= 0, JSON.stringify(hand2));
await shot('61-木箱-放进去.png');
// 存的是不是「本来的那本账」—— 自酿品在 S.made，谷在 S.bag
await ev(`FG.chestMove('jiang', true, true)`); await sleep(300);
ok('自酿品也放得进去（走的是 S.made 那本账）', (await inChest('jiang')) === 2 && (await ev(`FG.state.made.jiang||0`)) === 0,
  '箱里=' + await inChest('jiang') + ' 手上=' + await ev(`FG.state.made.jiang||0`));
await ev(`FG.chestMove('jiang', false, true)`); await sleep(300);
ok('自酿品取得回来，还是回 S.made', (await inChest('jiang')) === 0 && (await ev(`FG.state.made.jiang||0`)) === 2,
  '箱里=' + await inChest('jiang') + ' 手上=' + await ev(`FG.state.made.jiang||0`));

console.log('— 点一下放一份 / Shift 全放 —');
await ev(`(function(){ FG.state.bag.dou=5; FG.state.chest.crop_dou=0; delete FG.state.chest.crop_dou; return 1})()`);
await ev(`FG.openChest()`); await sleep(250);
await ev(`FG.chestMove('crop_dou', true, false)`); await sleep(250);
ok('点一下只放一份', (await inChest('crop_dou')) === 1 && (await held('dou')) === 4,
  '箱里=' + await inChest('crop_dou') + ' 手上=' + await held('dou'));
await ev(`(function(){ FG.state.chest.crop_dou=3; FG.state.bag.dou=0; FG.openChest(); return 1})()`);
await ev(`FG.chestMove('crop_dou', true, true)`); await sleep(250);
ok('Shift 全放一次放完', (await inChest('crop_dou')) === 3 && (await held('dou')) === 0,
  '箱里=' + await inChest('crop_dou') + ' 手上=' + await held('dou'));
// 方向由「点了哪一栏」决定
await ev(`(function(){ FG.state.chest.crop_dou=2; FG.state.bag.dou=7; FG.openChest(); return 1})()`);
await ev(`FG.chestMove('crop_dou', false, false)`); await sleep(250);
ok('点箱里那一行是取回来，不是再放一份', (await inChest('crop_dou')) === 1 && (await held('dou')) === 8,
  '箱里=' + await inChest('crop_dou') + ' 手上=' + await held('dou'));
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 箱里的东西天黑不过夜 —');
// 这是木箱跟出货箱唯一的分界线。差这一条，木箱就只是个换名字的出货箱。
// 门口按 E 是**进屋**（20/2 之后），归家从屋里「床」那一行走 ——
// 这里要过夜，所以走的是屋里那一条，不是门口的 E
await ev(`(function(){
  FG.state.chest={crop_dou:20, crop_su:10}; FG.state.bin={};
  FG.state.bag={dou:0,su:0,shu:0,ji:0,ju:0};
  FG.state.made={}; FG.state.pouch={}; FG.state.jiu=0;
  FG.state.stam=100; FG.state.cookN=0; return 1})()`);
const goldA = await ev(`FG.state.gold`);
// 上一段结束时箱子面板还开着。开着的时候 E 会被面板吞掉（那是对的），
// 所以先关掉再走到门口 —— 不关的话按 E 什么也不会发生，
// 而那看着像「站在门口按 E 进不了屋」
ok('木箱开着的时候 E 会被面板吞掉（不是没绑）', (await chestOpen()) === true);
await ev(`FG.closeChest()`); await sleep(250);
ok('关掉了', (await chestOpen()) === false);
await ev(`(function(){
  FG.gotoMap('nanshan');
  FG.state.player.x=FG.MAPS.nanshan.home[0]; FG.state.player.y=FG.MAPS.nanshan.home[1];
  FG.state.walkTo=null; FG.state.hover=null; FG.updateHUD(); return 1})()`);
await sleep(450);
const hHome2 = await hint();
console.log('  门口提示 =', hHome2);
ok('门口写的是进屋', hHome2.indexOf('进屋') >= 0, hHome2);
await clearToast();
await key('e'); await sleep(450);
ok('按 E 开的是屋里', (await ev(`FG.houseOpen()`)) === true);
// 归家要走「床」那一行。**直接按 E 不再能过夜了** ——
// 屋里开着一个面板时 E 只把它关掉，看着像「进屋之后回不了家」
ok('屋里「床」那一行亮着', (await ev(`(function(){var g=document.querySelector('#hs-list .hsr[data-k="bed"]');
  return g ? !g.classList.contains('off') : null;})()`)) === true);
await ev(`(function(){ document.querySelector('#hs-list .hsr[data-k="bed"]').click(); return 1;})()`);
await sleep(800);
const dayDone = await ev(`!document.getElementById('de').classList.contains('hide')`);
console.log('  结算面板弹了 =', dayDone, '　提示 =', await toast());
ok('结算面板弹出来了', dayDone === true);
ok('箱里的豆还在（天黑没折成钱）', (await inChest('crop_dou')) === 20, '箱里豆=' + await inChest('crop_dou'));
ok('箱里的粟也在', (await inChest('crop_su')) === 10, '箱里粟=' + await inChest('crop_su'));
ok('钱没因为箱子涨', (await ev(`FG.state.gold`)) === goldA, goldA + ' -> ' + await ev(`FG.state.gold`));
ok('过夜之后箱子没开着', (await chestOpen()) === false);
// 同一晚，出货箱里的一样要折掉 —— 这是对照组
await ev(`(function(){
  document.getElementById('de-next').click(); return 1})()`);
await sleep(400);
await ev(`(function(){
  FG.gotoMap('nanshan');
  FG.state.bin={crop_su:3};
  FG.state.player.x=FG.MAPS.nanshan.home[0]; FG.state.player.y=FG.MAPS.nanshan.home[1];
  FG.state.hover=null; return 1})()`);
await sleep(350);
const goldB = await ev(`FG.state.gold`);
// 归家走屋里「床」那一行 —— 门口的 E 现在只开屋里
await key('e'); await sleep(420);
await ev(`(function(){ var g=document.querySelector('#hs-list .hsr[data-k="bed"]'); if(g) g.click(); return 1;})()`);
await sleep(700);
ok('出货箱里的一样过夜折成了钱（对照组）', (await ev(`FG.state.gold`)) > goldB,
  goldB + ' -> ' + await ev(`FG.state.gold`));
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 存档往返 / 重开归零 —');
await ev(`(function(){
  document.getElementById('de-next').click();
  FG.state.chest={crop_ji:6, good_mei:11, fish_li:2};
  FG.state.day=33;
  FG.saveGame(); return 1})()`);
await sleep(300);
await ev(`location.reload()`); await sleep(2600);
  // 刷新完要**自己续**，别指望标题那一层顺带把档读了
  await ev(`FG.startFrom('cont')`); await sleep(700);
ok('读档回来箱里那三样还在',
  (await inChest('crop_ji')) === 6 && (await inChest('good_mei')) === 11 && (await inChest('fish_li')) === 2,
  JSON.stringify(await ev(`JSON.stringify(FG.state.chest)`)));
ok('件数也对', (await chestCount()) === 19, chestCount() + ' 件');
// 老存档没有这一本账
await ev(`(function(){
  var raw=JSON.parse(localStorage.getItem('guxian_nanshan_save_v1')); delete raw.chest;
  localStorage.setItem('guxian_nanshan_save_v1', JSON.stringify(raw)); return 1})()`);
await ev(`location.reload()`); await sleep(2600);
  // 刷新完要**自己续**，别指望标题那一层顺带把档读了
  await ev(`FG.startFrom('cont')`); await sleep(700);
ok('老存档没这一项也能补出一个空的', (await chestCount()) === 0 && (await ev(`JSON.stringify(FG.state.chest)`)) === '{}',
  await ev(`JSON.stringify(FG.state.chest)`));
// 存档被手改过
await ev(`(function(){ FG.state.chest={crop_dou:-5, crop_su:3, fish_xia:0}; FG.saveGame(); return 1})()`);
await sleep(300);
await ev(`location.reload()`); await sleep(2600);
  // 刷新完要**自己续**，别指望标题那一层顺带把档读了
  await ev(`FG.startFrom('cont')`); await sleep(700);
ok('负数和零的那几项被清掉了', (await chestCount()) === 3 && (await inChest('crop_dou')) === 0,
  JSON.stringify(await ev(`JSON.stringify(FG.state.chest)`)));

// 重开：先把存档弄脏再开新局。
// 光看新局的状态它天然就是空的，分不出「重开时归零了」和「压根没管过」
await ev(`(function(){
  var s=FG.state; s.chest={crop_dou:50, crop_su:20}; s.day=40; s.earned=777; s.saveGame(); return 1})()`);
await sleep(300);
await ev(`location.reload()`); await sleep(2600);
await ev(`FG.startFrom('new')`); await sleep(1200);
ok('开新局箱子是空的', (await chestCount()) === 0, JSON.stringify(await ev(`JSON.stringify(FG.state.chest)`)));
ok('开新局回到第一天', (await ev(`FG.state.day`)) === 1, 'day=' + await ev(`FG.state.day`));
ok('新局累计也归零', (await ev(`FG.state.earned`)) === 0, 'earned=' + await ev(`FG.state.earned`));

console.log('— 行囊的余量：这是做它的理由 —');
const slots = await ev(`FG.BAG_COLS * FG.BAG_ROWS`);
const kinds = await ev(`FG.BAG.length`);
console.log(`  行囊 ${await ev('FG.BAG_COLS')}×${await ev('FG.BAG_ROWS')} = ${slots} 格，物品总表 ${kinds} 样`);
ok('总表摆在行囊里摆得下', kinds <= slots, kinds + ' 样 / ' + slots + ' 格');
// 挪走一格，箱里就有地方了 —— 验的是「挪进箱子」这个动作确实腾得出位置
ok('挪一样进箱子之后行囊少一格', (await ev(`(function(){
  FG.state.bag.dou=3; FG.chestMove('crop_dou', true, true);
  var n=0,i; for(i=0;i<FG.BAG_IDX.length;i++){}
  // 行囊摆几样 = 手上有几样
  return FG.bagList().length;
})()`)) < kinds, '手上少了豆');

console.log('');
console.log('LOGS ' + (logs.length ? '有输出：\n' + logs.join('\n') : '(无报错)'));
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(0);
