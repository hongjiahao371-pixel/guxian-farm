// 节气验收：历法本身、错季种/钓/采、菊跨季成熟、年结与跨年。
//
// 这一套专门盯「节气真的在管事」。之前没有它的时候，加了节气门的三处
// （下种、钓鱼、采集）全都可能写成摆设而不被发现 —— 规则没接上，界面照旧，
// 没有一条断言会红。
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9337;
const profile = path.join(tmpdir(), 'guxian-solar-' + process.pid);

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
      // 必须挑 type==='page'，接错了目标 getElementById 全是 null
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
  await sleep(110);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
async function at(x, y) {
  await ev(`FG.state.player.x=${x}; FG.state.player.y=${y}; FG.state.walkTo=null;`);
  await sleep(140);
}
/* 画布坐标 -> 屏幕坐标再发真鼠标事件。不能用 el.click()，那条路绕过了命中测试。 */
async function clickCell(col, row) {
  const pt = JSON.parse(await ev(`(()=>{const r=document.getElementById('game').getBoundingClientRect();
    const c=FG.FIELD.cellCenter(${col},${row});
    return JSON.stringify({x:r.left+c[0]/1920*r.width, y:r.top+c[1]/1080*r.height});})()`));
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  }
  await sleep(110);
}
/* 把这一畦摆成「翻好土、空着、没种」，返回是否摆成功 */
async function till(col, row) {
  await ev(`(function(){var p=FG.state.plots[${row}][${col}];
    p.tilled=true; p.crop=null; p.stage=0; p.wet=false;})()`);
}
/* 过一夜：走主循环那条 endDay 真路径，不是直接改 day */
async function night(extra) {
  await ev(`(function(){${extra || ''} FG.state.min = FG.DAY.END - 1;})()`);
  await sleep(900);
  await ev(`FG.nextDay()`);
  await sleep(110);
}
const toastText = () => ev(`document.getElementById('toast').textContent`);
const hintText = () => ev(`document.getElementById('hint').textContent`);

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

console.log('— 历法：日子落到哪个节气 —');
// 节气表本身就是这次的核心，一次全查出来，别一条条试
const cal = JSON.parse(await ev(`JSON.stringify((function(){
  var out=[];
  for (var d=1; d<=FG.SOLAR_YEAR+6; d++) out.push(d + ':' + FG.solarOf(d).n);
  return out;
})())`));
const nameAt = dd => (cal[dd - 1] || '').split(':')[1];
ok('一年 144 天', (await ev(`FG.SOLAR_YEAR`)) === 144 && (await ev(`FG.SOLAR.length`)) === 24,
   'SOLAR_YEAR=' + await ev(`FG.SOLAR_YEAR`) + '，节气 ' + await ev(`FG.SOLAR.length`) + ' 个');
ok('开局是立春', nameAt(1) === '立春', '第 1 天 = ' + cal[0]);
ok('每个节气占 6 天', nameAt(6) === '立春' && nameAt(7) === '雨水', '第 6 天 ' + nameAt(6) + ' / 第 7 天 ' + nameAt(7));
ok('立秋在第 73 天', nameAt(73) === '立秋', '第 73 天 = ' + nameAt(73));
ok('霜降在第 103 天', nameAt(103) === '霜降', '第 103 天 = ' + nameAt(103));
ok('大寒收尾在第 144 天', nameAt(144) === '大寒', '第 144 天 = ' + nameAt(144));
ok('第 145 天又是立春', nameAt(145) === '立春', '第 145 天 = ' + nameAt(145));
ok('二十四节气一个不少', new Set(cal.slice(0, 144).map(s => s.split(':')[1])).size === 24,
   new Set(cal.slice(0, 144).map(s => s.split(':')[1])).size + ' 个');

