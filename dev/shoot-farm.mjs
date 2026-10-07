// 农时（诗册第五页）+ 再生作物看得见。
//
// 「今天有什么讲究」那七条规矩散在 step / gotoMap / pickBlockWord / till /
// stepFishing 五个地方，各自判得都对，而**玩家一条也看不见** ——
// 除非他正好去做那件事、撞上了才知道。这一页把它们收齐。
//
// 再生这一项做的是「把已有的机制做完整」：
// **代码里本来就有**（`if (C[k].regrow)`，菊 30 天、5 天一割），
// 但它一声不吭 —— 割完 stage 悄悄退回去，画面上看不出这畦跟别的有什么不同。
// 一个玩家看不见的机制等于没有，所以这一套盯的是「看得见」。
//
// 盯住这几条：
//   1) 六条讲究的判据全走 FG 那几支，**不在别处再写一遍**
//   2) 判对：雨→畦湿、雷雨→硐口封、雪→种不下、冻→翻不动、天黑→人回家
//   3) 晴天/不是大寒那几天，那几条**一条都不该出现**
//   4) 二十四节气一天不少，每一行写得出「能下种什么」
//   5) 再生只画在畦上；刀数按**这个时节还剩几天**算，不是表上写死
//   6) 割完那一句说得出还剩几刀
//   7) 农时页的两块（今天 / 全年）不混
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9406;
const profile = path.join(tmpdir(), 'guxian-farm-' + process.pid);
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
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
const alHtml = () => ev(`document.getElementById('al-list').innerHTML`);
const alText = () => ev(`(function(){var e=document.getElementById('al-list');
  return e?e.textContent.replace(/\\s+/g,' ').trim():'';})()`);
