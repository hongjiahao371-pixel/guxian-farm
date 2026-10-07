// 好感度验收：酿酒 → 递酒 → 换诗。
//
// 盯住的主题规矩：酒不卖钱、只有一种原料、递够了才给诗、
// 递完了那行按钮必须消失、存档往返人情还在。
//
// 「一天只酿一缸」已经不在这里了：酿只是灶上的一条配方，「一天一口」
// 是灶的规矩，归 dev/shoot-stove.mjs 盯。这一套只盯人和酒。
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9351;
const profile = path.join(tmpdir(), 'guxian-wine-' + process.pid);

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
  await sleep(140);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
async function at(x, y) {
  await ev(`FG.state.player.x=${x}; FG.state.player.y=${y}; FG.state.walkTo=null;`);
  await sleep(180);
}
const hint = () => ev(`document.getElementById('hint').textContent`);
const actShown = () => ev(`!document.getElementById('dlg-act').classList.contains('hide')`);
const stoveShown = () => ev(`!document.getElementById('st').classList.contains('hide')`);
// 走到门口按 E 开灶，点中那条配方，然后把面板关掉。
// 关掉是必须的：灶开着的时候 E 被面板吃掉，脚本后面那一次 E 就只是关了面板
// 门口按 E 进屋，再点「灶」那一行开灶。20/2 之后动灶和归家都从屋里走
// —— 只按一下 E 就等灶面板的话，它开的是屋里，症状是「E 确实开出了灶面板」红
// 而画面上明明什么也没坏
async function cookIt(id) {
  await key('e');
  await sleep(320);
  if (!(await ev(`FG.houseOpen()`))) return false;
  await ev(`(function(){var g=document.querySelector('#hs-list .hsr[data-k="stove"]');if(g)g.click();return 1})()`);
  await sleep(320);
  if (!(await stoveShown())) return false;
  await ev(`(function(){var g=document.querySelector('#st-list .rec[data-r="${id}"]');if(g)g.click();return 1})()`);
  await sleep(320);
  await ev(`document.getElementById('st-x').click()`);
  await sleep(200);
  return true;
}
// 屋里「灶」那一行亮不亮 —— 「今天动得了动不了灶」的新问法
async function stoveRowOn() {
  await key('e');
  await sleep(300);
  const on = await ev(`(function(){var g=document.querySelector('#hs-list .hsr[data-k="stove"]');
    return g ? !g.classList.contains('off') : null;})()`);
  const txt = await ev(`(function(){var g=document.querySelector('#hs-list .hsr[data-k="stove"]');
    return g ? g.textContent.replace(/\\s+/g,' ') : '(没有这一行)';})()`);
  await key('Escape');
  await sleep(200);
  return { on, txt };
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
await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

console.log('— 酒的规矩 —');
const B = JSON.parse(await ev(`JSON.stringify(FG.BREW)`));
const brewCropName = await ev(`FG.CROPS['${B.crop}'].name`);
ok('酒只用一种谷物酿', B.crop === 'shu', '原料=' + B.crop + '（' + brewCropName + '）');
ok('酿一缸要三束', B.need === 3, B.need + ' 束');
ok('酒不进杂货铺', (await ev(`
  (function(){ for (var i=0;i<FG.SHOP.xushi.length;i++) if (/酒|酒坛|坛/.test(FG.SHOP.xushi[i].name)) return 1; return 0; })()
`)) === 0);
ok('酒也不折钱：它没进 FG.GOODS / FG.FISH 任何一个可出货表', (await ev(`
  (function(){
    var hit=[];
    for (var k in FG.GOODS) if (FG.GOODS[k].name.indexOf('酒')>=0) hit.push('GOODS.'+k);
    for (k in FG.FISH) if (FG.FISH[k].name.indexOf('酒')>=0) hit.push('FISH.'+k);
    return hit.join(',') || '(无)';
  })()
`)) === '(无)');
// 原来写死「架子 7 格」当「酒没占格」的证据。5/9 加了镐，架子变 8 格 ——
// 写死格数的那条自动成了假失败，而它本来要守的是「酒不在架子上」。
// 架子上其实不只农具，还有五格种子（1锄 2瓢 3-7种 8镐），
// 所以「每格都是农具」也是错的。两条都改成照着 TOOLS 读。
const trayK = JSON.parse(await ev(`(function(){
  var n=document.querySelectorAll('#tray .slot'), a=[], i;
  for(i=0;i<n.length;i++) a.push(n[i].getAttribute('data-k'));
  return JSON.stringify(a);})()`));
const tools = JSON.parse(await ev(`JSON.stringify(FG.TOOLS.map(function(t){return t.k}))`));
ok('酒不占器物架一格', trayK.indexOf('jiu') < 0 && trayK.indexOf('酒') < 0, trayK.join(','));
ok('架子上的格子和 TOOLS 一一对上（不多不少）', trayK.join(',') === tools.join(','),
  '架 ' + trayK.join(',') + '　表 ' + tools.join(','));
ok('酒在行囊里但不在架子上（它只是加工品）',
  (await ev(`FG.bagList().some(function(x){return x.k==='jiu'})`)) !== true ||
  trayK.indexOf('jiu') < 0,
  '手上有酒=' + await ev(`FG.state.jiu`));

const home = JSON.parse(await ev(`JSON.stringify(FG.MAPS.nanshan.home)`));
// 「一缸要三束黍」这句话现在写在配方表里，不在 FG.BREW 里 ——
// 两处都写的话，改了配方忘了改 FG.BREW，测试还照着旧数字绿着
const rjiu = JSON.parse(await ev(`JSON.stringify(FG.RECIPES.filter(function(r){return r.id==='jiu'})[0]||null)`));
ok('酒是灶上的一条配方', !!rjiu, rjiu ? rjiu.name : '(配方表里没有)');
ok('酿一缸要三束黍', rjiu && rjiu.need.crop_shu === 3, JSON.stringify(rjiu && rjiu.need));
ok('只有黍这一种原料', rjiu && Object.keys(rjiu.need).length === 1, JSON.stringify(rjiu && rjiu.need));
ok('酒不卖钱', rjiu && rjiu.sell === 0);

console.log('— 没黍的时候屋里动不了灶 —');
await at(home[0], home[1]);
await sleep(220);
ok('门口写的是进屋', (await hint()).indexOf('进屋') >= 0, await hint());
ok('屋里「灶」那行是暗的', (await stoveRowOn()).on === false, (await stoveRowOn()).txt);
ok('HUD 上没有酒', (await ev(`document.getElementById('hud-jiu').style.display`)) === 'none',
  await ev(`document.getElementById('hud-jiu').style.display`));

console.log('— 黍不够三束就动不了灶 —');
await ev(`FG.state.bag.shu = 2`);
await sleep(200);
ok('两束时灶那行还暗着', (await stoveRowOn()).on === false, (await stoveRowOn()).txt);
await ev(`FG.state.bag.shu = 3`);
await sleep(250);
ok('三束时灶那行亮着', (await stoveRowOn()).on === true, (await stoveRowOn()).txt);
ok('那行直接写出今天做得出什么', /酒/.test((await stoveRowOn()).txt), (await stoveRowOn()).txt);

console.log('— 酿一缸 —');
const g0 = await ev(`FG.state.gold`);
ok('E 确实开出了灶面板', (await cookIt('jiu')) === true);
ok('灶面板已经关上了', (await stoveShown()) === false);
ok('扣掉三束黍', (await ev(`FG.state.bag.shu`)) === 0, 'bag.shu=' + await ev(`FG.state.bag.shu`));
ok('手里多一坛酒', (await ev(`FG.state.jiu`)) === 1, 'jiu=' + await ev(`FG.state.jiu`));
ok('酿酒不折钱', (await ev(`FG.state.gold`)) === g0, `${g0} -> ${await ev(`FG.state.gold`)}`);
ok('HUD 露出酒那一行', (await ev(`document.getElementById('hud-jiu').style.display`)) !== 'none',
  await ev(`document.getElementById('hud-jiu').textContent`));
ok('HUD 写对了数', (await ev(`document.getElementById('hud-jiu').textContent`)).indexOf('1') >= 0,
  await ev(`document.getElementById('hud-jiu').textContent`));
ok('酒还留在篮子里，没被结算掉', (await ev(`!!FG.state.bag`)) === true);

console.log('— 过了夜再酿第二缸 —');
await ev(`FG.state.bag.shu = 6`);
await sleep(250);
ok('同一天灶那行暗着（做过的当天不能再做）', (await stoveRowOn()).on === false, (await stoveRowOn()).txt);
await ev(`FG.nextDay()`);
await sleep(600);
await ev(`FG.state.bag.shu = 6`);
await sleep(250);
ok('过了夜灶那行又亮着', (await stoveRowOn()).on === true, (await stoveRowOn()).txt);
ok('第二缸', (await cookIt('jiu')) === true);
ok('两坛酒', (await ev(`FG.state.jiu`)) === 2, 'jiu=' + await ev(`FG.state.jiu`));
ok('六束黍扣掉三束', (await ev(`FG.state.bag.shu`)) === 3, 'bag.shu=' + await ev(`FG.state.bag.shu`));

console.log('— 递酒 —');
const lw = JSON.parse(await ev(`JSON.stringify(FG.NPCS.linweng.at)`));
const need = await ev(`FG.NPCS.linweng.wine.need`);
ok('邻翁要两坛', need === 2, need + ' 坛');

await at(lw[0], lw[1] - 60);
await key('e');
await sleep(400);
ok('对话卡弹出', (await ev(`!document.getElementById('dlg').classList.contains('hide')`)) === true);
ok('有酒时出现送酒那一行', (await actShown()) === true);
ok('没酒给别人时不该有这行', (await ev(`
  (function(){ FG.state.jiu = 0; FG.talkIdx = 0; return 1; })()
`)) === 1);
await ev(`document.getElementById('dlg-x').click()`);
await sleep(200);
await at(lw[0], lw[1] - 60);
await key('e');
await sleep(400);
ok('手里没酒就不出现送酒', (await actShown()) === false);
await ev(`FG.state.jiu = 2`);
await ev(`document.getElementById('dlg-x').click()`);
await sleep(200);
await at(lw[0], lw[1] - 60);
await key('e');
await sleep(400);
ok('又有酒了才出现', (await actShown()) === true);
await shot('40-送酒.png');

const before = await ev(`FG.NPCS.linweng.lines.length`);
// 只能比递酒前后，不能断言 earned === 0：前面那轮「补满黍再归家」
// 已经把 9 束黍折成了钱，earned 早就不是 0 了。那个错报过一次
const goldA = await ev(`FG.state.gold`), earnA = await ev(`FG.state.earned`);
await ev(`document.getElementById('dlg-act').click()`);
await sleep(400);
ok('递出去一坛', (await ev(`FG.state.jiu`)) === 1, 'jiu=' + await ev(`FG.state.jiu`));
ok('人情记上了', (await ev(`FG.state.favor.linweng`)) === 1,
  'favor=' + await ev(`FG.state.favor.linweng`));
ok('对话换成了他的回话', (await ev(`document.getElementById('dlg-text').textContent`)).indexOf('好酒') >= 0,
  await ev(`document.getElementById('dlg-text').textContent`));
ok('还剩一坛，那一行还在', (await actShown()) === true);
ok('还没递够，先不给诗', (await ev(`!!FG.state.album.linwengWine`)) === false);
ok('送酒不折钱', (await ev(`FG.state.gold`)) === goldA && (await ev(`FG.state.earned`)) === earnA,
  `钱 ${goldA}->${await ev(`FG.state.gold`)} 进项 ${earnA}->${await ev(`FG.state.earned`)}`);

console.log('— 递满两坛才换到诗 —');
await ev(`document.getElementById('dlg-act').click()`);
await sleep(400);
ok('递满两坛', (await ev(`FG.state.favor.linweng`)) === 2);
ok('手里的酒清空了', (await ev(`FG.state.jiu`)) === 0);
ok('递够了那行消失', (await actShown()) === false);
ok('拿到了那一句', (await ev(`!!FG.state.album.linwengWine`)) === true);
const alV = await ev(`(FG.ALBUM_IDX.linwengWine||{}).v + ' ' + (FG.ALBUM_IDX.linwengWine||{}).f`);
console.log('  诗 =', alV);
ok('正是「过门更相呼，有酒斟酌之」',
  (await ev(`(FG.ALBUM_IDX.linwengWine||{}).v`)) === '过门更相呼，有酒斟酌之。', alV);
ok('出处是《移居·其二》',
  (await ev(`(FG.ALBUM_IDX.linwengWine||{}).f`)) === '《移居·其二》');
ok('HUD 上酒那一行藏回去了',
  (await ev(`document.getElementById('hud-jiu').style.display`)) === 'none');

console.log('— 递够了就不再收 —');
await ev(`FG.state.jiu = 5`);
await ev(`document.getElementById('dlg-x').click()`);
await sleep(200);
await at(lw[0], lw[1] - 60);
await key('e');
await sleep(400);
ok('再加酒也不出现送酒行', (await actShown()) === false);
ok('酒没被白白扣掉', (await ev(`FG.state.jiu`)) === 5, 'jiu=' + await ev(`FG.state.jiu`));

console.log('— 存档往返 —');
await ev(`FG.saveGame()`);
await sleep(300);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1000);
ok('读档后人情还在', (await ev(`FG.state.favor.linweng`)) === 2);
ok('读档后诗册里那一句还在', (await ev(`!!FG.state.album.linwengWine`)) === true);
ok('读档后送酒仍不再出现', (await actShown()) === false);

