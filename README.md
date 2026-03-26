# Toonflow Game Web

V3 设计功能版 Web 客户端（重建版）。

## 启动

```bash
yarn
yarn dev
```

默认地址：`http://localhost:5173`

## 构建
```bash
yarn build
```
## wsl
[test_wsl.md](md/wsl/test_wsl.md)

## 页面说明

- 主页：随机推荐 + 一句话开玩
- 故事大厅：按项目聚合世界观，支持搜索
- 创建故事：世界观/角色/章节/小游戏状态配置
- 聊过：真实会话历史（按账号隔离）
- 游玩故事：会话消息、状态、小游戏触发与同步
- 我的：当前账号信息与 token 清理

## 接口依赖

前端直接调用 `toonflow-game-app` 后端的这些路由：

- `/project/getProject`
- `/user/getUser`
- `/game/getWorld`
- `/game/saveWorld`
- `/game/getChapter`
- `/game/saveChapter`
- `/game/startSession`
- `/game/listSession`
- `/game/getSession`
- `/game/getMessage`
- `/game/addMessage`
