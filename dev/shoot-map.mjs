/* 跨地图验收：南山种田 → 走到村口 → 进墟市 → 买东西 → 回南山。
   每一步都要看得到证据：切图对不对、人在不在该在的地方、钱和种子有没有真的变。 */
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
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = ROOT + 'shots';
const PORT = 9347;
const W = 1600, H = 900;
const PROFILE = join(tmpdir(), 'guxian-map-profile');

mkdirSync(OUT, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  `--window-size=${W},${H}`, '--allow-file-access-from-files',
  '--user-data-dir=' + PROFILE, 'about:blank',
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
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
await send('Runtime.enable'); await send('Page.enable');
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
  await sleep(120);
}
async function at(x, y) {           // 把人挪到画布坐标（脚本验收用，不算作弊：切图逻辑另测）
  await ev(`FG.state.player.x=${x}; FG.state.player.y=${y}; FG.state.walkTo=null;`);
  await sleep(120);
}
// 站到某个 NPC 面前。坐标一律从 data.js 读，不手抄 ——
// 手抄过一次，站位一改人就走不到位，对话弹不出来，测试反而红；更坏的情况是
// 站到了别的 NPC 旁边，测的其实不是这个人。
async function nearNpc(id) {
  const a = await ev(`FG.NPCS['${id}'].at`);
  await at(a[0], a[1] - 60);
  await sleep(200);
}
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) process.exitCode = 1;
}

const file = pathToFileURL(ROOT + 'index.html').href;
await send('Page.navigate', { url: file });
await sleep(2500);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2500);
await ev(`FG.startFrom('new')`);
await sleep(1000);

console.log('— 南山开局 —');
ok('起始地图是南山', (await ev(`FG.state.map`)) === 'nanshan');
ok('田畦拾取可用', (await ev(`FG.FIELD.on`)) === true);
ok('梯形四角已套用', JSON.stringify(await ev(`FG.FIELD.QUAD`)) === '[678,500,1336,500,232,872,1420,872]');
ok('HUD 显示地名', (await ev(`document.getElementById('hud-map').textContent`)) === '南山茅舍');
ok('本图只有两个 NPC', (await ev(`FG.MAPS.nanshan.npcs.length`)) === 2);

// 人物贴图：渲染走 Image，缺一张不会报错，只会悄悄退回代码画的老农
// （或者干脆没人）。所以这里必须显式数一遍加载了几张。
// 数量跟注册表比，不写死 —— 写死过一次，加了渔父就红，而红的原因跟贴图无关。
const wantFigs = await ev(`Object.keys(FG.INK.FIG_SRC).length`);
const figKeys = await ev(`Object.keys(FG.INK.figs)`);
ok('人物贴图全部加载成功', figKeys.length === wantFigs, `${figKeys.length}/${wantFigs}  ` + figKeys.join(','));
ok('贴图有实际像素', (await ev(`(FG.INK.figs.farmer ? FG.INK.figs.farmer.width : 0)`)) > 0);
ok('每个 NPC 都有对应贴图', (await ev(`
  (function(){ var bad=[]; for (var k in FG.NPCS) { if (!FG.INK.figs[k]) bad.push(k); } return bad.join(','); })()
`)) === '', await ev(`
  (function(){ var bad=[]; for (var k in FG.NPCS) { if (!FG.INK.figs[k]) bad.push(k); } return bad.join(','); })()
`));

console.log('— 溪畔往返 —');
// 出口坐标一律从 data 读。之前两版脚本都写死过坐标，站位一改人就走不到位，
// 而断言只看"切过去了没有"，于是测试照绿、其实根本没测到那个出口。
const nsExit = JSON.parse(await ev(`JSON.stringify(FG.MAPS.nanshan.exits.find(e=>e.to==='xipan'))`));
await at(nsExit.at[0], nsExit.at[1]);
await sleep(250);
ok('南山东头有溪畔出口提示', (await ev(`document.getElementById('hint').textContent`)).indexOf('溪畔') >= 0,
   await ev(`document.getElementById('hint').textContent`));
await key('e');
await sleep(1000);
ok('已切到溪畔', (await ev(`FG.state.map`)) === 'xipan', await ev(`FG.state.map`));
ok('溪畔关掉田畦', (await ev(`FG.FIELD.on`)) === false);
const xpExit = JSON.parse(await ev(`JSON.stringify(FG.MAPS.xipan.exits[0])`));
await at(xpExit.at[0], xpExit.at[1]);
await sleep(250);
ok('溪畔东头有回南山的提示', (await ev(`document.getElementById('hint').textContent`)).indexOf('回南山') >= 0,
   await ev(`document.getElementById('hint').textContent`));
