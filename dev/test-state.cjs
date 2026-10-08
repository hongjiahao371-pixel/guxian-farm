// Deterministic state and event regressions. This is not a browser rendering test.
const assert = require('node:assert/strict');
const test = require('node:test');
const {boot} = require('./test-harness.cjs');

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function start() { const e = boot(); e.FG.startFrom('new'); return e; }
function reload(e, slot) {
  const next = boot(e.data);
  next.S.slot = slot === undefined ? e.S.slot : slot;
  next.FG.startFrom('cont');
  return next;
}
function saved(e, slot) { return JSON.parse(e.data[e.FG.saveKey(slot === undefined ? e.S.slot : slot)]); }
function visible(e, id) { return !e.el(id).classList.contains('hide'); }
function mature(e) {
  e.S.plots[0][0] = {tilled: true, wet: false, crop: 'dou', stage: e.FG.CROPS.dou.days, cut: 0};
}

test('Esc retains a usable daily settlement and its morning button', () => {
  const e = start(); e.sleep(); e.key('Escape');
  assert.equal(e.S.ended, true);
  assert.equal(visible(e, 'de'), true);
  assert.match(e.el('toast').textContent, /晨兴/);
  e.next();
  assert.equal(e.S.day, 2);
  assert.equal(e.S.ended, false);
  assert.equal(visible(e, 'de'), false);
});

test('continue preserves time, stamina, cooking allowance, weather and wine age', () => {
  const e = start();
  e.S.day = 145; e.S.min = 1020; e.S.stam = 8; e.S.cookN = 1;
  e.S.weather = 'rain'; e.S.jiu = 2; e.S.jiuYear = [1, 2];
  e.FG.saveGame();
  const f = reload(e);
  assert.equal(f.S.day, 145); assert.equal(f.S.min, 1020);
  assert.equal(f.S.stam, 8); assert.equal(f.S.cookN, 1);
  assert.equal(f.S.weather, 'rain'); assert.deepEqual(plain(f.S.jiuYear), [1, 2]);
  assert.equal(f.FG.wineAge(), 1);
});

test('cooking remains exhausted after reloading a completed recipe', () => {
  const e = start(); e.S.bag.dou = 6;
  assert.equal(e.FG.cook(e.FG.RECIPES.find(r => r.id === 'jiang')), true);
  assert.equal(e.FG.canCook(), false);
  const f = reload(e);
  assert.equal(f.S.cookN, 1); assert.equal(f.S.made.jiang, 1);
  assert.equal(f.S.bag.dou, 4); assert.equal(f.FG.canCook(), false);
});

test('every completed till is saved together with its skill and lifetime counts', () => {
  const e = start(); e.writes.length = 0; e.sounds.length = 0;
  e.FG.workArea('chu', 0, 0); e.FG.workArea('chu', 1, 0);
  assert.equal(e.writes.length, 2);
  const first = JSON.parse(e.writes[0].value);
  assert.equal(first.total.till, 1); assert.equal(first.skill.geng.pt, 1);
  const f = reload(e);
  assert.equal(f.S.plots[0][0].tilled, true); assert.equal(f.S.plots[0][1].tilled, true);
  assert.equal(f.S.total.till, 2); assert.equal(f.S.skill.geng.pt, 2);
  assert.deepEqual(e.sounds, ['hoe', 'hoe']);
});

test('sowing and watering survive reload without waiting for another achievement', () => {
  const e = start();
  for (let c = 0; c < 2; c++) { e.FG.workArea('chu', c, 0); e.FG.sowWith('dou', c, 0); e.FG.workArea('piao', c, 0); }
  const f = reload(e);
  for (let c = 0; c < 2; c++) { assert.equal(f.S.plots[0][c].crop, 'dou'); assert.equal(f.S.plots[0][c].wet, true); }
  assert.equal(f.S.seeds.dou, e.S.seeds.dou); assert.equal(f.S.stam, e.S.stam);
  assert.deepEqual(plain(f.S.skill), plain(e.S.skill));
});

test('first harvest writes one complete snapshot and cannot duplicate a ripe crop', () => {
  const e = start(); mature(e); e.writes.length = 0;
  e.FG.harvest(0, 0);
  assert.equal(e.writes.length, 1);
  const record = JSON.parse(e.writes[0].value);
  assert.equal(record.plots[0][0].crop, null); assert.equal(record.bag.dou, 1);
  assert.equal(record.got.dou, true);
  const f = reload(e); f.FG.harvest(0, 0);
  assert.equal(f.S.plots[0][0].crop, null); assert.equal(f.S.bag.dou, 1);
});

