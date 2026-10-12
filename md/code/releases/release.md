对接 git 的 https://github.com/viaco2ove/Toonflow-game-web/releases/new  并且上传安装包
[.env](../../../.env)

# 2026-10-10 fix：narrative 模式下 `#野外生存` 角色列表空

**症状**：在「剧情推动」模式下输入 `#野外生存`，插件 UI 不弹、角色列表是空的（手动 / 现实同步 模式正常）。

**根因**：
- `useToonflowStore.ts:sendMessage()` 不区分 `#` 前缀系统指令，所有用户消息都走同一发送链路
- narrative 模式后端会走 LLM 编排（mainOrchestration）把 `#野外生存` 当成普通玩家对话
- LLM 不一定产出 `on_mini_game_start` 事件 → 插件不启动 → 角色列表空

**修复**：`useToonflowStore.ts:sendMessage()` 顶部 + finally 块
1. 新增 `isPluginSystemCommand(content)` 工具函数（line 3104 旁）：检测 `#` 前缀且长度 > 1（注意排除 `#退出`，它有专门处理）
2. 发送前：若指令是 plugin 系统指令 + 当前是 narrative 模式 → 临时切到 manual 模式（前端权威，不调后端）
3. finally 块（line 8006 后）：`state.sendPending=false` 后恢复原模式 → 时间模式视觉不变
4. 后端 `addMessage({ orchestrate: false })` 在 manual 模式走直接落库，触发 `on_mini_game_start` 事件

**已知不足**：
- 切模式 → 提交消息 → 恢复模式是异步，竞态下后端可能短暂看到模式为 manual；如果后端缓存了 mode，会留 dirty state
- 真正干净的修法是后端 `addMessage` 支持 `bypassOrchestration: true` 标记（或 `/game/orchestration/minigame` 接口允许带 player message 直接触发），前端完全不动时间模式
- 标记为「2026-10-10 fix」注释，等后端协议升级后清理

# 构建
构建并打包 Windows 安装包
构建并打包 linux 安装包

# linux
[.wsl_mirror](../../../.wsl_mirror) 作为wsl 模拟linux 的环境
[test_wsl.md](../../wsl/test_wsl.md)