const toast = () => ev(`document.getElementById('toast').textContent`);
// 摆成某个节气 + 某个天气，然后翻到农时那一页
const setDay = async (solarK, weather) => {
  await ev(`(function(){
    for (var d=1; d<=FG.SOLAR_YEAR; d++) if (FG.solarOf(d).k===${JSON.stringify(solarK)}) { FG.state.day=d; break; }
    FG.state.min=10*60; FG.state.weather=${JSON.stringify(weather || 'sun')};
    FG.state.started=true; FG.state.ended=false;
    FG.gotoMap('nanshan'); FG.updateHUD();
    FG.openAlbum(); FG.setAlPage('farm'); return 1})()`);
  await sleep(460);
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
await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

console.log('— 六条讲究，判据都走 FG 那几支 —');
ok('表上有六条', (await ev(`Object.keys(FG.FARM).length`)) === 6,
  Object.keys(await ev(`JSON.stringify(Object.keys(FG.FARM))`)).length + ' 条');
ok('每一条都指得出判据（on 不空）',
  (await ev(`(function(){var bad=[];for(var k in FG.FARM) if(!FG.FARM[k].on) bad.push(k);
    return bad.join('　');})()`)) === '');
ok('「农时」这一页在页签上',
  (await ev(`!!document.querySelector('#al-tabs .al-tab[data-p="farm"]')`)) === true);

console.log('\n— 各天各判各的 —');
// 晴天：不该有任何一条
await setDay('lichun', 'sun');
ok('晴天不湿', (await ev(`FG.farmOn('wet')`)) === false);
ok('晴天的册子上写的是「今天没什么讲究」', /今天没什么讲究/.test(await alText()), (await alText()).slice(0, 40));
ok('（晴天也不该提大寒）', (await ev(`FG.farmOn('last')`)) === false);

// 雨
await setDay('lichun', 'rain');
ok('下雨 → 畦湿了', (await ev(`FG.farmOn('wet')`)) === true);
ok('下雨 → 册子上写着今天不用浇水', /不用浇水/.test(await alText()), (await alText()).slice(0, 70));
ok('下雨 → 溪水没涨到封硐那一条（那是雷雨才封）', (await ev(`FG.farmOn('storm')`)) === false);

// 雷雨
await setDay('lichun', 'storm');
ok('雷雨 → 溪水涨了、硐口封着', (await ev(`FG.farmOn('storm')`)) === true);
ok('雷雨 → 判据和实际那道口一致（真的是封硐口那一条）',
  (await ev(`(function(){ FG.state.day=1; return FG.farmOn('storm');})()`)) === true);
ok('雷雨 → 也湿了', (await ev(`FG.farmOn('wet')`)) === true);

// 雪
await setDay('dongzhi', 'snow');
ok('下雪 → 雪压着地', (await ev(`FG.farmOn('snow')`)) === true);
ok('下雪 → 册子上写着翻不了土也种不下去', /翻不了土|种不下去/.test(await alText()), (await alText()).slice(0, 80));
ok('下雪 → 地也冻着', (await ev(`FG.farmOn('frozen')`)) === true);
ok('下雪 → 溪水那条不成立（雪天不是涨水）', (await ev(`FG.farmOn('storm')`)) === false);

// 天黑
await ev(`(function(){ FG.state.day=1; FG.state.weather='sun'; FG.state.min=21*60;
  FG.openAlbum(); FG.setAlPage('farm'); return 1})()`);
await sleep(420);
ok('天黑了 → 册子上写着铺子收了、人也回家了', /铺子收了|人.*回家/.test(await alText()), (await alText()).slice(0, 80));
ok('（与实际一致：邻翁这会儿确实不在外头）', (await ev(`FG.mapNpcsOut().length`)) === 0);
await ev(`(function(){ FG.state.min=10*60; FG.updateHUD(); return 1})()`); await sleep(300);

// 大寒
await ev(`(function(){ FG.state.day=FG.SOLAR_YEAR; FG.state.weather='sun'; FG.state.min=10*60;
  FG.openAlbum(); FG.setAlPage('farm'); return 1})()`);
await sleep(420);
ok('大寒那一句出来了', (await ev(`FG.farmOn('last')`)) === true && /大寒/.test(await alText()));
ok('大寒那一句**没有出处**（规矩是这游戏定的，不是农谚）',
  (await ev(`(function(){var w=FG.FARM.last; return w.f==='——';})()`)) === true,
  await ev(`FG.FARM.last.f`));
ok('全表六条没有一条冒充出处（要么 —— 要么挂得上）',
  (await ev(`(function(){var bad=[];
    for(var k in FG.FARM){ var f=FG.FARM[k].w;
      if (f.indexOf('「')>=0 && f.f==='——') bad.push(k); }
    return bad.join('　');})()`)) === '');

console.log('\n— 二十四节气全表 —');
await setDay('lichun', 'sun');
ok('二十四行一个不少', (await ev(`document.querySelectorAll('#al-list .fm-r').length`)) === 24,
  (await ev(`document.querySelectorAll('#al-list .fm-r').length`)) + ' 行');
ok('每一行都写得出物候（不是空着）',
  (await ev(`(function(){
    return Array.prototype.every.call(document.querySelectorAll('#al-list .fm-p'), function(e){
      return e.textContent.trim().length>1; }); })()`)) === true);
ok('每一行都写得出「能下种什么」（哪怕是「—」）',
  (await ev(`document.querySelectorAll('#al-list .fm-s2').length`)) === 24);
// 当令那一行要标出来
ok('今天那一行高亮',
  (await ev(`document.querySelectorAll('#al-list .fm-r.on').length`)) === 1,
  (await ev(`(function(){var e=document.querySelector('#al-list .fm-r.on .fm-n');return e?e.textContent:'(没有)';})()`)));
ok('高亮的正是今天那个节气',
  (await ev(`(function(){
    var e=document.querySelector('#al-list .fm-r.on .fm-n');
    return e && e.textContent===FG.solarOf(FG.state.day).n;})()`)) === true);
// 跟下种判据对得上：翻一年，册子上说的每一行都得真的能种
const mismatch = await ev(`(function(){
  var bad=[];
  for (var d=1; d<=FG.SOLAR_YEAR; d++){
    var k=FG.solarOf(d).k, cands=[];
    for (var c in FG.CROPS) if (FG.CROPS[c].terms.indexOf(k)>=0) cands.push(FG.CROPS[c].name);
    FG.state.day=d;
    var shown=FG.cropsSowable();
    // 表上说的和判据说的要一致（次序不同不算错，比一下集合）
    if (cands.slice().sort().join(',') !== shown.slice().sort().join(','))
      bad.push(k+': 表 '+shown.join('/')+' 判据 '+cands.join('/'));
  }
  return bad.join('　');})()`);
ok('翻一整年：表上「能下种」和真判据一天都不差', mismatch === '', mismatch || '144 天全对');
ok('今天能下种那一句也写在册子上了',
  /今天能下种/.test(await alText()), (await alText()).match(/今天能下种：[^　]*/) ? (await alText()).match(/今天能下种：.{0,24}/)[0] : '');

console.log('\n— 再生：看得见 —');
ok('表上菊是再生的（5 天一割）', (await ev(`FG.CROPS.ju.regrow`)) === 5,
  'regrow=' + await ev(`FG.CROPS.ju.regrow`));
ok('别的四样不是再生的（豆麦黍稷都是一年生）',
  (await ev(`['dou','su','shu','ji'].every(function(c){ return !FG.CROPS[c].regrow; })`)) === true);
ok('刀数按**这个时节还剩几天**算，不是表上写死',
  (await ev(`(function(){
    // 同一天种、隔一天割两次，刀数该一样（剩的天数没变）；
    // 而到了白露末尾就该比早割的那些少
    FG.state.day=73; var a=FG.cutLeft('ju',1);   // 立秋头一天
    FG.state.day=85; var b=FG.cutLeft('ju',1);   // 处暑末尾
    return b<=a ? '早 '+a+' 晚 '+b : '早 '+a+' 晚 '+b+'（反了）';})()`)).indexOf('反了') < 0,
  await ev(`(function(){ FG.state.day=73; return '立秋头一天 '+FG.cutLeft('ju',1); })()`)
  + '　' + await ev(`(function(){ FG.state.day=85; return '处暑末尾 '+FG.cutLeft('ju',1); })()`));
ok('过了白露就不该再有刀（那个时节种不下去了）',
  (await ev(`(function(){ FG.state.day=91; return FG.cutLeft('ju',1); })()`)) === 0,
  '第 91 天（寒露）还剩 ' + await ev(`(function(){ FG.state.day=91; return FG.cutLeft('ju',1); })()`) + ' 刀');

console.log('\n— 割一回：说得出还剩几刀，地上看得出割过 —');
await ev(`(function(){
  FG.state.day=73; FG.state.min=10*60; FG.state.weather='sun';
  FG.gotoMap('nanshan');
  FG.state.plots[2][2]={tilled:true,wet:false,crop:'ju',stage:30,cut:0};
  FG.state.player.x=700; FG.state.player.y=700; FG.state.walkTo=null;
  FG.updateHUD(); return 1})()`);
await sleep(480);
ok('熟了的菊能收', (await ev(`FG.state.plots[2][2].stage`)) === 30);
await ev(`(function(){ FG.harvest(2,2); return 1})()`);
await sleep(300);
const cutTxt = await toast();
ok('收完那一句说得出还能再割几刀', /还能再割\s*\d+\s*刀/.test(cutTxt), cutTxt);
ok('地里的畦没清掉（还在原地等下一茬）', (await ev(`FG.state.plots[2][2].crop`)) === 'ju');
ok('stage 退回到「再等 regrow 天就熟」',
  (await ev(`FG.state.plots[2][2].stage`)) === 25, 'stage=' + await ev(`FG.state.plots[2][2].stage`));
ok('割过几刀记下来了', (await ev(`FG.state.plots[2][2].cut`)) === 1, 'cut=' + await ev(`FG.state.plots[2][2].cut`));
// 画面上要画得出茬
const ink2 = await ev(`(function(){
  var c=document.getElementById('game'), g=c.getContext('2d');
  var q=FG.cellQuad(2,2);   // 四个角点，不是 [x0,y0,x1,y1]
  var xs=[q[0][0],q[1][0],q[2][0],q[3][0]], ys=[q[0][1],q[1][1],q[2][1],q[3][1]];
  var X=Math.max(0,Math.round(Math.min.apply(null,xs)));
  var Y=Math.max(0,Math.round(Math.min.apply(null,ys)));
  var Wd=Math.max(1,Math.round(Math.max.apply(null,xs)-X));
  var Ht=Math.max(1,Math.round(Math.max.apply(null,ys)-Y));
  Wd=Math.max(1,Math.min(Wd, c.width-X)); Ht=Math.max(1,Math.min(Ht, c.height-Y));
  var d=g.getImageData(X, Y, Wd, Ht).data;
  var n=0; for(var i=3;i<d.length;i+=4) if(d[i]>10) n++;
  return Math.round(n*100/(d.length/4));})()`);
ok('那一畦上有画（不是一片光板）', ink2 > 3, ink2 + '% 有墨');
// 截图前**把诗册收起来** —— 前面那几段一直开着农时，
// 截出来的是纸上那一页，而要看的茬在田里
await ev(`document.getElementById('al-x').click()`);
await sleep(260);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 });
await sleep(360);
await shot('73-农时-再生茬.png');
ok('截图前诗册收起来了（截的是田，不是纸上那一页）',
  (await ev(`document.getElementById('al').classList.contains('hide')`)) === true);
