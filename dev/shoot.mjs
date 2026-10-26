/* 用 CDP 真跑一遍，并把一天的农事流程走完。
   验收不能只看「画面画出来了」——要真的点下去，
   确认锄得动、种得进、浇得上、过一夜能长、有没有报错。 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 脚本在 dev/ 下，游戏根目录是它的上一级 —— 拿 dev/ 当根会导航到不存在的
// dev/index.html，页面 404，FG 自然 undefined，而且控制台还不报错。
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = ROOT + 'shots';
const PORT = 9333;
const W = 1600, H = 900;

// Chrome 的 profile 放系统临时目录：留在游戏目录里会攒出 3MB+ 缓存，
// 目录清单全是噪音，打包时还容易被顺手带进去。
const PROFILE = join(tmpdir(), 'guxian-shoot-profile');

mkdirSync(OUT, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  `--window-size=${W},${H}`, '--allow-file-access-from-files',
  '--user-data-dir=' + PROFILE,
  'about:blank',
], { stdio: 'ignore' });

let ws, id = 0;
const pend = new Map();
const logs = [];

function send(method, params = {}) {
  const msg = { id: ++id, method, params };
  ws.send(JSON.stringify(msg));
  return new Promise(r => pend.set(msg.id, r));
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const pg = list.find(t => t.type === 'page');
      if (pg) return pg.webSocketDebuggerUrl;
    } catch { }
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}

const url = await connect();
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push('EXCEPTION: ' + (d.exception?.description || d.text));
  }
});

await send('Runtime.enable');
await send('Page.enable');

async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
}
/* 画布坐标 -> 屏幕坐标，再发真鼠标事件（不是 el.click()，那条路绕过了命中测试） */
let clickDbg = false;
async function clickCell(col, row) {
  const pt = await ev(`(()=>{const r=document.getElementById('game').getBoundingClientRect();
    const c=FG.FIELD.cellCenter(${col},${row});
    return JSON.stringify({x:r.left+c[0]/1920*r.width, y:r.top+c[1]/1080*r.height,
      rect:[r.left,r.top,r.width,r.height].map(v=>Math.round(v)),
      cell:[c[0],c[1]].map(v=>Math.round(v)),
      started:FG.state.started, ended:FG.state.ended, sel:FG.state.sel,
      vh:innerHeight, vw:innerWidth});})()`);
  const p = JSON.parse(pt);
  if (!clickDbg) { clickDbg = true; console.log('首次点击诊断', JSON.stringify(p)); }
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  }
  await sleep(90);
}
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(90);
}

const file = pathToFileURL(ROOT + 'index.html').href;
await send('Page.navigate', { url: file });
await sleep(2500);
// 每轮先清存档：上一轮留下的 save 会让「续前日」有值，测的就不是新开局的路径了
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2500);
console.log('开局前 title 的 class =', JSON.stringify(await ev(`document.getElementById('title').className`)));
console.log('title 在 #ui 里吗 =', await ev(`!!document.getElementById('title').closest('#ui')`));
await shot('00-开卷.png');
await ev(`FG.startFrom('new')`);
await sleep(900);
console.log('开局之后 title 的 class =', JSON.stringify(await ev(`document.getElementById('title').className`)),
            ' 可见 =', await ev(`getComputedStyle(document.getElementById('title')).display`));
await shot('01-开局.png');

// —— 锄 9 畦，留出五种谷物各一处 ——
await key('1');
for (const [c, r] of [[0, 2], [1, 2], [2, 2], [2, 3], [3, 3], [1, 4], [3, 4], [0, 3], [4, 3]]) await clickCell(c, r);
const tilled = await ev(`FG.state.plots.flat().filter(p=>p.tilled).length`);
console.log('锄开的畦数 =', tilled);

// —— 五种谷物各点一畦 ——
// 有了节气门之后，五样再没有同一天能下的地：豆立春、粟谷雨、黍芒种、稷小满、菊立秋。
// 原来这段在立春把五样挨个点下去，只有豆种得进去，脚本却照样打「种下的 =」，
// 看着像数据坏了，其实是自己没跟上新规则。改成：种得下的种，拦得住的验。
await key('3'); for (const [c, r] of [[0, 2], [1, 2], [2, 2]]) await clickCell(c, r);   // 豆（立春）
const planted = await ev(`JSON.stringify(FG.state.plots.flat().filter(p=>p.crop).map(p=>p.crop))`);
console.log('立春种下的 =', planted);
if (planted !== '["dou","dou","dou"]') {
  console.log('  FAIL 立春只该种得下豆，实际 =', planted);
  process.exitCode = 1;
}
for (const [kk, cn, cell] of [['4', '粟', [2, 3]], ['5', '黍', [1, 4]], ['6', '稷', [0, 3]], ['7', '菊', [4, 3]]]) {
  await key(kk); await clickCell(cell[0], cell[1]); await sleep(220);
  const msg = await ev(`document.getElementById('toast').textContent`);
  const said = msg.indexOf('时节') >= 0;
  console.log('  ' + (said ? '拦住 ' : 'FAIL ') + cn + ' → ' + msg);
  if (!said) process.exitCode = 1;
}

