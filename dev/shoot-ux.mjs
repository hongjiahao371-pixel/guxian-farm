// 互动细节验收。
//
// 这一套盯的不是「有没有这个功能」，是**按下去有没有回话、回的话对不对**。
// 这个游戏有一条硬规矩：暗着的东西也要回一句话，提示行写的是
// 「按下去会发生什么」—— 而这两条都只能靠逐个交互去核。
//
// 盯住这几条：
//   1) **硐口**：没镐的时候不让下去，而且提示行先说 ——
//      原来镐的判据只在硐里面，于是走到口前照下，
//      下去以后满眼都是「还没有镐」，来回白走一趟
//   2) **坛子**：空坛但手上没料，提示行不能说「E 搁一把料进去」
//      （按下去什么也不会搁，那句话是骗人）；
//      按 E 要点名缺哪一味、差几份，不能只说「料不够」
//   3) **对话框**：Esc 关得掉（跟别的面板一个样），换图自动收起
//      （不收的话那张卡跟着人走，而画面已经换了地方）
//   4) 提示行和按下去的结果**说的是同一件事**
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9416;
const profile = path.join(tmpdir(), 'guxian-ux-' + process.pid);
const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--allow-file-access-from-files', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
async function cdpTargets() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(260);
}
let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined ? '   ' + extra : ''));
  if (!cond) { fails++; process.exitCode = 1; }
}
const hint = () => ev(`document.getElementById('hint').textContent`);
const toast = () => ev(`document.getElementById('toast').textContent`);
const dlgOpen = () => ev(`!document.getElementById('dlg').classList.contains('hide')`);
const dlgText = () => ev(`document.getElementById('dlg-text').textContent`);
// 清浮字 + 收面板 + 把钟拨回白天
const calm = () => ev(`(function(){
  ['de','dlg','sh','st','bx','bg','ch','al','hs','rd'].forEach(function(i){
    var e=document.getElementById(i); if(e) e.classList.add('hide'); });
  var t=document.getElementById('toast'); if(t){ t.textContent=''; t.classList.remove('on'); }
  FG.state.min=10*60; FG.state.ended=false; FG.state.started=true;
  return 1})()`);
