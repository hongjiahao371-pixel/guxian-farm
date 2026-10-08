// 只启动临时目录中的假验收脚本，不会启动 Chrome 或修改真实验收日志。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIRST = 'shoot.mjs';
const SECOND = 'shoot-xipan.mjs';
const fixtureSource = [
  "import { appendFileSync } from 'node:fs';",
  "import path from 'node:path';",
  "const name = path.basename(process.argv[1]);",
  "appendFileSync('calls.jsonl', JSON.stringify(name) + '\\n');",
  "console.log(name === process.env.RUNNER_TEST_FAIL ? '  FAIL fixture' : '  PASS fixture');",
  "if (name === process.env.RUNNER_TEST_SIGNAL) process.kill(process.pid, 'SIGTERM');",
  "if (name === process.env.RUNNER_TEST_EXIT) process.exit(7);"
].join('\n');

function runFixture(args, env = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'guxian-runner-'));
  const dev = path.join(root, 'dev');
  mkdirSync(dev);
  try {
    copyFileSync(path.join(DIR, 'run-all.mjs'), path.join(dev, 'run-all.mjs'));
    // 使用原有脚本名创建独立假子进程；实际测试断言不依赖 runner 的筛选实现。
    for (const name of readdirSync(DIR)) {
      if ((name.startsWith('shoot') || name.startsWith('probe')) && name.endsWith('.mjs')) {
        writeFileSync(path.join(dev, name), fixtureSource);
      }
    }
    const result = spawnSync(process.execPath, [path.join(dev, 'run-all.mjs'), ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 15000
    });
    assert.ifError(result.error);
    const callsFile = path.join(root, 'calls.jsonl');
    const logFile = path.join(dev, '_all.log');
    return {
      ...result,
      calls: existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse) : [],
      log: existsSync(logFile) ? readFileSync(logFile, 'utf8') : null
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('无参数执行全部 39 套，成功时退出 0', () => {
  const result = runFixture([]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 39);
  assert.equal(new Set(result.calls).size, 39);
  assert.equal(result.calls[0], FIRST);
  assert.equal(result.calls.at(-1), 'probe-keys.mjs');
  assert.match(result.log, /有问题的套件：0 \/ 39/);
});

test('位置参数只执行指定套件，去重并保留套件标准顺序', () => {
  const result = runFixture([`${SECOND},${FIRST}`, FIRST]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [FIRST, SECOND]);
  assert.match(result.log, /有问题的套件：0 \/ 2/);
});

test('--skip 显式跳过套件', () => {
  const result = runFixture(['--skip', `${FIRST},${SECOND}`]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 37);
  assert.ok(!result.calls.includes(FIRST));
  assert.ok(!result.calls.includes(SECOND));
  assert.match(result.log, /有问题的套件：0 \/ 37/);
});

test('指定套件可以配合 --skip= 排除其中一套', () => {
  const result = runFixture([`${FIRST},${SECOND}`, `--skip=${FIRST}`]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [SECOND]);
  assert.match(result.log, /有问题的套件：0 \/ 1/);
});

test('子进程返回非 0 时 runner 退出 1，继续运行并记录后续套件', () => {
  const result = runFixture([], { RUNNER_TEST_EXIT: FIRST });
  assert.match(result.log, /shoot\.mjs  exit=7/);
  assert.equal(result.calls.length, 39);
  assert.deepEqual(result.calls.slice(0, 2), [FIRST, SECOND]);
  assert.equal(result.status, 1);
  assert.match(result.log, /有问题的套件：1 \/ 39/);
});

test('子进程退出 0 但报告 FAIL 时 runner 仍退出 1', () => {
  const result = runFixture([], { RUNNER_TEST_FAIL: FIRST });
  assert.match(result.log, /exit=0  PASS=0  FAIL=1/);
  assert.equal(result.status, 1);
  assert.equal(result.calls.length, 39);
  assert.match(result.log, /有问题的套件：1 \/ 39/);
});

test('子进程被信号终止时 runner 退出 1', () => {
  const result = runFixture([FIRST], { RUNNER_TEST_SIGNAL: FIRST });
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, [FIRST]);
  assert.match(result.log, /有问题的套件：1 \/ 1/);
});

test('无效参数在启动任何套件前退出 2', () => {
  for (const args of [
    ['shoot-typo.mjs'],
    [FIRST, 'shoot-typo.mjs'],
    ['--skip'],
    ['--skip='],
    ['--skip', 'shoot-typo.mjs'],
    ['--unknown'],
    [`${FIRST},`],
    [FIRST, '--skip', FIRST]
  ]) {
    const result = runFixture(args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.deepEqual(result.calls, [], JSON.stringify(args));
    assert.equal(result.log, null);
    assert.match(result.stderr, /用法/);
  }
});

test('--help 展示用法，不运行套件或写入日志', () => {
  const result = runFixture(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, []);
  assert.equal(result.log, null);
  assert.match(result.stdout, /用法/);
  assert.match(result.stdout, /--skip/);
});