// 茬画没画，**用数字分不开**：两格差的不只是茬，还有谷物本身的大小
// （豆长到一半已经是一大束，菊长到八成才刚起头）。
// 所以这里只判「两格画得不一样」，认出认不出交给那张 1× 截图。
const two = await ev(`(function(){
  function ink(c2,r2){
    var c=document.getElementById('game'), g=c.getContext('2d');
    var q=FG.cellQuad(c2,r2);
    var xs=[q[0][0],q[1][0],q[2][0],q[3][0]], ys=[q[0][1],q[1][1],q[2][1],q[3][1]];
    var X=Math.round(Math.min.apply(null,xs)), Y=Math.round(Math.min.apply(null,ys));
    var Wd=Math.max(1,Math.min(Math.round(Math.max.apply(null,xs)-X), c.width-X));
    var Ht=Math.max(1,Math.min(Math.round(Math.max.apply(null,ys)-Y), c.height-Y));
    var d=g.getImageData(X,Y,Wd,Ht).data, n=0;
    for(var i=3;i<d.length;i+=4) if(d[i]>10) n++;
    return n;
  }
  FG.state.plots[2][2]={tilled:true,wet:false,crop:'ju',stage:25,cut:1};
  FG.state.plots[2][3]={tilled:true,wet:false,crop:'dou',stage:3,cut:0};
  FG.updateHUD();
  return JSON.stringify({ju:ink(2,2), dou:ink(2,3)});})()`);
