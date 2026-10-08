// Production event/logic regressions. The shared VM mocks the DOM, canvas,
// audio and clock; this suite does not certify browser rendering or hit targets.
const test = require('node:test');
const assert = require('node:assert/strict');
const {boot} = require('./test-harness.cjs');

function fresh() {
  const e = boot();
  e.FG.startFrom('new');
  return e;
}
function visible(e, id) { return !e.el(id).classList.contains('hide'); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function dispatch(e, id, type, event) {
  const handlers = e.el(id).listeners[type] || [];
  assert.ok(handlers.length, id + ' must have a production ' + type + ' handler');
  for (const handler of handlers) handler(event);
}
function target(e, id, cls, attrs) {
  const el = e.el(id);
  el.classList.add(cls);
  for (const key of Object.keys(attrs || {})) el.setAttribute(key, attrs[key]);
  return el;
}
function fieldClick(e, col = 2, row = 2) {
  const p = e.FG.FIELD.cellCenter(col, row);
  dispatch(e, 'game', 'mousedown', {
    button: 0, clientX: p[0], clientY: p[1], offsetX: p[0], offsetY: p[1]
  });
}
function bagSeed(e, key) {
  e.key('Tab');
  assert.ok(visible(e, 'bg'), 'Tab must open the bag before selecting a seed');
  const i = e.FG.bagList().findIndex(item => item.k === key);
  assert.ok(i >= 0, 'The fixture must own this seed');
  const cv = e.el('bg-cv'), r = cv.getBoundingClientRect();
  // Bag cells are 74 px with an 8 px inset; use its actual production list and
  // canvas size. The assertions below verify the click selected the right item.
  const x = 8 + (i % e.FG.BAG_COLS) * 74 + 37;
  const y = 8 + Math.floor(i / e.FG.BAG_COLS) * 74 + 37;
  dispatch(e, 'bg-cv', 'click', {
    clientX: r.left + x / cv.width * r.width,
    clientY: r.top + y / cv.height * r.height
  });
  assert.equal(e.S.pendingSeed, key);
  assert.equal(visible(e, 'bg'), false);
}
function standAtNpc(e, id, map = 'nanshan') {
  const npc = e.FG.NPCS[id];
  e.FG.gotoMap(map, npc.at);
  assert.equal(e.FG.nearNpc().id, id, 'Fixture must be in the real interaction radius');
  return npc;
}
function readyFieldQuest(e) {
  const q = e.FG.QUESTS.find(item => item.from === 'linweng' && item.need.total === 'till');
  assert.ok(q);
  e.S.total[q.need.total] = q.need.n;
  e.FG.giveQuest(q);
  assert.ok(e.FG.questProgress(q).done);
  return q;
}
function clickGoods(e, item) {
  dispatch(e, 'sh-list', 'click', {
    target: target(e, 'test-goods-' + item.k, 'goods', {'data-k': item.k})
  });
}
function panelIds(e) {
  return ['de', 'dlg', 'st', 'sh', 'hs', 'rd', 'al', 'bg', 'ch', 'bx']
    .filter(id => visible(e, id));
}

test('背包拿种后，数字 1 恢复锄地', () => {
  const e = fresh();
  bagSeed(e, 'seedD');
  e.key('1');
  const stam = e.S.stam;
  fieldClick(e);
  assert.equal(e.S.pendingSeed, null);
  assert.equal(e.S.sel, 'chu');
  assert.equal(e.S.plots[2][2].tilled, true);
  assert.equal(e.S.stam, stam - e.FG.GEAR_STAM.chu);
});

test('背包拿种后，数字 2 能给已种下的作物浇水', () => {
  const e = fresh();
  e.key('1'); fieldClick(e);
  e.key('3'); fieldClick(e);
  assert.equal(e.S.plots[2][2].crop, 'dou');
  assert.equal(e.S.plots[2][2].wet, false);
  bagSeed(e, 'seedD');
  e.key('2');
  const seeds = e.FG.invGet('seedD');
  fieldClick(e);
  assert.equal(e.S.pendingSeed, null);
  assert.equal(e.S.sel, 'piao');
  assert.equal(e.S.plots[2][2].wet, true);
  assert.equal(e.FG.invGet('seedD'), seeds, 'Watering must not consume a held seed');
});

test('数字切换为另一种种子后，实际播种和工具栏选择一致', () => {
  const e = fresh();
  const crop = e.FG.CROPS.su;
  e.S.day = e.FG.SOLAR_IDX[crop.terms[0]] * e.FG.SOLAR_DAYS + 1;
  e.key('1'); fieldClick(e);
  bagSeed(e, 'seedD');
  const oldCount = e.FG.invGet('seedD'), newCount = e.FG.invGet('seedS');
  e.key('4'); fieldClick(e);
  assert.equal(e.S.pendingSeed, null);
  assert.equal(e.S.sel, crop.id);
  assert.equal(e.S.plots[2][2].crop, crop.id);
  assert.equal(e.FG.invGet('seedD'), oldCount);
  assert.equal(e.FG.invGet('seedS'), newCount - 1);
});

test('鼠标点击器物架也能取消背包手持种子', () => {
  const e = fresh();
  bagSeed(e, 'seedD');
  dispatch(e, 'tray', 'click', {
    target: target(e, 'test-tool-chu', 'slot', {'data-k': 'chu'})
  });
  fieldClick(e);
  assert.equal(e.S.pendingSeed, null);
  assert.equal(e.S.sel, 'chu');
  assert.equal(e.S.plots[2][2].tilled, true);
});

test('在商店买入新农具时取消手持种子，价格与货单一致', () => {
  const e = fresh();
  standAtNpc(e, 'xushi', 'xushi');
  bagSeed(e, 'seedD');
  const raw = e.FG.SHOP.xushi.find(item => item.kind === 'gear' && item.gear === 'chu' && item.lv === 1);
  const item = e.FG.shopItem(raw);
  e.S.gold = item.price * 2;
  const gold = e.S.gold;
  e.key('b');
  assert.ok(visible(e, 'sh'));
  clickGoods(e, raw);
  assert.equal(e.S.pendingSeed, null);
  assert.equal(e.S.gear[item.gear], item.lv);
  assert.equal(e.S.sel, item.gear);
  assert.equal(e.S.gold, gold - item.price);
});

for (const panel of [
  {id: 'bg', name: '行囊', open: e => e.key('Tab'), key: 'e'},
  {id: 'al', name: '诗册', open: e => e.key('v'), key: 'Enter'},
  {id: 'sh', name: '货单', open: e => e.key('b'), key: 'e'},
  {id: 'hs', name: '屋里', open: e => e.FG.openHouse(), key: 'e'},
  {id: 'rd', name: '歇脚处', open: e => e.FG.openStation(), key: 'Enter'}
]) {
  test(panel.name + '打开时，互动键不在背后打开对话或改动游戏状态', () => {
    const e = fresh();
    // Keeping a reachable NPC behind each production panel makes leaked input
    // observable. House/station use the same builders as their normal E actions.
    standAtNpc(e, 'xushi', 'xushi');
    panel.open(e);
    assert.deepEqual(panelIds(e), [panel.id]);
    const before = plain(e.S);
    e.key(panel.key);
    assert.deepEqual(panelIds(e), [panel.id]);
    assert.deepEqual(plain(e.S), before);
  });
}

test('没有递酒或托付动作时，E 和 Enter 可以继续普通对话', () => {
  const e = fresh();
  const npc = standAtNpc(e, 'linweng');
  e.key('e');
  assert.ok(visible(e, 'dlg'));
  assert.equal(visible(e, 'dlg-act'), false);
  assert.equal(visible(e, 'dlg-quest'), false);
  const relation = e.S.ren[npc.id].p;
  for (const key of ['e', 'Enter']) {
    const text = e.el('dlg-text').textContent;
    e.key(key);
    assert.ok(visible(e, 'dlg'));
    assert.notEqual(e.el('dlg-text').textContent, text);
    assert.ok(npc.lines.some(line => line[0] === e.el('dlg-text').textContent));
    assert.equal(e.S.ren[npc.id].p, relation, 'Continuing on the same day must not add friendship again');
  }
});

for (const pending of [
  {name: '递酒', wine: true, quest: false},
  {name: '交托付', wine: false, quest: true},
  {name: '递酒和交托付', wine: true, quest: true}
]) {
  test('有' + pending.name + '动作时，E 不误续句，点击动作仍有效', () => {
    const e = fresh();
    standAtNpc(e, 'linweng');
    if (pending.wine) e.FG.invGive('jiu', 1);
    const q = pending.quest ? readyFieldQuest(e) : null;
    e.key('e');
    assert.equal(visible(e, 'dlg-act'), pending.wine);
    assert.equal(visible(e, 'dlg-quest'), pending.quest);
    const before = plain(e.S);
    let text = e.el('dlg-text').textContent, textWrites = 0;
    Object.defineProperty(e.el('dlg-text'), 'textContent', {
      configurable: true, get() { return text; }, set(value) { text = value; textWrites++; }
    });
    e.key('e'); e.key('Enter');
    assert.equal(textWrites, 0, 'Pending actions must not replay even an identical quest line');
    assert.deepEqual(plain(e.S), before);
    if (pending.wine) {
      const wine = e.FG.invGet('jiu');
      e.el('dlg-act').onclick({stopPropagation() {}});
      assert.equal(e.FG.invGet('jiu'), wine - 1);
    }
    if (pending.quest) {
      e.el('dlg-quest').onclick({stopPropagation() {}});
      assert.equal(e.S.quest[q.id], 'done');
    }
  });
}

test('首次变熟时显示新 NPC 的专属对话，并清除上一位的递酒和托付按钮', () => {
  const e = fresh();
  standAtNpc(e, 'linweng');
  e.FG.invGive('jiu', 1); readyFieldQuest(e); e.key('e');
  assert.ok(visible(e, 'dlg-act') && visible(e, 'dlg-quest'));
  e.key('Escape');
  const npc = standAtNpc(e, 'caijuweng');
  const step = e.FG.REN[npc.id][0];
  e.S.ren[npc.id].p = step.at - e.FG.REN_SPEECH;
  e.key('e');
  assert.ok(visible(e, 'dlg'));
  assert.equal(e.el('dlg-text').textContent, step.v);
  assert.ok(e.el('dlg-name').textContent.includes(npc.name));
  assert.equal(e.S.ren[npc.id].tier, e.FG.renTier(npc.id));
  assert.equal(visible(e, 'dlg-act'), false);
  assert.equal(visible(e, 'dlg-quest'), false);
});

test('首次相知时显示对话和当前可用动作，礼物只给一次', () => {
  const e = fresh();
  const npc = standAtNpc(e, 'linweng');
  const levels = e.FG.REN[npc.id], step = levels[levels.length - 1];
  e.S.ren[npc.id].p = step.at - e.FG.REN_SPEECH;
  e.S.ren[npc.id].tier = levels.length - 1;
  e.FG.invGive('jiu', 1); readyFieldQuest(e);
  assert.ok(step.gift);
  const gift = e.FG.invGet(step.gift);
  e.key('e');
  assert.ok(visible(e, 'dlg'));
  assert.equal(e.el('dlg-text').textContent, step.v);
  assert.equal(e.S.ren[npc.id].tier, levels.length);
  assert.ok(visible(e, 'dlg-act') && visible(e, 'dlg-quest'));
  assert.equal(e.FG.invGet(step.gift), gift + 1);
  e.key('Escape'); e.key('e');
  assert.equal(e.FG.invGet(step.gift), gift + 1);
});

test('买种子只扣货单价格并增加对应库存，钱不足时不扣款', () => {
  const e = fresh();
  standAtNpc(e, 'xushi', 'xushi'); e.key('b');
  const raw = e.FG.SHOP.xushi.find(item => item.kind === 'seed' && item.crop === 'dou');
  const item = e.FG.shopItem(raw), seeds = e.FG.invGet(item.k), gold = e.S.gold;
  clickGoods(e, raw);
  assert.equal(e.S.gold, gold - item.price);
  assert.equal(e.FG.invGet(item.k), seeds + 1);
  e.S.gold = item.price - 1;
  clickGoods(e, raw);
  assert.equal(e.S.gold, item.price - 1);
  assert.equal(e.FG.invGet(item.k), seeds + 1);
});

test('木箱的实际存取按钮往返后，库存总数保持一致', () => {
  const e = fresh();
  e.S.player.x = e.FG.CHEST.at[0]; e.S.player.y = e.FG.CHEST.at[1];
  e.key('e');
  assert.ok(visible(e, 'ch'));
  const k = 'seedD', count = e.FG.invGet(k);
  dispatch(e, 'ch-hand', 'click', {shiftKey: true,
    target: target(e, 'test-chest-hand', 'bxh', {'data-k': k})});
  assert.equal(e.FG.invGet(k), 0);
  assert.equal(e.S.chest[k], count);
  dispatch(e, 'ch-in', 'click', {shiftKey: true,
    target: target(e, 'test-chest-in', 'bxl', {'data-k': k})});
  assert.equal(e.FG.invGet(k), count);
  assert.equal(e.S.chest[k] || 0, 0);
});

test('从实际出口按 E 换图，出生点、田亩拾取和触屏行走状态正确切换', () => {
  const e = fresh();
  for (const to of ['xushi', 'nanshan']) {
    const exit = e.FG.MAPS[e.S.map].exits.find(item => item.to === to);
    assert.ok(exit);
    e.S.player.x = exit.at[0]; e.S.player.y = exit.at[1];
    e.S.walkTo = exit.at.slice(); e.S.touchGo = true;
    e.key('e');
    const map = e.FG.MAPS[to];
    assert.equal(e.S.map, to);
    assert.deepEqual([e.S.player.x, e.S.player.y], Array.from(exit.spawn));
    assert.equal(e.S.walkTo, null);
    assert.equal(e.S.touchGo, false);
    assert.ok(e.S.vis[to]);
    assert.equal(!!e.FG.FIELD.on, !!map.quad);
    assert.ok(e.S.player.x >= map.bounds.x0 && e.S.player.x <= map.bounds.x1);
    assert.ok(e.S.player.y >= map.bounds.y0 && e.S.player.y <= map.bounds.y1);
    assert.equal(visible(e, 'dlg'), false);
  }
});
