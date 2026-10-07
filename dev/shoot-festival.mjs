// 节日验收。
//
// 星露谷一年三十来个节日，是它「打断日常」那一层的主要来源。
// 归隐版一年 144 天只挂六个 —— 一天一个节日等于天天过节，等于不过节。
//
// 盯住这几条：
//   1) 六个日子都是节气里**第一天**，一年就六天，稀稀落落才对
//   2) 过节那天墟市上的人**挪到广场去** —— 画上的位置和判定的位置必须是同一处
//   3) 挨个走过去说一圈，才给得出那样东西
//   4) 领过的那次不能再领（同一年的同一天只能拿一次）
//   5) 不是过节的日子，墟市的人**回到自己平时的位置**，说话也是平时的
//   6) 礼物给的实物要真进账，而且进的是对的那本账
//   7) 节日不给诗 —— 诗册那 27 句是「第一次做某件事」才收的
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9401;
const profile = path.join(tmpdir(), 'guxian-fest-' + process.pid);

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
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
  await sleep(200);
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
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 });

console.log('— 节日表自己站得住 —');
const F = JSON.parse(await ev(`JSON.stringify(FG.FESTIVAL)`));
console.log('  ' + F.map(f => f.name.replace(/\s/g, '') + '(' + f.solar + ')').join('　'));
const solKeys = JSON.parse(await ev(`JSON.stringify(FG.SOLAR.map(function(s){return s.k}))`));
ok('六个节日', F.length === 6, F.length + ' 个');
ok('每个节气的 key 都是真的', F.every(f => solKeys.indexOf(f.solar) >= 0),
  F.filter(f => solKeys.indexOf(f.solar) < 0).map(f => f.solar).join(' ') || '都对');
ok('都挂在那一年的第一天', F.every(f => f.d === 1), F.map(f => f.d).join(' '));
ok('节气一个不重', new Set(F.map(f => f.solar)).size === F.length,
  F.map(f => f.solar).join(' '));
// 礼物得是行囊里真有的东西。写一个认不出来的 key 的话，
// invGive 会静悄悄丢掉，玩家看完节日手里什么也没有
const badGift = JSON.parse(await ev(`JSON.stringify((function(){
  var b=[],i; for(i=0;i<FG.FESTIVAL.length;i++){
    var g=FG.FESTIVAL[i].gift;
    if(!FG.BAG_IDX[g.k]) b.push(FG.FESTIVAL[i].k+':'+g.k);
  } return b;
})())`));
ok('每份礼物都在物品总表里', badGift.length === 0, badGift.join(' ') || '都对');
ok('礼物不重复（六个节日给六样）', new Set(F.map(f => f.gift.k)).size === F.length,
  F.map(f => f.gift.k).join(' '));
// 礼物里不能混进诗册那类「第一次才收」的东西 —— 节日不是第一次
const inAlbum = JSON.parse(await ev(`JSON.stringify((function(){
  var b=[],i,k; for(i=0;i<FG.FESTIVAL.length;i++){ k=FG.FESTIVAL[i].gift.k;
    if (FG.ALBUM_IDX[k]) b.push(k); } return b; })())`));
ok('礼物里没有诗册条目（诗册只收「第一次做某件事」）', inAlbum.length === 0,
  inAlbum.join(' ') || '没有');

console.log('— 一年里就是这六天 —');
const festDays = JSON.parse(await ev(`JSON.stringify((function(){
  var a=[],i; for(i=1;i<=FG.SOLAR_YEAR;i++) if(FG.festivalOn(i)) a.push(FG.festivalOn(i).k);
  return a;
})())`));
console.log('  头一年过节的日子 =', JSON.stringify(festDays));
ok('一年正好六天', festDays.length === 6, festDays.length + ' 天');
ok('六天互不相同', new Set(festDays).size === 6, JSON.stringify(festDays));
// **别直接用 festDays.sort()**：sort 是原地排序，它会把 festDays 自己打乱，
// 后面 festDays[0] 就不是原来那一个了 —— 后面几处全在跟错的节日对
const gotSorted = festDays.slice().sort();
ok('都是预期的那几个', JSON.stringify(gotSorted) === JSON.stringify(F.map(f => f.k).slice().sort()),
  JSON.stringify(gotSorted));

