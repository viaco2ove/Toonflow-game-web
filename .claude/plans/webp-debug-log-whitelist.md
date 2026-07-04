# WebP 播放调试日志 + 白名单模式 实施计划

## 目标
1. 给 `WebDebugLogConfig.ts` 增加白名单配置,约束为**白名单模式**:非白名单的日志不打印。
2. 把全部现有 logtag 登记到 `logTagList.ts`(仅文档/索引,不自动放行)。
3. 增加 webp 播放的调试日志,tag 用 `[webp:子类]` 命名,并把 `[webp]` 加入白名单。

## 设计决策(已确认)
- **匹配粒度**:前缀匹配。白名单存前缀串(如 `[webp]`),日志 tag 以该串开头即放行。
- **webp tag 命名**:`[webp:子类]`,如 `[webp:play]`、`[webp:extract]`、`[webp:cache]`、`[webp:render]`、`[webp:detect]`。统一 `[webp]` 前缀。
- **logTagList 范围**:全登记现有 179 处 tag,仅作文档索引,不参与放行判断。

## 关键架构说明
- 现有日志唯一入口:`WebDebugLogUtil.log(tag, ...args)`(src/utils/WebDebugLogUtil.ts)。
- 现状:`isEnabled()` 只判 `debug=true` 开关,开了就全打。
- 白名单逻辑放在 `WebDebugLogConfig.ts`,由 `WebDebugLogUtil.log` 调用判断。
- 双重门控:必须 `isEnabled()`(debug 开关开) **且** tag 命中白名单前缀,才真正打印。
- 前缀匹配时大小写敏感(现有 tag 大小写混用,保持原样)。

---

## 实施步骤

### 步骤 1:实现 `src/utils/WebDebugLogConfig.ts`(白名单配置)
导出:
- `WEBP_LOG_TAG_PREFIX = "[webp]"` 常量。
- `DEBUG_LOG_WHITELIST: string[]` —— 白名单前缀数组,初始含 `"[webp]"`。
- `isTagWhitelisted(tag: string): boolean` —— 判断 tag 是否命中任一白名单前缀(`tag.startsWith(prefix)`)。tag 为空或非字符串返回 false。注意:tag 可能是运行时拼接的动态串(如 `` `[snapshot:${tag}]` ``、`error` 对象),需防御性处理——非字符串或空串直接 false。
- 顶部 JSDoc 说明:白名单模式,非白名单不打印;前缀匹配;如何新增白名单条目。

### 步骤 2:改造 `src/utils/WebDebugLogUtil.ts`
- import `isTagWhitelisted`。
- `log(tag, ...args)`:在现有 `isEnabled()` 判断后,增加 `if (!isTagWhitelisted(tag)) return;`。两个条件都满足才 `console.log`。
- 更新顶部 JSDoc 说明白名单机制。
- 兼容现有动态 tag(裸字符串如 `"getUserMedia ing"`、`error` 对象):这些不在白名单 → 不打印。这是预期行为(白名单模式本意)。

### 步骤 3:编写 `src/utils/logTagList.ts`(全量 tag 索引文档)
按一级 `[xxx]` 前缀分组,登记全部现有 tag(来自调研的 24 组 + 动态/裸字符串组)。结构:
```ts
export interface LogTagGroup {
  prefix: string;        // 一级前缀,如 "[aiGame]"、"webp"
  description: string;   // 组用途简述
  tags: string[];        // 该组出现过的去重 tag 原始写法
}
export const LOG_TAG_GROUPS: LogTagGroup[] = [ ... ]
```
- 同时导出 webp 专用 tag 常量(供步骤 4 使用,避免硬编码):
  ```ts
  export const WEBP_LOG_TAGS = {
    play: "[webp:play]",
    extract: "[webp:extract]",
    cache: "[webp:cache]",
    render: "[webp:render]",
    detect: "[webp:detect]",
  } as const;
  ```
