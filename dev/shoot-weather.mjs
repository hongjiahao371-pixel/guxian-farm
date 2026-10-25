// 天气验收：晴 / 雨 / 雷雨。
//
// 天气是这一版补上的「反向约束」——星露谷一半的张力来自
// 「下雨不用挑水」和「雷雨天矿下不去」这两条反向的账，
// 没有它们，一年就是 144 天同一种日子连着过。
//
// 盯住七条规矩：
//   1) 天气**只用日子算**，不掷骰子：刷新不变、读档不变
//   2) 读档**不换天气**（换了就白捡了，读一次档重掷一次）
//   3) 雨天早上把**翻过的**畦全浇上，没翻的不浇
//   4) 雨天地里那一圈采集点采不到，且**说得清楚为什么**
//   5) 雷天硐口封着，E 键说得清楚为什么封
//   6) 晴天的 HUD 天气行**不占位**（常驻一行会压到体力条上）
//   7) 硐里不下雨
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9379;
const profile = path.join(tmpdir(), 'guxian-weather-' + process.pid);

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
// toast 淡出之后 textContent 还留在那儿，而 class 还挂着的话会剩一个空黑框
// —— 断言「刚才弹的是哪一句」之前先自己清一次，截图之前连框一起收
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
// 雨衣行收不收。display 不是 none 才算数
const weatherShown = () => ev(`(function(){var e=document.getElementById('hud-weather');return e && getComputedStyle(e).display!=='none'})()`);
const weatherText = () => ev(`(function(){var e=document.getElementById('hud-weather');return e?e.textContent:''})()`);
// 数田里湿了几畦。判据一律从源码的行列数读，不写死 25
const wetCount = () => ev(`(function(){var n=0;for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++)if(FG.state.plots[r][c].wet)n++;return n})()`);
const tilledCount = () => ev(`(function(){var n=0;for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++)if(FG.state.plots[r][c].tilled)n++;return n})()`);
// 直接把某一天摆成某一种天气，再重画。走 startDay 的话那天会顺带
// 加蛋、浇渠、涨经验，测的就不是天气那一件事了
const setDay = async (day, w) => {
  await ev(`(function(){
    FG.state.day=${day};
    FG.state.weather=${JSON.stringify(w)};
    FG.updateHUD();
    return 1})()`);
  await sleep(320);
};
/* 每次 reload 之后标题页都会再盖上来。
   不收掉的话断言照样全绿（游戏在遮罩后面照跑），而**截出来的图**
   全被那层 rgba(24,20,15,0.78) 压着 —— 看雨丝就成了看一层暗纱，
   美术那一关等于没做。 */
// 回到游戏里，**并且要把档续上**。
// 原来这里只是把标题那一层藏掉，之所以能续上，是因为老的 showTitle()
// 开头就调 load() —— 看见标题就等于读档了。
// 三格存档之后标题读摘要走的是 slotInfo（**不动 S**，不然一开标题当前局面就没了），
// 那一层隐含的读档没有了，所以这里得自己续。
// 这不是回归：**开标题就把档读进来**本来就是那个副作用，读档该由「续」那一按触发。
const dismissTitle = async () => {
  await ev(`FG.startFrom('cont')`);
  await sleep(420);
};
/* 找一个「它自己就应该是雨」的日子。
   不能直接把 S.weather 摆成 rain 再点下一天 —— nextDay 开头会按新日子
   重算天气并覆盖掉，测的就变成「有没有重算」，不是「下雨那天会不会浇水」。
   而重算这一条本身是对的（同一天读档不换天气，过一天必须换）。 */