console.log('\n— HUD —');
// 这一格现在是「节气 + 季节」（season 那一项加的），比如「立春春」。
// 判据得是**今天那个节气写在最前面**，不是整格等于节气名 ——
// 拿整格比的话，往这一格里加一行东西就得来改这里一次，而那不是回归
const hudSolar = await ev(`document.getElementById('hud-solar').textContent`);
ok('HUD 开头的节气写对了', hudSolar.indexOf('立春') === 0, hudSolar);
ok('第一年不显示「第几年」', hudSolar.indexOf('年') < 0, hudSolar);
// 物候后面又接了一句这一季的话。所以判「**物候还在**」而不是
// 「title 整句就等于物候」—— 那句季的话是 season 那一项加的
ok('物候挂在 title 上', (await ev(`document.getElementById('hud-solar').title`)).indexOf('东风解冻，鱼陟负冰') === 0,
   await ev(`document.getElementById('hud-solar').title`));
await shot('20-立春.png');

console.log('\n— 错季种不了 —');
// 立春能下的只有豆。粟要谷雨、黍要芒种、稷要小满、菊要立秋。
await till(1, 2); await till(2, 2); await till(3, 2); await till(1, 3); await till(2, 3);
// 种子那本账是按**作物 id**记的（dou/su/shu/ji/ju），不是行囊的表项 key
// （seedD/seedS/…）。写错一个前缀的话 FG.state.seeds 里根本没有 su 这一项，
// 而老代码那句 `S.seeds[sel] <= 0` 判的是 undefined —— `undefined <= 0` 是假的，
// 于是错放行、照样种得下去（再往下 `S.seeds[sel]--` 就把 undefined 减成 NaN）。
// 现在 sowWith 写的是 `(S.seeds[crop] || 0) <= 0`，undefined 归 0，会拦住。
// 拦得对：这里本来就该拦，测试写错 key 不该成为放行的理由
await ev(`FG.state.seeds = { dou: 9, su: 9, shu: 9, ji: 9, ju: 9 };`);
await key('4');                                   // 粟
await clickCell(1, 2);
ok('立春点粟被拦', (await ev(`FG.state.plots[2][1].crop`)) === null, '这畦还是空的');
const m1 = await toastText();
ok('并且说清了是时节不对', m1.indexOf('时节') >= 0, m1);
ok('并且告诉你要等哪个节气', m1.indexOf('谷雨') >= 0, m1);
ok('拦的时候没扣体力', (await ev(`FG.state.stam`)) === (await ev(`FG.state.maxStam`)), '体力=' + await ev(`FG.state.stam`));

await key('7');                                   // 菊
await clickCell(3, 2);
const m2 = await toastText();
ok('立秋才下的菊，立春也拦', (await ev(`FG.state.plots[2][3].crop`)) === null && m2.indexOf('立秋') >= 0, m2);

console.log('\n— 对了节气就种得下 —');
// 推到谷雨（31..36）再试粟。这次不直接改天，而是真的过三十夜，
// 免得「节气门」和「日历」两处各算各的、看着对其实没接上。
for (let i = 0; i < 30; i++) await night();
ok('过完三十夜到了谷雨', (await ev(`FG.solarOf(FG.state.day).n`)) === '谷雨',
   '第 ' + (await ev(`FG.state.day`)) + ' 天 = ' + (await ev(`FG.solarOf(FG.state.day).n`)));
await key('4');
await clickCell(1, 2);
ok('谷雨点粟种下了', (await ev(`FG.state.plots[2][1].crop`)) === 'su', '这畦 = ' + await ev(`FG.state.plots[2][1].crop`));
// 前提：种子真的少了一袋。少了这一条，「种下去了」和「本来就摆着一袋没动过」
// 看着完全一样，而那种情况下后面扣体力、成熟的断言全会跟着歪
ok('（前提是种子真的少了一袋）', (await ev(`FG.state.seeds.su`)) === 8, 'su=' + await ev(`FG.state.seeds.su`));
await key('5');                                   // 黍，芒种才下得下
await clickCell(2, 2);
ok('谷雨点黍还是被拦', (await ev(`FG.state.plots[2][2].crop`)) === null, await toastText());
await shot('21-谷雨.png');

