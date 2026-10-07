// 版式验收：HUD 各块不许互相压、键位提示不许折行、浮层开合与点击归属。
//
// 这类问题脚本全绿也照样存在 —— 体力数字压在 HUD 上、地名那行颜色发灰，
// 没有任何一条功能断言会红。只能靠量矩形。
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9343;
const profile = path.join(tmpdir(), 'guxian-ui-' + process.pid);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const pg = j.find(t => t.type === 'page');
      if (pg) return pg;
    } catch (e) { }
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}
let id = 0, ws; const pend = new Map(); const logs = [];
function send(m, p) {
  return new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p || {} })); });
}
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true });
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
const rect = sel => ev(`(function(){var e=document.querySelector('${sel}');if(!e)return null;
  var r=e.getBoundingClientRect();
  return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),r:Math.round(r.right),w:Math.round(r.width),h:Math.round(r.height)};})()`);
const hits = (a, b) => !(a.b <= b.t || b.b <= a.t || a.r <= b.l || b.r <= a.l);

const t = await target();
ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value || a.description).join(' '));
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
});
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') });
await sleep(2600);
await ev(`localStorage.clear()`); await ev(`location.reload()`); await sleep(2600);
await ev(`FG.startFrom('new')`); await sleep(1200);

console.log('— HUD 各块不许互相压 —');
// 体力数字挂在柱子顶上 1.9em，HUD 加一行就会把它顶进纸片里。
// 这条是加「节气」那一行时真出过的：数字整块压在「南山茅舍」上。
const tl = await rect('#hud .tl'), sn = await rect('#stam span'), st = await rect('#stam');
ok('体力数字没压在 HUD 纸片上', !hits(tl, sn), `HUD 底 ${tl.b} / 数字顶 ${sn.t}，差 ${sn.t - tl.b}px`);
const tr = await rect('#hud .tr');
ok('钱和日子两张纸片不重叠', !hits(tl, tr), `左 ${tl.l}-${tl.r} 右 ${tr.l}-${tr.r}`);
ok('体力柱没压到 HUD', st.t >= tl.b, `柱顶 ${st.t} / 纸片底 ${tl.b}`);
ok('体力柱没伸到器物架里', st.b < 720, `柱底 ${st.b}`);

// 第 2 年 HUD 多出「第 N 年」几个字，是最宽的时候，也要不压
await ev(`FG.state.day = 145; FG.nextDay();`); await sleep(500);
const tl2 = await rect('#hud .tl'), sn2 = await rect('#stam span');
ok('第 2 年的 HUD 变宽了也不压', !hits(tl2, sn2), `纸片底 ${tl2.b} / 数字顶 ${sn2.t}`);
ok('第 2 年显示「第2年」', (await ev(`document.getElementById('hud-solar').textContent`)).indexOf('第2年') >= 0,
   await ev(`document.getElementById('hud-solar').textContent`));
await ev(`FG.state.day = 1; FG.nextDay();`); await sleep(400);

console.log('\n— 键位提示 —');
// 往这行加一个键而忘了减词，就会在 max-width 26% 里折行，第二行贴画面底边
const kb = await ev(`(function(){var e=document.getElementById('keys'),r=e.getBoundingClientRect();
  return {h:Math.round(r.height), lh:Math.round(parseFloat(getComputedStyle(e).lineHeight)),
          b:Math.round(r.bottom), vh:innerHeight, t:e.textContent};})()`);
ok('键位提示只有一行', kb.h <= kb.lh * 1.35, `高 ${kb.h}px，行高 ${kb.lh}px`);
ok('键位提示没顶出画面', kb.b <= kb.vh - 4, `底边 ${kb.b} / 视口 ${kb.vh}`);
ok('键位提示写全了走路和诗册', kb.t.indexOf('WASD') >= 0 && kb.t.indexOf('诗册') >= 0, kb.t);
const kbR = await rect('#keys'), tray = await rect('#tray');
ok('键位提示和器物架不打架', !hits(kbR, tray), `提示右缘 ${kbR.r} / 架子左缘 ${tray.l}`);

console.log('\n— 浮层开合与点击归属 —');
// 浮层开着的时候必须吃掉画布点击；关掉之后必须把点击还给画布。
// 浮层静默吃点击或者静默不挡，都是玩家看不见但立刻会卡住的坑。
const at = (x, y) => ev(`(function(){var e=document.elementFromPoint(${x},${y});
  return e ? (e.id||e.className||e.tagName) : 'null';})()`);
const cx = 300, cy = 400;
ok('平时点得到画布', (await at(cx, cy)) === 'game', await at(cx, cy));
await key('v'); await sleep(300);
ok('V 打开诗册', (await ev(`!document.getElementById('al').classList.contains('hide')`)) === true);
const onPanel = await at(cx, cy);
ok('诗册开着时画布点击被挡住', onPanel !== 'game', onPanel);
ok('挡住点击的是诗册自己', String(onPanel).indexOf('al') >= 0, onPanel);
// 面板开着时游戏键不该生效：按 1 不该换器物
const sel0 = await ev(`FG.state.sel`);
await key('1'); await sleep(150);
ok('诗册开着时 1 键不换器物', (await ev(`FG.state.sel`)) === sel0, sel0 + ' -> ' + await ev(`FG.state.sel`));
await key('e'); await sleep(150);
ok('诗册开着时 E 不触发对话', (await ev(`document.getElementById('dlg').classList.contains('hide')`)) === true);
await key('v'); await sleep(250);
ok('再按 V 关上', (await ev(`document.getElementById('al').classList.contains('hide')`)) === true);
ok('关上后点击还给画布', (await at(cx, cy)) === 'game', await at(cx, cy));
await key('1'); await sleep(150);
ok('关上后 1 键照常换器物', (await ev(`FG.state.sel`)) === 'chu', await ev(`FG.state.sel`));

