// 把 video/frames/ 里已经做好的慢推段（c0..c7.mp4）串成一支片子。
// 从 make-video.mjs 里拆出来单跑，是为了能在不动排帧和 zoompan 的前提下
// 反复试 xfade 那条链 —— 它是整支片子里最容易出错的一步。
import { execFileSync } from 'child_process';
import { readdirSync, existsSync, statSync, rmSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const FRAMES = path.join(ROOT, 'video', 'frames');
const FFMPEG = 'C:\\Users\\19819\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe';
const OUT = path.join(ROOT, 'video', '归隐-教学.mp4');

const clips = readdirSync(FRAMES)
  .filter(f => /^c\d+\.mp4$/.test(f))
  .sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
if (!clips.length) { console.error('frames/ 里没有 cN.mp4 —— 先跑 make-video.mjs'); process.exit(2); }
console.log('段 ' + clips.length + ' 个');

// 链式滤镜之间要分号。
// 光靠标签相邻（`[v1][2:v]xfade=…[v2][2:v]xfade=…`）会被解析器当成一个残缺的链，
// 报出来的错指向**中间**那一段，看着像 offset 算错了 —— 其实少的是一个分号。
// 两段那次能过是因为只有一个滤镜、不需要分隔符，三段一上就炸。
//
// **链尾不要接 format。** 它是无源滤镜（没输入），接上去 ffmpeg 会去找
// 「一条还没用上的输入流」来喂它 —— 而这时所有输入都被 xfade 用光了，
// 于是报「Cannot find an unused video input stream」。
// 像素格式用输出参数 -pix_fmt 给，一样的效果，不占输入。
//
// offset 还要**退一点**：每步 offset 累加到 i*STEP 时，
// 那一段可用的时长恰好等于 offset + 叠化时长，而 xfade 要的是严格小于。
// 差 0.1 秒，「Invalid argument」就没了。
const X = 0.55, CLIP = 3.2, STEP = CLIP - X;
let fc = '', prev = '[0:v]';
for (let i = 1; i < clips.length; i++) {
  const off = (STEP * i - 0.1).toFixed(3);
  const lbl = `[v${i}]`;
  fc += prev + `[${i}:v]xfade=transition=fade:duration=${X}:offset=${off}` + lbl
      + (i === clips.length - 1 ? '' : ';');
  prev = lbl;
}

const args = ['-y'];                          // ← 少了 -y 就是这个坑
for (const c of clips) args.push('-i', path.join(FRAMES, c));
// -pix_fmt yuv420p：**不给就是 yuv444p**（H.264 4:4:4），
// 而 4:4:4 只有少数播放器放得动 —— 手机上看会黑屏。
// 之前那版忘了写，文件倒是出了、体积也不小，ffprobe 一看是 4:4:4 才认出来
args.push('-filter_complex', fc, '-map', prev, '-r', '30', '-pix_fmt', 'yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-movflags', '+faststart', OUT);

execFileSync(FFMPEG, ['-hide_banner', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
if (!existsSync(OUT)) { console.error('没出片'); process.exit(1); }
const mb = statSync(OUT).size / 1048576;
// 时长：每段 3.2 秒，叠 0.55 秒，段数 n 的话是 n*3.2 - (n-1)*0.55
const dur = clips.length * CLIP - (clips.length - 1) * X;
console.log('成片：video/归隐-教学.mp4　' + mb.toFixed(2) + ' MB　约 ' + dur.toFixed(1) + ' 秒');
process.exit(0);