console.log('\n— 菊要跨季 —');
// 立秋下种，三十天长到霜降才开 —— 这是「采菊东篱下」落在真花期的关键，
// 也是唯一能证明「节气管的不只是下种、还管成熟」的一格。
for (let i = 0; i < 18; i++) await night();     // 谷雨 31 → 芒种 49
ok('推进到芒种', (await ev(`FG.solarOf(FG.state.day).n`)) === '芒种', '第 ' + (await ev(`FG.state.day`)) + ' 天');
for (let i = 0; i < 24; i++) await night();     // 芒种 49 → 立秋 73
ok('推进到立秋', (await ev(`FG.solarOf(FG.state.day).n`)) === '立秋', '第 ' + (await ev(`FG.state.day`)) + ' 天');
await till(3, 3);
await key('7');
await clickCell(3, 3);
ok('立秋把菊种下了', (await ev(`FG.state.plots[3][3].crop`)) === 'ju', '这畦 = ' + await ev(`FG.state.plots[3][3].crop`));
// 每天浇一遍，连过 29 夜
for (let i = 0; i < 29; i++) {
  await ev(`(function(){var p=FG.state.plots[3][3]; p.wet=true; FG.state.min=FG.DAY.END-1;})()`);
  await sleep(900);
  await ev(`FG.nextDay()`); await sleep(90);
}
const st29 = await ev(`FG.state.plots[3][3].stage`);
ok('差一夜还没开', st29 < 30, '第 ' + (await ev(`FG.state.day`)) + ' 天，长了 ' + st29 + ' 天（' +
   (await ev(`FG.solarOf(FG.state.day).n`)) + '）');
await ev(`(function(){var p=FG.state.plots[3][3]; p.wet=true; FG.state.min=FG.DAY.END-1;})()`);
await sleep(900);
await ev(`FG.nextDay()`); await sleep(150);
ok('霜降这天开了', (await ev(`FG.solarOf(FG.state.day).n`)) === '霜降' && (await ev(`FG.state.plots[3][3].stage`)) >= 30,
   '第 ' + (await ev(`FG.state.day`)) + ' 天（' + (await ev(`FG.solarOf(FG.state.day).n`)) + '），长了 ' +
   (await ev(`FG.state.plots[3][3].stage`)) + ' 天');
await shot('22-霜降菊.png');

console.log('\n— 鱼按节气 —');
// 拿大暑和霜降两头对夹：大暑是鱼最全的时候（五种齐），霜降只剩鲫虾。
// 之前这里写成「霜降出鳜鱼」，可鳜是惊蛰—秋分，霜降早就收摊了 ——
// 断言反了的话，这条测试只会给错误实现发通行证。
//
// 判据从源码读（FG.canFish），不在这里重写一遍
// `f.fromDay <= d && FG.inTerms(d, f.terms)`。重写的那份少了「夜鱼」那一道，
// 于是加了夜鱼之后「霜降只剩鲫虾」变成五种鱼 —— 而霜降那天
// 白天溪里确实只有鲫虾，是季节断言自己漏了时段那一道。
//
// 「此刻出什么」要连日子和时段一起给：先把这天和这个钟点摆上去，
// 再问 canFish。摆完记得摆回去，后面的段落还按自己的日子走。
const inSeasonOn = async d => {
  // Runtime.evaluate 里顶层写 return 是非法的，要套一层 IIFE
  await ev(`(function(){ FG.state.day=${d}; FG.state.min=FG.DAY.START; return 1; })()`);
  return ev(`(function(){
    var out = [], k;
    for (k in FG.FISH) if (FG.canFish(FG.FISH[k])) out.push(k);
    return out.sort().join(',');
  })()`);
};
const nightOnly = JSON.parse(await ev(`JSON.stringify((function(){
  var a=[],k; for(k in FG.FISH) if(FG.FISH[k].night) a.push(k); return a;})())`));
