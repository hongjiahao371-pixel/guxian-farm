/* ============================================================
   归园 · 南山茅舍   主逻辑
   ------------------------------------------------------------
   与原版最大的不同：没有 tile 地图。
   底图是一整幅手绘水墨，田亩是把逻辑网格双线性映射到画上梯形得到的四边形。
   所以「点哪一格」= 把屏幕坐标反查成 (列,行)，见 field.js。

   一天的节奏照《归园田居·其三》走：晨兴理荒秽，带月荷锄归。
   ============================================================ */
(function (FG) {
  'use strict';

  var F = FG.FIELD, I = FG.INK, C = FG.CROPS, N = FG.NPCS;
  var W = 1920, H = 1080;
  var SAVE_KEY = 'guxian_nanshan_save_v1';

  var cv, x, bg, bgReady = false;
  var raf = 0, last = 0, acc = 0, musicT = 0;

  /* 状态 */
  var S = FG.state = {
    day: 1, min: FG.DAY.START, gold: 500, stam: 100, maxStam: 100,
    map: 'nanshan',                 // 当前在哪张图
    bag: { dou: 0, su: 0, shu: 0, ji: 0, ju: 0 },   // 收成
    pouch: {},                    // 鱼和山货，天黑时跟谷物一起出货
    picked: {},                   // 采集点 key -> 哪天长回来（day 号）
    steles: {},                   // 刻石 id -> 读过的日号。读过就是读过，不重置、不长回来
    jiu: 0,                        // 手里的酒（坛）。唯一不进钱的加工品
    made: {},                      // 灶上做出来的加工品 id -> 份数
    bin: {},
    // 出货箱的品级：0 本色 / 1 好品 / 2 上品。**摆成合法 0，不能 undefined**
    binQ: 0,                       // 出货箱：FG.BAG 的 key -> 份数。天黑只出货这里头的东西
    // 木箱。**必须在 init() 里就摆上**：load() 是 `for (var k in S)` 逐个同步的，
    // S 上没有的字段它根本不看 —— 不在这儿建的话，存档里的箱子会被整个丢掉，
    // 而症状是「东西存进去，刷新一下全没了」，不报错的
    chest: {},                     // 木箱：FG.BAG 的 key -> 份数。天黑不动它
    // 机器：lv 每样造到几级，job = 坛里正腌着的东西。
    // **初始就得是合法空账，不能是 null** —— 摆成 null 的话，
    // 任何在 buildInit/machFix 之前先读 S.mach.lv 的路径（比如开局就打开货单）
    // 都会当场炸 `Cannot read properties of null`。
    // 这跟 S.build / S.chest 同一个道理：账本在 init() 里就得立起来
    mach: { lv: {}, job: {} },
    // 棚：鸡舍 / 牛棚 / 羊圈，每样一头 { gate 门, feed 粮够几天, got 堆着几份 }。
    // **初始就得是合法空账** —— 摆成 null 的话开局打开墟市货单那类
    // 「在 machFix 之前先读」的路径会直接炸（16/9 踩过）
    keep: { coop: { gate: 0, feed: 0, got: 0 }, barn: { gate: 0, feed: 0, got: 0 }, sheep: { gate: 0, feed: 0, got: 0 } },
    // 家具：茅舍这一片的三样，造到了第几级。摆成合法空账，不能 null
    furn: { chufang: 0, cangfang: 0, dongxuan: 0 },
    // 狗：{day 上次叼回来的日子, n 窝边堆着几份, k 叼的是哪一样}
    dog: { day: 0, n: 0, k: null },
    // 见闻：认出过的山货 / 溪鱼 / 矿砂。
    // 值是 {n 见过几回, first 头一回是第几天}。
    // **跨年留着**（跟 S.album 一样，不跟 S.book 一起清）——
    // 一年结束就清掉的话，玩到第三年图鉴永远是空的
    dex: { good: {}, fish: {}, ore: {} },
    // 生辰：id -> 上一次给过礼是第几年。**记年不记日** ——
    // 记日的话同一年里第二天再碰见他会以为已经给过了
    birth: {},
    // 人情：id -> {p 分, tier 已到的最高档, day 上次说话是第几天, gave 礼给过没有}
    // 摆 null 是**可以的**（和 skill / quest / total / book 一样），
    // 但跟那些不一样，这条多一条约束：`renTier` 会在任何地方读 S.ren[id].p，
    // 而 undefined >= 15 是假 —— 少建一项，那一档就永远上不去，而且不报错。
    // 所以**读它的五处（renTier / renAdd / renUp / renGift / renForcedLine）
    // 每一处都必须在同一路径上先走 renFix**。2026-10-03 核过一遍，五处都在。
    ren: null,
    // 歇脚处的路，铺到了第几级。摆成合法空账，不能 null
    road: { cundao: 0 },
    // 到过哪些地方（地图 id -> 1）。歇脚处那份清单只列这里头有的。
    // **必须在 S 上摆着**：load() 是 for (var k in S)，S 上没有的 key
    // 存档里存了也白存 —— 而症状是「重开一局以后路就不通了」
    vis: {},
    // 今天灶上已经做了几口。**数**不是「上次动灶的日子」——
    // 有了灶间之后一天不止一口，光记哪一天动过就分不清今天还能不能再做
    cookN: 0,
    ore: {},                       // 矿砂 id -> 份数。敲出来的，只出货
    // 硐里每一层敲开的石头记在这里，key 是 'L' + 层号，值是这一层
    // cols*rows 块的现状：矿石 id，或者 null（已经敲开了）
    rock: {},
    mineFloor: 0,                  // 现在在第几层。0 = 不在硐里
    mineDeep: 0,                   // 到过的最深一层。进硐时落在这儿
    // 别人托你办的事：id -> 'given'（托了）/ 'done'（办成了）。
    // 刻意不记日子 —— 这套不设期限，记日子只是为了将来好写「还剩几天」，
    // 而那正是它一开始要避开的
    quest: null,
    // 一生累计：翻过的畦数、钓过的尾数、敲过的块数。
    // 账本（S.book）一年一清，任务要的是「一辈子做过多少」
    total: null,
    // 五门手艺：k -> {lv 已到几级, pt 这一级还差多少点}。
    // 满级不是「不记了」，是照样记、只是不再往上升 —— 面板上写得出来
    skill: null,
    pendingSeed: null,             // 从行囊里捏在手上的那包种。点田畦即下种
    favor: {},                     // 邻居 id -> 人情分。说话/递酒/办托付都记在这
    jiuPts: {},                    // 邻居 id -> 递酒折来的人情分（陈酒抵两份，所以一坛可能是 2）
    fest: null,                   // 节日：said = 哪天跟谁说过，got = 领过哪几个节日的礼
    book: null,                   // 本年的账：一年结束时要回顾
    album: {},                    // 诗册：k -> 收到那天的日号。跨年留着，账本不留
    // 现在用的是第几格存档。**要摆在 S 上**（load() 是 for...in S）：
    // 摆在别处的话，读档回来不知道自己在哪一格，存就存到第 0 格去了
    slot: 0,
    met: {},                      // 说过话的人 id -> true
    got: {},                      // 收过的谷物 id -> true
    earned: 0,                    // 一生累计进项。钱能花回零，这个不回零
    fishing: null,                // {i, t, wait, win, phase}
    catchCount: 0,
    seeds: { dou: 8, su: 4, shu: 3, ji: 2, ju: 2 },
    tools: {},                      // 买来的农具
    gear: { chu: 0, piao: 0, jue: 0 },  // 器物分级：FG.GEAR 的下标（0 = 木，开局就有；
                                        // 镐的 0 是「一把都没有」，所以开局手上只有两件）
    sel: 'chu',            // 当前器物
    // 营造单独一本账：器物是拿在手上的，建造在地上的，
    // 混在一处就没法只回滚其中一样（重开、读老档都要分开处理）
    build: {},             // {ji:0, shui:0} —— FG.BUILD 的下标
    plots: [],             // [row][col] = {tilled, wet, crop, stage}
    player: { x: 900, y: 800, face: 0, walk: 0 },
    hover: null,
    talkIdx: 0,
    ended: false,
    started: false,
    todayEarned: 0,
    todayWatered: 0
  };

  function curMap() { return FG.mapOf(S.map); }
  function mapNpcs() {
    var m = curMap(), out = [];
    for (var i = 0; i < m.npcs.length; i++) out.push(FG.NPCS[m.npcs[i]]);
    return out;
  }

  var TOOLS = [
    { k: 'chu', label: '锄', key: '1' },
    { k: 'piao', label: '木瓢', key: '2' },
    { k: 'dou', label: '豆种', key: '3' },
    { k: 'su', label: '粟种', key: '4' },
    { k: 'shu', label: '黍种', key: '5' },
    { k: 'ji', label: '稷种', key: '6' },
    { k: 'ju', label: '菊种', key: '7' },
    { k: 'jue', label: '镐', key: '8' }
  ];

  /* ---------------- 存档 ----------------
     **三格**。原来只有一格：想开第二个田就得把这一格删掉，
     而玩到一半的田没人舍得删 —— 于是「换个玩法试试」这件事做不了。

     第 0 格**沿用原来的键**（不带后缀）：老玩家存了一个月的田
     不能因为我加了几格就凭空消失，症状是「更新之后从零开始」，
     而那个存档本身是好的，只是找不到了。
     第 1、2 格往后排 `_s2` / `_s3`。 */
  FG.SAVE_SLOTS = 3;
  function saveKey(i) { return i ? SAVE_KEY + '_s' + (i + 1) : SAVE_KEY; }

  function save() {
    try {
      var d = JSON.parse(JSON.stringify(S));
      d.player = { x: S.player.x, y: S.player.y };
      localStorage.setItem(saveKey(S.slot || 0), JSON.stringify(d));
      FG.audio.play('buy');
    } catch (e) { }
  }
  function load() {
    try {
      var raw = localStorage.getItem(saveKey(S.slot || 0));
      if (!raw) return false;
      var d = JSON.parse(raw);
      for (var k in S) if (d[k] !== undefined) S[k] = d[k];
      // 老存档里没有手艺这本账。不补的话读档玩家看着五门全空 ——
      // 那不是「回到旧版」，是存档坏了
      skillFix();
      if (!S.jiuYear) S.jiuYear = [];
      // 老存档没有「递酒折了多少分」这本账。不补的话读档玩家一坛酒都递不出去 ——
      // canGive 读不到就当 0，而那是「还没递过酒」，跟新档一个样，对的
      if (!S.jiuPts) S.jiuPts = {};
      questFix();
      buildFix();
      chestFix();
      keepFix();
      festFix();
      machFix();
      weatherFix();
      renFix();
      dexFix();
      birthFix();
      return true;
    } catch (e) { return false; }
  }
  /* 看一眼某一格，**不动 S**。标题上要写「第几年第几天、收了多少钱」，
     而写这些得先读档 —— 读档就把现在的局面顶掉了。
     所以单独走一遍：只 parse，取几个字段就撒手。
     存档坏了（parse 抛）就当这一格是空的：**宁可让人重开一格，
     也不要把标题卡死在读不出来的存档上**。 */
  function slotInfo(i) {
    var raw = null;
    try { raw = localStorage.getItem(saveKey(i)); } catch (e) { return null; }
    if (!raw) return null;
    var d;
    try { d = JSON.parse(raw); } catch (e) { return { bad: 1 }; }
    var album = 0, k;
    for (k in (d.album || {})) if (d.album[k]) album++;
    var dex = 0, c, q;
    for (c in ((d.dex) || {})) for (q in d.dex[c]) if (d.dex[c][q]) dex++;
    return {
      day: d.day || 1,
      earned: d.earned || 0,
      album: album,
      dex: dex,
      map: (FG.MAPS && FG.MAPS[d.map]) ? FG.MAPS[d.map].name : '南山茅舍',
      solar: (d.day && FG.solarOf) ? FG.solarOf(d.day).n : ''
    };
  }
  FG.saveKey = saveKey;
  FG.slotInfo = slotInfo;
  // 验收开局走这一支，不去点标题上的按钮 ——
  // 三格之后标题是**画出来的**（按 slotInfo 填），按钮上带 data-act，
  // 写死一个 id 去点它，标题一改全套就红，而红的原因看着像游戏坏了
  FG.startFrom = startFrom;
  FG.showTitle = showTitle;
  FG.saveGame = save;
  FG.loadGame = load;
  // 探针要靠它把 HUD 推到最宽的一档再量。只改 S 不会触发重画，
  // 于是「量到的还是没酒那版」——量了个寂寞还以为验过了
  FG.updateHUD = updateHUD;

  function freshPlots() {
    if (!F.on) return [];
    var p = [];
    for (var r = 0; r < F.ROWS; r++) {
      p[r] = [];
      // cut = 这一畦已经割过几刀（再生作物才有）。**摆成 0，不留 undefined** ——
        // 留茬那一遍每帧都读它，undefined 掉进「没割过」那一支，
        // 症状是割完之后画面上立刻看不出割过
        for (var c = 0; c < F.COLS; c++) p[r][c] = { tilled: false, wet: false, crop: null, stage: 0, cut: 0 };
    }
    return p;
  }

  /* ---------------- 换图 ----------------
     底图是异步加载的，所以切过去的那一帧先把离屏画布涂成纸色，
     不然会拿上一张图的缓存接着画，看起来像「没切过去」。 */
  function loadBg(src) {
    bgReady = false;
    var bx = bg.getContext('2d');
    bx.fillStyle = '#e8e0cc'; bx.fillRect(0, 0, W, H);
    var img = new Image();
    img.onload = function () { bx.drawImage(img, 0, 0, W, H); bgReady = true; };
    img.onerror = function () { bgReady = true; };
    img.src = src;
  }

  function gotoMap(id, spawn) {
    var m = FG.mapOf(id);
    S.map = m.id;
    F.apply(m);
    // 只有南山的格子是菜畦。石硐也带 quad（F.on 为真，因为石头一样要按远近缩放），
    // 所以判据得看 farm 标志，不能看 F.on —— 否则站在硐里会把南山的田
    // 原样画到岩石上，结算里也会说「N 畦见长」而这里根本没有畦
    if (m.farm && (!S.plots || !S.plots.length)) S.plots = freshPlots();
    // 进硐落在**到过的最深那一层**。出去之前敲了一半的石头记在 S.rock 里，
    // 原样还在，所以「回到原处」是唯一说得通的一条；落回第一层的话，
    // 玩家会以为刚才那半天白挖了
    S.mineFloor = (m.id === 'shidong') ? (S.mineDeep || 1) : 0;
    S.player.x = (spawn || m.spawn)[0];
    S.player.y = (spawn || m.spawn)[1];
    S.walkTo = null;
    // 触屏那一杆的尾巴。**清 walkTo 的地方都得清它** ——
    // 换图时人已经不在去的那条路上了，可 touchGo 还挂着 true，
    // 于是下一段路（哪怕是鼠标点的）走完会白顶一下 interact()：
    // 站着看货单，莫名其妙跟人搭上话了
    S.touchGo = false;
    S.hover = null;
    // 换图的时候把对话卡收起来。不收的话玩家跟人说着话走进别的图，
    // 那张卡**跟着他走**——它是固定定位的浮层，不在画布里，
    // 而画面上已经换了地方，一张写着别人名字的卡还杵在正中间
    document.getElementById('dlg').classList.add('hide');
    // 「到过哪些地方」记在这儿，是**落地**不是「打算去」。
    // 歇脚处那份清单只列去过的地方 —— 判据在 stationList()，
    // 记在这儿是因为「到过」这件事只有落地那一刻才算数
    if (!S.vis || typeof S.vis !== 'object') S.vis = {};
    S.vis[m.id] = true;
    loadBg(m.bg);
    // 头一回落脚的地方各收一句。判定放在这里而不是出口那边 ——
    // 出口是「打算去」，落地才是「到了」。
    if (m.id === 'xushi') albumAdd('firstMarket');
    if (m.id === 'xipan') albumAdd('firstXipan');
    // 洞口那句在「落地」时给，不在「按 E 出门」时给 ——
    // 出门是打算，钻进来才是真的站在了洞口底下。
    if (m.id === 'houshan') albumAdd(FG.TAOYUAN.mouth);
    updateHUD();
  }
  FG.gotoMap = gotoMap;
  // 验收要核「人是不是站在判定圈里」。**不导出的话那条断言只能靠猜** ——
  // 而「触屏能不能说话」这个毛病，恰恰只在「站没站对地方」时才有区别
  FG.nearNpc = nearNpc;
  // 同上：触屏换图那条断言，判据是「人走到出口圈里了没有」。
  // 不导出的话只能从「图换了没有」倒推，而图没换可能是人没走到、
  // 也可能是点错了地方、还可能是出口判据本身坏了 —— 三样长得一模一样
  FG.nearExit = nearExit;

  /* 商店面板的点选：货是运行时拼的 HTML，所以用事件委托，
     拼的时候绑一次会对不上（openShop 每次重建）。 */
  window.addEventListener('DOMContentLoaded', function () {
    var box = document.getElementById('sh');
    var list = document.getElementById('sh-list');
    if (!box || !list) return;
    list.addEventListener('click', function (e) {
      var g = e.target.closest('.goods');
      if (g && !g.classList.contains('owned')) buy(g.getAttribute('data-k'));
    });
    document.getElementById('sh-x').onclick = function () { box.classList.add('hide'); };
  });

  /* ---------------- 初始化 ---------------- */
  function init() {
    cv = document.getElementById('game');
    cv.width = W; cv.height = H;
    x = cv.getContext('2d');

    bg = document.createElement('canvas');
    bg.width = W; bg.height = H;
    F.apply(curMap());
    S.plots = freshPlots();
    loadBg(curMap().bg);
    // 人物贴图：先预热，别等第一次画到那个人才去下载（会看见"人凭空冒出来"）
    I.loadFigs();

    /* 声音的第一道手续：浏览器不许自动播，AudioContext 建出来是 suspended，
       要等一次用户手势才醒。**挂在 window 上、且只解一次**。
       挂 canvas 不够 —— 开卷那个「入山」是 DOM 按钮，点它不会走到画布上，
       于是那一刻反而成了解锁的第一次机会，不能漏掉。
       少这一步的症状是：背景音乐选了曲、名字也定了，可一直不响。 */
    var unlockOnce = function () { FG.audio.unlock(); };
    window.addEventListener('pointerdown', unlockOnce, { once: true });
    window.addEventListener('keydown', unlockOnce, { once: true });

    bindInput();
    bindBag();
    bindStove();
    bindBin();
    bindChest();
    bindHouse();
    bindStation();
    layout();
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 120); });
    updateHUD();
    showTitle();
    last = now();
    raf = requestAnimationFrame(loop);
  }

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* 画布在窄屏会等比缩小，UI 那一层必须跟着缩到同样大小，
     否则 HUD 会飘到画面外面去（竖屏时尤其明显）。 */
  function layout() {
    var r = cv.getBoundingClientRect();
    var st = document.getElementById('stage');
    st.style.width = Math.round(r.width) + 'px';
    st.style.height = Math.round(r.height) + 'px';
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    var dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    tNow = t;
    if (S.started && !S.ended) step(dt);
    render();
  }
  // 雨丝要动，所以渲染得拿到时钟。存在外面而不是当参数一路传下去：
  // render() 已经是几十行的绘制流程，再加一个参数就得改所有调用点
  var tNow = 0;

  /* ---------------- 时间 ---------------- */
  function step(dt) {
    // MIN_PER_SEC 的单位是「真实 1 秒 = 游戏内多少分钟」，
    // 这里不能再乘 60 —— 乘了等于一天 17 秒就过完，玩家还没锄完两畦天就黑了。
    acc += dt * FG.MIN_PER_SEC;
    if (acc >= 1) {
      var add = Math.floor(acc);
      acc -= add;
      S.min += add;
      if (S.min >= FG.DAY.END) { S.min = FG.DAY.END; endDay(true); }
      if (Math.floor(S.min / 30) !== FG._lastShichen) { FG._lastShichen = Math.floor(S.min / 30); updateHUD(); }
      // 薄暮还在外头就收一句。去重交给 albumAdd，这里不用另记标志
      if (FG.SHEN(S.min) === '薄暮') albumAdd('duskOut');
    }
    movePlayer(dt);
    stepFishing(dt);
    /* 背景音乐：换图和时辰推进都靠**这一处**。
       散在 gotoMap / startDay 里各调一次的话，漏一处就有一段路没曲子 ——
       而「漏了」不会报错，只是安静，验收里也就看不出来。

       **一秒一次，不是每帧。** pick 会走到 mset，mset 里 ensure() 会对
       suspended 的 ctx 调 resume()，每帧调一次就是每帧攒一个未处理的
       Promise。mset 同曲早退很便宜，但 ensure 不是。 */
    if (!FG.audio.muted) {
      musicT -= dt;
      if (musicT <= 0) { musicT = 1; FG.audio.music.pick(S.map, S.min); }
    }
  }

  function movePlayer(dt) {
    var p = S.player, vx = 0, vy = 0;
    var k = FG.input;
    if (k.key('left')) vx -= 1;
    if (k.key('right')) vx += 1;
    if (k.key('up')) vy -= 1;
    if (k.key('down')) vy += 1;

    // 点空地走过去（触摸端没有方向键，靠这个）
    if (S.walkTo) {
      var dx = S.walkTo[0] - p.x, dy = S.walkTo[1] - p.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 12) {
        S.walkTo = null;
        // 走到了，做那件事。**触屏那一下的尾巴就在这里** ——
        // 原来到这儿就结束了，人站在门口、站在人旁边，而没人再管：
        // 触屏上于是只有走路和锄地，说不了话、出不了门、回不了家。
        // FG.interact 是 bindInput 挂出来的（init 里就绑好了，所以这里早就有），
        // 判据跟键完全共用一份 —— 两边写法一旦分叉，触屏就会跟键对不上
        if (S.touchGo) { S.touchGo = false; if (FG.interact) FG.interact(); }
      }
      else { vx = dx / d; vy = dy / d; }
    }

    var m = Math.sqrt(vx * vx + vy * vy);
    if (m > 0.01) {
      vx /= m; vy /= m;
      var sp = 210;
      p.x += vx * sp * dt;
      p.y += vy * sp * dt;
      p.face = vx < -0.3 ? 1 : (vx > 0.3 ? 2 : 0);
      p.walk += dt * 7;
    } else {
      p.walk = 0;
    }
    // 可走范围逐图不同：南山山在画上边，墟市是市集的空地
    var b = curMap().bounds;
    if (p.x < b.x0) p.x = b.x0;
    if (p.x > b.x1) p.x = b.x1;
    if (p.y < b.y0) p.y = b.y0;
    if (p.y > b.y1) p.y = b.y1;
    // bounds 只是**一个大矩形**，山、屋、竹子都在这个矩形里面 ——
    // 只靠它，人能一路走到山腰上站着（实测站到了茅屋顶上）。
    // 再按 blocks 推出去，四个方向里挑最近的一条边出去
    if (pushOut(p)) {
      // 刚被推出去，walkTo 的目标多半还在块里 —— 留着的话人会顶着边一直抖，
      // 因为到达判据是「离目标 12px 内」，而那块地方永远走不到
      if (S.walkTo && inBlock(curMap(), S.walkTo[0], S.walkTo[1])) {
        S.walkTo = clampWalk(S.walkTo[0], S.walkTo[1]);
      }
    }
  }

  /* ---------------- 不可走的几块 ----------------
     bounds 拦不住「矩形里的山和屋」。这两支一个判「在不在块里」、
     一个把人推出去，推的方向取四条边里最近的一条。

     **blocks 里的点必须跟这张图上所有判定点核对过** ——
     挡掉一个交互点，那个功能就再也够不着了，而且症状是
     「提示行说该在这儿按 E，可我站过去了没反应」。 */
  function inBlock(m, x, y) {
    var bs = m.blocks;
    if (!bs) return false;
    for (var i = 0; i < bs.length; i++) {
      var q = bs[i];
      if (x > q[0] && x < q[2] && y > q[1] && y < q[3]) return true;
    }
    return false;
  }
  function pushOut(p) {
    var m = curMap();
    var bs = m.blocks;
    if (!bs) return false;
    var moved = false, i, j, q;
    for (i = 0; i < bs.length; i++) {
      q = bs[i];
      if (!(p.x > q[0] && p.x < q[2] && p.y > q[1] && p.y < q[3])) continue;
      var cand = [[q[0] - 2, p.y], [q[2] + 2, p.y], [p.x, q[1] - 2], [p.x, q[3] + 2]];
      var best = null, bd = 1e9;
      for (j = 0; j < 4; j++) {
        // **候选点本身也得能站。** 只按「离哪条边近」挑的话，
        // 会挑到另一块里去 —— 茅屋屋顶上往下推 2px 就进了山脊那块
        // （y 390 < 392），人看着被推出来了，其实在另一块里面站着。
        // 症状是人卡在两块之间的缝里，一下一下地弹
        if (inBlock(m, cand[j][0], cand[j][1])) continue;
        var dd = Math.abs(cand[j][0] - p.x) + Math.abs(cand[j][1] - p.y);
        if (dd < bd) { bd = dd; best = cand[j]; }
      }
      // 四条边都被别块占了：往 bounds 收一收，交给下一帧再试
      if (!best) { best = [p.x, q[3] + 2]; }
      p.x = best[0]; p.y = best[1];
      moved = true;
    }
    return moved;
  }
  /* 点一个走不到的地方时，人该走到**最近的那个能站的地方**，
     而不是顶着边界原地抖（抖起来人一直在动，看着像卡住了）。 */
  function clampWalk(x, y) {
    var m = curMap();
    var guard = 0;
    while (inBlock(m, x, y) && guard++ < 8) {
      var bs = m.blocks, best = null, bd = 1e9;
      for (var i = 0; i < bs.length; i++) {
        var q = bs[i];
        if (!(x > q[0] && x < q[2] && y > q[1] && y < q[3])) continue;
        var cand = [[q[0] - 2, y], [q[2] + 2, y], [x, q[1] - 2], [x, q[3] + 2]];
        for (var j = 0; j < 4; j++) {
          if (inBlock(m, cand[j][0], cand[j][1])) continue;
          var dd = Math.abs(cand[j][0] - x) + Math.abs(cand[j][1] - y);
          if (dd < bd) { bd = dd; best = cand[j]; }
        }
      }
      if (!best) break;
      x = best[0]; y = best[1];
    }
    var b = m.bounds;
    if (x < b.x0) x = b.x0; if (x > b.x1) x = b.x1;
    if (y < b.y0) y = b.y0; if (y > b.y1) y = b.y1;
    return [x, y];
  }
  FG.inBlock = inBlock;

  /* ---------------- 交互 ---------------- */
  // 镐不是种子：它在 TOOLS 里占第八格（数字键 8），但它不是一包能点着种的东西
  function toolIsSeed(sel) { return sel !== 'chu' && sel !== 'piao' && sel !== 'jue'; }
  function inMine() { return S.map === 'shidong'; }

  function totalInit() {
    S.total = { till: 0, catch: 0, rock: 0 };
    S.quest = {};
  }
  // 老存档没有这两本账。同 skillFix：不补的话读档玩家看着像是
  // 一辈子没翻过一畦地，而那不是「回到旧版」，是存档坏了
  function questFix() {
    if (!S.quest) S.quest = {};
    if (!S.total) S.total = { till: 0, catch: 0, rock: 0 };
    var i, k;
    for (i = 0; i < FG.QUESTS.length; i++) {
      k = FG.QUESTS[i].id;
      if (S.quest[k] !== 'given' && S.quest[k] !== 'done') delete S.quest[k];
    }
  }
  function totalAdd(k, n) { if (!S.total) totalInit(); S.total[k] = (S.total[k] || 0) + n; }

  /* ---------------- 生辰 ----------------
     一年一回：那天站在那个人跟前按 E，他给你一样种子。
     判据全在 birthTurn —— 「今天是不是他生日」「今年给过没有」两句话
     都得从它这儿出，提示行、对话、送礼三处各写一遍就会有一处先过期。

     「给过没有」记的是**年**不是日子：记日子的话，
     过了年第一天碰见他就会以为「今天已经给过了」而什么也不发生。 */
  function birthFix() { if (!S.birth) S.birth = {}; }
  function birthToday(id) {
    var b = FG.BIRTH[id];
    return !!b && FG.dayOfYear(S.day) === b.d;
  }
  function birthDone(id) {
    birthFix();
    return S.birth[id] === FG.yearOf(S.day);
  }
  // 今天过生辰的那几个（站得近、还没给过礼的那些才会被提示行点到）
  function birthTurn(id) {
    return birthToday(id) && !birthDone(id);
  }
  // 快到了（还没到）。门槛 BIRTH_SOON，见它上面那段
  function birthSoon(id) {
    if (!FG.BIRTH[id] || birthTurn(id)) return false;
    var d = birthIn(id);
    return d > 0 && d <= BIRTH_SOON;
  }
  // 离他生日还有几天。已经过了就往回数到明年，别报一个负数
  function birthIn(id) {
    var b = FG.BIRTH[id];
    if (!b) return -1;
    var t = FG.dayOfYear(S.day);
    return b.d >= t ? (b.d - t) : (FG.SOLAR_YEAR - t + b.d);
  }
  // 「快到了」的门槛。**不是 30 天，也不是一直说**：
  // 每三次对话就插一句「我快过生日了」，七个 NPC 一年轮下来，
  // 玩家听到的「白话闲话」比陶诗还多，而那三句才是这个游戏的心。
  // 七天够走一趟路（墟市 → 南山 / 溪畔，一天的事），
  // 也够他安排哪天去 —— 再长就成了日历，而日历是玩家自己排的事
  var BIRTH_SOON = 7;

  /* ---------------- 见闻（图鉴） ----------------
     认出一味就记一笔：见过几回、头一回是第几天。
     记口只有四处 —— 钓上一尾、采下一把、敲开一块石、狗叼回来一样。
     **不挂在 invGive 上**：出货箱来回搬也走那儿，搬一次记一次，
     于是「放进箱子再拿回来」就把见闻刷上去了，而那不是「你见到了它」。
     铺/坛出来的是加工品（made），不算「见到一味」——
     酸菜不算你对山里那一茬有了认识，它是你自己攒出来的。 */
  function dexFix() {
    if (!S.dex) S.dex = { good: {}, fish: {}, ore: {} };
    var g = ['good', 'fish', 'ore'], i;
    for (i = 0; i < g.length; i++) if (!S.dex[g[i]]) S.dex[g[i]] = {};
  }
  function dexAdd(cat, id) {
    dexFix();
    var d = S.dex[cat][id];
    if (!d) { S.dex[cat][id] = { n: 1, first: S.day }; return true; }
    d.n++;
    return false;
  }
  // 见过的种数。判据写在一处，面板和页签都读它
  function dexCount(cat) {
    dexFix();
    var o = S.dex[cat], n = 0, k;
    for (k in o) n++;
    return n;
  }
  // 山里一共多少种（表上数，不是在册子上数）
  function dexAll() {
    var n = 0, i, t;
    for (i = 0; i < FG.DEX.length; i++) { t = FG[FG.DEX[i].src] || {}; for (var k in t) n++; }
    return n;
  }
  /* 挂架上挂哪几样。**没认出的味不占格** —— 跟「见闻」那一页同一条规矩：
     排一格空位是待办清单，墙上摆一排空格子只会让人以为欠了谁。 */
  function dexWallList() {
    dexFix();
    var out = [], i, k, t, d;
    for (i = 0; i < FG.DEX.length; i++) {
      var cat = FG.DEX[i].cat;
      t = FG[FG.DEX[i].src] || {};
      for (k in t) {
        d = S.dex[cat][k];
        if (!d) continue;
        // key 用 BAG 那一支的（'fish_xia' / 'good_mei' / 'ore_shi'），
        // I.icon 认的是这个 —— 传裸 id 它会掉进种子袋的兜底分支
        out.push({ k: cat + '_' + k, name: t[k].name, d: d });
      }
    }
    return out;
  }
  /* 把挂架画出来。图标是**认出的那一味自己的**那个图，不是文字 ——
     「见过菱角」是一行字，「看见菱角」才叫陈列。 */
  function drawWall() {
    var cv = document.getElementById('wl-cv');
    if (!cv) return 0;
    var list = dexWallList(), c = cv.getContext('2d');
    var COLS = 6, CW = 84, CH = 106, i, x, y;
    var rows = Math.max(1, Math.ceil(list.length / COLS));
    cv.width = COLS * CW; cv.height = rows * CH;
    c.clearRect(0, 0, cv.width, cv.height);
    for (i = 0; i < list.length; i++) {
      x = (i % COLS) * CW; y = Math.floor(i / COLS) * CH;
      // 格：淡底 + 细边，跟行囊那套一个路子
      c.fillStyle = 'rgba(214,196,160,0.32)';
      c.fillRect(x + 7, y + 7, CW - 14, CH - 16);
      c.strokeStyle = 'rgba(120,100,70,0.32)'; c.lineWidth = 1;
      c.strokeRect(x + 7.5, y + 7.5, CW - 15, CH - 17);
      I.icon(c, list[i].k, x + CW / 2, y + CH * 0.38, (CW - 10) * 1.02);
      c.fillStyle = 'rgba(60,50,38,.88)';
      c.font = '15px "Songti SC","SimSun",serif';
      c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText(list[i].name, x + CW / 2, y + CH - 9);
    }
    return list.length;
  }

  /* 这条托付办到了没有。两种写法，判据只有一处，
     别在 talk / 交任务 / 面板上各写一遍 —— 写三遍就会有一遍先过期。 */
  function questProgress(q) {
    questFix();
    var need = q.need;
    if (need.total) return { have: S.total[need.total] || 0, n: need.n, done: (S.total[need.total] || 0) >= need.n };
    return { have: invGet(need.give), n: need.n, done: invGet(need.give) >= need.n };
  }
  function questOf(npcId) {
    questFix();
    for (var i = 0; i < FG.QUESTS.length; i++) {
      if (FG.QUESTS[i].from === npcId && S.quest[FG.QUESTS[i].id] !== 'done') return FG.QUESTS[i];
    }
    return null;
  }
  // 这个人这一条是不是**够得着**：有的地方一看就知道做不成
  // （要下硐而手上没镐、要下水而采还没到四级），说出来比让人白跑一趟强
  function questLocked(q) {
    if (q.need.total) {
      // 累计类的门槛是「你得先动过手」。一件都没做过就托你翻二十畦，
      // 听着像派活儿，不如直说
      if (q.need.total === 'till' && (S.total.till || 0) === 0) return q.lock;
      if (q.need.total === 'catch' && (S.total.catch || 0) === 0) return q.lock;
      if (q.need.total === 'rock' && (S.total.rock || 0) === 0) return q.lock;
    }
    if (q.need.give === 'ore_tong' && S.gear.jue <= 0) return '硐在墟市后头那道坡的脚下。你还没有镐，淘不成铜。';
    if (q.need.give === 'good_xing' && !hasSkill('cai', 4)) return '荇菜长在水中央，岸上站着够不着。采这一门到四级才下得去。';
    return '';
  }
  function giveQuest(q) {
    if (!q || S.quest[q.id]) return false;
    S.quest[q.id] = 'given';
    save();
    return true;
  }
  function turnInQuest(q) {
    if (!q || S.quest[q.id] !== 'given' || !questProgress(q).done) return false;
    if (q.need.give) invTake(q.need.give, q.need.n);
    S.quest[q.id] = 'done';
    var n = FG.NPCS[q.from];
    if (n) {
      S.favor[q.from] = (S.favor[q.from] || 0) + 1;
      // 办成一件托付抵四分：这是最重的一笔人情，
      // 但**不加那一档的礼** —— 礼是说话和递酒慢慢换来的，
      // 办成事就给礼的话，人情就成了任务奖励
      renAdd(q.from, FG.REN_QUEST);
    }
    save();
    updateHUD();
    return true;
  }

  /* ---------------- 天气 ----------------
     一天一个，定在早上那一下。老存档没有这一项，补成今天的那个 ——
     不补的话读档玩家抬头看不见天气，而下雨那天早上田已经湿了，
     两件事对不上，看着像「不知道什么时候下的雨」。 */
  function weatherFix() {
    if (!S.weather || !FG.WEATHER[S.weather]) S.weather = FG.weatherOf(S.day);
  }
  function isWet() { weatherFix(); return FG.wetWeather(S.weather); }
  function isSnow() { weatherFix(); return FG.snowy(S.weather); }
  // 雷雨天硐里待不住。这不是「硐里淋不到雨」那种想当然的推理 ——
  // 雷劈的是山头，硐口在坡底，进去的人自己说不敢下
  function mineShut() { weatherFix(); return S.weather === 'storm'; }
  // 雨天地里那一畦全湿了。跟水渠走的是同一条路：只浇翻过的地，
  // 没翻的浇了它明早照样种不上去，而畦上挂着水看着像「已经浇过了」
  function rainWater() {
    var n = 0, r, c;
    for (r = 0; r < S.plots.length; r++) {
      for (c = 0; c < S.plots[r].length; c++) {
        if (S.plots[r][c].tilled && !S.plots[r][c].wet) { S.plots[r][c].wet = true; n++; }
      }
    }
    return n;
  }

  /* ---------------- 节日 ----------------
     一年六个，都挂在节气里本来的大日子上。跟 8/9 那些托付是同一个骨架：
     挨个走过去、说上话、才收下那样东西。差别是托付有活要干，这个不用。 */
  function festInit() { S.fest = { said: {}, got: [] }; }
  function festFix() {
    if (!S.fest || typeof S.fest !== 'object') S.fest = { said: {}, got: [] };
    if (!S.fest.said || typeof S.fest.said !== 'object') S.fest.said = {};
    if (!S.fest.got || !S.fest.got.length) S.fest.got = [];
  }
  // 今天过不过节。d 是「这个节气里的第几天」，六个节日都摆在第一天，
  // 一年里就有这么六天，稀稀落落的才对；天天过节等于不过节。
  // 判「节气里的第几天」要按**日子**算：`(day-1) % SOLAR_DAYS + 1`。
  // 拿 solarIdx(day) 取模是错的 —— 那是节气序号（0..23），
  // 立春=0、立夏=6、立秋=12、立冬=18 取模都是 0，
  // 于是只有这四个日子碰巧算得出来，而它们根本不是节日
  function festivalOn(day) {
    var sol = FG.solarOf(day);
    var within = (day - 1) % FG.SOLAR_DAYS + 1;
    for (var i = 0; i < FG.FESTIVAL.length; i++) {
      var f = FG.FESTIVAL[i];
      if (f.solar === sol.k && f.d === within) return f;
    }
    return null;
  }
  // 节日里这个人站哪儿。位置查一处就够了 —— 画和判定都走它，
  // 各写一份的话，某天只改了一半，站在画上的人和判定点就对不上了
  function npcAt(n) {
    if (S.map !== 'xushi') return n.at;
    var f = festivalOn(S.day);
    if (f && FG.FEST_SPOTS[n.id]) return FG.FEST_SPOTS[n.id];
    return n.at;
  }

  /* ---------------- 邻居几点回家 ----------------
     带月之后街上没人了。**不是把人藏起来** —— 人还在那儿，
     是不画了；而站在他那个位置按 E 要回一句话，
     不然玩家会以为这个 NPC 坏了（这游戏里暗着的东西都得回一句话）。

     今天是他生辰的话**他不走** —— 他在等你。
     这一条不是额外照顾，是他今天本来就不该收摊关门；
     顺带也免掉「生辰那天晚上赶过去扑个空」这种最气人的事。 */
  function npcGone(n) {
    if (!FG.isNight(S.min)) return false;
    if (birthTurn(n.id)) return false;        // 他在等你
    // 节庆那天广场上的人不走：一年就聚这么一次，散了就没了
    if (S.map === 'xushi' && festivalOn(S.day) && FG.FEST_SPOTS[n.id]) return false;
    return true;
  }
  function mapNpcsOut() {
    var l = mapNpcs(), out = [], i;
    for (i = 0; i < l.length; i++) if (!npcGone(l[i])) out.push(l[i]);
    return out;
  }
  // 今天聚在墟市上的那几个人
  function festCrowd(f) {
    var out = [], ids = curMap().npcs, i, n;
    for (i = 0; i < ids.length; i++) {
      n = FG.NPCS[ids[i]];
      if (n && FG.FEST_SPOTS[n.id]) out.push(n);
    }
    return out;
  }
  function festSaid(n) { festFix(); return S.fest.said[n.id] === S.day; }
  function festLeft(f) {
    var c = festCrowd(f), n = 0, i;
    for (i = 0; i < c.length; i++) if (!festSaid(c[i])) n++;
    return n;
  }
  function festGot(f) { festFix(); return S.fest.got.indexOf(f.k) >= 0; }

  function festTalk(n) {
    var f = festivalOn(S.day);
    if (!f || S.map !== f.map) { toast('今天不过节。'); return false; }
    if (festSaid(n)) { toast(n.name + '这会儿没什么可说的了。'); return false; }
    S.fest.said[n.id] = S.day;
    // **每个人一句**。原来只写一句 line，四个人说出来一模一样，
    // 看着像这段对话是复制粘贴的
    var ln = (f.lines && f.lines[n.id]) || f.lines && Object.keys(f.lines)[0] || '';
    toast(n.name + '：' + ln, 4600);
    var left = festLeft(f);
    if (left > 0) {
      // 还差几个人就明说。剩下的人站在广场另一头，
      // 不说清楚的话玩家会以为这个节日就这么一句
      save();
      setTimeout(function () { rewardPush(f.name, ['还差 ' + left + ' 位']); }, 4800);
      return true;
    }
    if (!festGot(f)) {
      S.fest.got.push(f.k);
      invGive(f.gift.k, f.gift.n);
      save(); updateHUD();
      rewardPush(f.name, ['得了' + f.giftName]);
    } else {
      rewardPush(f.name, ['都说过一遍了']);
    }
    return true;
  }

  /* ---------------- 营造 ----------------
     立在地上的东西：鸡舍、水渠。不占器物架也不占键位（那是器物的事），
     走到跟前按 E 才管得着。按图找，跟 NPC / 钓点一个道理 ——
     全局找的话，站在墟市能隔空捡走南山的蛋。 */
  // 每一项都摆成 0，不留空对象。空对象的话 S.build.coop 是 undefined，
  // 于是「造了没有」得写成 `!S.build.coop`，而 `S.build.coop === 0` 是假的 ——
  // 看着像没造，判据上却是另一回事
  function buildInit() {
    var o = {}, i;
    for (i = 0; i < FG.BUILD_LV.length; i++) o[FG.BUILD_LV[i]] = 0;
    S.build = o;
    S.mach = { lv: {}, job: {} };
    // 棚：每样一头 { gate 门, feed 粮够几天, got 堆着几份 }。
    // 摆空对象、各样自己填 0 —— 跟 machlv 一个路子
    S.keep = {};
    for (var ki = 0; ki < FG.KEEP_LV.length; ki++) S.keep[FG.KEEP_LV[ki]] = { gate: 0, feed: 0, got: 0 };
    // 狗那一本账单独摆 —— 它不进 S.keep，因为没有门也没有草料
    dogFix();
    furnInit();
    roadInit();
    // 「到过哪些地方」也一起清。不清的话重开之后歇脚处的清单上
    // 留着上一世的墟市和溪畔 —— 而新局第一天的路才刚修到第一级
    S.vis = {};
    // 开新局和重开都走这里。天得在这儿定，不能等 startDay ——
    // startDay(true) 是静默启动，而「静默」只挡年结和日常结算，
    // 天气是这一天本来就知道的事，第一天就得摆出来
    S.weather = FG.weatherOf(S.day);
  }
  // 老存档里没有这一本账。不补的话读档玩家看见鸡舍还在，蛋却永远下不出来
  function buildFix() {
    if (!S.build) S.build = {};
    var i, k, v;
    for (i = 0; i < FG.BUILD_LV.length; i++) {
      k = FG.BUILD_LV[i]; v = S.build[k] || 0;
      // 越界当没有。存档被手改过的话 lv=7 会去读 lv[6].eggs，
      // 读出来是 undefined，蛋就一天天下成 NaN —— 而那看着像「鸡不下蛋」
      if (v < 0 || v > FG.BUILD[k].lv.length) v = 0;
      S.build[k] = v;
    }

  }
  /* 家具：茅舍这一片的三样。跟营造一样摆成 0，不留空对象 ——
     留空对象的话 S.furn.chufang 是 undefined，「买没买」得写成
     `!S.furn.chufang`，而 `S.furn.chufang === 0` 是假的 */
  function furnInit() {
    var o = {}, i;
    for (i = 0; i < FG.FURN_LV.length; i++) o[FG.FURN_LV[i]] = 0;
    S.furn = o;
    bagFit();
  }
  // 老存档里没有这一本账。不补的话读档玩家看见行囊只有 6 行、
  // 而货单上明明有「带架的仓房」，那看着像存档坏了
  function furnFix() {
    if (!S.furn || typeof S.furn !== 'object') furnInit();
    var i, k, v;
    for (i = 0; i < FG.FURN_LV.length; i++) {
      k = FG.FURN_LV[i]; v = S.furn[k] || 0;
      if (v < 0 || v > FG.FURN[k].lv.length) v = 0;
      S.furn[k] = v;
    }
    bagFit();
  }
  /* 提示行用的那一次判定：认**所有**营造，不只认有 E 的。
     跟 nearBuild 分开是必须的 —— nearBuild 是「按 E 归谁」的判据，
     混进水渠、温窒这些没有 E 的东西，那一句就变成「按 E 开温窒」，
     而按下去什么也不会发生。站着看不见的东西不用非得看见，
     但**站着看见的东西不能一声不吭**：新造的温窒、水渠都靠这一条
     告诉玩家「这儿本来能造什么」。 */
  function nearBuildHint() {
    var list = buildList(), best = null, bd = 1e9, i, d;
    for (i = 0; i < list.length; i++) {
      d = Math.abs(list[i].def.at[0] - S.player.x) + Math.abs(list[i].def.at[1] - S.player.y);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return (best && bd <= best.def.r) ? best : null;
  }
  // 站着看得见却没有 E 的那几样，提示行该写什么。
  // **不能一律写「这儿空着」** —— 造好了再说「这儿空着」是骗人
  function buildIdleWord(b) {
    if (b.id === 'warm') {
      return S.build.warm ? '温窒　·　屋里不冷　·　地不认节气'
                          : '这儿空着　·　墟市老丈那儿有温窒卖';
    }
    if (b.id === 'ditch') {
      var lv = FG.BUILD.ditch.lv[(S.build.ditch || 1) - 1];
      return S.build.ditch ? ('水渠通了　·　每天早起浇着 ' + lv.rows + ' 行')
                          : '这儿空着　·　墟市老丈那儿有水渠卖';
    }
    return '这儿空着　·　墟市老丈那儿有' + b.def.name + '卖';
  }
  // 造到了第几级。0 = 还没造。没有就当没造 —— 别返回 lv[0]，
  // 那会让「灶间一口」在没买灶间的时候也生效
  function furnLv(id) { furnFix(); return S.furn[id] || 0; }
  // 这一级给的是几口。读的是 lv 上写的那个数，不在别处再抄一遍
  function furnNum(id, field) {
    var lv = furnLv(id);
    return lv > 0 ? (FG.FURN[id].lv[lv - 1][field] || 0) : 0;
  }

  /* 屋里。**星露谷那个农舍的原样搬法**：门口按 E 进屋，屋里四行 ——
     灶 / 木箱 / 诗册 / 床，归家（歇了）从「床」那一行走。

     为什么非加这一层：三件家具原先**一个 E 点都没有**。
     门口那个圈（homeR 210）里已经塞着灶、木箱、归家三个判定点，
     再往里塞第四个，提示行就只写得下一句、站着按 E 的归属也会变糊。
     于是家具买下只在别的场合里生效（灶几口、箱几页、墙上几联）——
     玩家在墟市面板上买下一间房，回家摸不到它，
     而「家里多了什么」这件事在他脑子里没有一个落点。

     屋里这四行**每一行都念得出家具给的那几样**：灶行写几口灶、
     箱行写几页、诗册行写墙上几联。买没买一眼就看得出来。 */
  function houseRows() {
    furnFix(); chestFix();
    var cap = cookCap(), can = cookable(), out = [];
    out.push({
      k: 'stove', name: '灶',
      sub: furnLv('chufang') ? (cap + ' 口灶') : '廊下一口',
      tip: (S.cookN < cap && can.length)
        ? ('今天还能做 ' + (cap - S.cookN) + ' / ' + cap + ' 口　·　' + can.map(function (r) { return r.name; }).join('、'))
        : (S.cookN < cap ? '手上没有能做的' : '今天 ' + cap + ' 口都做完了'),
      on: S.cookN < cap && can.length > 0,
      off: S.cookN >= cap ? '今天做完了 —— 明早再来' : '手上没有凑齐的料',
      go: function () { closeHouse(); openStove(); }
    });
    var cn = chestCount();
    out.push({
      k: 'chest', name: '木箱',
      sub: furnLv('cangfang') ? (chestTabs() + ' 页') : '廊下一只',
      tip: cn ? ('里面搁着 ' + cn + ' 件') : '空的',
      on: true,
      go: function () { closeHouse(); openChest(); }
    });
    var wall = furnLv('dongxuan') > 0, lit = 0, a;
    for (a in S.album) if (S.album[a]) lit++;
    out.push({
      k: 'album', name: '诗 册',
      sub: wall ? '东轩' : '东边那间',
      tip: wall
        ? ('墙上 ' + lit + ' 联　·　' + FG.ALBUM.length + ' 句一共')
        : '还堆着杂物，没腾出来',
      on: wall,
      off: '那间还没收拾出来。墟市老丈那儿有东轩。',
      go: function () { closeHouse(); setAlPage('wall'); openAlbum(); }
    });
    out.push({
      k: 'bed', name: '床',
      sub: '歇了',
      tip: '明早再说　·　带月荷锄归',
      on: true,
      go: function () { closeHouse(); endDay(false); }
    });
    return out;
  }
  function openHouse() {
    var host = document.getElementById('hs-list');
    var rows = houseRows();
    host.innerHTML = rows.map(function (r) {
      return '<div class="hsr' + (r.on ? '' : ' off') + '" data-k="' + r.k + '"><b>' + r.name + '</b>' +
        '<i>' + r.sub + '</i><s>' + r.tip + '</s>' + (r.on ? '' : '　<u>点不动</u>') + '</div>';
    }).join('');
    document.getElementById('hs').classList.remove('hide');
  }
  function closeHouse() { document.getElementById('hs').classList.add('hide'); }
  function houseOpen() { return !document.getElementById('hs').classList.contains('hide'); }
  function bindHouse() {
    document.getElementById('hs-list').addEventListener('click', function (e) {
      var g = e.target.closest('.hsr');
      if (!g) return;
      var rows = houseRows(), k = g.getAttribute('data-k'), r = null, i;
      for (i = 0; i < rows.length; i++) if (rows[i].k === k) r = rows[i];
      if (!r) return;
      // 暗着的行也要回一句话。**静悄悄地什么都不发生**的话，
      // 玩家会以为这一格是坏的，而不是「今天灶做完了」
      if (!r.on) { toast(r.off || '今天不成。', 2600); return; }
      r.go();
    });
    document.getElementById('hs-x').onclick = function () { closeHouse(); };
    var box = document.getElementById('hs');
    box.addEventListener('mousedown', function (e) { if (e.target === box) closeHouse(); });
  }

  /* 歇脚处的路。判据全从表上读：**能通几段就是 lv 上写的那个数**，
     段是 FG.ROADS 的前几条。写成「哪些图两两相连」的一张无序表不行 ——
     那样「一级通到哪儿」就没有一个写在表上的数了 */
  function roadInit() {
    var o = {}, i;
    for (i = 0; i < FG.ROAD_LV.length; i++) o[FG.ROAD_LV[i]] = 0;
    S.road = o;
  }
  function roadFix() {
    if (!S.road || typeof S.road !== 'object') roadInit();
    var i, k, v;
    for (i = 0; i < FG.ROAD_LV.length; i++) {
      k = FG.ROAD_LV[i]; v = S.road[k] || 0;
      if (v < 0 || v > FG.ROAD[k].lv.length) v = 0;
      S.road[k] = v;
    }
  }
  function roadLv(id) { roadFix(); return S.road[id] || 0; }
  // 现在能通几段路。没修路就是 0
  function roadLegs() {
    var lv = roadLv('cundao');
    return lv > 0 ? (FG.ROAD.cundao.lv[lv - 1].legs || 0) : 0;
  }
  // 站着的这张图有没有歇脚处
  function stationOf(id) {
    var m = FG.MAPS[id || S.map];
    return (m && m.station) ? m : null;
  }
  function nearStation() {
    var m = stationOf();
    if (!m) return null;
    var d = Math.abs(m.station[0] - S.player.x) + Math.abs(m.station[1] - S.player.y);
    return d <= SPOT_R.station ? m : null;
  }
  /* 清单上能去的地方。**只列去过的**（S.vis），而且只列路通着的那些 ——
     「没去过也能选」等于把石板道变成跳过找硐口的传送门 */
  function stationList() {
    var out = [], legs = roadLegs(), i, p, a, b;
    if (!legs) return out;
    for (i = 0; i < legs && i < FG.ROADS.length; i++) {
      p = FG.ROADS[i];
      // 一段路是双向的：正着反着都要列出来
      if (p[0] === S.map && S.vis[p[1]]) { b = FG.MAPS[p[1]]; out.push({ to: p[1], name: b.stationName, map: b }); }
      if (p[1] === S.map && S.vis[p[0]]) { a = FG.MAPS[p[0]]; out.push({ to: p[0], name: a.stationName, map: a }); }
    }
    return out;
  }
  function openStation() {
    var box = document.getElementById('rd');
    var host = document.getElementById('rd-list');
    var l = stationList();
    roadFix();
    document.getElementById('rd-name').textContent = (stationOf() ? stationOf().stationName : '') + '的歇脚处';
    host.innerHTML = l.length ? l.map(function (d) {
      return '<div class="rdg" data-to="' + d.to + '"><b>' + d.name + '</b>　<i>' + d.map.name +
        '</i>　<u>点一下就走</u></div>';
    }).join('')
      : '<div class="bxnone">' + (roadLegs() ? '这几处都还没走过' : '还没修路。墟市老丈那儿有村道。') + '</div>';
    box.classList.remove('hide');
  }
  function closeStation() { document.getElementById('rd').classList.add('hide'); }
  function stationOpen() { return !document.getElementById('rd').classList.contains('hide'); }
  function bindStation() {
    var host = document.getElementById('rd-list');
    host.addEventListener('click', function (e) {
      var g = e.target.closest('.rdg');
      if (!g) return;
      var to = g.getAttribute('data-to'), m = FG.MAPS[to];
      if (!m || !m.station) return;
      closeStation();
      // 落在那边的歇脚处**旁边**而不是正中间：正中间的话人站在碑上，
      // 而那块碑是拿来按 E 的
      gotoMap(to, [m.station[0], m.station[1] + 46]);
      toast('到了' + m.stationName + '。', 1800);
      save();
    });
    document.getElementById('rd-x').onclick = function () { closeStation(); };
    var box = document.getElementById('rd');
    box.addEventListener('mousedown', function (e) { if (e.target === box) closeStation(); });
  }
  /* 买下之后那一句该怎么说。**从表上拼，不按 id 写死** ——
     写死的话加了第四件家具，那一句就会说错是哪一件 */
  function furnEffect(id, lv) {
    var d = FG.FURN[id].lv, i = lv || 1;
    var l = d[i - 1] || {}, p = d[i - 2] || {}, n = [];
    if (l.cook) n.push('灶上一天能做 ' + l.cook + ' 样');
    if (l.tabs) n.push('木箱分成 ' + l.tabs + ' 页');
    // 「多一行」要跟**上一级比**，不能跟现在的行数比：
    // 买下的那一瞬间 FG.BAG_ROWS 已经调上去了，拿它当基准永远比不出来，
    // 于是「带架的仓房」买回来什么也没说 —— 而它是明明白白给了行囊的
    if (l.bag && p.bag && l.bag > p.bag) n.push('行囊多一行');
    if (l.wall) n.push(l.wall > 1 ? '诗册上墙，没点上的留空格' : '诗册上墙');
    return n.join('　·　') + '。';
  }
  function buildList() {
    var m = curMap(), out = [], i;
    if (!m.builds) return out;
    for (i = 0; i < m.builds.length; i++) out.push({ id: m.builds[i], def: FG.BUILD[m.builds[i]] });
    return out;
  }
  /* 温窒建了没有。藏季那条封冻的规矩就收在这里 ——
     FG.groundFrozen 是纯函数（只看日子），它不该知道玩家买了什么；
     要知道的是 game.js 这一侧，所以判据放在这一侧，
     提示里也读同一个数，别在别处再抄一遍 */
  function warmOn() { buildFix(); return (S.build.warm || 0) > 0; }
  // 眼下这块地冻不冻。温窒建了就不冻
  function groundFrozenNow() { return FG.groundFrozen(S.day) && !warmOn(); }
  // 只有「按 E 真有事可做」的那几样才占判定点。水渠是纯被动的，
  // 一天也不该让玩家多走一趟去按一个什么都不会发生的东西
  function nearBuild() {
    var list = buildList(), best = null, bd = 1e9, i, d;
    for (i = 0; i < list.length; i++) {
      if (!list[i].def.act) continue;
      d = Math.abs(list[i].def.at[0] - S.player.x) + Math.abs(list[i].def.at[1] - S.player.y);
      if (d < bd) { bd = d; best = list[i]; }
    }
    // 半径读的是表上那个 r，不在别处再抄一份：两处营造挨太近的时候，
    // E 归谁看的就是它，验收也得照着真的半径算
    return (best && bd <= best.def.r) ? best : null;
  }
  // 没造的时候画出来的是「这里可以造」的那一小块（几根木桩），
  // 按 1 级那份尺寸画 —— 造起来之后要一眼看得出是同一块地方长出了东西
  function buildUnit(id) {
    var lv = (S.build[id] || 0);
    return FG.BUILD[id].lv[lv > 0 ? lv - 1 : 0].unit;
  }
  // 每天早上水渠把渠道那几行浇上。**只浇翻过的**：没翻的地本来就不该是湿的，
  // 浇了它明早照样种不上去，而畦上挂着水看着像「已经浇过了」
  function ditchWater(rows) {
    var n = 0, r, c;
    for (r = 0; r < rows && r < S.plots.length; r++) {
      for (c = 0; c < S.plots[r].length; c++) {
        if (S.plots[r][c].tilled && !S.plots[r][c].wet) { S.plots[r][c].wet = true; n++; }
      }
    }
    return n;
  }
  /* 鸡舍这一下按 E = 捡蛋。蛋不自动进账：早上下在草窝里，攒着也坏不了
     —— 这个游戏从头到尾没打算让人有压力，所以不捡只是下一天接着攒，
     唯一的区别是它一天一天地堆在那儿。 */
  /* 棚：鸡舍、牛棚、羊圈。
     9/9 那版是「造了就每天早上下蛋」，不用管。星露谷那边不是 ——
     门关着它们出不去，没喂食它们不下蛋。少了这一层，棚就只是一台印钱的机器。
     这边按这个游戏的调子来：**不惩罚，只少收**。
       忘了关门、忘了撒粮 —— 少收几份，饿着的不会死、昨天下的也不会烂。
     撒一次粮管几天：牛羊食量大、管得比鸡久，几天来一趟，不烦也不会白养。

     三样共用这一套，差别只有**名字、产出、喂几天**——
     所以「门开没开、粮够几天」这个判据只写一处，不在每个棚里抄一遍。 */
  function keepFix() {
    if (!S.keep || typeof S.keep !== 'object') S.keep = {};
    for (var i = 0; i < FG.KEEP_LV.length; i++) {
      var k = FG.KEEP_LV[i], o = S.keep[k];
      if (!o || typeof o !== 'object') o = S.keep[k] = {};
      if (typeof o.gate !== 'number') o.gate = 0;
      if (typeof o.feed !== 'number' || o.feed < 0) o.feed = 0;
      if (typeof o.got !== 'number' || o.got < 0) o.got = 0;
    }
  }
  // 喂牲口吃的是谷。喂哪一捆不由玩家挑 —— **按卖价从低到高扣**：
  // 喂牲口不在乎好坏，能省下好的那捆要紧
  function feedKeep() {
    var cand = [], k, it;
    for (k in FG.CROPS) {
      it = FG.BAG_IDX['crop_' + k];
      if (it && (FG.state.bag[k] || 0) > 0) cand.push({ k: k, sell: it.sell, n: FG.state.bag[k] });
    }
    if (!cand.length) return null;
    cand.sort(function (a, b) { return a.sell - b.sell; });
    FG.state.bag[cand[0].k]--;
    if (FG.state.bag[cand[0].k] <= 0) delete FG.state.bag[cand[0].k];
    return cand[0];
  }
  function keepState(id) { keepFix(); return S.keep[id] || (S.keep[id] = { gate: 0, feed: 0, got: 0 }); }
  // 早上那一下。两个条件都满足才有产出
  function keepMorning() {
    buildFix(); keepFix();
    var n = 0;
    for (var i = 0; i < FG.KEEP_LV.length; i++) {
      var id = FG.KEEP_LV[i], o = keepState(id);
      if (!S.build[id]) continue;      // 还没造
      if (!o.gate) continue;            // 门关着，出不去
      if (o.feed <= 0) continue;        // 没粮
      o.feed--;
      // got 数的是**攒了几个早上**，不是攒了几件。
      // 一级 n=1 的时候这两者一样，写成 o.got += yield.n 看着也对 ——
      // 可 yield 是 {k,n} 那个对象，加上去 got 就成了字符串 "0[object Object]"，
      // 于是 got>0 恒假、toast 也不弹，看着像「一整个早上什么都没下」
      o.got++;
      n++;
    }
    return n;
  }
  // 交给 I.* 的三样：门开没开、粮够几天、堆着几份
  function keepPose(id) { var o = keepState(id); return { gate: o.gate, feed: o.feed, got: o.got }; }
  // 站在棚跟前按 E。**一次只做一件事**：
  //   没造     -> 说这儿空着
  //   门关     -> 开门，顺手撒把粮
  //   门开+有货 -> 收
  //   门开+没货 -> 关门
  function keepUse(id) {
    buildFix(); keepFix();
    var def = FG.BUILD[id], o = keepState(id);
    if (!def) return false;
    if (!S.build[id]) { toast('这儿还空着。墟市老丈那儿有' + def.name + '卖。'); return false; }
    if (!o.gate) {
      o.gate = 1;
      var fed = feedKeep();
      if (fed) {
        o.feed = def.lv[S.build[id] - 1].days;
        toast('把门开了，撒了一把' + FG.CROPS[fed.k].name + '。够吃 ' + o.feed + ' 天。');
      } else {
        toast('门开了。可行囊里没有谷 —— 没有粮，它们不出东西。', 3400);
      }
      save(); updateHUD();
      return true;
    }
    if (o.got > 0) {
      if (!spend(1)) return false;
      var y = def.lv[S.build[id] - 1].yield, nm = FG.BAG_IDX[y.k].name;
      var got = o.got * y.n;
      invGive(y.k, got);
      FG.audio.play('buy');
      toast(def.pick + '了 ' + got + ' ' + def.lv[S.build[id] - 1].noun + nm + '。');
      o.got = 0;
      save(); updateHUD();
      return true;
    }
    o.gate = 0;
    save(); updateHUD();
    toast('门关上了。夜里它们在棚里，明早门开着才有。', 3400);
    return true;
  }
  // 旧名留着：15/9 那批代码和验收都按 coop* 调
  function coopTake() { return keepUse('coop'); }
  FG.buildList = buildList;
  FG.nearBuild = nearBuild;
  FG.nearBuildHint = nearBuildHint;
  FG.buildIdleWord = buildIdleWord;
  FG.warmOn = warmOn;
  // 眼下这块地冻不冻。**验收要核「温窒建了之后藏季能翻地下种」，
  // 就得能直接读它** —— FG.groundFrozen 是纯函数，它永远只看日子，
  // 问它「玩家买了温窒没有」是问错了对象
  FG.groundFrozenNow = groundFrozenNow;
  // 狗。判据全是纯读函数，导出来让验收直接核 ——
  // 「隔天叼一样回来」「叼的是当季的」这两条不能靠人看
  FG.dogFix = dogFix;
  FG.dogOn = dogOn;
  FG.dogDays = dogDays;
  FG.dogTodayKey = dogTodayKey;
  FG.dogMorning = dogMorning;
  FG.dogPose = dogPose;
  FG.dogTake = dogTake;
  // 品级。判据和「这一箱记着几档」都得能直接读 ——
  // 「耕的手艺 3 级就该好品了」这件事，验收得对着同一处核
  FG.QUALITY = FG.QUALITY;
  FG.qualityNow = qualityNow;
  FG.binQ = binQ;
  // 出货箱的搬进搬出也得导出来：品级记在箱上，
  // 而「放进去那一刻记档」这条只能从 binMove 那一头验
  FG.binMove = binMove;
  FG.binOpen = binOpen;
  FG.buildUnit = buildUnit;
  FG.ditchWater = ditchWater;
  FG.coopTake = coopTake;
  FG.machFix = machFix;
  FG.machList = machList;
  FG.nearMachine = nearMachine;
  FG.machJob = machJob;
  FG.machDone = machDone;
  FG.machRcp = machRcp;
  FG.machPut = machPut;
  FG.machTake = machTake;
  FG.machUse = machUse;
  FG.coopUse = keepUse;
  FG.keepUse = keepUse;
  FG.keepState = keepState;
  FG.keepFix = keepFix;
  FG.keepMorning = keepMorning;
  FG.keepPose = keepPose;
  FG.feedKeep = feedKeep;
  // 旧名留着，15/9 那批验收还按它调
  FG.feedCoop = feedKeep;
  // 家具。判据全是纯读函数，导出来让验收直接核 ——
  // 「灶间到底给几口」这句话在游戏里只在一个地方算数（cookCap），
  // 测试读同一处才叫核，不读就等于把表抄了一遍
  FG.furnFix = furnFix;
  FG.furnLv = furnLv;
  FG.furnNum = furnNum;
  FG.furnEffect = furnEffect;
  FG.cookCap = cookCap;
  FG.canCook = canCook;
  FG.openStove = openStove;
  FG.bagFit = bagFit;
  FG.chestTabs = chestTabs;
  FG.chestSide = chestSide;
  FG.chestSetTab = function (t) { chestTab = (t === 'made' || t === 'got') ? t : 'all'; openChest(); };
  FG.chestTab = function () { return chestTab; };
  // 歇脚处。判据全是纯读函数，导出来让验收直接核
  FG.roadInit = roadInit;
  FG.roadFix = roadFix;
  FG.roadLv = roadLv;
  FG.roadLegs = roadLegs;
  FG.stationOf = stationOf;
  FG.nearStation = nearStation;
  FG.stationList = stationList;
  FG.openStation = openStation;
  FG.closeStation = closeStation;
  FG.stationOpen = stationOpen;
  // 屋里。验收要核「那四行各自写的是什么」，就得能直接读它们
  FG.houseRows = houseRows;
  FG.openHouse = openHouse;
  FG.closeHouse = closeHouse;
  FG.houseOpen = houseOpen;
  // 验收要看「今天到底湿了没有」「硐封没封」，
  // 光从画布上数畦会把「下雨」和「水渠浇的」混成同一件事
  FG.weatherFix = weatherFix;
  FG.isWetWeather = isWet;
  FG.isSnowWeather = isSnow;
  FG.mineShut = mineShut;
  FG.rainWater = rainWater;
  FG.nearPickSpot = nearPickSpot;
  FG.pickBlockWord = pickBlockWord;
  // 四季那几条。seasonFix 不用 —— 节气和季节都是从日子推的，没有存档要补
  FG.seasonOf = FG.seasonOf;

  /* ---------------- 五门手艺 ----------------
     经验从做事本身来，不搞「把做过的东西再交一遍」那一套。
     升级不给纯数值，只开一样能去的地方 / 能做的事 ——
     器和手艺是同一条逻辑的两面：
       器物：场合一点不变，只改一次做多少
       手艺：一次做多少一点不变，只开一个新的场合
     每门只开一样。开了两三样就成了技能树，而技能树在一年里点不满，
     摊在那儿就只是给玩家看的 clutter。 */

  function skillInit() {
    var s = {}, i;
    for (i = 0; i < FG.SKILL.list.length; i++) s[FG.SKILL.list[i].k] = { lv: 1, pt: 0 };
    S.skill = s;
  }
  // 老存档里没有这一本账。不补的话读档玩家看着五门全是空的 ——
  // 那不是「回到旧版」，是存档坏了
  function skillFix() {
    var i, k;
    if (!S.skill) { skillInit(); return; }
    for (i = 0; i < FG.SKILL.list.length; i++) {
      k = FG.SKILL.list[i].k;
      if (!S.skill[k] || typeof S.skill[k].lv !== 'number') S.skill[k] = { lv: 1, pt: 0 };
      if (typeof S.skill[k].pt !== 'number') S.skill[k].pt = 0;
    }
  }
  function skillLv(k) { skillFix(); return S.skill[k].lv; }
  function hasSkill(k, lv) { return skillLv(k) >= lv; }

  /* 记一点经验。act 是动作名（till/sow/water/harvest/catch/pick/rock/cook），
     每一门给多少写在 FG.SKILL.list[].rate 里 —— 别在调用点写死数字，
     那样调平衡要翻八个地方。返回升上去的级数，没升返回 0。 */
  // times 是「这一次干了几份活」。默认 1。
  //
  // **为什么要有它：** 耕和凿都是「一下框一片」的工具 ——
  // 铁锄一下九畦、铁镐一下九块。原来的 skillAdd 每次调用只给 1 点，
  // 于是「翻一畦 1」「敲开一块 1」这两条写在行状页上的话
  // **只在木锄木镐那一级是真的**：升了器物以后，
  // 玩家一下九畦只长 1 点，比他应得的少九倍。
  // 实测硐里 108 块全敲完，凿只到 4 级（按一块一点该到 5 级）。
  // 那一行注释（「铁锄一下九畦就是九点」）和那张表写的都是按活儿算，
  // 差的只是没人把数传进来。
  function skillAdd(k, act, times) {
    var d = FG.SKILL.byKey(k);
    if (!d) return 0;
    var n = (d.rate && d.rate[act]) || 0;
    if (!n) return 0;
    var t = (times === undefined || times === null) ? 1 : times;
    if (t <= 0) return 0;
    skillFix();
    var s = S.skill[k], up = [];
    s.pt += n * t;
    // while 不是 if：一次给的经验足够连升两级的时候（改了 need 表很容易发生），
    // if 只会升一级，剩下的点卡在门槛上，永远差那么一点
    while (s.lv < FG.SKILL.max && s.pt >= FG.SKILL.need[s.lv]) {
      s.pt -= FG.SKILL.need[s.lv];
      s.lv++;
      up.push(s.lv);
    }
    if (up.length) {
      // 刚好卡在四级的那一升要连着说解锁了什么，否则玩家在行状页
      // 看到「四级」两个字，不知道四级能干什么
      var txt = [], i;
      for (i = 0; i < up.length; i++) {
        txt.push(d.name + ' ' + up[i] + ' 级' + (up[i] === 4 ? '　' + d.at4 + '：' + d.at4d : ''));
      }
      rewardPush('手艺长进', txt);
      updateHUD(); save();
    }
    return up.length ? s.lv : 0;
  }

  /* ---------------- 器物分级 ----------------
     「器物无等级，只有场合」这条老规矩和「星露谷玩法全融」在这里和解：
     **场合一点没变** —— 锄永远翻土、瓢永远浇水，升级不给你新用处；
     变的只有一次做得多少（w × h）。

     所以这不是 +10 攻击那种纯数值堆叠：体力照畦数扣，铁锄一下九畦
     就是十八点，一天顶格几次。升级换来的是省路，不是省力。 */
  function gearOf(k) {
    var lv = S.gear[k] || 0;
    if (lv <= 0) return FG.GEAR0[k];
    var t = (FG.GEAR[k] || [])[lv - 1];
    return t || FG.GEAR0[k];
  }
  // 以 (col,row) 为中心的一块 w×h，夹回网格。1×3 是竖着的一列，3×3 是一方。
  // w/h 给 0 的那一路（没买镐）上下界正好错开半步，一格都返回不了 ——
  // 于是「没有镐」自然落到专门的提示上，而不是去读一个不存在的覆盖范围
  function spanCells(w, h, col, row) {
    var out = [], c, r;
    if (!F.on || !F.COLS) return out;
    for (r = row - ((h - 1) >> 1); r <= row + ((h - 1) >> 1); r++) {
      for (c = col - ((w - 1) >> 1); c <= col + ((w - 1) >> 1); c++) {
        if (c < 0 || r < 0 || c >= F.COLS || r >= F.ROWS) continue;
        out.push([c, r]);
      }
    }
    return out;
  }
  function gearCells(k, col, row) {
    var g = gearOf(k), out = [], cells = spanCells(g.w, g.h, col, row), i;
    for (i = 0; i < cells.length; i++) {
      if (!S.plots[cells[i][1]] || !S.plots[cells[i][1]][cells[i][0]]) continue;
      out.push(cells[i]);
    }
    return out;
  }
  // 石头那一格现在有没有东西。没镐时 spanCells 返回空，调用方自然当成「敲不动」
  function rockCells(col, row) {
    var g = gearOf('jue');
    return spanCells(g.w, g.h, col, row);
  }
  // 鼠标停着的那一格配套要画高亮的那几格。铁锄一下九畦，
  // 只框中间一格的话，玩家不知道自己这一下会动到哪
  function hoverSpan() {
    if (!S.hover) return null;
    // 硐里悬停永远是镐的跨度，跟手上拿的是不是镐无关 ——
    // 跟「捏着种点田畦即下种」是同一条：在硐里点石头只有一种结果，
    // 手上切的是锄也不该变成「点了没反应」
    if (inMine()) return rockCells(S.hover[0], S.hover[1]);
    if (toolIsSeed(S.sel)) return null;
    return gearCells(S.sel, S.hover[0], S.hover[1]);
  }

  // 翻土 / 浇水：先看这一块里真能动的有几畦，一畦都不动就说明白被什么挡住了；
  // 然后一次扣够体力再一起做。中途体力不够而只做了一半，
  // 玩家的田会留下一半翻了一半没翻，两边都说不通
  function workArea(k, col, row) {
    var cells = gearCells(k, col, row);
    if (!cells.length) return;
    // 藏季：土硬了，锄头下不去。拦在扣体力之前 ——
    // 拦在后面的话玩家看着体力白白掉一截，而地还是没翻开。
    // 「等立春」从表里读，别在提示里再抄一遍节气名。
    // 雪天分一句：不是地硬，是雪压着 —— 两件事该让玩家分得清
    if (k === 'chu' && groundFrozenNow()) {
      toast(isSnow() ? '雪压着地，锄头下去只留一道白印。等' + FG.SOLAR[0].n + '再说。'
                     : '地冻上了，锄头下不去。等' + FG.SOLAR[0].n + '再说。', 2800);
      return;
    }
    var todo = [], i, pl, busy = 0, notTilled = 0, already = 0, bare = 0;
    for (i = 0; i < cells.length; i++) {
      pl = S.plots[cells[i][1]][cells[i][0]];
      if (k === 'chu') {
        if (pl.crop) { busy++; continue; }
        if (pl.tilled) { already++; continue; }
      } else {
        if (!pl.tilled) { notTilled++; continue; }
        // **地翻好了可还没下种，浇它就是白浇。**
        // 原来这一支只看 pl.tilled，于是空地照样浇得动：
        // 扣一点力气、回一句「浇过 1 畦」，而地里什么也没发生。
        // 冬天那三十来天地里种不了东西，玩家手上只剩这把木瓢，
        // 于是一天天浇空地 —— 那是这个游戏里唯一一件「有反馈却没结果」的事
        if (!pl.crop) { bare++; continue; }
        if (pl.wet) { already++; continue; }
      }
      todo.push(cells[i]);
    }
    if (!todo.length) {
      // 「动不了」的原因要分开说。原来只有一句「这畦已翻过」，
      // 铁锄一框九畦的时候混成一句，玩家不知道是哪几畦挡住的
      if (k === 'chu') {
        toast(busy ? '这一片里都已经种上了。' : '这一片都翻过了，不必再锄。');
      } else {
        toast(bare ? '地是翻好的，可上头还没有苗。浇了也白浇。'
          : (notTilled ? '得先锄开才能浇。' : '这一片浇过了。'));
      }
      return;
    }
    var cost = todo.length * FG.GEAR_STAM[k];
    if (S.stam < cost) { toast('这一片要 ' + cost + ' 分力气，只剩 ' + S.stam + ' 分。'); return; }
    S.stam -= cost;
    for (i = 0; i < todo.length; i++) {
      pl = S.plots[todo[i][1]][todo[i][0]];
      if (k === 'chu') { pl.tilled = true; pl.wet = false; }
      else { pl.wet = true; S.todayWatered++; }
    }
    if (k === 'chu') albumAdd('firstTill');
    FG.audio.play(k === 'chu' ? 'hoe' : 'water');
    toast((k === 'chu' ? '翻开' : '浇过') + todo.length + ' 畦。');
    // 手艺按**真动到的畦数**记，不按下了几下。铁锄一下九畦就是九点，
    // 木锄一下一畦是一点 —— 记的是活儿，不是按键次数
    skillAdd('geng', k === 'chu' ? 'till' : 'water', todo.length);
    // 一生累计：任务要的是「一辈子翻过多少畦」。账本一年一清，拿它算任务
    // 的话翻一次年进度就归零，而那条托付并没有过期
    if (k === 'chu') totalAdd('till', todo.length);
  }

  /* ---------------- 石硐 ----------------
     和锄同一条规矩：**场合一点没变**（镐只干「敲开一块石头」），
     变的只有一下能敲几块；成本是这一层敲一块要几分力气（FG.MINE.floors[n].stam），
     越深越硬。体力照块数扣，跟铁锄一下九畦扣十八分是同一个算法。

     布局不是随机的，是**用层号当种子**洗出来的：同一层每次进来长得一样，
     玩家挖了一半出去再回来还认得路，验收脚本也才能对着它断言
     （用 Math.random 的话断言只能写「大概会出铜砂」，那种断言等于没写）。 */
  function rockOf(n) {
    var key = 'L' + n;
    if (S.rock[key]) return S.rock[key];
    var f = FG.MINE.floor(n);
    if (!f) return null;
    var pool = [], k, i, seed, t, j;
    for (k in f.ore) for (i = 0; i < f.ore[k]; i++) pool.push(k);
    // Lehmer：乘 16807 再模 2^31-1，中间值不超过 3.6e13，
    // 远在 double 的整数精确范围（2^53）之内，不会像 1103515245 那样溢出成小数
    seed = (n * 7919) % 2147483647;
    if (seed <= 0) seed += 2147483646;
    for (i = pool.length - 1; i > 0; i--) {
      seed = (seed * 16807) % 2147483647;
      j = seed % (i + 1);
      t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    S.rock[key] = pool;
    return pool;
  }
  function rockAt(n, col, row) {
    var g = rockOf(n);
    if (!g) return null;
    return g[row * F.COLS + col] || null;
  }
  function mineLeft(n) { return FG.MINE.left(n, rockOf(n || S.mineFloor)); }
  function mineCleared(n) { return mineLeft(n) === 0; }

  // 和 workArea 一个模子：先看这一片里真有几块能敲，一次扣够力气再一起敲。
  // 中途力气不够只敲了一半，墙上就留下一半新洞一半旧石，两边都说不通
  function mineArea(col, row) {
    if (S.ended) return;
    if (S.gear.jue <= 0) { toast('还没有镐。墟市老丈那儿有卖的。'); return; }
    var n = S.mineFloor, f = FG.MINE.floor(n);
    if (!f) { toast('这一层不知怎么空了。'); return; }
    var cells = rockCells(col, row), todo = [], i, ore;
    for (i = 0; i < cells.length; i++) {
      if (rockAt(n, cells[i][0], cells[i][1])) todo.push(cells[i]);
    }
    if (!todo.length) { toast('这一片已经敲开了。'); return; }
    var cost = todo.length * f.stam;
    if (S.stam < cost) { toast('这一片要 ' + cost + ' 分力气，只剩 ' + S.stam + ' 分。'); return; }

    S.stam -= cost;
    var got = {}, parts = [];
    for (i = 0; i < todo.length; i++) {
      ore = rockAt(n, todo[i][0], todo[i][1]);
      S.rock['L' + n][todo[i][1] * F.COLS + todo[i][0]] = null;
      got[ore] = (got[ore] || 0) + 1;
      invGive('ore_' + ore, 1);
      dexAdd('ore', ore);
    }
    for (ore in got) parts.push(FG.ORE[ore].name + ' ×' + got[ore]);
    FG.audio.play('hoe');
    if (S.book) S.book.ores = (S.book.ores || 0) + todo.length;
    // 按真敲开的块数记，不按镐的级别
    skillAdd('zao', 'rock', todo.length);
    totalAdd('rock', todo.length);
    toast('敲开 ' + todo.length + ' 块　' + parts.join('　'));
    if (mineCleared(n)) toast('这一层见底了。右边地上露出一个落点。', 3200);
    updateHUD();
    save();
  }

  function nearShaft() {
    var sh = curMap().shaft;
    if (!sh) return false;
    return Math.abs(sh.at[0] - S.player.x) + Math.abs(sh.at[1] - S.player.y) < sh.r;
  }
  // 现在走得到第几层。凿这门手艺到四级才开得了最深的一层 ——
  // FG.MINE.deepest 是这座硐一共挖了多深，不是现在挖到了多深，
  // 这两件事混成一个数的话，「凿四级才开得了」就没有地方挂了
  function mineReach() { return hasSkill('zao', 4) ? FG.MINE.deepest : FG.MINE.deepest - 1; }
  // 往下走。两个条件都要说清楚：没敲干净就告诉你还剩几块，
  // 到底了就把底下那半句《桃花源记》交代掉 —— 硐里只有这一句诗，
  // 它得落在这座硐真正到头的地方，不能每层都给一遍
  function useShaft() {
    var n = S.mineFloor, f = FG.MINE.floor(n);
    if (!f) return;
    if (!mineCleared(n)) { toast('这层还剩 ' + mineLeft(n) + ' 块没敲开。'); return; }
    if (n >= FG.MINE.deepest) {
      albumAdd('mineBottom');
      toast('底下是水声，再没有更深的路了。', 4200);
      return;
    }
    // 下面那一层已经通了，但手上功夫不到，凿不动那儿的石头
    if (n + 1 > mineReach()) {
      toast('再往下有石头，可这一层的石壁太硬 —— 凿这门手艺到四级才走得下去。', 4600);
      return;
    }
    S.mineFloor = n + 1;
    if (S.mineFloor > S.mineDeep) S.mineDeep = S.mineFloor;
    S.player.x = 960; S.player.y = 900; S.walkTo = null; S.hover = null;
    updateHUD(); save();
    toast('下到第 ' + S.mineFloor + ' 层。' + FG.MINE.floor(S.mineFloor).desc, 3200);
  }

  // 硐里的提示行。和别处一样：写的是**按下去会发生什么**。
  // 没镐的时候不能只说「点石头」——那等于让玩家自己猜是哪一步不对
  function hintMine() {
    var f = FG.MINE.floor(S.mineFloor);
    if (!f) { hint(''); return; }
    var ex = nearExit();
    if (ex) { hint('E　' + ex.label); return; }
    var left = mineLeft(S.mineFloor);
    if (nearShaft()) {
      if (left) hint('这层还剩 ' + left + ' 块没敲开');
      else hint(S.mineFloor >= FG.MINE.deepest ? 'E　再深一层　·　底下是水声' : 'E　再深一层');
      return;
    }
    if (S.gear.jue <= 0) {
      hint('第 ' + S.mineFloor + ' 层　·　' + left + ' 块　·　没有镐，墟市老丈那儿有卖的');
      return;
    }
    var g = gearOf('jue');
    hint('第 ' + S.mineFloor + ' 层　·　' + left + ' 块　·　' + g.name +
         '一下 ' + (g.w * g.h) + ' 块，每块 ' + f.stam + ' 分力气');
  }

  function spend(n) {
    if (S.stam < n) { toast('力竭了，该归家歇息。'); return false; }
    S.stam -= n; updateHUD(); return true;
  }

  function useOn(col, row) {
    if (S.ended) return;
    var pl = S.plots[row][col];
    var sel = S.sel;

    // 镐在田里没有场合。它在 TOOLS 里占着第八格，切过去以后点田畦
    // 必须说清楚为什么不行 —— 不挡在这里的话它会掉进下面 else 那支，
    // 去读 C['jue'].terms（作物表里根本没有 jue），当场抛，
    // 而抛在回调里画面上只是「点了没反应」
    if (sel === 'jue') { toast('田里用不上镐。镐是下石硐才用的。'); return; }

    if (sel === 'chu' || sel === 'piao') {
      if (!pl) return;
      workArea(sel, col, row);
    } else {
      // 这里原来把下种的判据整段抄了一遍。抄的那份和 sowWith 那份迟早分叉，
      // 而分叉的表现是「行囊里捏着豆点下去能种，架子上切到豆种点下去不能」——
      // 两边都是玩家看得出、谁也说不清对错的症状。
      // 而且手艺的点只加在一条路上的时候更隐蔽：另一条照样种得下去，
      // 只是经验不涨，面板上写着「耕 1 级」而田里的苗一天天长。
      sowWith(sel, col, row);
    }
    updateHUD();
  }

  /* 本年账：一年跑完要回顾一次，所以每次收成/上鱼/采集都记一笔。
     翻年就清空 —— 诗册留着（那是跨年的），账本不留。 */
  function bookAdd(cat, k) {
    if (!S.book) return;
    S.book[cat][k] = (S.book[cat][k] || 0) + 1;
  }
  function bookInit() {
    S.book = { crops: {}, fish: {}, picks: {}, casts: 0, earned: 0, steles: 0, first: S.day, last: S.day };
  }

  /* ---------------- 诗册 ----------------
     做的事对应收一句诗。这是分数不是任务清单：没做的事不出现，
     也不排「未得 XXX」的占位 —— 一屏待办会把诗册变成 checklist。
     诗册跨年留着，账本不留。 */
  var rewardQ = [], rewardTimer = null, toastUntil = 0;
  // 浮字和这四张卡是同一块地方（都在 top:12% 附近的画面中央）。
  // 任何一张开着都不该弹奖励。
  function panelOpen() {
    return !document.getElementById('de').classList.contains('hide')
        || !document.getElementById('dlg').classList.contains('hide')
        || !document.getElementById('sh').classList.contains('hide')
        || !document.getElementById('st').classList.contains('hide')
        || !document.getElementById('bx').classList.contains('hide')
        || !document.getElementById('bg').classList.contains('hide')
        || !document.getElementById('ch').classList.contains('hide')
        || !document.getElementById('al').classList.contains('hide');
  }
  function flushReward() {
    if (rewardTimer) { clearTimeout(rewardTimer); rewardTimer = null; }
    if (!rewardQ.length) return;
    // 光靠调用方的 quiet 挡不住：先排队的几句还带着定时器，
    // 玩家中途开了面板，定时器照样到点就弹，压在结算卡上面。
    if (panelOpen()) { scheduleReward(700); return; }
    // 动作自己的提示优先。浮字只有一个位置，动作提示被盖掉的话
    // 「现在不是黍的时节」就没了，玩家会以为自己点错了地方。
    var idle = toastUntil - Date.now();
    if (idle > 0) { scheduleReward(idle + 140); return; }
    // 开头相同的一批并成一条浮字。收诗一次来三句时要读作「得了三句」，
    // 分三次弹的话玩家只看见第一句，后两句一闪就没了。
    // 抬头不同的不并 —— 升级提示和收诗是两件事，混在一行里读不出来。
    var head = rewardQ[0].head, parts = [], n = 0, i;
    for (i = 0; i < rewardQ.length && rewardQ[i].head === head; i++) {
      parts = parts.concat(rewardQ[i].parts); n++;
    }
    rewardQ.splice(0, n);
    if (parts.length) toast(head + '　' + parts.join('　'), 6000);
    if (rewardQ.length) scheduleReward(1200);
  }
  function scheduleReward(ms) {
    if (rewardTimer) clearTimeout(rewardTimer);
    rewardTimer = setTimeout(flushReward, ms);
  }
  // 一切「做了某件事才有」的提示都从这里走。屏幕上只有一个浮字槽，
  // 各弹各的必然互相顶掉，而被顶掉的那条玩家这一辈子都看不见。
  function rewardPush(head, parts) {
    rewardQ.push({ head: head, parts: parts });
    scheduleReward(900);
  }
  function albumAdd(k, quiet) {
    var a = FG.ALBUM_IDX[k];
    if (!a || S.album[k]) return false;
    S.album[k] = S.day;
    save();
    // 排队，不能直接弹。动作自己的浮字（「翻开一畦。」「钓上来一条…」）
    // 紧跟着就把这里盖掉了 —— 收诗的那句是奖励，被自己的动作提示挤掉
    // 等于白做。quiet 表示此刻有面板开着（结算卡/对话卡都占 top:12%），
    // 那就等面板关了由 startDay 再安排。
    rewardQ.push({ head: '诗册得句', parts: ['「' + a.v + '」' + a.f] });
    if (!quiet) scheduleReward(900);
    return true;
  }
  FG.flushAlbum = flushReward;
  FG.flushReward = flushReward;
  // 队列里还压着几条。这个得能读出来 ——
  // 「浮字槽是空的」和「队列是空的」是两件事：
  // 攒着的那些还没上屏，看起来跟空的一样，
  // 而它们会在下一个动作的浮字前面一起冒出来，把那个浮字挤到十几秒以后。
  // 验收要判「升级浮字没被顶掉」的话，先看这个数
  FG.rewardDepth = function () { return rewardQ.length; };

  /* 这块纸有两页：诗册记句子，行状记手艺。
     不给手艺单开一个键：键位条只剩 57px 余量（dev/probe-keys.mjs 量过），
     再加一个键就得砍掉现有的字，而「V 是哪一页」写在纸上比写在键位条上清楚。 */
  var alPage = 'verse';
  function skillRow(d) {
    var s = S.skill[d.k], full = s.lv >= FG.SKILL.max;
    // 满级以后还记点，但不再往上加 —— 面板上要写得出「满了」，
    // 写不出的话玩家会以为白做了
    var bar = full ? '　满'
      : '　还差 ' + (FG.SKILL.need[s.lv] - s.pt) + ' 点到 ' + (s.lv + 1) + ' 级';
    var un = s.lv >= 4
      ? '<div class="sk-un">四 级　' + d.at4 + '　' + d.at4d + '</div>'
      : '<div class="sk-un sk-lock">四 级　' + d.at4 + '　（还没到）</div>';
    return '<div class="sk-item">' +
      '<div class="sk-t"><b>' + d.name + '</b><span class="sk-lv">' + s.lv + ' 级</span></div>' +
      '<div class="sk-p">' + d.rateDesc + '</div>' +
      '<div class="sk-bar">' + bar + '</div>' + un +
      '</div>';
  }
  /* 和 bagOpen/binOpen 同一个形状。**别用 panelOpen() 当开着的判据** ——
     那是「有没有任何面板开着」，拿来判「这张开没开」的话，
     诗册一开，按 V 会去关掉**最先找到的那张**，而那张未必是诗册。
     关错面板的现象是「按 V，别的面板没了，诗册还在」，极难自己看出来。 */
  function albumOpen() { return !document.getElementById('al').classList.contains('hide'); }
  function closeAlbum() { document.getElementById('al').classList.add('hide'); }
  function openAlbum() {
    skillFix(); furnFix(); dexFix();
    var host = document.getElementById('al-list');
    document.getElementById('al').classList.remove('hide');
    // 抬头跟着页走。写死「诗 册」的话，切到行状那一页，
    // 抬头还写着诗册，玩家会以为标签没点中
    document.getElementById('al-name').textContent =
      (alPage === 'skill') ? '行 状' : ((alPage === 'wall') ? '墙 上'
        : ((alPage === 'seen') ? '见 闻' : ((alPage === 'farm') ? '农 时' : '诗 册')));
    var tabs = document.querySelectorAll('#al-tabs .al-tab');
    for (var t = 0; t < tabs.length; t++) {
      tabs[t].classList.toggle('on', tabs[t].getAttribute('data-p') === alPage);
      // 页签上带一个「见过几种」：不进这一页也知道它不是空的
      if (tabs[t].getAttribute('data-p') === 'seen') {
        tabs[t].innerHTML = '见 闻　' + (dexCount('fish') + dexCount('good') + dexCount('ore'));
      }
    }
    // 「墙上」那一页得跟着东轩收放
    var wt = document.getElementById('al-tab-wall');
    if (wt) wt.style.display = furnNum('dongxuan', 'wall') ? '' : 'none';
    if (alPage === 'seen') {
      host.innerHTML = dexView();
      return;
    }
    if (alPage === 'farm') {
      host.innerHTML = farmView();
      // 「今天」那一行标出来。**在 innerHTML 之后做** ——
      // 全年表是缓存的，把「今天」烤进缓存的话第二次进来标的是第一次那天的
      var mine = document.querySelector('#al-list .fm-r[data-i="' + FG.SOLAR_IDX[FG.solarOf(S.day).k] + '"]');
      if (mine) mine.classList.add('on');
      return;
    }
    if (alPage === 'skill') {
      var rows = [], i, d;
      for (i = 0; i < FG.SKILL.list.length; i++) rows.push(skillRow(FG.SKILL.list[i]));
      host.innerHTML = rows.join('') +
        '<div class="al-foot">手艺是做事做出来的，升级不送钱送场合</div>';
      return;
    }
    var i2, a, day;
    // 「墙上」那一页是东轩给的：点亮的句子按点亮的先后竖排抄在墙上，
    // 还没点上的留一格空格。**同一份数据**（S.album），只是换个摆法 ——
    // 东轩没有另存一本账，所以不存在「册子上有、墙上没有」这种分叉
    if (alPage === 'wall') {
      var wlv = furnNum('dongxuan', 'wall');
      if (!wlv) {
        host.innerHTML = '<div class="al-empty">东边那间还堆着杂物，没腾出来。</div>';
        return;
      }
      var wall = [], on = 0, blank = wlv > 1;
      for (i2 = 0; i2 < FG.ALBUM.length; i2++) {
        a = FG.ALBUM[i2];
        day = S.album[a.k];
        if (day) on++;
        wall.push(day
          ? '<div class="wl-on"><div class="wl-v">「' + a.v + '」</div>' +
          (wlv > 1 ? '<div class="wl-f">第 ' + FG.yearOf(day) + ' 年 · 第 ' + FG.dayOfYear(day) + ' 天</div>' : '') +
          '</div>'
          : (blank ? '<div class="wl-off" title="' + a.f + '">　</div>' : ''));
      }
      // 陈列：**东轩二级**才有的第二样东西 —— 认出过的山货 / 溪鱼 / 矿砂
      // 一样一格挂在墙上，用它们自己那个图标画出来（不是文字）。
      // 场合不变（还是这面墙），多挂几样 —— 东轩二级兑现的是这个。
      //
      // **挂架摆在诗联上面**，不摆在下面：诗联一共 27 联、占掉大半屏，
      // 挂架放末尾就永远在折线以下 —— 而它才是东轩二级带来的那样新东西。
      // 诗联是死的 27 句，挂架是随着你认出的味一点点长起来的，后者先看见。
      host.innerHTML = (wlv > 1 ? '<div class="wl-h">挂 架</div><canvas id="wl-cv"></canvas>' : '')
        + '<div class="wl">' + wall.join('') + '</div>' +
        '<div class="al-foot">墙上 ' + on + ' 联' +
        (wlv > 1 ? '　·　挂架上 ' + dexWallList().length + ' 样' : '') +
        '　·　一共 ' + FG.ALBUM.length + ' 句' +
        (wlv > 1 ? '　·　挂架里一共 ' + dexAll() + ' 样　·　空着的格子是还没点上的'
                 : '') + '</div>';
      // **必须放在 innerHTML 之后**：画布这时才在 DOM 里，
      // 提前画会一句「没有那个元素」把它整段吞掉
      if (wlv > 1) drawWall();
      return;
    }
    var got = [];
    for (i2 = 0; i2 < FG.ALBUM.length; i2++) {
      a = FG.ALBUM[i2];
      day = S.album[a.k];
      if (!day) continue;
      got.push('<div class="al-item">' +
        '<div class="al-v">「' + a.v + '」</div>' +
        '<div class="al-f">' + a.f + '　·　第 ' + FG.yearOf(day) + ' 年 · 第 ' + FG.dayOfYear(day) + ' 天</div>' +
        '</div>');
    }
    var n = got.length;
    if (!n) got.push('<div class="al-empty">册子还是空的。先去翻一畦土。</div>');
    host.innerHTML = got.join('') +
      '<div class="al-foot">已得 ' + n + ' 句　·　这本册子一共 ' + FG.ALBUM.length + ' 句</div>';
  }
  function setAlPage(p) {
    alPage = (p === 'skill') ? 'skill' : ((p === 'wall') ? 'wall'
      : ((p === 'seen') ? 'seen' : ((p === 'farm') ? 'farm' : 'verse')));
    openAlbum();
  }

  /* 「见闻」这一页。**没见过的味不排出来**，跟诗册同一条规矩：
     排一屏「未遇 XXX」就是一份待办清单，而这本册子记的是你已经遇上的。
     想让人知道还差什么，靠页脚那个总数（见过几种 / 一共几种），
     不靠一张空位表 —— 空格只会让人觉得欠了账。
     每一路自带一个两列的块，别把组标题直接塞进 .al-list：
     那个列表是 flex 换行 + :nth-child(odd) 分左右两栏的，
     多插一个非 .al-item 的兄弟进去，后面每一行的奇偶数就整体错一位。 */
  function dexView() {
    var out = [], gi, g, tbl, list, k, d, all, i;
    var seen = 0, allTotal = 0;
    for (gi = 0; gi < FG.DEX.length; gi++) {
      g = FG.DEX[gi];
      tbl = FG[g.src] || {};
      list = []; all = 0;
      for (k in tbl) {
        all++;
        d = S.dex[g.cat][k];
        if (!d) continue;
        list.push({ k: k, t: tbl[k], d: d });
      }
      seen += list.length; allTotal += all;
      if (!list.length) continue;
      out.push('<div class="dx-g"><div class="dx-h">' + g.label + '</div><div class="dx-row">');
      for (i = 0; i < list.length; i++) {
        d = list[i].d;
        out.push('<div class="al-item dx-i">' +
          '<div class="al-v">' + list[i].t.name + '</div>' +
          '<div class="al-f">见过 ' + d.n + ' 回　·　头一回第 ' + FG.yearOf(d.first) + ' 年第 ' + FG.dayOfYear(d.first) + ' 天</div>' +
          '<div class="dx-d">' + (list[i].t.desc || '') + '</div>' +
          '</div>');
      }
      out.push('</div></div>');
    }
    if (!out.length) out.push('<div class="al-empty">还没遇上什么。' + FG.DEX[0].why + '</div>');
    out.push('<div class="al-foot">见过 ' + seen + ' 种　·　溪上 ' + dexCount('fish') +
      '　山中 ' + dexCount('good') + '　石里 ' + dexCount('ore') +
      '　·　山里一共 ' + allTotal + ' 种</div>');
    return out.join('');
  }

  /* ---------------- 农时（诗册的第五页） ---------------- */
  /* 「今天有什么讲究」的那几条规矩，散在 step / gotoMap / pickBlockWord /
     till / stepFishing 五个地方，各自说得都对，而玩家一条也看不见。
     判据全在这一支（farmOn），别在别处再写一遍雷雨封硐那一套。 */
  function farmOn(k) {
    weatherFix();
    if (k === 'wet') return isWet();
    if (k === 'snow') return isSnow();
    if (k === 'storm') return S.weather === 'storm';
    if (k === 'frozen') return groundFrozenNow();
    if (k === 'night') return FG.isNight(S.min);
    if (k === 'last') return FG.solarOf(S.day).k === FG.SOLAR[FG.SOLAR.length - 1].k;
    return false;
  }
  // 今天能下种的（温窒里那一档不算 —— 温窒是它自己的场合，另说）
  function cropsSowable() {
    var out = [], k;
    for (k in C) {
      var t = C[k].terms;
      if (t === '*' || (t && t.indexOf('*') >= 0) || t.indexOf(FG.solarOf(S.day).k) >= 0) out.push(C[k].name);
    }
    return out;
  }
  function farmView() {
    var i, k, sol, out = [], rows = [], sown = cropsSowable(), f;
    // 上半：今天有什么讲究
    var today = '';
    for (i = 0; i < FG.FARM_ORDER.length; i++) {
      k = FG.FARM_ORDER[i];
      if (!farmOn(k)) continue;
      f = FG.FARM[k];
      today += '<div class="fm-w' + (f.f === '——' ? '' : ' q') + '">' + f.w
        + (f.f !== '——' ? '<u>' + f.f + '</u>' : '') + '</div>';
    }
    if (!today) today = '<div class="fm-w">今天没什么讲究。晴着，该下地下地，该钓鱼钓鱼。</div>';
    var head = '<div class="fm-h">今 日</div><div class="fm-today">'
      + '<div class="fm-d">' + FG.SHEN(S.min) + '　·　' + FG.solarOf(S.day).n + '　·　第 '
      + FG.dayOfYear(S.day) + ' 天　·　' + FG.WEATHER[S.weather].name + '</div>'
      + today
      + '<div class="fm-s">今天能下种：' + (sown.length ? sown.join('、') : '一样也不能——歇一天') + '</div>'
      + '</div>';
    // 下半：二十四节气。**一年四季只摆一次**，不跟着页签的开关重画。
    //
    // 缓存的必须是 **farmRows 这个变量本身**，不能是块里的局部 rows：
    // 写成局部的话，第二次进来 `if (!farmBuilt)` 整块跳过，rows 保持空，
    // 推出去的就是一个空的 fm-g —— 而第一次打开时明明是好的，
    // 症状是「第一遍有表，再翻一次表没了」，看着像面板自己坏的
    if (!farmBuilt) {
      var rows = [], can, rg, cc;
      for (i = 0; i < FG.SOLAR.length; i++) {
        sol = FG.SOLAR[i];
        can = []; rg = [];
        for (k in C) {
          cc = C[k];
          if (cc.terms.indexOf(sol.k) >= 0) { can.push(cc.name); if (cc.regrow) rg.push(cc.name); }
        }
        // 行上只挂 data-i，**不把「今天」烤进缓存** ——
        // 烤进去的话第二次进来标的是第一次那天的节气
        rows.push('<div class="fm-r" data-i="' + i + '">'
          + '<div class="fm-n">' + sol.n + '</div>'
          + '<div class="fm-p">' + sol.w + '</div>'
          + '<div class="fm-s2">能下种：' + (can.length ? can.join('、') : '—') + '</div>'
          + (rg.length ? '<div class="fm-rg">再生：' + rg.join('、') + '</div>' : '')
          + '</div>');
      }
      farmRows = rows.join('');
      farmBuilt = true;
    }
    out.push(head, '<div class="fm-h">二 十 四 节 气</div><div class="fm-g">' + farmRows + '</div>');
    return out.join('');
  }
  var farmBuilt = false, farmRows = '';

  /* 再生作物还能再割几刀。
     判据是「**这个时节还剩几天**」，不是「这畦总共几刀」——
     菊只能种在立秋/处暑/白露那十八天里，割完了这一茬，
     下一种下去就过了白露。所以刀数是有限的，而且**是节气定的，不是表定的**。
     写死一个「共 N 刀」的话，玩家会发现到第 N 刀之后它还在长，
     而按节气算到头就是到头。 */
  function cutLeft(k, done) {
    var c = C[k], left = FG.DAY.END;
    if (!c || !c.regrow) return 0;
    // 从今天数到这一作物最后能种的那个节气走完
    var doy = FG.dayOfYear(S.day);
    var last = 0, i, t;
    for (i = 0; i < c.terms.length; i++) {
      t = FG.SOLAR_IDX[c.terms[i]] * FG.SOLAR_DAYS + FG.SOLAR_DAYS;
      if (t > doy && t > last) last = t;
    }
    if (!last) last = doy + 1;
    var days = last - doy, n = 0;
    // 割完当天起算：今天割过，这一刀是 0 刀
    n = Math.floor((days - 1) / c.regrow);
    return n < 0 ? 0 : n;
  }
  /* 「现在不是菊的时节」——光说不行，要把正确的节气告诉他，
     否则玩家只能一天天试。 */
  function termHint(c) {
    if (!c.terms || c.terms === '*' || c.terms.indexOf('*') >= 0) return '';
    var names = [], i, seen = {};
    for (i = 0; i < c.terms.length; i++) {
      var s = FG.SOLAR[FG.SOLAR_IDX[c.terms[i]]];
      if (s && !seen[s.n]) { seen[s.n] = 1; names.push(s.n); }
    }
    return names.length ? '要等' + names.join('、') + '。' : '';
  }

  function harvest(col, row) {
    var pl = S.plots[row][col];
    if (!pl.crop || pl.stage < C[pl.crop].days) return;
    if (!spend(1)) return;
    var k = pl.crop;
    S.bag[k] = (S.bag[k] || 0) + 1;
    bookAdd('crops', k);
    albumAdd('firstHarvest');
    if (k === 'ju') albumAdd('firstJu');
    // 五谷都收过才算「此中有真意」。要逐样都收过，不是收够五样 ——
    // 同一畦连收五次豆不叫五谷。
    S.got[k] = true;
    var g, all = true;
    for (g in C) if (!S.got[g]) { all = false; break; }
    if (all) albumAdd('allCrops');
    if (C[k].regrow) { pl.stage = C[k].days - C[k].regrow; }
    else { pl.crop = null; pl.stage = 0; }
    // 再生要说一声，还剩几刀。**原来一声不吭** ——
    // 收完 stage 悄悄退回去，画面上看不出这畦跟别的有什么不同，
    // 一个玩家看不见的机制等于没有
    var cut = '';
    if (C[k].regrow) {
      pl.cut = (pl.cut || 0) + 1;      // 已经割过几刀
      cut = '　还能再割 ' + cutLeft(k, pl.cut) + ' 刀';
    }
    // 耕到四级才留得下种。以前只有墟市买得到，所以「年年买种」一直
    // 是一条看不见的税；留种是**多一个能做的事**，不是多收一份钱。
    // S.seeds 那一本账是按**作物 id**记的（行囊里那一格叫 seedD，
    // 那是行囊的 key）。用 FG.SEED_OF 反查会记到 S.seeds.seedD 上去，
    // 而所有读的地方都读 S.seeds.dou —— 存进去了、买的时候也看不见
    var kept = '';
    if (hasSkill('geng', 4)) {
      S.seeds[k] = (S.seeds[k] || 0) + 1;
      kept = '，留了一包' + C[k].name + '种';
    }
    skillAdd('geng', 'harvest');
    FG.audio.play('harvest');
    toast('收了一茬' + C[k].name + '，' + S.bag[k] + ' 束在篮里' + kept + '。' + cut);
    updateHUD();
  }

  function nearNpc() {
    // 半径不能大：邻翁的触发圈一旦压到茅屋门口，站在自己家门口按 E
    // 只会弹出对话，永远进不了结算 —— 门被邻居挡住了。
    // 也只在本图的 NPC 里找：两图 NPC 全局找的话，站在墟市能隔空和南山的邻翁说话。
    // 走 mapNpcsOut：已经回家了的人不算在场，
    // 不然「不画他但判定圈还在」—— 站过去按 E，对话对着空气弹
    var best = null, bd = 150;
    var list = mapNpcsOut();
    for (var i = 0; i < list.length; i++) {
      var n = list[i], na = npcAt(n), d = Math.abs(na[0] - S.player.x) + Math.abs(na[1] - S.player.y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  // 已经回家、这个点不在外头的那个人。**没回家就返回 null**。
  // 提示行和 E 键都要靠它说「他回去了」—— 不说的话那个位置按 E 什么也不发生
  function nearGoneNpc() {
    if (!FG.isNight(S.min)) return null;
    var m = curMap(), best = null, bd = 150, i, n, na, d;
    for (i = 0; i < m.npcs.length; i++) {
      n = FG.NPCS[m.npcs[i]];
      if (!n || !npcGone(n)) continue;
      na = npcAt(n); d = Math.abs(na[0] - S.player.x) + Math.abs(na[1] - S.player.y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  function nearHome() {
    // 茅舍门口在画面左侧偏上，判定点对准屋前的空地
    var m = curMap();
    if (!m.home) return false;
    var d = Math.abs(m.home[0] - S.player.x) + Math.abs(m.home[1] - S.player.y);
    return d < m.homeR;
  }

  /* 酿酒已经不是一段单独的代码了：酒是 FG.RECIPES 里的第一条配方，
     和其它七个加工品走同一条路。原来这里那套 canBrew/brew 删掉了 ——
     两套并行的做法迟早只改一边，而「酒能酿、别的不能」是玩家看不出来的。 */

  /* 这个人还肯收酒吗。
     挡 n 为空是有原因的：giveWine 挂在 FG 上（DOM 回调要用），
     任何时候都能被调到，n 没设上就直接 n.wine 会炸。 */
  // 「还收不收酒」看的是**递酒折来的人情分**，不是人情总分。
  //
  // 原来读的是 S.favor，而 favor 是总分：说一句话跨档 +1、办成一件托付 +4。
  // 拿它跟 wine.need（2）比，于是出了两件事：
  // ① **办成邻翁那件托付（+4 分）之后，「递一坛酒」那一行永远消失** ——
  //    玩家一局下来一坛酒都递不出去，那首「过门更相呼」一辈子拿不到，
  //    而这一行是明明白白列在对话卡上的；
  // ② giveWine 里的 `if (got >= need) albumAdd(...)` 同样读 favor，
  //    所以**托付一办，那句话就白送了**。
  //
  // 注意**这里换的是「哪一分」，不是把「一坛算几分」也改了**：
  // need 单位仍然是人情分，而**陈酒抵两份** ——
  // 一坛陈酒（+2）抵得上两坛新酒（+1+1），那是对的设计，别一起改掉。
  // 所以本子是「递酒折来多少分」，不是「递了几坛」。
  // 早先我改成记坛数，把陈酒那一档弄丢了，shoot-skill 的
  // 「一坛就把邻翁喂饱了」当场变红 —— 那是测试替设计说话，测试是对的
  function winePts(id) { return S.jiuPts && S.jiuPts[id] ? S.jiuPts[id] : 0; }
  function canGive(n) { return !!(n && n.wine && S.jiu > 0 && winePts(n.id) < n.wine.need); }

  // 手上最早的那一坛有多陈。jiuYear 只记**酿下的年份**，一年一坛地记；
  // 记不出来的那几坛（开局没有、或者别处直接摆进来的）按新酒算 ——
  // 宁可少算一次人情，也不能让一个来路不明的年份把好感顶上去
  function wineAge() {
    if (!S.jiuYear || !S.jiuYear.length) return 0;
    var y = FG.yearOf(S.day) - S.jiuYear[0];
    return y > 0 ? y : 0;
  }

  /* ---------------- 人情 ----------------
     三档：生 → 熟 → 相知。分 = 说的话 + 递过的坛数×2 + 办成的托付×4。
     **只加不减、不设期限** —— 冷落了他不会怎样，只是没有新的可说。
     判据全在 renTier / renUp 一处，提示行、对话、卡片抬头都读它。 */
  function renFix() {
    if (!S.ren) S.ren = {};
    var id;
    for (id in FG.REN) if (!S.ren[id]) S.ren[id] = { p: 0, tier: 0, day: 0, gave: 0 };
  }
  function renInit() { S.ren = {}; renFix(); }
  // 这个人到第几档（0/1/2）。表里没写就永远是「生」
  function renTier(id) {
    renFix();
    if (!FG.REN[id]) return 0;
    var d = S.ren[id];
    for (var i = FG.REN[id].length - 1; i >= 0; i--) {
      if (d.p >= FG.REN[id][i].at) return i + 1;
    }
    return 0;
  }
  function renName(id) { return FG.REN_TIER[renTier(id)]; }
  /* 加分。**同一天跟同一个人只记一次说话** ——
     不去重的话玩家站在原地连按 E，三档一路涨到底，
     而他一句话也没多说。 */
  function renAdd(id, n) {
    if (!FG.REN[id]) return 0;
    renFix();
    var d = S.ren[id];
    if (n === FG.REN_SPEECH) {
      if (d.day === S.day) return 0;
      d.day = S.day;
    }
    d.p += n;
    return d.p;
  }
  /* 是不是刚刚升了档。升了就给一句这时候才说的话，
     到最高一档再把那样东西给他 —— **一辈子只给一次**。 */
  function renUp(id) {
    var t = renTier(id);
    if (t <= S.ren[id].tier) return 0;
    var step = FG.REN[id][t - 1], before = S.ren[id].tier;
    S.ren[id].tier = t;
    return { t: t, step: step, from: before };
  }
  // 相知那一档的礼。给过就不再给 —— 不然那一档就变成了刷
  function renGift(id) {
    renFix();
    if (S.ren[id].gave) return null;
    var d = FG.REN[id];
    if (!d) return null;
    var last = d[d.length - 1];
    if (!last.gift) return null;
    S.ren[id].gave = 1;
    return last.gift;
  }
  function renForcedLine(id) {
    // 升档那一刻要说的话；没升档就是 null。
    // **压在托付回话前面**：托付办成了要立刻说，而升档这一句说完了就没了
    renFix();
    var t = renTier(id);
    if (t <= S.ren[id].tier || t === 0) return null;
    return { t: t, step: FG.REN[id][t - 1] };
  }

  /* 卡片抬头：**名字后面带上档位**。
     递酒的门槛写在卡片背面，玩家走不到那一步就不知道自己走到哪了。
     「相知」两个字得让人一眼看见 —— 那是这一层唯一看得见的成果。 */
  function dlgName(n) {
    var el = document.getElementById('dlg-name');
    el.textContent = FG.REN[n.id] ? (n.name + '　·　' + renName(n.id)) : n.name;
  }

  function giveWine() {
    var n = dlgNpc;
    if (!n || !canGive(n)) return;    // 「陈」这门手艺是酿到四级才开得了的。判据放在这里而不是造酒那一步：
    // 放在造酒那一步的话，一坛酒摆出去的时候就已经决定它是不是陈的，
    // 玩家中途把酿练到四级，手里那坛到底算不算陈就说不清了
    var aged = hasSkill('niang', 4) && wineAge() >= 1;
    S.jiu--;
    if (S.jiuYear && S.jiuYear.length) S.jiuYear.shift();
    // **先记「递酒折到几分」**，再动人情分。回话挑哪一句、诗册收不收、
    // 还收不收下一坛，读的都是这个数。
    // 陈酒抵两份，所以递一坛可能加 2 分（见 canGive 那段）
    if (!S.jiuPts) S.jiuPts = {};
    S.jiuPts[n.id] = winePts(n.id) + (aged ? 2 : 1);
    var got = S.jiuPts[n.id];
    S.favor[n.id] = (S.favor[n.id] || 0) + (aged ? 2 : 1);
    var wl = n.wine.lines[Math.min(got, n.wine.lines.length) - 1];
    document.getElementById('dlg-text').textContent = wl[0];
    document.getElementById('dlg-from').textContent = wl[1];
    // 递酒也是人情。一坛抵两分 —— 酒是这游戏里唯一不折钱的东西，
    // 它多出来的那一份只能在这儿和那条人情账上体现
    renAdd(n.id, FG.REN_WINE);
    // 递完这一坛要么没酒了，要么他不再收了 —— 两样都表现在这一行上，
    // 留着它让人反复点同一个空动作
    refreshActs();
    toast(n.name + '接过去了。' + (aged ? '陈了一年的，他多喝了一杯。' : ''), aged ? 3200 : 2200);
    if (got >= n.wine.need) albumAdd(n.wine.album);
    save();
    updateHUD();
  }
  /* 对话卡上那两行：「把这一缸酒递过去」和「把这件事说了」。
     两行而不是一行：递酒是支线、托付是主线，合成一行就得让玩家自己挑，
     而挑的那一件会被藏掉（递完就没酒了、办成了就领完了赏），
     剩下的那件在场上却点不着 —— 看着就是「这个按钮坏了」。
     两行各自的显隐各自算，别的地方一次 refreshActs 全刷。 */
  function refreshActs() {
    var a = document.getElementById('dlg-act');
    var b = document.getElementById('dlg-quest');
    if (a) a.classList.toggle('hide', !canGive(dlgNpc));
    if (!b) return;
    var q = dlgNpc ? questOf(dlgNpc.id) : null;
    var can = !!(q && S.quest[q.id] === 'given' && questProgress(q).done);
    b.classList.toggle('hide', !can);
    if (can) b.textContent = '回他的话：' + q.title;
  }
  // 还没托付、但够得着的那些，往哪儿看？**不加面板**。
  // 这个游戏里「未完成的事」只在一个地方出现过：诗册没占位、行动才能得句。
  // 任务再开一面墙就破了这条规矩 —— 所以托付只在他自己嘴里，
  // 想要个总览的人去问人，不想问的人就一件件碰上。
  FG.refreshActs = refreshActs;
  FG.questOf = questOf;
  FG.questProgress = questProgress;
  FG.questLocked = questLocked;
  FG.giveQuest = giveQuest;
  FG.turnInQuest = turnInQuest;

  function handQuest() {
    var q = dlgNpc ? questOf(dlgNpc.id) : null;
    if (!turnInQuest(q)) return;
    var n = dlgNpc;
    document.getElementById('dlg-text').textContent = q.done;
    document.getElementById('dlg-from').textContent = '——';
    refreshActs();
    toast(n.name + '记住了。', 2600);
    // 「引文 + 署名」的排法，跟卡上给诗的那几处一个路子。
    // 写成「邻翁　今年这地托给你」的话，第一人称的标题挂在人名后面
    // 读起来像他又在托一次，而不是已经了了
    rewardPush('了了一桩事', [q.title + '　——' + n.name]);
    FG.audio.play('buy');
  }
  // 对话卡上正对着的是谁。giveWine 由 DOM 事件回调触发，那时没有参数可传，
  // 只能记住刚才 talk() 摆的是谁
  var dlgNpc = null;

  /* ---------------- 溪畔：钓点与采集点 ----------------
     钓点和采集点都只在本图里找 —— 跟 NPC 一个道理，
     全局找的话站在墟市能隔空在南山垂钓。
     判定圈的大小写在这里而不是散在两个函数里：两处站点挨太近的时候，
     E 归谁看的就是这两个半径，而验收要核「够不够远」就得照着
     真实的半径算，不能在测试里另抄一个数 */
  var SPOT_R = { fish: 150, pick: 130, stele: 130, npc: 150, exit: 130, chest: 80, station: 110 };
  // 木箱。摆在茅舍门前的空地上，坐标是对着 nanshan.jpg 的 100px 刻度网量的
  var CHEST = { at: [368, 620], unit: 165 };
  FG.CHEST = CHEST;
  FG.SPOT_R = SPOT_R;
  function mapSpots() { return FG.SPOTS[S.map] || { fish: [], pick: [] }; }

  function nearFish() {
    var list = mapSpots().fish;
    var best = null, bd = SPOT_R.fish, bi = -1;
    for (var i = 0; i < list.length; i++) {
      var d = Math.abs(list[i].at[0] - S.player.x) + Math.abs(list[i].at[1] - S.player.y);
      if (d < bd) { bd = d; best = list[i]; bi = i; }
    }
    return best ? { spot: best, i: bi } : null;
  }

  // 采集点要按「长回来没有」「这个时节有没有」「够不够得着」三道过滤。
  // 不然入冬了还能在草地上捡野莓，入冬了还能站在岸上摸溪心的石头。
  // 记号也不该画出来 —— 不存在的东西不该看见。
  function pickReady(n) {
    // need 写的是「要哪门手艺到几级才够得着」（采四级才下得到水里）
    if (n.need) for (var sk in n.need) if (!hasSkill(sk, n.need[sk])) return false;
    if (n.wet && isWet()) return false;
    // 雪盖住的是**地上的**东西。溪是活的，水里的照旧摸得着 ——
    // 要是一起封了，雪天就一条路都没有，那是惩罚不是天气
    if (!n.wet && isSnow()) return false;
    if (S.picked[nKey(n)] && S.picked[nKey(n)] > S.day) return false;
    return FG.inTerms(S.day, FG.GOODS[n.k] ? FG.GOODS[n.k].terms : '*');
  }
  function nKey(n) { return S.map + ':' + n.at[0] + ',' + n.at[1]; }

  function nearPick() {
    var list = mapSpots().pick, best = null, bd = SPOT_R.pick;
    for (var i = 0; i < list.length; i++) {
      if (!pickReady(list[i])) continue;
      var d = Math.abs(list[i].at[0] - S.player.x) + Math.abs(list[i].at[1] - S.player.y);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return best;
  }
  /* 站在脚边的是哪个点，**不管今天采不采得到**。
     雨天站在水里的荇菜旁边，nearPick() 跳过它 → 提示掉到别的分支 →
     玩家按 E 什么也不会发生，只能站着猜。
     「今天为什么采不到」得由这一句说出来，
     所以查点的那一步不能带着「采得到」这个过滤一起做。 */
  function nearPickSpot() {
    var list = mapSpots().pick, best = null, bd = SPOT_R.pick, i, d;
    for (i = 0; i < list.length; i++) {
      d = Math.abs(list[i].at[0] - S.player.x) + Math.abs(list[i].at[1] - S.player.y);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return best;
  }
  // 采不到的时候得有一句能站得住脚的话，按那一类分别说
  function pickBlockWord(n) {
    if (n.wet && isWet()) return '水涨了　·　下不去';
    if (!n.wet && isSnow()) return '雪压着　·　埋在底下';
    if (n.need) {
      for (var sk in n.need) {
        if (!hasSkill(sk, n.need[sk])) {
          var d = FG.SKILL.byKey(sk);
          return (d ? d.name : sk) + '这门手艺要到 ' + n.need[sk] + ' 级';
        }
      }
    }
    if (S.picked[nKey(n)] && S.picked[nKey(n)] > S.day) return '这儿今天没有';
    return '这个时节没有';
  }

  /* ---------------- 后山：刻石 ----------------
     读碑不是捡石，所以判据比采集点简单，也更硬：
     采集点是「过几天长回来」，刻石是「读过就是读过」——
     石上的字不会过几天又长出来一遍，所以不该给它 back / 长回来这套。
     刻石也不进 S.pouch：它不卖钱，后山不产货，钱只买种子。 */
  function mapSteles() { return mapSpots().stele || []; }
  function steleRead(n) { return !!S.steles[n.id]; }

  function nearStele() {
    var list = mapSteles(), best = null, bd = SPOT_R.stele;
    for (var i = 0; i < list.length; i++) {
      var d = Math.abs(list[i].at[0] - S.player.x) + Math.abs(list[i].at[1] - S.player.y);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return best;
  }

  function readStele(n) {
    if (steleRead(n)) {
      // 读过还能再看一遍原句，但不会再收一次诗 —— 诗册要的是「第一次读懂」
      toast(n.v, 3600);
      return;
    }
    S.steles[n.id] = S.day;
    if (S.book) S.book.steles = (S.book.steles || 0) + 1;
    toast(n.name + '　' + n.v, 4200);
    FG.audio.play('buy');
    // 这里不能传 quiet。quiet 的意思是「此刻有面板开着」，
    // 而读碑时并没有面板 —— 传了就等于让最后那句一直排到第二天才弹。
    // 诗册浮字让路给动作浮字，是 flushAlbum 里的 toastUntil 在管。
    albumAdd('st_' + n.id);
    var all = FG.TAOYUAN.steles, seen = 0, i;
    for (i = 0; i < all.length; i++) if (S.steles[all[i]]) seen++;
    if (seen >= all.length) albumAdd(FG.TAOYUAN.secret);
    save();
  }

  function cast(f) {
    // 等待时间随机，鱼才不像闹钟；窗口长短等上钩了才算
    if (S.book) S.book.casts++;
    S.fishing = { i: f.i, t: 0, wait: 1.0 + Math.random() * 2.8, win: 0, phase: 'wait', spot: f.spot };
    hint('浮漂稳住了　·　等它沉');
  }

  function rollFish() {
    var all = FG.FISH, tot = 0, k;
    for (k in all) if (canFish(all[k])) tot += all[k].w;
    var r = Math.random() * tot;
    for (k in all) {
      if (!canFish(all[k])) continue;
      r -= all[k].w;
      if (r <= 0) return all[k];
    }
    return all.ji;
  }
  // 出不出得着分**两道独立的门**：日子（够不够天数 + 对不对节气）和
  // 时段（是不是带月）。合成一个函数的话，测试只能两样一起测 ——
  // 改一样就误报另一半，而「夜鱼」那一条还会在季节断言里冒出来，
  // 症状是「霜降只剩鲫虾」变成了「霜降有五种鱼」。
  // 季节这一道是纯函数，天数从外面传，验收能对着任意一天核。
  function fishInSeason(day, k) {
    var f = FG.FISH[k];
    return !!(f && f.fromDay <= day && FG.inTerms(day, f.terms));
  }
  // 三道门：够不够日子、这个时节出不出、**眼下是不是带月**（夜鱼）
  // 白天的溪里本来就没有夜鱼，所以第三道门不是「晚上才让钓」，
  // 那是把已经有的东西收走
  function isNight() { return S.min >= FG.DAY.NIGHT; }
  function canFish(f) {
    if (f.night && (!isNight() || !hasSkill('yu', 4))) return false;
    return fishInSeason(S.day, f.id);
  }

  /* 这个钓点此刻出什么鱼。
     节气限鱼要是只在背后生效，玩家永远不会知道为什么霜降天鳜不咬钩 ——
     看不见的规则等于没有规则。所以把当令的鱼名写进提示里，让节气自己说话。 */
  function fishHere() {
    var out = [], k;
    for (k in FG.FISH) if (canFish(FG.FISH[k])) out.push(FG.FISH[k].name);
    return out;
  }

  function reel() {
    var f = S.fishing;
    if (!f) return;
    if (f.phase === 'bite') {
      var fish = rollFish();
      S.pouch[fish.id] = (S.pouch[fish.id] || 0) + 1;
      S.catchCount++;
      bookAdd('fish', fish.id);
      dexAdd('fish', fish.id);
      albumAdd('firstFish');
      skillAdd('yu', 'catch');
      totalAdd('catch', 1);
      toast('钓上来一条' + fish.name + '。', 2600);
      FG.audio.play('buy');
    } else {
      toast('提竿早了，鱼影子都没看见。', 2000);
    }
    S.fishing = null;
  }

  function pick(n) {
    var g = FG.GOODS[n.k];
    if (!g) return;
    S.pouch[n.k] = (S.pouch[n.k] || 0) + 1;
    S.picked[nKey(n)] = S.day + (n.back || 3);
    bookAdd('picks', n.k);
    dexAdd('good', n.k);
    albumAdd('firstPick');
    skillAdd('cai', 'pick');
    toast('采到' + g.name + '。', 2000);
    FG.audio.play('buy');
    save();
  }

  /* 抛竿之后由主循环推进：等 -> 咬 -> 错过。
     走远了或者天黑了要把线收回来，不然浮漂会一直挂在别人的钓点上。 */
  function stepFishing(dt) {
    var f = S.fishing;
    if (!f) return;
    if (nearNpc() || nearExit() || nearHome() || nearFish() === null) { S.fishing = null; return; }
    // **判据是熄灯（DAY.END），不是天擦黑（DUSK），也不是带月（NIGHT）。**
    //
    // 原来写的是 isDark，也就是 17:30 收线；而夜鱼（黄鳝、鳝鲿）的判据是
    // isNight，带月 20:00 才出。两个数一比就知道出事：**夜鱼的窗口宽度是 0。**
    // 玩家照渔四级那句解锁文案「带月以后溪里另出两种鱼」熬到 20 点，
    // 走到溪边按 E，竿抛出去了、下一帧就被收走，只回一句「看不清浮漂」。
    // 整整一轮 288 天试了 72 次，**一次都没钓上来过** ——
    // 那两种鱼在这个游戏里是钓不到的，图鉴那两格也永远填不上。
    //
    // 中间试过把判据挪到 isNight，**那还是 0 宽**：
    // 20:00 一到既出夜鱼、又被收线，正好撞在同一个点上。
    // 收线只能再往后推到熄灯 22:00，窗口才是 20:00—22:00
    // 这两个小时（MIN_PER_SEC=3，约 40 真实秒），够抛两三竿。
    // 代价是薄暮到带月那一段不再收线 —— 但那一段本来就不该收，
    // 溪里傍晚还是看得见浮漂的
    if (S.min >= FG.DAY.END) {
      S.fishing = null;
      toast('灯要灭了，溪里看不清浮漂，把线收了。', 3200);
      return;
    }
    f.t += dt;
    if (f.phase === 'wait') {
      if (f.t >= f.wait) {
        f.phase = 'bite'; f.t = 0;
        // 难钓的鱼窗口更短：0.75s 到 0.33s
        f.win = 0.75 - 0.42 * (FG.FISH[rollFishIdHint(f)] ? FG.FISH[rollFishIdHint(f)].hard : 0.3);
        FG.audio.play('buy');
      }
    } else if (f.phase === 'bite') {
      if (f.t >= f.win) {
        S.fishing = null;
        toast('鱼咬了一口，游走了。', 2200);
      }
    }
  }
  // 只为算窗口长度，不真正决定这次钓上什么（决定权在提竿那一刻）
  function rollFishIdHint(f) {
    var all = FG.FISH, tot = 0, k, d = Math.abs(f.spot.at[0] - 560) + Math.abs(f.spot.at[1] - 500);
    // 离岸越远越难：东潭比西汊难
    var far = Math.min(1, d / 900);
    for (k in all) if (canFish(all[k])) tot += all[k].w * (1 - far * 0.6);
    var r = Math.random() * tot;
    for (k in all) {
      if (!canFish(all[k])) continue;
      r -= all[k].w * (1 - far * 0.6);
      if (r <= 0) return k;
    }
    return 'ji';
  }

  function nearExit() {
    var m = curMap();    for (var i = 0; i < m.exits.length; i++) {
      var e = m.exits[i];
      var d = Math.abs(e.at[0] - S.player.x) + Math.abs(e.at[1] - S.player.y);
      if (d < e.r) return e;
    }
    return null;
  }

  /* ---------------- 一天结束 ---------------- */
  function endDay(auto) {
    if (S.ended) return;
    S.ended = true;
    S.fishing = null;          // 天黑了得收线，不能让浮漂挂到明天
    var v = FG.verseOfDay(S.day);

    // 出货：只出货箱里的东西。手里没放进去的留在篮里过夜。
    // 「天黑自动全卖」是上一版的做法：篮子当天收成当天清空，玩家不用做任何
    // 决定，于是「收多少、留多少、哪一样明天要吃」这三件事一个都不成立。
    // 现在遍历的是 S.bin 而不是 FG.BAG —— 遍历 FG.BAG 那版只差一个数据源，
    // 但那是另一套经济：钱不再等于篮子，而是等于玩家当天愿意放手的东西。
    var earned = 0, lines = [], bk, bt, bn, qx = FG.QUALITY[binQ()].x;
    for (bk in S.bin) {
      bn = S.bin[bk] || 0;
      if (bn <= 0) continue;
      bt = FG.BAG_IDX[bk];
      // 箱里理论上不会有不卖钱的东西（放的时候就挡住了）。
      // 真出现了也只清掉不折钱，不能反过来去读 FG.BAG_IDX[undefined]
      if (!bt || !bt.sell) { delete S.bin[bk]; continue; }
      // 折钱按**箱上记的那一档**，不是按原价 —— 玩家安排好「这一箱是几级手艺装的」，
      // 到结算时就得照那一档算，中途手艺涨了也不追认（东西装进去就已经定了）
      earned += Math.round(bn * bt.sell * qx);
      lines.push(bt.name + ' ' + bn + ' → ' + Math.round(bn * bt.sell * qx) + ' 钱'
        + (qx === 1 ? '' : '（' + FG.QUALITY[binQ()].n + ' ×' + qx + '）'));
    }
    if (qx > 1) lines.unshift('这一箱按' + FG.QUALITY[binQ()].n + '折（' + FG.QUALITY[binQ()].need + '）');
    S.bin = {};
    S.binQ = 0;   // 箱子空了，档也就没了 —— 下一箱重新记
    S.gold += earned;
    if (S.book) S.book.earned += earned;
    // 一生累计，钱花回零这个不回零 —— 「一世异朝市」看的是攒过多少，不是手上还剩多少
    S.earned += earned;
    if (S.earned >= 2000) albumAdd('trade', true);
    albumAdd('firstHome', true);   // 结算面板正开着，浮字等面板关了再弹

    // 生长：浇过水的进一阶段
    // 循环必须按 S.plots 自己的尺寸走，不能按 F.ROWS/F.COLS ——
    // 站在溪畔过夜时 F.on=false，F.apply 把 COLS/ROWS 置成了 1，
    // 按它循环就只处理第 0 格，南山那 24 格田整整一夜不生长。
    var grown = 0;
    for (var r = 0; r < S.plots.length; r++) {
      for (var c = 0; c < S.plots[r].length; c++) {
        var pl = S.plots[r][c];
        if (!pl) continue;
        if (pl.crop) {
          if (pl.wet) { pl.stage++; grown++; }
          pl.wet = false;
        }
      }
    }

    S.todayEarned = earned;
    var el = document.getElementById('de');
    el.querySelector('.v').textContent = '「' + v[0] + '」';
    el.querySelector('.v2').textContent = v[1] + (auto ? '　·　天黑了，鸡犬相闻' : '');
    // 溪畔那种没有田的图，结算里不能说"没有浇过水的" —— 名和实对不上。
    // 有田才报长势，没田就报今天钓了多少尾。
    el.querySelector('.body').innerHTML =
      (lines.length ? lines.map(function (s) { return '<div class="ln">' + s + '</div>'; }).join('')
        : '<div class="ln dim">' + (F.on ? '箱子空着，明日再种。' : '一无所获，明日再来。') + '</div>')
      + (F.on
        ? '<div class="ln dim">' + (grown ? grown + ' 畦见长。' : '没有浇过水的，停在原地。') + '</div>'
        : '<div class="ln dim">今日垂钓 ' + S.catchCount + ' 尾。</div>')
      + (leftToShip() ? '<div class="ln dim">篮里还有 ' + leftToShip() + ' 样没放出去，按 O 放箱里，明日就折钱。</div>' : '')
      + '<div class="ln gold">今日进项 ' + earned + ' 钱　结余 ' + S.gold + '</div>';
    el.classList.remove('hide');
  }

  /* ---------------- 年结 ----------------
     一年 144 天跑完，给一次回顾，然后接着过第二年 —— 没有终点，
     但要有「一年过完了」这个时刻，否则玩家不知道自己在哪儿。
     用的是同一个 #de 面板，只是把话换成一年的账。 */
  function showYearEnd(year) {
    var b = S.book || { crops: {}, fish: {}, picks: {}, casts: 0, earned: 0 };
    var el = document.getElementById('de');
    var lines = [];

    function tally(book, table, unit) {
      var parts = [], k, n = 0;
      for (k in book) {
        if (!book[k]) continue;
        n += book[k];
        var t = table[k];
        parts.push((t ? t.name : k) + ' ' + book[k] + ' ' + unit);
      }
      if (!parts.length) return null;
      return { text: parts.join('　'), n: n };
    }

    var c = tally(b.crops, FG.CROPS, '束');
    if (c) lines.push('<div class="ln">收了 ' + c.n + ' 束谷：' + c.text + '</div>');
    var f = tally(b.fish, FG.FISH, '尾');
    if (f) lines.push('<div class="ln">钓了 ' + f.n + ' 尾鱼：' + f.text + '</div>');
    var p = tally(b.picks, FG.GOODS, '份');
    if (p) lines.push('<div class="ln">采了 ' + p.n + ' 份山货：' + p.text + '</div>');
    if (b.casts) lines.push('<div class="ln dim">抛竿 ' + b.casts + ' 次，空手 ' + (b.casts - (f ? f.n : 0)) + ' 回。</div>');
    // 刻石一整年只能读六方，所以不分组不折叠，一行说完
    if (b.steles) lines.push('<div class="ln dim">读过 ' + b.steles + ' 方刻石。</div>');
    // 「什么也没干」那句要先判，再报手艺 ——
    // 放在后面的话 lines 永远非空，这句就成了一段死代码，
    // 而它恰恰是玩家一年颗粒无收时唯一该看到的那句
    var noYield = !lines.length;
    // 地歇了多久。**排在 noYield 后面、且只在有收成时写** ——
    // 无条件推进来的话 lines 永远非空，上面那句就永远不出现。
    // 一年里三成六的日子一锄也下不去去，这一行是让玩家看见
    // 「休耕」这件事真的存在，而不只是「我那阵子懒得种」
    if (!noYield) {
      var rest = 0, i2;
      for (i2 = 1; i2 <= FG.SOLAR_YEAR; i2++) if (FG.groundFrozen(i2)) rest++;
      lines.push('<div class="ln dim">地歇了 ' + rest + ' 天。剩下的日子，灶上、硐里、溪边都还开着。</div>');
    }
    // 五门手艺也报一行。写法是「耕 6　渔 4」这样一串，不分行 ——
    // 年结这块是回顾，不是分项报告，分五行会把上面的收成挤到看不见
    var sk = [], i, d;
    for (i = 0; i < FG.SKILL.list.length; i++) {
      d = FG.SKILL.list[i];
      sk.push(d.name + ' ' + skillLv(d.k) + ' 级');
    }
    lines.push('<div class="ln dim">手艺：' + sk.join('　') + '。</div>');
    // 托付也报一行。写「办成了几件」而不是「还差几件」——
    // 托付不设期限，报「还差」等于凭空给它们安了一个 deadline
    var doneQ = 0;
    for (i = 0; i < FG.QUESTS.length; i++) if (S.quest[FG.QUESTS[i].id] === 'done') doneQ++;
    if (doneQ) lines.push('<div class="ln dim">邻里的托付办成了 ' + doneQ + ' 件。</div>');
    if (noYield) lines.unshift('<div class="ln dim">这一年什么也没收成。</div>');
    lines.push('<div class="ln gold">一年进项 ' + b.earned + ' 钱</div>');

    el.querySelector('.v').textContent = '「农务各自归，闲暇辄相思。」';
    // 出处必须写在这儿。句子的来历容易被记错：这不是《归园田居》，
    // 是《移居·其二》——维基文库 pageid 45372 核过。别处引陶诗一律连作者一起核。
    el.querySelector('.v2').textContent = '《移居·其二》　·　第 ' + year + ' 年 · 岁有其终　·　二十四节气走完了一轮';
    el.querySelector('.body').innerHTML = lines.join('');
    document.getElementById('de-next').textContent = '明 春';
    el.classList.remove('hide');
    albumAdd('yearEnd', true);
    if (year >= 2) albumAdd('yearEnd2', true);
  }

  function startDay(silent) {
    S.ended = false;
    S.min = FG.DAY.START;
    S.stam = S.maxStam;
    S.todayWatered = 0;
    S.catchCount = 0;      // 结算里写的是「今日垂钓 N 尾」，得按天清零
    S.talkIdx = 0;
    S.walkTo = null;
    S.touchGo = false;
    // 灶上今天还能做几口，是按「今天已经做了几口」数的。
    // **不归零的话跨过一天还是满的** —— 读档进来也是，
    // 而症状是「睡了一觉灶还是用不掉」
    S.cookN = 0;
    document.getElementById('de').classList.add('hide');
    document.getElementById('hud').classList.remove('hide');

    // 刚过去的是这一年的最后一天（只在「玩家主动推进」时判，
    // 读档进游戏时 silent=true，不能对着旧年份弹年结）
    var yearEnd = !silent && FG.dayOfYear(S.day) === FG.SOLAR_YEAR;
    if (!silent) { S.day++; }
    // 早上这两件事只在**真过了一天**的时候做。
    // startDay(true) 是读档和开新局走的同一条路：读档也下蛋的话，
    // 读一次档草窝里就多一枚 —— 不必养鸡，存读档就能把蛋刷出来。
    // 跨年那一条也在这儿（不是挪到年结那个 return 之后）：
    // 跨年当天早上鸡照样下蛋、水照样引，挪过去就凭空少一天
    if (!silent) {
      buildFix();
      keepMorning();
      dogMorning();
      if (S.build.ditch > 0) ditchWater(FG.BUILD.ditch.lv[S.build.ditch - 1].rows);
      // 天气也只在这一个 if 里定。读档不该换天气 ——
      // 换了的话「读一次档避开雷雨天」就白捡了。存读档本来是玩家对付
      // 随机事件的正当手段，不该堵死，但也不该放大成「每读一次重掷一次」
      S.weather = FG.weatherOf(S.day);
      weatherFix();
      if (isWet()) rainWater();
    } else {
      weatherFix();
    }
    // 一年里第一次进藏季，说一句。撞了「地冻上了」才知道冬天到了，
    // 那是让玩家自己撞墙 —— 这条是让他**第一天就知道**。
    // 排在天气那句后面：两个抬头不一样，不会被并成一条
    if (!silent && FG.groundFrozen(S.day) && !FG.groundFrozen(S.day - 1)) {
      var wn2 = FG.seasonOf(S.day);
      rewardPush(wn2.n, [wn2.note]);
    }
    // 过节那天早上也说一句。节日是「一年里少有的几天」，
    // 早上不吭声的话玩家得自己撞见广场上站了一排人
    if (!silent) {
      var fst = festivalOn(S.day);
      if (fst) rewardPush(fst.name, ['墟市广场上站着 ' + festCrowd(fst).length + ' 位']);
    }
    if (S.book) S.book.last = S.day;
    if (!S.book) bookInit();
    if (yearEnd) {
      document.getElementById('de-next').textContent = '明 春';
      showYearEnd(FG.yearOf(S.day) - 1);
      // 账本要换新的一年。诗册（还没做）是跨年的，账本不是。
      bookInit();
      updateHUD();
      return;
    }
    document.getElementById('de-next').textContent = '晨 兴';
    if (FG.solarOf(S.day).k === 'shuangjiang') albumAdd('frost');
    var v = FG.verseOfDay(S.day);
    toast('「' + v[0] + '」', 4200);
    // 天气压在当日那句诗后面。用的是奖励队列，可它并不只装奖励 ——
    // flushReward 会自己让开正在显示的那句，也会在面板开着的时候按住，
    // 这两件事正是这里要的。抬头写天气名，于是它不会跟「得了三句」并成一条
    if (S.weather !== 'sun') {
      var wn = FG.WEATHER[S.weather];
      rewardPush(wn.name, [wn.note]);
    }
    if (rewardQ.length) scheduleReward(2600);
    updateHUD();
  }
  FG.nextDay = function () { startDay(false); };

  /* ---------------- 绘制 ---------------- */
  // 硐里比地面上暗，而且越深越暗。整张压一层淡墨就行，不必每层出一张底图 ——
  // 五层五张图既慢，又难保持同一构图（岩石是按同一套梯形摆的）。
  // 压**底图**而不是压整个画面：代码画的东西（石头、落点、人、悬停高亮）
  // 都留在原亮度上，读起来就是「光在你自己身上」，该点得动的东西不会被压暗。
  // 写成函数是为了让验收能直接核「越深越暗」，而不是靠肉眼看两张截图
  function mineDim() { return 0.12 + (Math.max(1, S.mineFloor) - 1) * 0.036; }

  function render() {
    if (bgReady) { x.drawImage(bg, 0, 0); }
    else { x.fillStyle = '#e8e0cc'; x.fillRect(0, 0, W, H); }

    if (inMine()) {
      x.save();
      x.fillStyle = 'rgba(38,34,30,' + mineDim().toFixed(3) + ')';
      x.fillRect(0, 0, W, H);
      x.restore();
    }

    // 悬停格：跟着 core.js 换算好的画布坐标走
    S.hover = (S.started && !S.ended) ? F.pick(FG.input.mouse.x, FG.input.mouse.y) : null;
    // 铜锄铁锄一框好几畦，所以高亮的是**这一下真会动到的那几格**，
    // 不是光标底下那一格。只框中间一格的话，玩家是在看不见的范围上点
    if (S.hover) {
      var span = hoverSpan();
      if (span) for (var si = 0; si < span.length; si++) I.markCell(x, F.cellQuad(span[si][0], span[si][1]));
      else I.markCell(x, F.cellQuad(S.hover[0], S.hover[1]));
    }

    // 田畦：由远及近画，远的先画，近的自然盖住远的
    // 墟市这类没有田的图，plots 是空数组，得整段跳过 —— 否则 S.plots[0] 是 undefined。
    // 石硐也带 quad，所以判据是 farm 标志而不是 F.on（见 gotoMap 那段）
    var farmOn = !!curMap().farm;
    for (var r = 0; farmOn && r < F.ROWS; r++) {
      for (var c = 0; c < F.COLS; c++) {
        var pl = S.plots[r][c];
        if (!pl) continue;
        var q = F.cellQuad(c, r);
        var ctr = F.cellCenter(c, r);
        var cw = F.cellWidth(c, r);
        var ch = F.cellHeight(c, r);
        if (pl.tilled) I.soil(x, q, pl.wet);
        // 谷物落在畦的下缘，别悬在格心
        if (pl.crop) I.grain(x, pl.crop, pl.stage, ctr[0], ctr[1] + ch * 0.32, cw, ch);
        // 留茬：割过一次的再生作物。**画在谷物底下** ——
        // 茬是从地里立起来的，不是浮在苗前面的一层
        if (pl.crop && C[pl.crop].regrow && pl.stage > 0 && pl.stage < C[pl.crop].days) {
          I.stubble(x, q, pl.stage > C[pl.crop].days - C[pl.crop].regrow);
        }
      }
      // 积雪。**画在田畦之后、人物之前** —— 雪是铺在地上的，
      // 人站在雪上面，而人身上不该盖一层白
      if (isSnow()) drawSnowOnField();
    }

    // 石硐：一层就是墙上那 18 块。敲开了就不画石头，改画一个挖空的洞，
    // 玩家一眼能看出这一层还剩多少、剩下的是哪几块
    if (inMine()) {
      for (var mr = 0; mr < F.ROWS; mr++) {
        for (var mc = 0; mc < F.COLS; mc++) {
          var ctr2 = F.cellCenter(mc, mr);
          var cw2 = F.cellWidth(mc, mr), ch2 = F.cellHeight(mc, mr);
          I.rock(x, ctr2[0], ctr2[1] + ch2 * 0.36, cw2 * 0.94, ch2 * 0.92,
                 rockAt(S.mineFloor, mc, mr), mr * F.COLS + mc);
        }
      }
      // 落点画在最后 —— 它在人物脚边的地上，人站在旁边时该被挡住一部分
      var shf = curMap().shaft;
      if (shf) I.shaft(x, shf.at[0], shf.at[1], 150 * F.scaleAtY(shf.at[1]), mineCleared(S.mineFloor));
    }

    // 溪畔：钓点的浮漂 + 采集点。画在田畦之后、人物之前 ——
    // 浮漂在水里，本来就该被站在近处的人挡住。
    var sp = mapSpots();
    if (S.fishing) {
      var fp = S.fishing.spot.at;
      I.floater(x, fp[0], fp[1], S.fishing.phase === 'bite' ? 1 : 0, S.fishing.t);
      if (S.fishing.phase === 'bite') I.biteRing(x, fp[0], fp[1], S.fishing.t / S.fishing.win);
    }
    for (var si = 0; si < sp.pick.length; si++) {
      var pn = sp.pick[si];
      if (!pickReady(pn)) continue;
      I.node(x, pn.k, pn.at[0], pn.at[1], 36 * F.scaleAtY(pn.at[1]));
    }

    // 人：按脚下的 y 排序，靠下的后画，近处自然挡住远处
    var ppl = [];
    // 刻石和洞口也是按脚下 y 进这个队列的，不是在上面单独画 ——
    // 单独画的话，站在坡上（比洞口更远）的玩家会被画到洞口前面，
    // 人整个压在山腰上。后山那片地 y540-930 落差近 400px，这种错一眼就看得出来。
    var steles = mapSteles();
    for (var ti = 0; ti < steles.length; ti++) {
      (function (n) {
        ppl.push({
          y: n.at[1], draw: function () {
            // 116 是量出来的：按 1× 实拍，78 高的石柱被农人一站就整个盖住，
            // 「这里有块刻着字的石头」这件事玩家根本收不到
            I.stele(x, n.at[0], n.at[1], 116 * F.scaleAtY(n.at[1]), steleRead(n));
          }
        });
      })(steles[ti]);
    }
    var exs = curMap().exits;
    for (var ei = 0; ei < exs.length; ei++) {
      var ee = exs[ei];
      // cave = 山体上的一个洞（自己带岩体）；adit = 已经有一面暗岩了，
      // 只要在墙上开一道口（硐里那道回去的路就是这种）。两种分开画，
      // 不然硐口外面会再糊一块岩体，看着像两个洞口
      if (!ee.cave && !ee.adit) continue;
      (function (e) {
        ppl.push({
          y: e.at[1], draw: function () {
            if (e.cave) {
              // 260 是量出来的：320 时南山口那个洞盖住了最远一排田的上沿，
              // 看着像块纸板贴在远山上；再小就只剩一个黑点了
              I.cave(x, e.at[0], e.at[1], (e.adit || 260) * F.scaleAtY(e.at[1]));
            } else {
              I.adit(x, e.at[0], e.at[1], e.adit * F.scaleAtY(e.at[1]));
            }
          }
        });
      })(ee);
    }
    // 营造也进这个队列。鸡舍是这游戏里最大的一个立起来的东西 ——
    // 单独画在别处的话，站在坡上（比鸡舍更远）的玩家会被画到棚子前面，
    // 看着像人从棚子里穿过去。南山那片地 y 差四百多，这种错一眼就看得出
    var bl = buildList();
    for (var bi = 0; bi < bl.length; bi++) {
      (function (b) {
        ppl.push({
          y: b.def.at[1], draw: function () {
            var u = buildUnit(b.id) * F.scaleAtY(b.def.at[1]);
            if (b.id === 'ditch') I.ditch(x, b.def.at[0], b.def.at[1], u, S.build[b.id] || 0);
            else if (b.id === 'warm') I.warm(x, b.def.at[0], b.def.at[1], u, S.build[b.id] || 0);
            else if (b.id === 'gou') I.dogHouse(x, b.def.at[0], b.def.at[1], u, S.build[b.id] || 0, dogPose());
            else I.keep(x, b.def.at[0], b.def.at[1], u, S.build[b.id] || 0, keepPose(b.id), b.id);
          }
        });
      })(bl[bi]);
    }
    // 机器也进这个队列，理由跟营造一样：坛也立在院里，
    // 站在坡上的人不该被画到坛子前面
    var ml2 = machList();
    for (var mi2 = 0; mi2 < ml2.length; mi2++) {
      (function (mm2) {
        ppl.push({
          y: mm2.def.at[1], draw: function () {
            var lv2 = S.mach.lv[mm2.id] || 0;
            var u = (lv2 > 0 ? mm2.def.lv[lv2 - 1].unit : 150) * F.scaleAtY(mm2.def.at[1]);
            I.machine(x, mm2.def.at[0], mm2.def.at[1], u, lv2, machJob(mm2.id), mm2.id);
          }
        });
      })(ml2[mi2]);
    }
    var list = mapNpcsOut();
    for (var k = 0; k < list.length; k++) {
      (function (n) {                       // IIFE 闭包，否则循环里的 k 会被最后一个值覆盖
        var na1 = npcAt(n);                 // 过节那天这个人挪到广场去
        ppl.push({
          y: na1[1], draw: function () {
            // 同样按脚下缩放：之前 NPC 写死 unit，站远了也不变小，
            // 和老农并排时一眼就看出不在同一进深上
            I.drawFig(x, n.id, na1[0], na1[1], n.unit * F.scaleAtY(na1[1]));
          }
        });
      })(list[k]);
    }
    // 歇脚处：一块路边的小碑 + 一截石阶。**没修路也照样画着** ——
    // 它本来就在那儿，缺的是路不是碑；不画的话玩家永远不知道那地方有东西
    var stm = stationOf();
    if (stm) {
      (function (sm) {
        ppl.push({
          y: sm.station[1], draw: function () {
            // 150 不是随手写的：132 那版缩到 0.743× 之后剩下的那点高度
            // 刚好被提示行压住大半，看着像画上多了一块石头。
            // 提示行是压在人头上的，玩家站在碑跟前时它一定挡着一部分 ——
            // 所以碑得**自己**站得住
            I.stationMark(x, sm.station[0], sm.station[1], 150 * F.scaleAtY(sm.station[1]), sm.stationName);
          }
        });
      })(stm);
    }
    ppl.push({
      y: CHEST.at[1], draw: function () {
        // 跟人一样按脚下深度缩放：木箱搁在院里，
        // 玩家走到它跟前得看着变大一点才对得上
        I.chest(x, CHEST.at[0], CHEST.at[1], CHEST.unit * F.scaleAtY(CHEST.at[1]), S.chest);
      }
    });
    ppl.push({
      y: S.player.y, draw: function () {
        var u = 150 * F.scaleAtY(S.player.y);
        var bob = S.player.walk > 0 ? Math.sin(S.player.walk) * 2.2 : 0;
        I.drawFig(x, 'farmer', S.player.x, S.player.y + bob, u);
      }
    });
    ppl.sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < ppl.length; i++) ppl[i].draw();

    drawRain(tNow / 1000);
    drawSnowFall(tNow / 1000);

    // 天色。**盖在人物之后** —— 盖在底图之后的话，田、屋、人全是亮的，
    // 等于只给画上加了层滤镜而画上的东西还站在大太阳底下。
    // 硐里不盖：地下没有天光，硐自己的暗管那件事。
    var night = inMine() ? 0 : FG.nightAmount(S.min);
    if (night > 0) I.sky(x, W, H, S.min);
    // 灯在色罩**之后**：它是这一片夜里唯一亮的东西，
    // 跟着一起被压暗就等于没点灯
    if (night > 0) {
      var lamps = FG.LAMPS[S.map] || [];
      for (var li = 0; li < lamps.length; li++) {
        I.lamp(x, lamps[li][0], lamps[li][1], 150 * F.scaleAtY(lamps[li][1]), night);
      }
    }

    // 交互提示。顺序和 E 键的处理必须一致 —— 不然提示写着"垂钓"
    // 按下去却开了对话，玩家会以为游戏坏了。
    if (S.started && !S.ended) {
      if (S.fishing) {
        hint(S.fishing.phase === 'bite' ? 'E　提竿！' : '浮漂稳住了　·　等它沉');
      } else if (inMine()) {
        hintMine();
      } else if (S.pendingSeed) {
        // 手上捏着种的时候，提示行只说这一件事。
        // 混着写「E 说话 / E 归家 / 点畦下种」等于把三个可选动作摆成一排，
        // 玩家得自己挑，而 E 在这里是完全无关的
        var pc = C[FG.CROP_OF_SEED[S.pendingSeed]];
        hint(pc
          ? ('捏着' + pc.name + '种　·　点一畦翻好的土　·　Tab 放下')
          : '这包种认不出来　·　Tab 打开行囊放下');
      } else {
        var n = nearNpc();
        // 过节那天的墟市：站着的人聚在广场上，提示行也得改口径。
        // 还差几个人就直接写出来 —— 剩下的人站在广场另一头，
        // 不说清楚的话玩家挨个找一圈就以为节日结束了
        var ff0 = festivalOn(S.day);
        // 已经回家的那位先取出来。判在哪一层：hint 这一串是「先判到的赢」，
        // 而在场的（n）永远优先 —— 人就在那儿，不会既在场又已回家
        var gone0 = n ? null : nearGoneNpc();
        // 「快到了」那一句**不是一条分支**，是给底下那句加个尾巴。
        // 写成 else if 的话它会把节日那句顶掉 —— 而节日那句是限时的
        // （「还差 N 位」，跟人说过一句就换一个数，说完就没了），
        // 「再有 7 天他生辰」是不着急的 advisary，抢在前头就是拿小事压大事。
        // 只有「今天他生辰」才配独占一行：它一年只有一天，等不得。
        var bSoon = (n && birthSoon(n.id)) ? ('　·　再有 ' + birthIn(n.id) + ' 天他生辰') : '';
        if (n && birthToday(n.id)) {
          hint('E　与' + n.name + '说话' + (n.shop ? '　·　B 看货' : '') + '　·　今天他生辰');
        }
        else if (n && ff0 && FG.FEST_SPOTS[n.id]) {
          var lv = festLeft(ff0);
          hint((festSaid(n) ? (n.name + '　·　这会儿没什么可说的了')
               : (lv > 1 ? ('E　' + n.name + '说句话　·　还差 ' + (lv - 1) + ' 位')
                         : 'E　' + n.name + '说句话　·　最后一位')) + bSoon);
        }
        else if (n) hint((n.shop ? ('E　与' + n.name + '说话　·　B 看货') : ('E　与' + n.name + '说话')) + bSoon);
        // 已经回家的人也要给一行字。人不在了却什么都不说，
        // 玩家站在原地按 E 什么也不发生，只会觉得这个 NPC 坏了
        else if (gone0) hint(gone0.name + '　·　这个点他回家了');
        else if (nearFish()) {
          // 当令的鱼全列出来，不折叠。鱼最多同时五种（鲤夏至收、鳖小暑出，
          // 两段不重叠），五个名字一行放得下；早先按「超过四条收成『等 N 种』」
          // 处理，反而写出「列了四条还说等五种」这种自相矛盾的话。
          var fsp = nearFish(), here = fishHere();
          hint('E　在' + fsp.spot.name + '垂钓' +
               (here.length ? '　·　此时有 ' + here.join('、') : '　·　此时无鱼'));
        }

        // 采集点先看「脚边有没有点」，再看「今天采不采得到」。
        // 反过来写的话，雨天站在溪心的荇菜旁边，nearPick() 跳过它 →
        // 提示掉到后面的分支 → 按 E 什么也不会发生，人只能站着猜。
        // 采不到也要给一句说清楚为什么的话
        else {
          var pk0 = nearPickSpot();
          if (pk0 && pickReady(pk0)) hint('E　采' + FG.GOODS[pk0.k].name);
          else if (pk0) hint(pickBlockWord(pk0) + '　·　' + FG.GOODS[pk0.k].name);
          else {
            var st = nearStele();
            // 读过的石头也要给一行字：站着看见的是块光板，玩家会以为
            // 「这地方什么都没有」，不知道它读过没读过。
            if (st) hint(steleRead(st) ? (st.name + '　·　字已读过') : ('E　读' + st.name));
            else {
              // 营造跟上面 E 键那一串同一个顺序。没造的时候也给一行字 ——
              // 地上那几根木桩不解释，光站着看是看不出「这儿能造个鸡舍」的。
              // **判据用 nearBuildHint（认所有营造），不是 nearBuild（只认有 E 的）** ——
              // 后者站在水渠和温窒跟前是一声不吭，而那两样恰恰是「造了什么就变好了」的
              var bd2 = nearBuildHint(), mq2 = null;
              if (bd2) {
                buildFix(); keepFix();
                // 提示行要写出棚**现在的状态**，不能只写「按下去会发生什么」。
                // 门关着还是开着、草窝里有没有粮、粮还够几天、堆着几份 ——
                // 四件事玩家站着都要看得见，不然只能一次次按下去试
                if (bd2.def.act) {
                  // 狗窝那一支：窝边有东西才写得出来
                  if (bd2.id === 'gou') {
                    buildFix(); dogFix();
                    var dq = dogPose();
                    hint(S.build.gou
                      ? (dq.n > 0
                          ? ('E　收下狗叼的' + FG.BAG_IDX['good_' + dq.k].name + '　·　' + dq.n + ' 份')
                          : ('狗窝　·　' + dogDays() + ' 天一趟　·　还没叼回来'))
                      : ('这儿空着　·　墟市老丈那儿有狗窝卖'));
                  }
                  else {
                  var ko = keepState(bd2.id), ky = bd2.def.lv[(S.build[bd2.id] || 1) - 1];
                  var knm = FG.BAG_IDX[ky.yield.k].name;
                  hint(S.build[bd2.id]
                    ? (ko.got > 0
                        ? ('E　' + bd2.def.pick + ' ' + knm + '　·　' + (ko.got * ky.yield.n) + ' ' + ky.noun)
                        : (ko.gate
                            ? (ko.feed > 0
                                ? ('门开着　·　没有' + knm + '　·　粮够 ' + ko.feed + ' 天　·　E 关门')
                                : '门开着　·　没有粮了　·　E 撒一把')
                            : ('门关着　·　E 开门（顺手撒把粮）')))
                    : ('这儿空着　·　墟市老丈那儿有' + bd2.def.name));
                  }
                }
                else hint(buildIdleWord(bd2));
              }
              else if ((mq2 = nearMachine())) {
                // 坛的状态也得站着看得见：腌着没有、还差几天
                machFix();
                var jlv = S.mach.lv[mq2.id] || 0;
                if (!jlv) hint('这儿空着　·　墟市老丈那儿有坛卖');
                else {
                  var j2 = machJob(mq2.id);
                  if (!j2) {
                    // 空坛写「E 搁一把料进去」之前先看手上有没有料。
                    // 提示行写的是「按下去会发生什么」——
                    // 一手空的时候按下去什么也不会搁，那句话就成了骗人
                    if (machCanPut(mq2.id, machRcp(mq2.id))) hint('坛子是空的　·　E 搁一把料进去');
                    else hint('坛子是空的　·　' + machWant(mq2.id));
                  }
                  else if (S.day >= j2.at) hint('E　起坛　·　好了 ' + j2.n + ' 份' + FG.BAG_IDX[j2.out].name);
                  else hint('腌着' + FG.BAG_IDX[j2.out].name + '　·　还差 ' + (j2.at - S.day) + ' 天');
                }
              }
              else if (nearChest()) {
                // 箱里空不空都要说：空箱子也该知道摆在哪、
                // 摆了什么 —— 站着看见一个木箱而提示是「E 归家」，
                // 玩家只会以为那是块垫脚石
                var cn = chestCount();
                hint(cn ? ('E　开木箱　·　里面搁着 ' + cn + ' 件') : 'E　开木箱　·　空的');
              }
              else if (nearHome()) {
                // 进屋。提示行只说按下去会发生什么：屋里那四行自己会说话
                hint(canCook()
                  ? ('E　进屋　·　灶还能做 ' + (cookCap() - S.cookN) + ' / ' + cookCap() + ' 口')
                  : 'E　进屋 · 歇了就到明早');
              }
              else if (nearStation()) {
                // 歇脚处：没修路也要说清楚「这儿有块碑、只是还没路」，
                // 站着看见一块石头却什么都不说，玩家只会当成画上的石头
                roadFix();
                var sl = stationList(), sm2 = stationOf();
                hint(roadLegs()
                  ? (sl.length
                      ? ('E　歇脚　·　' + sl.map(function (d) { return d.name; }).join('、'))
                      : ('歇脚处　·　' + sm2.stationName + '　·　这几处还没走过'))
                  : ('歇脚处　·　' + sm2.stationName + '　·　还没修路'));
              }
              else {
                var ex = nearExit();
                // 硐口封了 / 没有镐，提示都得跟着变。提示写着「E 下硐」
                // 而按下去只弹一句「下不去」，两句话自相矛盾 ——
                // 提示行写的是「按下去会发生什么」。
                // 「没有镐」这一条原先只在硐**里面**判：走到口前照样下，
                // 下去以后每一块石头都回「还没有镐」，来回白走一趟
                if (ex && ex.to === 'shidong' && mineShut()) hint('硐口封着　·　雷雨天');
                else if (ex && ex.to === 'shidong' && S.gear.jue <= 0)
                  hint('下那道旧硐口　·　没有镐，下去也敲不动');
                else hint(ex ? ('E　' + ex.label) : '');
              }
            }
          }
        }
      }
    }
  }

  /* 柔边的一团白：三层同心椭圆叠出来，不用 ctx.filter。
     I.wash 的柔边是靠 `filter = blur(rx*0.22)`，而 blur 的半径跟着 rx 走 ——
     团一大（田面那种 rx 三四百的）blur 半径就上百，Canvas 的大半径
     模糊会直接画成一块黑，整片田直接消失。半径小的团没事，
     所以第一版一畦一畦洗的时候看着还正常，换成大团才炸出来。
     三层同心叠：中心叠三次最实，边上只叠一次，柔边就是这么来的。 */
  function softBlob(cx, cy, rx, ry, color, a) {
    var i, k;
    for (i = 0; i < 3; i++) {
      k = 1 - i * 0.28;
      x.fillStyle = color + (a / 3).toFixed(3) + ')';
      x.beginPath();
      x.ellipse(cx, cy, rx * k, ry * k, 0, 0, Math.PI * 2);
      x.fill();
    }
  }

  /* 地面积雪。**不能整屏铺白** —— 水墨底图上盖一层白纱，
     远山雾会被洗掉，看着像给整幅画蒙了块布。
     也**不能一畦一畦各洗一块**：每畦的椭圆边缘清清楚楚，
     5×5 一摆就是一张白棉球的网格，比不画还难看。
     正确做法是撒十几团又大又软的雪，彼此叠着连成一片 ——
     雪本来就是一片的，看得出格子就不对了。
     覆盖范围从 cellQuad 推，不在别处另抄一份坐标。 */
  function drawSnowOnField() {
    // 整片田的四条边**分别取自四个角上的那一格**。
    // 拿 cellQuad(0,0)[1] 当右上角是错的：那是第一格的右边缘（u=1/5），
    // 不是整片田的右边缘（u=1）—— 两个数一拼就成一个平行四边形，
    // 画出来是横在田上的一条斜带
    var tl = F.cellQuad(0, 0)[0];
    var tr = F.cellQuad(F.COLS - 1, 0)[1];
    var br = F.cellQuad(F.COLS - 1, F.ROWS - 1)[2];
    var bl = F.cellQuad(0, F.ROWS - 1)[3];
    var L = tl[0], T = tl[1], R = tr[0], B = br[1];
    var w = R - L, h = B - T;
    var cx = (L + R) / 2, cy = (T + B) / 2;
    x.save();
    // **裁在田的四边形里**。不裁的话那团软边会一路洇到远山雾和竹子上，
    // 看着像一朵云停在半空，而不是地上积了雪。
    // 顺带这一裁就把「一团一个椭圆」的软边藏起来了 ——
    // 露出来的边正好是田埂，那才是雪该待的地方
    x.beginPath();
    x.moveTo(tl[0], tl[1]);
    x.lineTo(tr[0], tr[1]);
    x.lineTo(br[0], br[1]);
    x.lineTo(bl[0], bl[1]);
    x.closePath();
    x.clip();
    // 底下先铺一层薄的，把几团之间连起来，免得读成一朵一朵。
    // 近处的几行要**单独再压一层**：那几行在屏幕上占的面积最大，
    // 只按画面坐标均匀撒雪，它们看着会比远处薄一大截
    softBlob(cx, cy, w * 0.54, h * 0.58, 'rgba(238,243,247,', 0.17);
    softBlob(cx, T + h * 0.76, w * 0.56, h * 0.34, 'rgba(240,245,248,', 0.14);
    // 再撒十几团，位置由下标定死 —— 刷新一帧雪的位置不该换。
    // 透明度压得低是故意的：白一厚，底图自己画的畦埂就没了，
    // 整片田读成一张白纸，而田埂才是让人看出「这是一片田」的东西
    for (var i = 0; i < 16; i++) {
      var k = i * 137.51;
      var px = L + w * (0.08 + ((k * 3) % 1) * 0.84);
      var py = T + h * (0.06 + ((k * 11) % 1) * 0.88);
      var pw = w * (0.15 + (k % 1) * 0.12);
      softBlob(px, py, pw, pw * 0.58, 'rgba(244,248,250,', 0.15);
    }
    // 边缘撒些不规则的碎雪，把「椭圆」那点形状打掉
    for (i = 0; i < 30; i++) {
      k = i * 91.7;
      I.dot(x, L + w * ((k * 5) % 1), T + h * ((k * 13) % 1),
        4 + (k % 1) * 8, 'rgba(250,252,254,0.30)');
    }
    x.restore();
  }

  /* 飘雪。画在最前，跟雨一个位置 ——
     雪在人前面下，而地面积雪在人后面。分两层是为了这个。 */
  function drawSnowFall(sec) {
    if (!isSnow() || inMine()) return;
    var n = 120, i, k, y, x0, r;
    x.save();
    x.fillStyle = 'rgba(252,253,255,0.85)';
    for (i = 0; i < n; i++) {
      k = i * 137.51;
      // 雪比雨慢，而且要横着飘 —— 只往下落的读出来是雨
      x0 = ((k * 7) % 1) * (W + 200) - 100 + Math.sin(sec * 0.6 + k) * 34;
      y = ((k * 29) % 1) * (H + 200) + ((sec * 52) % (H + 200)) - 100;
      r = 1.6 + (k % 1) * 2.2;
      x.beginPath();
      x.arc(x0, y, r, 0, Math.PI * 2);
      x.fill();
    }
    // 地上薄薄一层白气，让整幅画统一在「下雪」的气氛里
    x.fillStyle = 'rgba(226,234,240,0.07)';
    x.fillRect(0, 0, W, H);
    x.restore();
  }

  /* 雨。画在人物之后 —— 雨在人和房子前面，不是在它们后面。
     硐里不下：人在地下，头顶上是山，雨丝落在石壁上说不通，
     而那一层本来就压着暗色，雨画上去只是多一层灰。
     雨天是**压暗 + 降饱和**的手法，不是盖一层白纱 ——
     盖白纱在水墨底图上会把远山雾洗掉，看着像加了一层纱窗。

     第一版按着「别糊住画面」压得很轻（纱 0.07、丝 0.22、1.4px），
     1× 下来只剩天上几道划痕，读成「天上有点脏」而不是「在下雨」。
     细线 + 低透明度在缩小后是双重的没：线本身还剩 1px，透明度再一压就没了。
     现在反过来加重量：丝更粗更密更实，纱也厚一点 ——
     判据是 1× 截图上能不能一眼分出晴和雨，不是放大预览里好不好看。 */
  function drawRain(sec) {
    if (!S.started || S.ended) return;
    weatherFix();
    if (!isWet() || inMine()) return;
    var storm = S.weather === 'storm';
    x.save();
    x.fillStyle = storm ? 'rgba(72,90,104,0.17)' : 'rgba(86,102,114,0.12)';
    x.fillRect(0, 0, W, H);
    // 雨丝。斜的往下落，斜度比雨大：斜线读出来是「下」，竖线读出来是「挂」
    var n = storm ? 210 : 150, i, k, y, x0, len;
    x.lineWidth = storm ? 2.2 : 1.9;
    x.strokeStyle = storm ? 'rgba(44,56,68,0.42)' : 'rgba(56,70,82,0.32)';
    x.beginPath();
    for (i = 0; i < n; i++) {
      // 每根雨丝的位置都由 i 定死，只让时间整体往下推 ——
      // 位置也掺时间的话，刷新一帧雨就全换了位置，看着是闪不是落
      k = i * 137.51;
      x0 = ((k * 7) % 1) * (W + 300) - 150;
      len = 34 + ((k * 13) % 1) * 22;
      y = ((k * 29) % 1) * (H + 240) + ((sec * (storm ? 1150 : 820)) % (H + 240)) - 120;
      x.moveTo(x0, y);
      x.lineTo(x0 - len * 0.34, y + len);
    }
    x.stroke();
    // 雷雨：几道很短的亮，一闪就没。它不是特效，是「今天硐口封着」的理由
    if (storm) {
      var fl = Math.floor(sec * 2) % 7;
      if (fl === 0 || fl === 3) {
        x.fillStyle = 'rgba(228,234,238,0.20)';
        x.fillRect(0, 0, W, H);
      }
    }
    x.restore();
  }

  /* ---------------- UI ---------------- */
  function toast(msg, ms) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('on');
    // 记下这行字要占多久。诗册的浮字靠它让路 ——
    // 同一个位置只能有一行字，动作的提示比诗句急。
    toastUntil = Date.now() + (ms || 1900);
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('on'); }, ms || 1900);
  }
  function hint(msg) {
    var h = document.getElementById('hint');
    h.textContent = msg;
    h.classList.add('on');
  }
  function updateHUD() {
    document.getElementById('hud-day').textContent = S.day;
    document.getElementById('hud-shichen').textContent = FG.SHEN(S.min);
    document.getElementById('hud-clock').textContent = pad(Math.floor(S.min / 60)) + ':' + pad(S.min % 60);
    document.getElementById('hud-gold').textContent = S.gold;
    var sv = document.getElementById('hud-solar');
    if (sv) {
      var sol = FG.solarOf(S.day);
      var sea = FG.seasonOf(S.day);
      // 第 2 年起才显示「第几年」——第一年显示它只会让人以为自己读错了
      var y = FG.yearOf(S.day);
      // 季节跟在节气后面。写成一格「立春 · 春」是冗余的（立春本来就是春），
      // 所以只写季节 —— 而「立春」两个字本身已经告诉玩家这是春的第一天
      sv.innerHTML = sol.n + '<em>' + sea.n + (y > 1 ? '　第' + y + '年' : '') + '</em>';
      sv.title = sol.w + '　' + sea.note;
    }
    var mn = document.getElementById('hud-map');
    if (mn) mn.textContent = curMap().name;
    // 酒只在有坛子的时候占一行。没有酒却常驻一行的话，左上纸片会往下长，
    // 而体力条 #stam 的 top 只按五行的量留了 11px 余量
    var jj = document.getElementById('hud-jiu');
    if (jj) {
      jj.textContent = FG.BREW.name + ' ' + S.jiu;
      jj.style.display = S.jiu > 0 ? '' : 'none';
    }
    // 天气也是晴天就收起来：天天挂一行「晴」，纸片就比有事的那天高一截，
    // 而那一截正好压在体力条上
    var wt = document.getElementById('hud-weather');
    if (wt) {
      weatherFix();
      wt.textContent = S.weather === 'sun' ? '' : FG.WEATHER[S.weather].name;
      wt.style.display = S.weather === 'sun' ? 'none' : '';
    }
    document.getElementById('hud-stam').style.height = (S.stam / S.maxStam * 100) + '%';
    document.getElementById('hud-stam-n').textContent = S.stam;
    var tr = document.getElementById('tray');
    if (!tr._built) {
      tr.innerHTML = TOOLS.map(function (t) {
        return '<div class="slot" data-k="' + t.k + '"><i>' + t.key + '</i><b>' + t.label + '</b><u></u></div>';
      }).join('');
      tr._built = true;
      tr.addEventListener('click', function (e) {
        var s = e.target.closest('.slot');
        if (s) { S.sel = s.getAttribute('data-k'); updateHUD(); }
      });
    }
    // 器物架上的名字**不管这张图有没有田都要更新**。
    // 原先这圈循环在 `if (!F.on) return` 后面，于是玩家在墟市买下铜锄时
    // DOM 上还是「木锄」—— 那张架子当时是藏着的，可它一露出来就是错的，
    // 而一个藏着的元素留着旧文本，比不更新更坏：谁也说不清它什么时候才对
    var slots = tr.querySelectorAll('.slot');
    for (var i = 0; i < slots.length; i++) {
      var k = slots[i].getAttribute('data-k');
      slots[i].classList.toggle('on', k === S.sel);
      // 器物那一格摆的是**现在这把**的名字：木锄 → 铜锄 → 铁锄。
      // 摆成个不动的「锄」的话，玩家在墟市买了铜锄，器物架上毫无变化
      if (!toolIsSeed(k)) {
        var b = slots[i].querySelector('b');
        if (b) b.textContent = gearOf(k).name;
      }
      var u = slots[i].querySelector('u');
      // 这里必须写成 if/else，不能用 `if (种子) { ...; return; }` ——
      // 种子格在第 3~7 位，镐在第 8 位，一个 return 就把后面那一格整个跳过去了。
      // 症状是「架子最后一格永远是空的」，而其余七格都对，看着像没 bug
      if (toolIsSeed(k)) u.textContent = '×' + (S.seeds[k] || 0);
      // 镐没有就是没有，得摆在架子上说清楚。
      // 空着的话玩家会以为「8」那格是坏的，或者以为自己已经买了
      else u.textContent = (k === 'jue' && S.gear.jue <= 0) ? '没有' : '';
    }
    // 没有田的地图上器物架没意义，还挡画面
    tr.style.display = F.on ? '' : 'none';
    var ks = document.getElementById('keys');
    if (ks) ks.style.display = F.on ? '' : 'none';
    if (!F.on) { hint(''); return; }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* 手上捏着某一包种时，把原来 useOn 里那一支下种逻辑抽出来复用。
     判据（翻没翻、这畦有没有东西、时节对不对、种子够不够、体力够不够）
     必须和用器物下种时一模一样 —— 两份判据迟早会分叉，
     分叉了的表现是「行囊里明明捏着豆，点下去却说不是豆的时节」。 */
  function sowWith(crop, col, row) {
    var pl = S.plots[row][col];
    if (!pl) return;
    // 这道门是专门给「种子的表项 key 混进来」加的：
    // pendingSeed 存的是 seedD 这种行囊表项的 key，作物 id 是 dou。
    // 传错一个字符，C[crop] 就是 undefined，下一行读 .terms 直接抛，
    // 而抛在事件回调里控制台只有一行红 —— 画面上什么都不发生，
    // 连着三条「种不下去」的断言全绿（因为「没种上」正好是它们要的）。
    if (!crop || !C[crop]) { toast('这包种认不出来，放下了。'); S.pendingSeed = null; return; }
    // 地冻上了就说地冻上了。别让它掉到下面那句「不是豆的时节」去 ——
    // 那句话把原因说成了「豆不行」，而真实原因是他正站在冬天里，
    // 换一包种也照样种不下去
    if (groundFrozenNow()) {
      toast(isSnow() ? '雪压着地，种不下去。等' + FG.SOLAR[0].n + '再说。'
                     : '地冻上了，种不下去。等' + FG.SOLAR[0].n + '再说。', 2800);
      return;
    }
    if (!pl.tilled) { toast('这畦还没翻，点种子种不下去。'); return; }
    if (pl.crop) { toast('这畦里已经有东西了。'); return; }
    // 温窒把**两样一起解掉**：地不冻，节气也不拦。
    // 只解冻土的话，这一畦翻开了却还是种不下去 —— 而那句「不是豆的时节」
    // 玩家会以为豆坏了。玻璃房要是只管一半，它就不是玻璃房
    if (!warmOn() && !FG.inTerms(S.day, C[crop].terms)) {
      toast('现在不是' + C[crop].name + '的时节。' + termHint(C[crop]));
      return;
    }
    if (!spend(1)) return;
    if ((S.seeds[crop] || 0) <= 0) { toast('没有' + C[crop].name + '种了，去墟市买些。'); S.stam += 1; return; }
    S.seeds[crop]--;
    pl.crop = crop; pl.stage = 0;
    // 捏在手上的种用掉了就把手空出来，不然手上一直显示着「豆种 ×0」
    if ((S.seeds[crop] || 0) <= 0) S.pendingSeed = null;
    albumAdd('firstSow');
    skillAdd('geng', 'sow');
    FG.audio.play('plant'); toast('点下' + C[crop].name + '种。');
    updateHUD();
  }

  /* ---------------- 物品存取 ----------------
     每类东西本来就在不同的本账上（谷 S.bag、鱼和山货 S.pouch、种子 S.seeds、
     酒 S.jiu、加工品 S.made）。配方一出，加工品要跟别的东西互相换 ——
     醋拿酒换、菇酱拿山菌换野莓 —— 每处都写一遍「这个 key 该去哪本账」
     必然漏一处，而漏掉的那处症状是「点下去没反应」。

     所以只在这里路由一次。别的代码一律拿 FG.BAG 的 key 来读写。 */
  function invGet(k) {
    var it = FG.BAG_IDX[k];
    if (!it) return 0;
    if (it.kind === 'seed') return S.seeds[FG.CROP_OF_SEED[it.k]] || 0;
    // 器物一直都在，只是分级不同 —— 原来靠 S.tools 的「买过没有」标志，
    // 那个标志在分级之后没了意义：木锄是白送的，写成「买过」就得先白送一把
    if (it.kind === 'tool') return 1;
    if (it.k === 'jiu') return S.jiu || 0;
    if (it.kind === 'made') return S.made[it.src] || 0;
    if (it.kind === 'ore') return S.ore[it.src] || 0;
    if (it.kind === 'crop') return S.bag[it.src] || 0;
    return S.pouch[it.src] || 0;
  }
  function invTake(k, n) {
    var it = FG.BAG_IDX[k];
    if (!it || it.kind === 'tool') return false;
    if (invGet(k) < n) return false;
    if (it.kind === 'seed') S.seeds[FG.CROP_OF_SEED[it.k]] -= n;
    else if (it.k === 'jiu') S.jiu -= n;
    else if (it.kind === 'made') S.made[it.src] -= n;
    else if (it.kind === 'ore') S.ore[it.src] -= n;
    else if (it.kind === 'crop') S.bag[it.src] -= n;
    else S.pouch[it.src] -= n;
    return true;
  }
  function invGive(k, n) {
    var it = FG.BAG_IDX[k];
    if (!it) return;
    if (it.kind === 'tool') return;                  // 器物不进背包，也不能丢
    if (it.kind === 'seed') { S.seeds[FG.CROP_OF_SEED[it.k]] = (S.seeds[FG.CROP_OF_SEED[it.k]] || 0) + n; return; }
    if (it.k === 'jiu') { S.jiu += n; return; }
    if (it.kind === 'made') S.made[it.src] = (S.made[it.src] || 0) + n;
    else if (it.kind === 'ore') S.ore[it.src] = (S.ore[it.src] || 0) + n;
    else if (it.kind === 'crop') S.bag[it.src] = (S.bag[it.src] || 0) + n;
    else S.pouch[it.src] = (S.pouch[it.src] || 0) + n;
  }

  /* 灶上。一口灶一天做一样；砌了灶间之后是一天两口、两口灶三口。

     限制原来记在 S.cookDay（「上次动灶的日子」）。有了灶间就不够了 ——
     一天做两样，那一个日子号分不清「今天还能不能再做」。
     所以改成记**今天已经做了几口**：S.cookN，跨过 0 就归零（见 startDay）。 */
  function cookCap() {
    // 没砌灶间就是一口。**别返回 lv[0] 的值** ——
    // 那样「灶间一口」在没买灶间的时候也生效，玩家会以为是 bug
    return furnNum('chufang', 'cook') || 1;
  }
  function cookable() {
    var out = [], i, r, k, ok;
    for (i = 0; i < FG.RECIPES.length; i++) {
      r = FG.RECIPES[i];
      ok = true;
      for (k in r.need) { if (invGet(k) < r.need[k]) { ok = false; break; } }
      if (ok) out.push(r);
    }
    return out;
  }
  function canCook() { return cookable().length > 0 && S.cookN < cookCap(); }

  function cook(r) {
    // 先全查一遍再全扣：中途发现缺料会只扣了一半，篮子就凭空少了东西
    for (var k in r.need) {
      if (invGet(k) < r.need[k]) {
        toast('缺' + FG.BAG_IDX[k].name + '，先凑齐了再动灶。');
        return false;
      }
    }
    for (k in r.need) invTake(k, r.need[k]);
    invGive(r.out, r.n);
    // 酒记下酿下的年份，「陈」那件事才有得算。别的加工品不记 ——
    // 陈的是酒，不是酱也不是饼
    if (r.out === 'jiu') {
      if (!S.jiuYear) S.jiuYear = [];
      for (var q = 0; q < r.n; q++) S.jiuYear.push(FG.yearOf(S.day));
    }
    S.cookN++;
    // 酿记在**做成了**的那一刻，不是在点上灶的那一刻 ——
    // 少了料按不动的那些不算手艺
    skillAdd('niang', 'cook');
    FG.audio.play('buy');
    save();
    updateHUD();
    return true;
  }

  function stoveRow(r) {
    var have = [], lack = [], k;
    for (k in r.need) {
      var t = FG.BAG_IDX[k];
      if (!t) { lack.push(k); continue; }
      var s = FG.BAG_IDX[k].name + ' ' + invGet(k) + '/' + r.need[k];
      if (invGet(k) < r.need[k]) lack.push(s); else have.push(s);
    }
    return {
      r: r, ok: !lack.length,
      have: have.join('　'), lack: lack.join('　')
    };
  }

  function openStove() {
    var box = document.getElementById('st');
    var list = document.getElementById('st-list');
    var cap = cookCap();
    var used = S.cookN >= cap;
    // 这一行跟着灶间走。只把配方灰掉的话，玩家看见一屏灰的
    // 只会以为是料不够 —— 而料够不够每行都写着呢
    var hd = document.getElementById('st-cap');
    if (hd) hd.textContent = used
      ? ('今天 ' + cap + ' 口都做完了　·　明天还有')
      : ('今天还能做 ' + (cap - S.cookN) + ' / ' + cap + ' 口　·　点一行就动手');
    list.innerHTML = FG.RECIPES.map(function (r) {
      var s = stoveRow(r);
      // 三段之间留一个全角空格：CSS 里是分开摆的，但 textContent 读出来
      // 会连成「酱够：豆 2/2190 钱」这一坨，验收脚本和读屏都分不清哪儿到哪儿
      return '<div class="rec' + (s.ok && !used ? '' : ' off') + '" data-r="' + r.id + '">' +
        '<b>' + r.name + '</b>　<i>' + (s.ok ? ('够：' + s.have) : ('缺：' + s.lack)) + '</i>　' +
        '<u>' + (r.sell ? (r.sell + ' 钱') : '不卖钱') + '</u></div>';
    }).join('');
    box.classList.remove('hide');
  }
  function closeStove() { document.getElementById('st').classList.add('hide'); }
  function stoveOpen() { return !document.getElementById('st').classList.contains('hide'); }
  function bindStove() {
    var list = document.getElementById('st-list');
    var box = document.getElementById('st');
    list.addEventListener('click', function (e) {
      var g = e.target.closest('.rec');
      if (!g || g.classList.contains('off')) return;
      var id = g.getAttribute('data-r'), r = null, i;
      for (i = 0; i < FG.RECIPES.length; i++) if (FG.RECIPES[i].id === id) r = FG.RECIPES[i];
      if (!r) return;
      if (!cook(r)) return;
      toast('灶上得了' + r.n + '份' + r.name + '。', 2600);
      openStove();                    // 重画：这一下可能让别的配方凑齐了
    });
    document.getElementById('st-x').onclick = function () { closeStove(); };
    // 收灶归家：灶开着也能直接收工回屋。
    // 少了这个，手里剩着酒的人就再也回不了家 —— 酒能酿醋，
    // 只要手里有一坛，门口的 E 就永远是「动灶」，那条路上没有岔口
    document.getElementById('st-go').onclick = function () {
      closeStove();
      if (panelOpen()) return;
      endDay(false);
    };
    box.addEventListener('click', function (e) { if (e.target === box) closeStove(); });
  }

  /* ---------------- 行囊 ----------------
     把「农具 / 种子 / 谷物 / 溪产 / 山货 / 自酿」摆到一屏上。
     它是**读模型**：真正存着的还是原来那几本账（见 data.js 里 FG.BAG 那段注释），
     这里只负责把散在五处的数量按类别归拢、排序、画出来。
     摆出来的每格数字都直接来自那几本账，所以不存在「背包里三个、
     天黑结算时是四个」这种事。 */
  function bagList() {
    var out = [], i, n;
    for (i = 0; i < FG.BAG.length; i++) {
      n = invGet(FG.BAG[i].k);
      if (n > 0) out.push({ k: FG.BAG[i].k, it: FG.BAG[i], n: n });
    }
    return out;
  }

  // 8 列 × 5 行、格子 74、边距 8：8+8×74 = 600 宽，8+5×74 = 378 高，
  // 底下再留 26 画「装着的 N 样 / 空格 M 格」那一行。
  // 格子从 80 缩到 74 是为了让第五行塞进原来的高度 —— 行囊面板在窄屏上
  // 还要再缩一档，画布跟着长会把「收」按钮顶出画面。
  // 那行字原来画在格子底下，现在格子占满了整个宽度，只能另开一条：
  // 要是直接叠上去，它会压在最后一行最右两格的角标上，而角标是「×12」这种
  // 数字，被盖掉之后玩家看到的数量是错的
  // 高度跟着行数走。早先写死 404（= 8 + 5×74 + 42），行囊从 5 行涨到 6 行时
  // 画布没跟着长，最后一行压在画布外面 —— 画布只是裁掉看不见，
  // 而「第 37 格以后的东西画不出来」没有任何提示
  var BG = { slot: 74, pad: 8, hot: -1, w: 600, h: 8 + FG.BAG_ROWS * 74 + 42 };

  /* 行囊有几行。**跟着「带架的仓房」走**，所以它得是个函数：
     写死 FG.BAG_ROWS 的话买下仓房二级之后格子数不变 ——
     而症状只是「行囊还是那么高」，看不出是那一级没生效。
     几行这个数只写在 FG.FURN.cangfang.lv[*].bag 一处，这里读它；
     FG.BAG_ROWS 仍然是「现在几行」这个唯一出处，别处全在读它。 */
  function bagFit() {
    var lv = (typeof S !== 'undefined' && S.furn) ? (S.furn.cangfang || 0) : 0;
    var want = lv > 0 ? (FG.FURN.cangfang.lv[lv - 1].bag || 7) : 7;
    if (FG.BAG_ROWS !== want) FG.BAG_ROWS = want;
    // BG 在这一行下面才赋值。var 提升只保证名字在，读它还是 undefined，
    // 所以得先问一句 —— 不问的话 init() 里的 furnFix 一进来就炸
    if (typeof BG !== 'undefined') BG.h = 8 + FG.BAG_ROWS * BG.slot + 42;
    return FG.BAG_ROWS;
  }
  BG.h = 8 + FG.BAG_ROWS * BG.slot + 42;

  function bgRect(i) {
    var col = i % FG.BAG_COLS, row = Math.floor(i / FG.BAG_COLS);
    return [BG.pad + col * BG.slot, BG.pad + row * BG.slot, BG.slot, BG.slot];
  }
  function bgAt(px, py) {
    if (px < 0 || py < 0 || px > BG.w || py > BG.h) return -1;
    for (var i = 0; i < FG.BAG_COLS * FG.BAG_ROWS; i++) {
      var r = bgRect(i);
      if (px >= r[0] && px < r[0] + r[2] && py >= r[1] && py < r[1] + r[3]) return i;
    }
    return -1;
  }

  function drawBag() {
    var cv2 = document.getElementById('bg-cv');
    if (!cv2) return;
    var c = cv2.getContext('2d');
    var list = bagList();
    c.clearRect(0, 0, BG.w, BG.h);
    var i, r;
    // 先铺底格，再画东西 —— 反过来的话图标会被后铺的格子盖掉
    for (i = 0; i < FG.BAG_COLS * FG.BAG_ROWS; i++) {
      r = bgRect(i);
      c.fillStyle = (i === BG.hot) ? 'rgba(236,220,184,.85)' : 'rgba(250,245,232,.55)';
      c.fillRect(r[0], r[1], r[2] - 2, r[3] - 2);
      c.strokeStyle = 'rgba(120,100,70,.30)';
      c.lineWidth = 1;
      c.strokeRect(r[0] + .5, r[1] + .5, r[2] - 3, r[3] - 3);
    }
    for (i = 0; i < list.length && i < FG.BAG_COLS * FG.BAG_ROWS; i++) {
      r = bgRect(i);
      var item = list[i];
      // 0.86：I.icon 里的 u 是 s 的一半，实物画出来约 0.8u 宽。
      // 0.52 那一版只占格子五分之一，缩略图上根本认不出是什么
      I.icon(c, item.k, r[0] + r[2] * 0.44, r[1] + r[3] * 0.46, r[2] * 0.86);
      // 拿着的种子在田里就高亮一下，不然合上面板之后就忘了手上捏着哪一包
      if (item.k === S.pendingSeed) {
        c.strokeStyle = 'rgba(140,105,40,.9)';
        c.lineWidth = 2.4;
        c.strokeRect(r[0] + 2, r[1] + 2, r[2] - 6, r[3] - 6);
      }
      if (item.n > 1) {
        c.fillStyle = 'rgba(43,37,32,.88)';
        c.font = '600 15px "Songti SC","SimSun",serif';
        c.textAlign = 'right'; c.textBaseline = 'bottom';
        c.fillText('×' + item.n, r[0] + r[2] - 7, r[1] + r[3] - 6);
      }
    }
    // 底下写满没装
    if (list.length < FG.BAG_COLS * FG.BAG_ROWS) {
      c.fillStyle = 'rgba(138,115,80,.75)';
      c.font = '13px "Songti SC","SimSun",serif';
      c.textAlign = 'left'; c.textBaseline = 'bottom';
      c.fillText('装着的：' + list.length + ' 样　　空格 ' +
        (FG.BAG_COLS * FG.BAG_ROWS - list.length) + ' 格', BG.pad + 2, BG.h - 6);
    }
  }

  function bagTip(i) {
    var el = document.getElementById('bg-tip');
    if (!el) return;
    var list = bagList();
    if (i < 0 || i >= list.length) { el.innerHTML = '点一包<b>种子</b>，再点田畦就能直接种下去。'; return; }
    var it = list[i].it;
    // 器物显示的是**现在这把**的名字和它一次能做多少。
    // 摆一个不动的「锄」，玩家在墟市换了铁锄，行囊上还是一点变化都没有
    if (it.kind === 'tool') {
      var g = gearOf(it.k);
      el.innerHTML = '<b>' + g.name + '</b>　一件'
        + '<br>一下 ' + (g.w * g.h) + ' 畦（' + g.w + '×' + g.h + '），每畦 ' + FG.GEAR_STAM[it.k] + ' 分力气'
        + '<br><i>' + it.from + '</i>　<i>墟市有更趁手的</i>';
      return;
    }
    var tail = it.kind === 'seed' ? '　<i>点它，再点田畦</i>'
      : (it.sell ? '　<i>按 O 放进箱子，天黑折 ' + it.sell + ' 钱一份</i>' : '');
    if (it.kind === 'made' && !it.sell) tail = '　<i>不卖钱，只能送人</i>';
    el.innerHTML = '<b>' + it.name + '</b>　×' + list[i].n +
      '<br>' + it.desc + '<br><i>' + it.from + '</i>' + tail;
  }

  function openBag() {
    BG.hot = -1;
    // canvas 的宽高只在 HTML 里给了一次初值，行数变了它不会自己长 ——
    // 打开面板时按 BG 同步一次，不同步的话最后一行画在画布外面，
    // 而画布只是把它裁掉，看不出是「没画」
    var bgc = document.getElementById('bg-cv');
    if (bgc) { bgc.width = BG.w; bgc.height = BG.h; }
    drawBag();
    bagTip(-1);
    document.getElementById('bg').classList.remove('hide');
  }
  function closeBag() { document.getElementById('bg').classList.add('hide'); }
  function bagOpen() { return !document.getElementById('bg').classList.contains('hide'); }

  function bindBag() {
    var cv2 = document.getElementById('bg-cv');
    if (!cv2) return;
    function at(e) {
      var r = cv2.getBoundingClientRect();
      return bgAt((e.clientX - r.left) / r.width * BG.w, (e.clientY - r.top) / r.height * BG.h);
    }
    cv2.addEventListener('mousemove', function (e) {
      var i = at(e);
      if (i === BG.hot) return;
      BG.hot = i; bagTip(i); drawBag();
    });
    cv2.addEventListener('mouseleave', function () { BG.hot = -1; bagTip(-1); drawBag(); });
    cv2.addEventListener('click', function (e) {
      var i = at(e);
      if (i < 0) return;
      var list = bagList();
      if (i >= list.length) { toast('这格是空的。', 1400); return; }
      var it = list[i].it;
      // 只有种子能「拿在手上」—— 星露谷最顺手的那一下：
      // 点种子 → 点田畦 → 种下，中间不用先切器物
      if (it.kind !== 'seed') { bagTip(i); return; }
      S.pendingSeed = S.pendingSeed === it.k ? null : it.k;
      toast(S.pendingSeed
        ? ('捏着' + FG.CROPS[FG.CROP_OF_SEED[it.k]].name + '种　·　点一畦翻好的土')
        : '放下了。', 2400);
      closeBag();
      drawBag();
    });
  }

  /* ---------------- 出货箱 ----------------
     星露谷最要紧的一条经济规则：钱不是「篮子空了」，是「你亲手放进去的」。
     所以这里放进去要能拿回来 —— 只进不出的箱子，玩家第一天就会因为手滑
     把明天要吃的粮也卖了，第二天对着空篮子发愣。

     一份 = 点一下；按住 Shift = 这一样全放（或全取回）。
     酒放不进去：它 sell=0，放进去等于当着玩家的面把诗册的门关上，
     而天黑结算并不会给它钱（结算里 sell 为 0 的会被清掉并跳过）。
     所以酒那一行只摆出来说明，不给点。 */
  function binSellable(k) {
    var it = FG.BAG_IDX[k];
    if (!it) return false;
    // 反着写：只挡「本来就不出货」的两类。以前是一张卖得动的类别白名单，
    // 加矿砂的时候忘了往里添，它就安安静静地不能放进箱子 ——
    // 而画面上只表现为「点不动」，看着像 bug 也不想得到是数据表漏了一项
    if (it.kind === 'tool' || it.kind === 'seed') return false;
    return !!it.sell;
  }
  // 手上有的、够格出货的（外加酒，好让玩家看见「它有，但放不进去」）
  function binHeld() {
    var out = [], i, n, it;
    for (i = 0; i < FG.BAG.length; i++) {
      it = FG.BAG[i];
      if (it.kind === 'tool' || it.kind === 'seed') continue;
      n = invGet(it.k);
      if (n > 0) out.push({ k: it.k, it: it, n: n, can: binSellable(it.k) });
    }
    return out;
  }
  /* ---------------- 机器 ----------------
     坛：放进去就不管了，隔天早上来取。跟灶台的分别就在「不来管」这三个字 ——
     灶是一天一口、你自己守着；坛是搁进去忘了都行。
     一口坛同一时刻只腌一样，且只放一份（lv2 放多份要多等一天），
     跟鸡舍的门/粮一样：**不惩罚，只是少收**。
     忘了取就一直搁着，坛子不会坏、料不会烂。 */
  function machFix() {
    if (typeof S.mach !== 'object' || !S.mach) S.mach = { lv: {}, job: {} };
    if (typeof S.mach.lv !== 'object' || !S.mach.lv) S.mach.lv = {};
    if (typeof S.mach.job !== 'object' || !S.mach.job) S.mach.job = {};
    var i, k, v;
    for (i = 0; i < FG.MACHINE_LV.length; i++) {
      k = FG.MACHINE_LV[i]; v = S.mach.lv[k] || 0;
      if (v < 0 || v > FG.MACHINE[k].lv.length) v = 0;
      S.mach.lv[k] = v;
    }
  }
  /* 狗。它是这一族里唯一**要把东西叼回来给你拿**的：
     鸡牛羊在棚里自己攒，坛和罐是你投进去的，只有狗是你不在的时候
     自己在山上跑的。所以它叼回来的**不直接进行囊** ——
     放在窝边，走过去按 E 才拿。直接塞进行囊那就成了一台机器。

     叼的是**当季**的山货（terms 里含着当天那个节气）。
     按日子定的，不是随机的：这游戏从头到尾一条伪随机，
     而一条狗跑到哪、叼到什么是它的事，不该由玩家摇一次骰子。 */
  function dogFix() {
    if (!S.dog || typeof S.dog !== 'object') S.dog = { day: 0, n: 0, k: null };
    // day 也要**夹负数**：只判 typeof 的话 -5 是个合法数字，
    // 而「S.day - S.dog.day」一下变成一百多天，狗就天天有东西叼回来了。
    // 症状是「狗窝白送山货」，而那看着像占了个便宜
    if (typeof S.dog.day !== 'number' || S.dog.day < 0) S.dog.day = 0;
    if (typeof S.dog.n !== 'number' || S.dog.n < 0) S.dog.n = 0;
    if (S.dog.n <= 0) S.dog.k = null;
  }
  function dogOn() { buildFix(); return (S.build.gou || 0) > 0; }
  function dogDays() {
    var lv = dogOn() ? S.build.gou : 0;
    return lv > 0 ? (FG.BUILD.gou.lv[lv - 1].days || 2) : 0;
  }
  // 当季有哪几样山货。判据**直接用 FG.inTerms**（它收日子和 terms 数组）——
  // 别自己拿 FG.solarOf 去比：那个函数收的是**日子**，喂给它一个节气 key
  // 会算出一个 NaN 下标，返回 undefined，下一行读 .k 当场炸
  function dogCatch(day) {
    var out = [], k;
    for (k in FG.GOODS) if (FG.inTerms(day, FG.GOODS[k].terms)) out.push(k);
    return out;
  }
  // 今天早上叼回来的那一样。**同一天永远是同一样**（按日子定），
  // 刷新不变、读档不变、测试可复现
  function dogTodayKey() {
    var list = dogCatch(S.day);
    if (!list.length) return null;
    return list[(S.day * 7 + 3) % list.length];
  }
  function dogMorning() {
    dogFix();
    if (!dogOn()) return 0;
    var d = dogDays();
    if (S.day - S.dog.day < d) return 0;
    S.dog.day = S.day;
    var k = dogTodayKey();
    if (!k) return 0;
    S.dog.k = k;
    // 窝边最多堆三天的。**不倒扣、不烂** —— 忘了收只是少收
    if (S.dog.n < 3) S.dog.n++;
    return S.dog.n;
  }
  function dogPose() { dogFix(); return { n: S.dog.n, k: S.dog.k }; }
  // 站在窝边按 E，把窝边的东西拿走
  function dogTake() {
    dogFix();
    if (!dogOn()) { toast('这儿空着。墟市老丈那儿有狗窝卖。'); return false; }
    if (S.dog.n <= 0 || !S.dog.k) {
      toast(S.dog.n <= 0 ? ('狗还没叼回来东西。' + dogDays() + ' 天一趟。') : '窝边是空的。', 2800);
      return false;
    }
    var k = S.dog.k, n = S.dog.n, it = FG.BAG_IDX['good_' + k];
    invGive('good_' + k, n);
    // 狗叼回来一样也算「认出了它」—— 不记的话会出现
    // 「行囊里揣着五把菱角，图鉴上写着还没遇见过」
    dexAdd('good', k);
    S.dog.n = 0; S.dog.k = null;
    albumAdd('firstDog');
    FG.audio.play('buy');
    toast('狗把' + it.name + '叼回来了，一共 ' + n + ' 份。', 3000);
    save(); updateHUD();
    return true;
  }

  function machList() {
    var m = curMap(), out = [], i, id, def;
    if (!m.machines) return out;
    for (i = 0; i < m.machines.length; i++) {
      id = m.machines[i]; def = FG.MACHINE[id];
      // 表里没有的那个**跳过**，别塞一个 def 是 undefined 的进去。
      // 塞进去的话绘制那一行 mm2.def.at 每帧抛一次，
      // 而症状是「控制台刷一片红、画面照常动」——
      // 改个 id 忘了改挂载那一张，就正好是这种情况
      if (!def) continue;
      out.push({ id: id, def: def });
    }
    return out;
  }
  function nearMachine() {
    var list = machList(), best = null, bd = 1e9, i, d, def;
    for (i = 0; i < list.length; i++) {
      def = list[i].def;
      d = Math.abs(def.at[0] - S.player.x) + Math.abs(def.at[1] - S.player.y);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return (best && bd <= SPOT_R.pick) ? best : null;
  }
  // 现在坛里腌着什么、还差几天能好
  function machJob(id) { machFix(); return S.mach.job[id] || null; }
  function machDone(id) {
    var j = machJob(id);
    return !!j && S.day >= j.at;
  }
  // 今天坛上摆的是哪一条方子。**先挑做得出来的**：
  // 原来第一条判据是「行囊里已经有这个产物」，那看着像「记住上次做的那一条」，
  // 实际上只要手里还留着一罐黄油，坛就永远指着黄油 ——
  // 明明料齐的是毛线，坛上写的却是黄油，按 E 只会说「料不够」
  function machRcp(id) {
    var list = FG.MACHINE_RECIPES[id] || [], i, r, best = null, bestN = -1, n, k;
    for (i = 0; i < list.length; i++) {
      if (machCanPut(id, list[i])) return list[i];
      // 都做不出来的时候，摆手上有的最多的那一条 —— 面板得告诉人差在哪儿
      n = 0;
      for (k in list[i].need) n += Math.min(invGet(k), list[i].need[k]);
      if (n > bestN) { bestN = n; best = list[i]; }
    }
    return best || list[0] || null;
  }
  function machRcpHas(id, r) {
    var k, n = 0;
    for (k in r.need) n += invGet(k);
    return n > 0;
  }
  // 够不够料。**判的那一份和扣的那一份必须是同一个数**：
  // 判 r.need[k]、扣 r.need[k] * sp.in 的话，一级坛（in=2）会跟玩家说
  // 「两朵山菌够了」，真按下去却要四朵 —— 扣不动也不报错，
  // 白得一坛酸菜，而症状看着像「坛的料算错了」
  function machCanPut(id, r) {
    var k, def, lv, sp, i;
    if (!r) return false;
    if (machJob(id)) return false;                  // 一口坛只腌一样
    def = FG.MACHINE[id]; lv = S.mach.lv[id] || 0;
    if (lv <= 0) return false;
    sp = def.lv[lv - 1];
    for (k in r.need) if (invGet(k) < r.need[k] * sp.in) return false;
    return true;
  }
  /* 这个坛子现在缺什么，写成一句能照着去采的话。
     「手上的料不够」等于没说 —— 坛有五条方子（酸菜要山菌、盐菜要野莓、
     排黄要鲤、黄油要奶、毛线要毛），玩家站在坛前得知道自己该去采哪一味。
     手上有一部分的时候要把差多少说出来，不然他会以为是坏了。 */
  function machWant(id) {
    var r = machRcp(id), def = FG.MACHINE[id], lv = S.mach.lv[id] || 0;
    if (!r || !def || lv <= 0) return '手上的料不够';
    var sp = def.lv[lv - 1], miss = [], k, want, have;
    for (k in r.need) {
      want = r.need[k] * sp.in; have = invGet(k);
      if (have >= want) continue;
      miss.push(FG.BAG_IDX[k].name + (have > 0 ? '要 ' + want + '　手上 ' + have : '要 ' + want));
    }
    return miss.length ? ('这坛要 ' + miss.join('、')) : '手上的料不够';
  }
  function machPut(id) {
    machFix();
    if (!S.mach.lv[id]) { toast('这儿还空着。墟市老丈那儿有坛卖。'); return false; }
    var r = machRcp(id);
    if (machJob(id)) {
      var j = machJob(id);
      toast('坛里还腌着' + FG.BAG_IDX[j.out].name + '，还差 ' + (j.at - S.day) + ' 天。', 3200);
      return false;
    }
    if (!machCanPut(id, r)) { toast(machWant(id) + '。', 3000); return false; }
    var def = FG.MACHINE[id], sp = def.lv[(S.mach.lv[id] || 1) - 1];
    for (var k in r.need) invTake(k, r.need[k] * sp.in);
    S.mach.job[id] = { out: r.out, n: sp.out, at: S.day + sp.days, in: S.day };
    FG.audio.play('buy'); save(); updateHUD();
    toast('把料搁进坛里封上了。' + sp.days + ' 天后来取。', 3200);
    return true;
  }
  function machTake(id) {
    machFix();
    var j = machJob(id);
    if (!j) { toast('坛子是空的。'); return false; }
    if (S.day < j.at) { toast('还得等 ' + (j.at - S.day) + ' 天。', 3000); return false; }
    delete S.mach.job[id];
    invGive(j.out, j.n);
    FG.audio.play('buy'); save(); updateHUD();
    toast('起坛，得了 ' + j.n + ' 份' + FG.BAG_IDX[j.out].name + '。');
    return true;
  }
  // 早上那一下：腌够天数的自动好，但**要人来起**（这是机器和灶最大的分别）
  function machUse(id) {
    machFix();
    if (machDone(id)) { machTake(id); return true; }
    if (machJob(id)) { machPut(id); return true; }
    if (S.mach.lv[id]) { machPut(id); return true; }
    toast('这儿还空着。墟市老丈那儿有坛卖。');
    return false;
  }

  /* ---------------- 木箱 ----------------
     搁东西的地方，不卖钱。它跟出货箱是两件事：
       出货箱 —— 放进去，天黑时折成钱
       木  箱 —— 放进去，一直搁着
     为什么现在做它：行囊是 8×5 = **40 格，物品总表刚好 40 样**，
     一格不多一格不少。再加任何一类东西就摆不下了 ——
     而摆不下的时候症状是「画面上只是少一格」，看不出是装不下。
     存箱给的就是这个余量：把不急着的挪进去，行囊就空出格来。 */
  function chestFix() {
    if (!S.chest || typeof S.chest !== 'object') S.chest = {};
    var k;
    for (k in S.chest) {
      // 存档被手改过的话，这里可能是负数或者不是数
      if (typeof S.chest[k] !== 'number' || S.chest[k] <= 0) delete S.chest[k];
    }
  }
  /* 木箱分两页是**仓房**给的场合：采回来的 / 做出来的。
     还是那一只箱子、同一本账（存还是 S.chest），只是摆的时候分开 ——
     不新造第二个箱子是因为那要复制一遍存取和画面板，而玩家真正缺的是
     「东西太多翻不到」，不是「没地方放」。

     页数从 FG.FURN 读，没砌仓房就是 1 页。**别在这里写死 2** ——
     写死了没买仓房时也会分页，而看着像仓房白买了 */
  var chestTab = 'all';
  function chestTabs() { return furnNum('cangfang', 'tabs') || 1; }
  // 一件东西归哪一页。只按「是不是做出来的」分两下：
  // 种、田里收的、山里采的、矿砂全归「采回来的」那页，
  // 那才是玩家脑子里的分法（自己做的 vs 捡来的）
  function chestSide(k) {
    var it = FG.BAG_IDX[k];
    return (it && it.kind === 'made') ? 'made' : 'got';
  }
  function chestList(tab) {
    var out = [], k;
    chestFix(); furnFix();
    tab = tab || chestTab;
    if (chestTabs() < 2) tab = 'all';
    for (k in S.chest) {
      if (S.chest[k] <= 0) continue;
      if (tab !== 'all' && chestSide(k) !== tab) continue;
      out.push({ k: k, it: FG.BAG_IDX[k], n: S.chest[k] });
    }
    return out;
  }
  // 手上有的、但行囊里那一格该挪进箱子的。
  // **器物要跳过**：invGet 对 tool 恒返回 1（分级之后器物一直都在），
  // 而 invTake 对 tool 直接拒绝 —— 列出来的话玩家点一下毫无反应，
  // 而那看着像这个箱子坏了
  function chestHeld() {
    var out = [], k, n;
    for (k in FG.BAG_IDX) {
      if (FG.BAG_IDX[k].kind === 'tool') continue;
      if (S.chest[k] > 0) continue;          // 箱里已经有了，不重复列
      n = invGet(k);
      if (n > 0) out.push({ k: k, it: FG.BAG_IDX[k], n: n });
    }
    return out;
  }
  /* 箱里一共几件。**自己数，不走 chestList()** ——
     chestList 跟着当前那一页走，写成 chestList 的求和的话，
     门前的「里面搁着 N 件」会跟着页签变：切到「做出来的」那页而箱里
     全是山货时，它会说箱子快空了。玩家不会去看另一个页签，
     只会觉得东西不见了 */
  function chestCount() {
    var t = 0, k;
    chestFix();
    for (k in S.chest) if (S.chest[k] > 0) t += S.chest[k];
    return t;
  }
  // 方向由「点了哪一栏」决定，跟出货箱同一条规矩：
  // 拿两边的数去比大小的话，点箱里那一行（该取回）反而又搬了一份进去
  function chestMove(k, toChest, all) {
    var it = FG.BAG_IDX[k];
    if (!it) return false;
    chestFix();
    if (toChest) {
      var have = invGet(k);
      if (have <= 0) return false;
      var put = all ? have : 1;
      if (!invTake(k, put)) return false;
      S.chest[k] = (S.chest[k] || 0) + put;
    } else {
      var inBox = S.chest[k] || 0;
      if (inBox <= 0) return false;
      var back = all ? inBox : 1;
      // **不要判 invGive 的返回值**：它成功时不返回任何东西，
      // `if (!invGive(...))` 会把每一次成功都当成失败，于是东西取不回来。
      // 也不必判「手上放不放得下」：行囊是一类占一格、数量叠着，
      // 压根没有「放不下」这回事 —— 写那么一句是骗玩家
      invGive(k, back);
      S.chest[k] = inBox - back;
      if (S.chest[k] <= 0) delete S.chest[k];
    }
    FG.audio.play('buy');
    save(); updateHUD();
    // 放进去就跳到它那一页。不跳的话把一罐奶放进去、当前停在「采回来的」那页，
    // 它当场从眼前消失 —— 而看着像没放进去
    if (toChest && chestTabs() >= 2) chestTab = chestSide(k);
    openChest();
    return true;
  }
  function openChest() {
    var inEl = document.getElementById('ch-in');
    var handEl = document.getElementById('ch-hand');
    var tabsEl = document.getElementById('ch-tabs');
    chestFix(); furnFix();
    // 页数掉回 1 的时候得把当前页收回「全部」，
    // 否则玩家在两页之间切着，仓房卖掉之后停在「做出来的」那页而箱里全是山货
    if (chestTabs() < 2) chestTab = 'all';
    var l = chestList();
    // 页签上的数按每一页自己数，不读当前这一页
    var l = chestList();
    inEl.innerHTML = l.length ? l.map(function (b) {
      return '<div class="bxl" data-k="' + b.k + '"><b>' + b.it.name + '</b>　<i>×' + b.n +
        (b.it.sell ? ('　一份 ' + b.it.sell + ' 钱') : '　不卖钱') + '</i>　<u>点一下取一份</u></div>';
    }).join('') : '<div class="bxnone">这一页是空的</div>';
    handEl.innerHTML = chestHeld().map(function (b) {
      return '<div class="bxh" data-k="' + b.k + '"><b>' + b.it.name + '</b>　<i>×' + b.n +
        (b.it.sell ? ('　一份 ' + b.it.sell + ' 钱') : '　不卖钱') + '</i>　<u>点一下搁一份</u></div>';
    }).join('') || '<div class="bxnone">手上什么也没有</div>';
    if (tabsEl) {
      if (chestTabs() < 2) tabsEl.innerHTML = '';
      else {
        tabsEl.innerHTML = [['got', '采回来的'], ['made', '做出来的']].map(function (t) {
          var n = 0, li = chestList(t[0]), i;
          for (i = 0; i < li.length; i++) n += li[i].n;
          return '<button class="bxt' + (chestTab === t[0] ? ' on' : '') + '" data-t="' + t[0] + '">'
            + t[1] + '　' + n + '</button>';
        }).join('');
      }
    }
    document.getElementById('ch').classList.remove('hide');
  }
  function closeChest() { document.getElementById('ch').classList.add('hide'); }
  function chestOpen() { return !document.getElementById('ch').classList.contains('hide'); }
  function bindChest() {
    var tabsEl = document.getElementById('ch-tabs');
    if (tabsEl) {
      tabsEl.addEventListener('click', function (e) {
        var g = e.target.closest('.bxt');
        if (!g) return;
        chestTab = g.getAttribute('data-t');
        openChest();
      });
    }
    document.getElementById('ch-in').addEventListener('click', function (e) {
      var g = e.target.closest('.bxl');
      if (!g) return;
      chestMove(g.getAttribute('data-k'), false, e.shiftKey);
    });
    document.getElementById('ch-hand').addEventListener('click', function (e) {
      var g = e.target.closest('.bxh');
      if (!g) return;
      chestMove(g.getAttribute('data-k'), true, e.shiftKey);
    });
    document.getElementById('ch-x').onclick = function () { closeChest(); };
    var box = document.getElementById('ch');
    box.addEventListener('mousedown', function (e) { if (e.target === box) closeChest(); });
  }
  // 木箱摆在茅舍廊下。位置要**在 home 圈里**才有「站在门前」那个味道，
  // 而 E 键里木箱排在归家前面 —— 两处都占同一块地的时候，
  // 站着不动按 E 得有个确定的结果，不能一会儿开箱一会儿归家
  function nearChest() {
    var d = Math.abs(CHEST.at[0] - S.player.x) + Math.abs(CHEST.at[1] - S.player.y);
    return d <= SPOT_R.chest ? CHEST : null;
  }
  function openChestAt() {
    if (!nearChest()) { toast('这儿没有木箱。'); return false; }
    openChest();
    return true;
  }

  function binList() {
    var out = [], k;
    for (k in S.bin) {
      if ((S.bin[k] || 0) > 0) out.push({ k: k, it: FG.BAG_IDX[k], n: S.bin[k] });
    }
    return out;
  }
  // 篮里还剩几样没放出去。结算面板用它写一句提示：不然新玩家第一天
  // 会看着「今日进项 0 钱」以为游戏坏了，其实只是没往箱里放
  function leftToShip() {
    var h = binHeld(), n = 0;
    for (var i = 0; i < h.length; i++) if (h[i].can) n++;
    return n;
  }
  function binWorth() {
    var l = binList(), t = 0, x = FG.QUALITY[binQ()].x;
    for (var i = 0; i < l.length; i++) t += l[i].n * (l[i].it ? l[i].it.sell : 0);
    return Math.round(t * x);
  }
  /* 品级：**记在出货箱上**，记的是「这一箱是第几级的手艺装进去的」。
     不是每件各记一份 —— 行囊一件东西只存一个份数（见 FG.QUALITY 那段）。
     这么记反而更像真的：早出手是低档、多跑一趟；等手艺上去了再出手是高档。 */
  function qualityNow() {
    var t = 0;
    if (skillLv('geng') >= 3) t++;
    if (skillLv('geng') >= 6) t++;
    // 温窒在**营造**表里，级数记在 S.build.warm 上。
    // 用 furnLv 读的话永远读到 0（家具表里没有 warm）——
    // 症状是「买了温窒二级，品级一点没变」，而那看着像温窒写错了
    buildFix();
    if ((S.build.warm || 0) >= 2) t++;
    return Math.min(FG.QUALITY.length - 1, t);
  }
  function binQ() {
    var v = typeof S.binQ === 'number' ? S.binQ : 0;
    if (v < 0 || v > FG.QUALITY.length - 1) v = 0;
    return v;
  }
  // 往箱里放东西时，**箱是空的才记档**。
  // 每放一样就重记一遍的话，一箱东西会拿到手上最晚那一份的档次，
  // 而玩家早就看着「这一箱是 3 级手艺装的」安排好了
  function binMarkQ() {
    if (!S.bin || !Object.keys(S.bin).length) S.binQ = qualityNow();
  }

  // 方向由「点了哪一栏」决定，不能拿两边的数去比大小。
  // 原来写成「手上比箱里多就往箱里搬」，后果是点箱里那一行（该拿回来）
  // 反而又从手上搬了一份进去 —— 玩家越点箱子越满，而且看上去是生效了
  function binMove(k, toBin, all) {
    var it = FG.BAG_IDX[k];
    if (!it) return false;
    var inBin = S.bin[k] || 0;
    if (toBin) {
      var have = invGet(k);
      if (have <= 0) return false;
      var put = all ? have : 1;
      if (!invTake(k, put)) return false;
      binMarkQ();
      S.bin[k] = inBin + put;
    } else {
      if (inBin <= 0) return false;
      var back = all ? inBin : 1;
      S.bin[k] = inBin - back;
      if (S.bin[k] <= 0) delete S.bin[k];
      invGive(k, back);
    }
    FG.audio.play('buy');
    save(); updateHUD(); openBin();
    return true;
  }

  function openBin() {
    var binEl = document.getElementById('bx-bin');
    var handEl = document.getElementById('bx-hand');
    var l = binList();
    // 每一项写的是**折后**的钱。写原价而合计写折后的，
    // 玩家会以为面板算错了（4 份豆那行 136，下面合计 408）
    var qx1 = FG.QUALITY[binQ()].x;
    binEl.innerHTML = l.length ? l.map(function (b) {
      return '<div class="bxl" data-k="' + b.k + '"><b>' + b.it.name + '</b>　<i>×' + b.n +
        '　' + Math.round(b.n * b.it.sell * qx1) + ' 钱</i>　<u>点一下拿回一份</u></div>';
    }).join('') : '<div class="bxnone">空的</div>';
    handEl.innerHTML = binHeld().map(function (b) {
      return '<div class="bxh' + (b.can ? '' : ' no') + '" data-k="' + b.k + '"><b>' + b.it.name +
        '</b>　<i>×' + b.n + (b.can ? ('　一份 ' + b.it.sell + ' 钱') : '　不卖钱') +
        '</i>　<u>' + (b.can ? '点一下放一份' : '只能送人') + '</u></div>';
    }).join('') || '<div class="bxnone">手上什么也没有</div>';
    // 箱子空了就把「这一箱记着几档」也说出来，别让玩家对着一屏数字猜
    var q0 = binQ(), qd = FG.QUALITY[q0], empty0 = !l.length;
    document.getElementById('bx-sum').textContent = (empty0
      ? '箱子空着　·　天黑时结算　·　'
      : '这一箱记着 ' + qd.n + '（' + qd.need + '，×' + qd.x + '）　·　')
      + '箱里折 ' + binWorth() + ' 钱'
      + (empty0 ? ('　·　现在放进去是 ' + FG.QUALITY[qualityNow()].n) : '');
    document.getElementById('bx').classList.remove('hide');
  }
  function closeBin() { document.getElementById('bx').classList.add('hide'); }
  function binOpen() { return !document.getElementById('bx').classList.contains('hide'); }
  function bindBin() {
    document.getElementById('bx-bin').addEventListener('click', function (e) {
      var g = e.target.closest('.bxl');
      if (!g) return;
      binMove(g.getAttribute('data-k'), false, e.shiftKey);
    });
    document.getElementById('bx-hand').addEventListener('click', function (e) {
      var g = e.target.closest('.bxh');
      if (!g || g.classList.contains('no')) return;
      binMove(g.getAttribute('data-k'), true, e.shiftKey);
    });
    document.getElementById('bx-x').onclick = function () { closeBin(); };
    var box = document.getElementById('bx');
    box.addEventListener('click', function (e) { if (e.target === box) closeBin(); });
  }

  /* ---------------- 输入 ----------------
     键鼠走 core.js 的归一化输入（方向键是 left/right/up/down，数字键是 d1..d9）。
     触摸单独处理：点田畦 = 用器物，点空地 = 走过去。原版 touch.js 依赖
     商店/背包/暂停那一套 DOM，这版没有，挂上去反而报错，所以没引。 */
  function bindInput() {
    FG.initInput(cv);

  /* 「在这儿做一件事」—— E 键和触屏走的是**同一套判定**。
     原来这一长串 if/return 只长在 E 键里，触摸那边（actAt）压根没有这一支：
     触屏点一下只有三种结果 —— 硐里敲、田畦种/收、**其余一律走过去**。
     而这一串里有跟人说话、捡蛋、归家、出门换图、抛竿……
     于是触屏上这游戏过了头两分钟就走不下去了：
     人能跑、能锄、能收，可**说不了话、出不了门、回不了家**。
     而人情、托付、诗册、节日全挂在「说话」上。
     抽出来之后：走到位了调它 = 按 E，判定顺序永远是一份。 */
  function interact() {
    if (S.ended) return;
            // 正在垂钓时 E 一律是提竿，不能顺手把人聊走或带出图
            if (S.fishing) { reel(); return; }
            var n = nearNpc();
            // **生辰排在过节前面。** 过节那天墟市广场上的人全按 festTalk 走，
            // 而生日一年只有一天 —— 撞上节日就等于等明年。
            // 提示行那头也把生辰排在 festSpot 那支前面（见 hint 那段），
            // 两边顺序不一样的话，按下去和提示上写的就不是一件事
            if (n && birthTurn(n.id)) { birthGive(n); return; }
            // 过节那天的墟市：站着的人聚在广场上，说的话也是节日的
            if (n && festivalOn(S.day) && FG.FEST_SPOTS[n.id]) { festTalk(n); return; }
            // 顺序要紧：先看 NPC 再看出口。否则站在墟市口上的人同时踩着
            // 老丈和出口，E 只会说一句话，人根本走不出去。
            if (n) { talk(n); return; }
            // 已经回家的那位。**在的在场优先**，所以这一支排在 n 之后 ——
            // 有人就跟他说话，没人才说「他回去了」
            var gn = nearGoneNpc();
            if (gn) {
              toast((gn.shop ? '铺子收了，天黑不出门。明早再来。'
                             : gn.name + '这个点已经回家了，灯还亮着。'), 3400);
              return;
            }
            var f = nearFish();
            if (f) { cast(f); return; }
            var pk = nearPick();
            if (pk) { pick(pk); return; }
            // 采不到的那一格也得有一句。提示行已经说了「水涨了 · 下不去」，
            // 而按 E 什么也不发生的话，那句话就成了空话 ——
            // 玩家听到的是「我看见了提示，可它不认」
            var pkB = nearPickSpot();
            if (pkB && !pickReady(pkB)) { toast(pickBlockWord(pkB) + '　·　' + FG.GOODS[pkB.k].name, 2600); return; }
            var stn = nearStele();
            if (stn) { readStele(stn); return; }
            // 营造排在刻石之后、竖井之前：鸡舍在一片空地上，跟谁都不挨着，
            // 但顺序得跟下面提示行的顺序一样，提示写着「捡蛋」而 E 开了别的
            var bd = nearBuild();
            // 狗窝排在三样棚之后、机器之前。窝边有东西才收，没东西也说一句
            if (bd && bd.def.act) { if (bd.id === 'gou') dogTake(); else keepUse(bd.id); return; }
            // 机器排在营造之后。两者不挨着（坛在院里左、木箱在茅舍前），
            // 但顺序还是得写死：E 只干一件事，站在坛跟前按 E 只能是坛
            var mq = nearMachine();
            if (mq) { machUse(mq.id); return; }
            // 落点在出硐口前面隔着一整条坡底，两个人踩不到一起，
            // 但顺序还是放在 nearExit 之前 —— 靠右走到头时两个判定点很近，
            // 反过来的话 E 会先说「出硐」而人还站在落点上
            if (inMine() && nearShaft()) { useShaft(); return; }
            // 木箱排在归家前面。它跟茅屋门口**在同一个圈里**（homeR 210），
            // 而 E 键的顺序是「先判到的赢」—— 箱子排后的话，
            // 站在箱子跟前按 E 永远是归家，玩家会以为这个箱子开不了
            if (nearChest()) { openChest(); return; }
            if (nearHome()) {
              // 门口按 E 是**进屋**。归家和动灶都从屋里那一行走 ——
              // 之前是「能点火就开灶、不能点火才归家」，两条挤在同一个键上，
              // 家具也就没地方落脚（见 houseRows 那段注释）
              openHouse(); return;
            }
            // 歇脚处排在归家后面、出口前面。它是「往哪儿去」，
            // 出口是「走这一道口子」—— 两件事，碰上的时候歇脚处更管用
            if (nearStation()) { openStation(); return; }
            var ex = nearExit();
            if (ex) {
              // 雷雨天封硐口。要拦在**跳转之前**，而且得说清楚为什么 ——
              // 直接 gotoMap 的话玩家下到硐里才发现不对，而硐里是暗的，
              // 回头再走一趟才知道是天气，纯粹白折腾
              if (ex.to === 'shidong' && mineShut()) {
                toast('雷雨天硐口不敢下　·　山头劈下来的石头不认人。', 3600);
                return;
              }
              // **拦在跳转之前，而且说清去哪儿买**。原来这一道只在硐里面判：
              // 走到口前照下，下去以后满眼都是「还没有镐」——
              // 玩家白走一趟，而且那句「没有镐」是在他下到暗处之后才第一次听见的
              if (ex.to === 'shidong' && S.gear.jue <= 0) {
                toast('还没有镐，敲不动石头。墟市老丈那儿有卖的。', 3600);
                return;
              }
              gotoMap(ex.to, ex.spawn);
              toast(ex.label + '…', 1600);
              save();
              return;
            }
  }

    function actAt(cx, cy) {
      if (!S.started || S.ended) return;
      var cell = F.pick(cx, cy);
      // 硐里点岩面内任意一格都是「敲」，不管那一格自己敲开了没有。
      // 早先写成「点有石头的那一格才敲」，那是按单格判的 ——
      // 铁镐一下九格，中心那块挖空之后周围八块还好好的，点下去却变成了
      // 「走过去」，玩家看着满墙的石头点不动。判据必须是**这一下会动到的那一片**，
      // 那件事 mineArea 自己会算（一片都没剩就回一句「已经敲开了」）
      if (inMine()) {
        if (cell) { mineArea(cell[0], cell[1]); return; }
        S.walkTo = clampWalk(cx, cy);
        return;
      }
      if (cell && S.plots[cell[1]]) {
        var pl = S.plots[cell[1]][cell[0]];
        // 捏着种的时候，点田畦就是种下去 —— 不必先去器物架上切一遍。
        // 这是星露谷最顺手的那一下，留着它以后加别的「手持物」也有地方挂
        if (S.pendingSeed) { sowWith(FG.CROP_OF_SEED[S.pendingSeed], cell[0], cell[1]); return; }
        // 熟了且手上不是锄，就直接收
        if (pl.crop && pl.stage >= C[pl.crop].days && S.sel !== 'chu') harvest(cell[0], cell[1]);
        else useOn(cell[0], cell[1]);
      } else {
        // 点不可走的地方（山、屋、竹子）时走到最近能站的地方，
        // 而不是一路顶到边界上站着 —— 那样人会一直抖
        S.walkTo = clampWalk(cx, cy);          // 走过去
      }
    }

    /* UI 浮层压在画布上时，点到的其实是 UI 不是画面，点会被静默吃掉。
       这类坑踩过两次：一次是不可见的开卷层，一次是器物架盖住近处的田畦。
       统一在这里挡：最顶层不是画布就不当作游戏操作。 */
    function hitCanvas(e) {
      var top = document.elementFromPoint(e.clientX, e.clientY);
      return !top || top === cv || top.tagName === 'CANVAS';
    }

    cv.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !hitCanvas(e)) return;
      actAt(e.offsetX * W / cv.clientWidth, e.offsetY * H / cv.clientHeight);
    });
    /* 触屏走到位了**顺手做那件事**。
       原来这一支跟 mousedown 一样只调 actAt，而 actAt 只有三种结果：
       硐里敲 / 田畦种收 / **其余一律走过去**。
       E 那一长串判定（说话、捡蛋、归家、出门换图、抛竿）压根不在里面 ——
       于是触屏上这游戏过了头两分钟就走不下去了：
       人能跑、能锄、能收，可说不了话、出不了门、回不了家，
       而人情、托付、诗册、节日全挂在「说话」上。

       为什么不再等一下按 E：触屏上**没有 E**。这一套判定已经抽成 interact()，
       键和触屏走的是同一份，顺序永远一致。 */
    cv.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      if (!t) return;
      var rc = cv.getBoundingClientRect();
      var tx = (t.clientX - rc.left) * W / cv.clientWidth;
      var ty = (t.clientY - rc.top) * H / cv.clientHeight;
      var cell = F.pick(tx, ty);
      // 点田畦还是老规矩（种、收、锄）。**不在这条路上顶 interact()** ——
      // 点一下熟了的一畦该收的是收，不是先收一遍再顺手跟旁边的人说话
      if (cell && S.plots && S.plots[cell[1]]) { actAt(tx, ty); return; }
      if (inMine() && cell) { actAt(tx, ty); return; }
      // 点空地：先走过去，**走到位再顶一下 interact()**。
      // 这一步是触屏能出屋、能跟人搭话、能换图、能抛竿的全部来路 ——
      // 原来触屏只有「走过去」，那之后就没人再管了。
      // 目标要先夹到能站的地方：点山上时人该走到山脚下，而不是顶在山上抖
      var wt = clampWalk(tx, ty);
      S.walkTo = [wt[0], wt[1]];
      S.touchGo = true;
    });

    window.addEventListener('keydown', function (e) {
      var k = e.key;
      /* 一律拿**小写**那个比。e.key 是原样：Tab 是 'Tab' 不是 'tab'、
         Escape 是 'Escape' 不是 'escape'。
         原来只有数字键和 b 顺手写了大写（`k === 'b' || k === 'B'`），
         剩下那些全按小写比 —— 于是 **Tab 和 Esc 两条路从来没通过**：
         按 Tab 什么都不发生（看着像行囊打不开），
         按 Esc 也关不掉任何面板（面板上又没有别的出口）。
         面板是全屏浮层，只能靠键关的场合就有两层纸关不掉。 */
      var K = ('' + k).toLowerCase();
      // 还没入山时，键全归开卷：回车/空格 = 顶第一格那个按钮
      if (!S.started) {
        // **指真实的槽位按钮**（#slots 里第一个 .seal）。原来这一行写的是
        // getElementById('btn-new').click()，而 btn-new 在换成三格存档时就已经删了 ——
        // 按回车拿到 null，再 .click() 就是 TypeError，注释还写着「开卷按回车 = 入山」。
        // 那时候 36 套里没有一条按过回车（全都直接调 FG.startFrom），
        // 这条快捷键死了很久没人知道。现在 dev/shoot-slot.mjs 把回车和空格都按了一遍，
        // 判据是「进得去」加「控制台一条不涨」—— 只写前半条的话，抛异常那条路照样绿。
        if (K === 'enter' || K === ' ') {
          // **按 data-act 找「续/入山」，绝不顶「重来/空出来」。**
          // 取第一个 .seal 的话，坏档那一格的 data-act="over" 正好排在前面，
          // 而「重来」要按两下 —— 于是按一次回车只是把手武装上，
          // 人还站在开卷上，**看着像按了没反应**。
          // 更糟的是 armed 是模块级变量、不随 showTitle 清零，
          // 隔一会儿再按一下同一个键就真删了：同一个键两回，一回没反应一回毁存档。
          //
          // 而且**不限第 1 格**：坏档摆在哪一格是玩家自己的事，
          // 键只管「找一个能进游戏的按钮」。按 data-act 全局找，
          // 第 1 格是坏的就落到后面那一格的「入 山」上。
          var b0 = document.querySelector('#slots [data-act="cont"]')
                || document.querySelector('#slots [data-act="new"]');
          if (b0) b0.click();
        }
        return;
      }
      /* 每个面板键都是**开关**：开着 → 关掉这张；没开 → 别家有面板就什么都不做，
         什么都没有才开自己那张。

         「别家有面板就什么都不做」这一条容易漏：
         少了它，商店开着按 V 会把诗册也开出来，于是**两张纸叠在画面上** ——
         上面那张把货单盖住一半，而画面上还留着纸的边，看着像渲染坏了。
         判据用**自己那张开没开**（albumOpen 之类），不用 panelOpen()：
         后者是「有没有任何面板」，拿它判「这张开没开」的话，
         会去关掉最先找到的那张，而那张未必是自己这张
         （症状：按 V，别的面板没了，诗册还在）。 */
      if (K === 'v') { if (albumOpen()) { closeAlbum(); return; } if (panelOpen()) return; openAlbum(); return; }
      if (K === 'tab' || K === 'i') {
        e.preventDefault();
        if (bagOpen()) { closeBag(); return; }
        if (panelOpen()) return;
        openBag(); return;
      }
      if (K === 'o') { if (binOpen()) { closeBin(); return; } if (panelOpen()) return; openBin(); return; }
      if (K === 'b') {
        if (shopOpen()) { closeShop(); return; }
        if (panelOpen()) return;
        var sn = nearNpc();
        if (sn && sn.shop) {
          // 天黑收摊。**说清楚为什么、什么时候再来** ——
          // 站着对着一扇关了的门按 B，什么都不说的话
          // 玩家只会以为货单空了
          if (FG.isNight(S.min)) { toast('铺子收了，天黑不出门。明早再来。', 3400); return; }
          openShop(sn); return;
        }
        var sg = nearGoneNpc();
        if (sg && sg.shop) { toast('铺子收了，天黑不出门。明早再来。', 3400); return; }
        toast('这里没有可看的东西。');
        return;
      }
      /* Esc 关掉最上面那张面板。**必须排在 panelOpen 那一支前面**：
         面板开着时按 Esc，本该关掉的就是那张面板 ——
         而 `if (panelOpen()) return` 会在 Esc 之前就把按键吃掉，
         于是 Esc 这条路从来没通过过。全屏浮层只剩鼠标点得到，
         面板上留了 × 的还能关，没留的就彻底卡住（结算卡就没有 ×）。

         顺手把 M 也提到这儿：面板开着时按 M 静个音是合理诉求，
         之前它跟 E 挤在 panelOpen 后面，同样按不动。 */
      if (K === 'escape') { closeTopPanel(); return; }
      if (K === 'm') { toast(FG.audio.toggle() ? '静音' : '有声'); return; }
      /* E 在对话开着的时候是「翻到下一句」，不是「又跟他说一次」。
         卡上那个按钮写的是「续」，E 干的是同一件事 ——
         人站在他面前再按一下 E，是这个游戏里最自然的「我知道了，再来一句」。

         **这一支必须排在 panelOpen 之前**，而且要判「卡开没开」而不是「有没有面板」：
         排在后面的话 `if (panelOpen()) return` 会把 E 吃掉（那正是这条 FAIL 的正脸）；
         用 panelOpen 判的话，诗册开着时按 E 也会重开一遍对话。

         卡上那两行（递酒 / 回他的话）开着的时候 E 不翻句 ——
         那是两件待办，不是「下一句」。翻句只在他正常说话的时候做。 */
      if (K === 'e' || K === 'enter') {
        if (!document.getElementById('dlg').classList.contains('hide')
            && !document.getElementById('dlg-act').classList.contains('hide')
            && !document.getElementById('dlg-quest').classList.contains('hide')
            && dlgNpc) { talk(dlgNpc); return; }
        interact(); return;
      }
      // 面板开着的时候，游戏键一概不生效。**必须排在器物那一支前面**：
      // 排在后面的话，诗册开着按 1 就把锄头换了，
      // 玩家看着器物架上换了东西，还以为面板跟游戏是一套的
      if (panelOpen()) return;
      if (e.key >= '1' && e.key <= '8') { S.sel = TOOLS[+e.key - 1].k; updateHUD(); return; }
    });

    /* 这两个是 bindInput 的内部函数，所以只能在这儿挂 ——
       挂到模块顶层会 ReferenceError（interact 不是全局的），
       而那个异常发生在 IIFE 末尾，**整个 init 都不跑**：
       页面看着正常、FG 也有一百多个键，就是进不去游戏。
       挂出来是为了让触屏那一遍能直接量「触屏点一下能不能说话」：
       断言够不着的函数，在验收里等于不存在。 */
    FG.interact = interact;
    FG.actAt = actAt;
  }

  /* 那一天的对话。送的是种子（理由写在 FG.BIRTH 上面那段），
     给完立刻记上 —— 记在**发出去**这一步，不是在他道谢之后：
     对话卡点一下才关，万一玩家手快连点两下 E，不先记就会给两回。

     一次给完，别循环 invGive(k,1) 再判返回值 ——
     **invGive 成功时不返回任何东西**，判它等于「凡是成功都当失败」，
     于是每份礼只发得出一份，而表上写着三份。 */
  function birthGive(n) {
    var b = FG.BIRTH[n.id], it = FG.BAG_IDX[b.gift];
    birthFix();
    S.birth[n.id] = FG.yearOf(S.day);
    invGive(b.gift, b.n);
    dlgNpc = n;
    dlgName(n);
    document.getElementById('dlg-text').textContent = b.say;
    // 这一句是游戏自己说的话，出处一律「——」，不硬凑一句像陶句的
    document.getElementById('dlg-from').textContent = '——';
    // **把卡显出来**。原来漏了这一句：台词写好了、字也填上了，可卡还收着 ——
    // 玩家只看见一个「生辰 · 粟 ×3」的浮字，他说的那句话根本没出得来。
    // 之所以一直没被发现，是因为对话卡常常还开着上一次谈话的，
    // 写进去看着就「像是显示了」；一旦前面有人把卡收走（换图）就露馅
    document.getElementById('dlg').classList.remove('hide');
    FG.audio.play('buy');
    // 浮字排在对话卡后面弹（两边占的是同一块地方）
    rewardPush('生辰', [it.name + ' ×' + b.n]);
    save();
  }

  function talk(n) {
    var box = document.getElementById('dlg');
    dlgNpc = n;
    // 生辰排在最前：他今天生日，你却先跟他对了一遍托付的话，
    // 那份礼就压过去了 —— 而一年只有这么一天。
    // 托付办成了的话也仍然先说生辰，两件都要紧，生辰更等不得。
    if (birthTurn(n.id)) { birthGive(n); return; }
    // 人情。**说话算一分**，而且升档的那一句压在托付回话前面 ——
    // 托付办成了要立刻说，而「熟」「相知」这两句说完了就没了。
    renAdd(n.id, FG.REN_SPEECH);
    var ru = renForcedLine(n.id);
    if (ru) {
      renUp(n.id);
      dlgName(n);
      document.getElementById('dlg-text').textContent = ru.step.v;
      document.getElementById('dlg-from').textContent = '——';
      // 到最高一档，他记住你爱吃哪一味，留一样下来。**一辈子只给一次**
      var rg = renGift(n.id);
      if (rg) {
        invGive(rg, 1);
        rewardPush('相知', [FG.BAG_IDX[rg].name + ' ×1']);
      }
      FG.audio.play('buy');
      save();
      return;
    }
    // 托付和回话要挑。先看这个人有没有办成的托付 —— 办成了就该先说这事，
    // 玩家是带着「我做到了」来的，让他先听一段寒暄才找得到那个按钮
    var q = questOf(n.id);
    if (q && S.quest[q.id] === 'given' && questProgress(q).done) {
      dlgName(n);
      document.getElementById('dlg-text').textContent = q.done;
      document.getElementById('dlg-from').textContent = '——';
    } else if (birthSoon(n.id)) {
      // 离他生日七天以内，他才提一句。这是**唯一**能提前知道日子的办法：
      // 不排一张日程表（那就是待办清单了），让他自己在说话的时候说出来。
      // 门槛是「七天以内」而不是「每 N 次对话」——
      // 后者听着聪明，实际是七个 NPC 一年轮流插闲话，
      // 玩家听到的白话比陶诗还多，而那三句诗才是这个游戏的心。
      var b0 = FG.BIRTH[n.id], left0 = birthIn(n.id);
      dlgName(n);
      document.getElementById('dlg-text').textContent =
        (left0 === 1 ? '明天' : (left0 + '天后')) + '是我生日。' + b0.ask;
      document.getElementById('dlg-from').textContent = '——';
    } else {
      var line = n.lines[S.talkIdx % n.lines.length];
      dlgName(n);
      document.getElementById('dlg-text').textContent = line[0];
      document.getElementById('dlg-from').textContent = line[1];
      // **轮到下一句**。原来这一行没有 —— S.talkIdx 每天清零、却从来没人加过，
      // 于是每个 NPC 永远只说 lines[0]，他表里那三句诗有两句
      // 玩家一辈子听不到。而这几句是这游戏最值钱的东西：
      // 「暧暧远人村」那句天天见，而「过门更相呼，有酒斟酌之」永远轮不到。
      // 加在**读完**之后、升档那一支之外：升档要先说升档那句，不能被它顶掉
      if (S.talkIdx < 9999) S.talkIdx++;
    }
    // 收句先攒着：对话卡和浮字占的是同一个位置（都在 top:12% 附近），
    // 等玩家把卡点了再弹。
    albumAdd('firstTalk', true);
    if (!S.met[n.id]) {
      S.met[n.id] = true;
      var m = 0, k;
      for (k in S.met) m++;
      if (m >= 3) albumAdd('talkThree', true);
    }
    // 第一次托付就在这时候给。为什么不是一见面就给：还没动过手的人
    // 派活儿，听着像使唤；见过他一次之后才像托付。
    if (q && !S.quest[q.id] && S.met[n.id] && !questLocked(q)) giveQuest(q);
    // 卡上那两行放在**最后**刷。托付是上面才给下来的，刷在前面的话，
    // 「已经办成、可以说了」这一行得等下一次谈才亮 —— 明明这一次就能办成，
    // 按钮却要人多来一趟，像是坏了
    box.classList.remove('hide');
    refreshActs();
    save();
  }

  /* ---------------- 杂货铺 ---------------- */
  // 器物那一格的名字价钱说明都在 FG.GEAR 里，货单只写「哪一件的第几级」。
  // 这里把那一行补全 —— 补全的活儿只在这里做一次，
  // 摆面板和真的买都走它，两边才不会出现「面板上写 760，点下去扣 1680」
  function shopItem(g) {
    if (g.kind === 'gear') {
      var t = (FG.GEAR[g.gear] || [])[g.lv - 1];
      if (!t) return null;
      return {
        k: g.k, kind: 'gear', gear: g.gear, lv: g.lv,
        name: t.name, price: t.price, desc: t.desc
      };
    }
    // 营造走同一套「名字价钱说明都在表里」，摆面板和真的买都走它，
    // 两边才不会有一处写 760、另一处写 1680
    if (g.kind === 'build') {
      var bt = (FG.BUILD[g.b] || {}).lv;
      if (!bt) return null;
      var bb = bt[g.lv - 1];
      if (!bb) return null;
      return { k: g.k, kind: 'build', b: g.b, lv: g.lv, name: bb.name, price: bb.price, desc: bb.desc };
    }
    // 机器跟营造同一套：立在地上的、分级买、名字价钱说明都在表里
    if (g.kind === 'machine') {
      var mt = (FG.MACHINE[g.m] || {}).lv;
      if (!mt) return null;
      var mm = mt[g.lv - 1];
      if (!mm) return null;
      return { k: g.k, kind: 'machine', m: g.m, lv: g.lv, name: mm.name, price: mm.price, desc: mm.desc };
    }
    // 家具也走同一套。**漏了这一支的代价特别安静**：
    // 面板上写的是货单那一行里的 name/price（种子那种），
    // 而家具的货单只写「哪一件的第几级」—— g.name 是 undefined、g.price 也是，
    // 于是买下去钱被减成 NaN（面板上看着「钱不够」还是「已经造好了」全对），
    // 提示语变成「undefined收拾好了」
    if (g.kind === 'furn') {
      var ft = (FG.FURN[g.f] || {}).lv;
      if (!ft) return null;
      var ff = ft[g.lv - 1];
      if (!ff) return null;
      return { k: g.k, kind: 'furn', f: g.f, lv: g.lv, name: ff.name, price: ff.price, desc: ff.desc };
    }
    // 歇脚处的路，同一套
    if (g.kind === 'road') {
      var rt = (FG.ROAD[g.r] || {}).lv;
      if (!rt) return null;
      var rr = rt[g.lv - 1];
      if (!rr) return null;
      return { k: g.k, kind: 'road', r: g.r, lv: g.lv, name: rr.name, price: rr.price, desc: rr.desc };
    }
    return g;
  }
  /* 这一样「买了没有 / 买不买得起」。**只写这一处** ——
     货单上每一行、还有轮换那三样「本旬新到」都读它。
     各写一遍的话，买下一件之后「新到」那三样里还留着它，
     而症状是「明明已经造好了，墟市还说本旬新到」，
     看着像货单跟买的那一支对不上。 */
  function shopOwns(g) {
    if (g.kind === 'gear') {
      var cur = S.gear[g.gear] || 0;
      return { owned: cur >= g.lv, locked: cur < g.lv && cur !== g.lv - 1, why: '这把' };
    }
    if (g.kind === 'build') {
      var cb = (S.build || {})[g.b] || 0;
      return { owned: cb >= g.lv, locked: !(cb >= g.lv) && cb !== g.lv - 1, why: '造好' };
    }
    if (g.kind === 'machine') {
      machFix();
      var mc = S.mach.lv[g.m] || 0;
      return { owned: mc >= g.lv, locked: !(mc >= g.lv) && mc !== g.lv - 1, why: '有' };
    }
    if (g.kind === 'furn') {
      furnFix();
      var fc = S.furn[g.f] || 0;
      return { owned: fc >= g.lv, locked: !(fc >= g.lv) && fc !== g.lv - 1, why: '收拾好' };
    }
    if (g.kind === 'road') {
      roadFix();
      var dc = S.road[g.r] || 0;
      return { owned: dc >= g.lv, locked: !(dc >= g.lv) && dc !== g.lv - 1, why: '通好' };
    }
    // 种子没有「买不买得起」：它随时可买，也永远不会「已经是」
    return { owned: false, locked: false, why: '' };
  }
  // 这一句给货单那行写「已经是这把 / 得先有前一把」
  function ownNote(g) {
    if (g.kind === 'gear') return shopOwns(g).owned ? '已经是这把' : (shopOwns(g).locked ? '得先有前一把' : '');
    if (g.kind === 'build') return shopOwns(g).owned ? '已经造好了' : (shopOwns(g).locked ? '得先有前一个' : '');
    if (g.kind === 'machine') return shopOwns(g).owned ? '已经有了' : (shopOwns(g).locked ? '得先有前一个' : '');
    if (g.kind === 'furn') return shopOwns(g).owned ? '已经收拾好了' : (shopOwns(g).locked ? '得先有前一个' : '');
    if (g.kind === 'road') return shopOwns(g).owned ? '路已经通好了' : (shopOwns(g).locked ? '得先有前一个' : '');
    return '';
  }

  /* 墟市每 6 天进一批「新到」。**这里不收走任何一样东西** ——
     轮换要是把营造、机器、家具藏起来没到那天才卖，那就是拿等待卡进度，
     跟这游戏「不惩罚只少收」是拧着的。
     真的只有「到货」这一层：新到的那几样在货单顶上单列一块，
     换新的时候重新挑一次。玩家隔几天去墟市看一眼有新的没，
     而想买什么随时买得到。

     挑法要**确定性**：一天一个起点，顺次取三样你还没买的。
     拿 Math.random 的话刷新一次页面货单就变了，
     而玩家会拿「第几天看到什么」去对诗册上的日子。
     顺次取还顺带给了「老丈先到你要的那几样」这层意思。 */
  FG.SHOP_NEW_N = 3;
  FG.shopTurn = function (day) { return Math.floor((day - 1) / FG.SOLAR_DAYS); };
  FG.shopNewLeft = function (day) {   // 还有几天换新
    return FG.SOLAR_DAYS - ((day - 1) % FG.SOLAR_DAYS);
  };
  FG.shopNew = function (day) {
    var list = FG.SHOP.xushi || [], mine = [], i, g, o;
    for (i = 0; i < list.length; i++) {
      g = shopItem(list[i]);
      if (!g) continue;
      o = shopOwns(g);
      if (o.owned) continue;              // 已经有的不拿来当「新到」
      mine.push(list[i]);
    }
    if (!mine.length) return [];
    var n = Math.min(FG.SHOP_NEW_N, mine.length);
    var s = (FG.shopTurn(day) * FG.SHOP_NEW_N) % mine.length;
    var out = [];
    for (i = 0; i < n; i++) out.push(mine[(s + i) % mine.length]);
    return out;
  };

  // 和其余面板同一个形状（见 albumOpen 那段注释）
  function shopOpen() { return !document.getElementById('sh').classList.contains('hide'); }
  function closeShop() { document.getElementById('sh').classList.add('hide'); }

  /* Esc 关掉**开着的那几张**，从最上面那张往下关。
     顺序就是叠放顺序（后来的开着就在上面）：结算 > 对话 > 面板 > 行囊 > 木箱 > 屋 > 歇脚。
     关一张就收手 —— 连着按 Esc 一次关一张，
     而不是一次全关（玩家是「我先看看这一张」才按的）。

     **结算卡（#de）必须排在最前**：它是过夜那一下弹出来的，
     而玩家按 Esc 的时机常常是「不想睡了」—— 结果关掉的不是它，
     底下那张顺手没了，还以为游戏把存档清了。 */
  function closeTopPanel() {
    var ids = ['de', 'dlg', 'st', 'sh', 'hs', 'rd', 'al', 'bg', 'ch', 'bx'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && !el.classList.contains('hide')) { el.classList.add('hide'); return ids[i]; }
    }
    return null;
  }
  function openShop(n) {
    var list = FG.SHOP[n.id] || [];
    var box = document.getElementById('sh');
    document.getElementById('sh-name').textContent = n.name + '的铺子';
    // 本旬新到的那一块。**画在 #sh-list 外面**（#sh-top）——
    // 那个列表是 flex 换行 + :nth-child(odd) 分左右两栏的，
    // 把标题当兄弟节点塞进去，后面每一行的奇偶就整体错一列。
    // 跟诗册「挂架」那一条是同一个坑。
    var nv = (n.id === 'xushi') ? FG.shopNew(S.day) : [];
    var topEl = document.getElementById('sh-top');
    if (topEl) {
      topEl.innerHTML = (n.id === 'xushi')
        ? ('<div class="sh-new-h">本 旬 新 到　·　还有 ' + FG.shopNewLeft(S.day) + ' 天换新</div>'
          + '<div class="sh-new">' + nv.map(function (raw) {
            var g = shopItem(raw);
            return g ? '<span class="chip">' + g.name + '</span>' : '';
          }).join('') + '</div>')
        : '';
      topEl.style.display = (n.id === 'xushi') ? '' : 'none';
    }
    document.getElementById('sh-list').innerHTML = list.map(function (raw) {
      var g = shopItem(raw);
      if (!g) return '';
      // 种子那一支和器物那一支的「能不能买」判据完全不同：
      // 种子永远买得起，器物要先有前一把。
      // 合成一条写的话，种子会被算成 S.gear[undefined] 和 undefined - 1，
      // 于是五种种子齐刷刷显示「得先有前一把」，而一眼看过去还挺像那么回事
      var o = shopOwns(g);
      var owned = o.owned, locked = o.locked;
      var note = (owned || locked) ? ownNote(g) : (g.price + ' 钱');
      return '<div class="goods' + (owned || locked ? ' owned' : '')
        + (nv.indexOf(raw) >= 0 ? ' fresh' : '') + '" data-k="' + g.k + '">'
        + '<b>' + g.name + (nv.indexOf(raw) >= 0 ? '<span class="tag">新</span>' : '') + '</b>'
        + '<i>' + g.desc + '</i>'
        + '<u>' + note + '</u></div>';
    }).join('');
    box.classList.remove('hide');
    updateHUD();
  }

  function buy(k) {
    var list = FG.SHOP.xushi || [];
    var raw = null;
    for (var i = 0; i < list.length; i++) if (list[i].k === k) raw = list[i];
    if (!raw) return;
    var g = shopItem(raw);
    if (!g) return;
    if (g.kind === 'build') {
      // 造出来的东西不进 S.sel：那是「手上拿着哪一件」。鸡舍立在地上，
      // 写进去的话买完鸡舍手上的锄会莫名其妙变成鸡舍，而器物架上没有这一格
      var cB = (S.build || {})[g.b] || 0;
      if (cB >= g.lv) { toast('你已经造好' + g.name + '了。'); return; }
      // 同样只能一级一级买：跳过去「竹引水」就成了从来没人用过的中转站，
      // 而石砌渠一到手就再也回不去 —— 分级就没有意义了
      if (cB !== g.lv - 1) { toast('得先有' + ((FG.BUILD[g.b].lv[g.lv - 2] || {}).name || '前一个') + '。'); return; }
      if (S.gold < g.price) { toast('钱不够，还差 ' + (g.price - S.gold) + ' 钱。'); return; }
      S.gold -= g.price;
      S.build[g.b] = g.lv;
      FG.audio.play('buy');
      // 今天造的不算数 —— 蛋奶毛是「明早」才有的，水也是「明早起」才浇的。
      // 当场补一次等于凭空多下一窝蛋、多浇一遍田。
      // 分派看的是 def.act（有没有门和草料），不是「是不是鸡舍」——
      // 写死 coop 的话买牛棚会说出「牛棚通水了，明早起 5 行不用再提壶」
      var bdef = FG.BUILD[g.b], bkl = bdef.lv[g.lv - 1];
      if (g.b === 'gou') {
        // 狗窝不是棚：没有门也没有草料，所以**不能说「开门撒粮」**
        toast('狗窝搭好了。它' + bkl.days + ' 天上山跑一趟，回来把东西搁在窝边。', 3600);
      } else if (bdef.act) {
        toast(bdef.name + '立起来了。走过去按 E 开门撒粮，明早上就有 '
          + bkl.yield.n + ' ' + FG.BAG_IDX[bkl.yield.k].name + '，够吃 ' + bkl.days + ' 天。', 3600);
      } else {
        toast(bdef.name + '通水了。明早起，' + bkl.rows + ' 行不用再提壶。', 3600);
      }
    } else if (g.kind === 'machine') {
      // 机器的买法跟营造一模一样，只是落在 S.mach.lv 上
      machFix();
      var mB = S.mach.lv[g.m] || 0;
      if (mB >= g.lv) { toast('你已经有' + g.name + '了。'); return; }
      if (mB !== g.lv - 1) { toast('得先有' + ((FG.MACHINE[g.m].lv[g.lv - 2] || {}).name || '前一个') + '。'); return; }
      if (S.gold < g.price) { toast('钱不够，还差 ' + (g.price - S.gold) + ' 钱。'); return; }
      S.gold -= g.price;
      S.mach.lv[g.m] = g.lv;
      FG.audio.play('buy');
      // 跟营造同一条：今天买的坛是空的，料要自己搁进去，也等明早
      // 买完这一句要说得出「出来的是什么」—— 玩家这时手里只有货单上的一个价钱，
      // 不告诉他出几罐什么，他得先走到机器跟前站住了才问得出
      // 坛有五条方子（搁什么出什么），所以不点名，只说「搁什么出什么」
      var mR = FG.MACHINE_RECIPES[g.m] || [];
      var mOut = mR.length === 1 ? '来取' + mR[0].name + '。'
        : (mR.length ? '来取（搁的什么料，出的就是什么）。' : '来取。');
      toast(g.name + '摆好了。走过去按 E 把料搁进去，' + FG.MACHINE[g.m].lv[g.lv - 1].days + ' 天' + mOut, 3600);
    } else if (g.kind === 'furn') {
      // 家具的买法跟营造、机器一模一样，只是落在 S.furn 上
      furnFix();
      var fB = S.furn[g.f] || 0;
      if (fB >= g.lv) { toast('你已经收拾好' + g.name + '了。'); return; }
      if (fB !== g.lv - 1) { toast('得先有' + ((FG.FURN[g.f].lv[g.lv - 2] || {}).name || '前一个') + '。'); return; }
      if (S.gold < g.price) { toast('钱不够，还差 ' + (g.price - S.gold) + ' 钱。'); return; }
      S.gold -= g.price;
      S.furn[g.f] = g.lv;
      // 行囊的行数跟着仓房走，所以买完得让格子重算一遍
      bagFit();
      FG.audio.play('buy');
      toast(g.name + '收拾好了。' + furnEffect(g.f, g.lv), 3600);
    } else if (g.kind === 'road') {
      // 路的买法跟营造、机器、家具一模一样，落在 S.road 上
      roadFix();
      var rB = S.road[g.r] || 0;
      if (rB >= g.lv) { toast('这段路你已经走过一遍了。'); return; }
      if (rB !== g.lv - 1) { toast('得先有' + ((FG.ROAD[g.r].lv[g.lv - 2] || {}).name || '前一个') + '。'); return; }
      if (S.gold < g.price) { toast('钱不够，还差 ' + (g.price - S.gold) + ' 钱。'); return; }
      S.gold -= g.price;
      S.road[g.r] = g.lv;
      FG.audio.play('buy');
      toast(g.name + '铺好了。歇脚处那张清单上多了 '
        + (FG.ROAD[g.r].lv[g.lv - 1].legs - (g.lv > 1 ? FG.ROAD[g.r].lv[g.lv - 2].legs : 0)) + ' 处。', 3600);
    } else if (g.kind === 'gear') {
      var cur = S.gear[g.gear] || 0;
      if (cur >= g.lv) { toast('你已经有' + g.name + '了。'); return; }
      // 只能一级一级买。跳级会让「铜锄 1×3」变成从来没人用过的中转站，
      // 而铁锄 3×3 一到手就再也回不去 —— 分级就没有意义了
      if (cur !== g.lv - 1) { toast('得先有' + ((FG.GEAR[g.gear][g.lv - 2] || {}).name || '前一把') + '。'); return; }
      if (S.gold < g.price) { toast('钱不够，还差 ' + (g.price - S.gold) + ' 钱。'); return; }
      S.gold -= g.price;
      S.gear[g.gear] = g.lv;
      S.sel = g.gear;
      FG.audio.play('buy');
      toast('换成了' + g.name + '。');
    } else {
      if (S.gold < g.price) { toast('钱不够，还差 ' + (g.price - S.gold) + ' 钱。'); return; }
      S.gold -= g.price;
      S.seeds[g.crop] = (S.seeds[g.crop] || 0) + 1;
      FG.audio.play('buy');
      toast('买下一份' + g.name + '。');
    }
    var n = nearNpc();
    if (n && n.shop) openShop(n);
    updateHUD();
    save();
  }

  /* 开卷：每次启动都要摆出来，两个按钮都会把它关掉。
     踩过的坑：早先写成「有存档就跳过开卷」，结果 #title 这个满屏
     pointer-events:auto 的浮层不可见地一直压着画面，把所有画布点击全吃了 ——
     画面看着正常，点哪儿都没反应。 */
  /* 标题：三格。每格写清那一世的样子（第几年第几天、诗册几句、见闻几味），
     空的那一格只有一个「入 山」。
     **盖掉一格要按两下**：一格是别人玩了半个月的田，
     一次点错就抹掉，标题上那点字挡不住手快。 */
  var slotArm = -1, slotArmTimer = null;
  function showTitle() {
    var t = document.getElementById('title');
    var box = document.getElementById('slots');
    t.classList.remove('hide');
    var h = '';
    for (var i = 0; i < FG.SAVE_SLOTS; i++) {
      var info = slotInfo(i);
      var body, cta;
      if (info && info.bad) {
        body = '<div class="sl-bad">这一格读不出来了</div>';
        cta = '<button class="seal" data-act="over" data-s="' + i + '">空 出 来</button>';
      } else if (info) {
        body = '<div class="sl-d">第 ' + FG.yearOf(info.day) + ' 年 · 第 ' + FG.dayOfYear(info.day) + ' 天'
          + (info.solar ? ' · ' + info.solar : '') + '</div>'
          // 三件事**各占一行**，别塞进同一个 div。
          // 塞在一起时那行有 22 个字宽、卡只有 15 字宽，放不下就折行 ——
          // 而它是一个长 run，断在哪儿是随机的：实测断在「见闻」和「0 味」中间。
          // 断行是随机的这件事本身就没法靠调宽度解决，得从结构上断掉
          + '<div class="sl-s">' + info.map + '</div>'
          + '<div class="sl-s">诗册 ' + info.album + ' 句　·　见闻 ' + info.dex + ' 味</div>'
          + '<div class="sl-s">进项 ' + info.earned + ' 钱</div>';
        cta = '<button class="seal" data-act="cont" data-s="' + i + '">续</button>'
          + '<button class="seal ghost" data-act="over" data-s="' + i + '">重 来</button>';
      } else {
        body = '<div class="sl-e">空着</div>';
        cta = '<button class="seal" data-act="new" data-s="' + i + '">入 山</button>';
      }
      h += '<div class="slot" data-slot="' + i + '">'
        + '<div class="sl-n">第 ' + (i + 1) + ' 格</div>' + body
        + '<div class="sl-a">' + cta + '</div></div>';
    }
    box.innerHTML = h;
    box.onclick = function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      var s = +b.getAttribute('data-s'), act = b.getAttribute('data-act');
      if (act === 'cont') { S.slot = s; startFrom('cont'); return; }
      if (act === 'new') { S.slot = s; startFrom('new'); return; }
      // 重来 / 空出来：要按两下
      if (slotArm === s) { slotArm = -1; S.slot = s; startFrom('new'); return; }
      slotArm = s;
      box.querySelectorAll('.sl-warn').forEach(function (e) { e.classList.remove('sl-warn'); });
      b.classList.add('sl-warn');
      b.textContent = '真 的 重 来';
      if (slotArmTimer) clearTimeout(slotArmTimer);
      slotArmTimer = setTimeout(function () {
        slotArm = -1;
        box.querySelectorAll('.sl-warn').forEach(function (e) {
          e.classList.remove('sl-warn');
          var si = +e.getAttribute('data-s');
          e.textContent = slotInfo(si) && !slotInfo(si).bad ? '重 来' : '空 出 来';
        });
      }, 4000);
    };
  }
  /* 进山：new 是从头开，cont 是接着玩。分成两支是因为两者要清的字段不同，
     而原来「入山」那一支自己重新写了一遍所有账 —— 少清一本就漏 */
  function startFrom(how) {
    var t = document.getElementById('title');
    if (slotArmTimer) { clearTimeout(slotArmTimer); slotArmTimer = null; }
    slotArm = -1;
    if (how === 'cont') {
      var has = load();
      if (!has) { showTitle(); return; }   // 这一格刚被清掉了：回标题重来，别进一个空局
      t.classList.add('hide');
      S.started = true;
      // 读档只把 S.map 填回去了，梯形和底图还没跟着切 —— 得补这一次 gotoMap
      gotoMap(S.map, [S.player.x, S.player.y]);
      // 家具这一本账读回来了，行囊的行数也得跟着回来。
      // **不补的话症状是「行囊还是那么高」** —— 存的是 7 行，
      // 读出来是 6 行，而画面上只是矮了一点点，看不出是哪一级丢了
      furnFix();
      roadFix();
      startDay(true);
      return;
    }
    t.classList.add('hide');
    S.day = 1;
    S.gold = 500;
    S.bag = { dou: 0, su: 0, shu: 0, ji: 0, ju: 0 };
    S.pouch = {};
    S.picked = {};
    S.steles = {};
    S.jiu = 0; S.made = {}; S.bin = {}; S.binQ = 0; S.chest = {}; S.cookN = 0; S.favor = {};
    S.ore = {}; S.rock = {}; S.mineFloor = 0; S.mineDeep = 0;
    S.jiuYear = [];
    // 诗册和田地也得清。原以为「入山」是干净的入口，其实 init() 早就把
    // S 填过一遍了，而上面那些赋值只改了几个字段 —— 上一世的句子和
    // 上一世的田原样留着。玩家的路径很朴素：玩几天，按 F5 回到标题，
    // 点「入山」而不是「续前日」，于是新局从一块翻好的湿田开始
    S.plots = [];                       // 下一个 gotoMap 会按农地图重铺一遍
    S.album = {}; S.met = {}; S.got = {}; S.earned = 0;
    // 五门手艺也是重开就归零的：手艺是这一世练出来的
    skillInit();
    totalInit();
    festInit();
    buildInit();
    // 后面这几本是 9 月以来陆续加的。**每加一本账就得在这里补一行** ——
    // 忘了的现象是「新局一开局就人人相知、到处是挂架」，看着像送的东西
    renInit();
    S.dex = { good: {}, fish: {}, ore: {} };
    S.birth = {};
    S.pendingSeed = null;
    S.fishing = null;
    S.catchCount = 0;
    S.seeds = { dou: 8, su: 4, shu: 3, ji: 2, ju: 2 };
    S.gear = { chu: 0, piao: 0, jue: 0 };
    S.started = true;
    gotoMap('nanshan', [900, 800]);
    startDay(true);
    save();
  }

  window.addEventListener('DOMContentLoaded', init);
  FG.giveWine = giveWine;
  FG.handQuest = handQuest;
  FG.canGive = canGive;
  // 递了几坛酒。验收要能核「递满两坛才换到诗」，
  // 而判据得是**坛数不是人情分** —— 人情分会被说话顶上去
  FG.winePts = winePts;
  FG.talk = talk;
  // 行囊是读模型，导出这个读函数好让验收直接对着它核 ——
  // 核「行囊里摆的数」和「结算真的出货的数」是不是同一份，比看画面靠谱
  FG.bagList = bagList;
  FG.openBag = openBag;
  FG.openBin = openBin;
  FG.binList = binList;
  FG.binHeld = binHeld;
  FG.binSellable = binSellable;
  FG.binWorth = binWorth;
  FG.chestFix = chestFix;
  FG.chestList = chestList;
  FG.chestHeld = chestHeld;
  FG.chestCount = chestCount;
  FG.chestMove = chestMove;
  FG.openChest = openChest;
  FG.closeChest = closeChest;
  FG.chestOpen = chestOpen;
  FG.nearChest = nearChest;
  FG.festFix = festFix;
  FG.festivalOn = festivalOn;
  FG.festCrowd = festCrowd;
  FG.festSaid = festSaid;
  FG.festLeft = festLeft;
  FG.festGot = festGot;
  FG.festTalk = festTalk;
  FG.npcAt = npcAt;
  FG.nearNpc = nearNpc;
  // 分级这块的判据全是纯读函数，导出来让验收直接核，
  // 别在测试里另写一份「一级是 1×3、二级是 3×3」—— 那份会和 data.js 分叉
  FG.gearOf = gearOf;
  FG.gearCells = gearCells;
  FG.hoverSpan = hoverSpan;
  // 石硐的判据全是纯读函数加一个动作，导出来让验收直接核。
  // 布局是用层号当种子洗出来的，所以断言可以写死「第 3 层第 5 块是铁砂」——
  // 用 Math.random 的话就只能写「大概会出铁砂」，那种断言等于没写
  FG.mineArea = mineArea;
  FG.rockOf = rockOf;
  FG.rockAt = rockAt;
  FG.rockCells = rockCells;
  FG.mineLeft = mineLeft;
  FG.mineCleared = mineCleared;
  FG.useShaft = useShaft;
  FG.inMine = inMine;
  FG.mineDim = mineDim;
  // 行囊的说明行只在下标变化时重画，探针要指到具体某一件就得能直接调它
  FG.hintBag = bagTip;
  // 灶上「今天做得出什么」的判据。验收要核「蛋羹在够料时亮着」就得读它，
  // 不然只能去点面板 —— 而点面板验的是 UI，不是这一条判据本身
  FG.cookable = cookable;
  // cook() 本身也导出来。cookCap / cookable 都是纯读函数，读的是「能不能做」，
  // 而「做出来没有」只有走 cook 才量得到 —— 通玩脚本要一天做几口、
  // 验收要核「酿的手艺记在做成的那一刻而不是按下的那一刻」，
  // 两边都得能直接调它，不必去点灶面板
  FG.cook = cook;
  // 后山那六方刻石。**读碑要走 nearStele + E 那一支才拿得到**，
  // 而通玩脚本要「一天把六方都读了」——它不像玩家那样走过去，
  // 导出来是为了让它能核「读齐了才给最后那半句」
  FG.readStele = readStele;
  // 四季要验「藏季翻不动地」「藏季种不下去」，得能真的调那两条路。
  // 走真鼠标事件当然也行，但翻地是「一下几畦」的那个面积算式 ——
  // 绕过去调不到，等于验的不是这回事
  FG.workArea = workArea;
  FG.sowWith = sowWith;
  // 藏季要验「熟了照收」。收成这一下是独立的一条路
  // （点畦时手上不是锄就直接收），不导出就调不到
  FG.harvest = harvest;
  FG.groundFrozen = FG.groundFrozen;
  // 营造的补账函数也导出去：验收要核「存档被手改成越界等级时按没有算」，
  // 就得先把那一项真的写成越界 —— 而写完得有人把它夹回来
  FG.buildFix = buildFix;
  FG.buildInit = buildInit;
  // 格子几何也导出来：验收要「点第三行第一格」，就得按画布真实几何换算成屏幕坐标。
  // 之前测试里另抄了一份 {slot:80,pad:6,w:680,h:376}，抄的那份跟着改一次就分叉了，
  // 点下去落在别的格上，症状只是「点豆种种的是别的苗」
  FG.BAG_GEO = BG;
  // 器物架的八格也导出来。架子上不只农具，还有五格种子
  // （1 锄 2 瓢 3-7 五种种 8 镐）—— 验收里写死「7 格」或「每格都是农具」
  // 都是照着旧布局猜的，导出之后照着读
  FG.TOOLS = TOOLS;
  // 五门手艺。判据是纯读函数加一个动作，导出来让验收直接核，
  // 别在测试里另抄一份 need 表 —— 抄的那份改了表就静默分叉
  FG.skillLv = skillLv;
  FG.hasSkill = hasSkill;
  FG.skillAdd = skillAdd;
  FG.skillFix = skillFix;
  FG.setAlPage = setAlPage;
  FG.openAlbum = openAlbum;
  FG.dexFix = dexFix;
  FG.dexAdd = dexAdd;
  FG.dexCount = dexCount;
  FG.dexAll = dexAll;
  FG.dexWallList = dexWallList;
  FG.drawWall = drawWall;
  FG.dexView = dexView;
  FG.birthFix = birthFix;
  FG.birthToday = birthToday;
  FG.birthDone = birthDone;
  FG.birthTurn = birthTurn;
  FG.birthSoon = birthSoon;
  FG.birthIn = birthIn;
  FG.birthGive = birthGive;
  FG.renFix = renFix;
  FG.renInit = renInit;
  FG.renTier = renTier;
  FG.renName = renName;
  FG.renAdd = renAdd;
  FG.renGift = renGift;
  FG.renForcedLine = renForcedLine;
  FG.farmOn = farmOn;
  FG.farmView = farmView;
  FG.cropsSowable = cropsSowable;
  FG.cutLeft = cutLeft;
  // 画笔在 FIELD 上（cellQuad 是按脚下远近算的透视四边形）。
  // 导出来是为了验收能自己取那一畦的框，去量「那上面到底画了没有」
  FG.cellQuad = function (c2, r2) { return F.cellQuad(c2, r2); };
  FG.giveWine = giveWine;
  FG.shopOwns = shopOwns;
  FG.ownNote = ownNote;
  FG.openShop = openShop;
  FG.shopItem = shopItem;
  FG.buy = buy;
  FG.npcGone = npcGone;
  FG.mapNpcsOut = mapNpcsOut;
  // 这两个和 FG.harvest / FG.sowWith 是同一类（脚本玩家走的是玩家走的那条路）：
  // mapNpcs 读「这张图上站着谁」，pick 是「采这一下」。
  // 少了它们，玩一遍的脚本就得绕开玩家真正的交互去模拟，
  // 而绕开之后量出来的就不是这个游戏了
  FG.mapNpcs = mapNpcs;
  FG.pick = pick;
  FG.cast = cast;
  FG.reel = reel;
  FG.nearGoneNpc = nearGoneNpc;
  // 存取只路由一次（invGet/invTake/invGive）。导出它们是为了让验收**走这一条路** ——
  // 绕开它直接读 S.bag / S.pouch / S.seeds 的话，
  // 查错本账的现象跟真 bug 一模一样（种子落在 S.seeds[作物id]，
  // 而 S.seeds[BAG的key] 那一格看着永远是 0）
  FG.invGet = invGet;
  FG.invTake = invTake;
  FG.invGive = invGive;
  // 翻年清本年账的那一支。图鉴「跨年留着」这条判据只能从这儿验：
  // 直接调 startDay 会把结算面板一起叫出来，读数分不清是清了还是面板盖住了
  FG.bookInit = bookInit;
  FG.wineAge = wineAge;
  FG.mineReach = mineReach;
  FG.isNight = isNight;
  FG.canFish = canFish;
  FG.fishInSeason = fishInSeason;
  FG.fishHere = fishHere;
  FG.restart = function () {
    S.day = 1; S.gold = 500;
    S.bag = { dou: 0, su: 0, shu: 0, ji: 0, ju: 0 };
    S.seeds = { dou: 8, su: 4, shu: 3, ji: 2, ju: 2 };
    S.gear = { chu: 0, piao: 0, jue: 0 };
    // 重开就得是全新的一册。重开不清诗册的话，玩家会看着上一世的句子
    // 在这一世重新亮起来，等于没重开。
    S.album = {}; S.met = {}; S.got = {}; S.earned = 0;
    // 见闻跟着诗册一起清：它记的是「这一世认出了什么」，不是「这游戏里有什么」
    S.dex = { good: {}, fish: {}, ore: {} };
    // 生辰也一样：这一世没给过的礼，下一世的日历上就该还没到
    S.birth = {};
    // 人情也归零。留着的话重开之后一开局就人人「相知」，
    // 而相知那一句和那样东西一辈子只说一次，等于这一世再也听不到
    renInit();
    S.plots = []; S.pouch = {}; S.picked = {}; S.fishing = null; S.catchCount = 0;
    // 刻石也一起清：读过六方留着，重开就等于没读
    S.steles = {};
    // 酒和人情也是重开就归零的
    S.jiu = 0; S.made = {}; S.bin = {}; S.binQ = 0; S.chest = {}; S.cookN = 0; S.favor = {};
    // 硐里敲开的石头也一样。留着的话重开之后玩家进硐发现四层已经见底，
    // 而手上一个镐都没有 —— 那不是「接着玩」，是「没得玩了」
    S.ore = {}; S.rock = {}; S.mineFloor = 0; S.mineDeep = 0;
    S.jiuYear = [];
    skillInit();
    totalInit();
    festInit();
    buildInit();
    S.pendingSeed = null;
    bookInit();
    gotoMap('nanshan', [900, 800]);
    save();
  };

})(window.FG = window.FG || {});
