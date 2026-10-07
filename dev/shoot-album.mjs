// 诗册验收：做的事对应收一句诗、出处带全、浮字不跟面板打架、跨年留着、存得住。
//
// 这一套盯的是「收句的钩子有没有真的接在动作上」。诗册最典型的失败不是写错句子，
// 而是某处该收的地方根本没调 —— 界面上一切正常，只是册子永远少一句，没人会发现。
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9339;
const profile = path.join(tmpdir(), 'guxian-album-' + process.pid);

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
    const n = ++id;
    pending.set(n, { res, rej });
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
  await sleep(130);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
async function at(x, y) {
  await ev(`FG.state.player.x=${x}; FG.state.player.y=${y}; FG.state.walkTo=null;`);
  await sleep(150);
}
async function clickCell(col, row) {
  const pt = JSON.parse(await ev(`(()=>{const r=document.getElementById('game').getBoundingClientRect();
    const c=FG.FIELD.cellCenter(${col},${row});
    return JSON.stringify({x:r.left+c[0]/1920*r.width, y:r.top+c[1]/1080*r.height});})()`));
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  }
  await sleep(110);
}
const toastText = () => ev(`document.getElementById('toast').textContent`);
/* 收句的浮字是延后弹的（要排在动作提示和当日诗后面），
   所以不能读一次就下结论 —— 得轮询着等它出现。 */
async function waitToast(sub, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 6000)) {
    const s = await toastText();
    if (s.indexOf(sub) >= 0) return s;
    await sleep(150);
  }
  return await toastText();
}
const hintText = () => ev(`document.getElementById('hint').textContent`);
const albumOf = () => ev(`JSON.stringify(FG.state.album)`);
const has = k => ev(`!!FG.state.album["${k}"]`);

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
const file = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
await send('Page.navigate', { url: file });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

console.log('— 空册子 —');
ok('开局诗册是空的', (await albumOf()) === '{}', await albumOf());
// 句数不能写死。后山那八句加进来之后这里就报过假失败
// （断言「有十七句」，实际 25 —— 改的是诗册，又不是回归）。
// 真正该守的是「表里的句数和面板上写的一致」，两边都从 data.js 读。
const N = await ev(`FG.ALBUM.length`);
ok('诗册表有 ' + N + ' 句', N > 0, N);
// 每一句都必须自带出处，且出处要指到具体的篇，不能只写「陶渊明」
const noFrom = JSON.parse(await ev(`JSON.stringify(FG.ALBUM.filter(a=>!a.f||a.f.indexOf('《')<0).map(a=>a.k))`));
ok('每一句都标了具体篇名', noFrom.length === 0, noFrom.join(',') || '全都有');
const dupV = JSON.parse(await ev(`JSON.stringify((function(){
  var seen={}, dup=[];
  for (var i=0;i<FG.ALBUM.length;i++){ if(seen[FG.ALBUM[i].v]) dup.push(FG.ALBUM[i].v); seen[FG.ALBUM[i].v]=1; }
  return dup; })())`));
ok('没有重复的句子', dupV.length === 0, dupV.join(' / ') || '互不相同');

console.log('\n— V 键 —');
await key('v');
await sleep(300);
ok('V 打开诗册', (await ev(`!document.getElementById('al').classList.contains('hide')`)) === true);
ok('空册子给了句话', (await ev(`document.getElementById('al-list').textContent`)).indexOf('空的') >= 0,
   (await ev(`document.getElementById('al-list').textContent`)).replace(/\s+/g, ' ').slice(0, 60));
ok('面板写明一共 ' + N + ' 句', (await ev(`document.getElementById('al-list').textContent`)).indexOf(N + ' 句') >= 0,
  (await ev(`document.getElementById('al-list').textContent`)).replace(/\s+/g, ' ').slice(-40));
await shot('30-空诗册.png');
// 面板开着的时候别把游戏键吞了之外的东西放进来：E 不该触发对话
await key('v');
await sleep(250);
ok('再按 V 关上', (await ev(`document.getElementById('al').classList.contains('hide')`)) === true);

console.log('\n— 做事收句 —');
await key('1');                       // 锄
await clickCell(1, 2);
ok('锄一畦收了「开荒南野际」', (await has('firstTill')) === true);
// 这条是重点：动作浮字「翻开一畦。」紧跟着就出来了，
// 诗句要是直接弹就会被顶掉，玩家永远看不见自己刚收的句。
const tillToast = await waitToast('诗册得句');
ok('收句的浮字没被动作浮字顶掉', tillToast.indexOf('诗册得句') >= 0, tillToast);
ok('浮字带上了出处', tillToast.indexOf('《归园田居·其一》') >= 0, tillToast);
ok('记下了是哪天收的', (await ev(`FG.state.album.firstTill`)) === 1);