// 第二年同一天还是过节，但没领过的东西要能再领
const festDay0 = await ev(`(function(){ for(var i=1;i<=FG.SOLAR_YEAR;i++) if(FG.festivalOn(i)) return i; return -1})()`);
ok('找得到第一个节日', festDay0 > 0, '第 ' + festDay0 + ' 天');

console.log('— 过节那天墟市上的人挪到广场 —');
const crowd = JSON.parse(await ev(`(function(){
  FG.gotoMap('xushi'); FG.state.day=${festDay0};
  FG.state.fest={said:{},got:[]};
  var f=FG.festivalOn(FG.state.day);
  var c=FG.festCrowd(f), o=[];
  for(var i=0;i<c.length;i++) o.push(c[i].id+'@'+JSON.stringify(FG.npcAt(c[i])));
  return JSON.stringify({k:f.k, n:c.length, who:o});
})()`));
console.log('  ' + crowd.k + '：' + crowd.n + ' 位 —— ' + crowd.who.join('　'));
ok('聚了几个人', crowd.n >= 3, crowd.n + ' 位');
// 逐个核：画的位置（npcAt）和判定用的位置必须是同一处
const moved = JSON.parse(await ev(`JSON.stringify((function(){
  var f=FG.festivalOn(FG.state.day), c=FG.festCrowd(f), a=[], i, n, p;
  for(i=0;i<c.length;i++){
    n=c[i]; p=FG.npcAt(n);
    a.push(n.id + ':' + (p===n.at ? '没挪' : '挪了'));
  }
  return a;
})())`));
ok('墟市上的人全都挪了位', moved.every(m => m.indexOf('挪了') >= 0), moved.join(' '));
// 挪到广场之后，判定点也要跟着走 —— 站在老位置不该还能说上话
const spotOK = JSON.parse(await ev(`(function(){
  var f=FG.festivalOn(FG.state.day), c=FG.festCrowd(f), n=c[0];
  var old=n.at, now=FG.npcAt(n);
  FG.state.player.x=old[0]; FG.state.player.y=old[1];
  var dOld=Math.abs(old[0]-FG.state.player.x)+Math.abs(old[1]-FG.state.player.y);
  var nn=FG.nearNpc();
  return JSON.stringify({old:old, now:now, d:dOld, hit: nn?nn.id:null});
})()`));
console.log('  站在老位置上 nearNpc 判到 =', spotOK.hit || '没有人');
ok('站在他原来的位置上叫不到他（判定跟着画一起挪了）', spotOK.hit !== 'xushi',
  spotOK.hit || '没有人');
// 画上的位置不能都挤在墟市外头
const inBounds = JSON.parse(await ev(`(function(){
  var f=FG.festivalOn(FG.state.day), c=FG.festCrowd(f), b=FG.MAPS.xushi.bounds, a=[], i, p;
  for(i=0;i<c.length;i++){ p=FG.npcAt(c[i]);
    a.push(p[0]>=b.x0 && p[0]<=b.x1 && p[1]>=b.y0 && p[1]<=b.y1); }
  return JSON.stringify(a);
})()`));
ok('每个人的位置都在墟市那张图的界内', inBounds.every(Boolean), JSON.stringify(inBounds));
// 挨得不能太近 —— 半径 150，挨太近的话 E 归先判到的那个，
// 剩下的人永远轮不到，而那看着像这个节日少了几个人
// 页面里已经 return JSON.stringify(bad) 了，外面**别再 parse 一遍** ——
// 外面 parse 完得到的是数组，拿数组跟 '[]' 比永远不相等
const spread = await ev(`(function(){
  var f=FG.festivalOn(FG.state.day), c=FG.festCrowd(f), bad=[], i, j, a, b, d;
  for(i=0;i<c.length;i++) for(j=i+1;j<c.length;j++){
    a=FG.npcAt(c[i]); b=FG.npcAt(c[j]);
    d=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
    if(d < FG.SPOT_R.npc) bad.push(c[i].id+'-'+c[j].id+'='+d);
  }
  return JSON.stringify(bad);
})()`);
ok('聚的人之间离得开（不会有人永远轮不到）', spread === '[]', spread || '(读不到)');
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 挨个说一圈才给东西 —');
const standAt = async (n) => {
  await ev(`(function(){
    var p=FG.npcAt(FG.NPCS[${JSON.stringify(n)}]);
    FG.gotoMap('xushi'); FG.state.player.x=p[0]; FG.state.player.y=p[1]+40;
    FG.state.walkTo=null; FG.state.hover=null; return 1})()`);
  await sleep(450);
};
const F0 = F.find(f => f.k === festDays[0]);
const ids = JSON.parse(await ev(`JSON.stringify((function(){
  var c=FG.festCrowd(FG.festivalOn(FG.state.day)), a=[], i;
  for(i=0;i<c.length;i++) a.push(c[i].id);
  return a;
})())`));
console.log('  ' + ids.join('、'));
ok('墟市上有几个能说话的人', ids.length >= 3, ids.length + ' 位');
// 先站第一个人跟前
await standAt(ids[0]);
const h1 = await hint();
console.log('  提示 =', h1);
ok('提示是「说句话」而不是平时那句「与…说话」', h1.indexOf('说句话') >= 0, h1);
ok('提示写得出还差几位', h1.indexOf('还差') >= 0 || h1.indexOf('最后一位') >= 0, h1);
const gift0 = await ev(`JSON.stringify(FG.BAG_IDX[${JSON.stringify(F0.gift.k)}].name)`);
await clearToast();
await key('e'); await sleep(350);
const t1 = await toast();
// 每个人要有一句**自己的**话。早先只写一句 line，四个人说出来一模一样
ok('按 E 他说了一句', t1.indexOf(F0.lines[ids[0]].slice(0, 6)) >= 0, t1.slice(0, 40));
ok('每个人有各自那句，不是同一句说四遍',
  new Set(ids.map(i => F0.lines[i])).size === ids.length,
  ids.map(i => i + '：' + F0.lines[i].slice(0, 8)).join(' | '));