// —— 全部浇一遍 ——
await key('2');
for (const [c, r] of [[0, 2], [1, 2], [2, 2], [2, 3], [3, 3], [1, 4], [3, 4], [0, 3], [4, 3]]) await clickCell(c, r);
const wet = await ev(`FG.state.plots.flat().filter(p=>p.wet).length`);
console.log('浇过的畦数 =', wet, ' 体力 =', await ev('FG.state.stam'));
await shot('02-耕作.png');

// —— 跟邻翁说句话（先验对话，再去归家）——
// 坐标必须从 data.js 读。原来写死 (232,800)，邻翁挪走后那里站着采菊翁，
// 而断言只看"对话框弹了"，于是测试照绿、截图还叫"与邻翁对话"，实际测错了人。
{
  const a = await ev(`FG.NPCS.linweng.at`);
  await ev(`FG.state.player.x=${a[0]}; FG.state.player.y=${a[1] - 60};`);
  await sleep(150);
  await key('e');
  await sleep(400);
  const who = await ev(`document.getElementById('dlg-name').textContent`);
  console.log('对话弹出 =', await ev(`!document.getElementById('dlg').classList.contains('hide')`),
              ' 对象 =', who,
              ' 台词 =', await ev(`document.getElementById('dlg-text').textContent.slice(0,18)`));
  // 抬头是「名字　·　档位」（10/3 加的人情那一层），
  // 所以核的是**开头是他**，不是整个字符串等于名字
  if (who.indexOf('邻翁') !== 0) { console.log('  FAIL 走到邻翁面前，弹出来的却是「' + who + '」'); process.exitCode = 1; }
}
await shot('03-与邻翁对话.png');
await ev(`document.getElementById('dlg-x').click()`);
await sleep(200);

// —— 走到茅屋归家，过夜 ——
await ev(`FG.state.player.x=452; FG.state.player.y=678;`);
await sleep(200);
await key('e');
await sleep(600);
const ended = await ev(`!document.getElementById('de').classList.contains('hide')`);
console.log('结算面板弹出 =', ended);
await shot('04-归家结算.png');

// —— 连过三夜，看长势 ——
for (let d = 0; d < 4; d++) {
  await ev(`document.getElementById('de-next').click()`);
  await sleep(250);
  await key('2');
  for (const [c, r] of [[0, 2], [1, 2], [2, 2], [2, 3], [3, 3], [1, 4], [3, 4], [0, 3], [4, 3]]) await clickCell(c, r);
  await ev(`FG.state.player.x=452; FG.state.player.y=678;`);
  await key('e');
  await sleep(400);
  await ev(`document.getElementById('de-next').click()`);
  await sleep(250);
}
// 这里原来只看「还有几畦带作物」，读出来是空数组，看着像一夜白种。
// 真相是：拿着水壶点成熟的畦会被顺手收走（game.js 里 sel!=='chu' 即收），
// 豆在第 5 天熟了就被这四轮浇水自动收了。
// 而篮子也不能作数 —— endDay 每晚都把收成折成钱清空（S.bag[k]=0），
// 到第 9 天篮里本来就是空的。要看的是本年账 book.crops，那才是收成的流水。
const growth = await ev(`JSON.stringify(FG.state.plots.flat().filter(p=>p.crop).map(p=>p.crop+':'+p.stage))`);
const harvested = await ev(`(FG.state.book && FG.state.book.crops.dou) || 0`);
console.log('四夜后地里 =', growth, ' 本年收豆 =', harvested, ' 日子 =', await ev('FG.state.day'));
if (growth === '[]' && harvested === 0) {
  console.log('  FAIL 既没长也没收，豆去哪了');
  process.exitCode = 1;
}
await shot('05-三夜后.png');

// —— 收 ——
await ev(`FG.state.player.x=452; FG.state.player.y=678;`); await key('e'); await sleep(300);
await ev(`document.getElementById('de-next').click()`); await sleep(200);

console.log('LOGS', logs.length ? logs.join('\n  ') : '(无报错)');
ws.close();
chrome.kill();
