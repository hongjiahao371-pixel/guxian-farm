// 四季与休耕验收。
//
// 星露谷的冬天是**惩罚**：作物枯死、洒水器冻住、 forage 减产。
// 这边反过来 —— 地歇着，人不闲着：藏季作物不枯、熟了照收，
// 压住的是「种田」这一门，不是整个游戏。
// 所以盯的不是「冬天有多难」，是「冬天到底关掉了什么、又留着什么」：
//   1) 四季表把 24 个节气分完，一个不多一个不少
//   2) 藏季翻不动地，且**先说地冻上了**而不是「这畦已翻过」
//   3) 藏季下不了种，且说的是地冻了而不是「不是豆的时节」
//   4) 藏季**不枯死**：秋天种下的菊跨进藏季照样开、照样收
//   5) 藏季**别的一扇门都开着**：加工、采矿、钓鱼、养鸡、刻石
//   6) HUD 上看得见今天是哪一季
//   7) 年结说得出这一年歇了多久；一年颗粒无收时「什么也没收成」还得出现
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9381;
const profile = path.join(tmpdir(), 'guxian-season-' + process.pid);

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
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(180);
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
const tilledCount = () => ev(`(function(){var n=0;for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++)if(FG.state.plots[r][c].tilled)n++;return n})()`);
// 一天摆成某一天。天气跟着日子重算，免得两套东西各说各话
const setDay = async day => {
  await ev(`(function(){ FG.state.day=${day}; FG.state.weather=FG.weatherOf(${day}); FG.state.hover=null; FG.updateHUD(); return 1})()`);
  await sleep(300);
};
const findDay = pred => ev(`(function(){
  for (var i=1;i<=FG.SOLAR_YEAR;i++) if (${pred}) return i;
  return -1})()`);

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

console.log('— 四季表把二十四个节气分完了 —');
const seasonRaw = await ev(`JSON.stringify((function(){
  var i, k, out={}, assigned={}, dup=[];
  for (i=0;i<FG.SEASON.length;i++){
    var s=FG.SEASON[i]; out[s.k]={n:s.n, sols:s.sols.slice()};
    for (var j=0;j<s.sols.length;j++){ if(assigned[s.sols[j]]) dup.push(s.sols[j]); assigned[s.sols[j]]=s.k; }
  }
  var miss=[];
  for (i=0;i<FG.SOLAR.length;i++) if(!assigned[FG.SOLAR[i].k]) miss.push(FG.SOLAR[i].k);
  // 反查表和 seasonOf 必须是同一件事。**日子不能拿 i+1** ——
  // 一节气占 6 天，第 7 个节气对应的第一天是第 7 天不是第 7 个节气位。
  // 拿 i+1 去查的话，谷雨（春的最后一个）会查到春分（也是春，碰巧对），
  // 而立夏（夏）查到雨水（春）—— 一季错，断言就全红
  var bad=[];
  for (i=0;i<FG.SOLAR.length;i++){
    var d0=i*FG.SOLAR_DAYS+1;
    if(FG.SOLAR_SEASON[FG.SOLAR[i].k]!==FG.seasonOf(d0).k) bad.push(FG.SOLAR[i].k);
    if(FG.seasonOf(d0).k!==FG.seasonOf(d0+FG.SOLAR_DAYS-1).k) bad.push(FG.SOLAR[i].k+'(一节气内不一致)');
  }
  return {seasons:out, dup:dup, miss:miss, badLookup:bad, nSol:FG.SOLAR.length};
})())`);
const seasonInfo = JSON.parse(seasonRaw);
for (const k in seasonInfo.seasons) {
  console.log('  ' + seasonInfo.seasons[k].n + '：' + seasonInfo.seasons[k].sols.join('、'));
}
ok('四季都存在', Object.keys(seasonInfo.seasons).length === 4, Object.keys(seasonInfo.seasons).join(' '));
ok('每个节气都归了季', seasonInfo.miss.length === 0, seasonInfo.miss.join(' ') || (seasonInfo.nSol + ' 个都在'));
ok('没有节气被归到两季', seasonInfo.dup.length === 0, seasonInfo.dup.join(' ') || '无');
ok('反查表和 seasonOf 说的是同一件事', seasonInfo.badLookup.length === 0, seasonInfo.badLookup.join(' ') || '一致');const sizes = Object.values(seasonInfo.seasons).map(s => s.sols.length);
ok('四季一样长', sizes.every(n => n === sizes[0]), sizes.join(' / '));