- 顶部 JSDoc 说明:本文件仅为 tag 索引文档,不参与运行时放行;放行由 `WebDebugLogConfig` 白名单决定。
- 24 组全覆盖:aiGame、voice lifecycle、voice时序、voice打断、voiceGenPlay、voiceModels、voiceBinding、ScenePlay、orchestrateSession、orchestrateMinigame、orchestrateDebug、resolveSessionOrchestration、resolveMinigameOrchestration、prefetchOrchestration、introduction、messageReveal、miniGame、typewriter、playback、indicator、bindGameModel、currentPlayerRole、openWorldForEdit、submitEditor + 动态模板组 + 裸字符串组。

### 步骤 4:插入 webp 播放调试日志
tag 取自 `logTagList.ts` 的 `WEBP_LOG_TAGS`,统一走 `WebDebugLogUtil.log`。插入点:

**A. `src/composables/useWebpAvatar.ts`(播放状态机,核心)**
import `WebDebugLogUtil` 和 `WEBP_LOG_TAGS`。在以下位置插日志:
- `extractFrame(forceRefresh)` 入口(L101 附近):`[webp:extract]` 记 path、forceRefresh、isWebp。
- `extractFrame` 成功分支(L117):`[webp:extract]` 记 path、isAnimated、dataUrl 长度。
- `extractFrame` 失败/catch(L121/L127):`[webp:extract]` 记 path、error、降级。
- `play()`(L139):`[webp:play]` 记 path、playDuration;定时器到点回调内(L152):`[webp:play]` 记播放结束触发 onAnimationEnd。
- `pause()`(L162):`[webp:play]` 记 path。
- `reset()`(L197):`[webp:play]` 记 path。
- `refresh()`(L183):`[webp:extract]` 记 path。
- `watch(avatarPath)`(L217):路径变化入口记 `[webp:play]` newPath、autoPlay。
- `onBeforeUnmount`(L241):`[webp:play]` 记 path、isPlaying。

**B. `src/utils/webpFrameExtractor.ts`(底层缓存时机)**
import `WebDebugLogUtil` 和 `WEBP_LOG_TAGS`。在以下位置插日志:
- `extractWebpFirstFrame`(L249):缓存命中分支(L261)`[webp:cache]` 记 url 命中;未命中走到提取前 `[webp:cache]` 记未命中。
- `getCacheEntry`(L71)过期分支:`[webp:cache]` 记 url 过期。
- `setCacheEntry`(L90)LRU 淘汰:`[webp:cache]` 记被淘汰 url。
- `detectWebpAnimation`(L121):`[webp:detect]` 记 url、结果、是否保守 true。
- `extractFrameWithCanvas`(L176):开始 `[webp:extract]` 记 url;handleLoad 成功 `[webp:extract]` 记尺寸;handleError `[webp:extract]` 记失败;超时 `[webp:extract]` 记超时。

**C. `src/components/LayeredAvatar.vue`(渲染层)**
import `WebDebugLogUtil` 和 `WEBP_LOG_TAGS`。在以下位置插日志:
- `useWebpAvatar` 调用处(L21 附近):组件初始化记 `[webp:render]` foreground/backgroundPath、animated、duration。
- `onAnimationEnd` 回调:`[webp:render]` 记播放结束。
- 可选:对 `effectiveFgPath`/`displayedPath` 加 watch 记渲染 src 切换(若改动可控)。

> ScenePlay.vue 大立绘是唯一在 LayeredAvatar 外直接用 useWebpAvatar 的地方,其播放日志已在 useWebpAvatar 内覆盖,不额外加,避免冗余。

### 步骤 5:验证
- `npx vue-tsc --noEmit` 类型检查,确认无新增错误(忽略项目既有无关错误)。
- 人工核对:白名单只含 `[webp]`,webp 日志 tag 均以 `[webp` 开头能命中;非 webp 日志(tag 不以 `[webp]` 开头)在白名单模式下不打印。

---

## 影响面
- 改动文件:`WebDebugLogConfig.ts`、`WebDebugLogUtil.ts`、`logTagList.ts`、`useWebpAvatar.ts`、`webpFrameExtractor.ts`、`LayeredAvatar.vue`。
- 行为变化:**所有现有非 webp 日志在 debug 模式下也不再打印**(白名单模式)。这是用户明确要求的"非白名单不打印"。如需恢复某类日志,把其前缀加入 `DEBUG_LOG_WHITELIST` 即可。
- 向后兼容:`WebDebugLogUtil.log` 签名不变,调用点无需改动。