await key('3');                       // 豆种（立春种得下）
await clickCell(1, 2);
ok('下种收了「种豆南山下」', (await has('firstSow')) === true, await toastText());

// 直接把它催熟再收，走的是 harvest 那条真路径
await ev(`(function(){var p=FG.state.plots[2][1]; p.stage=FG.CROPS.dou.days; p.wet=false;})()`);
await key('2');                       // 木瓢
await clickCell(1, 2);
await sleep(200);
ok('浇水时顺手收了「晨兴理荒秽」', (await has('firstHarvest')) === true, await toastText());
ok('篮里有了豆', (await ev(`FG.state.bag.dou`)) === 1, 'dou=' + await ev(`FG.state.bag.dou`));

console.log('\n— 归家那一句要等面板关了再弹 —');
// 浮字在 top:12% 居中，和结算面板是同一个位置。所以收句要攒着，
// 点掉面板的下一个清晨才弹 —— 断言就卡在这个时序上。
const home = JSON.parse(await ev(`JSON.stringify(FG.MAPS.nanshan.home)`));
await at(home[0], home[1]);
await sleep(200);
// 门口按 E 进屋，归家走屋里「床」那一行（20/2 之后）
await key('e');
await sleep(400);
ok('门口按 E 开的是屋里', (await ev(`FG.houseOpen()`)) === true);
await ev(`(function(){ var g=document.querySelector('#hs-list .hsr[data-k="bed"]'); if(g) g.click(); return 1; })()`);
await sleep(500);
ok('结算面板弹了', (await ev(`!document.getElementById('de').classList.contains('hide')`)) === true);
ok('已经记下了「衣沾不足惜」', (await has('firstHome')) === true);
ok('但浮字没跟面板抢位置', (await toastText()).indexOf('诗册得句') < 0, await toastText());
await ev(`document.getElementById('de-next').click()`);
await sleep(300);
// 当日诗先弹，攒着的收句排在它后面（当日诗 4.2 秒才淡出），
// 顶掉当日诗等于两句都看不清 —— 所以这里要等，不能立刻读。
const wakeToast = await waitToast('诗册得句', 7000);
ok('面板一关浮字就出来', wakeToast.indexOf('诗册得句') >= 0, wakeToast);
ok('并且带上了出处', wakeToast.indexOf('《归园田居·其三》') >= 0, wakeToast);
ok('弹完之后不再重复', await ev(`(function(){
  var t=document.getElementById('toast'); t.textContent=''; return true; })()`) &&
   ((await ev(`FG.flushAlbum(), document.getElementById('toast').textContent`)) === ''), '清空后仍是空的');

console.log('\n— 出门见人 —');
await at(132, 902); await sleep(150); await key('e'); await sleep(900);
ok('进了墟市', (await ev(`FG.state.map`)) === 'xushi');
ok('收「暧暧远人村」', (await has('firstMarket')) === true, await toastText());

async function talkTo(npcId) {
  const a = JSON.parse(await ev(`JSON.stringify(FG.NPCS.${npcId}.at)`));
  await at(a[0], a[1] - 70);
  await key('e');
  await sleep(350);
  await ev(`document.getElementById('dlg-x').click()`);
  await sleep(200);
}
await talkTo('qiaofu');
ok('跟樵夫说了话', (await has('firstTalk')) === true);
ok('只见过一个人时不给「奇文共欣赏」', (await has('talkThree')) === false);
await talkTo('caiyaoren');
ok('见了两个人还是不给', (await has('talkThree')) === false);
await talkTo('tongzi');
ok('见了三个人才收「奇文共欣赏」', (await has('talkThree')) === true, await toastText());
ok('见过谁记下来了', (await ev(`JSON.stringify(FG.state.met)`)) === JSON.stringify({ qiaofu: true, caiyaoren: true, tongzi: true }),
   await ev(`JSON.stringify(FG.state.met)`));

console.log('\n— 溪畔 —');
await at(168, 792); await sleep(150); await key('e'); await sleep(900);
ok('回了南山', (await ev(`FG.state.map`)) === 'nanshan');
await at(1800, 664); await key('e'); await sleep(900);
ok('到了溪畔', (await ev(`FG.state.map`)) === 'xipan');
ok('收「云无心以出岫」', (await has('firstXipan')) === true, await toastText());

const picks = JSON.parse(await ev(`JSON.stringify(FG.SPOTS.xipan.pick)`));
const mei = picks.find(s => s.k === 'mei');
await at(mei.at[0], mei.at[1] + 80);
await sleep(220);
await key('e'); await sleep(300);
ok('采到野莓', (await ev(`FG.state.pouch.mei`)) === 1);
ok('收「木欣欣以向荣」', (await has('firstPick')) === true, await toastText());

