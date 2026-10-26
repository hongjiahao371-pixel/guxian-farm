// 后山验收：寻洞入谷、六方刻石、集齐那一句、往返与存档。
//
// 这套特意盯住几件「主题专属」的事，因为它们做错了也不报错：
//   后山不产货（读碑不能进篓、不能折钱）
//   后山没有矿石也没有镐子
//   刻石读过就是读过，不长回来
//   六方读齐才给最后那句，少读一方不能给
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9347;
const profile = path.join(tmpdir(), 'guxian-houshan-' + process.pid);

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
      // 必须挑 type==='page'：列表里第一个不一定是页面
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
  await sleep(140);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
async function at(x, y) {
  await ev(`FG.state.player.x=${x}; FG.state.player.y=${y}; FG.state.walkTo=null;`);
  await sleep(170);
}
const hint = () => ev(`document.getElementById('hint').textContent`);

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

const file = pathToFileURL(path.join(ROOT, 'index.html')).href;
await send('Page.navigate', { url: file });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

console.log('— 地图注册 —');
ok('后山注册了', (await ev(`!!FG.MAPS.houshan`)) === true);
ok('后山用的是 houshan.jpg', (await ev(`FG.MAPS.houshan.bg`)) === 'assets/houshan.jpg',
  await ev(`FG.MAPS.houshan.bg`));
ok('后山没有田', (await ev(`!FG.MAPS.houshan.quad`)) === true);
ok('后山没有归家判定', (await ev(`!FG.MAPS.houshan.home`)) === true);
ok('后山没有 NPC', (await ev(`FG.MAPS.houshan.npcs.length`)) === 0);
ok('后山没有钓点也没有采集点',
  (await ev(`FG.SPOTS.houshan.fish.length + FG.SPOTS.houshan.pick.length`)) === 0);

console.log('— 主题专属：后山不是矿洞（硐另开一路）—');
// 这条断言原来扫的是**全局**：「FG 里不该有 ORE / GEAＲ.jue / 铺子里的镐」。
// 5/9 之后那套东西真的存在了（石硐是另一条路，不是后山），于是它变成假失败。
// 老规矩「器物无等级」的守门人其实只在后山这一张图上，判据得跟着收窄到那张图：
// 后山这块地图里不得有任何矿/镐/竖井的字段，后山也拿不到任何矿砂。
const mineish = await ev(`
  (function () {
    var hit = [], k, m = FG.MAPS.houshan;
    // 1) 后山这张图上不许有矿井才有的字段
    for (k in m) if (/rock|ore|shaft|mine|jue|cave|镐|矿|硐/i.test(k)) hit.push('map.' + k);
    // 2) 后山不许有矿石/竖井这类的点位
    var sp = FG.SPOTS.houshan;
    for (k in sp) if (/rock|ore|shaft|mine/i.test(k)) hit.push('spots.' + k);
    // 3) 后山不许动过一块石头：层 1 还是满的 18 块
    return hit.join(',') || '(无)';
  })()
`);
ok('后山这张图上没有矿、没有镐、没有竖井', mineish === '(无)', mineish);
ok('后山没动过硐里的石头（层 1 仍是满的）',
  (await ev(`FG.mineLeft(1)`)) === 18, '剩 ' + await ev(`FG.mineLeft(1)`) + ' / ' + await ev(`FG.MINE.left(1, FG.MINE.floor(1))`) + ' 块');
// 硐确实另开了一路，而且和后山不是同一处
ok('石硐是另一张图，不在后山里', !!(await ev(`FG.MAPS.shidong && FG.MAPS.shidong !== FG.MAPS.houshan`)),
  'shidong=' + await ev(`!!FG.MAPS.shidong`));
ok('后山不进矿（进矿的出口在墟市）',
  (await ev(`(FG.MAPS.houshan.exits||[]).every(function(e){return e.to!=='shidong'})`)) === true,
  JSON.stringify(await ev(`(FG.MAPS.houshan.exits||[]).map(function(e){return e.to})`)));