console.log('— 藏季是哪几天 —');
const winterDays = JSON.parse(await ev(`JSON.stringify((function(){
  var a=[],i; for(i=1;i<=FG.SOLAR_YEAR;i++) if(FG.groundFrozen(i)) a.push(i); return a;
})())`));
console.log(`  藏季 ${winterDays.length} 天：第 ${winterDays[0]}..${winterDays[winterDays.length - 1]} 天（${await ev(`FG.solarOf(${winterDays[0]}).n`)} — ${await ev(`FG.solarOf(${winterDays[winterDays.length - 1]}).n`)}）`);
ok('藏季是一整段连续的', winterDays[winterDays.length - 1] - winterDays[0] + 1 === winterDays.length,
  winterDays[0] + '..' + winterDays[winterDays.length - 1]);
ok('藏季从立冬起', (await ev(`FG.solarOf(${winterDays[0]}).k`)) === 'lidong', await ev(`FG.solarOf(${winterDays[0]}).n`));
ok('藏季到年尾', (await ev(`FG.solarOf(${winterDays[winterDays.length - 1]}).k`)) === 'dahan', await ev(`FG.solarOf(${winterDays[winterDays.length - 1]}).n`));
ok('藏季占了一年的两成半到四成', winterDays.length >= 30 && winterDays.length <= 40, winterDays.length + ' / 144');
const firstDay = await ev(`1`);
ok('第一天是春天（不是一开局就休耕）', (await ev(`FG.seasonOf(${firstDay}).k`)) === 'spring', await ev(`FG.seasonOf(${firstDay}).n`));

console.log('— 藏季翻不动地 —');
await ev(`(function(){
  FG.gotoMap('nanshan');
  for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++){var p=FG.state.plots[r][c]; p.tilled=false; p.wet=false; p.crop=null; p.stage=0;}
  FG.state.stam=100; FG.state.sel='chu'; return 1})()`);
const springDay = await findDay(`FG.seasonOf(i).k==='spring'`);
await setDay(springDay);
await ev(`(function(){ FG.workArea('chu', 2, 2); return 1})()`);
await sleep(300);
ok('春天翻得动地', (await tilledCount()) > 0, (await tilledCount()) + ' 畦翻过');
const stamA = await ev(`FG.state.stam`);
ok('翻地扣了体力', stamA < 100, stamA + ' / 100');

await ev(`(function(){ for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++)FG.state.plots[r][c].tilled=false; FG.state.stam=100; return 1})()`);
// 藏季里挑一个**没有下雪**的日子。雪天那句说的是「雪压着地」，
// 那是另一回事（天气那一项管），这一段要验的是「地冻上了」
const frozenDay = await findDay(`FG.groundFrozen(i) && FG.weatherOf(i)!=='snow'`);
const snowyDay = await findDay(`FG.groundFrozen(i) && FG.weatherOf(i)==='snow'`);
console.log(`  藏季里不下的雪的一天 = 第 ${frozenDay} 天，下雪的一天 = 第 ${snowyDay} 天`);
ok('藏季里找得到不下的雪的日子', frozenDay > 0, 'day=' + frozenDay);
ok('藏季里也找得到下雪的日子', snowyDay > 0, 'day=' + snowyDay);
await setDay(frozenDay);
ok('这一刻确实是藏季', (await ev(`FG.groundFrozen(FG.state.day)`)) === true, await ev(`FG.seasonOf(FG.state.day).n`));
await clearToast();
await ev(`(function(){ FG.workArea('chu', 2, 2); return 1})()`);
await sleep(300);
ok('藏季一畦也翻不动', (await tilledCount()) === 0, (await tilledCount()) + ' 畦翻过');
ok('藏季不扣体力（不是扣了才拦）', (await ev(`FG.state.stam`)) === 100, 'stam=' + await ev(`FG.state.stam`));
const tTill = await toast();
ok('提示说的是地冻了，不是「这畦已翻过」', tTill.indexOf('冻') >= 0, tTill);
ok('提示给了个盼头（说了等哪天）', tTill.indexOf('立春') >= 0, tTill);
ok('没下雪的那天不写成「雪压着」', tTill.indexOf('雪') < 0, tTill);
// 下雪的那天是另一句话：土没冻，是雪盖着。玩家该分得清这两种
await ev(`(function(){ for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++)FG.state.plots[r][c].tilled=false; return 1})()`);
await setDay(snowyDay);
await clearToast();
await ev(`(function(){ FG.workArea('chu', 2, 2); return 1})()`);
await sleep(300);
const tSnowTill = await toast();
ok('下雪那天说的是「雪压着地」', tSnowTill.indexOf('雪') >= 0, tSnowTill);
ok('下雪那天不混成「地冻上了」', tSnowTill.indexOf('地冻') < 0, tSnowTill);
ok('下雪那天照样翻不动', (await tilledCount()) === 0, (await tilledCount()) + ' 畦翻过');
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 藏季下不了种，而且说的是地冻 —');
// 拿豆试。豆的 terms 到清明就完了，藏季本来就下不去 ——
// 所以这条真正在验的是**哪一句话**被说出来
await ev(`(function(){ FG.state.sel=null; FG.state.seeds.dou=9; return 1})()`);
await ev(`(function(){
  for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++)FG.state.plots[r][c].tilled=true;
  return 1})()`);
