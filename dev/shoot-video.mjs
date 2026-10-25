// 教学视频的素材：把每个镜头在**真实游戏状态**里截出来。
//
// 为什么不在浏览器外面拼：标题要用游戏自己那套字体和颜色（宣纸底 + 朱红 + 墨），
// 而游戏里那些面板/HUD 只有在真的跑起来时才有。所以每个镜头都是
// 「先把游戏拨到那个状态 → 等一帧 → 截一张」，不是摆拍。
//
// 截完交给 dev/make-video.mjs 做暗角、烫金标题和转场。
// 用法：node dev/shoot-video.mjs
import { spawn } from 'child_process';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'video', 'raw');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9455;                                   // 避开所有套件用过的端口
const profile = path.join(tmpdir(), 'guxian-vid-' + process.pid);
const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--allow-file-access-from-files', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });

async function cdpTargets() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const pg = j.find(x => x.type === 'page');
      if (pg) return [pg];
    } catch (e) { }
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}
let id = 0, ws; const pending = new Map(); const noise = [];
function send(method, params) {
  return new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
}
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const { writeFileSync } = await import('fs');
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.data, 'base64'));
  console.log('  截 ' + name);
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
    noise.push(m.params.args.map(a => a.value || a.description).join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    noise.push('EXC ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
await sleep(3000);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(3000);

// 每个镜头都是「拨到状态 → 等一帧」。settle 是给主循环跑的时间
// —— 一次 sleep 300 是不够的：提示行、浮字队列、HUD 都要各自过一遍
const settle = async (ms) => { await sleep(ms || 500); };
const calm = () => ev(`(function(){
  ['de','dlg','sh','st','bx','bg','ch','al','hs','rd'].forEach(function(i){
    var e=document.getElementById(i); if(e) e.classList.add('hide'); });
  var t=document.getElementById('toast'); if(t){ t.textContent=''; t.classList.remove('on'); }
  return 1})()`);

console.log('— 镜头 —');

// 1) 开卷：标题页。三个存档格 + 那两行诗
await shot('01-开卷');

// 2) 入山：开局第一眼。南山的田、器物架、HUD
await ev(`FG.startFrom('new')`);
await sleep(1600);
await calm();
await settle(700);
await shot('02-入山');

// 3) 耕：翻过的地 + 种下的豆 + 交错的畦
await ev(`(function(){
  FG.state.day=1; FG.state.min=8*60; FG.state.ended=false; FG.state.started=true;
  FG.weatherFix();
  var r,c,pl,F=FG.FIELD;
  for (r=0;r<F.ROWS;r++) for (c=0;c<F.COLS;c++){
    pl=FG.state.plots[r][c]; if(!pl) continue;
    if (c>=1 && c<=5){ pl.tilled=true; pl.wet=true; }
  }
  FG.state.seeds.dou=9;
  for (var r2=1;r2<=1;r2++) for (var c2=1;c2<=5;c2++) FG.sowWith('dou',c2,r2);
  FG.state.player.x=760; FG.state.player.y=700; FG.state.walkTo=null;
  FG.updateHUD(); return 1})()`);
await calm();
await settle(700);
await shot('03-耕作');

// 4) 诗册：27 句里的 9 句。**这是整支片子的「收藏」镜头**
await ev(`(function(){
  FG.state.album={firstTill:1,firstSow:1,firstHarvest:1,firstHome:1,firstMarket:2,
    firstTalk:2,talkThree:2,firstXipan:2,firstPick:2,firstFish:2,
    taoyuanMouth:1,st_kou:1,st_tian:1,st_qian:1,st_zhong:1,st_fa:1,st_jiu:1,
    taoyuanSecret:1,firstJu:80,allCrops:80,duskOut:1,linwengWine:120};
  FG.openAlbum(); return 1})()`);
await settle(700);
await shot('04-诗册');

// 5) 行状：五门手艺
await ev(`(function(){
  FG.state.skill={geng:{lv:6,pt:12},yu:{lv:4,pt:0},cai:{lv:4,pt:0},zao:{lv:4,pt:0},niang:{lv:4,pt:0}};
  var t=document.querySelector('#al-tabs .tab[data-tab="skill"]') ||
        document.querySelector('#al-tabs [data-t="skill"]');
  if (t) t.click();
  else { var b=document.querySelectorAll('#al-tabs button'); if (b[1]) b[1].click(); }
  return 1})()`);
await settle(700);
await shot('05-行状');

// 6) 溪畔·带月：夜钓。渔四级之后才有的两种鱼，全游戏唯一要改作息才拿得到的东西
await ev(`(function(){
  var a=FG.SPOTS.xipan.fish[0].at;
  FG.gotoMap('xipan');
  FG.state.min=FG.DAY.NIGHT+30; FG.state.ended=false;
  FG.state.player.x=a[0]; FG.state.player.y=a[1]+130; FG.state.walkTo=null;
  FG.updateHUD(); return 1})()`);
await calm();
await settle(700);
await ev(`(function(){
  var a=FG.SPOTS.xipan.fish[0].at;
  FG.state.fishing={i:0,t:0,wait:9,win:0.7,phase:'wait',spot:(FG.SPOTS.xipan.fish||[])[0]};
  FG.state.player.x=a[0]; FG.state.player.y=a[1]+130; FG.updateHUD(); return 1})()`);
await settle(400);
await shot('06-夜钓');

// 7) 硐里：六层 108 块。凿到四级才走得通第六层
await ev(`(function(){
  FG.state.min=FG.DAY.START;
  FG.gotoMap('shidong'); FG.state.mineFloor=4;
  FG.state.gear.jue=3;
  FG.state.player.x=960; FG.state.player.y=620; FG.state.walkTo=null;
  FG.updateHUD(); return 1})()`);
await calm();
await settle(700);
await shot('07-石硐');

// 8) 收尾：回到诗册，那句「种豆南山下」
await ev(`(function(){
  FG.gotoMap('nanshan');
  var t=document.querySelector('#al-tabs .tab[data-tab="al"]') ||
        document.querySelector('#al-tabs [data-t="al"]');
  if (t) t.click(); else { var b=document.querySelectorAll('#al-tabs button'); if (b[0]) b[0].click(); }
  return 1})()`);
await settle(700);
await shot('08-结语');

console.log('\n控制台噪声：' + (noise.length ? noise.join('\n  ') : '(无)'));
console.log('素材在 video/raw/　共 ' + 8 + ' 张');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(noise.length ? 1 : 0);
