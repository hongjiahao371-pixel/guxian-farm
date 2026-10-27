/* ============================================================
   水墨笔触绘制
   ------------------------------------------------------------
   笔触不是描边，是有提按的：起笔重、行笔细、收笔出锋。
   所以用「沿路径按宽度插值生成多边形」来画，不是 ctx.stroke()。

   性能：每帧重画几十条笔触会掉帧，所以所有静态物件（人物/谷物/地块）
   一次性渲染进离屏 canvas 缓存，之后只是 blit。
   ============================================================ */
(function (FG) {
  'use strict';

  var I = FG.INK = {};

  /* ---- 墨色 ---- */
  I.INK = 'rgba(38,34,30,';
  I.INK_SOFT = 'rgba(92,84,74,';
  I.ZHE = 'rgba(138,90,59,';      // 赭石
  I.HUA = 'rgba(61,90,108,';      // 花青
  I.TENG = 'rgba(200,145,46,';    // 藤黄
  I.QING = 'rgba(104,138,96,';    // 青绿
  I.CLU = 'rgba(126,108,84,';     // 麻布：短褐本色（未染的粗麻，不是黑）
  I.CLU_D = 'rgba(88,74,58,';     // 麻布暗部
  I.DOU = 'rgba(176,148,96,';     // 斗笠的篾色

  /* 一笔：pts 是 [x,y] 数组，w0 起笔宽，w1 收笔宽 */
  I.brush = function (ctx, pts, w0, w1, color, alpha) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.fillStyle = color + (alpha === undefined ? 1 : alpha) + ')';
    ctx.beginPath();
    var n = pts.length, i, t, dx, dy, len, nx, ny, w;
    // 正侧两条边
    for (i = 0; i < n; i++) {
      t = i / (n - 1);
      w = w0 + (w1 - w0) * t;
      if (i === 0) { dx = pts[1][0] - pts[0][0]; dy = pts[1][1] - pts[0][1]; }
      else if (i === n - 1) { dx = pts[i][0] - pts[i - 1][0]; dy = pts[i][1] - pts[i - 1][1]; }
      else { dx = pts[i + 1][0] - pts[i - 1][0]; dy = pts[i + 1][1] - pts[i - 1][1]; }
      len = Math.sqrt(dx * dx + dy * dy) || 1;
      nx = -dy / len; ny = dx / len;
      var x = pts[i][0] + nx * w, y = pts[i][1] + ny * w;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (i = n - 1; i >= 0; i--) {
      t = i / (n - 1);
      w = w0 + (w1 - w0) * t;
      if (i === 0) { dx = pts[1][0] - pts[0][0]; dy = pts[1][1] - pts[0][1]; }
      else if (i === n - 1) { dx = pts[i][0] - pts[i - 1][0]; dy = pts[i][1] - pts[i - 1][1]; }
      else { dx = pts[i + 1][0] - pts[i - 1][0]; dy = pts[i + 1][1] - pts[i - 1][1]; }
      len = Math.sqrt(dx * dx + dy * dy) || 1;
      nx = -dy / len; ny = dx / len;
      ctx.lineTo(pts[i][0] - nx * w, pts[i][1] - ny * w);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  /* 墨点：浓淡不匀的一团，模拟点苔 */
  I.dot = function (ctx, x, y, r, color, alpha) {
    ctx.save();
    ctx.fillStyle = color + (alpha === undefined ? 1 : alpha) + ')';
    ctx.beginPath();
    for (var a = 0; a < Math.PI * 2; a += 0.35) {
      var rr = r * (0.82 + 0.28 * Math.sin(a * 3.1 + x * 0.7));
      var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  /* 茅舍廊下的木箱。敞口的那种木箱 —— 上头两块板歪着，
     里面搁东西的时候能从那道缝里看见一角。
     规矩跟代码画的建筑一样：**实色分层，不靠半透明淡彩**。
     压在南山那张浅沙色的底图上，淡彩会没掉，1× 下来就剩一摊脏。
     非空时（chest 有件数）从缝里露一个角出来 ——
     站着不动的时候就能看出这箱子装没装东西，不用每次都开一遍。 */
  /* 廊下躺椅：两根长竹条斜搭成靠背，四条短腿，中段两道横档。
     竹的青压在墨线上，读得出是竹器不是柴火 */
  I.recliner = function (ctx, x, y, s) {
    ctx.save();
    I.wash(ctx, x, y + s * 0.04, s * 0.62, s * 0.08, 'rgba(58,48,38,', 0.22);
    // 座面：一根从后往前伸的长竹条（透视上是一条斜带）
    I.brush(ctx, [[x - s * 0.26, y - s * 0.10], [x + s * 0.28, y - s * 0.02]], s * 0.075, s * 0.030, I.QING, 0.78);
    // 靠背：斜上去的一根，搭在廊柱方向
    I.brush(ctx, [[x - s * 0.26, y - s * 0.10], [x - s * 0.40, y - s * 0.44]], s * 0.062, s * 0.026, I.QING, 0.70);
    // 腿：前后各一短竖
    I.brush(ctx, [[x + s * 0.24, y - s * 0.02], [x + s * 0.27, y + s * 0.12]], s * 0.030, s * 0.014, I.INK, 0.62);
    I.brush(ctx, [[x - s * 0.20, y - s * 0.06], [x - s * 0.22, y + s * 0.10]], s * 0.030, s * 0.014, I.INK, 0.62);
    // 横档两道
    I.brush(ctx, [[x - s * 0.14, y - s * 0.02], [x + s * 0.16, y + s * 0.02]], s * 0.020, s * 0.010, I.INK, 0.5);
    I.brush(ctx, [[x - s * 0.12, y + s * 0.05], [x + s * 0.14, y + s * 0.08]], s * 0.020, s * 0.010, I.INK, 0.45);
    // 枕头处一团软的
    I.dot(ctx, x - s * 0.30, y - s * 0.16, s * 0.075, I.CLU, 0.7);
    ctx.restore();
  };

  /* 院里石桌：一张圆桌面 + 一只石鼓凳。桌面用淡青的圆，
     沿口一道墨线圈出厚度，桌腿一笔短柱 */
  I.stoneTable = function (ctx, x, y, s) {
    ctx.save();
    I.wash(ctx, x, y + s * 0.10, s * 0.58, s * 0.08, 'rgba(58,48,38,', 0.22);
    // 桌腿
    I.brush(ctx, [[x, y - s * 0.10], [x, y + s * 0.08]], s * 0.085, s * 0.045, I.INK_SOFT, 0.8);
    // 桌面（椭圆，压着腿顶）
    ctx.beginPath();
    ctx.ellipse(x, y - s * 0.16, s * 0.34, s * 0.13, 0, 0, Math.PI * 2);
    ctx.fillStyle = I.QING + '0.66)';
    ctx.fill();
    ctx.strokeStyle = I.INK + '0.5)';
    ctx.lineWidth = s * 0.022;
    ctx.stroke();
    // 桌上茶壶一笔（看不出来是什么也行，是「桌上搁着东西」就够）
    I.dot(ctx, x + s * 0.06, y - s * 0.19, s * 0.045, I.INK, 0.75);
    // 石鼓凳：矮胖一截，比桌面低一档、错开半步
    var bx = x - s * 0.44, by = y + s * 0.04;
    I.brush(ctx, [[bx, by - s * 0.10], [bx, by + s * 0.05]], s * 0.11, s * 0.055, I.INK_SOFT, 0.72);
    ctx.beginPath();
    ctx.ellipse(bx, by - s * 0.11, s * 0.085, s * 0.038, 0, 0, Math.PI * 2);
    ctx.fillStyle = I.INK_SOFT + '0.6)';
    ctx.fill();
    ctx.restore();
  };

  I.chest = function (ctx, x, y, s, chest) {
    // 宽高比要紧。第一版 w=s*0.86 / h=s*0.46 —— 又宽又扁，
    // 1× 下来读成院里一条长板凳而不是箱子。箱子要接近一个立方：
    // 宽度收到 0.66，高度提到 0.50，中间那道「箱口」再压出一点厚度
    var w = s * 0.66, h = s * 0.50, d = s * 0.26;
    var top = y - h;                       // 箱口那条线
    var n = 0, k;
    if (chest) for (k in chest) if (chest[k] > 0) n++;
    ctx.save();
    // 影子
    I.wash(ctx, x, y + s * 0.03, w * 0.72, s * 0.09, 'rgba(58,48,38,', 0.24);
    // 箱口：一块深色椭圆，看得出是敞着的口
    ctx.fillStyle = 'rgba(38,32,26,0.96)';
    ctx.beginPath();
    ctx.ellipse(x, top, w * 0.50, s * 0.085, 0, 0, Math.PI * 2);
    ctx.fill();
    // 里面搁着东西的那一角
    if (n > 0) {
      ctx.fillStyle = 'rgba(202,170,114,0.96)';
      ctx.beginPath();
      ctx.ellipse(x, top - s * 0.012, w * 0.40, s * 0.058, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 箱身：正面比箱口暗一档，靠明度差读出「是个立着的箱子」
    ctx.fillStyle = 'rgba(140,108,72,0.96)';
    ctx.beginPath();
    ctx.moveTo(x - w / 2, top);
    ctx.lineTo(x + w / 2, top);
    ctx.lineTo(x + w / 2, y);
    ctx.lineTo(x - w / 2, y);
    ctx.closePath();
    ctx.fill();
    // 上缘一线亮的：箱子口沿
    ctx.fillStyle = 'rgba(186,154,110,0.96)';
    ctx.fillRect(x - w / 2, top, w, s * 0.055);
    // 盖：两块往里翻的木板，压在箱口两侧
    ctx.fillStyle = 'rgba(104,80,54,0.96)';
    ctx.beginPath();
    ctx.moveTo(x - w / 2, top);
    ctx.lineTo(x - w / 2 - d * 0.20, top - d * 0.62);
    ctx.lineTo(x - w * 0.04, top - d * 0.52);
    ctx.lineTo(x - w * 0.04, top);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + w / 2, top);
    ctx.lineTo(x + w / 2 + d * 0.20, top - d * 0.62);
    ctx.lineTo(x + w * 0.04, top - d * 0.52);
    ctx.lineTo(x + w * 0.04, top);
    ctx.closePath();
    ctx.fill();
    // 铁箍：两道暗横线 + 中间一个搭扣
    ctx.strokeStyle = 'rgba(44,38,30,0.60)';
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, top + s * 0.12); ctx.lineTo(x + w / 2, top + s * 0.12);
    ctx.moveTo(x - w / 2, y - s * 0.06); ctx.lineTo(x + w / 2, y - s * 0.06);
    ctx.stroke();
    ctx.fillStyle = 'rgba(44,38,30,0.78)';
    ctx.fillRect(x - s * 0.040, top + s * 0.05, s * 0.080, s * 0.085);
    // 两只竖楞：读出「这是用板拼的」
    ctx.strokeStyle = 'rgba(88,68,46,0.50)';
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.beginPath();
    ctx.moveTo(x - w * 0.22, top + s * 0.055); ctx.lineTo(x - w * 0.22, y);
    ctx.moveTo(x + w * 0.22, top + s * 0.055); ctx.lineTo(x + w * 0.22, y);
    ctx.stroke();
    ctx.restore();
  };

  /* 淡墨晕：先铺一团低透明度再模糊，模拟宣纸上洇开。
     rot 可选：地是斜的（一格 75px 高里横移 57px），
     不给旋转角的话画出来的是个正椭圆，切到梯形里边界一半斜一半平。 */
  I.wash = function (ctx, x, y, rx, ry, color, alpha, rot) {
    ctx.save();
    ctx.filter = 'blur(' + Math.max(1, rx * 0.22) + 'px)';
    ctx.fillStyle = color + alpha + ')';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /* ---------------- 人物 ----------------
     戴斗笠的老农，扛锄。unit = 人物身高（像素）。
     比例按画上的参照物定的：茅屋顶到地约 410px，农人站在同一进深应有 100~130px，
     站到画面近处（田的下沿）要更大 —— 这个远近差交给 FIELD.scaleAtY 乘。

     踩过的坑：第一版画成了纯黑剪影 —— 头是方的、斗笠是个扁片、衣身一块死黑，
     跟淡雅的水墨底图割裂得厉害。「归园田居」里的农人穿的是未染的粗麻短褐，
     不是黑衣人，所以这里以麻布色打底、浓墨只勾边和暗部，再加一片接地影。 */
  I.farmer = function (ctx, cx, baseY, u, tint, hatSeed) {
    var hatUp = (hatSeed || 0) % 2 ? 1 : 0;   // 1 = 村民（斗笠略尖），0 = 主角

    // 落地阴影：没有它，人是浮在画上的
    ctx.save();
    ctx.fillStyle = 'rgba(58,50,40,0.17)';
    ctx.beginPath();
    ctx.ellipse(cx + u * 0.03, baseY + u * 0.008, u * 0.21, u * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    var Y = function (f) { return baseY - u * f; };
    var hip = Y(0.44), sh = Y(0.72), chin = Y(0.855);
    var brim = Y(0.90), apex = Y(hatUp ? 1.10 : 1.04);
    var shW = 0.155, hipW = 0.135;

    // —— 小腿：短褐到膝下，下面是裹着的布腿 ——
    var legC = I.CLU_D;
    I.brush(ctx, [[cx - u * 0.062, Y(0.27)], [cx - u * 0.075, Y(0.14)], [cx - u * 0.082, Y(0.01)]],
            u * 0.062, u * 0.044, legC, 0.92);
    I.brush(ctx, [[cx + u * 0.062, Y(0.27)], [cx + u * 0.078, Y(0.14)], [cx + u * 0.088, Y(0.01)]],
            u * 0.062, u * 0.044, legC, 0.92);
    // 脚：一抹草鞋
    I.brush(ctx, [[cx - u * 0.115, Y(0.012)], [cx - u * 0.035, Y(0.018)]], u * 0.030, u * 0.022, I.INK_SOFT, 0.85);
    I.brush(ctx, [[cx + u * 0.048, Y(0.018)], [cx + u * 0.128, Y(0.012)]], u * 0.030, u * 0.022, I.INK_SOFT, 0.85);

    // —— 短褐：上窄下宽的斜襟短衣 ——
    ctx.save();
    ctx.fillStyle = I.CLU + '0.95)';
    ctx.beginPath();
    ctx.moveTo(cx - u * shW, sh);
    ctx.lineTo(cx - u * shW * 0.55, sh - u * 0.012);
    ctx.lineTo(cx + u * shW * 0.55, sh - u * 0.012);
    ctx.lineTo(cx + u * shW, sh);
    ctx.quadraticCurveTo(cx + u * hipW * 1.18, hip - u * 0.06, cx + u * hipW * 1.24, Y(0.255));
    ctx.lineTo(cx - u * hipW * 1.24, Y(0.255));
    ctx.quadraticCurveTo(cx - u * hipW * 1.18, hip - u * 0.06, cx - u * shW, sh);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 暗部：背光那半边压一层，别让整件衣服是平的
    ctx.save();
    ctx.fillStyle = I.CLU_D + '0.42)';
    ctx.beginPath();
    ctx.moveTo(cx - u * shW, sh);
    ctx.quadraticCurveTo(cx - u * hipW * 1.18, hip - u * 0.06, cx - u * hipW * 1.24, Y(0.255));
    ctx.lineTo(cx - u * hipW * 0.60, Y(0.255));
    ctx.quadraticCurveTo(cx - u * hipW * 0.55, hip - u * 0.06, cx - u * shW * 0.50, sh);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 衣襟：斜襟从右肩拉到左腰
    I.brush(ctx, [[cx + u * 0.085, sh - u * 0.005], [cx - u * 0.020, Y(0.60)], [cx - u * 0.075, Y(0.47)]],
            u * 0.020, u * 0.012, I.CLU_D, 0.80);
    // 腰带
    I.brush(ctx, [[cx - u * hipW * 1.05, Y(0.495)], [cx, Y(0.475)], [cx + u * hipW * 1.05, Y(0.495)]],
            u * 0.030, u * 0.030, I.CLU_D, 0.80);
    // 皴：衣身上几道折痕
    I.brush(ctx, [[cx - u * 0.105, Y(0.62)], [cx - u * 0.075, Y(0.52)]], u * 0.011, u * 0.006, I.CLU_D, 0.50);
    I.brush(ctx, [[cx + u * 0.100, Y(0.60)], [cx + u * 0.120, Y(0.44)]], u * 0.010, u * 0.006, I.CLU_D, 0.42);

    // —— 手臂：右臂扶锄，左臂垂下 ——
    I.brush(ctx, [[cx + u * 0.135, sh + u * 0.015], [cx + u * 0.205, sh + u * 0.10], [cx + u * 0.255, sh + u * 0.045]],
            u * 0.050, u * 0.034, I.CLU, 0.95);
    I.brush(ctx, [[cx - u * 0.135, sh + u * 0.015], [cx - u * 0.190, sh + u * 0.13], [cx - u * 0.205, sh + u * 0.205]],
            u * 0.050, u * 0.030, I.CLU, 0.95);
    // 手
    I.dot(ctx, cx + u * 0.258, sh + u * 0.042, u * 0.026, I.ZHE, 0.90);
    I.dot(ctx, cx - u * 0.208, sh + u * 0.215, u * 0.024, I.ZHE, 0.90);

    // —— 锄：柄斜扛在右肩，刃朝外 ——
    var hx0 = cx + u * 0.215, hy0 = sh + u * 0.015;
    var hx1 = cx + u * 0.545, hy1 = sh - u * 0.115;
    I.brush(ctx, [[hx0, hy0], [hx1, hy1]], u * 0.028, u * 0.020, I.CLU_D, 0.95);
    // 锄刃：一枚带脊的薄片
    ctx.save();
    ctx.fillStyle = I.INK_SOFT + '0.95)';
    ctx.beginPath();
    ctx.moveTo(hx1 - u * 0.030, hy1 + u * 0.012);
    ctx.lineTo(hx1 + u * 0.062, hy1 - u * 0.030);
    ctx.lineTo(hx1 + u * 0.085, hy1 + u * 0.050);
    ctx.lineTo(hx1 + u * 0.012, hy1 + u * 0.040);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    I.brush(ctx, [[hx1 + u * 0.012, hy1 + u * 0.040], [hx1 + u * 0.085, hy1 + u * 0.050]],
            u * 0.016, u * 0.010, I.INK, 0.85);

    // —— 头：斗笠压得很低，只露出下巴和一点脖颈 ——
    I.brush(ctx, [[cx, sh - u * 0.005], [cx, chin + u * 0.012]], u * 0.036, u * 0.034, I.ZHE, 0.88);
    I.dot(ctx, cx, chin - u * 0.006, u * 0.050, I.ZHE, 0.94);
    // 笠影下一道浓墨，别画五官，远处看不清反而更耐看
    I.brush(ctx, [[cx - u * 0.036, chin - u * 0.012], [cx + u * 0.036, chin - u * 0.012]],
            u * 0.016, u * 0.016, I.INK_SOFT, 0.52);

    // —— 斗笠：真正的锥形，带弧形笠檐和篾纹 ——
    var brimW = u * (hatUp ? 0.245 : 0.275);
    ctx.save();
    ctx.fillStyle = I.DOU + '0.95)';
    ctx.beginPath();
    ctx.moveTo(cx, apex);
    ctx.quadraticCurveTo(cx + brimW * 0.62, brim - u * 0.030, cx + brimW, brim + u * 0.026);
    ctx.quadraticCurveTo(cx, brim + u * 0.062, cx - brimW, brim + u * 0.026);
    ctx.quadraticCurveTo(cx - brimW * 0.62, brim - u * 0.030, cx, apex);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 笠的暗面
    ctx.save();
    ctx.fillStyle = I.CLU_D + '0.34)';
    ctx.beginPath();
    ctx.moveTo(cx, apex);
    ctx.quadraticCurveTo(cx + brimW * 0.62, brim - u * 0.030, cx + brimW, brim + u * 0.026);
    ctx.quadraticCurveTo(cx + brimW * 0.34, brim + u * 0.040, cx, brim + u * 0.046);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 篾纹：从笠尖放射到檐
    for (var k = -3; k <= 3; k++) {
      var ex = cx + brimW * (k / 3.4);
      I.brush(ctx, [[cx, apex + u * 0.006], [(cx + ex) / 2, brim - u * 0.028], [ex, brim + u * 0.028]],
              u * 0.0085, u * 0.0055, I.CLU_D, k === 0 ? 0.55 : 0.38);
    }
    // 笠檐一道浓墨压边
    I.brush(ctx, [[cx - brimW, brim + u * 0.026], [cx, brim + u * 0.062], [cx + brimW, brim + u * 0.026]],
            u * 0.013, u * 0.013, I.INK, 0.72);
    // 笠顶小结
    I.dot(ctx, cx, apex, u * 0.017, I.CLU_D, 0.85);
  };

  /* ---------------- 人物贴图 ----------------
     出图时给的是「纯品红平涂底 + 单人」，靠色相抠成透明 PNG（dev/key-figure.py）。
     贴图只到 344px 高，游戏里最近处才画 165px —— 出两张 retina 的余量就够，
     再高纯属浪费包体（第一版没缩，一张就 885KB，七个人 6MB）。

     u 的含义和 I.farmer 一致：人物从脚到斗笠顶约 1.06*u，锚点在脚底。
     I.farmer 保留下来只当贴图还没 onload、或某张图加载失败时的兜底 ——
     画布是同步渲染的，贴图晚一帧到位就会看到"没人"，不能让它空着。 */
  I.FIG_SRC = {
    farmer: 'assets/figs/farmer.png',
    linweng: 'assets/figs/linweng.png',
    caijuweng: 'assets/figs/caijuweng.png',
    xushi: 'assets/figs/xushi.png',
    qiaofu: 'assets/figs/qiaofu.png',
    caiyaoren: 'assets/figs/caiyaoren.png',
    tongzi: 'assets/figs/tongzi.png',
    yufu: 'assets/figs/yufu.png'
  };
  I.figs = {};
  I.figsReady = false;

  I.loadFigs = function (onOne) {
    var ids = [], k;
    for (k in I.FIG_SRC) { if (I.FIG_SRC.hasOwnProperty(k)) ids.push(k); }
    var left = ids.length;
    if (!left) { I.figsReady = true; return; }
    for (var i = 0; i < ids.length; i++) {
      (function (id) {
        var im = new Image();
        im.onload = function () { I.figs[id] = im; if (--left <= 0) I.figsReady = true; if (onOne) onOne(); };
        im.onerror = function () { if (--left <= 0) I.figsReady = true; if (onOne) onOne(); };
        im.src = I.FIG_SRC[id];
      })(ids[i]);
    }
  };

  I.figH = 1.06;   // 贴图高 / u，与 I.farmer 里斗笠顶 Y(1.04~1.10) 对齐

  I.drawFig = function (ctx, id, cx, baseY, u, alpha, lean) {
    var im = I.figs[id];
    if (!im || !im.width) { I.farmer(ctx, cx, baseY, u, I.INK, 0); return; }
    var h = u * I.figH;
    var w = h * (im.width / im.height);

    // 接地影：贴图本身不带，得单独铺一片，没有它人是浮在画上的
    ctx.save();
    ctx.fillStyle = 'rgba(58,50,40,0.17)';
    ctx.beginPath();
    ctx.ellipse(cx + u * 0.03, baseY + u * 0.008, u * 0.21, u * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (alpha !== undefined && alpha < 1) ctx.globalAlpha = alpha;
    // lean：绕脚底的小幅前倾（劳动姿态用，走路不用）—— 不转影子
    if (lean) { ctx.translate(cx, baseY); ctx.rotate(lean); ctx.translate(-cx, -baseY); }
    ctx.drawImage(im, cx - w / 2, baseY - h, w, h);
    ctx.restore();
  };

  /* ---------------- 劳动躬身姿态 ----------------
     贴图是**正面对镜头**的站姿（扛锄）。侧向折腰在正视图里读成「往旁边歪」，
     正确的劳动表达是**向镜头躬身**：上身压扁、下沉、肩展 ——
     头和肩上的锄跟着往下磕，配合地面的挥锄弧/水弧就是完整的劳动动作。
     p 是劳动进度 0..1，0.9s 里躬身两次（峰在 1/4 与 3/4），
     strike 曲线 |sin|^0.7 让下压带落锤感。s 是场景比例（同 I.drawFig 的 u）。 */
  I.drawFigWork = function (ctx, id, cx, baseY, u, p) {
    var im = I.figs[id];
    if (!im || !im.width) { I.farmer(ctx, cx, baseY, u, I.INK, 0); return; }
    var h = u * I.figH;
    var w = h * (im.width / im.height);
    var strike = Math.pow(Math.abs(Math.sin(p * Math.PI * 2)), 0.7);
    var cf = 0.45;                       // 髋线：上 45%（躯干头臂锄）躬，下 55%（腿）留
    var squashY = 1 - 0.26 * strike;     // 上身纵向压扁（向镜头躬下去）
    var squashX = 1 + 0.12 * strike;     // 肩宽展开（躬身的前近感）
    var hipY = baseY - h * (1 - cf) + h * cf * 0.26 * strike;   // 髋线随躬身微微下沉

    // 接地影（躬身时影子跟着略放大——人俯下来占地更大）
    ctx.save();
    ctx.fillStyle = 'rgba(58,50,40,0.17)';
    ctx.beginPath();
    ctx.ellipse(cx + u * 0.03, baseY + u * 0.008, u * (0.21 + 0.05 * strike), u * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 腿：原位
    ctx.drawImage(im, 0, Math.round(im.height * (1 - cf)), im.width, Math.round(im.height * (1 - cf)),
                  cx - w / 2, baseY - h * (1 - cf), w, h * (1 - cf));

    // 上身：压扁 + 下沉 + 展肩，绕髋线变换
    ctx.save();
    ctx.translate(cx, hipY);
    ctx.scale(squashX, squashY);
    ctx.drawImage(im, 0, 0, im.width, Math.round(im.height * cf), -w / 2, -h * cf, w, h * cf);
    ctx.restore();
  };

  /* ---------------- 溪畔 ----------------
     浮漂：待饵时轻轻浮着，一咬钩就猛地沉下去。深色小点 + 一圈水纹就够，
     不用画得精细 —— 它在 100 多像素外，玩家的注意力在"什么时候按 E"。 */
  I.floater = function (ctx, x, y, sink, t) {
    var k = sink || 0;
    var bob = k > 0 ? 0 : Math.sin(t * 2.4) * 1.6;
    var fy = y + bob + k * 9;
    // 落水的水纹
    I.ripple(ctx, x, y, 11 + k * 5, 0.42);
    // 咬钩时浮漂整个沉下去，只剩竿梢那道白点还浮在水面
    if (k > 0) {
      ctx.save();
      ctx.fillStyle = I.INK_SOFT + '0.55)';
      ctx.beginPath();
      ctx.ellipse(x, y + 3, 5.5, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = I.INK + '0.92)';
    ctx.beginPath();
    ctx.ellipse(x, fy, 4.4, 3.1, 0, 0, Math.PI * 2);
    ctx.fill();
    // 顶上一小点白，是"这里有个活物"的信号
    ctx.fillStyle = 'rgba(255,252,244,0.92)';
    ctx.beginPath();
    ctx.ellipse(x - 0.9, fy - 1.0, 1.5, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  I.ripple = function (ctx, x, y, r, alpha) {
    ctx.save();
    ctx.strokeStyle = I.HUA + (alpha === undefined ? 0.4 : alpha) + ')';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.34, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  /* 咬钩那一圈扩散的水纹 —— 玩家全靠它判断"现在提竿"。
     水面本身是淡花青留白，细淡墨圈画在上头基本看不见，
     所以要两道、加粗、再压一层暖色对比，不然提示全靠底下那行字。 */
  I.biteRing = function (ctx, x, y, k) {
    var r1 = 13 + k * 52, r2 = 9 + k * 30;
    ctx.save();
    ctx.strokeStyle = I.INK + (0.72 * (1 - k * 0.7)).toFixed(3) + ')';
    ctx.lineWidth = 3.4 * (1 - k * 0.6) + 1.2;
    ctx.beginPath();
    ctx.ellipse(x, y, r1, r1 * 0.30, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = I.ZHE + (0.62 * (1 - k * 0.5)).toFixed(3) + ')';
    ctx.lineWidth = 2.4 * (1 - k * 0.6) + 0.8;
    ctx.beginPath();
    ctx.ellipse(x, y, r2, r2 * 0.30, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  /* 采集点：一小撮墨点。摘掉就整块消失，长回去再画。 */
  I.node = function (ctx, k, x, y, s) {
    var col, n = 3;
    if (k === 'jun') { col = I.CLU_D; n = 4; }
    else if (k === 'mei') { col = I.ZHE; n = 4; }
    else if (k === 'ling') { col = I.QING; n = 3; }
    else if (k === 'ou') { col = I.QING; n = 2; }
    else { col = I.INK_SOFT; n = 3; }        // 田螺
    for (var i = 0; i < n; i++) {
      var a = -1.9 + i * (Math.PI * 1.5 / (n - 1 || 1));
      I.dot(ctx, x + Math.cos(a) * s * 0.42, y + Math.sin(a) * s * 0.24,
            s * (0.20 - i * 0.012), col, 0.8);
    }
    // 底下压一小片淡墨，像是长在土里/水里的
    ctx.save();
    ctx.fillStyle = I.INK_SOFT + '0.18)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.12, s * 0.62, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /* ---------------- 后山：洞口与刻石 ----------------
     两样都是代码画。
     洞口是因为不能为了一个入口重画 nanshan.jpg —— 重画等于把田畦梯形
     四角那组实测坐标全部作废，一整轮坐标验收白做，不值。
     刻石是因为「读过之后字就没了」是状态，底图给不了。 */

  /* 洞口：一道窄口，里面透出一点暖光。
     踩过的坑：第一版拿几团淡墨当岩体、正中挖一个黑椭圆、椭圆中心再点一团
     橙色渐变 —— 1× 下一眼看过去是一只「黑蛋带橙黄蛋黄」。三处都错：
       1) 岩体太淡太散，压不住那个纯黑椭圆，椭圆成了主角；
       2) 椭圆在正中，天然读成「东西里面的核」；
       3) 暖光饱和度太高，成了蛋黄。
     改法：岩体改成一块轮廓不规则的多边形实心体（淡不了，0.60 才压得住），
     洞口挪到岩体底部、做成平底的半拱，光只从洞口内壁下缘渗一小片。 */
  I.cave = function (ctx, x, y, s) {
    ctx.save();
    ctx.fillStyle = I.INK_SOFT + '0.22)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.04, s * 0.78, s * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 岩体。轮廓刻意不对称：椭圆两边一样圆，怎么叠都是蛋。
    // 顶点也加得密一点 —— 六个长直斜边连起来是纸板剪影，不是石头
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.60, y);
    ctx.lineTo(x - s * 0.68, y - s * 0.20);
    ctx.lineTo(x - s * 0.66, y - s * 0.36);
    ctx.lineTo(x - s * 0.54, y - s * 0.52);
    ctx.lineTo(x - s * 0.36, y - s * 0.62);
    ctx.lineTo(x - s * 0.30, y - s * 0.78);
    ctx.lineTo(x - s * 0.20, y - s * 0.88);
    ctx.lineTo(x - s * 0.06, y - s * 0.99);
    ctx.lineTo(x + s * 0.12, y - s * 0.95);
    ctx.lineTo(x + s * 0.26, y - s * 0.85);
    ctx.lineTo(x + s * 0.30, y - s * 0.70);
    ctx.lineTo(x + s * 0.46, y - s * 0.60);
    ctx.lineTo(x + s * 0.60, y - s * 0.44);
    ctx.lineTo(x + s * 0.66, y - s * 0.24);
    ctx.lineTo(x + s * 0.60, y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(108,99,86,0.58)';
    ctx.fill();
    // 背光那半边压深，石头才有厚度
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(74,68,58,0.34)';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.16, y - s * 1.05);
    ctx.lineTo(x + s * 0.80, y - s * 1.05);
    ctx.lineTo(x + s * 0.80, y + s * 0.05);
    ctx.lineTo(x + s * 0.16, y + s * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();

    // 岩面皴纹：短、带提按。少了这几笔就是一块灰板
    I.brush(ctx, [[x - s * 0.46, y - s * 0.50], [x - s * 0.28, y - s * 0.30], [x - s * 0.34, y - s * 0.12]],
      s * 0.030, s * 0.010, I.INK, 0.34);
    I.brush(ctx, [[x + s * 0.30, y - s * 0.66], [x + s * 0.44, y - s * 0.44], [x + s * 0.40, y - s * 0.22]],
      s * 0.028, s * 0.010, I.INK, 0.30);
    I.brush(ctx, [[x - s * 0.10, y - s * 0.88], [x - s * 0.04, y - s * 0.70]],
      s * 0.024, s * 0.010, I.INK, 0.24);
    // 顶上两撮苔点，跟底图的水墨点苔接上
    I.dot(ctx, x - s * 0.14, y - s * 0.95, s * 0.045, I.QING, 0.45);
    I.dot(ctx, x + s * 0.20, y - s * 0.88, s * 0.038, I.QING, 0.38);

    // 洞口：平底的半拱，坐在岩体根上。
    // 放在正中偏上会读成「东西里的核」，这是上一版最大的错
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.20, y);
    ctx.lineTo(x - s * 0.20, y - s * 0.28);
    ctx.quadraticCurveTo(x, y - s * 0.48, x + s * 0.20, y - s * 0.28);
    ctx.lineTo(x + s * 0.20, y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(24,22,20,0.93)';
    ctx.fill();
    // 光只从内壁下缘渗一小片，饱和度压到近乎稻草色
    var g = ctx.createRadialGradient(x, y - s * 0.08, 0, x, y - s * 0.08, s * 0.24);
    g.addColorStop(0, 'rgba(242,228,188,0.40)');
    g.addColorStop(0.45, 'rgba(228,206,156,0.15)');
    g.addColorStop(1, 'rgba(228,206,156,0)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // 口沿：浓墨勾一道。这是「这是个洞」和「这是个黑斑」的分界
    I.brush(ctx, [
      [x - s * 0.21, y],
      [x - s * 0.21, y - s * 0.28],
      [x, y - s * 0.50],
      [x + s * 0.21, y - s * 0.28],
      [x + s * 0.21, y]
    ], s * 0.022, s * 0.022, I.INK, 0.60);

    // 洞口边的杂草丛，让它长在地上而不是浮在画上。
    // 用淡墨不用青绿：青绿在这个距离上会跳成两根绿棍
    I.brush(ctx, [[x - s * 0.31, y], [x - s * 0.35, y - s * 0.12], [x - s * 0.28, y - s * 0.08]], s * 0.020, s * 0.005, I.INK_SOFT, 0.75);
    I.brush(ctx, [[x + s * 0.30, y], [x + s * 0.35, y - s * 0.10], [x + s * 0.27, y - s * 0.06]], s * 0.018, s * 0.005, I.INK_SOFT, 0.62);
  };

  /* 刻石：读过之前石面上有字，读过字就磨淡了，但石头还在。

     两版的教训都在 1× 实拍里：
       78px 高 —— 农人一站就把石头盖严实，「这儿有块刻着字的石头」玩家收不到。
       三道粗黑横杠 —— 那是条形码，而且石头越做越像墓碑。
     现在：石身瘦高、顶沿压平（拱顶就是墓碑），字画成一格一格的小竖笔 ——
     低分辨率下那才是「字」的样子。读过的不是抹成空白板，而是同一格字磨到
     0.13 透明度：石上的字不会凭空消失，这个反馈比空白更真。 */
  I.stele = function (ctx, x, y, s, read) {
    // 一点点歪：手刻的，不是厂里切的。用坐标取余，别给个固定 0 ——
    // 六块石头全直着站，画面立刻假。
    var lean = (Math.round(x) % 5) * 0.006 - 0.012;
    var body = read ? 0.25 : 0.33;      // 读过的石面被摸得亮一点
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lean);
    ctx.fillStyle = 'rgba(58,50,40,0.19)';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.40, s * 0.070, 0, 0, Math.PI * 2);
    ctx.fill();
    // 基座：宽出石身一截，不然像插在地上的棍子
    ctx.fillStyle = I.INK_SOFT + '0.50)';
    ctx.beginPath();
    ctx.moveTo(-s * 0.35, 0);
    ctx.lineTo(-s * 0.27, -s * 0.12);
    ctx.lineTo(s * 0.27, -s * 0.12);
    ctx.lineTo(s * 0.35, 0);
    ctx.closePath();
    ctx.fill();
    // 石身：瘦高，顶沿压平
    ctx.fillStyle = 'rgba(108,99,86,' + body + ')';
    ctx.beginPath();
    ctx.moveTo(-s * 0.225, -s * 0.12);
    ctx.lineTo(-s * 0.205, -s * 0.88);
    ctx.quadraticCurveTo(0, -s * 0.93, s * 0.205, -s * 0.88);
    ctx.lineTo(s * 0.225, -s * 0.12);
    ctx.closePath();
    ctx.fill();
    // 背光那半边压深，石身才有厚度，不然是贴片
    ctx.fillStyle = I.INK_SOFT + '0.22)';
    ctx.beginPath();
    ctx.moveTo(s * 0.075, -s * 0.14);
    ctx.lineTo(s * 0.075, -s * 0.90);
    ctx.quadraticCurveTo(s * 0.165, -s * 0.90, s * 0.205, -s * 0.88);
    ctx.lineTo(s * 0.225, -s * 0.14);
    ctx.closePath();
    ctx.fill();
    // 顶沿勾一道，石头才不会融进底图
    I.brush(ctx, [[-s * 0.205, -s * 0.88], [0, -s * 0.925], [s * 0.205, -s * 0.88]],
      s * 0.014, s * 0.014, I.INK, 0.40);

    // 刻字：三行四列的小竖笔，长短不齐 ——
    // 齐刷刷等长等距就成条形码了，每一格给个确定性的微差
    var ink = read ? 0.13 : 0.68, r, c;
    for (r = 0; r < 3; r++) {
      var ly = -s * (0.72 - r * 0.17);
      for (c = 0; c < 4; c++) {
        var lx = -s * 0.135 + c * s * 0.09;
        var len = s * (0.075 + ((r * 3 + c * 5) % 4) * 0.014);
        I.brush(ctx, [[lx, ly], [lx + s * 0.005, ly - len]],
          s * 0.021, s * 0.013, I.INK, ink);
      }
    }
    ctx.restore();
  };

  /* ---------------- 石硐 ---------------- */

  /* 一块可以敲的石头。
     w/h 是这一格在画面上的实际像素宽高（跟 I.grain 一样按格算，不写死），
     baseY 落在格心偏下，石头是「坐」在格子里而不是悬着。

     这一族画坏过三轮，1× 实拍才看出来：
       1) 用和岩面差不多的灰填 → 整面墙看着是空的，玩家不知道哪里能点。
          石头必须**比岩面暗一大截、并且是实心的**。
       2) 轮廓画得比填充还显眼 → 读成「空心的房子」。所以轮廓只比填充深一点，
          靠明度差读出体积，不靠线。
       3) 顶上一道白亮弧线太粗 → 变成悬在石头上方的一个白色「Λ」，
          看着像屋顶。改成**贴着轮廓上缘的、极短的一段**。
     挖开之后那一格更要显眼：不是画一个洞，是把整块石头换成「凹进去的一片」。 */
  I.rock = function (ctx, cx, baseY, w, h, ore, seed) {
    var hw = w * 0.47, bot = baseY - h * 0.06;
    var sd = (seed || 0) + 1;
    // 剪影：四张顶点表轮着来，再按 seed 决定左右镜像。
    // 早先十八块共用一张表、只把上缘乘个 0.94~1.04，1× 实拍一看就是一排
    // **一模一样的黑馒头** —— 系数差 5% 人眼根本读不出来，
    // 而「石头长得不一样」恰恰是玩家判断这块能不能敲的第二个线索。
    // 所以这里换的是**形状**不是**幅度**：四套轮廓差在宽窄、顶平顶尖、
    // 左肩高还是右肩高，不是同一张脸做微调。镜像再叠一层，
    // 18 块（4 套 × 2 向）里同形的机会就小到可以忽略。
    var T = I.ROCK_SHAPE[sd % 4];
    var flip = (sd % 2) === 1;
    // 整体大小也错开一点。同轮廓下大 12% 小 12% 已经是「另一块」的观感
    var sk = 0.90 + ((sd * 7) % 5) * 0.048;
    var i, p, pts = [];
    for (i = 0; i < T.length; i++) {
      p = T[i];
      pts.push([p[0] * hw * (flip ? -1 : 1), p[1] * h * sk]);
    }
    ctx.save();
    // 落在右下的一片投影：石头是从岩面上凸出来的，得有它才立得住。
    // 早先画得又宽又淡，成了一块和石头分开的灰水洼
    ctx.fillStyle = 'rgba(28,25,22,0.30)';
    ctx.beginPath();
    ctx.ellipse(cx + w * 0.05, bot + h * 0.005, w * 0.36, h * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx + pts[0][0], bot + pts[0][1]);
    for (i = 1; i < pts.length; i++) ctx.lineTo(cx + pts[i][0], bot + pts[i][1]);
    ctx.closePath();
    if (ore) {
      // 实心的暗石。底图岩面本身就在中灰，填充要是 0.5 上下的灰就等于没画
      ctx.fillStyle = 'rgba(68,63,56,0.84)';
      ctx.fill();
      ctx.save();
      ctx.clip();
      // 背光那半边。用渐变而不是一块矩形 —— 矩形的右缘是一条竖直硬边，
      // 一眼就看出「这石头是两块拼的」
      var sh = ctx.createLinearGradient(cx - w * 0.10, 0, cx + w * 0.48, 0);
      sh.addColorStop(0, 'rgba(30,27,24,0)');
      sh.addColorStop(1, 'rgba(30,27,24,0.48)');
      ctx.fillStyle = sh;
      ctx.fillRect(cx - w, bot - h, w * 2, h * 1.4);
      ctx.restore();
      // 轮廓：只比填充深一点。线比面还黑的话，整块石头读成空心房子
      ctx.strokeStyle = 'rgba(26,23,20,0.66)';
      ctx.lineWidth = Math.max(1.2, h * 0.018);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + pts[0][0], bot + pts[0][1]);
      for (i = 1; i < pts.length; i++) ctx.lineTo(cx + pts[i][0], bot + pts[i][1]);
      ctx.closePath();
      ctx.stroke();
      // 上缘一小段受光：贴着轮廓走，短到几乎看不见。
      // 早先那条浮在石头上方，粗得像屋顶
      I.brush(ctx, [[cx - hw * 0.52, bot - h * 0.60 * sk], [cx - hw * 0.10, bot - h * 0.64 * sk]],
        h * 0.018, h * 0.006, 'rgba(236,229,212,', 0.24);
      // 皴纹：两道斜笔。少了它们就是一块灰板。
      // 位置跟着剪影走 —— 写死在同一个高度的话，矮的那几块皴纹会跑到石头外面
      I.brush(ctx, [[cx - w * 0.24, bot - h * 0.30 * sk], [cx - w * 0.12, bot - h * 0.10 * sk]],
        h * 0.015, h * 0.005, I.INK, 0.28);
      I.brush(ctx, [[cx + w * 0.20, bot - h * 0.44 * sk], [cx + w * 0.27, bot - h * 0.20 * sk]],
        h * 0.012, h * 0.004, I.INK, 0.22);
      I.oreVein(ctx, cx, baseY, w, h, ore, seed, sk);
    } else {
      // 挖开了：不再是一块小暗片，而是**把原来那块石头掏空剩下的一个坑**。
      // 之前画的是一片只有 w×0.44 宽、h×0.20 高的黑带，1× 下一眼看过去是
      // 「地上横躺着一块黑铁板」，而不是「这格原本的石头被敲掉了」——
      // 坑比原来那块石头小太多，玩家会以为这一格本来就没东西。
      // 所以口沿要接近原来石头的宽度（0.86），深度给到 0.30，
      // 里面画的是**岩壁和地面**（比石头浅），上缘一道断口，不给受光。
      var bw = hw * 0.88, bd = h * 0.28;
      ctx.beginPath();
      ctx.moveTo(cx - bw, bot);
      ctx.lineTo(cx - bw * 0.96, bot - bd * 0.52);
      ctx.lineTo(cx - bw * 0.62, bot - bd * 0.92);
      ctx.lineTo(cx + bw * 0.18, bot - bd * 0.86);
      ctx.lineTo(cx + bw * 0.78, bot - bd * 0.54);
      ctx.lineTo(cx + bw * 0.94, bot);
      ctx.closePath();
      // 坑壁：比石头浅一档（看进去是岩面，不是黑）
      ctx.fillStyle = 'rgba(76,70,62,0.78)';
      ctx.fill();
      // 上半是投在坑壁上的落影，下半透出底下的地面。
      // 下缘这一档必须够亮 —— 全暗的话坑就读成「一块搁着的黑铁板」，
      // 而不是「这里被敲掉了一块」；亮的那一线就是坑底的土
      var g = ctx.createLinearGradient(0, bot - bd, 0, bot);
      g.addColorStop(0, 'rgba(12,11,10,0.50)');
      g.addColorStop(0.42, 'rgba(44,40,35,0.16)');
      g.addColorStop(1, 'rgba(152,142,124,0.32)');
      ctx.fillStyle = g;
      ctx.fill();
      // 断口：沿坑口压一道实墨。这道线是「这里被敲掉了」的唯一硬证据
      ctx.strokeStyle = 'rgba(24,21,19,0.72)';
      ctx.lineWidth = Math.max(1.4, h * 0.022);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - bw, bot);
      ctx.lineTo(cx - bw * 0.96, bot - bd * 0.52);
      ctx.lineTo(cx - bw * 0.62, bot - bd * 0.92);
      ctx.lineTo(cx + bw * 0.18, bot - bd * 0.86);
      ctx.lineTo(cx + bw * 0.78, bot - bd * 0.54);
      ctx.lineTo(cx + bw * 0.94, bot);
      ctx.stroke();
      // 敲下来的碎石，堆在坑前
      I.dot(ctx, cx - bw * 0.60, bot - h * 0.012, h * 0.042, 'rgba(46,42,38,', 0.80);
      I.dot(ctx, cx + bw * 0.52, bot - h * 0.010, h * 0.034, 'rgba(38,35,32,', 0.72);
      I.dot(ctx, cx + bw * 0.18, bot + h * 0.012, h * 0.026, 'rgba(54,49,44,', 0.62);
    }
    ctx.restore();
  };
  // 四套石头剪影。坐标一律写成**占半宽/身高的比例**（y 向上为负），
  // 画的时候乘 hw / h。x 的范围大约在 ±1（半宽一倍）之内。
  // 差别刻意做在：顶是平的还是尖的、宽还是窄、左肩高还是右肩高。
  I.ROCK_SHAPE = [
    // 0 宽顶圆肩：一块趴着的石头
    [[-1.00, -0.08], [-0.94, -0.40], [-0.58, -0.62], [-0.10, -0.70], [0.44, -0.58], [0.92, -0.34], [1.00, -0.13], [0.80, 0], [-0.62, -0.02]],
    // 1 平顶立石：顶是**平的一段**不是一点。
    // 早先这里给了一个单顶点，1× 下一眼看过去是墓碑；
    // 尖顶 + 暗色 = 墓碑，尖顶 + 亮色 = 帐篷，两头都不对
    [[-0.78, -0.12], [-0.70, -0.50], [-0.46, -0.80], [-0.02, -0.84], [0.46, -0.80], [0.76, -0.50], [0.90, -0.16], [0.80, 0], [-0.44, -0.02]],
    // 2 左肩高右肩低：斜插在岩缝里的一块
    [[-0.98, -0.14], [-0.80, -0.58], [-0.44, -0.78], [0.04, -0.66], [0.40, -0.48], [0.74, -0.30], [0.96, -0.10], [0.76, 0], [-0.60, -0.02]],
    // 3 低矮扁圆：半埋在土里的一块
    [[-1.02, -0.06], [-0.90, -0.26], [-0.50, -0.40], [0.00, -0.44], [0.50, -0.36], [0.94, -0.22], [1.00, -0.07], [0.78, 0], [-0.64, -0.02]]
  ];

  // 矿脉：嵌在石头里**的一片**，不是撒在上面的几粒。
  // 早先是一小簇同色圆点，1× 下看着像石头上趴了一只虫；改成散点更早的
  // 一版是几粒又大又艳的彩点，像墙上贴的彩色纸屑。
  // 真正的读法是「这块石头断面里露着一层矿」：先铺一片不规则的浅色斑
  // （比石头亮，靠这个把矿从石头里分出来），再在斑上点三四粒深一点的核。
  // 亮斑的大小跟矿的贵贱无关（1× 下一律小），贵贱靠的是核的颜色。
  I.oreVein = function (ctx, cx, baseY, w, h, ore, seed, sk) {
    var col = I.ORE_COL[ore] || I.INK;
    var s = (seed || 0) + 1;
    var vx = cx - w * 0.04 + ((s * 13) % 5 - 2) * w * 0.018;
    var vy = baseY - h * (0.26 * (sk || 1));
    var pw = w * 0.30, ph = h * 0.17;
    ctx.save();
    // 斑：六边不规则，边缘毛糙
    ctx.beginPath();
    ctx.moveTo(vx - pw, vy + ph * 0.30);
    ctx.lineTo(vx - pw * 0.62, vy - ph * 0.62);
    ctx.lineTo(vx + pw * 0.18, vy - ph);
    ctx.lineTo(vx + pw * 0.92, vy - ph * 0.34);
    ctx.lineTo(vx + pw * 0.70, vy + ph * 0.72);
    ctx.lineTo(vx - pw * 0.34, vy + ph * 0.92);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.50;
    ctx.fill();
    ctx.globalAlpha = 1;
    // 核：两粒。粒数不能多 —— 三粒以上 1× 下一眼是石头上趴了一只虫，
    // 而这一片斑的边缘比石头亮这一点，才是「这里面有矿」的全部说服力
    I.dot(ctx, vx - pw * 0.28, vy + ph * 0.08, ph * 0.22, col, 0.62);
    I.dot(ctx, vx + pw * 0.30, vy - ph * 0.28, ph * 0.17, col, 0.56);
    ctx.restore();
  };
  // 四种矿的色。石炭是黑的 —— 它比石头还暗一点点，所以那一层浅斑全靠
  // 靠「斑的边缘比石头亮一点」认出来，实拍时是最难认的那一种，
  // 靠位置（它只在一二层）补，不靠颜色硬撑
  I.ORE_COL = {
    shi: 'rgba(92,87,81,',
    tong: 'rgba(116,146,132,',
    tie: 'rgba(162,120,90,',
    xuan: 'rgba(116,130,152,'
  };

  /* 通往下一层的落点：地上一个挖开的方口。
     敲干净之前上面压着一堆碎石。压着的那一份早先画成「深色椭圆上盖三颗灰点」，
     结果灰点几乎盖满了整个口，只在边上剩一条黑月牙 —— 看着像地上有块脏东西，
     不像「这儿有个被盖住的洞」。改成**一整堆碎石把口填平**，只在底缘留一线黑。 */
  I.shaft = function (ctx, x, y, s, open) {
    ctx.save();
    if (open) {
      // 口沿：挖出来的一圈碎土
      ctx.fillStyle = 'rgba(112,103,90,0.55)';
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.50, s * 0.19, 0, 0, Math.PI * 2);
      ctx.fill();
      // 口子
      ctx.fillStyle = 'rgba(18,17,16,0.90)';
      ctx.beginPath();
      ctx.ellipse(x, y + s * 0.012, s * 0.35, s * 0.125, 0, 0, Math.PI * 2);
      ctx.fill();
      // 内壁：上半暗、下半被下面的光反上来一点
      var g = ctx.createLinearGradient(x, y - s * 0.11, x, y + s * 0.12);
      g.addColorStop(0, 'rgba(8,8,8,0.55)');
      g.addColorStop(1, 'rgba(214,192,150,0.30)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y + s * 0.012, s * 0.33, s * 0.112, 0, 0, Math.PI * 2);
      ctx.fill();
      // 近侧的口沿受光，远侧落影：这一条线是「这是个洞」的全部说服力
      ctx.strokeStyle = 'rgba(226,216,196,0.50)';
      ctx.lineWidth = Math.max(1.6, s * 0.020);
      ctx.beginPath();
      ctx.ellipse(x, y + s * 0.012, s * 0.35, s * 0.125, 0.1, 0.15, Math.PI - 0.1);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(30,27,24,0.72)';
      ctx.beginPath();
      ctx.ellipse(x, y + s * 0.012, s * 0.35, s * 0.125, 0.1, Math.PI + 0.1, Math.PI * 2 - 0.1);
      ctx.stroke();
    } else {
      // 压着：不是一块整板，是**一堆碎石**。
      // 早先画成一个七边大灰板，1× 下一眼是地上铺了块石板，
      // 读不出「这堆东西盖住了口、得敲干净才能下去」。
      // 改成大小不一的六七块碎石垒着，中间空一条缝露出口沿的暗
      ctx.fillStyle = 'rgba(92,84,73,0.42)';
      ctx.beginPath();
      ctx.ellipse(x, y + s * 0.03, s * 0.50, s * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      // 缝：先铺一条暗底，碎石压在上面就自然留出缝
      ctx.fillStyle = 'rgba(20,19,17,0.80)';
      ctx.beginPath();
      ctx.ellipse(x, y + s * 0.03, s * 0.30, s * 0.075, 0, 0, Math.PI * 2);
      ctx.fill();
      var heap = [
        [-0.42, 0.06, 0.19, 0.15], [-0.20, -0.05, 0.16, 0.13], [0.06, 0.10, 0.20, 0.14],
        [0.30, -0.03, 0.17, 0.12], [-0.12, 0.13, 0.15, 0.10], [0.16, -0.11, 0.13, 0.10],
        [0.44, 0.09, 0.14, 0.11]
      ];
      for (var q = 0; q < heap.length; q++) {
        var a = heap[q];
        ctx.beginPath();
        ctx.moveTo(x + s * (a[0] - a[2]), y + s * (a[1] + a[3] * 0.5));
        ctx.lineTo(x + s * (a[0] - a[2] * 0.5), y + s * (a[1] - a[3]));
        ctx.lineTo(x + s * (a[0] + a[2] * 0.7), y + s * (a[1] - a[3] * 0.7));
        ctx.lineTo(x + s * (a[0] + a[2]), y + s * (a[1] + a[3] * 0.4));
        ctx.lineTo(x + s * (a[0] - a[2] * 0.2), y + s * (a[1] + a[3] * 0.8));
        ctx.closePath();
        ctx.fillStyle = q % 2 ? 'rgba(120,111,97,0.92)' : 'rgba(101,93,81,0.92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(30,27,24,0.60)';
        ctx.lineWidth = Math.max(1.1, s * 0.010);
        ctx.stroke();
      }
      I.dot(ctx, x - s * 0.06, y + s * 0.02, s * 0.030, 'rgba(30,27,24,', 0.34);
      I.dot(ctx, x + s * 0.22, y + s * 0.06, s * 0.026, 'rgba(30,27,24,', 0.30);
    }
    ctx.restore();
  };

  /* 硐里回去的那道口：底图左边已经有一整片暗岩了，所以这里**不再画岩体**，
     只在墙上开一道平底的拱，两侧立两根撑木。
     撑木早先是用 I.brush 画的（笔宽 s*0.05 ≈ 9px），两竖一横连成一块土黄的板子，
     洞口整个被挡在后面 —— 线条要画成**细杆**，不是刷子。 */
  I.adit = function (ctx, x, y, s) {
    ctx.save();
    // 洞口里是**亮**的，不是黑的。
    // 前两版都画成「黑拱 + 底下一道暖渐变」，1× 实拍一眼就是一台烤箱：
    // 暗色块 + 居中的暖色 = 容器，而容器读不出「那边是外面」。
    // 人站在硐里往外看，出口本来就该是亮的 —— 亮与暗的对比
    // 本身就是「那边是墟市」的全部信息，比任何线条都硬。
    ctx.beginPath();
    ctx.moveTo(x - s * 0.30, y);
    ctx.lineTo(x - s * 0.30, y - s * 0.40);
    ctx.quadraticCurveTo(x, y - s * 0.70, x + s * 0.30, y - s * 0.40);
    ctx.lineTo(x + s * 0.30, y);
    ctx.closePath();
    // 从上到下：外头的天光偏白，靠下缘落一点土黄（硐里的灯/反光）
    var g = ctx.createLinearGradient(0, y - s * 0.62, 0, y);
    g.addColorStop(0, 'rgba(238,232,216,0.94)');
    g.addColorStop(0.55, 'rgba(220,209,184,0.90)');
    g.addColorStop(1, 'rgba(176,158,126,0.86)');
    ctx.fillStyle = g;
    ctx.fill();
    // 口沿：一圈实墨把洞口和暗岩分开，这是「这是个洞」的那条硬边
    ctx.strokeStyle = 'rgba(26,23,20,0.88)';
    ctx.lineWidth = Math.max(2.4, s * 0.034);
    ctx.lineJoin = 'round';
    ctx.stroke();
    // 光洒在硐里的地面上：一小片向右下斜的淡光
    var sp = ctx.createLinearGradient(x, y, x + s * 0.34, y + s * 0.20);
    sp.addColorStop(0, 'rgba(236,226,200,0.34)');
    sp.addColorStop(1, 'rgba(236,226,200,0)');
    ctx.fillStyle = sp;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.30, y);
    ctx.lineTo(x + s * 0.30, y);
    ctx.lineTo(x + s * 0.64, y + s * 0.22);
    ctx.lineTo(x - s * 0.62, y + s * 0.22);
    ctx.closePath();
    ctx.fill();
    // 地上被踩出来的一道浅痕
    I.brush(ctx, [[x - s * 0.40, y + s * 0.10], [x + s * 0.34, y + s * 0.17]],
      s * 0.020, s * 0.008, 'rgba(60,54,46,', 0.26);
    // 两根撑木 + 一根横梁：细杆，早先刷子太粗会整个挡在洞口前面
    ctx.strokeStyle = 'rgba(88,72,54,0.95)';
    ctx.lineWidth = Math.max(2, s * 0.026);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.36, y); ctx.lineTo(x - s * 0.34, y - s * 0.60);
    ctx.moveTo(x + s * 0.36, y); ctx.lineTo(x + s * 0.34, y - s * 0.60);
    ctx.moveTo(x - s * 0.40, y - s * 0.58); ctx.lineTo(x + s * 0.40, y - s * 0.58);
    ctx.stroke();
    // 撑木的受光侧
    ctx.strokeStyle = 'rgba(158,134,102,0.72)';
    ctx.lineWidth = Math.max(1, s * 0.011);
    ctx.beginPath();
    ctx.moveTo(x - s * 0.372, y - s * 0.04); ctx.lineTo(x - s * 0.352, y - s * 0.56);
    ctx.moveTo(x + s * 0.372, y - s * 0.04); ctx.lineTo(x + s * 0.352, y - s * 0.56);
    ctx.stroke();
    ctx.restore();
  };

  /* ---------------- 营造：鸡舍与水渠 ----------------
     两样都是代码画，跟洞口一个理由：不能为了一个会变的建筑重画底图。

     踩过的坑：第一版全用**半透明淡彩**（墙 0.34、顶 0.46）压在南山那片
     浅沙色上 —— 画是画出来了，1× 下一片糊，读成一摊半透明的色块，
     一点不像立在草坡上的棚子。淡彩叠浅底必然没掉，
     底图是浅的，这两样就必须**自己带实色**：顶要压到深，墙要有中间调，
     门口要压到近黑，四层明暗各自分开。 */

  /* 棚：鸡舍、牛棚、羊圈。
     三样共用一副骨架（墙、门、草窝、里面的货），差别只有**顶和棚边站着的那一头**：
       coop  瓦顶、门小　　旁边一只鸡（红冠是唯一一处亮色）
       barn  茅顶、门宽　　旁边一头牛（深褐身、浅口鼻、一对角）
       sheep 木栅顶、门矮　旁边一只羊（三瓣羊毛 + 一颗深色的头）
     顶只是轮廓，缩到 0.743× 之后三团褐色看着就是三间一样的屋；
     **牲口才是 1× 下认得出养什么的那一眼**，所以它每样都得画。
     门、草窝、堆着的货三样是**照料的全部视觉信息** ——
     站着就要看得见门开没开、有没有粮、堆着几份，不然只能一次次按下去试。
     规矩跟代码画的建筑一样：实色分层，不靠半透明淡彩压浅色底图。 */
  I.keep = function (ctx, x, y, s, lv, pose, kind) {
    var top = lv > 1 ? 0.86 : 0.78;
    var wallW = kind === 'barn' ? 0.62 : (kind === 'sheep' ? 0.54 : 0.60);
    var eL = x - s * wallW, eR = x + s * wallW;
    var yW = y - s * top * 0.56;          // 檐
    var n = 0, k;
    if (pose) for (k in pose) if (k === 'got' && pose[k] > 0) n = pose[k];
    ctx.save();
    ctx.lineJoin = 'round';
    // 影子
    ctx.fillStyle = I.INK_SOFT + '0.42)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.03, s * (lv > 1 ? 0.82 : 0.66), s * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    if (lv <= 0) {
      // 还没造：地上几根木桩 + 一道草绳。不画棚 —— 没造的东西不该有个屋顶在那儿
      ctx.strokeStyle = 'rgba(104,82,58,0.92)';
      ctx.lineWidth = Math.max(1, s * 0.030);
      for (var st = -1; st <= 1; st++) {
        var sx = x + st * s * 0.30;
        ctx.beginPath();
        ctx.moveTo(sx, y);
        ctx.lineTo(sx - s * 0.01, y - s * (0.22 + (st ? 0.05 : 0)));
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(150,132,102,0.75)';
      ctx.lineWidth = Math.max(1, s * 0.018);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.30, y - s * 0.14);
      ctx.lineTo(x + s * 0.30, y - s * 0.16);
      ctx.stroke();
      I.dot(ctx, x - s * 0.22, y - s * 0.03, s * 0.036, I.QING, 0.50);
      I.dot(ctx, x + s * 0.25, y - s * 0.02, s * 0.030, I.QING, 0.42);
      ctx.restore();
      return;
    }

    // 墙：实打实的中间调
    ctx.fillStyle = 'rgba(146,122,92,0.94)';
    ctx.beginPath();
    ctx.moveTo(eL, y);
    ctx.lineTo(eL, yW);
    ctx.lineTo(eR, yW);
    ctx.lineTo(eR, y);
    ctx.closePath();
    ctx.fill();
    // 墙脚压一道实影，墙和地才不是浮着的
    ctx.fillStyle = 'rgba(78,62,48,0.50)';
    ctx.fillRect(eL, y - s * 0.06, eR - eL, s * 0.06);

    // 顶：按 kind 换
    ctx.fillStyle = 'rgba(112,86,58,0.96)';
    if (kind === 'sheep') {
      // 木栅顶：一根根横杆，缝里透着天
      ctx.strokeStyle = 'rgba(120,96,68,0.96)';
      ctx.lineWidth = Math.max(1, s * 0.045);
      for (var sg = 0; sg < 4; sg++) {
        var gy = yW - s * (0.04 + sg * 0.085);
        ctx.beginPath();
        ctx.moveTo(eL - s * 0.04, gy);
        ctx.lineTo(eR + s * 0.04, gy);
        ctx.stroke();
      }
    } else if (kind === 'barn') {
      // 牛棚：厚茅草顶，一层压一层
      ctx.beginPath();
      ctx.moveTo(eL - s * 0.10, yW);
      ctx.lineTo(x - s * wallW * 0.42, y - s * top * 0.96);
      ctx.lineTo(x + s * wallW * 0.42, y - s * top * 0.96);
      ctx.lineTo(eR + s * 0.10, yW);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(88,68,46,0.60)';
      ctx.lineWidth = Math.max(1, s * 0.016);
      for (var gb = 1; gb < 4; gb++) {
        var gxx = eL + (eR - eL) * gb / 4;
        ctx.beginPath();
        ctx.moveTo(gxx, yW - s * 0.02);
        ctx.lineTo(gxx - s * 0.04, y - s * top * 0.90);
        ctx.stroke();
      }
    } else {
      // 鸡舍：压着片瓦的斜顶
      ctx.beginPath();
      ctx.moveTo(eL - s * 0.08, yW);
      ctx.lineTo(x - s * wallW * 0.52, y - s * top * 0.90);
      ctx.lineTo(x + s * wallW * 0.48, y - s * top * 0.88);
      ctx.lineTo(eR + s * 0.08, yW);
      ctx.closePath();
      ctx.fill();
      // 瓦垄：四道压出来的弧
      ctx.strokeStyle = 'rgba(84,66,46,0.55)';
      ctx.lineWidth = Math.max(1, s * 0.014);
      for (var gt = 0; gt < 4; gt++) {
        var tx = eL + (eR - eL) * (0.15 + gt * 0.24);
        ctx.beginPath();
        ctx.moveTo(tx, yW);
        ctx.lineTo(tx + s * wallW * 0.06, y - s * top * 0.86);
        ctx.stroke();
      }
    }
    // 檐口一道亮，是顶和墙之间那道转折
    I.brush(ctx, [[eL, yW], [eR, yW]], s * 0.022, s * 0.022, 'rgba(216,196,158,0.50)');

    // 门口的框架
    var dw = s * (kind === 'barn' ? 0.16 : 0.11);
    var dy0 = y - s * top * 0.16, dy1 = y - s * top * 0.44;
    ctx.fillStyle = 'rgba(26,22,19,0.96)';
    ctx.beginPath();
    ctx.moveTo(x - dw, dy0);
    ctx.lineTo(x - dw, dy1);
    ctx.lineTo(x, dy1 - s * top * 0.08);
    ctx.lineTo(x + dw, dy1);
    ctx.lineTo(x + dw, dy0);
    ctx.closePath();
    ctx.fill();

    // 门：开着的斜在一边，关着的横挡在门口
    ctx.fillStyle = 'rgba(120,96,66,0.96)';
    if (pose && pose.gate) {
      ctx.beginPath();
      ctx.moveTo(x + dw, dy0);
      ctx.lineTo(x + dw, dy1);
      ctx.lineTo(x + dw + s * 0.19, dy1 + s * top * 0.06);
      ctx.lineTo(x + dw + s * 0.19, dy0 + s * top * 0.04);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(x - dw, dy1 + s * top * 0.04, dw * 2, s * 0.030);
      ctx.fillRect(x - dw * 0.9, dy0 - s * top * 0.16, dw * 1.8, s * 0.028);
    }

    // 草窝：有粮是一撮松的，没粮是一片平的
    var gx = x - s * (wallW + 0.06);
    if (pose && pose.feed > 0) {
      for (var fd = 0; fd < 4; fd++) {
        var fx = gx + fd * s * 0.045;
        I.brush(ctx, [[fx, y - s * 0.02], [fx - s * 0.02, y - s * 0.07]],
          s * 0.016, s * 0.008, 'rgba(196,162,96,0.88)');
      }
    } else {
      ctx.strokeStyle = 'rgba(96,80,58,0.55)';
      ctx.lineWidth = Math.max(1, s * 0.014);
      ctx.beginPath();
      ctx.ellipse(gx + s * 0.06, y - s * 0.035, s * 0.075, s * 0.028, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 堆着的货：一件一件数得清
    var goods = kind === 'barn' ? 'rgba(238,238,230,0.95)' : 'rgba(216,208,192,0.95)';
    for (var eg = 0; eg < Math.min(n, 3); eg++) {
      I.dot(ctx, gx + s * 0.06 + (eg - 1) * s * 0.048, y - s * 0.085, s * 0.026, goods);
    }

    if (lv > 1) {
      // 二级：前面半截编竹篱 —— 一级和二级的分别就在这几根篾上
      ctx.strokeStyle = 'rgba(104,82,58,0.95)';
      ctx.lineWidth = Math.max(1, s * 0.020);
      for (var r = 0; r < 3; r++) {
        var yy = y - s * (0.05 + r * 0.10);
        ctx.beginPath();
        ctx.moveTo(x - s * (wallW + 0.02), yy);
        ctx.lineTo(x - s * 0.15, yy);
        ctx.stroke();
      }
      for (var c2 = 0; c2 < 5; c2++) {
        var xx = x - s * (wallW + 0.0) + c2 * s * 0.11;
        ctx.beginPath();
        ctx.moveTo(xx, y); ctx.lineTo(xx, y - s * 0.28);
        ctx.stroke();
      }
    }
    // 顶上两撮点苔，跟底图的水墨点苔接上
    I.dot(ctx, eL + s * 0.10, y - s * top * 0.92, s * 0.034, I.QING, 0.50);
    I.dot(ctx, eR - s * 0.14, y - s * top * 0.90, s * 0.030, I.QING, 0.42);
    // 棚旁边站着的那一头。**三样棚在 1× 下得一眼分得出是养什么**：
    // 光换顶（瓦/茅/栅）不够 —— 缩到 0.743× 之后三团褐色屋顶看着就是三间一样的屋，
    // 而这一眼是玩家收得到的那一半
    I.keepAnimal(ctx, x + s * (wallW + 0.16), y, s, kind, pose);
    ctx.restore();
  };

  /* 棚边上的牲口。站在**右边** —— 左边让给草窝和二级的篱笆。

     每一块都要**带一道深墨描边**。这不是描边好看，是必须：
     底图是浅沙色，白羊和浅牛身直接压上去就没了 —— 同一族的坑
     （半透明淡彩压浅底、双重的没）。描边比身子还便宜，一笔就救得回来。
     腿和身子都压到 0.95 以上，缩到 0.743× 才不会糊成一团灰。 */
  I.keepAnimal = function (ctx, x, y, s, kind, pose) {
    ctx.save();
    ctx.lineJoin = 'round';
    var OUT = 'rgba(46,38,32,0.92)';
    var lw = Math.max(1, s * 0.022);
    // 影子先压在地上，牲口才不是浮着的
    ctx.fillStyle = 'rgba(78,62,48,0.34)';
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.17, s * 0.034, 0, 0, Math.PI * 2);
    ctx.fill();
    // 一块肉：先描边再填色
    function blob(cx, cy, rx, ry, rot, fill) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, rot || 0, 0, Math.PI * 2);
      ctx.fillStyle = OUT;
      ctx.lineWidth = lw * 2;
      ctx.stroke();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    function bar(bx, by, bw, bh) {
      ctx.fillStyle = OUT;
      ctx.fillRect(bx - lw, by - lw, bw + lw * 2, bh + lw);
      ctx.fillStyle = kind === 'sheep' ? 'rgba(58,48,40,0.97)' : (kind === 'barn' ? 'rgba(70,52,38,0.97)' : 'rgba(150,116,72,0.96)');
      ctx.fillRect(bx, by, bw, bh);
    }
    if (kind === 'barn') {
      // 牛：深褐身、浅口鼻、一对角。四条腿是四根实心短条，不是线 ——
      // 1.4px 的线乘 0.743 再乘低透明度就没了（17/9 踩过细线那条）
      bar(x - s * 0.098, y - s * 0.150, s * 0.034, s * 0.150);
      bar(x - s * 0.042, y - s * 0.150, s * 0.034, s * 0.150);
      bar(x + s * 0.036, y - s * 0.150, s * 0.034, s * 0.150);
      bar(x + s * 0.092, y - s * 0.150, s * 0.034, s * 0.150);
      blob(x, y - s * 0.222, s * 0.152, s * 0.090, 0, 'rgba(84,62,44,0.97)');
      // 头 + 口鼻那一块浅色：脸和身子之间靠它分层，不然整个头是一团深褐
      blob(x - s * 0.152, y - s * 0.272, s * 0.066, s * 0.054, -0.25, 'rgba(84,62,44,0.97)');
      blob(x - s * 0.194, y - s * 0.248, s * 0.036, s * 0.030, -0.25, 'rgba(214,200,176,0.97)');
      // 角：往上翘的短弯。**要够粗** —— 细线在这个尺寸上直接消失
      ctx.strokeStyle = OUT;
      ctx.lineWidth = lw * 2 + s * 0.026;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.170, y - s * 0.306);
      ctx.quadraticCurveTo(x - s * 0.206, y - s * 0.348, x - s * 0.164, y - s * 0.368);
      ctx.moveTo(x - s * 0.114, y - s * 0.310);
      ctx.quadraticCurveTo(x - s * 0.136, y - s * 0.352, x - s * 0.092, y - s * 0.366);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(232,224,202,0.97)';
      ctx.lineWidth = s * 0.026;
      ctx.stroke();
      // 尾
      ctx.strokeStyle = OUT;
      ctx.lineWidth = lw * 2 + s * 0.014;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.142, y - s * 0.244);
      ctx.quadraticCurveTo(x + s * 0.186, y - s * 0.198, x + s * 0.168, y - s * 0.138);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(84,62,44,0.95)';
      ctx.lineWidth = s * 0.016;
      ctx.stroke();
    } else if (kind === 'sheep') {
      // 羊：最容易画坏的一个。三瓣羊毛各描一次边的话，后盖的前，
      // 出来是一颗**光溜溜的白豆** —— 缩到 0.743× 看着像一卷铺盖。
      // 换个做法：先把整坨羊毛当**一个**剪影描一遍深边，再填白，
      // 靠身子里面两道卷毛的暗线读出「这是羊毛」，不靠瓣和瓣之间的缝
      var fleece = [];
      fleece.push([x - s * 0.010, y - s * 0.228, s * 0.104, s * 0.090]);
      fleece.push([x + s * 0.070, y - s * 0.254, s * 0.110, s * 0.094]);
      fleece.push([x + s * 0.144, y - s * 0.222, s * 0.090, s * 0.082]);
      // 四条腿先画：压在羊毛下面，只露出下半截。**要够粗** ——
      // 细腿在这个尺寸上跟没有一样，四条深色的腿是羊身上最好认的一处
      bar(x - s * 0.078, y - s * 0.170, s * 0.034, s * 0.170);
      bar(x - s * 0.020, y - s * 0.170, s * 0.034, s * 0.170);
      bar(x + s * 0.058, y - s * 0.170, s * 0.034, s * 0.170);
      bar(x + s * 0.116, y - s * 0.170, s * 0.034, s * 0.170);
      // 剪影：深边比身子各大一圈
      ctx.fillStyle = OUT;
      ctx.beginPath();
      for (var fi = 0; fi < fleece.length; fi++) {
        ctx.moveTo(fleece[fi][0] + fleece[fi][2] + lw * 1.6, fleece[fi][1]);
        ctx.ellipse(fleece[fi][0], fleece[fi][1], fleece[fi][2] + lw * 1.6,
          fleece[fi][3] + lw * 1.6, 0, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.fillStyle = 'rgba(244,240,231,0.99)';
      ctx.beginPath();
      for (var fj = 0; fj < fleece.length; fj++) {
        ctx.moveTo(fleece[fj][0] + fleece[fj][2], fleece[fj][1]);
        ctx.ellipse(fleece[fj][0], fleece[fj][1], fleece[fj][2], fleece[fj][3], 0, 0, Math.PI * 2);
      }
      ctx.fill();
      // 脖子连着前胸：羊的前胸本来就是深色的，**这一块是「白里最深的一处」**。
      // 光靠头的话头只有五六像素，缩到 0.743× 就是一个黑点；
      // 有了这一整块深色，身子才不是一颗光豆
      ctx.fillStyle = 'rgba(60,50,42,0.97)';
      ctx.beginPath();
      ctx.ellipse(x - s * 0.052, y - s * 0.222, s * 0.066, s * 0.078, -0.22, 0, Math.PI * 2);
      ctx.fill();
      // 卷毛：两道短短的暗弧
      ctx.strokeStyle = 'rgba(150,140,126,0.92)';
      ctx.lineWidth = Math.max(1, s * 0.018);
      ctx.beginPath();
      ctx.arc(x + s * 0.006, y - s * 0.258, s * 0.056, 2.4, 4.5);
      ctx.arc(x + s * 0.140, y - s * 0.222, s * 0.048, 2.6, 4.6);
      ctx.stroke();
      // 头：**要整个露在羊毛外面**。埋进去的话就是一颗白豆上点了个黑点，
      // 看着像坏了而不是羊
      blob(x - s * 0.176, y - s * 0.252, s * 0.076, s * 0.066, -0.2, 'rgba(56,46,38,0.98)');
      blob(x - s * 0.148, y - s * 0.306, s * 0.040, s * 0.018, -0.5, 'rgba(56,46,38,0.98)');
      // 眼睛：一颗白点。整只羊从头到尾只有这一处亮点，
      // 有它才读得出朝哪儿看
      I.dot(ctx, x - s * 0.196, y - s * 0.262, s * 0.014, 'rgba(244,240,231,0.98)');
    } else {
      // 鸡：小，红冠是唯一一处亮色 —— 一堆褐色里它最好认
      bar(x - s * 0.026, y - s * 0.066, s * 0.012, s * 0.066);
      bar(x + s * 0.016, y - s * 0.066, s * 0.012, s * 0.066);
      blob(x, y - s * 0.104, s * 0.082, s * 0.066, -0.12, 'rgba(236,228,210,0.99)');
      // 尾
      ctx.beginPath();
      ctx.moveTo(x + s * 0.062, y - s * 0.126);
      ctx.lineTo(x + s * 0.122, y - s * 0.160);
      ctx.lineTo(x + s * 0.100, y - s * 0.088);
      ctx.closePath();
      ctx.strokeStyle = OUT; ctx.lineWidth = lw * 2; ctx.stroke();
      ctx.fillStyle = 'rgba(236,228,210,0.99)'; ctx.fill();
      blob(x - s * 0.066, y - s * 0.158, s * 0.044, s * 0.044, 0, 'rgba(236,228,210,0.99)');
      // 冠
      ctx.fillStyle = 'rgba(182,64,52,0.97)';
      ctx.beginPath();
      ctx.arc(x - s * 0.076, y - s * 0.198, s * 0.019, 0, Math.PI * 2);
      ctx.arc(x - s * 0.048, y - s * 0.202, s * 0.016, 0, Math.PI * 2);
      ctx.fill();
      // 喙
      ctx.beginPath();
      ctx.moveTo(x - s * 0.104, y - s * 0.156);
      ctx.lineTo(x - s * 0.140, y - s * 0.144);
      ctx.lineTo(x - s * 0.104, y - s * 0.132);
      ctx.closePath();
      ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.stroke();
      ctx.fillStyle = 'rgba(214,176,86,0.97)'; ctx.fill();
    }
    // 门关着的时候，牲口拴在棚柱上 —— 一根绳是「关着」的第二道信息，
    // 比门口那块小木板显眼得多，远一点也认得出。
    // 别拿一块半透明的灰去盖牲口：那看着像画糊了一块，不像「在棚里」
    if (pose && !pose.gate) {
      ctx.strokeStyle = OUT;
      ctx.lineWidth = lw * 2;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.156, y - s * 0.248);
      ctx.quadraticCurveTo(x - s * 0.250, y - s * 0.232, x - s * 0.312, y - s * 0.196);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(126,102,72,0.95)';
      ctx.lineWidth = s * 0.016;
      ctx.stroke();
    }
    ctx.restore();
  };

  /* 歇脚处：路边一块小碑 + 一截石阶。**没修路也照样画** ——
     它本来就在那儿，缺的是路不是碑。

     规矩跟代码画的建筑一样：实色分层，不靠半透明淡彩压浅色底图；
     碑身上那道深墨边是**必须**的 —— 浅沙色底图上一个浅色石碑看不见，
     而「这儿有个能按 E 的地方」是这一整项唯一的信息。 */
  /* 天色。整屏盖一层 rgba，颜色和浓淡都按钟插值 ——
     写死四段的话，一进薄暮整张画「啪」一下变色，
     玩家看不出那是几点了，只觉得画面坏了。
     硐里不盖：地下没有天光，硐自己的暗（mineDim）管那件事。 */
  I.sky = function (ctx, w, h, m) {
    var K = FG.LIGHT, i, a = K[0], b = K[K.length - 1], t;
    if (m <= K[0].m) { a = b = K[0]; t = 0; }
    else if (m >= K[K.length - 1].m) { a = b = K[K.length - 1]; t = 0; }
    else {
      for (i = 0; i < K.length - 1; i++) {
        if (m >= K[i].m && m <= K[i + 1].m) { a = K[i]; b = K[i + 1]; break; }
      }
      t = (b.m === a.m) ? 0 : (m - a.m) / (b.m - a.m);
    }
    var al = a.a + (b.a - a.a) * t;
    if (al <= 0.004) return 0;
    ctx.save();
    ctx.fillStyle = 'rgba('
      + Math.round(a.r + (b.r - a.r) * t) + ','
      + Math.round(a.g + (b.g - a.g) * t) + ','
      + Math.round(a.b + (b.b - a.b) * t) + ','
      + al.toFixed(3) + ')';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    return al;
  };

  /* 灯。画在色罩**之后** —— 它是这一片夜里唯一亮的东西，
     不该跟着一起被压暗，而压暗了就等于没点。
     一根深色的竿 + 一团暖光。竿要**比底图暗**（跟器物架同一条规矩），
     光团是全图唯一的亮色，所以它可以亮。
     amount = 夜色浓淡（0 = 天还亮着，1 = 熄灯），
     亮起来的程度按它走：天刚擦黑时火苗小，夜里火苗大。 */
  I.lamp = function (ctx, x, y, s, amount) {
    if (amount <= 0.02) return;
    var w = s * 0.30, h = s * 0.86;
    ctx.save();
    // 光：一团往外散开的暖色。画在竿**之前** ——
    // 光是从灯芯往外散，不是从杆子外头散
    var g = ctx.createRadialGradient(x, y - h * 0.78, s * 0.04, x, y - h * 0.78, s * 0.78);
    g.addColorStop(0, 'rgba(255,226,158,' + (0.50 * amount).toFixed(3) + ')');
    g.addColorStop(0.42, 'rgba(246,196,110,' + (0.22 * amount).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(232,168,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y - h * 0.78, s * 0.78, 0, Math.PI * 2);
    ctx.fill();
    // 竿：一根很深的细杆，比底图暗
    ctx.fillStyle = 'rgba(38,32,26,0.90)';
    ctx.fillRect(x - w * 0.11, y - h * 0.74, w * 0.22, h * 0.74);
    // 灯罩：一个小小的方灯笼
    ctx.fillStyle = 'rgba(70,54,38,0.94)';
    ctx.fillRect(x - w * 0.52, y - h * 0.96, w * 1.04, h * 0.24);
    ctx.strokeStyle = 'rgba(30,24,18,0.92)'; ctx.lineWidth = Math.max(1, s * 0.020);
    ctx.strokeRect(x - w * 0.52, y - h * 0.96, w * 1.04, h * 0.24);
    // 灯芯：那一点最亮的黄
    ctx.fillStyle = 'rgba(255,236,180,' + (0.88 * amount).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(x, y - h * 0.84, s * 0.055 * (0.7 + 0.3 * amount), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /* 再生作物的留茬。**只画在畦上，不画在别的任何地方** ——
     它要说的事只有一件：「这畦割过了，还能割」。别的地方画一排短草，
     玩家只会当成刚出苗的新苗，而那看起来是「还要从头等」，
     跟这行代码要说的正相反。
     画法：割口那一侧压一道深（割面），另一侧留几根直茬，
     茬比苗矮、比地深 —— 三个关系缺一个就画不成「割过」。 */
  /* 再生作物的留茬。**只画在畦上，不画在别的任何地方** ——
     它要说的事只有一件：「这畦割过了，还能割」。别的地方画一排短草，
     玩家只会当成刚出苗的新苗，而那看起来是「还要从头等」，
     跟这行代码要说的正相反。
     画法：割面压在近缘那一侧，竖着留几根直茬 ——
     茬比苗矮、比地深，三个关系缺一个就画不成「割过」。

     q 是**四个角点**（F.cellQuad 给的就是这个形），不是 [x0,y0,x1,y1]。
     早先照着后者写，算出来的中心是 NaN —— canvas 静默忽略 NaN 坐标，
     于是每一帧都「画了」，而画面上什么都没有，也不报一句错。 */
  I.stubble = function (ctx, q, fresh) {
    var cx = (q[0][0] + q[2][0]) / 2;
    var w = Math.abs(q[2][0] - q[0][0]) * 0.70;
    var bot = Math.max(q[0][1], q[1][1], q[2][1], q[3][1]);   // 近缘那条边
    var top = Math.min(q[0][1], q[1][1], q[2][1], q[3][1]);
    var h = (bot - top) * 0.46;
    var yb = bot - h * 0.34;    // 割面靠近缘
    ctx.save();
    // 割面：一道压得很深的横带
    ctx.fillStyle = 'rgba(86,68,48,0.62)';
    ctx.fillRect(cx - w / 2, yb, w, Math.max(1, h * 0.20));
    // 直茬：几根短短的竖笔，越往远越矮
    ctx.strokeStyle = 'rgba(104,84,56,0.75)';
    ctx.lineWidth = Math.max(1, w * 0.026);
    ctx.lineCap = 'butt';
    for (var i = 0; i < 7; i++) {
      var t = (i + 0.5) / 7;
      var x = cx - w / 2 + w * t;
      var hh = h * (0.30 + 0.14 * (1 - t));
      ctx.beginPath();
      ctx.moveTo(x, yb + h * 0.20);
      ctx.lineTo(x, yb + h * 0.20 - hh);
      ctx.stroke();
    }
    // 新一茬刚起来的话，在茬中间点几笔极矮的绿 —— 有对比才看得出「又长了」
    if (fresh) {
      ctx.strokeStyle = 'rgba(126,148,96,0.72)';
      ctx.lineWidth = Math.max(1, w * 0.020);
      for (var j = 0; j < 4; j++) {
        var t2 = (j + 0.5) / 4;
        var x2 = cx - w / 2 + w * t2;
        ctx.beginPath();
        ctx.moveTo(x2, yb + h * 0.20);
        ctx.lineTo(x2, yb + h * 0.20 - h * 0.15);
        ctx.stroke();
      }
    }
    ctx.restore();
  };
  I.stationMark = function (ctx, x, y, s, name) {
    ctx.save();
    ctx.lineJoin = 'round';
    var OUT = 'rgba(46,38,32,0.90)';
    // 影子
    ctx.fillStyle = 'rgba(78,62,48,0.30)';
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.30, s * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
    // 三级石阶：一级比一级窄，往上是碑
    var st = [[0.34, 0.040], [0.26, 0.034], [0.19, 0.028]], i;
    for (i = 0; i < st.length; i++) {
      ctx.fillStyle = OUT;
      ctx.fillRect(x - s * st[i][0] - s * 0.012, y - s * (st[i][1] + 0.010) - s * 0.010,
        s * st[i][0] * 2 + s * 0.024, s * st[i][1] + s * 0.012);
      ctx.fillStyle = i === 2 ? 'rgba(158,148,130,0.96)' : 'rgba(186,176,156,0.96)';
      ctx.fillRect(x - s * st[i][0], y - s * (st[i][1] + 0.010), s * st[i][0] * 2, s * st[i][1]);
    }
    // 碑：立着的一块，顶上收窄
    var bw = s * 0.115, by = y - s * 0.070, bh = s * 0.30;
    ctx.beginPath();
    ctx.moveTo(x - bw, by);
    ctx.lineTo(x - bw * 0.72, by - bh);
    ctx.lineTo(x + bw * 0.72, by - bh);
    ctx.lineTo(x + bw, by);
    ctx.closePath();
    ctx.fillStyle = 'rgba(138,126,106,0.97)';
    ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, s * 0.022); ctx.stroke();
    // 碑上那一道刻的字：一根竖着的深墨
    ctx.fillStyle = 'rgba(52,44,36,0.85)';
    ctx.fillRect(x - s * 0.016, by - bh * 0.74, s * 0.032, bh * 0.52);
    // 旁边一小丛草：跟底图的水墨点苔接上
    I.dot(ctx, x + bw * 1.9, y - s * 0.020, s * 0.034, I.QING, 0.46);
    I.dot(ctx, x - bw * 2.1, y - s * 0.014, s * 0.028, I.QING, 0.38);
    ctx.restore();
  };

  /* 温窒：一间玻璃房。
     它跟鸡舍牛棚不一样 —— **它不装东西**，它是一间房：
     建成了，藏季那 36 天的地就不是冻的了（判据在 game.js 的 groundFrozenNow）。

     画法：实色分层 + 一道深墨框。**玻璃不能画成半透明** ——
     底图是浅草坡，一块淡蓝压上去就是一块淡蓝，而「这儿有间房」这条信息
     一点没传出去。玻璃靠**框和格**读出来：深色的木框把一片浅色夹住，
     那一片浅色才是玻璃。 */
  I.warm = function (ctx, x, y, s, lv) {
    ctx.save();
    ctx.lineJoin = 'round';
    var OUT = 'rgba(46,38,32,0.92)';
    var w = s * 0.62, h = s * 0.40, wallH = s * 0.26;
    var eL = x - w, eR = x + w, top = y - s * 0.52;
    // 影子
    ctx.fillStyle = 'rgba(78,62,48,0.32)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.03, w * 1.08, s * 0.075, 0, 0, Math.PI * 2);
    ctx.fill();
    if (lv <= 0) {
      // 还没造：四根立柱的位置 + 一小片夯土。不画房子 —— 没造的东西不该有个顶在那儿
      ctx.strokeStyle = 'rgba(104,82,58,0.92)';
      ctx.lineWidth = Math.max(1, s * 0.030);
      for (var i = -1; i <= 1; i++) {
        var px = x + i * w * 0.82;
        ctx.beginPath();
        ctx.moveTo(px, y); ctx.lineTo(px - s * 0.01, y - s * (0.30 + (i ? 0.04 : 0)));
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(196,182,158,0.80)';
      ctx.beginPath();
      ctx.ellipse(x, y, w * 0.86, s * 0.055, 0, 0, Math.PI * 2);
      ctx.fill();
      I.dot(ctx, x - w * 0.62, y - s * 0.02, s * 0.034, I.QING, 0.46);
      ctx.restore();
      return;
    }
    // 地：夯土一块
    ctx.fillStyle = 'rgba(186,170,144,0.96)';
    ctx.fillRect(eL - s * 0.04, y - s * 0.045, (eR - eL) + s * 0.08, s * 0.045);
    // 玻璃墙：**压得比底图暗一档**，不是比它亮。
    // 浅草坡上放一片浅蓝等于没放 —— 玻璃读出来靠的是它比周围**深**，
    // 加上外面那道深框把这一片夹住。亮的那一档留给顶，因为顶有天空背着
    ctx.fillStyle = 'rgba(176,198,196,0.96)';
    ctx.fillRect(eL, y - wallH, eR - eL, wallH);
    // 墙里三道竖棂 + 一道横档：玻璃之所以是玻璃，全靠这几根
    ctx.strokeStyle = OUT;
    ctx.lineWidth = Math.max(1, s * 0.030);
    for (var g = 1; g < 4; g++) {
      var gx = eL + (eR - eL) * g / 4;
      ctx.beginPath();
      ctx.moveTo(gx, y - wallH); ctx.lineTo(gx, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(eL, y - wallH * 0.52); ctx.lineTo(eR, y - wallH * 0.52);
    ctx.stroke();
    // 里面一畦土 + 几行苗。**这间房跟别的营造最要紧的差别就在这儿** ——
    // 鸡舍牛棚是空的，这间里有东西在长。
    // 苗不能画成绿压绿（青绿压在灰绿的玻璃上就是没有），
    // 也不能被门盖住：门挪到左边，右边整块留给苗床
    var bedL = x - w * 0.06, bedR = eR - s * 0.02;
    ctx.fillStyle = 'rgba(112,92,68,0.96)';
    ctx.fillRect(bedL, y - wallH * 0.30, bedR - bedL, wallH * 0.30);
    for (var sd = 0; sd < 5; sd++) {
      var sx2 = bedL + (bedR - bedL) * (0.12 + sd * 0.19);
      ctx.strokeStyle = 'rgba(74,104,68,0.95)';
      ctx.lineWidth = Math.max(1, s * 0.022);
      ctx.beginPath();
      ctx.moveTo(sx2, y - wallH * 0.30);
      ctx.lineTo(sx2 - s * 0.010, y - wallH * 0.76);
      ctx.stroke();
      I.dot(ctx, sx2 - s * 0.014, y - wallH * 0.80, s * 0.030, I.QING, 0.90);
    }
    // 顶：两坡的玻璃瓦，深框
    ctx.fillStyle = 'rgba(206,224,222,0.96)';
    ctx.beginPath();
    ctx.moveTo(eL - s * 0.10, top + s * 0.10);
    ctx.lineTo(x, top);
    ctx.lineTo(eR + s * 0.10, top + s * 0.10);
    ctx.lineTo(eR, y - wallH);
    ctx.lineTo(eL, y - wallH);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, s * 0.038); ctx.stroke();
    // 脊上那一道亮
    ctx.fillStyle = 'rgba(246,250,246,0.85)';
    ctx.fillRect(x - s * 0.03, top - s * 0.012, s * 0.06, s * 0.024);
    // 墙外面那一圈框
    ctx.strokeStyle = OUT;
    ctx.lineWidth = Math.max(1, s * 0.042);
    ctx.strokeRect(eL, y - wallH, eR - eL, wallH);
    // 门：靠**左边**那一扇。挪开是因为右边要让给苗床 ——
    // 门压在正中间的时候苗床只能分成两半窄条，1× 下那两半看着像门框上的脏
    var dw2 = s * 0.105, dx2 = eL + s * 0.055;
    ctx.fillStyle = 'rgba(52,40,32,0.96)';
    ctx.fillRect(dx2, y - wallH * 0.74, dw2, wallH * 0.74);
    // 里面透出的一点暖：灶火那点黄。**这是这间房唯一的暖色** ——
    // 一间暖房在雪地里站着，读出来的就该是「里面不冷」
    I.dot(ctx, dx2 + dw2 * 0.5, y - wallH * 0.30, s * 0.040, 'rgba(230,182,92,0.95)');
    // 顶上两撮点苔，跟底图的水墨点苔接上
    I.dot(ctx, eL + s * 0.06, top + s * 0.06, s * 0.030, I.QING, 0.46);
    I.dot(ctx, eR - s * 0.10, top + s * 0.04, s * 0.026, I.QING, 0.38);
    ctx.restore();
  };

  /* 罐子这一族的三种器形。三样并排摆的时候，剪影必须三个都不一样 ——
     规矩跟别的代码画建筑一样：实色 + 一道深墨边，靠明暗分前后，不靠半透明。 */
  // 瓶：矮、肩圆、瓶口蒙布（果酱瓶）
  // 玻璃**压得比底图暗**（老绿瓶），不是比它亮 —— 浅草坡上放一只浅瓶子等于没放。
  // 而且它是**装满**的一瓶酱：酱身占着几乎整个瓶肚，
  // 一只空瓶在 1× 下就是一块淡影，装满了才有「这里面有东西」
  I.bottle = function (ctx, x, y, s, lv, job) {
    var w = s * (lv > 1 ? 0.40 : 0.33), h = s * 0.40, OUT = 'rgba(46,38,32,0.92)';
    ctx.save();
    I.wash(ctx, x, y + s * 0.02, w * 0.66, s * 0.06, 'rgba(58,48,38,', 0.22);
    ctx.fillStyle = 'rgba(122,138,120,0.96)';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.40, y - h * 0.72);
    ctx.quadraticCurveTo(x - w * 1.00, y - h * 0.30, x - w * 0.78, y);
    ctx.lineTo(x + w * 0.78, y);
    ctx.quadraticCurveTo(x + w * 1.00, y - h * 0.30, x + w * 0.40, y - h * 0.72);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, s * 0.026); ctx.stroke();
    // 酱：占着瓶肚的大半
    ctx.fillStyle = 'rgba(126,54,72,0.95)';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.88, y - h * 0.30);
    ctx.quadraticCurveTo(x - w * 0.92, y - h * 0.10, x - w * 0.70, y);
    ctx.lineTo(x + w * 0.70, y);
    ctx.quadraticCurveTo(x + w * 0.92, y - h * 0.10, x + w * 0.88, y - h * 0.30);
    ctx.closePath(); ctx.fill();
    // 瓶肩那一线：玻璃还看得见
    ctx.strokeStyle = 'rgba(176,196,176,0.85)'; ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.beginPath();
    ctx.moveTo(x - w * 0.70, y - h * 0.56); ctx.quadraticCurveTo(x, y - h * 0.34, x + w * 0.70, y - h * 0.56);
    ctx.stroke();
    // 瓶口一块布
    ctx.fillStyle = 'rgba(226,218,200,0.96)';
    ctx.fillRect(x - w * 0.52, y - h * 0.92, w * 1.04, h * 0.22);
    ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, s * 0.020);
    ctx.strokeRect(x - w * 0.52, y - h * 0.92, w * 1.04, h * 0.22);
    if (job) {
      ctx.fillStyle = 'rgba(232,226,212,0.96)';
      ctx.beginPath();
      ctx.moveTo(x - w * 0.16, y - h * 1.00);
      ctx.lineTo(x + w * 0.16, y - h * 1.00);
      ctx.lineTo(x + w * 0.12, y - h * 1.16);
      ctx.lineTo(x - w * 0.12, y - h * 1.16);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, s * 0.020); ctx.stroke();
    }
    ctx.restore();
  };
  // 罐：束口、直身、颈上一圈绳（奶罐）
  I.canister = function (ctx, x, y, s, lv, job) {
    var w = s * (lv > 1 ? 0.40 : 0.33), h = s * 0.48, OUT = 'rgba(46,38,32,0.92)';
    ctx.save();
    I.wash(ctx, x, y + s * 0.02, w * 0.60, s * 0.06, 'rgba(58,48,38,', 0.22);
    ctx.fillStyle = 'rgba(178,166,142,0.96)';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.50, y - h * 0.70);
    ctx.lineTo(x - w * 0.44, y);
    ctx.lineTo(x + w * 0.44, y);
    ctx.lineTo(x + w * 0.50, y - h * 0.70);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, s * 0.026); ctx.stroke();
    // 束口 + 绳
    ctx.fillStyle = 'rgba(150,136,112,0.96)';
    ctx.fillRect(x - w * 0.60, y - h * 0.88, w * 1.20, h * 0.18);
    ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, s * 0.022);
    ctx.strokeRect(x - w * 0.60, y - h * 0.88, w * 1.20, h * 0.18);
    ctx.strokeStyle = 'rgba(96,80,60,0.95)'; ctx.lineWidth = Math.max(1, s * 0.022);
    ctx.beginPath();
    ctx.moveTo(x - w * 0.34, y - h * 0.88); ctx.lineTo(x - w * 0.34, y - h * 0.70);
    ctx.moveTo(x + w * 0.34, y - h * 0.88); ctx.lineTo(x + w * 0.34, y - h * 0.70);
    ctx.stroke();
    // 底下一道盐色：奶罐垫着盐
    ctx.fillStyle = 'rgba(226,222,206,0.85)';
    ctx.fillRect(x - w * 0.42, y - h * 0.16, w * 0.84, h * 0.14);
    if (job) {
      ctx.fillStyle = 'rgba(232,226,212,0.96)';
      ctx.beginPath();
      ctx.moveTo(x - w * 0.14, y - h * 1.02);
      ctx.lineTo(x + w * 0.14, y - h * 1.02);
      ctx.lineTo(x + w * 0.10, y - h * 1.18);
      ctx.lineTo(x - w * 0.10, y - h * 1.18);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, s * 0.020); ctx.stroke();
    }
    ctx.restore();
  };
  // 深口坛：小、圆、坛口一汪深色（鱼露坛）
  I.deepJar = function (ctx, x, y, s, lv, job) {
    var w = s * (lv > 1 ? 0.36 : 0.30), h = s * 0.34, OUT = 'rgba(46,38,32,0.92)';
    ctx.save();
    I.wash(ctx, x, y + s * 0.02, w * 0.60, s * 0.05, 'rgba(58,48,38,', 0.22);
    ctx.fillStyle = 'rgba(70,66,62,0.96)';
    ctx.beginPath();
    ctx.ellipse(x, y - h * 0.30, w * 0.94, h * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, s * 0.026); ctx.stroke();
    // 坛口一汪：深色 + 一点亮边
    ctx.fillStyle = 'rgba(38,34,30,0.96)';
    ctx.beginPath(); ctx.ellipse(x, y - h * 0.86, w * 0.60, h * 0.24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(198,152,86,0.80)';
    ctx.beginPath(); ctx.ellipse(x - w * 0.08, y - h * 0.86, w * 0.34, h * 0.13, 0, 0, Math.PI * 2); ctx.fill();
    if (job) {
      ctx.fillStyle = 'rgba(232,226,212,0.96)';
      ctx.beginPath();
      ctx.moveTo(x - w * 0.14, y - h * 1.06);
      ctx.lineTo(x + w * 0.14, y - h * 1.06);
      ctx.lineTo(x + w * 0.10, y - h * 1.22);
      ctx.lineTo(x - w * 0.10, y - h * 1.22);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, s * 0.020); ctx.stroke();
    }
    ctx.restore();
  };

  /* 狗窝。一个矮檐的草棚，窝边**摆着狗叼回来的东西** ——
     那个数是这一项唯一的信息（「E 收下」写在窝边上，不是画在狗身上），
     所以它得数得清：三样摆三堆，一样就一堆。
     狗本身**不画**：它不在窝边的时候（这是它一天里大半的时候），
     一个画在原地不动的狗就是一只假狗。 */
  I.dogHouse = function (ctx, x, y, s, lv, pose) {
    ctx.save();
    ctx.lineJoin = 'round';
    var OUT = 'rgba(46,38,32,0.92)';
    var w = s * 0.42, h = s * 0.26;
    if (lv <= 0) {
      // 没造：两捆旧草和一块压着的石头
      ctx.fillStyle = 'rgba(186,170,140,0.94)';
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.05, w * 0.80, s * 0.10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, s * 0.024); ctx.stroke();
      I.dot(ctx, x - w * 0.3, y - s * 0.06, s * 0.05, 'rgba(150,150,146,0.92)');
      ctx.restore();
      return;
    }
    // 影子
    ctx.fillStyle = 'rgba(78,62,48,0.30)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.02, w * 0.92, s * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    // 窝身：草编的矮棚
    ctx.fillStyle = 'rgba(158,134,92,0.96)';
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.lineTo(x - w * 0.86, y - h);
    ctx.lineTo(x + w * 0.86, y - h);
    ctx.lineTo(x + w, y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, s * 0.028); ctx.stroke();
    // 编纹：三道横的
    ctx.strokeStyle = 'rgba(112,92,62,0.80)'; ctx.lineWidth = Math.max(1, s * 0.020);
    for (var i = 1; i < 4; i++) {
      var yy = y - h * i / 4;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.94, yy); ctx.lineTo(x + w * 0.94, yy);
      ctx.stroke();
    }
    // 窝口：一个深色的口
    ctx.fillStyle = 'rgba(44,36,28,0.95)';
    ctx.beginPath();
    ctx.ellipse(x, y - h * 0.16, w * 0.46, h * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    // 窝边摆着的东西：**一堆一个数**，堆三样就是三堆。
    // 摆在**窝前**（y 往下）而不是窝左边：左边是玩家走过来的方向，
    // 人一站就把那几堆盖住了 —— 而「有几堆」正是这一项唯一的信息。
    // 直径要够大：0.05s 那一版在 1× 下是三个点，摊开数不出是三
    var n = (pose && pose.n) || 0;
    for (var j = 0; j < Math.min(n, 3); j++) {
      var px = x - s * 0.20 + j * s * 0.20, py = y + s * 0.075;
      ctx.fillStyle = OUT;
      ctx.beginPath(); ctx.ellipse(px, py + s * 0.016, s * 0.105, s * 0.062, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = j === 0 ? 'rgba(168,72,62,0.98)' : (j === 1 ? 'rgba(152,128,70,0.98)' : 'rgba(86,128,90,0.98)');
      ctx.beginPath(); ctx.ellipse(px, py, s * 0.086, s * 0.048, 0, 0, Math.PI * 2); ctx.fill();
    }
    I.dot(ctx, x + w * 0.74, y - s * 0.020, s * 0.034, I.QING, 0.46);
    ctx.restore();
  };

  /* 蜂窠：**一层层叠起来的巢箱**，不是一口筐。
     第一版画的是「方的筐 + 两副巢框」—— 1× 下那个读出来是一块浅色方板加网格，
     像门上挂了块牌子，而不是个能认出是蜂箱的东西。
     蜂箱真正认得出来的是**横着一层层垒上去的箱子**（朗氏箱就是这个形），
     远看三条深横带就够，所以剪影改成一摞：一级三层、二级四层。
     规矩跟坛/瓶/罐同一族，还多一条：**必须比底图暗**。
     南山那片坡是整张图里最淡的一块（远山雾里），
     筐身原来用 rgba(172,142,96) 正好压在上面 —— 亮的东西放在浅底上等于没画。
     现在筐身压到 rgba(132,106,70)、缝压到墨色、盖板最深。 */
  I.hive = function (ctx, x, y, s, lv, job) {
    ctx.save();
    ctx.lineJoin = 'round';
    var OUT = 'rgba(38,30,24,0.94)';
    var WOOD = 'rgba(132,106,70,0.97)';      // 箱板：比那片坡暗一大截
    var WOOD2 = 'rgba(158,130,88,0.97)';     // 迎光那一面
    var SEAM = 'rgba(38,30,24,0.88)';        // 层与层之间那道缝
    var lw = Math.max(1, s * 0.026);
    var bw = s * 0.30;                       // 箱宽
    var bh = s * 0.135;                      // 每层高
    var lay = lv > 1 ? 4 : 3;
    var topY = y - s * 0.30;                  // 最上一层上沿
    // 影子：先铺一层，落在坡上
    ctx.fillStyle = 'rgba(58,48,38,0.24)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.012, bw * 1.18, s * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
    // 架：两条短腿，把箱子抬离地 —— 蜂箱不落地是它的常态
    ctx.fillStyle = 'rgba(74,58,42,0.95)';
    ctx.fillRect(x - bw * 0.72, y - s * 0.055, s * 0.055, s * 0.055);
    ctx.fillRect(x + bw * 0.72 - s * 0.055, y - s * 0.055, s * 0.055, s * 0.055);
    // 一层一层往上垒。每层**上窄下宽**一点点，叠起来才像个箱子而不像个柜子
    for (var i = 0; i < lay; i++) {
      var t = i / (lay - 1);
      var k = 1 - t * 0.13;                   // 越上层越窄
      var lw2 = bw * k;
      var ly = y - s * 0.055 - (i + 1) * bh;
      ctx.fillStyle = i % 2 ? WOOD2 : WOOD;  // 相邻两层错开一点色，看得出是叠的
      ctx.fillRect(x - lw2, ly, lw2 * 2, bh);
      ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.strokeRect(x - lw2, ly, lw2 * 2, bh);
      // 层缝：一条压得很深的横带。这是「一层一层」的全部信息
      ctx.fillStyle = SEAM;
      ctx.fillRect(x - lw2, ly + bh - s * 0.020, lw2 * 2, s * 0.020);
    }
    // 盖板：最深的一块，压在顶上一层上头
    var capW = bw * (1 - 0.13) * 1.16;
    var capY = topY - s * 0.045;
    ctx.fillStyle = 'rgba(86,66,48,0.97)';
    ctx.fillRect(x - capW, capY, capW * 2, s * 0.048);
    ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.strokeRect(x - capW, capY, capW * 2, s * 0.048);
    // 巢门：最底下一层正中那道黑口子。「里头住着蜂」全靠它
    ctx.fillStyle = 'rgba(30,24,18,0.92)';
    ctx.fillRect(x - bw * 0.30, y - s * 0.055 - bh + bh * 0.34, bw * 0.60, bh * 0.40);
    // 蜂：三只在箱边绕着的深点。给「这是活的」一个记号
    var bees = [[-1.22, -0.16], [1.26, -0.10], [1.02, -0.34]];
    for (var b = 0; b < bees.length; b++) {
      ctx.fillStyle = 'rgba(44,34,22,0.88)';
      ctx.beginPath();
      ctx.arc(x + bees[b][0] * bw, y + bees[b][1] * s, s * 0.030, 0, Math.PI * 2);
      ctx.fill();
    }
    // 蜜：沿箱边淌下来的一道亮 —— 整只窠上唯一亮的地方
    ctx.fillStyle = 'rgba(206,150,44,0.95)';
    ctx.fillRect(x + bw * 0.66, y - s * 0.055 - bh * 1.6, s * 0.048, bh * 1.35);
    if (job) {
      // 正在酿：顶上盖一口盖布
      ctx.fillStyle = 'rgba(226,220,206,0.96)';
      ctx.beginPath();
      ctx.moveTo(x - s * 0.115, capY - s * 0.012);
      ctx.lineTo(x + s * 0.115, capY - s * 0.012);
      ctx.lineTo(x + s * 0.080, capY - s * 0.150);
      ctx.lineTo(x - s * 0.080, capY - s * 0.150);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.stroke();
    }
    ctx.restore();
  };

  /* 水渠。lv 0 = 还没挖：两道浅沟的印子。
     lv 1 = 竹槽，一道深色的竹管从坡上斜下来；lv 2 = 石砌，一段有块面的坎。 */
  I.ditch = function (ctx, x, y, s, lv) {
    ctx.save();
    if (!lv) {
      // 没挖：两道平行的浅沟，中间是还没起作用的土埂
      I.brush(ctx, [[x - s * 0.86, y - s * 0.16], [x - s * 0.10, y - s * 0.06]],
        s * 0.022, s * 0.022, I.INK_SOFT, 0.55);
      I.brush(ctx, [[x - s * 0.80, y - s * 0.02], [x - s * 0.04, y + s * 0.06]],
        s * 0.020, s * 0.020, I.INK_SOFT, 0.45);
      I.dot(ctx, x - s * 0.44, y - s * 0.12, s * 0.026, I.QING, 0.40);
      ctx.restore();
      return;
    }
    var thick = lv > 1 ? 0.20 : 0.13;
    // 渠坎：一道斜着下来的实心横带。斜的才读得出「水从高处来」
    ctx.fillStyle = lv > 1 ? 'rgba(104,100,94,0.95)' : 'rgba(126,102,72,0.95)';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.90, y - s * 0.30);
    ctx.lineTo(x + s * 0.86, y - s * 0.02);
    ctx.lineTo(x + s * 0.86, y + s * thick);
    ctx.lineTo(x - s * 0.90, y + s * (thick - 0.26));
    ctx.closePath();
    ctx.fill();
    // 水面：压在坎上的一道亮。亮的那条要是跟坎一样宽，读出来就是一根白杠
    ctx.fillStyle = 'rgba(176,206,208,0.92)';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.80, y - s * 0.225);
    ctx.lineTo(x + s * 0.78, y + s * 0.020);
    ctx.lineTo(x + s * 0.78, y + s * (thick * 0.46 + 0.020));
    ctx.lineTo(x - s * 0.80, y - s * 0.225 + s * thick * 0.46);
    ctx.closePath();
    ctx.fill();
    if (lv > 1) {
      // 石砌：几道分明的石缝压着坎身，不是一根光管
      ctx.strokeStyle = 'rgba(38,34,30,0.45)';
      ctx.lineWidth = Math.max(1, s * 0.016);
      for (var i = 0; i < 5; i++) {
        var t = -0.74 + i * 0.36;
        ctx.beginPath();
        ctx.moveTo(x + s * t, y - s * 0.250 + t * s * 0.22);
        ctx.lineTo(x + s * t, y + s * (thick + 0.08) + t * s * 0.22);
        ctx.stroke();
      }
    }
    // 出水口：几撮溅开的水点，交代「水真的出去了」
    I.dot(ctx, x + s * 0.92, y + s * 0.07, s * 0.038, I.HUA, 0.55);
    I.dot(ctx, x + s * 1.02, y + s * 0.13, s * 0.026, I.HUA, 0.40);
    ctx.restore();
  };

  /* 坛。空坛是敞口的，腌着东西就封上盖、再压一道泥 ——
     「封上了」这三个字玩家一眼能看出来：东西在里面，在等天数。

     罐子这一族（果酱瓶 / 奶罐 / 鱼露坛）**不能都画成坛**：
     三样封口罐摆在一起、剪影还是同一个，那是三间一样的屋。
     按 kind 分三种器形：瓶（矮、肩圆）、罐（束口、直身）、坛（敞口、鼓腹）。 */
  I.machine = function (ctx, x, y, s, lv, job, kind) {
    if (kind === 'ping') return I.bottle(ctx, x, y, s, lv, job);
    if (kind === 'guan') return I.canister(ctx, x, y, s, lv, job);
    if (kind === 'yutang') return I.deepJar(ctx, x, y, s, lv, job);
    if (kind === 'hive') return I.hive(ctx, x, y, s, lv, job);
    var w = s * (lv > 1 ? 0.46 : 0.36), h = s * 0.50;
    ctx.save();
    // 影子
    I.wash(ctx, x, y + s * 0.02, w * 0.62, s * 0.07, 'rgba(58,48,38,', 0.22);
    // 坛身：肩宽底窄的那种陶坛
    ctx.fillStyle = 'rgba(140,102,72,0.95)';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.42, y - h);
    ctx.lineTo(x + w * 0.42, y - h);
    ctx.lineTo(x + w * 0.50, y - h * 0.34);
    ctx.lineTo(x + w * 0.40, y);
    ctx.lineTo(x - w * 0.40, y);
    ctx.lineTo(x - w * 0.50, y - h * 0.34);
    ctx.closePath();
    ctx.fill();
    // 腹部一道亮：陶面反光，读出是个圆的东西
    ctx.fillStyle = 'rgba(184,146,104,0.55)';
    ctx.beginPath();
    ctx.ellipse(x - w * 0.10, y - h * 0.52, w * 0.16, h * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    if (lv <= 0) {
      // 还没买：坛口敞着，里面空的
      ctx.fillStyle = 'rgba(34,28,22,0.92)';
      ctx.beginPath();
      ctx.ellipse(x, y - h, w * 0.40, s * 0.055, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (job) {
      // 腌着：口上压了盖和一道泥
      ctx.fillStyle = 'rgba(160,132,92,0.95)';
      ctx.beginPath();
      ctx.ellipse(x, y - h, w * 0.42, s * 0.060, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,100,74,0.95)';
      ctx.fillRect(x - w * 0.44, y - h - s * 0.03, w * 0.88, s * 0.030);
    } else {
      // 空坛：口上盖着盖，但没封（没料）
      ctx.fillStyle = 'rgba(150,124,88,0.95)';
      ctx.beginPath();
      ctx.ellipse(x, y - h, w * 0.40, s * 0.055, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  /* ---------------- 物品图标 ----------------
     背包每一格都要一个能一眼认出来的图，所以这里按「形状族」而不是按物品
     各画一个：谷物全是束、种子全是袋、鱼全是鱼形，只是颜色和头形不同。
     每格只有 26px 上下，细节画了也看不见，还容易糊成一坨 ——
     区分靠的是**轮廓**，不是笔触。

     ctx 是一个独立的小画布（不是画面那个），坐标就是格子中心。 */
  I.icon = function (ctx, key, cx, cy, s) {
    var x = cx, y = cy, u = s * 0.5;
    ctx.save();
    ctx.translate(x, y);
    if (key.indexOf('seed') === 0) { I.icPouch(ctx, u, FG_SEED_TINT(key)); }
    else if (key.indexOf('crop_') === 0) { I.icSheaf(ctx, u, key.slice(5)); }
    else if (key.indexOf('fish_') === 0) { I.icFish(ctx, u, key.slice(5)); }
    else if (key.indexOf('good_') === 0) { I.icGood(ctx, u, key.slice(5)); }
    else if (key === 'jiu') { I.icJar(ctx, u); }
    else if (key === 'chu' || key === 'piao') { I.icTool(ctx, u, key); }
    // 加工品和矿砂都按 data.js 里的 kind 分派，不在这里抄一份名单 ——
    // 抄一份的话，以后往 FG.RECIPES 里加一条配方、或往 FG.ORE 里加一种矿，
    // 这边会安静地落进兜底分支，画出来是个种子袋，
    // 而画面上看不出任何东西不对
    else if (FG.BAG_IDX && FG.BAG_IDX[key] && FG.BAG_IDX[key].kind === 'made') { I.icMade(ctx, u, key); }
    else if (FG.BAG_IDX && FG.BAG_IDX[key] && FG.BAG_IDX[key].kind === 'ore') { I.icOre(ctx, u, FG.BAG_IDX[key].src); }
    else { I.icPouch(ctx, u, I.INK_SOFT); }
    ctx.restore();
  };

  function FG_SEED_TINT(key) {
    // 种子袋上的那一点，是「这袋里是哪一路的种」
    if (key === 'seedD') return I.QING;
    if (key === 'seedS') return I.TENG;
    if (key === 'seedSh') return I.ZHE;
    if (key === 'seedJ') return I.CLU_D;
    return I.DOU;                       // 菊种
  }

  /* 谷物：一束扎住的禾。头形按作物分 —— 豆是圆的、粟是垂的、黍是散帚、
     菊是个球。花头那一笔是全部区别所在。 */
  I.icSheaf = function (ctx, u, crop) {
    var i, ax;
    for (i = -1; i <= 1; i++) {
      ax = i * u * 0.26;
      I.brush(ctx, [[ax * 0.35, u * 0.62], [ax, -u * 0.10], [ax * 1.15, -u * 0.52]],
        u * 0.075, u * 0.030, I.CLU_D, 0.85);
    }
    // 扎绳
    I.brush(ctx, [[-u * 0.22, u * 0.26], [u * 0.22, u * 0.24]], u * 0.055, u * 0.055, I.ZHE, 0.8);
    if (crop === 'dou') {                       // 豆荚：短而鼓，两粒
      I.dot(ctx, -u * 0.18, -u * 0.56, u * 0.17, I.QING, 0.85);
      I.dot(ctx, u * 0.18, -u * 0.50, u * 0.17, I.QING, 0.85);
    } else if (crop === 'ju') {                 // 菊：一个圆球加几瓣
      I.dot(ctx, 0, -u * 0.56, u * 0.26, I.TENG, 0.75);
      for (i = 0; i < 5; i++) {
        var a = -Math.PI * 0.9 + i * 0.42;
        I.dot(ctx, Math.cos(a) * u * 0.30, -u * 0.56 + Math.sin(a) * u * 0.30, u * 0.11, I.DOU, 0.9);
      }
    } else if (crop === 'shu') {                // 黍：散开的帚
      for (i = 0; i < 5; i++) {
        ax = (i - 2) * u * 0.16;
        I.brush(ctx, [[ax, -u * 0.08], [ax * 1.9, -u * 0.66]], u * 0.030, u * 0.010, I.TENG, 0.85);
      }
    } else if (crop === 'ji') {                 // 稷：一根直立的密穗。
      // 和黍分开的关键在轮廓：黍是散开的帚，稷是收拢的棒。
      // 两者第一版都画成「五根须」，并排看根本分不出
      I.brush(ctx, [[0, -u * 0.06], [0, -u * 0.56]], u * 0.085, u * 0.060, I.CLU, 0.95);
      for (i = -1; i <= 1; i++) {
        I.dot(ctx, i * u * 0.12, -u * 0.30 - Math.abs(i) * u * 0.06, u * 0.11, I.CLU, 0.8);
      }
      I.brush(ctx, [[0, -u * 0.62], [u * 0.10, -u * 0.72]], u * 0.028, u * 0.008, I.CLU_D, 0.7);
    } else {                                     // 粟：沉下去的一穗
      I.brush(ctx, [[0, -u * 0.08], [u * 0.26, -u * 0.50], [u * 0.44, -u * 0.40]],
        u * 0.075, u * 0.022, I.TENG, 0.85);
    }
  };

  /* 种子：扎口的小布袋 + 一点作物色 */
  I.icPouch = function (ctx, u, tint) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-u * 0.30, -u * 0.28);
    ctx.lineTo(u * 0.30, -u * 0.28);
    ctx.quadraticCurveTo(u * 0.52, u * 0.36, u * 0.20, u * 0.62);
    ctx.lineTo(-u * 0.20, u * 0.62);
    ctx.quadraticCurveTo(-u * 0.52, u * 0.36, -u * 0.30, -u * 0.28);
    ctx.closePath();
    ctx.fillStyle = I.CLU + '0.55)';
    ctx.fill();
    ctx.restore();
    I.brush(ctx, [[-u * 0.30, -u * 0.28], [u * 0.30, -u * 0.28]], u * 0.045, u * 0.045, I.CLU_D, 0.9);
    I.dot(ctx, 0, u * 0.10, u * 0.15, tint, 0.8);
  };

  /* 鱼：身体 + 尾 + 眼。虾和鳖单独画（弯身 / 甲壳），差别一眼就出来。 */
  I.icFish = function (ctx, u, id) {
    if (id === 'xia') {                          // 溪虾：弯成一钩
      I.brush(ctx, [[-u * 0.34, u * 0.34], [u * 0.06, u * 0.42], [u * 0.36, u * 0.02]],
        u * 0.14, u * 0.07, I.ZHE, 0.85);
      I.brush(ctx, [[-u * 0.34, u * 0.30], [u * 0.06, u * 0.36], [u * 0.30, u * 0.04]],
        u * 0.09, u * 0.045, I.ZHE, 0.55);
      I.brush(ctx, [[u * 0.30, u * 0.02], [u * 0.52, -u * 0.20]], u * 0.026, u * 0.008, I.INK, 0.6);
      I.brush(ctx, [[u * 0.28, u * 0.06], [u * 0.52, -u * 0.04]], u * 0.026, u * 0.008, I.INK, 0.6);
      I.dot(ctx, -u * 0.22, u * 0.16, u * 0.055, I.INK, 0.8);
      return;
    }
    if (id === 'gui') {                          // 鳖：甲壳 + 软边。鱼表里鳖的 id 是 gui ——
      I.dot(ctx, 0, u * 0.04, u * 0.46, I.QING, 0.7);   // 原先写成 'bie'，可没有哪味东西叫 bie，
      ctx.save();                                // 这一整支是死分支，鳖一直被画成普通鱼
      ctx.beginPath();
      ctx.ellipse(0, u * 0.04, u * 0.46, u * 0.40, 0, 0, Math.PI * 2);
      ctx.strokeStyle = I.INK + '0.55)';
      ctx.lineWidth = u * 0.06;
      ctx.stroke();
      ctx.restore();
      I.dot(ctx, u * 0.30, -u * 0.30, u * 0.14, I.QING, 0.85);   // 头
      I.dot(ctx, u * 0.32, -u * 0.32, u * 0.05, I.INK, 0.9);
      return;
    }
    // 鲫 / 鳊 / 鳜 / 鲤：四条鱼原本是同一个轮廓换颜色，
    // 鲫深而圆、鳊扁而阔、鳜长尾大、鲤尾短身阔 —— 靠体型分，不靠色
    var bw, bh, tw, col2, ex, ey;
    if (id === 'ji') { bw = 0.40; bh = 0.30; tw = 0.26; col2 = I.INK_SOFT; ex = 0.20; ey = -0.07; }
    else if (id === 'bian') { bw = 0.46; bh = 0.22; tw = 0.30; col2 = I.QING; ex = 0.26; ey = -0.06; }
    else if (id === 'luo') { bw = 0.44; bh = 0.25; tw = 0.46; col2 = I.HUA; ex = 0.24; ey = -0.07; }
    else { bw = 0.44; bh = 0.29; tw = 0.24; col2 = I.ZHE; ex = 0.22; ey = -0.08; }
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, u * bw, u * bh, 0, 0, Math.PI * 2);
    ctx.fillStyle = col2 + '0.8)';
    ctx.fill();
    ctx.restore();
    // 尾：鳜那一档明显大，扇形也画得开
    I.brush(ctx, [[-u * bw * 0.85, 0], [-u * (bw + tw), -u * 0.30], [-u * (bw + tw * 0.82), u * 0.32]],
      u * 0.075, u * 0.045, col2, 0.72);
    I.dot(ctx, u * ex, u * ey, u * 0.055, I.INK, 0.9);
    if (id === 'luo') {          // 鳜：身上的斑点是它唯一的名片（鳜鱼 id 是 luo，原先挂在 gui 上）
      I.dot(ctx, -u * 0.12, -u * 0.06, u * 0.05, I.CLU_D, 0.7);
      I.dot(ctx, u * 0.06, u * 0.08, u * 0.05, I.CLU_D, 0.6);
    }
    I.brush(ctx, [[-u * 0.08, -u * bh * 0.75], [u * 0.22, -u * bh * 1.15]], u * 0.045, u * 0.018, col2, 0.6);
  };

  /* 山货：形状差别最大的一类，所以四种一个一个画。 */
  I.icGood = function (ctx, u, id) {
    if (id === 'ling') {                          // 菱角：就是一枚菱形
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, -u * 0.52); ctx.lineTo(u * 0.42, 0);
      ctx.lineTo(0, u * 0.52); ctx.lineTo(-u * 0.42, 0);
      ctx.closePath();
      ctx.fillStyle = I.QING + '0.8)';
      ctx.fill();
      ctx.restore();
      I.brush(ctx, [[-u * 0.16, 0], [u * 0.16, 0]], u * 0.05, u * 0.05, I.INK, 0.5);
      return;
    }
    if (id === 'ou') {                            // 藕：一节一节的
      I.brush(ctx, [[-u * 0.44, -u * 0.10], [u * 0.44, u * 0.14]], u * 0.26, u * 0.26, I.CLU, 0.9);
      I.brush(ctx, [[-u * 0.14, -u * 0.08], [u * 0.12, -u * 0.02]], u * 0.035, u * 0.035, I.CLU_D, 0.7);
      I.brush(ctx, [[u * 0.14, 0], [u * 0.34, u * 0.06]], u * 0.035, u * 0.035, I.CLU_D, 0.7);
      return;
    }
    if (id === 'jun') {                           // 山菌：伞盖 + 柄
      I.brush(ctx, [[0, u * 0.02], [-u * 0.05, u * 0.56]], u * 0.09, u * 0.06, I.CLU, 0.9);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-u * 0.50, u * 0.04);
      ctx.quadraticCurveTo(0, -u * 0.62, u * 0.50, u * 0.04);
      ctx.quadraticCurveTo(0, u * 0.18, -u * 0.50, u * 0.04);
      ctx.closePath();
      ctx.fillStyle = I.ZHE + '0.85)';
      ctx.fill();
      ctx.restore();
      return;
    }
    if (id === 'luos') {                          // 田螺：壳上那道旋
      I.dot(ctx, 0, u * 0.04, u * 0.44, I.INK_SOFT, 0.8);
      I.brush(ctx, [[u * 0.02, -u * 0.22], [u * 0.20, u * 0.04], [u * 0.02, u * 0.30], [-u * 0.16, u * 0.06], [u * 0.02, -u * 0.22]],
        u * 0.045, u * 0.045, I.CLU, 0.95);
      return;
    }
    I.dot(ctx, -u * 0.22, u * 0.10, u * 0.20, I.ZHE, 0.85);          // 野莓：三粒
    I.dot(ctx, u * 0.20, u * 0.14, u * 0.20, I.ZHE, 0.85);
    I.dot(ctx, 0, -u * 0.22, u * 0.21, I.HUA, 0.8);
  };

  /* 矿砂：四样必须靠**轮廓**分开，不能只靠颜色 ——
     行囊一格只有 26px，两样都画成「一堆圆点」的话，
     铜砂和铁砂在屏上就是同一个图，只是青一点和赭一点的区别。 */
  I.icOre = function (ctx, u, id) {
    var i, ox, oy;
    ctx.save();
    if (id === 'shi') {                                  // 石炭：几块棱角分明的黑块
      for (i = 0; i < 3; i++) {
        ox = (i - 1) * u * 0.44;
        oy = u * 0.10 - (i === 1 ? u * 0.16 : 0);
        ctx.beginPath();
        ctx.moveTo(ox - u * 0.26, oy + u * 0.16);
        ctx.lineTo(ox - u * 0.18, oy - u * 0.20);
        ctx.lineTo(ox + u * 0.10, oy - u * 0.26);
        ctx.lineTo(ox + u * 0.28, oy - u * 0.04);
        ctx.lineTo(ox + u * 0.18, oy + u * 0.20);
        ctx.closePath();
        ctx.fillStyle = 'rgba(42,39,36,0.95)';
        ctx.fill();
      }
      // 折出来的一个亮面，否则三块黑糊成一团
      ctx.beginPath();
      ctx.moveTo(-u * 0.18, -u * 0.20);
      ctx.lineTo(u * 0.10, -u * 0.26);
      ctx.lineTo(u * 0.02, -u * 0.10);
      ctx.closePath();
      ctx.fillStyle = 'rgba(224,216,198,0.55)';
      ctx.fill();
    } else if (id === 'tong') {                         // 铜砂：圆粒一堆，旁边一片卷铜
      for (i = 0; i < 6; i++) {
        ox = -u * 0.26 + (i % 3) * u * 0.24 + (i > 2 ? u * 0.06 : 0);
        oy = u * 0.14 - Math.floor(i / 3) * u * 0.22;
        I.dot(ctx, ox, oy, u * 0.135, 'rgba(96,146,128,', 0.92);
      }
      ctx.beginPath();
      ctx.moveTo(u * 0.18, u * 0.34);
      ctx.quadraticCurveTo(u * 0.44, u * 0.10, u * 0.16, -u * 0.16);
      ctx.lineWidth = u * 0.11;
      ctx.strokeStyle = 'rgba(122,168,146,0.92)';
      ctx.lineCap = 'round';
      ctx.stroke();
    } else if (id === 'tie') {                          // 铁砂：尖角碎块，带一片暗红锈
      for (i = 0; i < 4; i++) {
        ox = (i % 2 ? u * 0.24 : -u * 0.26) + (i > 1 ? 0 : u * 0.04);
        oy = -u * 0.20 + Math.floor(i / 2) * u * 0.42;
        ctx.beginPath();
        ctx.moveTo(ox, oy - u * 0.24);
        ctx.lineTo(ox + u * 0.22, oy + u * 0.02);
        ctx.lineTo(ox + u * 0.04, oy + u * 0.24);
        ctx.lineTo(ox - u * 0.18, oy + u * 0.06);
        ctx.closePath();
        ctx.fillStyle = 'rgba(162,102,62,0.92)';
        ctx.fill();
      }
      I.dot(ctx, u * 0.04, -u * 0.34, u * 0.10, 'rgba(126,58,38,', 0.80);
    } else {                                            // 玄英：一整块扁方的青黑石
      ctx.beginPath();
      ctx.moveTo(-u * 0.40, u * 0.20);
      ctx.lineTo(-u * 0.32, -u * 0.22);
      ctx.lineTo(u * 0.04, -u * 0.34);
      ctx.lineTo(u * 0.40, -u * 0.14);
      ctx.lineTo(u * 0.34, u * 0.24);
      ctx.closePath();
      ctx.fillStyle = 'rgba(70,82,100,0.95)';
      ctx.fill();
      // 一道斜光：这是它跟「一块深色石头」唯一的区别，得够亮
      ctx.beginPath();
      ctx.moveTo(-u * 0.24, -u * 0.16);
      ctx.lineTo(u * 0.30, u * 0.04);
      ctx.lineTo(u * 0.30, -u * 0.06);
      ctx.closePath();
      ctx.fillStyle = 'rgba(196,210,224,0.52)';
      ctx.fill();
    }
    ctx.restore();
  };

  /* 酒：陶坛。束口 + 鼓腹 + 封口的布，是「坛子」最少要有的三笔。 */
  I.icJar = function (ctx, u) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-u * 0.18, -u * 0.52);
    ctx.lineTo(u * 0.18, -u * 0.52);
    ctx.quadraticCurveTo(u * 0.22, -u * 0.30, u * 0.34, -u * 0.16);
    ctx.quadraticCurveTo(u * 0.54, u * 0.28, u * 0.20, u * 0.56);
    ctx.lineTo(-u * 0.20, u * 0.56);
    ctx.quadraticCurveTo(-u * 0.54, u * 0.28, -u * 0.34, -u * 0.16);
    ctx.quadraticCurveTo(-u * 0.22, -u * 0.30, -u * 0.18, -u * 0.52);
    ctx.closePath();
    ctx.fillStyle = I.CLU_D + '0.85)';
    ctx.fill();
    ctx.restore();
    I.brush(ctx, [[-u * 0.24, -u * 0.52], [u * 0.24, -u * 0.52]], u * 0.05, u * 0.05, I.ZHE, 0.95);
    I.brush(ctx, [[-u * 0.30, -u * 0.06], [u * 0.30, -u * 0.06]], u * 0.035, u * 0.035, I.ZHE, 0.5);
    I.dot(ctx, -u * 0.18, u * 0.18, u * 0.09, I.TENG, 0.4);
  };

  /* 加工品：七样，七个剪影。
     这一族最容易糊 —— 坛、罐、碗都是圆腹，一排看下去全是「一个胖肚子」。
     所以坛罐这一支每件都留一个**顶上的记号**来分家：
     醋是敞口宽沿、酱是布封的两角、菇酱是顶一把伞；
     而饼、鱼干、干菊三样干脆不做成坛子，靠**扁、瘦、垂**三样分开。
     （这一族原本一个图都没画，全落进种子袋的兜底分支，
     一屏里七件加工品看着是七个布袋。） */
  I.icMade = function (ctx, u, key) {
    if (key === 'cu') {                            // 醋：敞口矮坛。鼓腹 + 收脚，不是直筒
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-u * 0.40, -u * 0.30);
      // 鼓腹：口沿往下先甩出去再收回来。第一版是两条直边 + 一道粗箍，
      // 剪影整个是只木桶，而「桶」在这个背包里没有任何含义
      ctx.quadraticCurveTo(-u * 0.52, u * 0.14, -u * 0.19, u * 0.54);
      ctx.lineTo(u * 0.19, u * 0.54);
      ctx.quadraticCurveTo(u * 0.52, u * 0.14, u * 0.40, -u * 0.30);
      ctx.closePath();
      ctx.fillStyle = I.CLU_D + '0.82)';
      ctx.fill();
      ctx.restore();
      I.brush(ctx, [[-u * 0.40, -u * 0.30], [u * 0.40, -u * 0.30]], u * 0.052, u * 0.052, I.INK, 0.88);
      I.brush(ctx, [[-u * 0.44, u * 0.06], [u * 0.44, u * 0.06]], u * 0.026, u * 0.026, I.INK, 0.28);
      I.dot(ctx, -u * 0.14, u * 0.22, u * 0.10, I.TENG, 0.34);
      return;
    }
    if (key === 'jiang') {                         // 酱：布封口。布是搭在坛口上的一条，不是顶在坛上方的伞
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-u * 0.22, -u * 0.18);
      ctx.quadraticCurveTo(u * 0.54, u * 0.18, u * 0.21, u * 0.56);
      ctx.lineTo(-u * 0.21, u * 0.56);
      ctx.quadraticCurveTo(-u * 0.54, u * 0.18, -u * 0.22, -u * 0.18);
      ctx.closePath();
      ctx.fillStyle = I.INK + '0.72)';             // 酱是黑的，这一件是全族最深的一团
      ctx.fill();
      ctx.restore();
      // 布：一条压过坛口的宽带，两端各翘一个角。布要压着坛口画，
      // 往上飘就成了「石头上顶把伞」，跟菇酱撞在一起
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-u * 0.34, -u * 0.20);
      ctx.lineTo(-u * 0.26, -u * 0.44);
      ctx.lineTo(u * 0.26, -u * 0.44);
      ctx.lineTo(u * 0.34, -u * 0.20);
      ctx.closePath();
      ctx.fillStyle = I.CLU + '0.92)';
      ctx.fill();
      ctx.restore();
      I.brush(ctx, [[-u * 0.34, -u * 0.20], [u * 0.34, -u * 0.20]], u * 0.030, u * 0.030, I.ZHE, 0.9);
      I.brush(ctx, [[-u * 0.26, -u * 0.32], [u * 0.26, -u * 0.32]], u * 0.024, u * 0.024, I.INK, 0.35);
      return;
    }
    if (key === 'bing') {                          // 饼：一张薄盘，中间一厚边
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, u * 0.10, u * 0.50, u * 0.26, 0, 0, Math.PI * 2);
      ctx.fillStyle = I.DOU + '0.85)';
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, u * 0.10, u * 0.29, u * 0.15, 0, 0, Math.PI * 2);
      ctx.strokeStyle = I.ZHE + '0.55)';
      ctx.lineWidth = u * 0.045;
      ctx.stroke();
      ctx.restore();
      I.brush(ctx, [[u * 0.14, u * 0.00], [u * 0.36, u * 0.26]], u * 0.030, u * 0.010, I.INK, 0.45);
      return;
    }
    if (key === 'yugan') {                         // 鱼干：摊平的鱼。身要有肉，不能是一条线
      // 第一版用三笔细的画出身体，剪影成了一支箭 —— 晾干的虾也是那个形
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(u * 0.50, u * 0.10);
      ctx.quadraticCurveTo(u * 0.10, u * 0.38, -u * 0.26, u * 0.24);
      ctx.quadraticCurveTo(u * 0.06, u * 0.06, u * 0.50, u * 0.10);
      ctx.closePath();
      ctx.fillStyle = I.CLU + '0.9)';
      ctx.fill();
      ctx.restore();
      I.brush(ctx, [[-u * 0.26, u * 0.24], [-u * 0.50, -u * 0.06]], u * 0.055, u * 0.022, I.CLU_D, 0.88);
      I.brush(ctx, [[-u * 0.26, u * 0.24], [-u * 0.44, u * 0.46]], u * 0.055, u * 0.022, I.CLU_D, 0.88);
      I.brush(ctx, [[-u * 0.06, u * 0.20], [u * 0.04, u * 0.11]], u * 0.028, u * 0.028, I.INK, 0.45);
      I.brush(ctx, [[u * 0.14, u * 0.19], [u * 0.24, u * 0.13]], u * 0.028, u * 0.028, I.INK, 0.45);
      I.dot(ctx, u * 0.40, u * 0.11, u * 0.052, I.INK, 0.8);
      return;
    }
    if (key === 'oufen') {                         // 藕粉：敞口碗 + 一根挑起来的粉线
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-u * 0.46, u * 0.02);
      ctx.quadraticCurveTo(-u * 0.30, u * 0.54, 0, u * 0.56);
      ctx.quadraticCurveTo(u * 0.30, u * 0.54, u * 0.46, u * 0.02);
      ctx.closePath();
      ctx.fillStyle = I.CLU + '0.88)';
      ctx.fill();
      ctx.restore();
      // 碗里的粉是**很淡**的一层暖色，而且碗身占了整个剪影的三分之二。
      // 碗口那一圈深边如果和一团暖色一样大、一样居中，成品就是一只黑蛋带蛋黄
      I.brush(ctx, [[-u * 0.44, u * 0.02], [u * 0.44, u * 0.02]], u * 0.038, u * 0.038, I.INK, 0.7);
      I.wash(ctx, 0, u * 0.08, u * 0.32, u * 0.07, I.DOU, 0.42);
      I.brush(ctx, [[u * 0.12, -u * 0.10], [u * 0.30, -u * 0.52]], u * 0.028, u * 0.012, I.CLU_D, 0.85);
      I.brush(ctx, [[u * 0.30, -u * 0.52], [u * 0.44, -u * 0.28]], u * 0.015, u * 0.008, I.DOU, 0.8);
      return;
    }
    if (key === 'gujiang') {                       // 菇酱：罐上顶一把伞
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-u * 0.20, -u * 0.04);
      ctx.quadraticCurveTo(u * 0.52, u * 0.18, u * 0.20, u * 0.58);
      ctx.lineTo(-u * 0.20, u * 0.58);
      ctx.quadraticCurveTo(-u * 0.52, u * 0.18, -u * 0.20, -u * 0.04);
      ctx.closePath();
      ctx.fillStyle = I.CLU_D + '0.8)';
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-u * 0.44, -u * 0.18);
      ctx.quadraticCurveTo(0, -u * 0.68, u * 0.44, -u * 0.18);
      ctx.quadraticCurveTo(0, -u * 0.04, -u * 0.44, -u * 0.18);
      ctx.closePath();
      ctx.fillStyle = I.ZHE + '0.9)';
      ctx.fill();
      ctx.restore();
      I.brush(ctx, [[-u * 0.20, -u * 0.05], [u * 0.20, -u * 0.05]], u * 0.040, u * 0.040, I.INK, 0.5);
      return;
    }
    if (key === 'dan') {                            // 蛋：一只立着的卵
      // **不画蛋黄**。画了个蛋黄的话，成品是「黑蛋带黄心」，
      // 跟 I.cave 那个洞口撞得一模一样 —— 1× 下两样东西完全分不开
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, -u * 0.56);
      ctx.bezierCurveTo(u * 0.44, -u * 0.20, u * 0.40, u * 0.50, 0, u * 0.56);
      ctx.bezierCurveTo(-u * 0.40, u * 0.50, -u * 0.44, -u * 0.20, 0, -u * 0.56);
      ctx.closePath();
      ctx.fillStyle = I.DOU + '0.92)';
      ctx.fill();
      ctx.restore();
      // 壳上的一道受光。只一笔，多了就成了一只高脚杯
      I.brush(ctx, [[-u * 0.21, -u * 0.14], [-u * 0.13, u * 0.08]], u * 0.052, u * 0.018, I.CLU, 0.85);
      return;
    }
    /* 坛里腌出来的三样。**各画各的** ——
       不给分支的话它们全落进末尾那个叉号兜底，三格并排看过去
       是同一个叉画了三遍（shoot-stove 那条「两两之间都分得开」当场抓住）。
       区分靠的是**轮廓**：酸菜是团、盐菜是条、排黄是块带网的。 */
    if (key === 'nai') {                          // 奶：一只束口的小陶罐
      ctx.save();
      ctx.fillStyle = 'rgba(156,128,96,0.94)';
      ctx.beginPath();
      ctx.moveTo(-u * 0.20, -u * 0.40);
      ctx.lineTo(u * 0.20, -u * 0.40);
      ctx.quadraticCurveTo(u * 0.42, u * 0.06, u * 0.22, u * 0.44);
      ctx.lineTo(-u * 0.22, u * 0.44);
      ctx.quadraticCurveTo(-u * 0.42, u * 0.06, -u * 0.20, -u * 0.40);
      ctx.closePath(); ctx.fill();
      // 口上那圈白：奶从这儿冒出来的
      ctx.fillStyle = 'rgba(246,242,230,0.95)';
      ctx.beginPath();
      ctx.ellipse(0, -u * 0.40, u * 0.20, u * 0.055, 0, 0, Math.PI * 2);
      ctx.fill();
      // 束口的一道绳
      ctx.strokeStyle = 'rgba(72,58,42,0.85)';
      ctx.lineWidth = u * 0.036;
      ctx.beginPath();
      ctx.moveTo(-u * 0.20, -u * 0.30); ctx.lineTo(u * 0.20, -u * 0.30);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (key === 'mao') {                          // 羊毛：一束捆着的毛
      // 原来是「一个带绒边的圆」—— 跟毛线那个线团在 1× 下几乎分不开
      // （实测两者像素只差 2365，低于 3000 那道线）。
      // 靠纹理分不开的时候就得靠**轮廓**：这里画成一束横躺的毛、
      // 中间捆一道深色的绳，剪影跟圆球是两回事，深色也压得住
      ctx.save();
      ctx.fillStyle = 'rgba(226,220,206,0.96)';
      ctx.beginPath();
      // 用一圈小凸起伏出绒边：光一个圆读出来是蛋，不是羊毛
      for (var wa = 0; wa < 18; wa++) {
        var wr = (wa / 18) * Math.PI * 2, wR = (wa % 2) ? 1.05 : 0.94;
        var wpx = Math.cos(wr) * u * 0.44 * wR, wpy = Math.sin(wr) * u * 0.30 * wR;
        if (wa === 0) ctx.moveTo(wpx, wpy); else ctx.lineTo(wpx, wpy);
      }
      ctx.closePath(); ctx.fill();
      // 捆的那道绳：两头垂下来，中间一个结
      ctx.strokeStyle = 'rgba(96,80,60,0.92)';
      ctx.lineWidth = u * 0.055;
      ctx.beginPath();
      ctx.moveTo(-u * 0.06, -u * 0.29);
      ctx.quadraticCurveTo(u * 0.04, 0, -u * 0.06, u * 0.29);
      ctx.moveTo(u * 0.12, -u * 0.28);
      ctx.quadraticCurveTo(u * 0.22, 0, u * 0.12, u * 0.28);
      ctx.stroke();
      ctx.fillStyle = 'rgba(96,80,60,0.95)';
      ctx.beginPath();
      ctx.arc(u * 0.03, 0, u * 0.070, 0, Math.PI * 2);
      ctx.fill();
      // 毛的两头：从绳结那儿甩出去几根
      ctx.strokeStyle = 'rgba(176,166,146,0.85)';
      ctx.lineWidth = u * 0.030;
      ctx.beginPath();
      ctx.moveTo(-u * 0.30, -u * 0.16);
      ctx.quadraticCurveTo(-u * 0.44, -u * 0.02, -u * 0.36, u * 0.16);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (key === 'huangyou') {                     // 黄油：一块切下来的方角
      ctx.save();
      ctx.fillStyle = 'rgba(214,178,86,0.92)';
      ctx.beginPath();
      ctx.moveTo(-u * 0.40, -u * 0.26);
      ctx.lineTo(u * 0.40, -u * 0.30);
      ctx.lineTo(u * 0.38, u * 0.30);
      ctx.lineTo(-u * 0.42, u * 0.26);
      ctx.closePath(); ctx.fill();
      // 顶上一道亮的 + 侧面一道暗的：读出是个立着的方块，不是贴上去的黄纸
      ctx.fillStyle = 'rgba(238,208,124,0.95)';
      ctx.beginPath();
      ctx.moveTo(-u * 0.40, -u * 0.26);
      ctx.lineTo(u * 0.40, -u * 0.30);
      ctx.lineTo(u * 0.39, -u * 0.08);
      ctx.lineTo(-u * 0.41, -u * 0.04);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(168,132,58,0.70)';
      ctx.fillRect(-u * 0.42, u * 0.04, u * 0.80, u * 0.08);
      ctx.restore();
      return;
    }
    if (key === 'maoxian') {                      // 毛线：一个绕起来的线团
      ctx.save();
      ctx.fillStyle = 'rgba(206,198,182,0.92)';
      ctx.beginPath();
      ctx.arc(0, 0, u * 0.38, 0, Math.PI * 2);
      ctx.fill();
      // 三道交叉的缠线。少画两道的话就是一个灰圆点，跟别的球状物分不开
      ctx.strokeStyle = 'rgba(146,136,118,0.85)';
      ctx.lineWidth = u * 0.032;
      for (var my = 0; my < 3; my++) {
        var ma = my * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(ma) * u * 0.36, -Math.sin(ma) * u * 0.36);
        ctx.lineTo(Math.cos(ma) * u * 0.36, Math.sin(ma) * u * 0.36);
        ctx.stroke();
      }
      // 垂下来的一小段线头 —— 圆和线团就差这一根
      ctx.beginPath();
      ctx.moveTo(u * 0.10, u * 0.36);
      ctx.quadraticCurveTo(u * 0.30, u * 0.50, u * 0.26, u * 0.62);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (key === 'mi') {                          // 蜜：一只矮陶罐，蜜色 + 一道流痕
      ctx.save();
      ctx.fillStyle = 'rgba(158,132,96,0.96)';
      ctx.beginPath();
      ctx.moveTo(-u * 0.30, -u * 0.16);
      ctx.lineTo(-u * 0.34, u * 0.40);
      ctx.lineTo(u * 0.34, u * 0.40);
      ctx.lineTo(u * 0.30, -u * 0.16);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(214,158,52,0.96)';
      ctx.beginPath();
      ctx.moveTo(-u * 0.29, u * 0.04);
      ctx.lineTo(u * 0.29, u * 0.04);
      ctx.lineTo(u * 0.33, u * 0.38);
      ctx.lineTo(-u * 0.33, u * 0.38);
      ctx.closePath(); ctx.fill();
      // 顺着罐壁淌下来的一道：黏。**这是「蜜」和「一罐黄水」唯一的分别**
      ctx.fillStyle = 'rgba(236,196,110,0.95)';
      ctx.fillRect(u * 0.12, -u * 0.14, u * 0.07, u * 0.20);
      ctx.fillStyle = 'rgba(232,226,212,0.96)';
      ctx.beginPath(); ctx.ellipse(0, -u * 0.18, u * 0.34, u * 0.09, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    if (key === 'yemeijiang') {                  // 野莓酱：一只矮瓶，酱是深紫红的
      ctx.save();
      ctx.fillStyle = 'rgba(120,58,74,0.94)';
      ctx.beginPath();
      ctx.moveTo(-u * 0.30, u * 0.02);
      ctx.quadraticCurveTo(-u * 0.38, u * 0.36, -u * 0.16, u * 0.44);
      ctx.lineTo(u * 0.16, u * 0.44);
      ctx.quadraticCurveTo(u * 0.38, u * 0.36, u * 0.30, u * 0.02);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(232,226,212,0.95)';
      ctx.fillRect(-u * 0.34, -u * 0.20, u * 0.68, u * 0.22);
      ctx.fillStyle = 'rgba(150,102,112,0.92)';
      ctx.beginPath(); ctx.arc(0, u * 0.16, u * 0.10, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    if (key === 'nailao') {                       // 奶酪：一块切开的、带着孔的
      ctx.save();
      ctx.fillStyle = 'rgba(236,222,168,0.96)';
      ctx.beginPath();
      ctx.moveTo(-u * 0.40, u * 0.18);
      ctx.lineTo(-u * 0.34, -u * 0.20);
      ctx.lineTo(u * 0.30, -u * 0.26);
      ctx.lineTo(u * 0.40, u * 0.14);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(198,180,120,0.95)';
      ctx.beginPath();
      ctx.moveTo(u * 0.30, -u * 0.26); ctx.lineTo(u * 0.40, u * 0.14);
      ctx.lineTo(u * 0.20, u * 0.22); ctx.lineTo(u * 0.22, -u * 0.20);
      ctx.closePath(); ctx.fill();
      // 三个孔。**孔是奶酪跟别的黄方块唯一分得开的地方**
      ctx.fillStyle = 'rgba(150,132,80,0.90)';
      ctx.beginPath();
      ctx.arc(-u * 0.14, -u * 0.04, u * 0.075, 0, Math.PI * 2);
      ctx.arc(u * 0.06, u * 0.06, u * 0.058, 0, Math.PI * 2);
      ctx.arc(-u * 0.02, -u * 0.16, u * 0.045, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    if (key === 'yulu') {                         // 鱼露：一只深口小坛，坛口一圈深色
      ctx.save();
      ctx.fillStyle = 'rgba(70,66,62,0.94)';
      ctx.beginPath();
      ctx.moveTo(-u * 0.34, -u * 0.22);
      ctx.quadraticCurveTo(-u * 0.44, u * 0.36, -u * 0.18, u * 0.46);
      ctx.lineTo(u * 0.18, u * 0.46);
      ctx.quadraticCurveTo(u * 0.44, u * 0.36, u * 0.34, -u * 0.22);
      ctx.closePath(); ctx.fill();
      // 坛口那一圈：深口 + 一点亮。**深口是「这是泡的」那一条信息**
      ctx.fillStyle = 'rgba(38,34,30,0.96)';
      ctx.beginPath(); ctx.ellipse(0, -u * 0.22, u * 0.34, u * 0.10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(198,152,86,0.80)';
      ctx.beginPath(); ctx.ellipse(-u * 0.06, -u * 0.22, u * 0.20, u * 0.055, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    if (key === 'suancai') {                      // 酸菜：一团压实的菜叶
      ctx.save();
      ctx.fillStyle = I.QING + '0.82)';
      ctx.beginPath();
      ctx.moveTo(-u * 0.40, u * 0.34);
      ctx.quadraticCurveTo(-u * 0.44, -u * 0.24, 0, -u * 0.30);
      ctx.quadraticCurveTo(u * 0.44, -u * 0.24, u * 0.40, u * 0.34);
      ctx.quadraticCurveTo(0, u * 0.54, -u * 0.40, u * 0.34);
      ctx.closePath(); ctx.fill();
      // 团上三道深浅不同的菜梗，压出「一团」而不是「一块」
      ctx.strokeStyle = I.TENG + '0.60)';
      ctx.lineWidth = u * 0.036;
      ctx.beginPath();
      ctx.moveTo(-u * 0.26, u * 0.10); ctx.quadraticCurveTo(0, -u * 0.12, u * 0.26, u * 0.06);
      ctx.moveTo(-u * 0.22, u * 0.30); ctx.quadraticCurveTo(0, u * 0.10, u * 0.22, u * 0.26);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (key === 'yancai') {                       // 盐菜：几根并排的深色长条
      ctx.save();
      ctx.strokeStyle = I.TENG + '0.90)';
      ctx.lineWidth = u * 0.070;
      ctx.lineCap = 'round';
      for (var yq = -1; yq <= 1; yq++) {
        ctx.beginPath();
        ctx.moveTo(-u * 0.34, yq * u * 0.19);
        ctx.quadraticCurveTo(0, yq * u * 0.19 - u * 0.07, u * 0.34, yq * u * 0.19);
        ctx.stroke();
      }
      // 顶上一撮白霜：盐菜跟别的深色条状物（酱、醋）靠这个分开
      ctx.fillStyle = I.CLU + '0.75)';
      for (var yq2 = -1; yq2 <= 1; yq2++) {
        ctx.beginPath();
        ctx.arc(yq2 * u * 0.22, yq2 * u * 0.19 - u * 0.05, u * 0.038, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    if (key === 'paihuang') {                     // 排黄：半片腌到半透的鱼
      ctx.save();
      ctx.fillStyle = I.TENG + '0.78)';
      ctx.beginPath();
      ctx.moveTo(-u * 0.44, u * 0.06);
      ctx.quadraticCurveTo(0, -u * 0.40, u * 0.40, u * 0.02);
      ctx.quadraticCurveTo(0, u * 0.46, -u * 0.44, u * 0.06);
      ctx.closePath(); ctx.fill();
      // 鱼骨：一条竖线加三根横刺。横刺是「鱼」，
      // 光一条弧的话跟一片菜叶分不开
      ctx.strokeStyle = I.CLU + '0.92)';
      ctx.lineWidth = u * 0.032;
      ctx.beginPath();
      ctx.moveTo(-u * 0.30, u * 0.06); ctx.lineTo(u * 0.30, u * 0.02);
      for (var rb = -1; rb <= 1; rb++) {
        ctx.moveTo(rb * u * 0.15, u * 0.04);
        ctx.lineTo(rb * u * 0.15, u * 0.04 - u * 0.14);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (key === 'dangeng') {                        // 蛋羹：半只蛋壳当的小盅
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-u * 0.42, -u * 0.20);
      ctx.quadraticCurveTo(-u * 0.38, u * 0.52, 0, u * 0.56);
      ctx.quadraticCurveTo(u * 0.38, u * 0.52, u * 0.42, -u * 0.20);
      ctx.closePath();
      ctx.fillStyle = I.CLU + '0.90)';
      ctx.fill();
      ctx.restore();
      // 裂边：一圈**不等高**的短齿。齐边的话就是一只普通碗，跟藕粉撞在一起，
      // 两格并排看过去分不出哪个是羹哪个是粉
      ctx.save();
      ctx.strokeStyle = I.DOU + '0.95)';
      ctx.lineWidth = u * 0.038;
      ctx.beginPath();
      for (var z = 0; z < 9; z++) {
        var zz = -0.40 + z * 0.10;
        var zy = -0.20 - (z % 2 ? 0.075 : 0.012);
        if (z === 0) ctx.moveTo(u * zz, u * zy); else ctx.lineTo(u * zz, u * zy);
      }
      ctx.stroke();
      ctx.restore();
      // 羹面：一块平而暖的顶，压在裂边底下
      I.wash(ctx, 0, u * 0.08, u * 0.30, u * 0.10, I.TENG, 0.62);
      return;
    }
    if (key === 'ganju') {                          // 干菊：三朵倒垂的花头，茎扎成一束倒挂着
      I.brush(ctx, [[0, u * 0.58], [0, -u * 0.04]], u * 0.055, u * 0.045, I.CLU_D, 0.9);
      I.brush(ctx, [[-u * 0.20, u * 0.50], [u * 0.20, u * 0.48]], u * 0.045, u * 0.045, I.ZHE, 0.8);
      for (var i = -1; i <= 1; i++) {
        var ax = i * u * 0.24;
        I.brush(ctx, [[0, u * 0.20], [ax, -u * 0.14]], u * 0.024, u * 0.012, I.CLU_D, 0.8);
        I.dot(ctx, ax, -u * 0.32, u * 0.17, I.TENG, 0.6);
      }
      return;
    }
    // 落在这里的是一件**没人给它画过图**的加工品。早先这一族是「干菊那几笔
    // 直接接在末尾」，于是任何漏掉分支的 key 都安静地长成三朵菊花 ——
    // 看着有图、也不报错，所以永远发现不了。画一个一眼就认得的空标记：
    // 宁可摆一个问号，也不要摆一件别的
    I.brush(ctx, [[-u * 0.34, -u * 0.34], [u * 0.34, u * 0.34]], u * 0.070, u * 0.070, I.INK, 0.75);
    I.brush(ctx, [[u * 0.34, -u * 0.34], [-u * 0.34, u * 0.34]], u * 0.070, u * 0.070, I.INK, 0.75);
  };

  /* 农具：锄是刃，瓢是斗。 */
  I.icTool = function (ctx, u, key) {
    if (key === 'piao') {                          // 木瓢：斜着的斗 + 柄
      I.brush(ctx, [[-u * 0.10, u * 0.56], [u * 0.34, -u * 0.16]], u * 0.075, u * 0.045, I.CLU_D, 0.9);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(u * 0.16, -u * 0.42);
      ctx.quadraticCurveTo(u * 0.62, -u * 0.10, u * 0.40, u * 0.22);
      ctx.quadraticCurveTo(u * 0.18, u * 0.14, u * 0.16, -u * 0.42);
      ctx.closePath();
      ctx.fillStyle = I.CLU + '0.85)';
      ctx.fill();
      ctx.restore();
      return;
    }
    I.brush(ctx, [[-u * 0.34, u * 0.54], [u * 0.20, -u * 0.44]], u * 0.07, u * 0.05, I.CLU_D, 0.9);  // 柄
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-u * 0.54, u * 0.58);
    ctx.quadraticCurveTo(-u * 0.22, u * 0.30, u * 0.06, u * 0.58);
    ctx.quadraticCurveTo(-u * 0.24, u * 0.78, -u * 0.54, u * 0.58);
    ctx.closePath();
    ctx.fillStyle = I.INK + '0.7)';
    ctx.fill();
    ctx.restore();
  };

  /* ---------------- 谷物 ----------------
     每种 4 个阶段：0 芽 / 1 苗 / 2 长成 / 3 可收
     cw/ch = 该格在画面上的实际像素宽高。
     缩放基准必须是「格高」不是格宽：格宽在近处能到 190px，
     拿它当基准植株会窜到隔壁畦去（一版就是这么把 5 行田种成 5 丛高杆的）。 */
  I.grain = function (ctx, kind, stage, cx, baseY, cw, ch) {
    var w = cw, h0 = ch;
    if (stage <= 0) {
      I.brush(ctx, [[cx, baseY], [cx - w * 0.05, baseY - h0 * 0.16]], h0 * 0.05, h0 * 0.03, I.QING, 0.82);
      I.brush(ctx, [[cx, baseY], [cx + w * 0.05, baseY - h0 * 0.15]], h0 * 0.05, h0 * 0.03, I.QING, 0.82);
      return;
    }
    // 成熟时约一个半格高，既立得住又不越界到邻格
    var h = Math.min(h0 * (0.55 + 0.32 * stage), w * 0.52);
    var top = baseY - h;
    var span = w * 0.34;          // 横向铺开的一半宽度
    var lw = h0 * 0.045;          // 笔锋粗细跟着格高走

    if (kind === 'dou') {          // 豆：低矮丛生圆叶
      var n = 4 + stage;
      for (var i = 0; i < n; i++) {
        var t = i / (n - 1) - 0.5;
        var bx = cx + t * span * 2;
        var bh = h * (0.62 + 0.30 * Math.cos(t * 2.6));
        I.brush(ctx, [[bx, baseY], [bx + t * w * 0.06, baseY - bh]], lw, lw * 0.5, I.QING, 0.86);
        I.dot(ctx, bx + t * w * 0.06, baseY - bh, h0 * 0.17, I.QING, 0.72);
        I.dot(ctx, bx + t * w * 0.02, baseY - bh * 0.55, h0 * 0.12, I.QING, 0.6);
      }
      if (stage >= 3) {
        I.dot(ctx, cx - span * 0.55, baseY - h * 0.62, h0 * 0.10, I.INK, 0.72);
        I.dot(ctx, cx + span * 0.62, baseY - h * 0.70, h0 * 0.09, I.INK, 0.72);
      }
      return;
    }

    if (kind === 'ju') {           // 菊：低矮 + 藤黄花头
      I.brush(ctx, [[cx, baseY], [cx - w * 0.03, top]], lw * 1.1, lw * 0.5, I.QING, 0.86);
      I.brush(ctx, [[cx, baseY], [cx + w * 0.04, top + h * 0.22]], lw, lw * 0.5, I.QING, 0.8);
      for (var k = 0; k < 3; k++) {
        var a = -0.9 + k * 0.9;
        I.brush(ctx, [[cx - w * 0.03, top + h * 0.06],
                      [cx - w * 0.03 + Math.cos(a) * w * 0.08, top - h * 0.02 + Math.sin(a) * h * 0.05]],
               lw * 0.6, lw * 0.3, I.QING, 0.7);
      }
      if (stage >= 2) {
        I.dot(ctx, cx - w * 0.03, top, h0 * 0.19, I.TENG, 0.94);
        I.dot(ctx, cx + w * 0.04, top + h * 0.20, h0 * 0.14, I.TENG, 0.85);
      }
      return;
    }

    // 粟 / 黍 / 稷：立秆，顶端分别是饱满谷穗、散开穗帚、下垂谷穗
    var isTeng = (kind === 'su' || kind === 'shu');
    var stalks = 6;
    for (var s = 0; s < stalks; s++) {
      var u2 = s / (stalks - 1) - 0.5;
      var sx = cx + u2 * span * 2;
      var sh = h * (0.80 + 0.20 * Math.cos(u2 * 2.0));
      var st = baseY - sh;
      I.brush(ctx, [[sx, baseY], [sx + u2 * w * 0.04, st]], lw, lw * 0.45, isTeng ? I.TENG : I.QING, 0.86);
      if (stage >= 2) {   // 叶
        I.brush(ctx, [[sx, st + sh * 0.36], [sx - span * 0.34, st + sh * 0.20]], lw * 0.6, lw * 0.25, I.QING, 0.72);
      }
      if (stage >= 3) {
        if (kind === 'ji') {
          // 稷：下垂的谷穗
          I.brush(ctx, [[sx, st], [sx - h0 * 0.10, st + h0 * 0.18], [sx - h0 * 0.05, st + h0 * 0.33]],
                  h0 * 0.10, h0 * 0.045, I.TENG, 0.92);
        } else if (kind === 'shu') {
          // 黍：散开的穗帚
          for (var f = -1; f <= 1; f++) {
            I.brush(ctx, [[sx, st], [sx + f * h0 * 0.14, st - h0 * 0.24]], lw * 0.55, lw * 0.2, I.TENG, 0.82);
          }
          I.dot(ctx, sx, st - h0 * 0.03, h0 * 0.09, I.INK, 0.62);
        } else {
          // 粟：饱满的穗
          I.dot(ctx, sx, st - h0 * 0.07, h0 * 0.14, I.TENG, 0.94);
          I.brush(ctx, [[sx, st - h0 * 0.10], [sx + h0 * 0.02, st - h0 * 0.26]], lw * 0.55, lw * 0.2, I.TENG, 0.82);
        }
      }
    }
  };

  /* ---------------- 地块 ---------------- */
  /* 翻好的土：沿格子四边形填一层赭墨，湿土更深。

     **底色和垄沟都得跟着梯形走。** 南山那片田是斜的 ——
     实测一格高 74px、上边中心 703 / 下边中心 646（横移 57px），
     而原来这里是「一个旋转角写死 0 的椭圆 + 三条严格水平的垄沟线」：
     椭圆切进梯形后边界一半斜一半平；垄沟线是 0° 水平，
     底图那层水墨垄纹约 25°、土地本身约 48°，三套方向互相打架。
     看着就是「深色块的方向跟土地对不上」，翻过的地比翻之前还乱。 */
  I.soil = function (ctx, quad, wet, k) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(quad[0][0], quad[0][1]);
    for (var i = 1; i < 4; i++) ctx.lineTo(quad[i][0], quad[i][1]);
    ctx.closePath();
    ctx.clip();

    // 底色：椭圆转到梯形主轴上（远边中心 → 近边中心）。
    // **必须比底图深，不能用浅棕。** 半透明的浅棕叠在深色垄纹上会把垄纹**洗淡**，
    // 而叠在浅土面上又变深 —— 一格之内两个方向相反，整格对比度一掉，
    // 看着就「灰、糊」，翻过的地反倒不如翻之前的清爽（实测翻过的格饱和度掉一档）。
    // 所以改成一层**比底图深的褐**，只加深、不洗淡。
    var cx = 0, cy = 0;
    for (var j = 0; j < 4; j++) { cx += quad[j][0]; cy += quad[j][1]; }
    cx /= 4; cy /= 4;
    var tx = (quad[0][0] + quad[1][0]) / 2, ty = (quad[0][1] + quad[1][1]) / 2;
    var nx = (quad[3][0] + quad[2][0]) / 2, ny = (quad[3][1] + quad[2][1]) / 2;
    var rot = Math.atan2(ny - ty, nx - tx);
    var along = Math.sqrt((nx - tx) * (nx - tx) + (ny - ty) * (ny - ty));
    var across = (Math.abs(quad[1][0] - quad[0][0]) + Math.abs(quad[2][0] - quad[3][0])) / 2;
    // **长轴给 across、短轴给 along**：ellipse 的 rx 是旋转前的 x 轴半径，
    // 而梯形的横跨方向才是「宽」的那一条（195 vs 94）
    I.wash(ctx, cx, cy, across * 0.62, along * 0.72,
           wet ? 'rgba(58,42,30,' : 'rgba(96,72,52,', wet ? 0.34 : 0.20, rot);

    // 垄沟：走过三次弯路（平行左右边 → 水平 → 沿进深），2026-10-26 作者实玩
    // 圈出红框后的最终裁决不是「角度」而是「融合」—— 原先三条又细又密又
    // 均匀的线，压在手绘的粗垄旁边读成另一种纹理。现在的画法：
    // 两道**又粗又深**的沟（间距对齐底图近景垄距约 1/3 格），再撒一层
    // 碎土星子 —— 「翻过」读作「锄松的土」，跟手绘垄融成一块地
    var n = 2;
    for (var c = 0; c < n; c++) {
      var v = 0.34 + c * 0.35;
      I.brush(ctx, [I.quadAt(quad, 0.07, v), I.quadAt(quad, 0.93, v)],
              along * 0.095, along * 0.095, I.INK, wet ? 0.40 : 0.30);
    }
    for (var i = 0; i < 7; i++) {
      var d1 = (i * 137.5) % 100 / 100, d2 = (i * 61.8) % 100 / 100;
      var pt = I.quadAt(quad, 0.15 + d1 * 0.7, 0.12 + d2 * 0.76);
      I.dot(ctx, pt[0], pt[1], along * (0.018 + d2 * 0.022), I.INK, wet ? 0.30 : 0.24);
    }
    ctx.restore();
  };

  /* ---------------- 劳动特效 ----------------
     翻土 / 下种 / 浇水 / 收获各给一小段程序化的水墨特效（0.9s，进度驱动、
     无随机 —— 同一进度永远同一画面）。人物只有一张站姿贴图，姿态层面
     用「前倾 + 快频起伏」表达干活，特效负责把「在干哪一件事」说清楚。
     p ∈ [0,1]，s 是场景比例（跟 I.drawFig 的 u 同源）。 */

  // 锄：一道从肩后扫到脚前的挥弧，末端几粒土星子飞起来落回去
  I.workHoe = function (ctx, x, y, s, p) {
    var a = Math.sin(p * Math.PI);                       // 起手-落下-收，弧线中段最实
    I.brush(ctx, [[x - s * 0.26, y - s * (0.30 - p * 0.22)], [x + s * 0.10, y - s * (0.08 - p * 0.04)]],
           s * 0.035, s * 0.014, I.INK, 0.55 * a);
    I.brush(ctx, [[x - s * 0.10, y - s * 0.06], [x + s * 0.22, y - s * 0.02]],
           s * 0.05 * a + s * 0.012, s * 0.02 * a, I.INK, 0.4 * a);
    for (var i = 0; i < 5; i++) {
      var d = (i * 137.5) % 100 / 100;                   // 确定性散布
      var px = x + s * (0.12 + d * 0.3) * (p - 0.35) * 2.2;
      var py = y - s * (0.05 + d * 0.12) * Math.sin(Math.min(1, p * 1.6) * Math.PI);
      if (p > 0.25) I.dot(ctx, px, py, s * (0.016 + d * 0.012) * (1 - p * 0.5), I.INK, 0.5 * a);
    }
  };

  // 浇水：瓢口一道下落的水弧（淡青），落点一圈洇湿，尾段水珠收干
  I.workWater = function (ctx, x, y, s, p) {
    var a = Math.sin(p * Math.PI);
    // 双笔：一道墨线压形，一道青晕铺水 —— 只用青的话在水色底图上看不见
    I.brush(ctx, [[x - s * 0.08, y - s * 0.40], [x + s * 0.14, y - s * 0.05]],
           s * 0.030 * a + s * 0.008, s * 0.016 * a, I.INK, 0.55 * a);
    I.brush(ctx, [[x - s * 0.05, y - s * 0.36], [x + s * 0.12, y - s * 0.06]],
           s * 0.050 * a + s * 0.010, s * 0.022 * a, I.QING, 0.62 * a);
    for (var i = 0; i < 7; i++) {
      var d = (i * 219.7) % 100 / 100;
      var py = y - s * 0.32 + (p * 1.4 - d * 0.3) * s * 0.28;
      if (py > y - s * 0.04 && p < 0.92) I.dot(ctx, x + s * (0.02 + d * 0.20), py, s * 0.020 + s * 0.008 * d, I.INK, 0.5 * a);
    }
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x + s * 0.08, y - s * 0.015, s * (0.12 + p * 0.12), s * 0.038, 0, 0, Math.PI * 2);
    ctx.strokeStyle = I.INK + (0.32 * a) + ')';
    ctx.lineWidth = s * 0.014;
    ctx.stroke();
    ctx.restore();
  };

  // 下种：手前一把种子扇形撒出去，落地成几个小点
  I.workSow = function (ctx, x, y, s, p) {
    var a = Math.sin(Math.min(1, p * 1.3) * Math.PI);
    for (var i = 0; i < 6; i++) {
      var d = (i * 173.3) % 100 / 100;
      var spread = (d - 0.5) * 0.5;
      var px = x + s * (0.05 + p * 0.30) * (0.6 + d * 0.8);
      var py = y - s * (0.34 - p * 0.26) - Math.abs(spread) * s * 0.10;
      if (p < 0.85) I.dot(ctx, px + spread * s * 0.3, py, s * (0.020 + d * 0.010), I.INK, 0.62 * a);
      else I.dot(ctx, px + spread * s * 0.3, y - s * 0.02, s * 0.015, I.INK, 0.40 * a);
    }
  };

  // 收获：一束作物从地里升到手上，尾段整束淡出（进了篮）
  I.workHarvest = function (ctx, x, y, s, p, tint) {
    var a = Math.sin(p * Math.PI);
    var rise = (1 - Math.pow(1 - p, 2)) * s * 0.30;
    var col = tint || I.QING;
    I.brush(ctx, [[x - s * 0.05, y - s * 0.02], [x - s * 0.02, y - s * 0.06 - rise]],
           s * 0.030, s * 0.014, col, 0.65 * a);
    I.brush(ctx, [[x + s * 0.06, y - s * 0.02], [x + s * 0.04, y - s * 0.08 - rise]],
           s * 0.026, s * 0.012, col, 0.55 * a);
    I.dot(ctx, x, y - s * 0.12 - rise, s * 0.040, col, 0.5 * a);
    I.dot(ctx, x, y - s * 0.02, s * 0.05, I.INK, 0.25 * a);
  };

  /* 四边形内的点：u 沿进深（上边→下边），v 沿横跨（左边→右边）。
     放模块级而不是写在 I.soil 里 —— I.soil 每帧每格都调，
     里头再 new 一个闭包就是每帧白扔几十个函数对象。 */
  I.quadAt = function (q, u, v) {
    var ax = q[0][0] + (q[3][0] - q[0][0]) * u, ay = q[0][1] + (q[3][1] - q[0][1]) * u;
    var bx = q[1][0] + (q[2][0] - q[1][0]) * u, by = q[1][1] + (q[2][1] - q[1][1]) * u;
    return [ax + (bx - ax) * v, ay + (by - ay) * v];
  };

  /* 选中格：淡淡的朱砂圈，不抢画面 */
  I.markCell = function (ctx, quad) {
    ctx.save();
    ctx.strokeStyle = 'rgba(178,58,40,0.72)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([9, 7]);
    ctx.beginPath();
    ctx.moveTo(quad[0][0], quad[0][1]);
    for (var i = 1; i < 4; i++) ctx.lineTo(quad[i][0], quad[i][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  };

  // 验收用：离屏把人物画出来量（「量画出来的东西，不是读代码猜的」）
  FG.drawFigSprite = I.drawFig;
  FG.drawFigWork = I.drawFigWork;

})(window.FG = window.FG || {});
