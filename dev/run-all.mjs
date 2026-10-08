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
const USAGE = [
  '用法：node dev/run-all.mjs [套件名,套件名 ...] [--skip 套件名,套件名]',
  '  无位置参数：运行全部套件；位置参数：只运行指定套件。',
  '  --skip names / --skip=names：跳过指定套件，可与位置参数组合。',
  '  --help / -h：显示此帮助。'
].join('\n');

function selectSuites(args) {
  const only = new Set();
  const skip = new Set();
  let help = false;
  function addNames(value, target) {
    for (const part of value.split(',')) {
      const name = part.trim();
      if (!name) throw new Error('套件名不能为空。');
      if (!LIST.includes(name)) throw new Error(`未知套件：${name}`);
      target.add(name);
    }
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--skip') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--skip 后需要套件名。');
      addNames(args[++i], skip);
    } else if (arg.startsWith('--skip=')) {
      addNames(arg.slice('--skip='.length), skip);
    } else if (arg.startsWith('-')) {
      throw new Error(`未知选项：${arg}`);
    } else {
      addNames(arg, only);
    }
  }
  if (help) return null;
  const selected = LIST.filter(f => (!only.size || only.has(f)) && !skip.has(f));
  if (!selected.length) throw new Error('没有可运行的套件，请检查选择和 --skip 参数。');
  return selected;
}

async function main() {
  let selected;
  try {
    selected = selectSuites(process.argv.slice(2));
  } catch (error) {
    console.error(`错误：${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (selected === null) {
    console.log(USAGE);
    return;
  }

  const log = [];
  let bad = 0;
  for (const f of selected) {
    process.stdout.write(`\n######## ${f}\n`);
    const out = await new Promise(res => {
      const p = spawn(process.execPath, [path.join(DIR, f)], { cwd: path.join(DIR, '..') });
      let buf = '';
      p.stdout.on('data', d => { buf += d; process.stdout.write(d); });
      p.stderr.on('data', d => { buf += d; process.stdout.write(d); });
      p.on('error', error => {
        const message = `无法启动 ${f}：${error.message}\n`;
        buf += message;
        process.stderr.write(message);
      });
      p.on('close', (code, signal) => res({ code, signal, buf }));
    });
    const pass = (out.buf.match(/^  PASS /gm) || []).length;
    const fail = (out.buf.match(/^  FAIL /gm) || []).length;
    if (fail > 0 || out.code !== 0) bad++;
    log.push(`### ${f}  exit=${out.code}  PASS=${pass}  FAIL=${fail}${out.signal ? '  signal=' + out.signal : ''}`);
    if (out.buf.indexOf('LOGS (无报错)') < 0 && out.buf.indexOf('LOGS') >= 0) log.push('    !! 有控制台输出：\n' + out.buf.slice(out.buf.indexOf('LOGS')).slice(0, 800));
  }
  log.push(`\n==== 有问题的套件：${bad} / ${selected.length} ====`);
  writeFileSync(path.join(DIR, '_all.log'), log.join('\n'), 'utf8');
  console.log('\n' + log.join('\n'));
  process.exitCode = bad ? 1 : 0;
}

await main();
