/* ============================================================
   田亩几何：把逻辑网格铺到画上的梯形里
   ------------------------------------------------------------
   为什么不是 tile 地图：
   底图是手绘单幅水墨，菜畦是带透视的梯形 —— 没有规则方格可对齐。
   所以反过来做：先定死梯形四角，再把 (列,行) 双线性映射成屏幕四边形。
   一个格子 = 一个可以锄、种、浇、收的四边形。

   四角坐标是对着刻度网量出来的，不是估的。
   底图换了（重新出图/换构图）只要改这一个常量。
   ============================================================ */
(function (FG) {
  'use strict';

  var F = FG.FIELD = {};

  // 菜畦梯形四角：远端左 / 远端右 / 近端左 / 近端右
  // 近端 872 是量出来的：器物架实测占 y 882~962，把最近一行整个盖住了。
  // 近端必须留在架子顶边之上，五行才都露得出来、能点到。
  F.QUAD = [678, 500, 1336, 500, 232, 872, 1420, 872];
  F.COLS = 5;
  F.ROWS = 5;
  // 有田的地图才为 true。墟市那种整张画上没有田的图，切过去时置 false，
  // pick() 直接返回 null —— 否则退化四边形会让点哪都像点在第 0 格。
  F.on = true;
  // 透视缩放用的进深区间。墟市没有田，但人照样要按远近分大小，
  // 所以单独给一条：不然 scaleAtY 会拿退化的四边形去算，除零得 NaN。
  F.dTop = 500; F.dBot = 872;

  /* 按地图套梯形。底图换了 / 换地图，只要给新的四角。 */
  F.apply = function (map) {
    if (map && map.quad) {
      F.QUAD = map.quad.slice();
      F.COLS = map.cols; F.ROWS = map.rows; F.on = true;
      F.dTop = map.quad[1]; F.dBot = map.quad[5];
    } else {
      F.QUAD = [0, 0, 0, 0, 0, 0, 0, 0];
      F.COLS = 1; F.ROWS = 1; F.on = false;
      F.dTop = (map && map.dTop) || 480;
      F.dBot = (map && map.dBot) || 1050;
    }
  };

  /* 双线性插值：u 沿列 0..1，v 沿行 0..1（v=0 是画面深处） */
  F.pt = function (u, v) {
    var q = F.QUAD;
    var flx = q[0], fly = q[1], frx = q[2], fry = q[3];
    var nlx = q[4], nly = q[5], nrx = q[6], nry = q[7];
    var a = (1 - u) * (1 - v), b = u * (1 - v), c = (1 - u) * v, d = u * v;
    return [a * flx + b * frx + c * nlx + d * nrx,
            a * fly + b * fry + c * nly + d * nry];
  };

  /* 某格的四个角，顺时针：左上 右上 右下 左下 */
  F.cellQuad = function (col, row) {
    var u0 = col / F.COLS, u1 = (col + 1) / F.COLS;
    var v0 = row / F.ROWS, v1 = (row + 1) / F.ROWS;
    return [F.pt(u0, v0), F.pt(u1, v0), F.pt(u1, v1), F.pt(u0, v1)];
  };

  F.cellCenter = function (col, row) {
    return F.pt((col + 0.5) / F.COLS, (row + 0.5) / F.ROWS);
  };

  /* 该格的中线宽度，用来按透视缩放地块上的东西（远处的豆苗要小） */
  F.cellWidth = function (col, row) {
    var a = F.pt(col / F.COLS, (row + 0.5) / F.ROWS);
    var b = F.pt((col + 1) / F.COLS, (row + 0.5) / F.ROWS);
    return Math.abs(b[0] - a[0]);
  };

  F.cellHeight = function (col, row) {
    var a = F.pt((col + 0.5) / F.COLS, row / F.ROWS);
    var b = F.pt((col + 0.5) / F.COLS, (row + 1) / F.ROWS);
    return Math.abs(b[1] - a[1]);
  };

  /* 点是否在凸四边形内（射线法）。命中检测用这个而不是反解双线性 ——
     双线性逆不是线性方程，反解要解二次，容易在边界上抖；逐格做射线法
     25 个格子开销可忽略，且边界判定是精确的。 */
  function inQuad(px, py, p) {
    var inside = false;
    for (var i = 0, j = 3; i < 4; j = i++) {
      var xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
      if (((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  /* 屏幕坐标 -> [col,row]，没落在任何田里返回 null */
  F.pick = function (px, py) {
    if (!F.on) return null;
    for (var r = 0; r < F.ROWS; r++) {
      for (var c = 0; c < F.COLS; c++) {
        if (inQuad(px, py, F.cellQuad(c, r))) return [c, r];
      }
    }
    return null;
  };

  /* 人物在梯形之外时（茅舍、竹林、田埂）也要能站，
     所以另给一条"沿用最近一行深度"的缩放曲线：v=0 最小，v=1 最大。 */
  F.scaleAtY = function (py) {
    var top = F.dTop, bot = F.dBot;
    if (bot - top < 1) bot = top + 1;
    var t = (py - top) / (bot - top);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return 0.52 + 0.48 * t;
  };

})(window.FG = window.FG || {});