test('a successful catch saves the catch count and closes the fishing session', () => {
  const e = start(); e.FG.cast({i: 0, spot: {at: [560, 500]}});
  e.S.fishing.phase = 'bite'; e.writes.length = 0;
  e.FG.reel();
  assert.equal(e.writes.length, 1);
  const f = reload(e);
  assert.equal(f.S.fishing, null); assert.equal(f.S.catchCount, 1); assert.equal(f.S.total.catch, 1);
  assert.equal(Object.values(f.S.pouch).reduce((a, b) => a + b, 0), 1);
});

test('daily settlement reloads without reselling goods or growing crops again', () => {
  let e = start(); e.S.bin.crop_dou = 2;
  e.S.plots[0][0] = {tilled: true, wet: true, crop: 'dou', stage: 0, cut: 0};
  e.writes.length = 0; e.sleep();
  assert.equal(e.writes.length, 1);
  const gold = e.S.gold; const body = e.el('de').querySelector('.body').innerHTML;
  assert.equal(gold, 500 + e.FG.BAG_IDX.crop_dou.sell * 2);
  assert.equal(e.S.plots[0][0].stage, 1);
  assert.equal(saved(e).dayEnd.kind, 'day');
  for (let i = 0; i < 3; i++) {
    e = reload(e);
    assert.equal(e.S.ended, true); assert.equal(visible(e, 'de'), true);
    assert.equal(e.S.gold, gold); assert.equal(e.S.plots[0][0].stage, 1);
    assert.equal(e.el('de').querySelector('.body').innerHTML, body);
  }
  e.next();
  assert.equal(e.S.day, 2); assert.equal(e.S.plots[0][0].stage, 1);
});

test('dawn persists the new day and clears the pending settlement', () => {
  const e = start(); e.sleep(); e.next();
  assert.equal(saved(e).day, 2); assert.equal(saved(e).dayEnd, null);
  const f = reload(e);
  assert.equal(f.S.day, 2); assert.equal(f.S.ended, false); assert.equal(visible(f, 'de'), false);
});

test('year review survives reload and acknowledgement neither skips a day nor feeds twice', () => {
  let e = start(); e.S.day = e.FG.SOLAR_YEAR;
  e.S.book.crops.dou = 12; e.S.book.earned = 1234;
  e.S.build.coop = 1; e.S.keep.coop = {gate: 1, feed: 3, got: 0};
  e.sleep(); e.next();
  assert.equal(e.S.day, 145); assert.equal(e.S.dayEnd.kind, 'year'); assert.equal(e.S.ended, true);
  assert.equal(e.S.keep.coop.feed, 2); assert.equal(e.S.keep.coop.got, 1);
  const body = e.el('de').querySelector('.body').innerHTML;
  assert.match(body, /豆 12/); assert.match(body, /1234/);
  assert.equal(e.S.book.first, 145); assert.equal(e.S.book.earned, 0);
  e = reload(e); e.key('Escape');
  assert.equal(visible(e, 'de'), true);
  assert.equal(e.el('de').querySelector('.body').innerHTML, body);
  assert.equal(e.el('de-next').textContent, '明 春');
  e.next();
  assert.equal(e.S.day, 145); assert.equal(e.FG.dayOfYear(e.S.day), 1);
  assert.equal(e.S.keep.coop.feed, 2); assert.equal(e.S.keep.coop.got, 1);
  assert.equal(e.S.dayEnd, null); assert.equal(e.S.ended, false);
  e = reload(e);
  assert.equal(e.S.day, 145); assert.equal(visible(e, 'de'), false);
});

test('legacy ended saves complete wet crop growth once without recrediting money', () => {
  const source = start(); const old = saved(source);
  delete old.dayEnd;
  old.ended = true; old.gold = 888; old.earned = 388; old.bin = {};
  old.plots[0][0] = {tilled: true, wet: true, crop: 'dou', stage: 0, cut: 0};
  source.data[source.FG.saveKey(0)] = JSON.stringify(old);
  let e = reload(source);
  assert.equal(e.S.gold, 888); assert.equal(e.S.earned, 388);
  assert.equal(e.S.plots[0][0].stage, 1); assert.equal(e.S.dayEnd.legacy, true);
  assert.equal(visible(e, 'de'), true);
  e = reload(e);
  assert.equal(e.S.gold, 888); assert.equal(e.S.plots[0][0].stage, 1);
  e.next(); assert.equal(e.S.day, 2);
});

