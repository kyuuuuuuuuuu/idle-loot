# 第一步：骨架、纯逻辑、战斗画面

## 这一步做了什么

手机竖屏浏览器里打开 `dist/index.html`：蓝色方块英雄自动打从右边走来的红色小怪，按技能顺序放技能，伤害数字往上飘。怪死了掉金币、经验、装备；打完 3 波小怪再打紫色首领，过关进入下一关。顶部是关卡/波次、等级和经验条、金币、背包件数；底部是最近 5 条掉落和离线收益。刷新后存档还在。

背包、技能顺序、强化的**界面**这一步没做；它们的**逻辑**已写好并有测试（`progress.ts`），模拟器用它们模拟一个会换装、会强化的玩家。

## 每个文件干什么

- `index.html`：只放一个 `<div id="game">` 和 `game.js`，没有任何界面元素。
- `scripts/build.mjs`：esbuild 把 `src/main.ts`（含 Phaser）打成 `dist/game.js`；`--serve` 在 8080 端口提供并自动重建。
- `scripts/sim.ts`：不开画面，按 50 毫秒一步快进，打印推关节奏。
- `scripts/smoke.mjs`：无头浏览器开游戏 12 秒，看有没有报错、有没有打死怪。
- `src/main.ts`：入口。读档、算离线收益、存档，然后创建 Phaser 游戏。
- `src/platform/index.ts`：平台层接口。
- `src/platform/web.ts`：网页版平台实现。
- `src/logic/rng.ts`：带种子的随机数，同一个种子永远同一串数。
- `src/logic/types.ts`：游戏状态、装备、事件的类型，以及新存档 `createState`。
- `src/logic/stats.ts`：算英雄最终属性和战力。
- `src/logic/loot.ts`：抽品质、抽词缀、算主属性和分解价值。
- `src/logic/stage.ts`：每波几只怪、怪的生命攻击、击杀奖励。
- `src/logic/battle.ts`：`step`，战斗每一小步怎么走。
- `src/logic/progress.ts`：升级、换装、分解、强化、技能顺序。
- `src/logic/offline.ts`：按在线速率估算离线收益。
- `src/logic/save.ts`：存档的序列化和读档校验。
- `src/scenes/BattleScene.ts`：战斗画面，驱动逻辑往前走。
- `src/scenes/Hud.ts`：顶部信息栏和底部掉落列表。
- `src/scenes/FloatingText.ts`：伤害飘字对象池。
- `test/*.test.ts`：纯逻辑的单元测试，Node 直接跑。

## 三个概念

**固定步长的游戏循环。** 逻辑不能跟着帧率走。`BattleScene.update` 每帧算出距上一帧过了多久，累加进 `acc`，攒够 50 毫秒（`STEP_MS`）就调一次 `step`，攒不够就等下一帧。手机卡了，只是一帧里多走几步，结果和流畅时一样。一帧最多补 1 秒（`MAX_FRAME_MS`），切后台回来不会一口气快进。`scripts/sim.ts` 也是 50 毫秒一步，模拟结果和真玩一致。

**逻辑和画面分开。** `src/logic/battle.ts` 的 `step(state, balance, rng, dtMs)` 只改 `GameState` 并返回事件（`damage`、`loot`、`levelUp`…）。它不认识 Phaser，不读时钟，不用 `Math.random`，数值表和随机数都从参数传进来。`BattleScene.draw` 只读 state 画方块和血条，`BattleScene.onEvent` 把事件变成飘字和掉落列表，画面自己不算伤害。好处：逻辑能单独测试，能不开画面快进几十分钟调数值，搬到微信时 `src/logic/` 不用改。

**平台层。** 网页和微信的差别只有存档读写、当前时间、切后台回调、调试入口。`src/platform/index.ts` 的 `Platform` 接口把它们列出来，`src/platform/web.ts` 的 `createWebPlatform` 用 localStorage、`Date.now`、`visibilitychange` 实现。`src/` 里只有这个文件直接碰 `window` 和 `document`，`main.ts` 创建它，再传给 `BattleScene`。以后加一个 `wx.ts` 实现同一个接口就能进微信，其他代码不动。