console.log('  夜鱼 = ' + nightOnly.join(','));
ok('有夜鱼这一族存在', nightOnly.length > 0, nightOnly.join(','));
// 挑一天做对照：同一天同一门手艺，白天一个都钓不到，带月才捞得着
const daySet = await inSeasonOn(103);
ok('白天溪里一个夜鱼都没有', nightOnly.every(k => daySet.split(',').indexOf(k) < 0), daySet);
await ev(`(function(){ FG.state.min=FG.DAY.NIGHT; FG.skillFix(); FG.state.skill.yu.lv=4; return 1; })()`);
const nightSet2 = await ev(`(function(){ var out=[],k; for(k in FG.FISH) if(FG.canFish(FG.FISH[k])) out.push(k); return out.sort().join(','); })()`);
ok('带月 + 渔四级，夜鱼就出来了', nightOnly.every(k => nightSet2.split(',').indexOf(k) >= 0), nightSet2);
// 基准是**当天白天的实际集合**，不是写死的五种 —— 霜降那天鳜鳊鳖本来就收摊，
// 拿它们当基准的话这条断言在第一天就红，而红的原因跟夜钓一点关系都没有
ok('白天的那些一个没少', daySet.split(',').every(k => nightSet2.split(',').indexOf(k) >= 0),
  '白天 ' + daySet + '　带月 ' + nightSet2);
const lv1Night = await ev(`(function(){ FG.skillFix(); FG.state.skill.yu.lv=1;
   var out=[],k; for(k in FG.FISH) if(FG.canFish(FG.FISH[k])) out.push(k); return out.sort().join(','); })()`);
ok('渔没到四级，带月也钓不到夜鱼', lv1Night === daySet, 'lv1 带月 ' + lv1Night + '　白天 ' + daySet);
await ev(`(function(){ FG.state.min=FG.DAY.START; FG.state.skill.yu.lv=1; FG.state.day=103; return 1; })()`);
const SUMMER = 6 * 11 + 1;    // 大暑第一天
// 鲤 terms 到夏至为止，大暑就该没了 —— 原来断言写成「六种齐出」，
// 那是拿星露谷那套「什么季节都能钓」当默认，跟节气玩法正好相反。
ok('大暑五种鱼齐出', (await inSeasonOn(SUMMER)) === 'bian,gui,ji,luo,xia', await inSeasonOn(SUMMER));
ok('大暑鲤鱼收摊', (await inSeasonOn(SUMMER)).indexOf('li') < 0, '鲤 立春—夏至');
ok('夏至鲤鱼还在', (await inSeasonOn(6 * 9 + 1)).indexOf('li') >= 0);
ok('霜降只剩鲫虾', (await inSeasonOn(103)) === 'ji,xia', await inSeasonOn(103));
ok('霜降鳜鱼收摊', (await inSeasonOn(103)).indexOf('luo') < 0);
ok('霜降鳖也收摊', (await inSeasonOn(103)).indexOf('gui') < 0, '鳖 小暑—寒露');
ok('大暑鳖才出来', (await inSeasonOn(SUMMER)).indexOf('gui') >= 0);
ok('大寒六种全歇', (await inSeasonOn(6 * 23 + 1)) === 'ji,xia', await inSeasonOn(6 * 23 + 1));
ok('开局只有溪虾和鲫', (await inSeasonOn(1)) === 'ji,xia', await inSeasonOn(1));

console.log('\n— 当令的鱼要看得见 —');
// 光在背后限鱼不够：玩家站到钓点前，得能一眼看出这个时节出什么。
// 这条断言是照着提示原文写的，不是照着表算的 —— 提示漏了鱼名它就红。
await ev(`FG.gotoMap('xipan', [760, 800])`); await sleep(500);
const spots = JSON.parse(await ev(`JSON.stringify(FG.SPOTS.xipan.fish)`));
const hintFish = async d => {
  await ev(`FG.state.day = ${d};`);
  await at(spots[0].at[0], spots[0].at[1] + 130);
  await sleep(260);
  return hintText();
};
const h1 = await hintFish(103);
ok('霜降的钓点写明了当令的鱼', h1.indexOf('此时有') >= 0, h1);
ok('霜降只推鲫和虾', h1.indexOf('溪虾') >= 0 && h1.indexOf('鲫') >= 0 &&
   h1.indexOf('鳜') < 0 && h1.indexOf('鳊') < 0 && h1.indexOf('鲤') < 0 && h1.indexOf('鳖') < 0, h1);