test('legacy ended saves with already dry crops do not grow them a second time', () => {
  const source = start(); const old = saved(source);
  delete old.dayEnd; old.ended = true;
  old.plots[0][0] = {tilled: true, wet: false, crop: 'dou', stage: 1, cut: 0};
  source.data[source.FG.saveKey(0)] = JSON.stringify(old);
  const e = reload(source);
  assert.equal(e.S.plots[0][0].stage, 1);
});

test('switching to an old slot uses its own defaults and preserves the selected save key', () => {
  const e = start(); e.S.day = 145; e.S.jiu = 3; e.S.jiuYear = [1, 1, 1]; e.S.jiuPts.linweng = 2;
  e.S.cookN = 2; e.sleep(); const first = e.data[e.FG.saveKey(0)];
  e.data[e.FG.saveKey(1)] = JSON.stringify({day: 33, gold: 1200, map: 'nanshan', slot: 0, plots: [], player: {x: 900, y: 800}});
  e.S.slot = 1; e.FG.startFrom('cont');
  assert.equal(e.S.slot, 1); assert.equal(e.S.day, 33); assert.equal(e.S.gold, 1200);
  assert.equal(e.S.dayEnd, null); assert.equal(e.S.ended, false);
  assert.equal(e.S.jiu, 0); assert.deepEqual(plain(e.S.jiuYear), []); assert.deepEqual(plain(e.S.jiuPts), {});
  assert.equal(e.S.cookN, 0); assert.equal(e.data[e.FG.saveKey(0)], first);
  assert.equal(saved(e, 1).slot, 1);
});

test('new game and restart reset the same full state while preserving other slots', () => {
  const e = start(); const first = e.data[e.FG.saveKey(0)];
  e.S.slot = 1; e.FG.startFrom('new');
  e.S.jiuPts.linweng = 2; e.S.dog = {day: 140, n: 8, k: 'good_mei'};
  e.S.book.earned = 50000; e.S.sel = 'jue'; e.sleep();
  e.FG.restart();
  assert.equal(e.S.slot, 1); assert.equal(e.S.day, 1); assert.equal(e.S.stam, 100);
  assert.equal(e.S.ended, false); assert.equal(e.S.dayEnd, null); assert.equal(e.S.sel, 'chu');
  assert.deepEqual(plain(e.S.jiuPts), {}); assert.equal(e.S.dog.n, 0); assert.equal(e.S.book.earned, 0);
  assert.equal(e.data[e.FG.saveKey(0)], first);
});

test('malformed JSON structures are marked bad and cannot mutate a live game', () => {
  const e = start(); e.FG.workArea('chu', 0, 0); e.S.slot = 1;
  const good = saved(e, 0);
  const malformed = [null, [], 3, {day: -1}, Object.assign({}, good, {player: null}),
    Object.assign({}, good, {player: {x: 'bad', y: 1}}), Object.assign({}, good, {plots: null}),
    Object.assign({}, good, {plots: [null]}), Object.assign({}, good, {skill: 3})];
  for (const bad of malformed) {
    e.data[e.FG.saveKey(1)] = JSON.stringify(bad);
    const before = JSON.stringify(e.S);
    if (!bad || !bad.skill) assert.equal(e.FG.slotInfo(1).bad, 1);
    assert.equal(e.FG.loadGame(), false);
    assert.equal(JSON.stringify(e.S), before);
    assert.doesNotThrow(() => e.FG.startFrom('cont'));
    assert.equal(JSON.stringify(e.S), before);
  }
});

test('repeated explicit saves are silent and retain the complete current state', () => {
  const e = start(); e.sounds.length = 0;
  e.S.min = 700; e.S.stam = 42;
  e.FG.saveGame(); e.FG.saveGame();
  assert.deepEqual(e.sounds, []);
  assert.equal(saved(e).min, 700); assert.equal(saved(e).stam, 42);
});