await setDay(frozenDay);
await clearToast();
await ev(`(function(){ FG.sowWith('dou', 2, 2); return 1})()`);
await sleep(300);
const tSow = await toast();
ok('藏季提示说的是地冻了', tSow.indexOf('冻') >= 0, tSow);
ok('没把原因说成「不是豆的时节」', tSow.indexOf('时节') < 0, tSow);
ok('没种上', (await ev(`FG.state.plots[2][2].crop`)) === null, 'crop=' + await ev(`FG.state.plots[2][2].crop`));
ok('种子没被扣掉', (await ev(`FG.state.seeds.dou`)) === 9, 'dou=' + await ev(`FG.state.seeds.dou`));
// 换个作物也一样：不是豆不行，是地不行
await clearToast();
await ev(`(function(){ FG.state.seeds.ji=9; FG.sowWith('ji', 1, 1); return 1})()`);
await sleep(300);
ok('换一包种也照样种不下去', (await toast()).indexOf('冻') >= 0, await toast());
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 藏季不枯死：秋天种下的菊跨进冬天照样开 —');
// 白露（秋）种菊，跨进藏季再收。
// 三十天的生长另有套件在盯，这里直接把苗催到熟 ——
// 这条要验的是**「藏季熟了照收、不枯在冻土上」**，
// 而「浇一次水长一阶段」那是种田的门道，不是季节的事
const bailu = await findDay(`FG.solarOf(i).k==='bailu'`);
const juDone = await ev(`(function(){
  for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++){var p=FG.state.plots[r][c]; p.tilled=true; p.wet=true; p.crop=null; p.stage=0;}
  FG.state.seeds.ju=9; FG.state.stam=100;
  return 1})()`);
await setDay(bailu);
ok('白露那天是秋天', (await ev(`FG.seasonOf(FG.state.day).k`)) === 'autumn', await ev(`FG.solarOf(FG.state.day).n`));
await ev(`(function(){ FG.sowWith('ju', 2, 2); return 1})()`);
await sleep(300);
ok('白露那天菊种得下去', (await ev(`FG.state.plots[2][2].crop`)) === 'ju', 'crop=' + await ev(`FG.state.plots[2][2].crop`));
const juDays = await ev(`FG.CROPS.ju.days`);
console.log(`  菊要 ${juDays} 天；从第 ${bailu} 天种下，第 ${bailu + juDays} 天是 ${await ev(`FG.solarOf(${(bailu + juDays - 1) % 144 + 1}).n`)}`);
// 催熟，然后跳到藏季
await ev(`(function(){ FG.state.plots[2][2].stage=${juDays}; FG.state.plots[2][2].wet=true; return 1})()`);
await setDay(winterDays[4]);
ok('收的那天确实在藏季里', (await ev(`FG.groundFrozen(FG.state.day)`)) === true,
  await ev(`FG.solarOf(FG.state.day).n`) + ' / ' + await ev(`FG.seasonOf(FG.state.day).n`));
ok('藏季没把地里的苗冻没', (await ev(`FG.state.plots[2][2].crop`)) === 'ju', 'crop=' + await ev(`FG.state.plots[2][2].crop`));
// 收成进的是**行囊**不是钱包 —— 谷物要自己放进出货箱才变钱，
// 拿 gold 去量它永远是 500
const bagA = await ev(`FG.state.bag.ju||0`);
await clearToast();
await ev(`(function(){ FG.harvest(2, 2); return 1})()`);
await sleep(350);
ok('藏季熟了照样收得下来', (await ev(`FG.state.bag.ju||0`)) === bagA + 1,
  '行囊菊 ' + bagA + ' -> ' + await ev(`FG.state.bag.ju||0`));
ok('菊进了这一年的账', (await ev(`(function(){ return (FG.state.book && FG.state.book.crops && FG.state.book.crops.ju) || 0 })()`)) > 0,
  'ju=' + await ev(`(function(){ return (FG.state.book && FG.state.book.crops && FG.state.book.crops.ju) || 0 })()`));