const h2 = await hintFish(SUMMER);
ok('大暑的钓点推五种鱼', ['溪虾', '鲫', '鳜鱼', '鳊', '鳖'].every(n => h2.indexOf(n) >= 0), h2);
const h3 = await hintFish(145);
ok('立春出得着鲤（鲤 terms 含立春）', h3.indexOf('鲤') >= 0 && h3.indexOf('鳜') < 0, h3);

console.log('\n— 山货按节气 —');
// 上一段为了对比把日子推到了第 145 天，先拨回霜降，否则下面全在测立春
await ev(`FG.state.day = 103;`);
await sleep(200);
const picks = JSON.parse(await ev(`JSON.stringify(FG.SPOTS.xipan.pick)`));
const jun0 = picks.find(s => s.k === 'jun');
const mei0 = picks.find(s => s.k === 'mei');
ok('山菌时节对得上', (await ev(`FG.inTerms(FG.state.day, FG.GOODS.jun.terms)`)) === true,
   '山菌 白露—立冬，今天是 ' + (await ev(`FG.solarOf(FG.state.day).n`)));

// 霜降：山菌在季，采得到
await ev(`FG.gotoMap('xipan', [760, 800])`); await sleep(400);
// 这一段走真的采集流程（站过去、按 E），不只查表。
// 查表只能证明 inTerms 写对了，证明不了它接在了采集这条路上。
await ev(`FG.state.pouch = {}; FG.state.picked = {};`);
await at(jun0.at[0], jun0.at[1] + 80);
await sleep(220);
ok('霜降站到山菌点有采集提示', (await hintText()).indexOf('采山菌') >= 0, await hintText());
await key('e'); await sleep(260);
ok('霜降采得到山菌', (await ev(`FG.state.pouch.jun`)) === 1, 'jun=' + await ev(`FG.state.pouch.jun`));

// 跳到第二年立春：山菌过了季，同一个点采不到
await ev(`FG.state.day = 145;`);
await sleep(260);
await at(jun0.at[0], jun0.at[1] + 80);
await sleep(220);
ok('立春山菌点不再提示', (await hintText()).indexOf('采山菌') < 0, await hintText());
await key('e'); await sleep(260);
ok('立春采不到山菌', (await ev(`FG.state.pouch.jun`)) === 1, 'jun 还是 ' + await ev(`FG.state.pouch.jun`) + '，没多');

// 野莓反过来：立春在季，采得到
await at(mei0.at[0], mei0.at[1] + 80);
await sleep(220);
ok('立春站到野莓点有采集提示', (await hintText()).indexOf('采野莓') >= 0, await hintText());
await key('e'); await sleep(260);
ok('立春采得到野莓', (await ev(`FG.state.pouch.mei`)) === 1, 'mei=' + await ev(`FG.state.pouch.mei`));

// 跳到大暑：野莓过了季
await ev(`FG.state.day = ${6 * 11 + 1};`);     // 第二年大暑
await sleep(260);
await at(mei0.at[0], mei0.at[1] + 80);
await sleep(220);
ok('大暑野莓点不再提示', (await hintText()).indexOf('采野莓') < 0, await hintText());
await key('e'); await sleep(260);
ok('大暑采不到野莓', (await ev(`FG.state.pouch.mei`)) === 1, 'mei 还是 ' + await ev(`FG.state.pouch.mei`) + '，没多');

