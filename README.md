# idle-loot（代号）

竖屏、横版卷轴的放置刷宝小游戏原型。玩法骨架参考同类放置刷宝游戏；名字、角色、美术、数值、关卡全部原创。学习项目：看清一款小游戏是怎么写出来的。

- 在线试玩：<https://game.kyuu925.site>
- 设计和规则：[docs/design.md](docs/design.md)
- 数值表（改数字调手感）：[src/data/balance.json](src/data/balance.json)
- 每一步的讲解：[docs/walkthrough/](docs/walkthrough/)

## 本地运行

```bash
npm install
npm run dev        # 本地服务 http://localhost:8080
npm test           # 纯逻辑单元测试
npm run sim -- --minutes 40 --seed 1   # 数值模拟：快进 40 分钟看推关节奏
npm run build      # 打包到 dist/
```

推送到 `main` 后，GitHub Actions 自动检查、打包并发布到 GitHub Pages。
