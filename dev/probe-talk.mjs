// 互动审计：把各处按 E 之后的**回话**和**提示行**逐条打出来。
//
// 这不是验收，是一把尺子 —— 用来找「按了没反应」「回得含糊」
// 「提示和结果说的不是一件事」这三类。这个游戏的规矩是
// 「暗着的东西也要回一句话」，而这条规矩只能靠逐条看执行不执行。
//
// 用法：node dev/probe-talk.mjs
import { spawn } from 'child_process';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9415;
const profile = path.join(tmpdir(), 'guxian-talk-' + process.pid);
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
const key = async k => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k.length === 1 ? k : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
  await sleep(220);
};
const hint = () => ev(`document.getElementById('hint').textContent`);
const toast = () => ev(`document.getElementById('toast').textContent`);
const dlgOpen = () => ev(`!document.getElementById('dlg').classList.contains('hide')`);
const dlgText = () => ev(`document.getElementById('dlg-text').textContent`);
const panelOpen = () => ev(`(function(){ ['de','dlg','sh','st','bx','bg','ch','al','hs','rd']
  .filter(function(i){ var e=document.getElementById(i); return e && !e.classList.contains('hide'); }).join(',') })()`)