console.log('\n— 一年过完 —');
// 把账填上再过年结，不然面板只有一句「只翻了土」，等于没测
await ev(`(function(){
  FG.state.day = FG.SOLAR_YEAR;
  FG.state.pouch = {}; FG.state.bag = {};
  FG.state.book.crops.dou = 12; FG.state.book.fish.ji = 5; FG.state.book.picks.mei = 3;
  FG.state.book.casts = 20; FG.state.book.earned = 1234;
  FG.state.min = FG.DAY.END - 1;
})()`);
await sleep(900);
await ev(`FG.nextDay()`);
await sleep(300);
ok('年结面板弹出来了', (await ev(`!document.getElementById('de').classList.contains('hide')`)) === true);
const v2 = await ev(`document.querySelector('#de .v2').textContent`);
const body = await ev(`document.querySelector('#de .body').textContent`);
console.log('  ' + v2);
console.log('  ' + body.replace(/\s+/g, ' ').slice(0, 200));
ok('写明了是第 1 年', v2.indexOf('第 1 年') >= 0, v2);
ok('报了收的谷', body.indexOf('豆 12 束') >= 0);
ok('报了钓的鱼', body.indexOf('鲫 5 尾') >= 0);
ok('报了采的山货', body.indexOf('野莓 3 份') >= 0);
ok('报了抛竿和空手回数', body.indexOf('抛竿 20 次') >= 0 && body.indexOf('空手 15 回') >= 0);
ok('报了一年进项', body.indexOf('一年进项 1234 钱') >= 0);
ok('按钮写的是「明 春」', (await ev(`document.getElementById('de-next').textContent`)) === '明 春',
   await ev(`document.getElementById('de-next').textContent`));
await shot('23-年结.png');

console.log('\n— 续上第二年 —');
ok('日子接到 145', (await ev(`FG.state.day`)) === 145, '第 ' + (await ev(`FG.state.day`)) + ' 天');
ok('成了第 2 年', (await ev(`FG.yearOf(FG.state.day)`)) === 2);
ok('第 145 天又是立春', (await ev(`FG.solarOf(FG.state.day).n`)) === '立春');
ok('年内的第 1 天', (await ev(`FG.dayOfYear(FG.state.day)`)) === 1);
// 逐个字段查，不要拿整个对象做深比较。往账本里加一个字段（比如后山的刻石计数），
// 深比较立刻报失败 —— 那是加了内容，不是账没换新。
ok('账本换新了：三个分类都清了', (await ev(`
  (function(){ var b=FG.state.book;
    return Object.keys(b.crops).length===0 && Object.keys(b.fish).length===0 && Object.keys(b.picks).length===0; })()
`)) === true, await ev(`JSON.stringify(FG.state.book)`));
ok('账本换新了：计数归零、起止日都落到 145', (await ev(`
  (function(){ var b=FG.state.book;
    return b.casts===0 && b.earned===0 && b.first===145 && b.last===145; })()
`)) === true, await ev(`JSON.stringify(FG.state.book)`));
ok('账本换新了：刻石计数也归零', (await ev(`FG.state.book.steles === 0`)) === true);
const hud2 = await ev(`document.getElementById('hud-solar').textContent`);
ok('HUD 开始显示年第 2 年', hud2.indexOf('立春') >= 0 && hud2.indexOf('第2年') >= 0, hud2);
ok('第二年立春还是种得下豆', (await ev(`FG.inTerms(145, FG.CROPS.dou.terms)`)) === true);
ok('第二年立春依然种不下菊', (await ev(`FG.inTerms(145, FG.CROPS.ju.terms)`)) === false);

// 点「明 春」进第二年第一个清晨
const morningBeforeYearConfirm = await ev(`JSON.stringify({keep:FG.state.keep,dog:FG.state.dog,weather:FG.state.weather})`);
await ev(`document.getElementById('de-next').click()`);
await sleep(300);
ok('点过之后仍是第 145 天，第二年第一天没有被跳过', (await ev(`FG.state.day`)) === 145);
ok('确认年结不重复晨间产出', (await ev(`JSON.stringify({keep:FG.state.keep,dog:FG.state.dog,weather:FG.state.weather})`)) === morningBeforeYearConfirm);
ok('按钮变回「晨 兴」', (await ev(`document.getElementById('de-next').textContent`)) === '晨 兴',
   await ev(`document.getElementById('de-next').textContent`));
ok('年结面板收了', (await ev(`document.getElementById('de').classList.contains('hide')`)) === true);
await shot('24-第二年立春.png');

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? `FAILED ${fails}` : 'DONE');
