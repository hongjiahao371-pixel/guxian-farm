/* =====================================================================
   core.js — 基础层：工具函数 / 画布 / 输入 / 音效 / 粒子
   ===================================================================== */
window.FG = window.FG || {};
(function (FG) {
  'use strict';

  FG.VERSION = '1.0.0';
  FG.SAVE_KEY = 'pixel_farm_save_v1';

  /* ---------------- 数学 ---------------- */
  FG.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  FG.lerp = (a, b, t) => a + (b - a) * t;
  FG.rand = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  FG.randInt = (a, b) => Math.floor(FG.rand(a, b + 1));
  FG.pick = a => a[(Math.random() * a.length) | 0];
  FG.chance = p => Math.random() < p;
  FG.overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  FG.mulberry32 = seed => {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  FG.hash2 = (x, y, s) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  /* ---------------- 地块 ID ---------------- */
  FG.T = {
    VOID: 0, GRASS: 1, FLOWER: 2, DIRT: 3, TILLED: 4, TILLED_WET: 5,
    PATH: 6, STONE: 7, WATER: 8, SAND: 9, FLOOR: 10, WALL: 11,
    BRIDGE: 12, FENCE_H: 13, FENCE_V: 14, GRAVEL: 15
  };
  // 不可通行的地块
  FG.SOLID_TILES = {};
  FG.SOLID_TILES[FG.T.WATER] = 1;
  FG.SOLID_TILES[FG.T.WALL] = 1;
  FG.SOLID_TILES[FG.T.VOID] = 1;
  FG.SOLID_TILES[FG.T.FENCE_H] = 1;
  FG.SOLID_TILES[FG.T.FENCE_V] = 1;
  // 可锄地的地块
  FG.FARM_TILES = {};
  FG.FARM_TILES[FG.T.GRASS] = 1;
  FG.FARM_TILES[FG.T.FLOWER] = 1;
  FG.FARM_TILES[FG.T.DIRT] = 1;

  /* ---------------- 画布 ---------------- */
  FG.mk = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    return { c, x };
  };
  FG.px = (x, px, py, w, h, col) => { x.fillStyle = col; x.fillRect(px | 0, py | 0, w | 0, h | 0); };
  FG.pxAt = (x, px, py, col) => FG.px(x, px, py, 1, 1, col);
  FG.ell = (x, cx, cy, rx, ry, col) => {
    x.fillStyle = col;
    for (let dy = -ry; dy <= ry; dy++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
      if (w > 0) x.fillRect((cx - w) | 0, (cy + dy) | 0, w * 2, 1);
    }
  };
  FG.rectx = (x, px, py, w, h, col) => { // 描边（像素风描边）
    FG.px(x, px, py, w, 1, col); FG.px(x, px, py + h - 1, w, 1, col);
    FG.px(x, px, py, 1, h, col); FG.px(x, px + w - 1, py, 1, h, col);
  };
  // 环绕绘制，保证 16x16 地块无接缝
  FG.wrapDraw = (x, px, py, fn) => {
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++) fn(px + ox * 16, py + oy * 16);
  };

  /* ---------------- 输入 ---------------- */
  const input = {
    down: Object.create(null),
    hit: Object.create(null),
    wheel: 0,
    mouse: { x: 0, y: 0, down: false, hit: false, rdown: false, rhit: false },
    key(k) { return !!this.down[k]; },
    pressed(k) { return !!this.hit[k]; },
    endFrame() { this.hit = Object.create(null); this.wheel = 0; this.mouse.hit = false; this.mouse.rhit = false; }
  };
  FG.input = input;

  FG.initInput = function (canvas) {
    const NORMALIZE = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
      空格: 'use', ' ': 'use', e: 'act', E: 'act', f: 'eat', F: 'eat',
      Escape: 'esc', Tab: 'bag', m: 'mute', M: 'mute', Enter: 'act'
    };
    window.addEventListener('keydown', ev => {
      if (ev.key === 'Tab' || ev.key === ' ') ev.preventDefault();
      const k = /^[0-9]$/.test(ev.key) ? 'd' + ev.key : NORMALIZE[ev.key];
      if (!k) return;
      if (!input.down[k]) input.hit[k] = true;
      input.down[k] = true;
    });
    window.addEventListener('keyup', ev => {
      // 跟 keydown 同一张表：数字键的按态也得清 ——
      // 原先只查 NORMALIZE，'1'-'8' 按下去 input.down['d1'] 永远是 true，
      // 直到窗口失焦才整体清掉
      const k = NORMALIZE[ev.key] || (/^[0-9]$/.test(ev.key) ? 'd' + ev.key : '');
      if (k) input.down[k] = false;
    });
    window.addEventListener('blur', () => { input.down = Object.create(null); });

    const upd = ev => {
      const r = canvas.getBoundingClientRect();
      input.mouse.x = (ev.clientX - r.left) * (canvas.width / r.width);
      input.mouse.y = (ev.clientY - r.top) * (canvas.height / r.height);
    };
    canvas.addEventListener('mousemove', upd);
    canvas.addEventListener('mousedown', ev => {
      upd(ev); input.mouse.down = true;
      if (ev.button === 0) input.mouse.hit = true; else input.mouse.rdown = true;
    });
    window.addEventListener('mouseup', ev => {
      input.mouse.down = false; input.mouse.rdown = false;
    });
    canvas.addEventListener('contextmenu', ev => ev.preventDefault());
    canvas.addEventListener('wheel', ev => { ev.preventDefault(); input.wheel += Math.sign(ev.deltaY); }, { passive: false });
  };

  /* ---------------- 音效（WebAudio 合成，无外部文件） ---------------- */
  const audio = (function () {
    let ctx = null, master = null, muted = false, noiseBuf = null;
    function ensure() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
      return ctx;
    }
    function nb() {
      if (noiseBuf) return noiseBuf;
      const len = ctx.sampleRate * 0.6;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return noiseBuf;
    }
    function tone(f, dur, type, vol, delay, f2) {
      const t = ctx.currentTime + (delay || 0);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
    }
    function noise(dur, vol, freq, q, delay, sweep, type) {
      const t = ctx.currentTime + (delay || 0);
      const s = ctx.createBufferSource(); s.buffer = nb();
      const f = ctx.createBiquadFilter();
      f.type = type || 'bandpass'; f.Q.value = q || 1;
      f.frequency.setValueAtTime(freq, t);
      if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.03);
    }
    const SFX = {
      hoe:   () => { noise(0.16, 0.30, 620, 1.2); tone(150, 0.09, 'triangle', 0.13); },
      water: () => { noise(0.42, 0.16, 2600, 0.8, 0, 500); tone(420, 0.14, 'sine', 0.05, 0.05, 900); },
      chop:  () => { noise(0.13, 0.34, 1100, 1.6); tone(120, 0.12, 'square', 0.14); noise(0.1, 0.2, 400, 1, 0.09); },
      pick:  () => { tone(880, 0.07, 'square', 0.13); tone(1320, 0.06, 'square', 0.1, 0.05); noise(0.12, 0.24, 2400, 2); },
      rock:  () => { noise(0.34, 0.32, 1500, 0.7, 0, 300); tone(90, 0.18, 'square', 0.12); },
      weed:  () => { noise(0.14, 0.22, 1800, 1.4, 0, 700); },
      plant: () => { noise(0.1, 0.18, 900, 1.5); tone(300, 0.1, 'sine', 0.1); },
      harvest:() => { tone(660, 0.07, 'triangle', 0.16); tone(990, 0.09, 'triangle', 0.14, 0.06); },
      coin:  () => { tone(1046, 0.06, 'square', 0.13); tone(1568, 0.12, 'square', 0.12, 0.06); },
      eat:   () => { noise(0.12, 0.18, 700, 1.2); tone(260, 0.1, 'triangle', 0.1, 0.06, 420); },
      step:  () => { noise(0.05, 0.07, 320, 2); },
      warp:  () => { tone(700, 0.18, 'sine', 0.1, 0, 260); noise(0.3, 0.06, 500, 1); },
      sleep: () => { tone(523, 0.14, 'sine', 0.12); tone(659, 0.14, 'sine', 0.12, 0.14); tone(784, 0.3, 'sine', 0.12, 0.28); },
      buy:   () => { tone(784, 0.06, 'square', 0.12); tone(1175, 0.1, 'square', 0.1, 0.05); },
      error: () => { tone(180, 0.13, 'square', 0.13); tone(140, 0.14, 'square', 0.11, 0.09); },
      levelup:() => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, 'triangle', 0.13, i * 0.09)); }
    };
    /* ---------------- 背景音乐 ----------------
       曲子是写死的音符序列，不是随机生成 —— 随机出来没法循环，跑调也听不出来。
       三首：农场（明亮乡村）、小镇（热闹）、夜晚（安静稀疏）。
       每首 = 8 分音符网格上的主旋律 + 贝斯 + 每两拍一个的柔和铺底。
       方波主旋律出像素味，三角波贝斯兜住，低通铺底当空气感。 */
    const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    function hz(name) {
      const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
      if (!m) return 440;
      const n = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12 - 9;
      return 440 * Math.pow(2, n / 12);          // A4 = 440
    }
    const _ = null;
    const TRACKS = {
      farm: {
        bpm: 104, vol: 0.20,
        lead: ['E5', _, 'G5', _, 'A5', _, 'G5', _, 'D5', _, _, 'E5', _, 'G5', _, _,
               'F5', _, 'A5', _, 'G5', _, 'E5', _, 'D5', _, 'E5', _, 'G5', 'E5', 'D5', _],
        bass: ['C3', _, _, 'C3', _, 'G2', _, _, 'A2', _, _, 'A2', _, 'E2', _, _,
               'F2', _, _, 'F2', _, 'C3', _, _, 'G2', _, _, 'B2', _, 'D3', _, _],
        pad:  ['C4', _, _, _, _, _, _, _, 'A3', _, _, _, _, _, _, _,
               'F3', _, _, _, _, _, _, _, 'G3', _, _, _, _, _, _, _]
      },
      town: {
        bpm: 122, vol: 0.17,
        lead: ['A4', _, 'C5', 'D5', _, 'E5', _, 'D5', 'C5', _, _, 'A4', _, 'G4', _, _,
               'F4', _, 'A4', 'C5', _, 'F5', _, 'E5', 'D5', _, 'C5', _, 'A4', _, _],
        bass: ['F2', _, 'F2', _, 'C3', _, 'C3', _, 'D3', _, 'D3', _, 'A2', _, 'A2', _,
               'B2', _, 'B2', _, 'F3', _, 'F3', _, 'G3', _, 'G3', _, 'C3', _, 'C3', _],
        pad:  ['F3', _, _, _, _, _, _, _, 'D3', _, _, _, _, _, _, _,
               'B3', _, _, _, _, _, _, _, 'C4', _, _, _, _, _, _, _]
      },
      night: {
        bpm: 74, vol: 0.15,
        lead: [_, _, _, _, _, _, 'E5', _, _, _, _, _, _, _, 'C5', _,
               _, _, _, _, _, _, 'D5', _, _, _, _, _, _, _, 'A4', _,
               _, _, _, _, _, _, 'G4', _, _, _, _, _, _, _, 'B4', _,
               _, _, _, _, _, _, 'C5', _, _, _, _, _, 'E5', _, _, _, _, _, _],
        bass: ['A2', _, _, _, _, _, _, _, 'F2', _, _, _, _, _, _, _,
               'C3', _, _, _, _, _, _, _, 'G2', _, _, _, _, _, _, _],
        pad:  ['A3', _, _, _, _, _, _, _, 'F3', _, _, _, _, _, _, _,
               'C4', _, _, _, _, _, _, _, 'G3', _, _, _, _, _, _, _]
      }
    };
    let mGain = null, mTimer = 0, mStep = 0, mNext = 0, mName = '', mTrack = null;
    const MUSIC_VOL = 0.22;

    function mvoice(name, t, dur, type, vol, cutoff) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.value = hz(name);
      let tail = g;
      if (cutoff) {                       // 低通铺底：削掉方波的毛刺，听着才像钢琴不像电视雪花
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.7;
        g.connect(f); tail = f;
      }
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.94);
      o.connect(g); tail.connect(mGain);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function mschedule() {
      if (!ctx || muted || !mTrack || !mGain) return;
      const spb = 60 / mTrack.bpm / 2;            // 一个 8 分音符
      const L = mTrack.lead.length;
      while (mNext < ctx.currentTime + 0.4) {     // 预排 0.4s，setInterval 抖动也不会断音
        const i = mStep % L, t = mNext;
        if (mTrack.lead[i]) mvoice(mTrack.lead[i], t, spb * 1.7, 'square', mTrack.vol * 0.34, 3200);
        if (mTrack.bass[i]) mvoice(mTrack.bass[i], t, spb * 2.6, 'triangle', mTrack.vol * 0.40, 1400);
        if (i % 4 === 0 && mTrack.pad[i]) {
          mvoice(mTrack.pad[i], t, spb * 3.6, 'sine', mTrack.vol * 0.20, 1100);
          mvoice(mTrack.pad[i], t + spb * 2, spb * 2.4, 'sine', mTrack.vol * 0.14, 1100);
        }
        mNext += spb;
        mStep++;
      }
    }
    function mstart(name) {
      if (!mGain) { mGain = ctx.createGain(); mGain.gain.value = 0.0001; mGain.connect(ctx.destination); }
      mTrack = TRACKS[name];
      if (!mTrack) return;
      mStep = 0;
      mNext = ctx.currentTime + 0.08;
      const t = ctx.currentTime;
      mGain.gain.cancelScheduledValues(t);
      mGain.gain.setValueAtTime(mGain.gain.value, t);
      mGain.gain.linearRampToValueAtTime(MUSIC_VOL, t + 0.7);
      if (!mTimer) mTimer = setInterval(mschedule, 120);   // 预排 0.4s，120ms 一次绰绰有余
    }
    function mhalt() {
      if (mTimer) { clearInterval(mTimer); mTimer = 0; }
      if (mGain) mGain.gain.value = 0.0001;
    }
    /* 换曲淡入淡出。切得硬的话两首曲子会"啪"地叠在一起。 */
    function mset(name) {
      if (name === mName) return;
      mName = name;
      const c = ensure();
      if (!c) return;
      if (mGain) {
        const t = c.currentTime;
        mGain.gain.cancelScheduledValues(t);
        mGain.gain.setValueAtTime(mGain.gain.value, t);
        mGain.gain.linearRampToValueAtTime(0.0001, t + 0.3);
      }
      setTimeout(function () { if (mName === name && !muted) mstart(name); }, 340);
    }
    const music = {
      /* 选曲：按地图 + 时刻。墟市 / 溪畔与田 / 夜晚。
         **图 id 必须用这个游戏自己的。** 原来这里比的是
         'town' || 'shop' || 'home' —— 而图叫 xushi / xipan / nanshan / shidong，
         一个都对不上，于是就算有人调 pick，也永远落到 farm 那一支。
         （还有一层：pick 从来就没有调用点，三首曲子写完就没响过。）
         意图照旧，只是把 id 换成真的：市集那一张用 town 曲，其余用 farm 曲。
         想改的话改这里一行就够 —— **只有这一处**。 */
      pick(mapId, minutes) {
        const h = minutes / 60;
        if (h >= 20.5 || h < 5.5) return mset('night');
        if (mapId === 'xushi') return mset('town');
        return mset('farm');
      },
      stop() { mName = ''; mTrack = null; mhalt(); },
      get name() { return mName; }
    };

    return {
      play(name) { if (muted || !ensure()) return; const f = SFX[name]; if (f) f(); },
      /* 浏览器的自动播放策略：没有用户手势之前，AudioContext 建出来就是
         suspended，而且**不会自己醒**。
         而背景音乐是自动播的 —— step 跑一秒就调 pick 了，那会儿玩家
         还没点开卷。于是 mName 已经被设成 'farm'，等玩家真的点了，
         mset 同曲早退，音乐就永远起不来。
         所以第一次用户手势要显式把它拉起来；顺手把没在走的调度器重新起一次。 */
      unlock() {
        const c = ensure();
        if (!c) return false;
        if (mName && c.state === 'running' && !mTimer && !muted) mstart(mName);
        return true;
      },
      toggle() {
        muted = !muted;
        if (muted) mhalt();
        else if (mName) { if (ensure()) mstart(mName); }
        return muted;
      },
      music,
      get muted() { return muted; }
    };
  })();
  FG.audio = audio;

  /* ---------------- 粒子 & 浮动文字 ---------------- */
  const parts = [];
  const texts = [];
  FG.fx = {
    clear() { parts.length = 0; texts.length = 0; },
    spawn(type, x, y, opt) {
      opt = opt || {};
      parts.push({
        type, x, y,
        vx: opt.vx !== undefined ? opt.vx : FG.rand(-24, 24),
        vy: opt.vy !== undefined ? opt.vy : FG.rand(-40, -12),
        g: opt.g !== undefined ? opt.g : 190,
        life: opt.life || 0.5, t: 0,
        col: opt.col || '#fff',
        size: opt.size || 2,
        txt: opt.txt
      });
    },
    burst(type, x, y, n, opt) {
      for (let i = 0; i < n; i++) {
        const a = FG.rand(0, Math.PI * 2), s = FG.rand(12, 62);
        FG.fx.spawn(type, x, y, Object.assign({}, opt, { vx: Math.cos(a) * s, vy: Math.sin(a) * s - 18 }));
      }
    },
    text(x, y, txt, col) { texts.push({ x, y, txt, col: col || '#fff', t: 0, life: 1.1 }); },
    update(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        if (p.t >= p.life) { parts.splice(i, 1); continue; }
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      }
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.t += dt; t.y -= 22 * dt;
        if (t.t >= t.life) texts.splice(i, 1);
      }
    },
    draw(ctx, cam) {
      for (const p of parts) {
        const k = 1 - p.t / p.life;
        ctx.globalAlpha = k > 0.6 ? 1 : k / 0.6;
        const X = Math.round(p.x - cam.x), Y = Math.round(p.y - cam.y);
        if (p.type === 'drop') { ctx.fillStyle = p.col; ctx.fillRect(X, Y, 1, 3); }
        else if (p.type === 'spark') { ctx.fillStyle = p.col; ctx.fillRect(X, Y, p.size, p.size); }
        else ctx.fillRect(X, Y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      for (const t of texts) {
        const k = 1 - t.t / t.life;
        ctx.globalAlpha = k > 0.5 ? 1 : k * 2;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#20140a';
        ctx.fillText(t.txt, Math.round(t.x - cam.x) + 1, Math.round(t.y - cam.y) + 1);
        ctx.fillStyle = t.col;
        ctx.fillText(t.txt, Math.round(t.x - cam.x), Math.round(t.y - cam.y));
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }
  };

  /* ==================================================================
     Flex gap 布局行为检测
     小工具最低基线是 Chrome 61（WebView 61），Flex gap 要到 Chrome 84。
     CSS.supports('gap','1px') / @supports (gap:1px) 只能证明认识这个属性，
     证明不了它在 Flex 布局里真的生效 —— 必须建一个真 Flex 容器量一次。
     样式里的基线是子项 margin，检测通过才由 .supports-flex-gap 换成 gap。
     检测一次即可，不进 resize / 渲染循环。
     ================================================================== */
  function detectFlexGap() {
    // 能力检测绝不能把页面搞崩：无头环境 / 精简 DOM 一律按"不支持"处理
    try {
      var d = document.documentElement;
      if (!d || !d.classList || !document.body || !document.body.appendChild) return;
      var probe = document.createElement('div');
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      probe.style.display = 'flex';
      probe.style.flexDirection = 'column';
      probe.style.rowGap = '1px';
      probe.appendChild(document.createElement('div'));
      probe.appendChild(document.createElement('div'));
      document.body.appendChild(probe);
      var ok = probe.scrollHeight === 1;
      if (probe.parentNode) probe.parentNode.removeChild(probe);
      d.classList.add(ok ? 'supports-flex-gap' : 'no-flex-gap');
    } catch (e) { /* 保持 margin 基线即可 */ }
  }

  if (document.body) detectFlexGap();
  else document.addEventListener('DOMContentLoaded', detectFlexGap);
})(window.FG);