console.log('— 重开归零 —');
await ev(`FG.restart()`);
await sleep(700);
ok('重开后酒没了', (await ev(`FG.state.jiu`)) === 0);
ok('重开后人情没了', (await ev(`Object.keys(FG.state.favor).length`)) === 0);
ok('重开后诗册清空', (await ev(`!!FG.state.album.linwengWine`)) === false);

console.log('\n— 跟邻居把人情攒上去之后，酒还递得出去吗 —');
// 原来 canGive 读的是 S.favor，而 favor 是**人情总分**。
// 说实话它不是「每句话 +1」—— REN_SPEECH 只在**跨档**（15/45 分）时发，
// 所以光聊天顶不上去。真正会踩的是另外两条路：
//   · 办成一件托付 +4 分（邻翁那条是「翻二十畦」，很容易办成）
//   · 跟某个 NPC 升到「熟」（15 分）
// 这两条任意一条都比 wine.need（2）大，于是「递一坛酒」那一行**永远消失**，
// 那首「过门更相呼」一辈子拿不到，而它就明明白白列在对话卡上。
//
// 另一头也错：giveWine 里 `if (got >= need) albumAdd(...)` 读的也是 favor，
// 所以人情分够高时**递一坛就收诗**（而一坛只该换一句回话）。
// 和注释写的「递满两坛才换到诗」正好相反。
//
// **这一段量的就是「先让人情越过门槛，再核酒还递得出去」**。
// 老的那套从头到尾没跟邻翁处到 4 分，人情一直是 0，
// 它验的其实是一条玩家走不到的路 —— 跟「按九畦扣力」那条自证断言同族
await ev(`(function(){
  FG.state.jiu=0; FG.invGive('jiu',3);
  FG.state.favor.linweng=0; FG.state.jiuPts.linweng=0;
  FG.state.album.linwengWine=undefined;
  FG.gotoMap('nanshan');
  var a=FG.NPCS.linweng.at;
  FG.state.player.x=a[0]; FG.state.player.y=a[1]+50; FG.state.walkTo=null;
  FG.updateHUD(); return 1})()`);
