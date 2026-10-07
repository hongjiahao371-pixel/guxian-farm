// 改完 dev/*.mjs 之后先跑这个，再 node --check。
//
// 为什么要有它：那些脚本把一整天早晨的动作塞进一个**巨大的模板串**
// （await ev(`(function(){ … })()`)），于是**注释里也不能出现反引号** ——
// 一个反引号就把模板串截断，报出来的错是
// 「SyntaxError: missing ) after argument list」，
// 而出错的位置在**几百行之外**的那一行，看不出是自己刚写的那句注释。
// 同一个坑一天踩了六次。
//
// **只数总数是不够的**（这是第一版的盲区）：一对反引号**同时**落在模板串里，
// 总数照样是偶数，守卫放行，而模板串照样被截断。
// 所以这里做两件事：
//   ① 全文件反引号总数是不是偶数（粗筛）
//   ② 逐个模板串，检查**它自己内部**有没有落单的反引号
// 判据二才是真判据：模板串从自己的开引号走到**下一个**反引号为止，
// 那之间再出现反引号就是截断点。
import { readFileSync } from 'fs';

const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node dev/check-tick.mjs <文件...>'); process.exit(2); }
let bad = 0;

for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const probs = [];

  // ① 总数奇偶（粗筛）
  const total = lines.join('\n').match(/`/g) || [];
  if (total.length % 2 !== 0) {
    probs.push(`全文件反引号 ${total.length} 个（奇数）`);
    lines.forEach((l, i) => { if ((l.match(/`/g) || []).length % 2 === 1) probs.push(`  行 ${i + 1} 单数为奇：${l.trim()}`); });
  }

  // ② 逐行找「开引号之后、在同一行或后续行又遇到反引号」的模板串，
  //    重点是**注释行里**出现的反引号 —— 那几乎一定是错的
  let inTpl = false, tplStart = 0;
  lines.forEach((l, i) => {
    const n = (l.match(/`/g) || []).length;
    if (!inTpl) {
      if (n % 2 === 1) { inTpl = true; tplStart = i + 1; }
    } else {
      if (n % 2 === 1) {
        // 模板串在这里收尾。收尾之前（也就是 tplStart..i 之间）
        // 有没有**注释行**带反引号？——有就说明截断点就在这几行里
        for (let k = tplStart; k <= i; k++) {
          const s = lines[k];
          if (s.includes('`') && /^\s*\/\//.test(s) && !(s.match(/`/g) || []).length % 2 === 2) {
            probs.push(`行 ${k + 1} 注释里有一对反引号（在模板串内部，第 ${tplStart} 行开的）：${s.trim()}`);
          }
        }
        inTpl = false;
      }
    }
  });

  if (probs.length) {
    bad++;
    console.log('✗ 有问题　' + f);
    probs.forEach(p => console.log('   ' + p));
  } else {
    console.log('✓ 干净　' + f + '　（反引号 ' + total.length + ' 个）');
  }
}
process.exit(bad ? 1 : 0);