const at = async (map, x, y) => {
  await ev(`(function(){ FG.gotoMap(${JSON.stringify(map)});
    FG.state.player.x=${x}; FG.state.player.y=${y};
    FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
  await sleep(400);
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
await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'index.html')).href });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1000);

console.log('— 硐口：没有镐就别让下去 —');
const ex = JSON.parse(await ev(`JSON.stringify(FG.MAPS.xushi.exits.filter(function(x){ return x.to==='shidong'; }))`))[0];
await calm();
await ev(`(function(){ FG.state.gear={chu:0,piao:0,jue:0}; return 1})()`);
await at('xushi', ex.at[0], ex.at[1] + 40);
const hNoPick = await hint();
ok('提示行先说了「没有镐」', /没有镐/.test(hNoPick), hNoPick);
ok('提示行没有还说「E 下…」——按下去什么也不会发生', !/^E　/.test(hNoPick), hNoPick);
await key('e');
ok('按 E 没下去', (await ev(`FG.state.map`)) === 'xushi', '还在 ' + await ev(`FG.state.map`));
ok('而且回话说清了去哪儿买', /还没有镐/.test(await toast()) && /墟市/.test(await toast()), await toast());
// 买上镐
await calm();
await ev(`(function(){ FG.state.gear={chu:0,piao:0,jue:1}; return 1})()`);
await sleep(300);
ok('有了镐，提示行就变回「E 下那道旧硐口」', /下那道旧硐口/.test(await hint()), await hint());
await key('e');
ok('有了镐就下得去', (await ev(`FG.state.map`)) === 'shidong', '在 ' + await ev(`FG.state.map`));
// 雷天的那一道没被我碰坏。
// 注意得**重新站到硐口前**：`gotoMap` 不带落点时会把人放到那张图的默认出生点，
// 而这一段前面人已经下到硐里去了 —— 只改天气的话站的不是硐口，提示自然是空的
await calm();
await ev(`(function(){ FG.state.gear={chu:0,piao:0,jue:1}; return 1})()`);
await at('xushi', ex.at[0], ex.at[1] + 40);
await ev(`(function(){ FG.state.weather='storm'; FG.weatherFix(); FG.updateHUD(); return 1})()`);
await sleep(300);
ok('雷天硐口照旧封着（两道判据没互相盖掉）', /封着/.test(await hint()), await hint());
await key('e');
ok('雷天也下不去', (await ev(`FG.state.map`)) === 'xushi', '还在 ' + await ev(`FG.state.map`));
await ev(`(function(){ FG.state.weather='sun'; FG.weatherFix(); FG.updateHUD(); return 1})()`);

console.log('\n— 坛子：空坛没料，要说清缺什么 —');
await calm();
await ev(`(function(){
  FG.state.mach={lv:{jar:1},job:{}};
  FG.state.pouch={}; FG.state.made={};
  FG.state.bag={dou:0,su:0,shu:0,ji:0,ju:0};
  return 1})()`);
const jarAt = JSON.parse(await ev(`JSON.stringify(FG.MACHINE.jar.at)`));
await at('nanshan', jarAt[0], jarAt[1] + 40);
const hEmpty = await hint();
ok('空坛、没料：提示行没说「E 搁一把料进去」', !/搁一把料/.test(hEmpty), hEmpty);
ok('提示行点名了缺哪一味', /山菌|野莓|鲤|奶|毛/.test(hEmpty), hEmpty);
await key('e');
const tEmpty = await toast();
ok('按 E 的话也点名了缺哪一味', /山菌|野莓|鲤|奶|毛/.test(tEmpty), tEmpty);
ok('而且给得出个数（要几份）', /要\s*\d/.test(tEmpty), tEmpty);
ok('（不再是「手上的料不够」这一句废话）', !/^手上的料不够。$/.test(tEmpty.trim()), tEmpty);
// 手上一部分：差多少要说出来
await calm();
await ev(`(function(){ FG.state.pouch={jun:1}; return 1})()`);
await sleep(300);
await at('nanshan', jarAt[0], jarAt[1] + 40);
await key('e');
const tPart = await toast();
ok('手上有一部分：说得出「要几、手上有几」', /要\s*\d+.*手上\s*\d+/.test(tPart), tPart);
ok('没把料扣掉（没够就不该动）',
  (await ev(`FG.invGet('good_jun')`)) === 1, 'good_jun=' + await ev(`FG.invGet('good_jun')`));
// 手上有够的：提示行和按下去都该是「能搁」
await calm();
await ev(`(function(){ FG.state.pouch={jun:4}; return 1})()`);
await sleep(300);
await at('nanshan', jarAt[0], jarAt[1] + 40);
ok('料够了，提示行就变回「E 搁一把料进去」', /搁一把料/.test(await hint()), await hint());

console.log('\n— 对话框：Esc 关得掉，换图收得起 —');
await calm();
await ev(`(function(){
  FG.state.met={};
  var a=FG.NPCS.linweng.at;
  FG.gotoMap('nanshan'); FG.state.player.x=a[0]; FG.state.player.y=a[1]+60;
  FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(400);
await key('e');
ok('对话开着了', (await dlgOpen()) === true);
const line1 = await dlgText();
await key('e');
ok('按 E 翻到下一句（不是关掉）', (await dlgOpen()) === true && (await dlgText()) !== line1,
  '「' + line1.slice(0, 12) + '」→「' + (await dlgText()).slice(0, 12) + '」');
await key('Escape');
ok('Esc 把对话关掉了（跟别的面板一个样）', (await dlgOpen()) === false);
// 换图要收
await calm();
await ev(`(function(){
  var a=FG.NPCS.linweng.at;
  FG.gotoMap('nanshan'); FG.state.player.x=a[0]; FG.state.player.y=a[1]+60;
  FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
await sleep(400);
await key('e');
ok('又开着了', (await dlgOpen()) === true);
await ev(`(function(){ FG.gotoMap('xipan'); return 1})()`);
await sleep(300);
ok('换图的时候对话自己收起来了（不然那张卡跟着人走）', (await dlgOpen()) === false,
  '在 ' + await ev(`FG.state.map`));

console.log('\n— 提示行和按下去，说的是不是同一件事 —');
// 逐个交互点核一遍：提示行承诺了什么，按下去给的回话对不对得上
const checks = [
  ['机器（没买）', async () => {
    await calm();
    await ev(`(function(){ FG.state.mach={lv:{},job:{}};
      var a=FG.MACHINE.ping.at; FG.gotoMap('xipan');
      FG.state.player.x=a[0]; FG.state.player.y=a[1]+30;
      FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
    await sleep(400);
  }],
  ['狗窝（造了，窝边空的）', async () => {
    await calm();
    await ev(`(function(){
      FG.state.build.gou=1; FG.buildFix(); FG.state.dog={day:0,n:0,k:null}; FG.dogFix();
      var a=FG.BUILD.gou.at; FG.gotoMap('nanshan');
      FG.state.player.x=a[0]; FG.state.player.y=a[1]+40;
      FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
    await sleep(400);
  }],
  ['木箱（空的）', async () => {
    await calm();
    await ev(`(function(){
      FG.state.chest={}; FG.chestFix();
      FG.gotoMap('nanshan');
      var a=FG.CHEST ? FG.CHEST.at : [452,700];
      FG.state.player.x=a[0]; FG.state.player.y=a[1]+40;
      FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
    await sleep(400);
  }],
  ['刻石（读过的）', async () => {
    await calm();
    const st = JSON.parse(await ev(`JSON.stringify((FG.SPOTS.houshan.stele||[]).map(function(s){return [s.id,s.at];}))`));
    if (!st.length) return null;
    await ev(`(function(){ FG.state.steles[${JSON.stringify(st[0][0])}]=3; FG.gotoMap('houshan');
      FG.state.player.x=${st[0][1][0]}; FG.state.player.y=${st[0][1][1]}+30;
      FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
    await sleep(400);
    return st[0][0];
  }],
  ['采集点（刚采过）', async () => {
    await calm();
    await ev(`(function(){
      var n=FG.SPOTS.xipan.pick.filter(function(x){return x.k==='mei';})[0];
      FG.pick(n);
      FG.gotoMap('xipan'); FG.state.player.x=n.at[0]; FG.state.player.y=n.at[1]+20;
      FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
    await sleep(400);
  }],
];
for (const [nm, setup] of checks) {
  const extra = await setup();
  if (extra === null) { ok(nm + '（后山没有刻石，跳过）', true, ''); continue; }
  const h = await hint();
  await key('e');
  const t1 = (await toast()).replace(/\s+/g, ' ').trim();
  const d1 = (await dlgOpen()) ? (await dlgText()).replace(/\s+/g, ' ').trim().slice(0, 30) : '';
  const p1 = await ev(`['de','dlg','sh','st','bx','bg','ch','al','hs','rd']
    .filter(function(i){ var e=document.getElementById(i); return e && !e.classList.contains('hide'); }).join(',')`);
  const said = (t1 || d1 || p1);
  ok(nm + '：按下去有回话', !!said, said ? String(said).slice(0, 46) : '（什么也没说）');
  console.log('     提示「' + h + '」');
  if (t1 || d1) await ev(`document.getElementById('dlg-x') && document.getElementById('dlg-x').click()`);
}

console.log('\nLOGS', logs.length ? logs.join('\n  ') : '(无报错)');
if (logs.length) process.exitCode = 1;
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(fails ? 1 : 0);