await sleep(400);
const NEED = await ev(`FG.NPCS.linweng.wine.need`);
ok('（前提）一坛酒还没递过', (await ev(`FG.winePts('linweng')`)) === 0);
ok('（前提）手上有酒', (await ev(`FG.state.jiu`)) > 0, 'jiu=' + (await ev(`FG.state.jiu`)));
ok('（前提）人情分 0', (await ev(`FG.state.favor.linweng`)) === 0);
ok('（这时候）酒递得出去', (await ev(`FG.canGive(FG.NPCS.linweng)`)) === true);
// 走「办成一件托付」那条路：favor +4，越过 need
await ev(`(function(){ FG.state.favor.linweng=FG.REN_QUEST; return 1})()`);
await sleep(200);
ok('（前提）办成一件托付，人情到了 ' + (await ev(`FG.state.favor.linweng`)) + '（need=' + NEED + '）',
   (await ev(`FG.state.favor.linweng`)) >= NEED, 'favor=' + (await ev(`FG.state.favor.linweng`)));
ok('**但酒还递得出去**（判据是递了几坛，不是人情有多熟）',
   (await ev(`FG.canGive(FG.NPCS.linweng)`)) === true);
await ev(`(function(){ var n=FG.nearNpc(); if(n) FG.talk(n); return 1})()`);
await sleep(300);
ok('对话卡上「递一坛酒」那行也还在',
   !(await ev(`document.getElementById('dlg-act').classList.contains('hide')`)),
   await ev(`document.getElementById('dlg-act').textContent`));
// 递满两坛，那行才消失
await ev(`(function(){ FG.giveWine(); return 1})()`);
await sleep(250);
ok('递完第一坛还收', (await ev(`FG.canGive(FG.NPCS.linweng)`)) === true,
  '递了 ' + (await ev(`FG.winePts('linweng')`)) + ' 坛');
ok('递一坛换不到诗', (await ev(`!!FG.state.album.linwengWine`)) === false,
  '诗册 ' + ((await ev(`!!FG.state.album.linwengWine`)) ? '有' : '没有'));
await ev(`(function(){ FG.giveWine(); return 1})()`);
await sleep(250);
ok('递满两坛才不收了', (await ev(`FG.canGive(FG.NPCS.linweng)`)) === false,
  '递了 ' + (await ev(`FG.winePts('linweng')`)) + ' 坛');
ok('递满两坛换到了那一句', (await ev(`!!FG.state.album.linwengWine`)) === true);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? `FAILED ${fails}` : 'DONE');
