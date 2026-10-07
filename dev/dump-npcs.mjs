// 把 data.js 里的站位/身高导成 JSON，给 Python 侧的合成验收图用。
// 手抄一份 at/unit 迟早会抄错，直接读真数据。
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const GUX = path.resolve(here, '..');

globalThis.window = {};
require(path.join(GUX, 'js', 'data.js'));
const FG = globalThis.window.FG;
if (!FG) throw new Error('data.js 没挂上 window.FG');

const maps = {};
for (const id in FG.MAPS) {
  const m = FG.MAPS[id];
  maps[id] = {
    bg: m.bg, spawn: m.spawn, npcs: m.npcs,
    dTop: m.dTop || 500, dBot: m.dBot || 872
  };
}
const npcs = {};
for (const id in FG.NPCS) {
  npcs[id] = { at: FG.NPCS[id].at, unit: FG.NPCS[id].unit, name: FG.NPCS[id].name };
}
process.stdout.write(JSON.stringify({ maps, npcs }, null, 1));
if (process.argv[2]) {
  // 走 PowerShell 的 > 重定向会写成 UTF-16，Python 读不了。自己落盘。
  fs.writeFileSync(process.argv[2], JSON.stringify({ maps, npcs }, null, 1), 'utf8');
}
