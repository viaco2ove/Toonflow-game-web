/**
 * Log Tag 索引文档
 *
 * 用途：
 * - 登记项目内所有 `WebDebugLogUtil.log(tag, ...)` 调用点使用过的 tag，作为可检索的索引。
 * - 便于查找某模块有哪些调试日志、tag 命名约定是什么、在哪里打点。
 *
 * 重要说明：
 * - 本文件【仅为文档索引】，记录所有 logtag，不参与运行时放行判断。
 * - 是否打印由 `WebDebugLogConfig.shouldLogTag(tag)` 决定，按 `webDebugLogConfig.debugLogMode`
 *   （whitelist / blacklist）与对应名单前缀匹配，与本文件登记与否无关。
 *   即：登记在这里不代表会打印；没登记在这里也不代表不能打印。
 * - 新增日志时：建议把 tag 补登到对应分组；若该模块需要可见/屏蔽，到 `WebDebugLogConfig`
 *   的白名单/黑名单加对应前缀。
 *
 * 命名约定：
 * - 一级前缀统一用 `[xxx]`（如 `[aiGame]`、`[webp]`）。
 * - webp 相关用 `[webp:子类]`（见 `WEBP_LOG_TAGS`），统一落在 `[webp]` 前缀下。
 * - 历史 tag 命名不统一（`[voice lifecycle]`、`[voice时序]`、`[ScenePlay Watch1]`、裸字符串等），
 *   本文件按“实际出现的一级前缀”原样分组登记，不做强行合并或重命名。
 */

/**
 * WebP 播放调试日志的 tag 常量。
 *
 * 统一 `[webp]` 前缀，命中白名单 `WEBP_LOG_TAG_PREFIX`（`"[webp]"`）即可整体放行。
 * 业务代码引用本常量，避免硬编码 tag 字符串。
 */
export const WEBP_LOG_TAGS = {
  /** 播放/暂停/重置/结束/路径切换/卸载等播放状态机时机 */
  play: "[webp:play]",
  /** 第一帧提取（canvas 解码、成功/失败/超时/刷新） */
  extract: "[webp:extract]",
  /** 缓存命中/未命中/过期/LRU 淘汰 */
  cache: "[webp:cache]",
  /** 渲染层（LayeredAvatar 组件初始化、src 切换、animation-end） */
  render: "[webp:render]",
  /** 动画格式检测（Range 请求 + RIFF/ANIM/VP8X 解析） */
  detect: "[webp:detect]",
} as const;

export interface LogTagGroup {
  /** 一级前缀（原样，如 "[aiGame]"、"webp"、"裸字符串"） */
  prefix: string;
  /** 该组用途简述 */
  description: string;
  /** 该组出现过的去重 tag 原始写法（含括号与文字，保留原貌） */
  tags: string[];
}

/**
 * 全量 log tag 索引，按一级前缀分组。
 *
 * 数据来源：src/ 下所有 `WebDebugLogUtil.log(` 调用点的第一个参数。
 * 共约 179 处调用，覆盖以下分组。
 */
