// 把所有验收/探针按顺序跑一遍，结果落到 dev/_all.log
// 端口逐个占着，所以只能串行 —— 这些脚本都是各自拉一个 chrome
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const LIST = [
  'shoot.mjs', 'shoot-xipan.mjs', 'shoot-solar.mjs', 'shoot-album.mjs',
  'shoot-ui.mjs', 'shoot-map.mjs', 'shoot-houshan.mjs', 'shoot-wine.mjs',
  'shoot-bag.mjs', 'shoot-stove.mjs', 'shoot-bin.mjs', 'shoot-gear.mjs',
  'shoot-mine.mjs', 'shoot-skill.mjs', 'shoot-quest.mjs', 'shoot-build.mjs', 'shoot-weather.mjs', 'shoot-season.mjs', 'shoot-chest.mjs', 'shoot-festival.mjs', 'shoot-machine.mjs', 'shoot-livestock.mjs', 'shoot-furn.mjs', 'shoot-road.mjs', 'shoot-warm.mjs', 'shoot-quality.mjs', 'shoot-dog.mjs', 'shoot-dex.mjs', 'shoot-birth.mjs', 'shoot-dusk.mjs', 'shoot-shop.mjs', 'shoot-ren.mjs', 'shoot-farm.mjs', 'shoot-slot.mjs', 'shoot-ux.mjs', 'shoot-narrow.mjs', 'shoot-walk.mjs', 'shoot-audio.mjs', 'probe-keys.mjs'
];
const SKIP = new Set((process.argv[2] || '').split(',').filter(Boolean));

const log = [];
let bad = 0;
for (const f of LIST) {
  if (SKIP.has(f)) continue;
  process.stdout.write(`\n######## ${f}\n`);
  const out = await new Promise(res => {
    const p = spawn(process.execPath, [path.join(DIR, f)], { cwd: path.join(DIR, '..') });
    let buf = '';
    p.stdout.on('data', d => { buf += d; process.stdout.write(d); });
    p.stderr.on('data', d => { buf += d; process.stdout.write(d); });
    p.on('close', code => res({ code, buf }));
  });
  const pass = (out.buf.match(/^  PASS /gm) || []).length;
  const fail = (out.buf.match(/^  FAIL /gm) || []).length;
  if (fail > 0 || out.code !== 0) bad++;
  log.push(`### ${f}  exit=${out.code}  PASS=${pass}  FAIL=${fail}`);
  if (out.buf.indexOf('LOGS (无报错)') < 0 && out.buf.indexOf('LOGS') >= 0) log.push('    !! 有控制台输出：\n' + out.buf.slice(out.buf.indexOf('LOGS')).slice(0, 800));
}
log.push(`\n==== 有问题的套件：${bad} / ${LIST.length} ====`);
writeFileSync(path.join(DIR, '_all.log'), log.join('\n'), 'utf8');
console.log('\n' + log.join('\n'));