ok('还没给东西（只跟一个人说上了）', (await ev(`JSON.stringify(FG.state.fest.got)`)) === '[]',
  await ev(`JSON.stringify(FG.state.fest.got)`));
ok('说过的人记下了', (await ev(`FG.festSaid(FG.NPCS[${JSON.stringify(ids[0])}])`)) === true);
// 挨个说剩下的人
for (let i = 1; i < ids.length; i++) {
  await standAt(ids[i]);
  await clearToast();
  await key('e'); await sleep(320);
}
ok('都说过了', (await ev(`FG.festLeft(FG.festivalOn(FG.state.day))`)) === 0,
  (await ev(`FG.festivalOn(FG.state.day)`)) ? '还差 ' + await ev(`FG.festLeft(FG.festivalOn(FG.state.day))`) : '');
ok('全说完才给东西', (await ev(`JSON.stringify(FG.state.fest.got)`)) === JSON.stringify([F0.k]),
  await ev(`JSON.stringify(FG.state.fest.got)`));
// 礼物进的是对的那本账
const gotOK = await ev(`(function(){
  var k=${JSON.stringify(F0.gift.k)}, n=${F0.gift.n}, have=0;
  var it=FG.BAG_IDX[k];
  if(it.kind==='seed') have=FG.state.seeds[FG.CROP_OF_SEED[k]]||0;
  else if(k==='jiu') have=FG.state.jiu||0;
  else have=(FG.state.made[it.src]||0);
  return have >= n;
})()`);
ok('礼物真的进账了（进的是对的那本账）', gotOK === true, gift0 + ' ×' + F0.gift.n);
await shot('70-节日-广场.png');
ok('这一段控制台干净', logs.length === 0, logs.join(' | ') || '干净');

console.log('— 不能领第二次 —');
// 回到同一个节日重走一圈（换个存档再读回来，模拟重开这天）
await ev(`(function(){ FG.state.fest={said:{},got:[${JSON.stringify(F0.k)}]}; FG.saveGame(); return 1})()`);
await sleep(300);
await ev(`location.reload()`); await sleep(2600);
  // 刷新完先入局。**刷完 S.started 是 false**，E 的头一句就是「没开局直接 return」，
  // 而下面这一串是挨个按 E 跟人说话的 —— 不入局的话一个都按不动。
  // （这是三格存档那一轮改出来的：以前 showTitle() 开头就 load()，
  //   那一层隐含的入局没了，读档该由「续」那一按触发）
  await ev(`(function(){ FG.state.slot=0; FG.startFrom('cont'); return 1})()`); await sleep(900);