// 词边界很重要。`machPut` 里「a**chP**ut」的 `chP` 会被无边界正则里的 `hp`
// 命中（大小写不敏感）—— 于是加了机器之后这条冒出来说「有战斗」，
// 而 `FG` 上根本没有一个键是战斗相关的
const noCombat = await ev(`(function(){
  var t=[]; for (var k in FG)
    if (/battle|combat|attack|(^|[^a-z])hp([^a-z]|$)|monster|enemy|fight|战斗|敌人/i.test(k)) t.push(k);
  return t.join(',') || '(无)'; })()`);
ok('没有战斗/血量/敌人这套', noCombat === '(无)', noCombat);

console.log('— 南山的洞口 —');
const cave = JSON.parse(await ev(`
  (function () {
    var e = FG.MAPS.nanshan.exits.filter(function (x) { return x.cave; })[0];
    return JSON.stringify(e ? { at: e.at, r: e.r, to: e.to, spawn: e.spawn, label: e.label } : null);
  })()
`));
ok('南山开了一个洞口出口', !!cave, JSON.stringify(cave));
ok('洞口通往后山', cave && cave.to === 'houshan');
// 洞口那圈不能压到别的东西上：不然 E 键在几个判定之间打架
const home = JSON.parse(await ev(`JSON.stringify(FG.MAPS.nanshan.home)`));
const homeR = await ev(`FG.MAPS.nanshan.homeR`);
const homeD = Math.abs(home[0] - cave.at[0]) + Math.abs(home[1] - cave.at[1]);
ok('洞口判定圈不压到茅舍门口', homeD > homeR, `曼哈顿 ${homeD} > homeR ${homeR}`);
ok('洞口在南山 bushes 坡的空地上（不压田）',
  (await ev(`(function(){var g=FG.FIELD; return !g.pick(${cave.at[0]}, ${cave.at[1]});})()`)) === true);

await at(cave.at[0], cave.at[1] + 4);
await sleep(250);
ok('洞口有进入提示', (await hint()).indexOf('山口') >= 0, await hint());
await shot('20-南山洞口.png');

console.log('— 钻进洞里 —');
await key('e');
await sleep(1100);
ok('已切到后山', (await ev(`FG.state.map`)) === 'houshan', await ev(`FG.state.map`));
ok('HUD 换成后山', (await ev(`document.getElementById('hud-map').textContent`)) === '南山后',
  await ev(`document.getElementById('hud-map').textContent`));
ok('后山 FIELD.on 为 false', (await ev(`FG.FIELD.on`)) === false);
// 画石头、走竖井全挂在 inMine() 上。这道闸要是松了，后山就会凭空长出石头来 ——
// 而那恰恰是当初「后山不是矿洞」那套主题专属的底线
ok('站在后山时不算法在硐里', (await ev(`FG.inMine()`)) === false,
  'map=' + await ev(`FG.state.map`) + ' inMine=' + await ev(`FG.inMine()`));
ok('后山也不出矿砂（硐里的石头一块没少）', (await ev(`FG.mineLeft(1)`)) === 18,
  '剩 ' + await ev(`FG.mineLeft(1)`) + ' 块');
ok('落地给了洞口那句', (await ev(`!!FG.state.album.taoyuanMouth`)) === true,
  'day=' + await ev(`FG.state.album.taoyuanMouth`));
await shot('21-后山全景.png');

console.log('— 六方刻石：坐标与圈距 —');
const steles = JSON.parse(await ev(`JSON.stringify(FG.STELES)`));
ok('六方刻石', steles.length === 6, steles.map(s => s.id).join('/'));
const B = JSON.parse(await ev(`JSON.stringify(FG.MAPS.houshan.bounds)`));
ok('刻石全落在可行走带里',
  steles.every(s => s.at[0] >= B.x0 && s.at[0] <= B.x1 && s.at[1] >= B.y0 && s.at[1] <= B.y1),
  steles.map(s => s.at.join(',')).join(' / '));
