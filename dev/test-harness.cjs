const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');

// This harness evaluates production logic unmodified. Only the DOM, drawing,
// audio and clock are faked. It does not copy any game rules.
function boot(saved) {
  const nodes = new Map();
  const handlers = {};
  const data = Object.assign({}, saved || {});
  const writes = [];
  const sounds = [];
  let timer = 0;
  const draw = new Proxy({}, {get(o, k) { return o[k] || (o[k] = () => {}); }});
  function element(id) {
    if (nodes.has(id)) return nodes.get(id);
    const classes = new Set(['hide']);
    const el = {
      id, style: {}, textContent: '', innerHTML: '', clientWidth: 1920, clientHeight: 1080,
      classList: { add(k) { classes.add(k); }, remove(k) { classes.delete(k); },
        contains(k) { return classes.has(k); }, toggle(k, yes) { if (yes === undefined) yes = !classes.has(k); if (yes) classes.add(k); else classes.delete(k); } },
      listeners: {}, addEventListener(k, fn) { (this.listeners[k] || (this.listeners[k] = [])).push(fn); },
      getContext() { return draw; }, getBoundingClientRect() { return {left: 0, top: 0, width: 1920, height: 1080}; },
      querySelector(k) { return element(id + k); }, querySelectorAll() { return []; },
      setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; },
      closest() { return this; }
    };
    nodes.set(id, el); return el;
  }
  const ctx = vm.createContext({
    console, Math, Date, JSON, Object, Array, Number, String, Boolean, Promise,
    setTimeout() { return ++timer; }, clearTimeout() {},
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    performance: {now() { return 0; }},
    localStorage: {getItem(k) { return data[k] || null; }, setItem(k,v) { data[k] = String(v); writes.push({key: k, value: String(v)}); },
      removeItem(k) { delete data[k]; }, clear() { Object.keys(data).forEach(k => delete data[k]); }},
    Image: function Image() {},
    document: {getElementById: element, createElement: element, addEventListener() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, elementFromPoint() { return element('game'); }},
    addEventListener(k, fn) { (handlers[k] || (handlers[k] = [])).push(fn); }
  });
  ctx.window = ctx;
  for (const file of ['core.js', 'field.js', 'data.js']) vm.runInContext(fs.readFileSync(root + '/js/' + file, 'utf8'), ctx, {filename: file});
  ctx.FG.INK = {loadFigs() {}, icon() {}};
  ctx.FG.audio = {muted: true, unlock() {}, play(k) { sounds.push(k); }, toggle() { return true; }};
  vm.runInContext(fs.readFileSync(root + '/js/game.js', 'utf8'), ctx, {filename: 'game.js'});
  const inline = fs.readFileSync(root + '/index.html', 'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  vm.runInContext(inline, ctx, {filename: 'index-inline.js'});
  for (const fn of handlers.DOMContentLoaded || []) fn();
  const FG = ctx.FG;
  return {ctx, FG, S: FG.state, nodes, data, writes, sounds, handlers,
    el: element, key(k) { for (const fn of handlers.keydown || []) fn({key: k, preventDefault() {}}); },
    sleep() { FG.houseRows().find(x => x.k === 'bed').go(); },
    next() { element('de-next').onclick(); }
  };
}

module.exports = {boot};
