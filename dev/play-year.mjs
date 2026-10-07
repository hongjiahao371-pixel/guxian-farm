// 玩一遍：144 天，一个称职但不最优的玩家。
//
// 这不是验收。**验收核的是「我写的规范有没有被满足」，玩的是「什么感觉」。**
// 两者不一样：断言全绿的玩起来照样可能空转、卡住、说不清。
// 所以这里记的不是 PASS/FAIL，是**玩家实际看到的东西** ——
// 每天的浮字、提示行、进项、以及「这一天到底干了什么」。
//
// 玩家水平：会种会收会浇会喂会钓会敲会买卖，但不最优 —
// 不算经济、不卡最佳路线、不一遍天就收光。
//
// 用法：node dev/play-year.mjs
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'dev');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9420;
const profile = path.join(tmpdir(), 'guxian-play-' + process.pid);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--mute-audio',
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
const noise = [];
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
await send('Page.navigate', { url: 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') });
await sleep(2600);
await ev(`localStorage.clear()`);
await ev(`location.reload()`);
await sleep(2600);
await ev(`FG.startFrom('new')`);
await sleep(1200);

const toast = () => ev(`document.getElementById('toast').textContent.replace(/\\s+/g,' ').trim()`);
const hint = () => ev(`document.getElementById('hint').textContent.replace(/\\s+/g,' ').trim()`);
const hud = () => ev(`(function(){
  var e=document.getElementById('hud-day')||document.getElementById('hud');
  return e?e.textContent.replace(/\\s+/g,' ').trim().slice(0,42):'?';})()`);
const clearToast = () => ev(`(function(){var t=document.getElementById('toast');
  if(t){t.textContent='';t.classList.remove('on');} return 1})()`);
const flushQ = async () => { for (let i = 0; i < 14 && (await ev(`FG.rewardDepth()`)) > 0; i++) { await ev(`FG.flushReward()`); await sleep(16); } };
// 真按一个键。抛竿、提竿、跟人说话都得走这一条 ——
// 钓鱼要等咬钩，1.0~3.8 秒随机，得一帧一帧轮询 phase，
// 所以它没法塞进那个同步的大 ev() 里，只能在外面一按键一按键来
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(120);
}

// 玩家一天里看到的浮字（浮字是排队一条一条出的，所以「今天发生了什么」得攒起来看）
let dayLines = [];
const record = async () => {
  const t = await toast();
  if (t) dayLines.push(t);
  await clearToast();
};

// 跑多少天。默认一整年；传个数字当第一个参数就能只跑前几天试一遍
// （钓鱼要真等咬钩、敲矿要一层层下，改完先跑 20 天看一眼再上 144）。
// **上限放到 288**：诗册里「忘怀得失」只肯在第二年年结给，
// 而「陈酒」要酿好放满一整年 —— 跑不满两年，这两样一辈子拿不着，
// 报告上就跟「玩不到」混成一回事了
const DAYS = process.argv[2] ? Math.min(Number(process.argv[2]), 288) : await ev(`FG.SOLAR_YEAR`);
const report = [];
let stuck = [];          // 连续多少天没进账
let flatDays = [];       // 这一天什么都没发生
let repeated = {};       // 同一句浮字出现过几次

console.log('归隐 · 玩一遍 ' + DAYS + ' 天\n');
console.log('日  节气   天气  体力  钱    进项   干了什么');

let prevGold = 0;
let nightTotal = 0;      // 夜里钓上的尾数（黄鳝/鳝鲿只带月出）
// 每天早上那个大 ev() 之前先把两个「这一整轮做过哪几种」的本子摆上页面。
// 它俩必须活过跨年 —— 诗册里「此中有真意」要五种谷都收过，
// 而 S.got 是一年一本的账，跨年就归零，拿它判「全不全」会年年从头数
await ev(`(function(){ window.__SOWN=window.__SOWN||{}; window.__COOKED=window.__COOKED||{}; return 1})()`);
for (let day = 1; day <= DAYS; day++) {
  // —— 每天早上一场：把「新手能做的事」全做一遍 ——
  const st = JSON.parse(await ev(`(function(){ try {
    FG.state.day=${day};
    FG.state.min=FG.DAY.START; FG.state.ended=false; FG.state.started=true;
    FG.weatherFix();
    var did=[], gold0=FG.state.gold;

    // 1) 牲口：喂、收
    FG.keepFix(); FG.machFix(); FG.dogFix();
    var k, kd;
    for (k in FG.state.keep){
      kd=FG.state.keep[k]; if(!FG.state.build[k]) continue;
      FG.keepUse(k);
      var s=FG.keepState(k);
      if (s && s.got) { FG.keepUse(k); }
    }
    if (FG.state.build.gou) { FG.dogMorning(); }
    var dq=FG.dogPose ? FG.dogPose() : null;
    if (dq && dq.n) { FG.dogTake(); did.push('收狗叼的'); }

    // 2) 田：收熟的 → 翻空的 → 下能种的
    var F=FG.FIELD, r, c, pl, till=0, sow=0, wat=0, har=0;
    // cropsSowable() 给的是**名字**（豆），S.seeds 按**作物 id**（dou）记 ——
    // 拿名字去查 seeds 是 undefined > 0 恒假，一畦也种不下去
    var name2id = {}; for (var ci in FG.CROPS) name2id[FG.CROPS[ci].name] = ci;
    var sowable = FG.cropsSowable().map(function(n){ return name2id[n] || n; });
    // **轮着种，不是老种第一个。** 原来写死 sowable[0]，
    // 于是当季头一种占满了每一畦 —— 一年下来五谷只收齐 4/5，
    // 诗册里「此中有真意，欲辨已忘言」要五种都收过，一直差着一种。
    // sownAny 是**这一整轮跑下来种过哪几种**，跨年不清
    // （S.got 是一年一本的账，跨年就归零，拿它判「种全过没有」会年年重数）。
    // 挂成页面上的一个全局，好让大 ev() 那一大块能读写 ——
    // 那个 ev 里拿不到 Node 作用域的变量
    var pickIdx = 0, pi2;
    for (pi2=0; pi2<sowable.length; pi2++) if (!window.__SOWN[sowable[pi2]]) { pickIdx=pi2; break; }
    var crop0 = sowable.length ? sowable[pickIdx] : null;
    if (crop0) window.__SOWN[crop0] = 1;
    for (r=0;r<F.ROWS;r++) for (c=0;c<F.COLS;c++){
      pl=FG.state.plots[r][c]; if(!pl) continue;
      if (pl.crop && pl.stage>=FG.CROPS[pl.crop].days && FG.state.stam>0){ FG.harvest(c,r); har++; }
      if (!pl.crop && !pl.tilled && FG.state.stam>2 && !FG.groundFrozenNow() && !FG.isSnowWeather()){
        FG.workArea('chu',c,r); till++;
      }
      if (pl.tilled && !pl.crop && crop0 && FG.state.seeds[crop0]>0
          && FG.state.stam>3 && !FG.groundFrozenNow() && !FG.isSnowWeather()){
        var crop = crop0;   // 已经是作物 id 了
        FG.sowWith(crop, c, r); sow++;
      }
      if (pl.tilled && !pl.wet && !FG.isWetWeather() && FG.state.stam>1 && FG.state.build.ditch){
        FG.state.plots[r][c].wet=true; wat++;
      }
    }
    if (har) did.push('收'+har);
    if (till) did.push('翻'+till);
    if (sow) did.push('种'+sow);
    if (wat) did.push('浇'+wat);

    // 3) 坛：起了的先起，有料就投
    var mid, ml=FG.machList();
    for (var i2=0;i2<ml.length;i2++){ mid=ml[i2].id;
      if (!FG.state.mach.lv[mid]) continue;
      if (FG.machJob(mid)) { if (FG.machDone(mid)) { FG.machTake(mid); did.push('起坛'); } }
      else { FG.machPut(mid); }
    }

    // 3b) 灶上：凑齐了就做，一天几口由 cookCap 说了算。
    // **cookCap() 返回的是一个数字**（今天还能做几口），不是带 .cap 的对象 ——
    // 原来写 cap.cap 拿到 undefined，cooked < undefined 恒假，
    // 于是这一段一天都没进去过，酿一年停在 1 级。
    // 拿这种「不知道就不做」的地方，写代码的人得比机器先怀疑自己
    //
    // 先看酒：酒 sell=0，按「挑最贵」永远挑不到它，
    // 而**酒是唯一能换诗册的东西**（递满两坛给邻翁收「过门更相呼」）。
    // 一年下来酿到满级却一坛没酿过 —— 那不是这游戏不好玩，
    // 是这个玩家不知道酒不卖钱
    //
    // 接着**九条配方轮着做**，不是只做最贵的那条。
    // 原来「挑最贵」= 一年只做得出 酒 和 醋 两条，
    // 另外七条（酱/饼/鱼干/藕粉/菇酱/干菊/蛋羹）一次没被碰过。
    // __COOKED 记的是**这一整轮做过哪几条**，跨年不清 ——
    // 九条都得有人做过，才谈得上「这个游戏有九条配方」
    // 「有没有人还想要酒」问的是**还差几坛**，不是人情有多熟。
    // 这里原来读的是 favor < need —— 和游戏里那个被我改掉的 bug 一模一样：
    // 办成一件托付（+4 分）就让「有人想要酒」永远为假，
    // 于是酒一天都没酿过，邻翁那首「过门更相呼」一年都拿不着。
    // 症状看着像「酒没人要」，实际是判据问错了对象。
    // 同一个错在一轮里犯两遍（游戏里一遍、脚本里一遍）——
    // 修的时候要顺着**调用它的地方**再扫一遍，不然它会穿着同一身衣服回来
    // 灶一天几口由 cookCap 说了算（没砌灶间一口，砌了灶间两口）。
    // 九条轮着做，还没做过的排前面；「挑最贵」只当九条都做完了的兜底。
    //
    // **一条硬规矩：还欠着酒的时候，不许做拿酒当原料的东西。**
    // 醋的 need 是 { jiu: 1 }，而它常常是「酒之外唯一做得出来的」那条 ——
    // 于是「酿过酒」记上了、__COOKED 里有它、手上却是 0。
    // 症状看着像「酒做不出来」，实际是**做出来又被自己喝掉了**。
    //
    // 这条排除一共要写三遍才拦得住（挑酒 / 挑没做过的 / 兜底挑最贵），
    // 而**三遍都写完还不算完** —— 原来最后一根救命稻草
    // 「if (!rr) rr = ck[0]」会把唯一剩下的候选捡回来。
    // 判据收紧成：还欠酒时，一条都不做，也不从里面挑。
    var cooked=0, cookedIds=[], ck=FG.cookable(), cap=FG.cookCap();
    var wantsWine=false, wk=FG.NPCS, wn2;
    for (wn2 in wk) {
      var wn3=FG.NPCS[wn2];
      if (wn3.wine && FG.winePts(wn3.id) < wn3.wine.need) { wantsWine=true; break; }
    }
    var eatsWine = function (r) { return wantsWine && r.need && r.need.jiu; };
    while (cooked < cap && ck.length){
      var rr=null, ri;
      if (wantsWine) for (ri=0;ri<ck.length;ri++) if (ck[ri].id==='jiu') rr=ck[ri];
      if (!rr) for (ri=0;ri<ck.length;ri++){
        if (eatsWine(ck[ri])) continue;
        if (window.__COOKED[ck[ri].id]) continue;
        rr=ck[ri]; break;                                   // 还没做过的排前面
      }
      if (!rr) for (ri=0;ri<ck.length;ri++){                // 九条都做过了：挑最贵的
        if (eatsWine(ck[ri])) continue;
        if (!rr || (ck[ri].sell||0)>(rr.sell||0)) rr=ck[ri];
      }
      if (!rr) break;          // ← 剩的全是拿酒当原料的。欠着酒就不做，别把酒喝了
      if (!FG.cook(rr)) break;
      window.__COOKED[rr.id]=1;
      cookedIds.push(rr.id);
      cooked++;
      ck=FG.cookable();
    }
    if (cooked) did.push('做'+cooked);
    if (cookedIds.length) did.push('{'+cookedIds.join(',')+'}');
    if (FG.state.jiu) did.push('手有酒'+FG.state.jiu);
    if (window.__COOKED.jiu) did.push('酿过酒');
    did.push('[黍' + FG.invGet('crop_shu') + '酒' + FG.state.jiu + ']');

    // 4) 采集 / 钓鱼 —— 不干这两样，图鉴、诗册、人情就全是空的，
    //    而那不是「游戏不好玩」，是**这个玩家不会玩**
    FG.gotoMap('xipan');
    var pk, pickN=0;
    for (var q=0;q<FG.SPOTS.xipan.pick.length && pickN<6;q++){
      pk=FG.SPOTS.xipan.pick[q];
      if (FG.state.picked[('p'+q+'-'+pk.k)] > FG.state.day) continue;
      if (pk.need && !FG.hasSkill(pk.need && Object.keys(pk.need)[0], pk.need[Object.keys(pk.need)[0]])) continue;
      FG.state.player.x=pk.at[0]; FG.state.player.y=pk.at[1]+20; FG.state.walkTo=null;
      FG.updateHUD();
      if (FG.nearPickSpot()) { FG.pick(FG.nearPickSpot()); pickN++; }
    }
    if (pickN) did.push('采'+pickN);
    // 钓鱼这一段**故意不做**：FG.nearFish 没有导出，
    // 而把「构造 S.fishing 再派发真按键」搬到这个 ev() 外面就得多走一套。
    // 图鉴里的鱼那一格因此会空着 —— 那是**这个脚本不会钓**，不是游戏不让钓。
    var fishN=0;
    // 5) 跟人说话。
    //
    // **一天要走两三张图，不是两张图里各说一个人。**
    // 「奇文共欣赏，疑义相与析」那句诗要的是 S.met 记下**三个不同的人**，
    // 而原来这段每天只跟溪畔的渔翁 + 另一张图的第一个人说话 ——
    // 来回就那俩，288 天下来 S.met 永远停在 2，那句话一辈子拿不到。
    // 症状是「天天在说话、诗册却不动」：说话**次数**够，**人数**不够。
    // 起始图按日子轮着换，不然永远按 FG.MAPS 的键序从同一张图开始
    var talkN=0, mk3=[];
    for (var mm3 in FG.MAPS){ if (FG.MAPS[mm3].npcs && FG.MAPS[mm3].npcs.length) mk3.push(mm3); }
    for (var off3=0; off3<mk3.length && talkN<3; off3++){
      var mk2 = mk3[(${day} + off3) % mk3.length];
      FG.gotoMap(mk2);
      var mp=FG.MAPS[mk2], nq3=0;
      for (var q3=0; q3<mp.npcs.length && talkN<3; q3++){
        var pn=FG.NPCS[mp.npcs[q3]]; if (!pn) continue;
        FG.state.player.x=pn.at[0]; FG.state.player.y=pn.at[1]+50; FG.state.walkTo=null;
        FG.updateHUD();
        if (FG.nearNpc()) { FG.talk(FG.nearNpc()); talkN++; nq3++; }
      }
    }
    if (talkN) did.push('说话'+talkN);

    // 5b) 递酒：**必须紧跟在 talk() 后面。**
    // giveWine() 不收参数，它读的是 dlgNpc —— **此刻打开着的那张对话卡**。
    // 原来这段放在做菜那一步、跟说话隔得老远，dlgNpc 那会儿是 null，
    // giveWine 头一句就 return 了：一年酿了几十坛酒，一坛也没递出去。
    // 症状特别像「酒没人要」：诗册那首「过门更相呼」一年没得着，
    // 而递酒那一刻什么也没发生、什么也没说
    var gave=0, gk=FG.NPCS, gi, wineWhy='';
    for (gi in gk){
      if (!FG.canGive(FG.NPCS[gi])){
        // 无条件记账：能递的人一个都没有，本身就是要看的信息
        if (FG.NPCS[gi].wine) wineWhy='canGive 假：jiu=' + FG.state.jiu
          + ' 递过=' + FG.winePts(gi) + ' need=' + FG.NPCS[gi].wine.need;
        continue;
      }
      // 先把对话卡开到那个人身上，再递
      var gn2=FG.NPCS[gi];
      FG.gotoMap(gn2.map || 'nanshan');
      FG.state.player.x=gn2.at[0]; FG.state.player.y=gn2.at[1]+50;
      FG.state.walkTo=null; FG.updateHUD();
      if (FG.nearNpc() && FG.nearNpc().id===gn2.id){
        FG.talk(FG.nearNpc());
        if (FG.canGive(FG.nearNpc())){
          var j0=FG.state.jiu;
          FG.giveWine();
          if (FG.state.jiu<j0) gave++; else wineWhy='giveWine 没扣酒';
        } else wineWhy='说完话 canGive 变假';
      } else wineWhy='站过去 nearNpc 不是他：' + (FG.nearNpc()?FG.nearNpc().id:'null');
    }
    if (gave) did.push('递酒'+gave);
    else if (wineWhy) did.push('【递不上：'+wineWhy+'　jiu='+FG.state.jiu+'】');

    // 4c) 后山：六方刻石。**一天读不满的，剩下天天来读。**
    //
    // 后山那组是**连着的一段《桃花源记》**，一共九句
    // （进谷那半句 + 六方刻石 + 读齐才给的最后半句），
    // 占 27 句里的三分之一 —— 诗册缺的最多一大块就在这儿。
    // 原来这个脚本压根不去后山，于是这九句一年没得着。
    // 走进后山自动收「山有小口」，剩下六方得一块一块读，
    // 读齐了才给「不足为外人道也」
    //
    // **要的是 FG.STELES，不是 FG.TAOYUAN.steles。** 后者是
    // ['kou','tian',...] 一串 id 字符串，前者才是带 at/name/v 的对象数组。
    // 传错的那次读出来是「读碑1」：readStele 收的是对象，
    // 拿到字符串就 S.steles[n.id] = day → 写进 S.steles["undefined"]，
    // 同一个键每回都命中，于是第二块起全被「读过」跳掉 ——
    // 症状是「只读到一块」，而每一处单独看都正常
    var readN=0, steles=FG.STELES, sidx;
    FG.gotoMap('houshan');
    for (sidx=0; sidx<steles.length; sidx++){
      if (FG.state.steles[steles[sidx].id]) continue;     // 读过的不再收
      FG.readStele(steles[sidx]);
      readN++;
    }
    if (readN) did.push('读碑'+readN);
    FG.gotoMap('nanshan');

    // 6) 山上：石硐
    //
    // 原来这一段是 rockCells(0,0,4,3) 然后每天点一下。
    // **rockCells(col,row) 只收两个参数**，返回的是镐在那一格框住的几格
    // （木镐 1×1）—— 多传的 4,3 被丢掉了，于是这个脚本一年只敲一格，
    // 第一格敲完就天天敲空气，凿一年停在 1 级。
    // 而且 mc++ 记的是**尝试次数**，不是敲开块数：
    // 浮字里那 53 次「这一片已经敲开了」就是这么来的。
    // 现在改成按 6×3 整层扫、只记真敲开的、敲干净了顺竖井往下
    if (FG.state.gear.jue>0 && !FG.mineShut() && FG.state.stam>20){
      FG.gotoMap('shidong');
      var mc=0, MC=FG.MINE.cols, MR=FG.MINE.rows, guard=0;
      while (guard++ < 8){
        if (FG.state.stam<=20) break;                      // 留点力气走路
        if (!FG.mineLeft(FG.state.mineFloor)) break;       // 这层已经见底
        var rr2, cc2, broke=false;
        for (rr2=0; rr2<MR; rr2++){
          for (cc2=0; cc2<MC; cc2++){
            if (FG.state.stam<=20) break;
            if (FG.rockAt(FG.state.mineFloor, cc2, rr2)===null) continue;
            var b4=FG.mineLeft(FG.state.mineFloor);
            FG.mineArea(cc2, rr2);
            var g4=b4-FG.mineLeft(FG.state.mineFloor);      // ← 只记真敲开的
            if (g4>0){ mc+=g4; broke=true; }
          }
        }
        if (!broke) break;
        // 敲干净了才下得去。走不动（凿不到四级）就停在这儿。
        // **判据是 <=，不是 <。** 原来写的是小于，于是站在最深那一层
        // （第 6 层、凿到四级才走得到）时 6 < 6 为假，
        // 直接 break 了 —— 而 useShaft 恰恰是**在最深那层才会**
        // 发出「未果，寻向所志，遂迷，不复得路」那一句的地方。
        // 于是硐里挖到底、诗册里那半句，一年都拿不着
        if (FG.mineCleared(FG.state.mineFloor) && FG.state.mineFloor<=FG.mineReach()){
          FG.useShaft();
          if (FG.state.mineFloor>FG.mineReach()) break;
        } else break;
      }
      if (mc) { did.push('敲'+mc); }
    }
    FG.gotoMap('nanshan');

    document.getElementById('dlg').classList.add('hide');

    // 7) 出货：篮里的都放箱子
    //
    // **binMove 顺手把箱面板打开了**（放东西进去要给反馈），
    // 而这个脚本从头到尾没关过它 —— 于是后面每一次按 E
    // 都被 keydown 开头那道 binOpen() 的 return 吃掉。
    // 游戏那样做是对的：箱子开着的时候 E 本来就该先被箱子收着。
    // 玩家按一下 Esc 就走，这个脚本得自己记得关
    var moved=0, it;
    for (it in FG.state.bag){ if (FG.state.bag[it]>0 && FG.binSellable('crop_'+it)){ FG.binMove('crop_'+it,true); moved++; } }
    for (it in FG.state.pouch){ if (FG.state.pouch[it]>0 && FG.binSellable('good_'+it)){ FG.binMove('good_'+it,true); moved++; } }
    for (it in FG.state.pouch){ if (FG.state.pouch[it]>0 && FG.binSellable('fish_'+it)){ FG.binMove('fish_'+it,true); moved++; } }
    for (it in FG.state.ore){ if (FG.state.ore[it]>0 && FG.binSellable('ore_'+it)){ FG.binMove('ore_'+it,true); moved++; } }
    for (it in FG.state.made){ if (FG.state.made[it]>0 && FG.binSellable(it)){ FG.binMove(it,true); moved++; } }
    if (moved) did.push('出货'+moved);
    document.getElementById('bx').classList.add('hide');   // 放完了就把箱子收起来

    // 6) 花钱：先补种，再慢慢添置
    var buys=0, order=['seedD','seedS','seedSh','seedJ','seedJu'];
    for (var b2=0;b2<order.length && buys<8;b2++){
      var itm=null; for (var q2=0;q2<FG.SHOP.xushi.length;q2++) if (FG.SHOP.xushi[q2].k===order[b2]) itm=FG.SHOP.xushi[q2];
      if (!itm) continue;
      var g=FG.shopItem(itm);
      if (FG.state.gold>=g.price && FG.state.seeds[FG.CROP_OF_SEED[itm.k]]<6){ FG.buy(itm.k); buys++; }
    }
    if (buys) did.push('买种'+buys);
    // 6) 花钱：**先走进墟市再买。**
    // 「暧暧远人村，依依墟里烟」那句诗的判据是**落地**那一刻
    // （gotoMap 里那句 m.id === 'xushi' 的 albumAdd('firstMarket')），
    // 出口不算、计划去也不算。而这个脚本买东西一直是直接调 buy()，
    // 于是 288 天下来**一天墟市都没去过**，那句话在表里躺着没人给
    FG.gotoMap('xushi');
    // 有钱就添置。
    //
    // **五台机器一个都不能落。** 键是成对的（L1、L2 交替）：
    // m1/m2 坛　m3/m4 果酱瓶　m5/m6 奶罐　m7/m8 鱼露坛　m9/m10 蜂窠。
    // 原来只排了 m1/m3/m9 —— **奶罐和鱼露坛一年没买过**，
    // 而鱼露坛的原料是鲫，鲫全年天天白天就能钓，
    // 等于游戏里摆了一台「原料白给、只花 3000 块」的机器没人看见
    var plan=['g1','g5','b1','h1','m1','g3','b3','b5',
              'g2','m3','m5','m7','m9','d1','b7','b9','h3',
              'm2','m4','m6','m8','g6','m10','b11','h5','d2','h6'];
    for (var p2=0;p2<plan.length;p2++){
      var raw=null; for (var q3=0;q3<FG.SHOP.xushi.length;q3++) if (FG.SHOP.xushi[q3].k===plan[p2]) raw=FG.SHOP.xushi[q3];
      if(!raw) continue; var gi=FG.shopItem(raw); var oo=FG.shopOwns(gi);
      if (oo.owned) continue;
      if (oo.locked) continue;
      if (FG.state.gold >= gi.price + 800){ FG.buy(raw.k); did.push(gi.name); break; }
    }

    return JSON.stringify({DBG:['plots='+FG.state.plots.length+','+FG.state.plots.map(function(r){return r.length;}).join('/'),
      'buildGou='+FG.state.build.gou,'keepUseOk=1','till='+till,'sow='+sow,'wat='+wat,'har='+har,
      'frozen='+FG.groundFrozenNow(),'snow='+FG.isSnowWeather(),'stam='+FG.state.stam,
      'sowable='+sowable.join('/'),'seedsDou='+FG.state.seeds.dou,'moved='+moved,'buys='+buys,
      'gold='+FG.state.gold].join(' | '),
      solar:FG.solarOf(FG.state.day).n, w:FG.WEATHER[FG.state.weather].name,
      stam:FG.state.stam, gold:FG.state.gold, gold0:gold0, did:did.join('·')||'（什么也没干）',
      quests:Object.keys(FG.state.quest||{}).filter(function(q){return FG.state.quest[q]==='given';}).length,
      dex:FG.dexCount('good')+FG.dexCount('fish')+FG.dexCount('ore'),
      album:Object.keys(FG.state.album||{}).length});
  } catch(err) {
    return JSON.stringify({solar:'?', w:'?', stam:FG.state.stam, gold:FG.state.gold, gold0:0,
      did:'出错：'+err.message, quests:0, dex:0, album:0, err:err.message});
  }})()`));

  await record();                                  // 收下这一早上的浮字
  await flushQ(); await record();
  await flushQ(); await record();
  await flushQ();

  // 4b) 钓鱼：一天抛两三竿。
  //
  // **这一段必须在那个大 ev() 外面。** 抛竿到咬钩是 1.0~3.8 秒的随机等待，
  // 要一帧一帧地轮询 phase —— 塞进同步表达式里等不出来。
  // 原来这整段是注释掉的，理由写的是「FG.nearFish 没导出」；
  // 其实那一阵根本不需要它：站到钓点的岸上，按 E，再按 E 就行。
  //
  // **断了要说出断在哪一步。** 这一段要是再「静默地什么都没干」，
  // 报告上就只剩一行没有「钓」字的日子 —— 看不出是抛不出去、
  // 等不到咬钩、还是提竿没提上。踩过的坑：一天抛三竿，
  // 每一段 break 都只把 fishN 留在 0，报告上跟没写这段代码一样
  //
  // **每隔几天熬一次夜。** 渔 4 级开的是「带月以后溪里另出两种鱼」
  // ——黄鳝 198、鳝鲿 132，是全游戏**唯一一处要玩家改作息才拿得到**的内容。
  // 而这个脚本的钟一直停在早上五点（DAY.START），于是这一整年
  // 黄鳝和鳝鲿一次都没出现过，渔满级也全是白天钓出来的鲫和虾。
  //
  // **四分之一的日子停在薄暮。** 「山气日夕佳，飞鸟相与还」那句诗判的是
  // 主循环里的 `FG.SHEN(S.min) === '薄暮'`，而薄暮是 [17:30, 20:00)。
  // 原来隔三差五把钟从早上**直接跳到 20:30**，一步跨过了整个薄暮 ——
  // 于是这句话在表里躺着，288 天没人给过它。
  // 判据在主循环里，所以只要钟落在那一段、主循环转过几帧，它自己会给
  const wantNight = (day % 4 === 3);
  const wantDusk  = (day % 4 === 1);
  if (wantDusk) {
    await ev(`(function(){ FG.state.min=FG.DAY.DUSK+30; FG.updateHUD(); return 1})()`);
    await sleep(400);          // 让主循环转几帧，SHEN 判据才有机会跑到
    await ev(`(function(){ FG.state.min=FG.DAY.START; FG.updateHUD(); return 1})()`);
  }
  if (wantNight) {
    await ev(`(function(){ FG.state.min=FG.DAY.NIGHT+30; FG.updateHUD(); return 1})()`);
  }
  let fishN = 0, fishWhy = '';
  let nightFish = 0;
  // 一天抛几竿：平常天一竿，夜里两竿。
  // 渔的手艺是「钓上一尾 2」——满级要 528 点，也就是 264 尾，
  // 一天一竿 288 天也有 288 尾，够满级；而咬钩的等待是
  // 1.0~3.8 秒随机，每多一竿就是好几秒，288 天下来说差别很大
  const CASTS = wantNight ? 2 : 1;
  for (let cast2 = 0; cast2 < CASTS; cast2++) {
    const spot = JSON.parse(await ev(`(function(){
      var L=FG.SPOTS.xipan.fish;
      return JSON.stringify(FG.fishHere().length ? L[0] : null);})()`));
    if (!spot) { fishWhy = '此刻溪里一条都不出'; break; }
    await ev(`(function(){ FG.gotoMap('xipan');
      FG.state.player.x=${spot.at[0]}; FG.state.player.y=${spot.at[1]}+130;
      FG.state.walkTo=null; FG.updateHUD(); return 1})()`);
    await sleep(420);
    const hintNow = await ev(`document.getElementById('hint').textContent.replace(/\\s+/g,' ').trim()`);
    if (hintNow.indexOf('垂钓') < 0) { fishWhy = '站到钓点，提示行没有垂钓：' + hintNow.slice(0, 24); break; }
    await key('e');                                  // 抛竿
    await sleep(160);
    if (!(await ev(`!!FG.state.fishing`))) {
      // 抛不出去的时候把判据那几样一起打出来：地图、对没对、钟、站位。
      // 猜哪一处在拦是猜不出来的 —— E 的判定链上有十来道门
      // （ended / 正在垂钓 / NPC / 已回家的 NPC / 钓点 / 采集点 / 出口 / 归家），
      // 少一道就静默 return，而提示行照样写着「E 垂钓」
      const st2 = JSON.parse(await ev(`JSON.stringify({
        map:FG.state.map, ended:FG.state.ended, min:FG.state.min,
        x:Math.round(FG.state.player.x), y:Math.round(FG.state.player.y),
        open:['de','dlg','sh','st','bx','bg','ch','al','hs','rd','toast'].filter(function(i){
          var e=document.getElementById(i); return e && !e.classList.contains('hide'); }).join(','),
        toast:(document.getElementById('toast').textContent||'').replace(/\\s+/g,' ').trim().slice(0,30)
      })`));
      fishWhy = '按了 E 竿没出去　开着=' + (st2.open||'(无)')
        + '　map=' + st2.map + ' min=' + st2.min + ' 站在 ' + st2.x + ',' + st2.y
        + (st2.toast ? '　回话「' + st2.toast + '」' : '');
      break;
    }
    // 真等咬钩：轮询到 phase 不是 wait 为止。
    // 等待是 1.0 + 随机*2.8 秒，上限 3.8 —— 给 5 秒就够，
    // 原来给 8 秒，而空军的那几竿有一大半时间是干等在那儿
    let waited = 0, phase = 'wait';
    while (waited < 5000) {
      await sleep(90); waited += 90;
      phase = await ev(`FG.state.fishing ? FG.state.fishing.phase : 'gone'`);
      if (phase !== 'wait') break;
    }
    if (phase !== 'bite') { fishWhy = '等了 ' + waited + 'ms 还没咬钩（相位 ' + phase + '）'; break; }
    await key('e');                                  // 提竿
    await sleep(200);
    if (await ev(`!!FG.state.fishing`)) { fishWhy = '提竿没提上，竿还挂着'; break; }
    fishN++;
    if (wantNight) nightFish++;      // 夜里钓的都算夜鱼（黄鳝/鳝鲿只带月出）
    if (fishN >= CASTS) break;
  }
  await ev(`(function(){ FG.gotoMap('nanshan'); return 1})()`);
  // did 只活在大 ev() 里面（st.did 是它拍下来的字符串），
  // 外面这一段是在那之后跑的，所以得自己接上去
  if (fishN) st.did = st.did + '·钓' + fishN;
  else if (fishWhy) st.did = st.did + '·【钓不上：' + fishWhy + '】';
  // 钟拨到带月是为了钓夜鱼。**钓完要拨回早上** ——
  // 不拨回去的话这一夜剩下的时间全在夜里，而晚上 NPC 收摊、铺子关，
  // 后面那几步「跟人说话」「买进程序列」就都在关着的门前面做了
  if (wantNight) {
    await ev(`(function(){ FG.state.min=FG.DAY.START; FG.updateHUD(); return 1})()`);
  }
  if (nightFish) nightTotal += nightFish;

  // 7) 睡（天黑结算）。走真实的日终按钮那一支
  //
  // **要点到日子真的翻过去为止。** 原来这里 sleep(30) 之后点一下就往下走，
  // 而面板是游戏自己在下一帧才拉出来的 —— 面板还没开，那一下就被跳过，
  // 那一夜整个没结算：箱子没出货、钱没进账。
  // 第二天开头脚本直接 `FG.state.day=N` 把日子掰过去，
  // 于是错过的那些夜**看不出任何症状**，只是钱晚到一天。
  //
  // **进项必须读结算之后的 gold。** 钱是 nextDay() 里结的，
  // 而上面那个早上快照取在结算之前 —— 拿它算 earn 等于数昨晚的钱。
  // 症状是日志里出现「出货6　进项 0」：出货在早上、钱在夜里，
  // 而这一列读的是昨天早上的钱。整张表的「进项」都晚一天。
  await ev(`(function(){ FG.state.min=FG.DAY.END-1; return 1})()`);
  let end = null;
  for (let tap = 0; tap < 6; tap++) {
    await sleep(80);
    end = JSON.parse(await ev(`(function(){
      var e=document.getElementById('de'), b=document.getElementById('de-next');
      var open = e && !e.classList.contains('hide');
      if (open && b) b.click();
      return JSON.stringify({open:open, day:FG.state.day, gold:FG.state.gold, earned:FG.state.earned});})()`));
    if (end.day > day) break;          // 日子翻过去了，这一夜的钱也到账了
  }
  await record(); await flushQ(); await record(); await flushQ();

  const earn = end.gold - prevGold;     // ← 结算之后的钱，不是早上那个快照
  if (earn <= 0) stuck.push(day); else if (stuck.length) stuck.push(-stuck[stuck.length-1]);
  if (earn > 0) stuck = [];
  if (/什么也没干/.test(st.did)) flatDays.push(day);
  dayLines.forEach(l => { repeated[l] = (repeated[l] || 0) + 1; });
  dayLines = [];

  if (day % 1 === 0) {
    // 钱这一列也用结算之后的数：早上那个快照是「今天开始时有多少」，
    // 跟同一行的「进项」（今天净赚多少）对不上号，看着像少了一笔
    report.push('D' + String(day).padStart(3) + ' ' + st.solar + ' ' + st.w
      + '　体力' + String(st.stam).padStart(3) + '　钱' + String(end.gold).padStart(6)
      + '　进项' + String(earn).padStart(5) + '　' + st.did);
    // 控制台每 12 天打一行。跑 288 天的时候，
    // 「每 6 天一行」既看不到进度、又刷屏 —— 有一次跑 6 天的
    // 试跑因为一行都没打，我以为卡住，把任务停了重跑了一遍
    if (day % 12 === 0 || day === DAYS) console.log('D' + String(day).padStart(3) + ' ' + st.solar + ' ' + st.w
      + '　体力' + String(st.stam).padStart(3) + '　钱' + String(end.gold).padStart(6)
      + '　进项' + String(earn).padStart(5) + '　' + st.did);
  }
  prevGold = end.gold;
}

const fin = JSON.parse(await ev(`JSON.stringify({
  day: FG.state.day, gold: FG.state.gold, earned: FG.state.earned,
  album: Object.keys(FG.state.album||{}).length, albumAll: FG.ALBUM.length,
  dex: FG.dexCount('good')+FG.dexCount('fish')+FG.dexCount('ore'), dexAll: FG.dexAll(),
  skill: Object.keys(FG.state.skill).map(function(k){return k+FG.state.skill[k].lv;}).join(' '),
  build: Object.keys(FG.state.build).filter(function(k){return FG.state.build[k];}).join(' '),
  mach: Object.keys(FG.state.mach.lv).filter(function(k){return FG.state.mach.lv[k];}).join(' '),
  furn: Object.keys(FG.state.furn).filter(function(k){return FG.state.furn[k];}).join(' '),
  quests: Object.keys(FG.state.quest||{}).length, questsAll: FG.QUESTS.length,
  ren: Object.keys(FG.state.ren||{}).map(function(k){return k+FG.renName(k);}).join(' '),
  got: Object.keys(FG.state.got||{}).length })`));

console.log('\n=== 一年下来 ===');
console.log('天数 ' + fin.day + '　钱 ' + fin.gold + '　一生进项 ' + fin.earned);
console.log('诗册 ' + fin.album + '/' + fin.albumAll + '　图鉴 ' + fin.dex + '/' + fin.dexAll
  + '　五谷 ' + fin.got + '/5　托付 ' + fin.quests + '/' + fin.questsAll);
console.log('手艺 ' + fin.skill);
console.log('营造 ' + (fin.build||'（一样没造）') + '　机器 ' + (fin.mach||'（一样没买）')
  + '　家具 ' + (fin.furn||'（一样没买）'));
console.log('人情 ' + fin.ren);
// 覆盖率。原来这些只能靠人翻日志去数，而「数出来有多少」正是
// 判断「这一轮到底玩到了多少东西」的唯一依据
const cov = JSON.parse(await ev(`JSON.stringify((function(){
  var mach=[], i, k, mk;
  for (mk in FG.MACHINE) if (FG.state.mach.lv[mk]) mach.push(mk);
  var done=[], all=[];
  for (i=0;i<FG.RECIPES.length;i++){ all.push(FG.RECIPES[i].id); }
  for (k in window.__COOKED) if (window.__COOKED[k]) done.push(k);
  var sown=[]; for (k in window.__SOWN) sown.push(k);
  var cr=[]; for (k in FG.CROPS) cr.push(k);
  return {mach:mach, machAll:Object.keys(FG.MACHINE).length,
    done:done, doneAll:all.length, sown:sown, crops:cr,
    dex:FG.dexCount('good')+FG.dexCount('fish')+FG.dexCount('ore'), dexAll:FG.dexAll(),
    night:(FG.state.pouch.shan||0)+(FG.state.pouch.zhi||0)};})())`));
console.log('机器 ' + cov.mach.length + '/' + cov.machAll + '　[' + cov.mach.join(' ') + ']');
console.log('灶上做过 ' + cov.done.length + '/' + cov.doneAll + '　[' + cov.done.join(' ') + ']');
console.log('种过 ' + cov.sown.length + '/' + cov.crops.length + '　[' + cov.sown.join(' ') + ']');
console.log('夜鱼（黄鳝/鳝鲿）手上 ' + cov.night + ' 条　这一轮夜里钓上 ' + nightTotal + ' 尾');
console.log('\n连续没进账的日子：' + (stuck.length ? stuck.join(',') : '无'));
console.log('「什么也没干」的日子：' + (flatDays.length ? flatDays.join(',') : '无'));
// **把没拿着的句子逐句列出来。**
// 原来只报「21/27」，剩下那 6 句是哪些全靠猜 —— 而「猜」出来的缺口
// 很容易和「结构上拿不到」混在一起：someVerse 挂在第二年上，
// 一年跑完本来就拿不到；someVerse 挂在「带月」上，那是这个玩家
// 不会熬夜。两者都记成「缺」，就分不出该补玩法还是该补天数了
const missAlbum = JSON.parse(await ev(`JSON.stringify((function(){
  var L=FG.ALBUM, got=FG.state.album||{}, out=[];
  for (var i=0;i<L.length;i++) if (!got[L[i].k]) out.push(L[i].k);
  return out;})())`));
console.log('\n诗册还差 ' + missAlbum.length + ' 句：' + (missAlbum.join('　') || '（全收齐了）'));
const rep = Object.keys(repeated).filter(k => repeated[k] >= 20).sort((a, b) => repeated[b] - repeated[a]);
console.log('\n重复 20 次以上的浮字（同一句一天说几遍）：');
rep.slice(0, 14).forEach(k => console.log('  ×' + repeated[k] + '　' + k.slice(0, 40)));
console.log('\n控制台噪声：' + (noise.length ? noise.slice(0, 8).join(' | ') : '无'));

writeFileSync(path.join(OUT, '_play.log'), report.join('\n'), 'utf8');
console.log('\n逐日记在 dev/_play.log（' + report.length + ' 行）');
ws.close(); chrome.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { }
process.exit(0);