await key('e');
await sleep(1000);
ok('已切回南山', (await ev(`FG.state.map`)) === 'nanshan', await ev(`FG.state.map`));
ok('田畦拾取回来了', (await ev(`FG.FIELD.on`)) === true);
// 四张图（南山 / 墟市 / 溪畔 / 后山）必须都走得出去，否则有一张是孤岛。
// 出口数不能写死：后山的洞口加进来之后这里就报过假失败。
// 真正要守的是「每条出口指向的地图都存在」和「每张图都至少有一条」。
ok('每张图都有出口', (await ev(`
  (function(){ var bad=[]; for (var k in FG.MAPS) { if (!FG.MAPS[k].exits.length) bad.push(k); } return bad.join(','); })()
`)) === '');
ok('出口两两对得上（去=A 则 A 有一条回=FG.MAPS 的出口）', (await ev(`
  (function(){
    var bad=[];
    for (var k in FG.MAPS) {
      var l=FG.MAPS[k].exits;
      for (var i=0;i<l.length;i++) {
        if (!FG.MAPS[l[i].to]) { bad.push(k+'->'+l[i].to+'(不存在)'); continue; }
        var back = FG.MAPS[l[i].to].exits.filter(function(e){ return e.to===k; });
        if (!back.length) bad.push(k+'->'+l[i].to+'(回不去)');
      }
    }
    return bad.join(',');
  })()
`)) === '');
ok('落点都在「那张图」的可行走带里', (await ev(`
  (function(){
    var bad=[];
    var chk = function(m, where, at) {
      if (!at) return;
      var b = m.bounds;
      if (at[0]<b.x0||at[0]>b.x1||at[1]<b.y0||at[1]>b.y1) bad.push(m.id+':'+where+' '+at.join(','));
    };
    for (var k in FG.MAPS) {
      var m = FG.MAPS[k];
      chk(m, 'spawn', m.spawn);
      for (var i=0;i<m.exits.length;i++) {
        // 出口的 spawn 是「到了目标图以后站在哪」，所以要拿目标图的 bounds 卡。
        // 拿本图的卡就成了一条自己都会失败的断言 —— 后山出口落点是南山的
        // 坐标 (604,486)，而南山后这张图 y 只能到 540
        if (FG.MAPS[m.exits[i].to]) chk(FG.MAPS[m.exits[i].to], 'exit->'+m.exits[i].to, m.exits[i].spawn);
      }
    }
    return bad.join(',');
  })()
`)) === '');

console.log('— 走到村口 —');
await at(132, 902);
await sleep(200);
console.log('  提示 =', JSON.stringify(await ev(`document.getElementById('hint').textContent`)));
ok('村口有出口提示', (await ev(`document.getElementById('hint').textContent`)).indexOf('墟市') >= 0);
await key('e');
await sleep(900);
ok('已切到墟市', (await ev(`FG.state.map`)) === 'xushi', await ev(`FG.state.map`));
ok('墟市关掉田畦拾取', (await ev(`FG.FIELD.on`)) === false);
ok('墟市里点田不会误判', (await ev(`JSON.stringify(FG.FIELD.pick(900,700))`)) === 'null');
ok('器物架已隐藏', (await ev(`document.getElementById('tray').style.display`)) === 'none');
ok('HUD 换成墟市', (await ev(`document.getElementById('hud-map').textContent`)) === '村口墟市');
ok('墟市四个人', (await ev(`FG.MAPS.xushi.npcs.length`)) === 4);
ok('墟市的钱没变', (await ev(`FG.state.gold`)) === 500);
await shot('06-墟市.png');

console.log('— 找老丈买种子 —');
const gold0 = await ev(`FG.state.gold`), seed0 = await ev(`FG.state.seeds.dou`);
await nearNpc('xushi');
await key('b');
await sleep(500);
ok('商店面板弹出来了', (await ev(`!document.getElementById('sh').classList.contains('hide')`)));
// 货有几件从 data.js 读。加了器物之后这里报过假失败 ——
// 写死 7 件，加了四格器物就变 9 件
ok('货架上的货都摆出来了', (await ev(`document.querySelectorAll('#sh-list .goods').length`)) === (await ev(`FG.SHOP.xushi.length`)),
  (await ev(`document.querySelectorAll('#sh-list .goods').length`)) + ' / 货单 ' + (await ev(`FG.SHOP.xushi.length`)) + ' 件');
await shot('07-杂货铺.png');
await ev(`document.querySelector('#sh-list .goods[data-k="seedD"]').click()`);
await sleep(400);
ok('买完钱少了', (await ev(`FG.state.gold`)) === gold0 - 18, `${gold0} -> ${await ev('FG.state.gold')}`);   // 豆种 18：卖 34，留出进价和卖价之间那一截
ok('豆种多了一份', (await ev(`FG.state.seeds.dou`)) === seed0 + 1, `${seed0} -> ${await ev('FG.state.seeds.dou')}`);
await ev(`document.getElementById('sh-x').click()`);
await sleep(300);

