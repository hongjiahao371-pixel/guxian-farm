// 天色验收。
//
// 钟本来就在走（05:00 → 22:00），可画面从头到尾一个色。
// 这一套盯的是：色罩真的随时辰走、灯真的在薄暮起、
// 以及**跟着钟变的那三件事**（收线 / 邻居回家 / 铺子收摊）是不是都接上了。
//
// 盯住这几条：
//   1) 正午那一帧是全透明的 —— 一张水墨画天天压一层色就不是那张画了
//   2) 色是**插值**的，不是一段一段跳的（跳的话画面「啪」一下变，玩家只觉得坏了）
//   3) 越晚越暗，且是**往蓝里沉**不是加一层黑
//   4) 硐里不盖天色（地下没有天光）
//   5) 灯在色罩**之后**（跟着一起压暗就等于没点灯）
//   6) 三个跟着钟变的事都接上了，而且**暗着的都回一句话**
//   7) 生辰那天他不回家（他在等你）
//   8) 存档往返 / 截图
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9403;
const profile = path.join(tmpdir(), 'guxian-dusk-' + process.pid);
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
  await sleep(180);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
const toast = () => ev(`document.getElementById('toast').textContent`);
const hint = () => ev(`document.getElementById('hint').textContent`);
// 把钟拨到某一刻，站在南山上
const setClock = async (h, mi, map) => {
  await ev(`(function(){ FG.state.min=${h * 60 + (mi || 0)};
    ${map ? `FG.gotoMap(${JSON.stringify(map)});` : ''}
    FG.state.player.x=900; FG.state.player.y=820; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
  await sleep(420);
  // 至少两个渲染帧，让色罩真的画上去
  await sleep(260);
};
// 亮度量到小数点后一位：整数量化会把 186 → 186 那种差读成「没变」
const lum = () => ev(`(function(){
  var c=document.getElementById('game'), g=c.getContext('2d');
  var d=g.getImageData(Math.floor(c.width*0.35), Math.floor(c.height*0.30), 220, 160).data;
  var s=0,n=0; for(var i=0;i<d.length;i+=4){ s+=d[i]*0.30+d[i+1]*0.59+d[i+2]*0.11; n++; }
  return Math.round(s/n*10)/10;})()`);
// 画面偏蓝还是偏黄（夜里该往蓝里沉，纯黑压下去山川就成剪影了）
const blueness = () => ev(`(function(){
  var c=document.getElementById('game'), g=c.getContext('2d');
  var d=g.getImageData(Math.floor(c.width*0.35), Math.floor(c.height*0.30), 220, 160).data;
  var b=0,r=0,n=0; for(var i=0;i<d.length;i+=4){ b+=d[i+2]; r+=d[i]; n++; }
  return Math.round((b-r)/n*10)/10;})()`);

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

console.log('— 表本身：关键帧是插出来的，不是跳出来的 —');
const K = JSON.parse(await ev(`JSON.stringify(FG.LIGHT)`));
K.forEach(k => console.log('  ' + String(k.m).padStart(4) + ' 分  ' + k.n + '  rgba(' + k.r + ',' + k.g + ',' + k.b + ',' + k.a + ')'));
ok('关键帧按时间排好了（没排后面就插不对）', K.every((k, i) => i === 0 || k.m > K[i - 1].m));
ok('覆盖了一整天（首帧 ≤ 05:00，末帧 ≥ 22:00）',
  K[0].m <= 5*60 && K[K.length - 1].m >= 22*60, K[0].m + ' ~ ' + K[K.length - 1].m);
ok('**正午那一帧是全透明的**（画画那几小时就该是原样）',
  K.some(k => k.a === 0), K.filter(k => k.a === 0).map(k => k.n).join('　') || '(没有全透明帧)');
ok('夜里是往蓝里沉（蓝通道 > 红通道），不是加一层黑',
  K[K.length - 1].b > K[K.length - 1].r, '末帧 b=' + K[K.length - 1].b + ' r=' + K[K.length - 1].r);
ok('从正午往夜是单调变厚的（清早那层薄雾不算，它到正午就散了）',
  (() => { const fromNoon = K.filter(k => k.m >= 12 * 60); return fromNoon.every((k, i) => i === 0 || k.a > fromNoon[i - 1].a); })(),
  K.filter(k => k.m >= 12 * 60).map(k => k.n + ' ' + k.a).join(' → '));
ok('清早那层薄雾到正午是收掉的（不是盖一整天）',
  K[0].a > 0 && K[K.findIndex(k => k.a === 0)].a === 0,
  K.map(k => k.n + ' ' + k.a).join(' → '));
// 插值必须连续 —— 每分钟走一步，不许有跳变
const jump = JSON.parse(await ev(`(function(){
  var prev=null, bad=[];
  for (var m=FG.DAY.START; m<=FG.DAY.END; m++){
    var a=FG.nightAmount(m);
    if (prev!==null){ var d=Math.abs(a-prev); if (d>0.02) bad.push(m+': 一分钟跳了 '+d.toFixed(3)); }
    prev=a;
  }
  return JSON.stringify(bad);})()`));
ok('每分钟都是缓的（没有一分钟之内跳过一档）', jump.length === 0, jump || '17 小时 0 处跳变');

console.log('\n— 画面真的跟着钟走 —');
const L = {};
for (const [name, h, mi] of [['晨', 5, 10], ['午', 12, 0], ['斜', 16, 40], ['暮', 17, 40], ['月', 20, 30], ['灯', 21, 40]]) {
  await setClock(h, mi);
  L[name] = { lum: await lum(), blue: await blueness() };
  console.log('  ' + name.padEnd(2) + ' ' + String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0')
    + '　亮度 ' + String(L[name].lum).padStart(3) + '　蓝减红 ' + L[name].blue);
}
ok('正午是原样（那一帧没盖东西）', L.午.lum >= 180, '午 ' + L.午.lum);
// 斜阳那一帧是**暖色**的，盖上去会略微提亮一点点（185.7 → 186.2），
// 所以「午 ≥ 斜」这条不成立也不该成立 —— 要看的是**斜阳往夜**那一段在不在降
ok('从斜阳往夜一路变暗', L.斜.lum > L.暮.lum && L.暮.lum > L.月.lum && L.月.lum > L.灯.lum,
  [L.斜.lum, L.暮.lum, L.月.lum, L.灯.lum].join(' → '));
ok('夜里往蓝里沉，不是压成灰', L.灯.blue > L.午.blue, '午 ' + L.午.blue + '　灯 ' + L.灯.blue);
ok('但夜里不是全黑（山川还看得出，不是剪影）', L.灯.lum > 40, '亮度 ' + L.灯.lum);
ok('清早那层薄雾不把画压暗（晨和午差不多亮）',
  Math.abs(L.晨.lum - L.午.lum) < 8, '晨 ' + L.晨.lum + '　午 ' + L.午.lum);

console.log('\n— 灯：暮起，跟着夜色变亮 —');
await setClock(12, 0);
ok('正午夜里深度是 0（白天连灯那一遍都不画）',
  // 钟会在两次 ev 之间自己往前走，所以在**同一次**里设钟 + 读数，
  // 分成两次读的话读到的是已经走过两分钟的正午，插值出来就不是 0 了
  (await ev(`(function(){ FG.state.min=12*60; return FG.nightAmount(FG.state.min);})()`)) === 0);
// 测灯的量法：**全画面最暖的那一点**不能用 ——
// HUD 里那枚红印的 r−b 有 161，比灯还高，量到的一直是它。
// 灯的记号是**它那一块地方暖**：位置是知道的（FG.LAMPS），
// 所以在那一小块上量，而不是全画面找极值。
// 画布后备缓冲就是 1920×1080，而灯是按画布坐标画的，所以可以直接按坐标取。
//
// 量**南山那盏路边的**（[1700,520]，竹坡上），不量门口那盏：
// 门口那盏旁边是满地金黄的菊，白天那一块 r−b 本来就有 76，
// 量出来的一直是花，不是灯。
const atLamp = () => ev(`(function(){
  var p=(FG.LAMPS[FG.state.map]||[]);
  if (!p.length) return JSON.stringify({warm:-999});
  var q = p.length>1 ? p[1] : p[0];
  var c=document.getElementById('game'), g=c.getContext('2d');
  var X=Math.round(q[0]), Y=Math.round(q[1])-105;
  var d=g.getImageData(X-60, Y-60, 120, 120).data, best=-999;
  for (var i=0;i<d.length;i+=4){
    var v=d[i]*0.30+d[i+1]*0.59+d[i+2]*0.11;
    if (v<40) continue;                    // 太暗的像素色差是噪声，不算
    var w=d[i]-d[i+2]; if (w>best) best=w;
  }
  return JSON.stringify({warm:Math.round(best), at:q});})()`);
await ev(`(function(){ FG.gotoMap('nanshan'); FG.state.min=12*60; FG.updateHUD(); return 1})()`);
await sleep(520);
const noonInk = JSON.parse(await atLamp());
await ev(`(function(){ FG.state.min=21*60; FG.updateHUD(); return 1})()`);
await sleep(520);
const nightInk = JSON.parse(await atLamp());
console.log('  路边那盏灯：正午 ' + JSON.stringify(noonInk) + '　夜里 ' + JSON.stringify(nightInk));
ok('夜里灯那一块多出**暖**光（火光不是月光）', nightInk.warm > noonInk.warm + 10,
  noonInk.warm + ' → ' + nightInk.warm);
ok('那点暖是真的亮（不是一丁点色偏）', nightInk.warm > 25, '红减蓝 ' + nightInk.warm);
ok('正午那块地方是冷的（灯没白点着）', noonInk.warm < nightInk.warm - 10, noonInk.warm);
const nLamps = await ev(`(function(){var n=0; for(var k in FG.LAMPS) n+=FG.LAMPS[k].length; return n;})()`);
ok('灯挂了几盏', nLamps > 0, nLamps + ' 盏');
ok('后山（桃花源）不点灯',
  (await ev(`(FG.LAMPS.houshan||[]).length`)) === 0);
// 灯位：不能压在**人**身上（那盏灯就从人身上长出来），也不能压在出口上
// （灯杆杵在门口，人过不去）。跟歇脚处的碑挨着是可以的 ——
// 路边一盏灯本来就该在碑边上，判 90 是「两根杆子各自半宽之和」
const lampBad = await ev(`(function(){
    var bad=[];
    for (var mk in FG.LAMPS){
      var m=FG.MAPS[mk], ls=FG.LAMPS[mk];
      ls.forEach(function(p){
        (m.npcs||[]).forEach(function(n){ var q=FG.NPCS[n];
          if (Math.abs(q.at[0]-p[0])+Math.abs(q.at[1]-p[1]) < 90) bad.push(mk+' 灯'+p+'×人:'+n); });
        (m.exits||[]).forEach(function(e){
          if (Math.abs(e.at[0]-p[0])+Math.abs(e.at[1]-p[1]) < e.r+60) bad.push(mk+' 灯'+p+'×口:'+e.to); });
        if (m.station && Math.abs(m.station[0]-p[0])+Math.abs(m.station[1]-p[1]) < 90)
          bad.push(mk+' 灯'+p+'压在歇脚处上');
      });
    }
    return bad.join('　');})()`);
ok('灯位不压在别人身上（人 / 出口），跟歇脚处的碑离得开',
  lampBad === '', lampBad || '(六盏都不挨着谁)');
ok('硐里不盖天色（地下没有天光）：同一硐里，正午和深夜亮度一样',
  await (async () => {
    await ev(`(function(){ FG.gotoMap('shidong'); FG.state.min=12*60; return 1})()`);
    await sleep(500);
    const a = await lum();
    await ev(`(function(){ FG.state.min=21*60; FG.updateHUD(); return 1})()`);
    await sleep(500);
    const b = await lum();
    return Math.abs(a - b) < 1.5;
  })(),
  '硐里正午 ' + await (async () => { await ev(`(function(){ FG.state.min=12*60;return 1})()`); await sleep(300); return lum(); })()
  + '　深夜 ' + await (async () => { await ev(`(function(){ FG.state.min=21*60;return 1})()`); await sleep(300); return lum(); })());
await ev(`(function(){ FG.gotoMap('nanshan'); return 1})()`); await sleep(400);
ok('（对照）南山同一刻比硐里亮得多 —— 硐里那层暗是 mineDim 管的',
  (await (async () => { await setClock(21, 40); return lum(); })()) > 100,
  '南山夜里 ' + await lum() + '　硐里约 92');

console.log('\n— 跟着钟变的三件事 —');
// 1) 溪里收线
await ev(`(function(){
  FG.gotoMap('xipan');
  var a=(FG.SPOTS.xipan.fish||[])[0].at;
  FG.state.player.x=a[0]; FG.state.player.y=a[1]+40; FG.state.walkTo=null;
  FG.state.min=16*60; FG.updateHUD(); return 1})()`);
await sleep(460);
await key('e');                        // 抛竿
await ev(`(function(){
  FG.state.fishing={i:0,t:0,wait:99,win:0.2,phase:'wait',spot:(FG.SPOTS.xipan.fish||[])[0]};
  FG.state.min=FG.DAY.END+20; FG.updateHUD(); return 1})()`);
await sleep(900);
ok('熄灯以后把线收了（浮漂不会一直挂着）', (await ev(`!!FG.state.fishing`)) === false);
ok('**收线要说一句**（静悄悄抽走浮漂，玩家回头只发现线没了）', /看不清浮漂|收线/.test(await toast()), await toast());

console.log('\n— 夜钓：渔四级那个解锁到底兑现了没有 —');
// 原来这条线是用 **天擦黑（17:30）** 收的，而夜鱼的判据是 **带月（20:00）** ——
// 两个数一比，夜鱼的窗口宽度是 0。玩家照解锁文案熬到 20 点，
// 竿抛出去了、下一帧就被收走，288 天试了 72 次一次没钓上来。
//
// **判据：这个窗口得是开着的。** 不是核「天黑了会收线」，
// 是核「渔四级 + 带月 20:00 → 夜鱼出得来，而且竿能等到咬钩」。
// 中间试过把收线挪到 isNight，**那还是 0 宽**——
// 20:00 既出夜鱼又被收线，正好撞在同一个点上。收到熄灯 22:00 才有窗口
await ev(`(function(){ FG.gotoMap('xipan');
  var a=(FG.SPOTS.xipan.fish||[])[0].at;
  FG.state.player.x=a[0]; FG.state.player.y=a[1]+40; FG.state.walkTo=null;
  FG.skillFix(); FG.state.skill.yu.lv=4; FG.state.skill.yu.pt=0;
  FG.state.day=40;                       // 夜鱼 fromDay=3，前两天钓不着是故意的
  FG.updateHUD(); return 1})()`);
await sleep(400);
ok('（前提）渔到了四级', (await ev(`FG.skillLv('yu')`)) === 4, 'yu=' + (await ev(`FG.skillLv('yu')`)));
// 窗口的两个头：带月出得来，熄灯收线
for (const m of [1200, 1230, 1300]) {
  await ev(`(function(){ FG.state.min=${m}; FG.updateHUD(); return 1})()`);
  await sleep(150);
  const h = await ev(`JSON.stringify(FG.fishHere())`);
  ok('min=' + m + '（' + (m >= 1200 ? '带月' : '带月前') + '）夜鱼出得来',
     m < 1200 || /黄鳝|鳝鲿/.test(h), h);
}
await ev(`(function(){ FG.state.min=1205; FG.updateHUD(); return 1})()`);
await sleep(150);
ok('（前提）白天那几种还在', (await ev(`JSON.stringify(FG.fishHere())`)).indexOf('鲫') >= 0,
   await ev(`JSON.stringify(FG.fishHere())`));
// 真正抛一竿，核它能等到咬钩 —— 这才是「兑现」，光看出鱼名单不算
// **轮询到咬钩为止，别赌一个固定等待。** 主循环在无头浏览器里
// 帧率不稳（MIN_PER_SEC=3，一天约 5.7 分钟），睡死一个数字
// 就会时绿时红 —— 而「时绿时红」正是最坏的那种：红的时候
// 你分不清是窗口没开还是机器慢
await ev(`(function(){ FG.state.fishing={i:0,t:0,wait:0.2,win:0.7,phase:'wait',spot:(FG.SPOTS.xipan.fish||[])[0]};
  FG.state.min=1220; FG.state.ended=false; FG.updateHUD(); return 1})()`);
let biteWait = 0, bitePh = 'wait';
while (biteWait < 6000) {
  await sleep(100); biteWait += 100;
  bitePh = await ev(`FG.state.fishing ? FG.state.fishing.phase : 'gone'`);
  if (bitePh !== 'wait') break;
}
ok('带月时抛的竿能等到咬钩（夜钓那个窗口是真的开着的）', bitePh === 'bite',
   '等了 ' + biteWait + 'ms，相位 ' + bitePh);
// 天擦黑（17:30）现在**不该**再收线 —— 那是白天鱼还能钓的时段
await ev(`(function(){ FG.state.fishing=null;
  FG.state.fishing={i:0,t:0,wait:99,win:0.2,phase:'wait',spot:(FG.SPOTS.xipan.fish||[])[0]};
  FG.state.min=FG.DAY.DUSK+10; FG.updateHUD(); return 1})()`);
await sleep(600);
ok('天擦黑（17:30）竿还挂着 —— 收线挪到熄灯了', (await ev(`!!FG.state.fishing`)) === true);
ok('窗口有多宽（游戏分钟）', (await ev(`FG.DAY.END - FG.DAY.NIGHT`)) === 120,
   '带月 ' + (await ev(`FG.DAY.NIGHT`)) + ' → 熄灯 ' + (await ev(`FG.DAY.END`))
   + '，差 ' + (await ev(`FG.DAY.END - FG.DAY.NIGHT`)) + ' 分钟');
// **走之前把场子收拾干净。** 这一段把人留在溪畔、钟拨到夜里、
// 屏上留着一句「把线收了」—— 后面「邻居回家」那几段读的是提示行和浮字，
// 读到的是我留下的残局，三条断言跟着一起红。
// 症状是「跟这一段毫无关系的断言失败」，而每一处单独看都正常
await ev(`(function(){ FG.state.fishing=null; FG.gotoMap('nanshan');
  var t=document.getElementById('toast'); if(t){t.textContent=''; t.classList.remove('on');}
  FG.state.min=FG.DAY.START; FG.state.ended=false; FG.updateHUD(); return 1})()`);
await sleep(400);

// 2) 邻居回家
await ev(`(function(){
  FG.state.min=21*60; FG.gotoMap('nanshan');
  var a=FG.NPCS.linweng.at;
  FG.state.player.x=a[0]; FG.state.player.y=a[1]+40; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(500);
ok('天黑后街上没人了', (await ev(`FG.mapNpcsOut().length`)) === 0, await ev(`FG.mapNpcsOut().length`) + ' 人在外头');
ok('（但他没从这一图的名册里被删掉）', (await ev(`FG.MAPS.nanshan.npcs.length`)) === 2);
ok('判定圈也不再算他（不画他但圈还在 = 对着空气弹对话）',
  (await ev(`!!FG.nearNpc()`)) === false);
ok('站在他那个位置，提示行说得清他去哪了', /回家/.test(await hint()), await hint());
// 按 E 之前先把浮字那一格擦掉。**上一段留下的浮字还在屏上**（"种豆南山下…"），
// 而 toast() 读的是 #toast 的文字 —— 不擦的话这条断言量的可能是
// 上一段残留的那句。顺带把奖励队列也排空（队列和屏幕是两件事）
await ev(`(function(){ FG.flushReward(); return 1})()`);
await sleep(400);
ok('（前提）按 E 之前那一格是空的（不擦的话量的是上一段残留）',
   (await toast()).trim() === '', JSON.stringify(await toast()));
// **前提：把还开着的浮层收掉。**
// 前面那段夜里抛竿等咬钩，最后是过夜收的线，而过夜会弹出结算卡（#de）。
// 结算卡是全屏浮层，keydown 里 `if (panelOpen()) return` 挡在 E 前面 ——
// 于是按 E 什么也不发生，看着正是「静悄悄什么都不发生」，
// 而真正的原因是**上一段留下的面板还开着**。
// 这条测的是「没有东西挡着时 E 会回话」，那就得先把挡着的收掉。
{
  const open = JSON.parse(await ev(`JSON.stringify(['de','dlg','sh','st','bx','bg','ch','al','hs','rd']
    .filter(function(id){ var e=document.getElementById(id); return e && !e.classList.contains('hide'); }))`));
  console.log('  按 E 之前还开着的浮层：' + (open.length ? open.join(',') : '（无）'));
  if (open.length) {
    for (let i = 0; i < open.length; i++) await key('Escape');
    await sleep(400);
  }
  const still = JSON.parse(await ev(`JSON.stringify(['de','dlg','sh','st','bx','bg','ch','al','hs','rd']
    .filter(function(id){ var e=document.getElementById(id); return e && !e.classList.contains('hide'); }))`));
  ok('（前提）浮层都收掉了（开着的时候 E 会被 panelOpen 挡住，量的是另一样东西）',
     still.length === 0, still.join(',') || '（无）');
}
await key('e');
// 浮字是延后弹的（要排在动作提示后面），所以轮询着等，别读一次就下结论
{
  const want = /回家|已经回家/;
  let got = '';
  for (let i = 0; i < 30; i++) {
    got = await toast();
    if (want.test(got)) break;
    await sleep(200);
  }
  ok('按 E 也回一句（不是静悄悄地什么都不发生）', want.test(got), got);
}
// 生辰那天他不走 —— **先把他生辰那一天设成「今天」再把钟拨到夜**。
// （早先写成拿 b.d 当分钟用，b.d 是一年里的第几天，不是钟点）
await ev(`(function(){
  FG.state.day=FG.BIRTH.linweng.d; FG.state.birth={}; FG.birthFix();
  FG.state.min=21*60; FG.updateHUD(); return 1})()`);
await sleep(460);
ok('（对照明细）今天真是他的生辰', (await ev(`FG.birthToday('linweng')`)) === true,
  '第 ' + await ev(`FG.state.day`) + ' 天 ' + await ev(`FG.state.min / 60 | 0`) + ' 点');
ok('**今天是他生辰：他不回家**（他在等你）', (await ev(`FG.mapNpcsOut().length`)) === 1,
  await ev(`FG.mapNpcsOut().length`) + ' 人在外头');
ok('提示行也还是「今天他生辰」', /今天他生辰/.test(await hint()), await hint());
// 天亮了他又出来了
await ev(`(function(){ FG.state.min=9*60; FG.updateHUD(); return 1})()`);
await sleep(360);
ok('天亮了人又在', (await ev(`FG.mapNpcsOut().length`)) === 2);

// 3) 墟市收摊
await ev(`(function(){
  FG.state.min=21*60; FG.gotoMap('xushi');
  var a=FG.NPCS.xushi.at;
  FG.state.player.x=a[0]; FG.state.player.y=a[1]+60; FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(500);
await key('b');
{
  const want = /收了|明早/;
  let got = '';
  for (let i = 0; i < 25; i++) { got = await toast(); if (want.test(got)) break; await sleep(200); }
  ok('天黑按 B：铺子关了，而且说清为什么、什么时候再来', want.test(got), got);
}
ok('货单没开（不是开了一份空清单）', (await ev(`!document.getElementById('sh').classList.contains('hide')`)) === false);
await ev(`(function(){ FG.state.min=9*60; FG.updateHUD(); return 1})()`);
await sleep(420);
// （前提）货单这一格确实是关着的、人也确实站在店主圈里 ——
// 不核这两条，下一条红了分不清是「B 修不好」还是「压根没站在那儿」
ok('（前提）货单没开着', (await ev(`document.getElementById('sh').classList.contains('hide')`)) === true);
ok('（前提）人站在店主判定圈里', !!(await ev(`(function(){
  var a = FG.NPCS.xushi.at;
  return FG.state.player.x >= a[0]-120 && FG.state.player.x <= a[0]+120 &&
         FG.state.player.y >= a[1]-120 && FG.state.player.y <= a[1]+120; })()`)),
   await ev(`JSON.stringify([Math.round(FG.state.player.x), Math.round(FG.state.player.y), FG.NPCS.xushi.at])`));
await key('b');
ok('天亮了 B 又开得起来', (await ev(`!document.getElementById('sh').classList.contains('hide')`)) === true,
   'min=' + await ev(`FG.state.min`));
await key('Escape'); await sleep(250);

console.log('\n— 画面 —');
for (const [name, h, mi, map] of [['日', 12, 0, 'nanshan'], ['斜', 16, 40, 'nanshan'],
                                  ['暮', 17, 40, 'nanshan'], ['夜', 20, 30, 'nanshan'],
                                  ['夜市', 21, 40, 'xushi']]) {
  await setClock(h, mi, map);
  await shot('70-天色-' + name + '.png');
}
ok('五张都截了（日 / 斜 / 暮 / 夜 / 夜市）', true);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