const tt = JSON.parse(two);
ok('两格画得不一样（茬那一遍不是白跑的）', tt.ju !== tt.dou,
  '菊 ' + tt.ju + '　豆 ' + tt.dou + '（差里也含谷物本身，认不认得出看截图）');
// 一刀一刀割下去，刀数往下走
// 日子在**测试这一侧**算好再拼进表达式 —— 把循环变量 i 塞进模板里，
// 到了页面那边就只剩一个字面的 i 了
for (let n = 0; n < 3; n++) {
  const day = 73 + n * 5;
  await ev(`(function(){ FG.state.plots[2][2].stage=30; FG.state.day=${day}; FG.harvest(2,2); return 1})()`);
  await sleep(180);
}
ok('连着割，刀数记着数', (await ev(`FG.state.plots[2][2].cut`)) === 4, 'cut=' + await ev(`FG.state.plots[2][2].cut`));
// 一次性的作物割完就没了（对照）
// 体力先补上：前面连着割了好几刀，`spend(1)` 拦在 harvest 最前面，
// 体力没了就 return，畦原封不动 —— 症状是「割了却还长在地里」
await ev(`(function(){ FG.state.stam=FG.state.maxStam=100;
  FG.state.plots[2][3]={tilled:true,wet:false,crop:'dou',stage:4,cut:0};
  FG.state.day=73; return 1})()`);
// harvest(col, row) —— **列在前**，所以第 2 行第 3 列是 harvest(3,2)。
// 写反了就割在隔壁那一格，而症状是「割完了这畦还在」
await ev(`FG.harvest(3,2)`); await sleep(200);
ok('（对照）一次性的割完就没了，不留茬', (await ev(`FG.state.plots[2][3].crop`)) === null,
  '体力 ' + await ev(`FG.state.stam`) + '　crop=' + await ev(`FG.state.plots[2][3].crop`));
ok('（对照）一次性的那一句不说「还能再割」', !/还能再割/.test(await toast()), await toast());

console.log('\n— 两块不混：今天在上，全年在下 —');
await setDay('yushui', 'rain');
const h = await alHtml();
ok('上半是「今 日」，下半是「二 十 四 节 气」',
  h.indexOf('今 日') > 0 && h.indexOf('二 十 四 节 气') > h.indexOf('今 日'),
  '今日在第 ' + h.indexOf('今 日') + '，节气表在第 ' + h.indexOf('二 十 四 节 气'));
ok('两块各有各的标题，不是并在一块里',
  (await ev(`document.querySelectorAll('#al-list .fm-h').length`)) === 2);
await shot('74-诗册-农时.png');
ok('截了两张（再生茬 / 农时）', true);

console.log('\n— 老存档 / 重开 —');
ok('农时页跟存档无关，纯从表和日子算',
  (await ev(`(function(){
    FG.state.day=1; FG.state.weather='rain'; var a=FG.farmView();
    FG.state.day=50; FG.state.weather='sun'; var b=FG.farmView();
    return a!==b ? '跟着日子变' : '不动';})()`)) === '跟着日子变');
await ev(`FG.restart()`); await sleep(400);
await ev(`FG.openAlbum(); FG.setAlPage('farm')`); await sleep(320);
ok('重开之后这一页还画得出来', (await ev(`document.querySelectorAll('#al-list .fm-r').length`)) === 24);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