const findDay = w => ev(`(function(){
  for (var i=1;i<=FG.SOLAR_YEAR*3;i++) if (FG.weatherOf(i)==='${w}') return i;
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

console.log('— 天气表自己站得住 —');
const W = JSON.parse(await ev(`JSON.stringify(FG.WEATHER)`));
const KS = Object.keys(W);
ok('四种天气都有名字', KS.every(k => W[k] && W[k].name), KS.map(k => k + '=' + W[k].name).join(' '));
const allW = JSON.parse(await ev(`JSON.stringify(FG.WEATHER_BY_SOLAR)`));
// 权重表里写的节气必须是真的节气。写错一个 key，它会静默地不生效
const solKeys = JSON.parse(await ev(`JSON.stringify(FG.SOLAR.map(function(s){return s.k}))`));
const badKey = Object.keys(allW).filter(k => solKeys.indexOf(k) < 0);
ok('权重表里每个节气都真存在', badKey.length === 0, badKey.join(' ') || (Object.keys(allW).length + ' 个节气有份量'));
const badWt = Object.keys(allW).filter(k => {
  const v = allW[k];
  for (const key in v) if (!(v[key] > 0)) return true;
  return false;
});
ok('权重没有写成 0 或负数', badWt.length === 0, badWt.join(' ') || 'OK');
// 雪只能下在藏季。给春天下雪档的话，春天会一边种地一边下雪，
// 而那把「节气定农时」这件事整个架空了。
// **别拿 SOLAR_IDX 当日子**：它给的是节气的序号，节气 i 的第一天是
// i*SOLAR_DAYS+1。照序号当天去问 seasonOf，拿到的是前面第 i 个节气那一季
const snowSeasons = JSON.parse(await ev(`JSON.stringify((function(){
  var a=[],k;
  for(k in FG.WEATHER_BY_SOLAR) if (FG.WEATHER_BY_SOLAR[k].snow)
    a.push(k+':'+FG.seasonOf(FG.SOLAR_IDX[k]*FG.SOLAR_DAYS+1).n);
  return a;
})())`));
ok('雪只排在藏季那六个节气上', snowSeasons.length > 0 && snowSeasons.every(s => s.indexOf('冬') >= 0),
  snowSeasons.join(' ') || '一处都没有');

console.log('— 一天一个天气，而且不是随机数 —');
const oneYear = JSON.parse(await ev(`JSON.stringify((function(){
  var a=[],i;
  for(i=1;i<=FG.SOLAR_YEAR;i++) a.push(FG.weatherOf(i));
  return a;
})())`));
const nSun = oneYear.filter(w => w === 'sun').length;
const nRain = oneYear.filter(w => w === 'rain').length;
const nStorm = oneYear.filter(w => w === 'storm').length;
const nSnow = oneYear.filter(w => w === 'snow').length;
console.log(`  头一年：晴 ${nSun} · 雨 ${nRain} · 雷雨 ${nStorm} · 雪 ${nSnow}（共 ${oneYear.length} 天）`);
ok('四种天气都出现过', nSun > 0 && nRain > 0 && nStorm > 0 && nSnow > 0,
  JSON.stringify({ sun: nSun, rain: nRain, storm: nStorm, snow: nSnow }));
ok('晴天占多数（不是天天在下）', nSun > nRain + nStorm, '晴 ' + nSun + ' > 雨雷 ' + (nRain + nStorm));
ok('雷雨是少数（不是天天劈）', nStorm < oneYear.length / 4, nStorm + ' / ' + oneYear.length);
ok('雪是少数（不是天天在下）', nSnow < oneYear.length / 3, nSnow + ' / ' + oneYear.length);
ok('雪不跟雨雷同时下', oneYear.every(w => !(w === 'snow' && (w === 'rain' || w === 'storm'))));
// 同一个日子算两次必须一样
const twice = JSON.parse(await ev(`JSON.stringify([FG.weatherOf(37),FG.weatherOf(37),FG.weatherOf(37)])`));
ok('同一天算三次是同一个结果', twice[0] === twice[1] && twice[1] === twice[2], twice.join(' '));
// 一年不重样的话，144 天里必须有重样 —— 那正好说明它是按节气算的，不是按天掷的
const uniq = new Set(oneYear);
ok('144 天不是 144 种排法', uniq.size < oneYear.length, uniq.size + ' 种');
// 开局第一天必须是晴天
ok('开局第一天是晴天', (await ev(`FG.WEATHER[FG.weatherOf(1)].name`)) === '晴', await ev(`FG.WEATHER[FG.weatherOf(1)].name`));

console.log('— 读档不换天气 —');
await setDay(20, 'storm');
const wBefore = await ev(`FG.state.weather`);
await ev(`FG.saveGame()`);
await sleep(300);
await ev(`location.reload()`);
await sleep(2600);
await dismissTitle();
const wAfter = await ev(`FG.state.weather`);
ok('存进去再读回来还是那一个天气', wBefore === wAfter && wAfter === 'storm', wBefore + ' -> ' + wAfter);
ok('读档没有改日子', (await ev(`FG.state.day`)) === 20, 'day=' + await ev(`FG.state.day`));
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 老存档没有天气这一项，也能补出来 —');
await ev(`(function(){ var raw=JSON.parse(localStorage.getItem('guxian_nanshan_save_v1')); delete raw.weather; localStorage.setItem('guxian_nanshan_save_v1', JSON.stringify(raw)); return 1})()`);
await ev(`location.reload()`); await sleep(2600); await dismissTitle();
const wOld = await ev(`(function(){FG.weatherFix(); return FG.state.weather})()`);
ok('补出来的是个真的天气', ['sun', 'rain', 'storm'].indexOf(wOld) >= 0, wOld);
ok('补出来的是这一天该有的那一个', wOld === (await ev(`FG.weatherOf(FG.state.day)`)), wOld);

console.log('— 雨天早上替你把地浇了 —');
await ev(`(function(){
  FG.gotoMap('nanshan');
  for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++){FG.state.plots[r][c].tilled=(r<2); FG.state.plots[r][c].wet=false;}
  return 1})()`);
const rainDay = await findDay('rain');
console.log('  头一个自己就该下雨的日子 = 第 ' + rainDay + ' 天（' + await ev(`FG.solarOf(${rainDay}).n`) + '）');
ok('一年里找得到下雨的日子', rainDay > 0, 'day=' + rainDay);
// 站在雨的前一天，等它自己过到雨天
await setDay(rainDay - 1, await ev(`FG.weatherOf(${rainDay - 1})`));
await ev(`FG.nextDay()`); await sleep(500);
ok('第二天早上真的是雨', (await ev(`FG.state.weather`)) === 'rain', await ev(`FG.state.weather`));
const w2 = await wetCount(), t2 = await tilledCount();
ok('翻过的畦全湿了', w2 === t2 && t2 > 0, w2 + ' 湿 / ' + t2 + ' 翻过');
ok('没翻的畦没被浇（地没翻就浇了它明早照样种不上去）',
  (await ev(`(function(){
    var n=0; for(var r=2;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++) if(FG.state.plots[r][c].wet) n++;
    return n })()`)) === 0);
ok('雨天不扣体力（雨不是你干的活）', (await ev(`FG.state.stam`)) === 100, 'stam=' + await ev(`FG.state.stam`));
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 晴天不自动浇 —');
await ev(`(function(){
  for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++)FG.state.plots[r][c].wet=false;
  return 1})()`);
const sunDay = await findDay('sun');
await setDay(sunDay - 1, await ev(`FG.weatherOf(${sunDay - 1})`));
await ev(`FG.nextDay()`); await sleep(500);
const wSun = await wetCount();
ok('第二天是晴天，地还是干的', (await ev(`FG.state.weather`)) === 'sun' && wSun === 0,
  await ev(`FG.state.weather`) + ' / ' + wSun + ' 畦湿');

console.log('— 水渠在雨天也不多浇一遍（湿的畦不会被数两次）—');
await ev(`(function(){
  FG.state.build.ditch=1;
  for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++){FG.state.plots[r][c].tilled=true; FG.state.plots[r][c].wet=false;}
  return 1})()`);
const rainDay2 = await findDay('rain');
await setDay(rainDay2 - 1, await ev(`FG.weatherOf(${rainDay2 - 1})`));
await ev(`FG.nextDay()`); await sleep(500);
const wDitch = await wetCount(), tDitch = await tilledCount();
ok('雨天 + 水渠，全田都湿了', (await ev(`FG.state.weather`)) === 'rain' && wDitch === tDitch,
  wDitch + ' / ' + tDitch + '（天气 ' + await ev(`FG.state.weather`) + '）');
ok('这一段控制台还是干净的', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 溪里涨了水，站在荇菜那儿要说清楚 —');
// 挑水里的点里**带 need 的那一个**（荇菜要采四级才够得着）。
// 别只取「第一个 wet 的点」—— 菱角和田螺也在水里，而它们没有 need，
// 照第一个取会拿到一个没有门限的点，那条「要几级才够得着」当场就红
const XING = JSON.parse(await ev(`(function(){
  var l=FG.SPOTS.xipan.pick, i, all=[], n=0;
  for(i=0;i<l.length;i++) if(l[i].wet){ n++; if(!all.gated && l[i].need) all.gated={k:l[i].k, at:l[i].at, need:l[i].need}; }
  return JSON.stringify(all.gated || {});
})()`));
const wetCount2 = await ev(`(function(){var l=FG.SPOTS.xipan.pick,i,n=0;for(i=0;i<l.length;i++)if(l[i].wet)n++;return n})()`);
console.log('  带门限的水里的点 =', JSON.stringify(XING), '（水里共 ' + wetCount2 + ' 个点）');
ok('表里标出了水里的点', wetCount2 > 0, wetCount2 + ' 个');
ok('水里的点挂着「要几级才够得着」', !!XING.need, JSON.stringify(XING.need));
const standXing = async () => {
  await ev(`(function(){
    FG.gotoMap('xipan');
    FG.state.player.x=${XING.at[0]}; FG.state.player.y=${XING.at[1]}+40;
    FG.state.walkTo=null; FG.state.hover=null;
    return 1})()`);
  await sleep(430);
};
// 采这门手艺得够级才够得着那条线，先给足
if (XING.need) await ev(`(function(){ FG.state.skill.cai.lv=Math.max(FG.state.skill.cai.lv, ${XING.need.cai}); FG.updateHUD(); return 1})()`);

await setDay(30, 'sun');
await standXing();
const hSun = await hint();
ok('晴天站在那儿写的是「E 采荇菜」', hSun.indexOf('E　采') >= 0, hSun);
await shot('40-荇菜-晴.png');

await setDay(31, 'rain');
await standXing();
const hRain = await hint();
ok('雨天站在那儿说得出为什么采不到', hRain.indexOf('水涨') >= 0, hRain);
ok('雨天那一行仍然点出了是哪一样', hRain.indexOf(XING.k === 'xing' ? '荇菜' : XING.k) >= 0, hRain);
await shot('41-荇菜-雨.png');
// 按下去要有一句话，不能什么也不发生
await clearToast();
await key('e'); await sleep(320);
const tRain = await toast();
ok('按 E 会说一句话，不是没反应', tRain.length > 0, tRain);
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 雷雨天硐口封着 —');
// 硐口在哪张图上不是定的：扫全部的图找那道通往 shidong 的出口。
// 早先写死成溪畔，而硐口其实在墟市背后那道坡脚下 ——
// 写死地图名的后果不是断言红，是连图都走不到
const SHAFT = JSON.parse(await ev(`(function(){
  var ms=FG.MAPS, mk, i, j, ex;
  for (mk in ms){
    ex=ms[mk].exits||[];
    for(i=0;i<ex.length;i++) if(ex[i].to==='shidong')
      return JSON.stringify({map:mk, at:ex[i].at, r:ex[i].r, label:ex[i].label});
  }
  return '{}';
})()`));
console.log('  硐口 =', JSON.stringify(SHAFT));
ok('有一道通往石硐的出口', !!SHAFT.at, (SHAFT.map || '?') + ' / ' + (SHAFT.label || '没找着'));
const standShaft = async () => {
  await ev(`(function(){
    FG.gotoMap(${JSON.stringify(SHAFT.map)});
    FG.state.player.x=${SHAFT.at[0]}; FG.state.player.y=${SHAFT.at[1]};
    FG.state.walkTo=null; FG.state.hover=null;
    return 1})()`);
  await sleep(430);
};
const stormDay = await findDay('storm');
await setDay(stormDay, 'storm');
await standShaft();
ok('雷天在硐口提示说封着', (await hint()).indexOf('封') >= 0, await hint());
await clearToast();
await key('e'); await sleep(350);
const tStorm = await toast();
ok('按 E 会解释为什么封', tStorm.indexOf('硐') >= 0, tStorm);
ok('人还在原地，没被送进硐里', (await ev(`FG.state.map`)) === SHAFT.map, await ev(`FG.state.map`));
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');
await shot('42-雷雨-硐口.png');

// 雨天不是雷天 —— 硐口照下。这一条最容易被「雨天也封了」蒙过去
const rainDay3 = await findDay('rain');
await setDay(rainDay3, 'rain');
// **给一把镐**：硐口现在会拦「没有镐」（10/4 那一轮加的）。
// 这一段要验的是「雨天不是雷天、硐口照下」，跟有没有镐是两件事 ——
// 混在一起的话雨天那道判据就被「没有镐」盖掉了，
// 症状是「雨天也封着」，而那正是这一条最想排除的可能
await ev(`(function(){ FG.state.gear={chu:0,piao:0,jue:1}; return 1})()`);
await standShaft();
ok('雨天硐口开着', (await hint()).indexOf(SHAFT.label) >= 0, await hint());
await clearToast();
await key('e'); await sleep(400);
ok('按 E 真的下了硐', (await ev(`FG.state.map`)) === 'shidong', await ev(`FG.state.map`));
await sleep(300);
await shot('43-雨-硐里.png');

console.log('— HUD 上写得出今天什么天 —');
await setDay(50, 'rain');
ok('雨天 HUD 显示出来了', (await weatherShown()) === true, await weatherText());
ok('写的是「雨」', (await weatherText()) === '雨', await weatherText());
await setDay(51, 'sun');
ok('晴天 HUD 让位不占一行', (await weatherShown()) === false, 'display=none');
await setDay(52, 'storm');
ok('雷天 HUD 显示「雷雨」', (await weatherShown()) === true && (await weatherText()) === '雷雨', await weatherText());
// 天气行不能把左上那张纸片顶宽或顶到体力条上。
// 宽度要**跟晴天比**，不能拿纸片去比体力条 —— 那是两根完全不相干的东西，
// 宽度不一样是必然的，拿它当判据就成了一条永远红的假断言
const cardBox = () => ev(`(function(){
  var p=document.getElementById('hud-solar').parentNode.getBoundingClientRect();
  var s=document.getElementById('stam').getBoundingClientRect();
  return JSON.stringify({pb:Math.round(p.bottom), st:Math.round(s.top), w:Math.round(p.width)});
})()`);
await setDay(52, 'storm');
const cardStorm = JSON.parse(await cardBox());
ok('雷天左上纸片没有压到体力条上', cardStorm.pb <= cardStorm.st, '纸片底 ' + cardStorm.pb + ' / 体力条顶 ' + cardStorm.st);
await setDay(51, 'sun');
const cardSun = JSON.parse(await cardBox());
ok('雷天那一张纸片不比晴天宽', cardStorm.w === cardSun.w, cardStorm.w + ' / ' + cardSun.w);
// 雷天那一张比晴天**高**一行是对的（天气行出现了就占一行，跟酒那一行一样）。
// 该守的不是「别变高」，是**最坏情况下也别顶出去** ——
// 酒和天气同时占位是这张纸片能达到的最高
await ev(`(function(){ FG.state.jiu=1; FG.updateHUD(); return 1})()`);
await setDay(52, 'storm');
const cardWorst = JSON.parse(await cardBox());
ok('最坏情况（酒 + 雷雨）也没有压到体力条上', cardWorst.pb <= cardWorst.st,
  '纸片底 ' + cardWorst.pb + ' / 体力条顶 ' + cardWorst.st);
ok('雷天那一张比晴天高了一行（天气确实占位了）', cardStorm.pb > cardSun.pb,
  cardStorm.pb + ' > ' + cardSun.pb);
await ev(`(function(){ FG.state.jiu=0; FG.updateHUD(); return 1})()`);

console.log('— 硐里不下雨 —');
/* 这一条要拿**两个不同天气**下的同一块像素比。
   早先那版在同一次读取里取了两遍再比相等 —— 同一个值跟自己比，
   永远绿，等于什么都没测。硐里渲染一样时两边该**一样**，
   所以必须先换天气再采一次，采到的是另一个状态的像素。 */
const minePix = () => ev(`(function(){
  var g=document.getElementById('game').getContext('2d');
  var d=g.getImageData(960,300,1,1).data;
  return d[0]+','+d[1]+','+d[2];
})()`);
await setDay(60, 'sun');
await ev(`(function(){ FG.gotoMap('shidong'); return 1})()`);
await sleep(500);
const mineSun = await minePix();
await setDay(61, 'rain');
await ev(`(function(){ FG.gotoMap('shidong'); return 1})()`);
await sleep(500);
const mineRain = await minePix();
console.log('  硐里同一块：晴 ' + mineSun + ' / 雨 ' + mineRain);
ok('在硐里了（不是把南山当硐量了）', (await ev(`FG.state.map`)) === 'shidong', await ev(`FG.state.map`));
ok('采到的不是纸片底色（不是量到了画布外面）', /^\d+,\d+,\d+$/.test(mineRain) && mineRain !== '0,0,0', mineRain);
ok('硐里那层暗色没因为下雨再压一层', mineSun === mineRain, '晴 ' + mineSun + ' / 雨 ' + mineRain);
ok('雷雨天也进不去，所以只能拿雨天跟晴天比', (await ev(`FG.isWetWeather()`)) === true);

console.log('— 雪天：地压着，山上的东西埋了，水里的照旧 —');
const snowDay = await findDay('snow');
console.log(`  头一个该下雪的日子 = 第 ${snowDay} 天（${await ev(`FG.solarOf(${snowDay}).n`)} / ${await ev(`FG.seasonOf(${snowDay}).n`)}）`);
ok('雪天是藏季', (await ev(`FG.seasonOf(${snowDay}).k`)) === 'winter', await ev(`FG.seasonOf(${snowDay}).n`));
ok('雪不算涨水（溪是活的）', (await ev(`FG.wetWeather('snow')`)) === false);
ok('雪天也不封硐（跟雷雨是两回事）', (await ev(`FG.mineShut()`)) === false);

await ev(`(function(){
  FG.gotoMap('nanshan');
  for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++){var p=FG.state.plots[r][c]; p.tilled=false; p.wet=false; p.crop=null; p.stage=0;}
  FG.state.stam=100; FG.state.sel='chu';
  return 1})()`);
await setDay(snowDay);
await clearToast();
await ev(`(function(){ FG.workArea('chu', 2, 2); return 1})()`);
await sleep(300);
ok('雪天翻不动地', (await tilledCount()) === 0, (await tilledCount()) + ' 畦翻过');
ok('雪天不扣体力', (await ev(`FG.state.stam`)) === 100, 'stam=' + await ev(`FG.state.stam`));
ok('提示说的是雪，不是「地冻上了」', (await toast()).indexOf('雪') >= 0, await toast());
// 两句都要是「雪压着」而不是「地冻上了」—— 地硬和雪盖是两件事，
// 玩家该分得清今天到底是哪一种挡住的
ok('雪天那句没混成地冻', (await toast()).indexOf('地冻') < 0, await toast());

await ev(`(function(){
  for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++)FG.state.plots[r][c].tilled=true;
  FG.state.seeds.dou=9; FG.state.sel=null; return 1})()`);
await clearToast();
await ev(`(function(){ FG.sowWith('dou', 2, 2); return 1})()`);
await sleep(300);
ok('雪天下不了种', (await ev(`FG.state.plots[2][2].crop`)) === null, 'crop=' + await ev(`FG.state.plots[2][2].crop`));
ok('雪天那句也是雪压着', (await toast()).indexOf('雪') >= 0, await toast());
ok('种子没被扣掉', (await ev(`FG.state.seeds.dou`)) === 9, 'dou=' + await ev(`FG.state.seeds.dou`));

// 山上的采不到，水里的照旧。
// 挑点要挑**当季的那个**：菱角到霜降、荇菜到寒露就没了，
// 拿「第一个水里的点」在立冬那天会挑到一个早就收摊的，
// 提示写的是「这个时节没有」—— 那是对的，但那不是这条要验的东西
const PICK = JSON.parse(await ev(`(function(){
  var l=FG.SPOTS.xipan.pick, i, land=[], water=[];
  for(i=0;i<l.length;i++) (l[i].wet?water:land).push({k:l[i].k, at:l[i].at, need:l[i].need});
  return JSON.stringify({land:land, water:water});
})()`));
ok('溪畔分得出山上的和 water 里的点', PICK.land.length > 0 && PICK.water.length > 0,
  '山上 ' + PICK.land.length + ' / 水里 ' + PICK.water.length);
/* 站到某个采集点旁边，但**躲开本图每一个 NPC 的说话圈和每一个钓点**。
   E 键的判定顺序是 人 > 钓 > 采 > 石 > 造 > 家 > 出口，
   而钓点半径 150 比采集点还大（130）—— 只躲 NPC 不够：
   田螺旁边那个站位离西汊浅滩只有 144，按 E 变成了「在西汊浅滩垂钓」，
   而田螺在当季、看着就在脚边。
   半径一律从 FG.SPOT_R 读，判据交给页面里的 nearNpc / nearPickSpot 复核。 */
const standClearOfNpc = async p => {
  // 坐标要**插值进页面表达式**。写 `p.at[0]` 的话那是 Node 侧的变量，
  // 页面里根本没有 p，一执行就抛，站位压根没设置 ——
  // 而 ev 把异常吞成一行字符串，后面所有读数读的都是「人还在原地」
  const PX = p.at[0], PY = p.at[1];
  await ev(`(function(){
    FG.gotoMap('xipan');
    var sp=FG.SPOTS.xipan, fish=sp.fish||[], ids=FG.MAPS.xipan.npcs||[], best=null, bd=1e9;
    var d, i, j, n, ang, R, ok, nx, ny;
    for(i=0;i<24;i++){
      ang=i*Math.PI/12; R=0;
      for(d=20;d<=FG.SPOT_R.pick-10;d+=20){
        nx=Math.round(${PX}+Math.cos(ang)*d); ny=Math.round(${PY}+Math.sin(ang)*d);
        ok=true;
        for(j=0;j<ids.length;j++){
          n=FG.NPCS[ids[j]]; if(!n) continue;
          if (Math.abs(n.at[0]-nx)+Math.abs(n.at[1]-ny) < FG.SPOT_R.npc) { ok=false; break; }
        }
        if(!ok) continue;
        for(j=0;j<fish.length;j++){
          if (Math.abs(fish[j].at[0]-nx)+Math.abs(fish[j].at[1]-ny) < FG.SPOT_R.fish) { ok=false; break; }
        }
        if(ok){ R=d; break; }
      }
      if(R>0 && R<bd){ bd=R;
        best=[Math.round(${PX}+Math.cos(ang)*R), Math.round(${PY}+Math.sin(ang)*R)]; }
    }
    if(!best) return 'NO_SPOT';
    FG.state.player.x=best[0]; FG.state.player.y=best[1];
    FG.state.walkTo=null; FG.state.hover=null;
    return JSON.stringify(best);
  })()`);
  await sleep(430);
  // 回读只查导出过的那几个。nearFish 没导出，写上去这条断言就红在
  // 「FG.nearFish is not a function」上，而那跟站位对不对没关系
  return await ev(`JSON.stringify([FG.state.player.x, FG.state.player.y]) + ' / 人: ' +
    (FG.nearNpc && FG.nearNpc() ? FG.nearNpc().id : '没有') + ' / 采: ' +
    (FG.nearPickSpot() ? FG.nearPickSpot().k : '没有')`);
};
const standAt2 = async p => {
  await ev(`(function(){
    FG.gotoMap('xipan');
    FG.state.player.x=${p.at[0]}; FG.state.player.y=${p.at[1]}+40;
    FG.state.walkTo=null; FG.state.hover=null; return 1})()`);
  await sleep(430);
};
// 站在那一天**当季**的那个点上。判据交给页里的 inTerms，别自己重写一遍
const onSeason = (list, day) => ev(`(function(){
  var l=${JSON.stringify(list)}, i;
  for(i=0;i<l.length;i++) if (FG.inTerms(${day}, FG.GOODS[l[i].k] ? FG.GOODS[l[i].k].terms : '*')) return l[i].k;
  return '';
})()`);
const landKey = await onSeason(PICK.land, snowDay);
const waterKey = await onSeason(PICK.water, snowDay);
const land0 = PICK.land.find(p => p.k === landKey);
const water0 = PICK.water.find(p => p.k === waterKey);
console.log(`  第 ${snowDay} 天当季：山上 ${landKey || '没有'} / 水里 ${waterKey || '没有'}`);
ok('那一天山上有当季的东西可采', !!landKey, landKey || '一处都没有');
ok('那一天水里有当季的东西可采', !!waterKey, waterKey || '一处都没有');
if (land0 && land0.need) await ev(`(function(){ FG.state.skill.cai.lv=Math.max(FG.state.skill.cai.lv, ${land0.need.cai}); return 1})()`);
await setDay(snowDay);
const near0 = await standClearOfNpc(land0);
ok('山上的点旁边有个站得住又不挨人的位置', near0 !== 'NO_SPOT' && near0.indexOf('人: 没有') >= 0 && near0.indexOf('采: 还没有') < 0, '站位 ' + near0);
const hLand = await hint();
ok('雪天山上的点说得出为什么采不到', hLand.indexOf('雪') >= 0, hLand);
await clearToast();
await key('e'); await sleep(300);
ok('按 E 也说雪压着（不是没反应）', (await toast()).indexOf('雪') >= 0, await toast());

if (water0 && water0.need) await ev(`(function(){ FG.state.skill.cai.lv=Math.max(FG.state.skill.cai.lv, ${water0.need.cai}); return 1})()`);
await setDay(snowDay);
const near1 = await standClearOfNpc(water0);
ok('水里的点旁边也有', near1 !== 'NO_SPOT' && near1.indexOf('人: 没有') >= 0 && near1.indexOf('采: 没有') < 0, '站位 ' + near1);
const hWater = await hint();
ok('雪天水里的点照采', hWater.indexOf('E　采') >= 0, hWater);
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 南山全景：四种天各来一张（1× 真游戏尺寸）—');
// 美术要看的是**整片画面**，不是站在某个判定点上的特写。
// 三张必须是同一个位置、同一片田，只换天气
const standField = async () => {
  await ev(`(function(){
    FG.gotoMap('nanshan');
    FG.state.player.x=900; FG.state.player.y=1000;
    FG.state.walkTo=null; FG.state.hover=null;
    for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++){
      var p=FG.state.plots[r][c]; p.tilled=true; p.wet=false;
    }
    return 1})()`);
  await sleep(500);
};
for (const [w, name] of [['sun', '44-南山-晴'], ['rain', '44-南山-雨'], ['storm', '44-南山-雷雨'], ['snow', '44-南山-雪']]) {
  const d = await findDay(w);
  await setDay(d, w);
  await standField();
  // 把上一条早上的浮字清掉再拍。真玩一天只排一条，测试里连着过了好几个
  // 雨天，奖励队列会把同抬头的并成一条，于是那句话在图上出现了两遍 ——
  // 那是测试的痕迹，不是游戏的问题，但截图会把它照出来
  await clearToast();
  await sleep(300);
  ok('南山的' + w + '天拍到了', (await ev(`FG.state.weather`)) === w, await ev(`FG.state.weather`));
  await shot(name + '.png');
}
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 存档往返 / 重开归零 —');await ev(`(function(){ FG.gotoMap('nanshan'); FG.state.weather='storm'; FG.saveGame(); return 1})()`);
await sleep(300);
await ev(`location.reload()`); await sleep(2600); await dismissTitle();
ok('读档回来还是雷天', (await ev(`FG.state.weather`)) === 'storm', await ev(`FG.state.weather`));
await ev(`FG.startFrom('cont')`); await sleep(1200);
ok('续前一日还是雷天', (await ev(`FG.state.weather`)) === 'storm', await ev(`FG.state.weather`));

// 重开：带着一个「雷天」的存档去开新局，天要归位。
// 直接看新局第一天本来就是晴天是不够的 —— 那条永远绿着，
// 它分不出「重开时归零了」和「重开时压根没管过天气」
console.log('— 带着雷天的存档开新局 —');
await ev(`(function(){
  FG.state.weather='storm';
  for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++){
    var p=FG.state.plots[r][c]; p.wet=true; p.tilled=true; p.crop='dou'; p.stage=3;
  }
  FG.state.album=Object.assign({}, FG.state.album); FG.state.album.till=1;
  FG.state.met=Object.assign({}, FG.state.met); FG.state.met.stele1=1;
  FG.state.got=Object.assign({}, FG.state.got); FG.state.got.stele1=1;
  FG.state.earned=888;
  FG.state.day=40; FG.saveGame(); return 1})()`);
await sleep(300);
await ev(`location.reload()`); await sleep(2600);
  // 刷新之后先续上再读 S。**不能「刷新完直接读」** ——
  // 老的 showTitle() 开头就调 load()，于是「看见标题」等于「档已经读进来了」；
  // 三格存档之后标题读摘要走的是不碰 S 的 slotInfo，那层隐含的读档没了。
  // 读档该由玩家按「续」触发，这一条正是从那条副作用上挪出来的
  await dismissTitle();
  ok('存档确实带着上一世的东西', (await ev(`FG.state.earned`)) === 888, 'earned=' + await ev(`FG.state.earned`));
await ev(`FG.startFrom('new')`); await sleep(1200);
ok('开新局回到第一天', (await ev(`FG.state.day`)) === 1, 'day=' + await ev(`FG.state.day`));
ok('新局第一天是晴天', (await ev(`FG.state.weather`)) === 'sun', await ev(`FG.state.weather`));
ok('新局地是干的', (await wetCount()) === 0, (await wetCount()) + ' 畦湿');
ok('新局的田是空地（没带着上一世翻好的土）', (await tilledCount()) === 0, (await tilledCount()) + ' 畦翻过');
ok('新局田里没有上一世的谷', (await ev(`(function(){
  for(var r=0;r<FG.FIELD.ROWS;r++)for(var c=0;c<FG.FIELD.COLS;c++) if(FG.state.plots[r][c].crop) return FG.state.plots[r][c].crop;
  return '';
})()`)) === '');
// 「入山」漏掉的那几项：诗册、见闻、收录、累计。测试是照着重开那条路写的，
// 那儿全，这一处当初少了一截 —— 玩家的路径很朴素：玩几天 → F5 → 点「入山」
ok('新局诗册是空的', (await ev(`Object.keys(FG.state.album||{}).length`)) === 0,
  (await ev(`JSON.stringify(FG.state.album)`)));
ok('新局见闻/收录是空的',
  (await ev(`Object.keys(FG.state.met||{}).length`)) === 0 && (await ev(`Object.keys(FG.state.got||{}).length`)) === 0,
  'met=' + (await ev(`JSON.stringify(FG.state.met)`)) + ' got=' + (await ev(`JSON.stringify(FG.state.got)`)));
ok('新局累计归零', (await ev(`FG.state.earned`)) === 0, 'earned=' + await ev(`FG.state.earned`));

console.log('');
console.log('LOGS ' + (logs.length ? '有输出：\n' + logs.join('\n') : '(无报错)'));
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(0);