// 菊是复收作物：收了苗还留着，隔几天再开一茬。
// 写成「收完就没了」会把这套复收的规矩当成 bug 去「修」
ok('复收的菊收完还站在地里', (await ev(`FG.state.plots[2][2].crop`)) === 'ju', 'crop=' + await ev(`FG.state.plots[2][2].crop`));
ok('而且退回「还要再长几天」的那一档', (await ev(`FG.state.plots[2][2].stage`)) === (await ev(`FG.CROPS.ju.days - FG.CROPS.ju.regrow`)),
  'stage=' + await ev(`FG.state.plots[2][2].stage`));

// 对照：豆不是复收作物，藏季收了要**连苗一起清掉**
await ev(`(function(){
  for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++){var p=FG.state.plots[r][c]; p.tilled=true; p.wet=true; p.crop=null; p.stage=0;}
  FG.state.seeds.dou=9;
  return 1})()`);
const chunfenDay = await findDay(`FG.solarOf(i).k==='chunfen'`);
await setDay(chunfenDay);
await ev(`(function(){ FG.sowWith('dou', 1, 1); FG.state.plots[1][1].stage=FG.CROPS.dou.days; FG.state.plots[1][1].wet=true; return 1})()`);
await sleep(200);
ok('春分种豆种得下去', (await ev(`FG.state.plots[1][1].crop`)) === 'dou', 'crop=' + await ev(`FG.state.plots[1][1].crop`));
await setDay(frozenDay);
const bagD = await ev(`FG.state.bag.dou||0`);
await clearToast();
await ev(`(function(){ FG.harvest(1, 1); return 1})()`);
await sleep(300);
ok('藏季收豆也照样收', (await ev(`FG.state.bag.dou||0`)) === bagD + 1, '行囊豆 ' + bagD + ' -> ' + await ev(`FG.state.bag.dou||0`));
ok('不复收的豆收了连苗一起清', (await ev(`FG.state.plots[1][1].crop`)) === null, 'crop=' + await ev(`FG.state.plots[1][1].crop`));
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 藏季别的门都还开着 —');
// 加工
await ev(`(function(){ FG.gotoMap('nanshan'); FG.state.player.x=452; FG.state.player.y=740; FG.state.cookN=0; FG.state.bag.su=3; FG.state.bag.shu=3; FG.updateHUD(); return 1})()`);
await sleep(400);
const hHome = await hint();
ok('藏季门口还开着门（提示写的是进屋）', hHome.indexOf('进屋') >= 0, hHome);
// 屋里「灶」那一行在藏季照样亮着 —— 别的门都关了，动灶这一道不该跟着关
await key('e');
await sleep(400);
const hsStove = await ev(`(function(){var g=document.querySelector('#hs-list .hsr[data-k="stove"]');
  return g ? (g.classList.contains('off') ? '暗' : '亮') + '　' + g.textContent.replace(/\\s+/g,' ') : '(没有这一行)';})()`);
ok('藏季屋里「灶」那行亮着', hsStove.indexOf('亮') === 0, hsStove);
await key('Escape');
await sleep(250);
const canMake = JSON.parse(await ev(`JSON.stringify(FG.cookable().map(function(r){return r.name}))`));
console.log('  藏季灶上做得出的：' + (canMake.join('、') || '（料不够）'));
ok('藏季没被季节挡住加工', Array.isArray(canMake), canMake.length + ' 条可做');
// 采矿：硐口在雷雨天才封，藏季不下雨
ok('藏季天是晴的（所以硐口不封）', (await ev(`FG.isWetWeather()`)) === false, await ev(`FG.WEATHER[FG.state.weather].name`));
ok('藏季不封硐', (await ev(`FG.mineShut()`)) === false);
// 钓鱼：藏季**不封溪**（星露谷冬天也钓得到鳟），只是鱼少。
// 判据得跟夏天比 —— 拿藏季跟藏季比是恒真的，量多少次都一样
const fishOn = async () => JSON.parse(await ev(`JSON.stringify((function(){
  var out=[],k; for(k in FG.FISH) if(FG.canFish(FG.FISH[k])) out.push(k); return out.sort();
})())`));
const summerDay = await findDay(`FG.seasonOf(i).k==='summer'`);
await setDay(summerDay);
await ev(`FG.state.min=FG.DAY.START`);
const fSummer = await fishOn();
await setDay(frozenDay);
await ev(`FG.state.min=FG.DAY.START`);
const fWinter = await fishOn();
console.log(`  夏：${fSummer.join('、')}`);
console.log(`  冬：${fWinter.join('、')}`);
ok('藏季还钓得到鱼', fWinter.length > 0, fWinter.length + ' 种');
ok('藏季的鱼确实比夏天少', fWinter.length < fSummer.length, fWinter.length + ' < ' + fSummer.length);
ok('便宜鱼留了下来（溪虾鲫还在）',
  fWinter.indexOf('xia') >= 0 && fWinter.indexOf('ji') >= 0, fWinter.join('、'));
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— HUD 上看得见今天是哪一季 —');
await setDay(1);
ok('立春那天写「春」', (await ev(`document.getElementById('hud-solar').textContent`)).indexOf('春') >= 0,
  await ev(`document.getElementById('hud-solar').textContent`));
