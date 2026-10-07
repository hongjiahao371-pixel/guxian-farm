// 鸡舍/水渠的美术预览：拿南山底图上那一块**真像素**当背景，
// 按**屏幕上实际显示的尺寸**（画布 1920 宽缩到约 1426 宽，≈0.743×）画出来。
//
// 为什么要有这个：放大画预览页只验得出「细节好不好看」，验不出「看不看得见」，
// 而可见性才是玩家收不收得到的那一半。上一版就是这么错的 ——
// 放大看鸡舍有顶有墙有门，画在游戏里是一滩看不见的淡彩。
//
// 调完仍以 dev/shoot-build.mjs 截的**真游戏画面**为准，这个只用来定位问题。
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9383;
const profile = path.join(tmpdir(), 'guxian-art-' + process.pid);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  // 不给这个的话 file:// 的底图会把画布标成 tainted，toDataURL 直接抛
  // SecurityError。截图（captureScreenshot）不受影响，所以平时看不出来
  '--allow-file-access-from-files',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); const j = await r.json();
      const p = j.find(t => t.type === 'page'); if (p) return p; } catch (e) { }
    await sleep(300);
  } throw new Error('no chrome');
}
let id = 0, ws; const pending = new Map();
const send = (m, p) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p || {} })); });
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

const t = await target();
ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') });
await sleep(2600);

// 分两步：先把底图读进 window.__bg，等它 onload 完了再同步画。
// 一步写成 awaitPromise 的 promise 在这版 CDP 上会挂住（不报错，就是不回来）
const loaded = await ev(`(function(){
  return new Promise(function(res){
    var im = new Image();
    im.onload = function(){ window.__bg = im; res('ok ' + im.width + 'x' + im.height); };
    im.onerror = function(){ res('ERR'); };
    im.src = 'assets/nanshan.jpg';
  });})()`);
console.log('底图：', loaded);
if (loaded !== 'ERR' && typeof loaded === 'string' && loaded.indexOf('ok') === 0) {
  const png = await ev(`(function(){
    var S = 0.743, CUT = 900;
    var c = document.createElement('canvas');
    c.width = Math.round(CUT*S); c.height = Math.round(CUT*S);
    var x = c.getContext('2d');
    var bg = window.__bg;
    var bx = FG.BUILD.coop.at[0], by = FG.BUILD.coop.at[1];
    x.drawImage(bg, bx-CUT/2, by-CUT*0.62, CUT, CUT, 0, 0, c.width, c.height);
    var px = function(mx){ return (mx - (bx-CUT/2)) * S; };
    var py = function(my){ return (my - (by-CUT*0.62)) * S; };
    // 左边放一个农人当比例尺，右边三档依次排开，一眼看得出升级前后
    x.save(); x.beginPath(); x.rect(0, 0, c.width*0.22, c.height); x.clip();
    FG.INK.drawFig(x, 'farmer', px(bx-290), py(by+8), 150*S);
    x.restore();
    FG.INK.coop(x, px(bx-140), py(by+8), FG.BUILD.coop.lv[0].unit*S, 0);
    FG.INK.coop(x, px(bx+60),  py(by+8), FG.BUILD.coop.lv[0].unit*S, 1);
    FG.INK.coop(x, px(bx+280), py(by+8), FG.BUILD.coop.lv[1].unit*S, 2);
    return c.toDataURL('image/png');
  })()`);
  writeFileSync(path.join(OUT, '_art-coop.png'), Buffer.from(png.split(',')[1], 'base64'));
  console.log('wrote shots/_art-coop.png');
}
ws.close(); chrome.kill();
try { (await import('fs')).rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(0);