await ev(`(function(){ FG.gotoMap('xushi'); FG.state.day=${festDay0}; return 1})()`);
await sleep(400);
const ids2 = JSON.parse(await ev(`JSON.stringify((function(){
  var c=FG.festCrowd(FG.festivalOn(FG.state.day)), a=[], i;
  for(i=0;i<c.length;i++) a.push(c[i].id); return a;
})())`));
for (const n of ids2) {
  await standAt(n);
  await clearToast();
  await key('e'); await sleep(300);
}
const got2 = await ev(`JSON.stringify(FG.state.fest.got)`);
ok('领过一次的那个节日不会发第二份', JSON.parse(got2).filter(x => x === F0.k).length === 1, got2);
ok('说话还是能说的（不是过节就哑了）', (await ev(`FG.festLeft(FG.festivalOn(FG.state.day))`)) === 0);

console.log('— 不是过节的日子，各回各位 —');
await ev(`(function(){ FG.state.day=${festDay0 + 1}; FG.gotoMap('xushi'); return 1})()`);
await sleep(450);
ok('第二天不过节了', (await ev(`FG.festivalOn(FG.state.day)`)) === null,
  await ev(`FG.festivalOn(FG.state.day) ? FG.festivalOn(FG.state.day).k : '不过节'`));
const backHome = JSON.parse(await ev(`JSON.stringify((function(){
  var c=FG.festCrowd({}), a=[], i;
  // 直接看墟市上每个人还在不在自己表上的位置
  var m=FG.MAPS.xushi.npcs, o=[];
  for(i=0;i<m.length;i++){ var n=FG.NPCS[m[i]]; o.push(n.id+':'+(FG.npcAt(n)===n.at?'在原位':'还在广场')); }
  return o;
})())`));
ok('墟市上的人回到自己平时的位置', backHome.every(b => b.indexOf('在原位') >= 0), backHome.join(' '));
await standAt2Person(ids2[0]);
const hBack = await hint();
ok('提示也回到平时那句', hBack.indexOf('说话') >= 0 && hBack.indexOf('说句话') < 0, hBack);

console.log('— 老存档 / 重开归零 —');
await ev(`(function(){ var raw=JSON.parse(localStorage.getItem('guxian_nanshan_save_v1')); delete raw.fest; localStorage.setItem('guxian_nanshan_save_v1', JSON.stringify(raw)); return 1})()`);
await ev(`location.reload()`); await sleep(2600);
  // 刷新完要**自己续**，别指望标题那一层顺带把档读了
  await ev(`FG.startFrom('cont')`); await sleep(700);
ok('老存档没这一项也能补出来', (await ev(`JSON.stringify(FG.state.fest)`)) === '{"said":{},"got":[]}',
  await ev(`JSON.stringify(FG.state.fest)`));
await ev(`(function(){ FG.state.fest={said:{xushi:5},got:['taqing']}; FG.state.day=40; FG.saveGame(); return 1})()`);
await sleep(300);
await ev(`location.reload()`); await sleep(2600);
  // 刷新完要**自己续**，别指望标题那一层顺带把档读了
  await ev(`FG.startFrom('cont')`); await sleep(700);
ok('存档往返：领过的节日不会因为读档又给一份',
  (await ev(`JSON.stringify(FG.state.fest.got)`)) === '["taqing"]',
  await ev(`JSON.stringify(FG.state.fest.got)`));
await ev(`(function(){ FG.state.day=40; FG.saveGame(); return 1})()`);
await sleep(300);
await ev(`location.reload()`); await sleep(2600);
await ev(`FG.startFrom('new')`); await sleep(1200);
ok('开新局节日归零', (await ev(`JSON.stringify(FG.state.fest)`)) === '{"said":{},"got":[]}',
  await ev(`JSON.stringify(FG.state.fest)`));

console.log('');
console.log('LOGS ' + (logs.length ? '有输出：\n' + logs.join('\n') : '(无报错)'));
console.log(fails ? 'FAILED ' + fails : 'DONE');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(0);

async function standAt2Person(n) {
  await ev(`(function(){
    var p=FG.NPCS[${JSON.stringify(n)}];
    FG.gotoMap('xushi'); FG.state.player.x=p.at[0]; FG.state.player.y=p.at[1]+40;
    FG.state.walkTo=null; FG.state.hover=null; return 1})()`);
  await sleep(450);
}