let minD = 1e9, minPair = '';
for (let i = 0; i < steles.length; i++) {
  for (let j = i + 1; j < steles.length; j++) {
    const d = Math.abs(steles[i].at[0] - steles[j].at[0]) + Math.abs(steles[i].at[1] - steles[j].at[1]);
    if (d < minD) { minD = d; minPair = steles[i].id + '/' + steles[j].id; }
  }
}
// 判定半径 130（曼哈顿）。两圈要是压在一起，站在中间按 E 读到哪一块
// 全看谁更近，玩家会觉得石头的位置没定准
ok('两块石头的判定圈不重叠', minD > 130, `最近一对 ${minPair} 相距 ${minD}`);
const exH = JSON.parse(await ev(`JSON.stringify(FG.MAPS.houshan.exits[0])`));
ok('后山出口和刻石不打架',
  steles.every(s => Math.abs(s.at[0] - exH.at[0]) + Math.abs(s.at[1] - exH.at[1]) > 130),
  `出口 ${exH.at.join(',')}`);

console.log('— 一块一块读 —');
const gold0 = await ev(`FG.state.gold`);
for (let i = 0; i < steles.length; i++) {
  const s = steles[i];
  // 提在循环体最前面：末句那个分支不在 if 里面，块内 const 到那儿就没了
  let t0 = '';
  await at(s.at[0], s.at[1] + 20);
  await sleep(200);
  const h = await hint();
  if (i < steles.length - 1) {
    if (h.indexOf('读' + s.name) < 0) { ok('刻石 ' + s.id + ' 有读碑提示', false, h); continue; }
    await key('e');
    await sleep(280);
    const read = await ev(`!!FG.state.steles["${s.id}"]`);
    const got = await ev(`!!FG.state.album["st_${s.id}"]`);
    const line = s.v;
    t0 = await ev(`document.getElementById('toast').textContent`);
    ok('读 ' + s.id + '：字上留了记号', read === true);
    ok('读 ' + s.id + '：诗册收了对应那一句', got === true);
    ok('读 ' + s.id + '：浮字给的是原句', t0.indexOf(line) >= 0, t0.slice(0, 40));
    if (i === 0) await shot('22-读碑.png');
  } else {
    // 最后一块：读齐六方，那句「不足为外人道也」必须这时候才给
    await key('e');
    await sleep(280);
    t0 = await ev(`document.getElementById('toast').textContent`);
    ok('读 ' + s.id + '：诗册收了对应那一句', (await ev(`!!FG.state.album["st_jiu"]`)) === true);
    console.log('  末句浮字 =', t0);
  }
  // 读碑不能变成「捡东西」：不进篓、不折钱
  const pouch = JSON.parse(await ev(`JSON.stringify(FG.state.pouch)`));
  ok('读 ' + s.id + '：没往篓里塞东西',
   Object.keys(pouch).length === 0, JSON.stringify(pouch));
  ok('读 ' + s.id + '：没折成钱', (await ev(`FG.state.gold`)) === gold0,
   `${gold0} -> ${await ev(`FG.state.gold`)}`);
}

const seen = await ev(`FG.TAOYUAN.steles.filter(function(i){return FG.state.steles[i];}).length`);
ok('六方都读过了', seen === 6, seen + '/6');
ok('读齐才给最后那句', (await ev(`!!FG.state.album.taoyuanSecret`)) === true);

console.log('— 读过就不会再有字 —');
await at(steles[0].at[0], steles[0].at[1] + 20);
await sleep(250);
ok('读过之后提示改成「字已读过」', (await hint()).indexOf('字已读过') >= 0, await hint());
const earnedBefore = await ev(`Object.keys(FG.state.album).length`);
await key('e');
await sleep(300);
ok('再读一次还能看到原句',
  (await ev(`document.getElementById('toast').textContent`)).indexOf(steles[0].v) >= 0);
ok('再读一次不重复收句', (await ev(`Object.keys(FG.state.album).length`)) === earnedBefore,
  `${earnedBefore} -> ${await ev(`Object.keys(FG.state.album).length`)}`);