const fsp = JSON.parse(await ev(`JSON.stringify(FG.SPOTS.xipan.fish)`))[0];
await at(fsp.at[0], fsp.at[1] + 130);
await key('e');
await sleep(200);
ok('抛竿了', (await ev(`!!FG.state.fishing`)) === true);
let waited = 0, phase = 'wait';
while (waited < 6000) { await sleep(70); waited += 70; phase = await ev(`FG.state.fishing ? FG.state.fishing.phase : 'gone'`); if (phase !== 'wait') break; }
ok('等到咬钩', phase === 'bite', `等了 ${waited}ms`);
await key('e'); await sleep(300);
ok('钓上鱼了', Object.values(JSON.parse(await ev(`JSON.stringify(FG.state.pouch)`))).some(v => v > 0),
   await ev(`JSON.stringify(FG.state.pouch)`));
ok('收「登东皋以舒啸」', (await has('firstFish')) === true, await toastText());

console.log('\n— 诗册面板 —');
await key('v'); await sleep(300);
const listTxt = (await ev(`document.getElementById('al-list').textContent`)).replace(/\s+/g, ' ');
console.log('  ' + listTxt.slice(0, 220));
ok('面板列出了已得的句', listTxt.indexOf('开荒南野际') >= 0);
ok('没得到的句子不占位', listTxt.indexOf('采菊东篱下') < 0 && listTxt.indexOf('农务各自归') < 0);
// 逐条点名，别只数个数：个数对了但钩子接错地方，句子的来源会不对
const expectKeys = ['firstTill', 'firstSow', 'firstHarvest', 'firstHome', 'firstMarket',
                    'firstTalk', 'talkThree', 'firstXipan', 'firstPick', 'firstFish'];
let missing = [];
for (const k of expectKeys) if (!(await has(k))) missing.push(k);
ok('十件事都收上了', missing.length === 0, missing.join(',') || expectKeys.length + ' 句全在');
const nGot = await ev(`Object.keys(FG.state.album).length`);
ok('页脚数跟实收一致', listTxt.indexOf('已得 ' + nGot + ' 句') >= 0, '实收 ' + nGot + ' 句');
ok('每条都带出处', ['《归园田居·其一》', '《归园田居·其三》', '《移居·其一》', '《归去来兮辞》']
   .every(s => listTxt.indexOf(s) >= 0));
ok('标了收句的年月', listTxt.indexOf('第 1 年 · 第') >= 0);
await shot('31-诗册.png');
await key('v'); await sleep(200);

console.log('\n— 存档往返 —');
const before = await albumOf();
await ev(`FG.saveGame()`);
await sleep(300);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(900);
ok('读档后诗册原样还在', (await albumOf()) === before, (await albumOf()));

console.log('\n— 跨年不清 —');
// 账本翻年就清，诗册不清 —— 这是设计，别哪天顺手把诗册也清了
await ev(`FG.state.day = FG.SOLAR_YEAR; FG.state.min = FG.DAY.END - 1;`);
await sleep(900);
await ev(`FG.nextDay()`);
await sleep(300);
ok('年结面板出来了', (await ev(`!document.getElementById('de').classList.contains('hide')`)) === true);
ok('年结收「农务各自归」', (await has('yearEnd')) === true);
ok('年结那句带了出处', (await ev(`document.querySelector('#de .v2').textContent`)).indexOf('《移居·其二》') >= 0,
   await ev(`document.querySelector('#de .v2').textContent`));
await ev(`document.getElementById('de-next').click()`);
await sleep(300);
ok('第二年不给「忘怀得失」', (await has('yearEnd2')) === false);
ok('翻年后账本清了', (await ev(`JSON.stringify(FG.state.book.crops)`)) === '{}');
const nAfter = await ev(`Object.keys(FG.state.album).length`);
ok('翻年后诗册没清，还多了一句年结', nAfter > nGot,
   `翻年前 ${nGot} 句 → 翻年后 ${nAfter} 句`);
await ev(`FG.state.day = FG.SOLAR_YEAR * 2; FG.state.min = FG.DAY.END - 1;`);
await sleep(900);
await ev(`FG.nextDay()`);
await sleep(300);
ok('第二年过完才收「忘怀得失」', (await has('yearEnd2')) === true);
ok('年结面板还开着的时候不弹', (await toastText()).indexOf('诗册得句') < 0, await toastText());
await ev(`document.getElementById('de-next').click()`);
await sleep(300);
ok('点掉面板才弹出来', (await waitToast('诗册得句', 7000)).indexOf('《五柳先生传》') >= 0, await toastText());

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? `FAILED ${fails}` : 'DONE');