export const LOG_TAG_GROUPS: LogTagGroup[] = [
  {
    prefix: "[webp]",
    description: "WebP 动画播放/提取/缓存/渲染/检测调试日志（本次新增）。统一 [webp:子类] 命名，已加入白名单。",
    tags: [
      WEBP_LOG_TAGS.play,
      WEBP_LOG_TAGS.extract,
      WEBP_LOG_TAGS.cache,
      WEBP_LOG_TAGS.render,
      WEBP_LOG_TAGS.detect,
    ],
  },
  {
    prefix: "[aiGame]",
    description: "AI 游戏/会话编排核心链路。项目最大分组，含 runtimeStatus、miniGame、streamDebugLines、语音播放等。",
    tags: [
      "[aiGame][streamDebugLines]",
      "[aiGame][streamSessionPlan]",
      "[aiGame][useToonflowStore] refreshCurrentSession",
      "[aiGame] openSession start",
      "[aiGame] openSession session loaded",
      "[aiGame] 台词-语音播放-playRuntimeVoiceBlob",
      "[aiGame][runtimeStatus] status",
      "[aiGame][runtimeStatus] 继续剧情失败",
      "[aiGame][miniGame] applySessionStoryInfoResult MiniGameSessionFinished",
      "[aiGame][miniGame] 更新语音等待配置",
      "[aiGame][miniGame] shouldForceClearMiniGame",
      "[aiGame][miniGame] isMiniGameSessionFinished",
      "[aiGame][miniGame] clearVisibleMiniGameState remove stale miniGame",
      "[aiGame][miniGame] mergeVisibleMiniGameState retain fallback miniGame",
      "[aiGame][miniGame] blocking miniGame active",
      "[aiGame][miniGame] 用户发送了信息：",
      "[aiGame][miniGame] 编排通道进行中，走 minigame 编排接口",
      "[aiGame][miniGame] 编排通道进行中，streamSessionPlan check",
      "[aiGame][miniGame] 处于小游戏模式中",
      "[aiGame][miniGame] 退出小游戏",
      "[aiGame][miniGame] 旁白播报-编排",
      "[aiGame][miniGame] 敌方回合-编排",
      "[aiGame][miniGame] 陪练角色回合-编排",
      "[aiGame][miniGame] 旁白播报-台词",
      "[aiGame][miniGame] 敌方回合-台词",
      "[aiGame][miniGame] 陪练角色回合-台词",
      "[aiGame][miniGame]clearPendingSessionOrchestrationPrefetch",
      "[aiGame][miniGame] 设置语音等待时间",
      "[aiGame][miniGame] 等待语音播放完成",
      "[aiGame][miniGame] activeMiniGame changed",
      "[aiGame][miniGame] playRuntimeVoiceBlob 准备播放",
      "[aiGame][miniGame] playRuntimeVoiceBlob 真正开始播放",
      "[aiGame][miniGame] playRuntimeVoiceBlob 播放结束",
      "[aiGame][miniGame] playRuntimeVoiceBlob 播放错误",
      "[aiGame][miniGame] playRuntimeVoiceBlob play() rejected",
    ],
  },
  {
    prefix: "[voice lifecycle]",
    description: "语音生命周期：编排→台词→TTS→播放 的端到端编号步骤。",
    tags: [
      "[voice lifecycle] 编排后端完成，台词已 commit",
      "[voice lifecycle] ② 编排结果合并，消息入 state.messages",
      "[voice lifecycle] 编排→消息入store完成，等待自动触发watch→reveal流程",
      "[voice lifecycle] 编排开始",
      "[voice lifecycle] 编排中，等待 API 返回",
      "[voice lifecycle] 编排→流式生成台词完成",
      "[voice lifecycle] 继玩进入故事：历史台词已显示",
      "[voice lifecycle] 继玩：最后一条是用户发言，等待自动编排下一轮",
      "[voice lifecycle] 继玩：对最后一条 NPC/旁白消息触发 reveal 播放语音",
      "[voice lifecycle] ⑥ 开始调用 streamVoice TTS API",
      "[voice lifecycle] ⑦ 拉取音频 audioProxy",
      "[voice lifecycle] ⑧ 音频获取成功，即将交给 Audio 元素播放",
      "[voice lifecycle] ⑨ Audio.play() 即将调用",
      "[voice lifecycle] ⑩ 音频真正开始播放",
      "[voice lifecycle] ⑪ 音频播放完毕",
    ],
  },
  {
    prefix: "[voice时序]",
    description: "语音时序：watch 新消息、流式逐句播放、静音模式等待、auto_advancing 等。",
    tags: [
      "[voice时序] prefetchNextSessionOrchestration 触发",
      "[voice时序] performContinueSessionNarrative 开始编排",
      "[voice时序] orchestration 返回 player，本地兜底 awaitUser",
      "[voice时序] streamSessionPlan 开始",
      "[voice时序] streamSessionPlan 完成",
      "[voice时序] shouldStreamPlan=true，break 退出 for 循环",
      "[voice时序] continueSessionNarrative 入口",
      "[voice时序] Watch1 检测到新消息",
      "[voice时序] Watch 检测到 waiting_next，但有语音正在播放，跳过 auto_advancing",
      "[voice时序] Watch 检测到 waiting_next，准备 auto_advancing",
      "[voice时序] waitForMessageReveal revealing",
      "[voice时序] 流式外层 while break - getLatest 返回 null",
      "[voice时序] 流式外层 while break - 消息不再是 streaming 状态",
      "[voice时序] 流式逐句播放",
      "[voice时序] 流式尾句播放",
      "[voice时序] waitForMessageReveal 找不到消息，直接退出",
      "[voice时序] 静音模式等待开始",
      "[voice时序] 静音模式等待结束",
      "[voice时序] 流式播放完成",
      "[voice时序] waitForMessageReveal voicing (非流式)",
      "[voice时序] waitForMessageReveal 播放完成",
      "[voice时序] playMessageAudio 入口",
    ],
  },
  {
    prefix: "[voice打断]",
    description: "语音打断：取消 reveal、停止播放、绑定播放开始。",
    tags: [
      "[voice打断] waitForMessageReveal cancelled",
      "[voice打断] stopRuntimeVoicePlayback 被调用",
      "[voice打断] playMessageAudioWithBinding 开始",
    ],
  },
  {
    prefix: "[voiceGenPlay]",
    description: "语音生成与播放：fetchRuntimeVoiceBlob、playRuntimeVoiceBlob、resolveRuntimeVoiceUrl 等详细打点。",
    tags: [
      "[voiceGenPlay] fetchRuntimeVoiceBlob start",
      "[voiceGenPlay] fetchRuntimeVoiceBlob cache hit",
      "[voiceGenPlay] fetchRuntimeVoiceBlob response",
      "[voiceGenPlay] fetchRuntimeVoiceBlob blob",
      "[voiceGenPlay] fetchRuntimeVoiceBlob done",
      "[voiceGenPlay] calling fetchRuntimeVoiceBlob",
      "[voiceGenPlay] playRuntimeVoiceBlob start",
      "[voiceGenPlay] playRuntimeVoiceBlob objectURL",
      "[voiceGenPlay] playRuntimeVoiceBlob finalize",
      "[voiceGenPlay] playRuntimeVoiceBlob onplay",
      "[voiceGenPlay] playRuntimeVoiceBlob onended",
      "[voiceGenPlay] playRuntimeVoiceBlob onpause",
      "[voiceGenPlay] playRuntimeVoiceBlob result",
      "[voiceGenPlay] playMessageAudioWithBinding init",
      "[voiceGenPlay] calling resolveRuntimeVoiceUrl",
      "[voiceGenPlay] resolveRuntimeVoiceUrl result",
      "[voiceGenPlay] playMessageAudio entry",
      "[voiceGenPlay] speakable empty, abort",
      "[voiceGenPlay] no binding, fallback to browser speech",
      "[voiceGenPlay] resolved binding",
    ],
  },
  {
    prefix: "[voiceModels]",
    description: "语音模型列表拉取与能力解析。",
    tags: [
      "[voiceModels] fetchVoiceModels:",
      "[voiceModels] voiceModels:",
      "[voiceModels] resolveModelSupportedModes:",
    ],
  },
  {
    prefix: "[voiceBinding]",
    description: "语音绑定：按消息找角色。",
    tags: ["[voiceBinding] findMessageRole"],
  },
  {
    prefix: "[ScenePlay",
    description: "ScenePlay 组件：消息 watch 同步、reveal 触发、事件进度。（注意含 [ScenePlay Watch1]/[ScenePlay Watch2] 子前缀）",
    tags: [
      "[ScenePlay][debug] allEventStageProgress from debugRuntimeState:",
      "[ScenePlay][session] allEventStageProgress:",
      "[ScenePlay Watch2] history mode",
      "[ScenePlay Watch2] messages empty",
      "[ScenePlay Watch1] history mode, sync all messages",
      "[ScenePlay Watch1] skip: setting/tips/debugLoading",
      "[ScenePlay Watch1] messages empty",
      "[ScenePlay Watch1] resumeLatestOnOpen=true, Watch2 already handled",
      "[ScenePlay Watch1] mismatched, sync all",
      "[ScenePlay Watch1] no new messages",
      "[ScenePlay] new messages detected, will call waitForMessageReveal",
      "[ScenePlay] waitForMessageReveal about to call",
    ],
  },
  {
    prefix: "[orchestrateSession]",
    description: "会话编排：promise 复用、结果解析、预取。",
    tags: [
      "[orchestrateSession] promise",
      "[orchestrateSession] pending.promise result",
      "[orchestrateSession] result",
      "[orchestrateSession] resolveSessionOrchestration result",
      "[orchestrateSession] prefetchNext",
      "[orchestrateSession] pending.promise clear curr user",
    ],
  },
  {
    prefix: "[orchestrateMinigame]",
    description: "小游戏编排结果解析。",
    tags: ["[orchestrateMinigame] resolveMinigameOrchestration result"],
  },
  {
    prefix: "[orchestrateDebug]",
    description: "调试链编排结果。",
    tags: ["[orchestrateDebug] result"],
  },
  {
    prefix: "[resolveSessionOrchestration]",
    description: "会话编排结果复用/实时请求。",
    tags: [
      "[resolveSessionOrchestration] 尝试复用预取结果",
      "[resolveSessionOrchestration] 复用预取结果",
      "[resolveSessionOrchestration] 实时请求编排结果",
    ],
  },
  {
    prefix: "[resolveMinigameOrchestration]",
    description: "小游戏编排结果复用/实时请求。",
    tags: ["[resolveMinigameOrchestration] 小游戏编排结果"],
  },
  {
    prefix: "[prefetchOrchestration]",
    description: "编排预取：跳过/去重/开始/消费。",
    tags: [
      "[prefetchOrchestration] clearPendingSessionOrchestrationPrefetch",
      "[prefetchOrchestration] 跳过预取，用户回合",
      "[prefetchOrchestration] 已有相同预取，跳过",
      "[prefetchOrchestration] 开始预取编排",
      "[prefetchOrchestration] 消费预取结果",
    ],
  },
  {
    prefix: "[introduction]",
    description: "故事开场流式：delta/成句/完成/出错。",
    tags: [
      "[introduction] delta",
      "[introduction] sentence added",
      "[introduction] done",
      "[introduction] error",
    ],
  },
  {
    prefix: "[messageReveal]",
    description: "消息揭示/逐字显示与触发语音播放。",
    tags: [
      "[messageReveal] waitForMessageReveal entry",
      "[messageReveal] waitForMessageReveal early return: no message",
      "[messageReveal] waitForMessageReveal got message",
      "[messageReveal] streaming loop",
      "[messageReveal] playMessageAudio start",
      "[messageReveal] playMessageAudio result",
      "[messageReveal] roleType=player, return",
      "[messageReveal] non-streaming voicing",
    ],
  },
  {
    prefix: "[miniGame]",
    description: "小游戏额外等待。",
    tags: ["[miniGame] 额外等待"],
  },
  {
    prefix: "[typewriter]",
    description: "打字机效果：delta/成句/完成/出错。",
    tags: [
      "[typewriter] delta",
      "[typewriter] done",
      "[typewriter] sentence added",
      "[typewriter] error",
    ],
  },
  {
    prefix: "[playback]",
    description: "句子播放：开始/完成。",
    tags: [
      "[playback] startMessagePlayback",
      "[playback] finishSentencePlayback",
    ],
  },
  {
    prefix: "[indicator",
    description: "加载/状态指示器显隐。（注意含 :start/:end/:clear/:set 子标记）",
    tags: [
      "[indicator:start]",
      "[indicator:end]",
      "[indicator:clear]",
      "[indicator:set]",
    ],
  },
  {
    prefix: "[bindGameModel]",
    description: "游戏模型绑定：映射与出错。",
    tags: [
      "[bindGameModel] settingsAiModelMap:",
      "[bindGameModel] error:",
    ],
  },
  {
    prefix: "[currentPlayerRole]",
    description: "当前玩家角色推导。",
    tags: ["[currentPlayerRole] state.playerDesc:"],
  },
  {
    prefix: "[openWorldForEdit]",
    description: "打开世界编辑：玩家角色描述。",
    tags: ["[openWorldForEdit] world.playerRole.description:"],
  },
  {
    prefix: "[submitEditor]",
    description: "模型管理提交。",
    tags: ["[submitEditor] addManagedModelConfig"],
  },
  {
    prefix: "[snapshot:",
    description: "动态拼接 tag：运行时 `[snapshot:${tag}]`，前缀 [snapshot:。",
    tags: ["[snapshot:${tag}]"],
  },
  {
    prefix: "[debug:fetchRuntimeVoiceBlob]",
    description: "动态拼接 tag：fetchRuntimeVoiceBlob 调试，含 audioUrl/requestId/runtimeVoiceRequestId。",
    tags: ["[debug:fetchRuntimeVoiceBlob] audioUrl=${audioUrl} requestId=${requestId} runtimeVoiceRequestId=${runtimeVoiceRequestId}"],
  },
  {
    prefix: "裸字符串",
    description: "无 [xxx] 前缀的裸字符串 tag：getUserMedia/录音机/resolveRuntimeVoiceUrl 等。命名不统一，建议后续规范化。",
    tags: [
      "继续编排下一轮剧情",
      "getUserMedia ing",
      "getUserMedia ed",
      "recorder.onstart",
      "recorder.ondataavailable",
      "recorder.onerror",
      "recorder.onstop",
      "recorder.start ing",
      "recorder.start ed",
      "startVoiceRecognition",
      "resolveRuntimeVoiceUrl",
      "resolveRuntimeVoiceUrl cached",
      "resolveRuntimeVoiceUrl inflight",
    ],
  },
];