console.log('— 后山没有田也没有家，但天黑照样结算 —');
const g2 = await ev(`FG.state.gold`);
await ev(`FG.state.min = FG.DAY.END - 1`);
await ev(`FG.endDay()`);   // 天黑不再自动结算 —— 显式走结算
await sleep(1900);
ok('天黑弹出结算', (await ev(`!document.getElementById('de').classList.contains('hide')`)) === true);
const body = await ev(`document.querySelector('#de .body').textContent`);
ok('后山结算不提浇水', body.indexOf('浇水') < 0, body.replace(/\s+/g, ' ').slice(0, 90));
console.log('  结算 =', body.replace(/\s+/g, ' ').slice(0, 120));
ok('读碑不给钱', (await ev(`FG.state.gold`)) === g2, `${g2} -> ${await ev(`FG.state.gold`)}`);
await ev(`FG.nextDay()`);
await sleep(600);
ok('过完一天还能回到后山', (await ev(`FG.state.map`)) === 'houshan', await ev(`FG.state.map`));

console.log('— 诗册：后山这一组按进谷顺序排 —');
// 用 CDP 真发按键，别用 new KeyboardEvent 合成。
// 合成事件走的是 document，而键位处理挂在 window 上，
// 就算冒泡能过去，core.js 那边归一化出来的键名也不一定对得上 ——
// 症状是「测试说面板没开」，去翻代码却看不出毛病。
await key('v');
await sleep(500);
ok('诗册打开了', (await ev(`!document.getElementById('al').classList.contains('hide')`)) === true);
const alTxt = await ev(`document.getElementById('al-list').textContent`);
const seq = ['山有小口', '初极狭', '土地平旷', '阡陌交通', '往来种作', '垂髫', '便要还家', '不足为外人道'];
let cur = -1, ordered = true;
for (const s of seq) {
  const p = alTxt.indexOf(s);
  if (p < 0) { ok('诗册里有「' + s + '」', false); ordered = false; break; }
  if (p <= cur) { ordered = false; break; }
  cur = p;
}
ok('八句齐全且按渔人进谷的先后排', ordered);
// 句数从 data.js 读，不写死。后山这套写死过 25 句，
// 后来加了「送酒换的那一句」就变成 26 了 —— 假失败，不是回归
ok('诗册里后山这八句都在，总句数是 ' + (await ev(`FG.ALBUM.length`)) + ' 句',
  (await ev(`FG.ALBUM.length`)) >= 25, await ev(`FG.ALBUM.length`));
await shot('23-诗册.png');
await ev(`document.getElementById('al-x').click()`);
await sleep(250);

console.log('— 出口回南山 —');
await at(exH.at[0], exH.at[1] + 20);
await sleep(220);
ok('后山出口有提示', (await hint()).indexOf('出洞') >= 0, await hint());
await key('e');
await sleep(1100);
ok('回到南山', (await ev(`FG.state.map`)) === 'nanshan', await ev(`FG.state.map`));
ok('落点在洞口边而不是别的什么地方',
  (await ev(`Math.abs(FG.state.player.x - ${cave.at[0]}) + Math.abs(FG.state.player.y - ${cave.at[1]})`)) < 200,
  `落点 ${await ev(`FG.state.player.x`)},${await ev(`FG.state.player.y`)} 洞口 ${cave.at.join(',')}`);

console.log('— 存档往返：字不会长回来 —');
await ev(`FG.saveGame()`);
await sleep(300);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('cont')`);
await sleep(1000);
ok('读档后六方仍是读过的', (await ev(`Object.keys(FG.state.steles).length`)) === 6,
  Object.keys(JSON.parse(await ev(`JSON.stringify(FG.state.steles)`))).join(','));
ok('读档后诗册里后山那八句都还在',
  (await ev(`['taoyuanMouth','st_kou','st_tian','st_qian','st_zhong','st_fa','st_jiu','taoyuanSecret']
    .filter(function(k){return FG.state.album[k];}).length`)) === 8);

console.log('— 年结报刻石 —');
await ev(`FG.state.day = 144`);
await ev(`FG.nextDay()`);
await sleep(700);
const yb = await ev(`document.querySelector('#de .body').textContent`);
ok('年结算报了读过多少方刻石', yb.indexOf('方刻石') >= 0,
  yb.replace(/\s+/g, ' ').slice(0, 140));
ok('跨年后诗册不清空', (await ev(`!!FG.state.album.taoyuanSecret`)) === true);
await shot('24-年结.png');

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? `FAILED ${fails}` : 'DONE');