console.log('\n— 商店面板没被诗册的键位逻辑波及 —');
await ev(`FG.gotoMap('xushi',[430,762])`); await sleep(500);
// 店主 NPC 的 id 就是 xushi（墟市老丈），从 data.js 读坐标，不写死
const lao = JSON.parse(await ev(`JSON.stringify(FG.NPCS.xushi.at)`));
await ev(`FG.state.player.x=${lao[0]}; FG.state.player.y=${lao[1] - 70}; FG.state.walkTo=null;`);
await sleep(250);
await key('b'); await sleep(350);
const shOpen = (await ev(`!document.getElementById('sh').classList.contains('hide')`)) === true;
ok('B 还能打开商店', shOpen);
if (shOpen) {
  ok('商店开着时画布点击被挡住', (await at(cx, cy)) !== 'game', await at(cx, cy));
  await key('v'); await sleep(250);
  ok('商店开着时 V 开不了诗册', (await ev(`document.getElementById('al').classList.contains('hide')`)) === true);
  await key('b'); await sleep(250);
  ok('B 关掉商店', (await ev(`document.getElementById('sh').classList.contains('hide')`)) === true);
  ok('关掉后点击还给画布', (await at(cx, cy)) === 'game', await at(cx, cy));
}
await shot('32-版式.png');

console.log('\n— 存档格：信息不许折行，按钮要对齐 —');
// 这两条是**用内置浏览器真玩的时候看见的**，36 套全绿也没照出来：
// ① 占了存档的格，那行「南山茅舍　·　诗册 0 句　·　见闻 0 味」放不下，
//    断在「见闻」和「0 味」中间 —— 它是一个长 run，断在哪儿是随机的
// ② 三张卡一样高，可内容都顶在上面：「续/重来」压在四行信息下面，
//    「入山」紧跟「空着」浮在上面，三格并排、按钮差了将近一百像素
// 布局的毛病只有量出来才看得见，光看 innerHTML 全是对的
await ev(`FG.showTitle()`);
await sleep(400);
// 造一个「有货」的格：把第 1 格写成有内容的存档，另外两格空着
await ev(`(function(){
  var k = 'guxian_nanshan_save_v1';
  var d = { day: 40, map: '南山茅舍', album: {}, met: {}, got: {},
            dex: { good: { jun: 1, mei: 2 }, fish: { ji: 3 }, ore: { shi: 4 } },
            earned: 12345, player: { x: 900, y: 800 } };
  localStorage.setItem(k, JSON.stringify(d));
  FG.showTitle(); return 1})()`);
await sleep(400);
const slotRows = JSON.parse(await ev(`JSON.stringify((function(){
  var out = [];
  document.querySelectorAll('#slots .slot').forEach(function(card, i){
    var lines = [], wrap = [];
    card.querySelectorAll('.sl-s, .sl-d, .sl-e, .sl-bad').forEach(function(el){
      var cs = getComputedStyle(el);
      var lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      lines.push(Math.round(el.getBoundingClientRect().height / lh));
      // 一行放不下就会高于一个行高 —— 这是「折行」的直接量法
      wrap.push(el.scrollWidth > el.clientWidth + 1
        || Math.round(el.getBoundingClientRect().height / lh) > 1);
    });
    var btn = card.querySelector('.sl-a');
    out.push({ i: i, wrap: wrap, lines: lines,
      btnTop: btn ? Math.round(btn.getBoundingClientRect().top) : -1,
      cardH: Math.round(card.getBoundingClientRect().height) });
  });
  return out;})())`));
console.log('  三格按钮 top = ' + slotRows.map(r => r.btnTop).join(' / ') + '　卡高 = ' + slotRows.map(r => r.cardH).join(' / '));
ok('有货那格的信息行没有折行', slotRows[0].wrap.every(x => !x),
  JSON.stringify(slotRows[0].lines) + ' 行高倍数');
ok('三张卡一样高', new Set(slotRows.map(r => r.cardH)).size === 1, slotRows.map(r => r.cardH).join(' / '));
// 差 2 像素要放过：三张卡的宽度是小数，浏览器按像素取整，
// 顶边自然差一两个。**判据是「看起来齐不齐」，不是「数学上等不等于」** ——
// 写死相等会得到一条时绿时红的断言，那比没有还坏
const tops = slotRows.map(r => r.btnTop);
ok('三格的按钮在同一条水平线上', Math.max(...tops) - Math.min(...tops) <= 3, tops.join(' / '));
// 折行这件事没法只靠「不溢出」判：那个断点随内容变（第 1 天不断、第 100 天断）。
// 所以正面核一次结构：三件事**各占一行**
ok('信息是四行（哪天/在哪/收了多少/进了多少）', slotRows[0].lines.length === 4, slotRows[0].lines.length + ' 行');
await shot('33-存档格.png');

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
console.log(fails ? `FAILED ${fails}` : 'DONE');