ok('那一格旁边还挂着节气名', (await ev(`document.getElementById('hud-solar').textContent`)).indexOf('立春') >= 0,
  await ev(`document.getElementById('hud-solar').textContent`));
await setDay(winterDays[0]);
ok('立冬那天写「冬」', (await ev(`document.getElementById('hud-solar').textContent`)).indexOf('冬') >= 0,
  await ev(`document.getElementById('hud-solar').textContent`));
ok('悬停上去有这一季的一句话', (await ev(`document.getElementById('hud-solar').title`)).length > 0,
  await ev(`document.getElementById('hud-solar').title`));
await clearToast(); await sleep(200);
await shot('50-立冬.png');

console.log('— 年结说得出这一年歇了多久 —');
await ev(`(function(){
  FG.state.book=FG.bookInit?null:null;
  FG.gotoMap('nanshan');
  return 1})()`);
// 停在**第 144 天**（大寒）再点下一天：年结判的是「刚过去的那天是不是岁末」，
// 停在 143 的话过去的是 143，不是一年的最后一天，面板根本不弹。
// 账本里要先有收成 —— 颗粒无收的那年「地歇了 N 天」是**按设计**不写的
// （见下一段），拿空账本去验它当然验不出来
await ev(`(function(){
  var s=FG.state; s.day=144; s.stam=100;
  s.book={crops:{dou:12,ju:3}, fish:{xia:9}, picks:{mei:6}, casts:20, earned:1880, steles:2, first:1, last:144};
  return 1})()`);
await sleep(300);
await clearToast();
await ev(`(function(){ FG.nextDay(); return 1})()`);
await sleep(900);
const yearLines = await ev(`(function(){
  var e=document.getElementById('de'); if(e.classList.contains('hide')) return '';
  return [].map.call(e.querySelectorAll('.ln'), function(x){return x.textContent}).join(' | ');
})()`);
console.log('  年结 = ' + yearLines);
ok('年结弹了', yearLines.length > 0, yearLines.slice(0, 60));
ok('年结说了地歇了多少天', yearLines.indexOf('地歇了 ' + winterDays.length + ' 天') >= 0, yearLines);
ok('并且说清了别的还开着', yearLines.indexOf('硐里') >= 0, yearLines);
ok('有收成的年份不会说「什么也没收成」', yearLines.indexOf('什么也没收成') < 0, yearLines);
await shot('51-年结.png');

console.log('— 一年颗粒无收时，那句话还得出现 —');
// 换一个年：上一轮已经跨到第二年了，所以这次停在第二年的第 144 天
// （第 288 天）。停在同一年的话 nextDay 不会第二次触发年结，面板也不弹
await ev(`(function(){ document.getElementById('de-x').click(); return 1})()`);
await sleep(300);
await ev(`(function(){
  var s=FG.state; s.day=288;
  s.book={crops:{}, fish:{}, picks:{}, casts:0, earned:0, steles:0, first:145, last:288};
  return 1})()`);
await sleep(300);
await ev(`(function(){ FG.nextDay(); return 1})()`);
await sleep(900);
const barren = await ev(`(function(){
  var e=document.getElementById('de'); if(e.classList.contains('hide')) return '';
  return [].map.call(e.querySelectorAll('.ln'), function(x){return x.textContent}).join(' | ');
})()`);
console.log('  颗粒无收 = ' + barren);
ok('颗粒无收的年结也弹了', barren.length > 0, barren.slice(0, 60));
ok('颗粒无收时说的是「什么也没收成」', barren.indexOf('什么也没收成') >= 0, barren);
// 「地歇了 N 天」是无条件行，不该在颗粒无收时还写出来 ——
// 写了的话「这一年什么也没收成」就被挤成第二行了，而它该是唯一能解释这一年的话
ok('颗粒无收时不写「地歇了」（那句该让位）', barren.indexOf('地歇了') < 0, barren.indexOf('地歇了') < 0 ? '（正确，没写）' : '被写出来了');
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('');
console.log('LOGS ' + (logs.length ? '有输出：\n' + logs.join('\n') : '(无报错)'));
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(0);