console.log('— 钱不够的时候要拦住 —');
await ev(`FG.state.gold = 5`);
await key('b'); await sleep(300);
// 从货单里挑**买得起的那一格里最贵的一格**，不写死 key。
// 两个坑：写死 key 的话哪天那一格改了价钱就静默点空了；
// 只挑「最贵」的话会挑到锁着的那一级（铁锄要先有铜锄），
// 那时候弹的是「得先有前一把」而不是「钱不够」，钱不够这一条就永远测不到
const pricey = await ev(`(function(){
  var L=FG.SHOP.xushi, best=null, bestP=0, i, t, cur;
  for (i=0;i<L.length;i++) {
    if (L[i].kind === 'gear') {
      t = (FG.GEAR[L[i].gear]||[])[L[i].lv-1]||{};
      cur = FG.state.gear[L[i].gear] || 0;
      if (cur >= L[i].lv || cur !== L[i].lv - 1) continue;   // 已经有了 / 还够不着
    } else t = L[i];
    if (t.price && t.price > bestP) { bestP = t.price; best = L[i].k; }
  }
  return best;
})()`);
ok('货单里找得到买得起的那一格', !!pricey, '最贵 = ' + pricey);
// 选择器在 Node 侧拼好再整段传进去。在模板串里插 key 很容易把引号套错，
// 而套错的表现是页面里 null.click() 抛异常、gold 当然不变、
// 「钱不够买不下」那条照样 PASS —— 那是假绿
const priceySel = '#sh-list .goods[data-k="' + pricey + '"]';
ok('那一格在面板上点得着', (await ev(`!!document.querySelector(${JSON.stringify(priceySel)})`)) === true);
ok('那一格现在确实写着价钱', (await ev(`document.querySelector(${JSON.stringify(priceySel)}).textContent`)).indexOf('钱') >= 0,
  await ev(`document.querySelector(${JSON.stringify(priceySel)}).textContent`));
await ev(`document.querySelector(${JSON.stringify(priceySel)}).click()`);
await sleep(300);
ok('钱不够买不下', (await ev(`FG.state.gold`)) === 5, '钱 = ' + (await ev(`FG.state.gold`)));
ok('并且给了提示', (await ev(`document.getElementById('toast').textContent`)).indexOf('钱不够') >= 0,
  await ev(`document.getElementById('toast').textContent`));
ok('器物等级没被改', (await ev(`FG.state.gear.chu`)) === 0, 'chu=' + (await ev(`FG.state.gear.chu`)));
await ev(`document.getElementById('sh-x').click()`);
await sleep(200);

console.log('— 跟墟市的人说话 —');
await ev(`FG.state.talkIdx = 0`);
await nearNpc('caiyaoren');
await key('e'); await sleep(400);
ok('采药人对话弹出', (await ev(`!document.getElementById('dlg').classList.contains('hide')`)));
// 抬头是「名字　·　档位」（10/3 加的人情那一层），核的是开头是他
ok('弹的确实是采药人', (await ev(`document.getElementById('dlg-name').textContent`)).indexOf('采药人') === 0,
   await ev(`document.getElementById('dlg-name').textContent`));
console.log('  台词 =', await ev(`document.getElementById('dlg-text').textContent`));
console.log('  出处 =', await ev(`document.getElementById('dlg-from').textContent`));
await shot('08-墟市对话.png');
await ev(`document.getElementById('dlg-x').click()`);
await sleep(200);

console.log('— 回南山 —');
await at(168, 792);
await sleep(200);
await key('e');
await sleep(900);
ok('已切回南山', (await ev(`FG.state.map`)) === 'nanshan', await ev(`FG.state.map`));
ok('田畦拾取回来了', (await ev(`FG.FIELD.on`)) === true);
ok('器物架回来了', (await ev(`document.getElementById('tray').style.display`)) !== 'none');
ok('买来的豆种还在', (await ev(`FG.state.seeds.dou`)) === seed0 + 1);

console.log('— 存档往返 —');
await ev(`FG.saveGame()`);
const before = JSON.stringify(await ev(`({map:FG.state.map,gold:FG.state.gold,dou:FG.state.seeds.dou,day:FG.state.day})`));
await ev(`location.reload()`);
await sleep(2500);
await ev(`FG.startFrom('cont')`);
await sleep(1200);
const after = JSON.stringify(await ev(`({map:FG.state.map,gold:FG.state.gold,dou:FG.state.seeds.dou,day:FG.state.day})`));
ok('读档后状态一致', before === after, `${before} vs ${after}`);
ok('读档后画面对应地图', (await ev(`document.getElementById('hud-map').textContent`)) === '南山茅舍');
ok('读档后台阶可用', (await ev(`FG.FIELD.on`)) === true);

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
ws.close(); chrome.kill();
console.log('DONE');
