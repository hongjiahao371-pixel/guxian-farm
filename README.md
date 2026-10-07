# 归园 · 南山茅舍

一个水墨风的单机农场游戏 —— 陶渊明《归园田居》的底子。
二十四节气，六天一个，一年就是一轮。耕、种、浇、收，做过的事记进**诗册**；
见过的人、认得的味、走通的路，各记一本。没有战斗，没有任务清单，
天黑结算，第二天照旧。

**跑起来**：双击 `index.html` 就行。零依赖、零构建、零后端，
存档在浏览器本地（localStorage），不上传任何东西。

## 结构

```
index.html      唯一的入口
css/style.css
js/core.js      归一化输入、WebAudio 合成音效与三首背景音乐、粒子
js/field.js     田畦梯形与透视拾取
js/ink.js       全部水墨笔触（人物、建筑、器物、地块）
js/data.js      节气、作物、NPC、营造、配方、地图
js/game.js      状态机与全部规则
assets/         六张手绘底图
dev/            验收套件（见下）
```

## 验收

`dev/` 下是 39 套无头 Chrome 验收，全绿 **PASS 2089 / FAIL 0**。

```bash
node dev/run-all.mjs            # 全跑，约 40 分钟
node dev/run-all.mjs shoot-farm.mjs,shoot-walk.mjs    # 只跑其中几套
node dev/shoot-audio.mjs        # 单跑一套
node dev/check-tick.mjs dev/*.mjs   # 改完 dev/*.mjs 必跑：查模板串里的落单反引号
```

每套自己拉一个 headless Chrome，用 CDP 敲键发事件，结果落 `dev/_all.log`。
**量的是画出来的东西，不是读代码猜的** —— 布局量 `getBoundingClientRect`，
配色量 `getImageData`，判定点量坐标。

几套值得单说的：

| 套件 | 量什么 |
|---|---|
| `shoot-walk.mjs` | 可走区：`bounds` 只是个矩形，山和屋都在里面，所以另有一份 `blocks`；并断言**所有交互点都没被挡** |
| `shoot-audio.mjs` | 音效 16 个逐个放、M 静音键、背景音乐三支曲子在各地各时段怎么选 |
| `shoot-narrow.mjs` | 480×854 竖屏的横向出界、面板开合、触屏的「E 等价物」 |
| `shoot-slot.mjs` | 三格存档往返、坏档不卡死、老存档兼容 |

## 约定

- **ES2017 / Chrome 61 基线**：`game.js` / `data.js` 保持 `var` + `function`，
  不用 `?.` `??` 对象展开、`inset`、`aspect-ratio`、`:is()`
- 引文逐句核实作者与出处；游戏自己说的话，出处一律写 `——`
- 诗册只收「第一次做某件事」的 27 句，没做过的不占位
- 判定圈「先判到的赢」；提示行写的是**按下去会发生什么**
- 排版间距一律用相邻兄弟选择器 + margin（flex/grid 的 gap 不安全）

## 内容审计

- 物品 51 样，49 样有明确来路（余下 2 样是开局白送的锄和木瓢），反向无孤儿配方
- 诗册 27 句 / 图鉴 18 味 / 五谷 5 种 / 机器 5 座 / 托付 4 条
- 通玩一整年：诗册 27/27、图鉴 18/18、夜鱼 144 尾、一生进项 1086184