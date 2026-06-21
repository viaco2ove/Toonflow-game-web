<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import LayeredAvatar from "./LayeredAvatar.vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import { useOrchestrationVoiceFlow } from "../composables/orchestrationVoiceFlow";
import type { MessageItem, OrchestratorRuntimeMeta, RoleParameterCard, RuntimeEventDigestItem, RuntimeRetryMessageMeta, StageProgress, StageProgressStatus, StoryRole, VoiceBindingDraft, VoiceMixItem } from "../types/toonflow";
import { fileToDataUrl } from "../utils/file";
import { WebDebugLogUtil } from "../utils/WebDebugLogUtil";

const store = useToonflowStore();
const voiceFlow = useOrchestrationVoiceFlow();

// 解构语音编排流程相关函数
const {
  runtimeVoiceMessageKey,
  runtimeVoicePhase,
  runtimeVoiceIndicator,
  getRuntimeVoiceIndicatorTimer,
  setRuntimeVoiceIndicatorTimer,
  clearRuntimeVoiceIndicatorTimer,
  runtimeVoicePreviewCache,
  runtimeVoicePreviewInflight,
  runtimeVoiceBlobCache,
  runtimeVoiceFallbackBindingCache,
  runtimeVoiceWarmCache,
  clearVoiceCaches,
  clearRuntimeVoiceIndicator,
  playMessageAudio,
  stopRuntimeVoicePlayback,
  setRuntimeVoiceIndicator,
  sleep,
  messageUiKey,
  latestMessageByKey,
  hasActiveMiniGame,
  narratorVoiceBinding,
  roleVoiceBinding,
  warmVoiceBinding,
  waitForMessageReveal,
  resolveMessageVoiceBinding,
  // 打字机动画
  typewriterDisplayText,
  typewriterMessageId,
  isTyping,
} = voiceFlow;

const RUNTIME_FAST_PREVIEW_FORMAT = "mp3";
const RUNTIME_FAST_PREVIEW_SAMPLE_RATE = 16000;
const RUNTIME_VOICE_CACHE_LIMIT = 60;
const RUNTIME_CHAT_STORAGE_KEY = "toonflow.chat";
const PLAY_AUTO_VOICE_STORAGE_KEY = "toonflow.playAutoVoice";
const statePreviewExpanded = ref(false);
const runtimeEventWindowExpanded = ref(false);
const miniGamePanelExpanded = ref(false);
const messages = computed(() => store.state.messages);
const pendingDotTick = ref(0);
const session = computed(() => store.state.sessionDetail);
const currentWorld = computed(() => session.value?.world || null);
const debugChapterIndex = computed(() => store.getDebugChapterIndex());
const runtimeChapterId = computed(() => {
  if (store.state.debugMode) {
    return Number(store.state.debugChapterId || 0) || null;
  }
  const latestState = asMiniRecord(session.value?.latestSnapshot?.state);
  const currentState = asMiniRecord(session.value?.state);
  const raw = Number(latestState.chapterId || currentState.chapterId || session.value?.chapterId || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
});
const currentChapter = computed(() => {
  if (store.state.debugMode) {
    return store.state.chapters[debugChapterIndex.value] || null;
  }
  const activeChapterId = runtimeChapterId.value;
  const sessionChapter = session.value?.chapter || null;
  const matchedChapter = activeChapterId
    ? store.state.chapters.find((item) => Number(item.id || 0) === activeChapterId) || null
    : null;
  if (activeChapterId && Number(sessionChapter?.id || 0) === activeChapterId) {
    return matchedChapter
      ? {
        ...matchedChapter,
        ...sessionChapter,
        completionCondition: sessionChapter.completionCondition ?? matchedChapter.completionCondition,
        showCompletionCondition: sessionChapter.showCompletionCondition ?? matchedChapter.showCompletionCondition,
        runtimeOutline: sessionChapter.runtimeOutline ?? matchedChapter.runtimeOutline,
      }
      : sessionChapter;
  }
  if (activeChapterId) {
    if (matchedChapter) return matchedChapter;
  }
  return sessionChapter;
});
// 章节背景音乐独立于角色发言语音，只有作者显式勾选自动播放时才会按当前章节的 bgmPath 循环播放。
const currentChapterBgmUrl = computed(() => {
  if (currentChapter.value?.bgmAutoPlay === false) return "";
  const bgmPath = scalarText(currentChapter.value?.bgmPath || "");
  return bgmPath ? store.resolveMediaPath(bgmPath) : "";
});
const debugChapter = computed(() => store.state.chapters[debugChapterIndex.value] || null);

type RuntimeChatTraceRow = {
  conversationId: string;
  messageId: number;
  lineIndex: number;
  currentRole: string;
  currentRoleType: string;
  currentStatus: string;
  nextRole: string;
  nextRoleType: string;
  updateTime: number;
};

type RuntimeBattleEnemyView = {
  enemyId: string;
  name: string;
  description: string;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  avatarPath: string;
  avatarBgPath: string;
  isRoleEnemy: boolean;
};
function asMiniRecord(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function asMiniArray<T = unknown>(input: unknown): T[] {
  return Array.isArray(input) ? (input as T[]) : [];
}

function scalarText(input: unknown): string {
  const text = String(input ?? "").trim();
  if (!text || text === "null" || text === "undefined") return "";
  return text;
}

function normalizeRuntimeEventDigest(input: unknown): RuntimeEventDigestItem | null {
  const raw = asMiniRecord(input);
  if (!Object.keys(raw).length) return null;
  const eventFacts = asMiniArray(raw.eventFacts).map((item) => scalarText(item)).filter(Boolean);
  const memoryFacts = asMiniArray(raw.memoryFacts).map((item) => scalarText(item)).filter(Boolean);
  const allowedRoles = asMiniArray(raw.allowedRoles).map((item) => scalarText(item)).filter(Boolean);
  // 解析 stageProgress
  const stageProgressRaw = raw.stageProgress;
  let stageProgress: StageProgress | null = null;
  if (stageProgressRaw && typeof stageProgressRaw === "object") {
    const sp = stageProgressRaw as Record<string, unknown>;
    const stages = Array.isArray(sp.stages)
      ? sp.stages.map((s: any, idx: number) => ({
          index: Number(s?.index ?? idx),
          label: String(s?.label || ""),
          status: (["", "i", "s", "f"].includes(s?.status) ? s.status : "") as StageProgressStatus,
        }))
      : [];
    stageProgress = {
      phaseId: String(sp.phaseId || ""),
      phaseLabel: String(sp.phaseLabel || ""),
      stages,
    };
  }
  return {
    eventIndex: Number(raw.eventIndex || 0) || 0,
    eventKind: scalarText(raw.eventKind),
    eventFlowType: scalarText(raw.eventFlowType),
    eventSummary: scalarText(raw.eventSummary),
    eventFacts,
    eventStatus: scalarText(raw.eventStatus),
    summarySource: scalarText(raw.summarySource),
    memorySummary: scalarText(raw.memorySummary),
    memoryFacts,
    updateTime: Number(raw.updateTime || 0) || 0,
    allowedRoles,
    userNodeId: scalarText(raw.userNodeId),
    stageProgress,
  };
}

function runtimeEventStatusLabel(input: unknown): string {
  const status = scalarText(input);
  if (status === "completed") return "已完成";
  if (status === "waiting_input") return "等待用户";
  if (status === "active") return "进行中";
  if (status === "idle") return "未开始";
  return status || "未开始";
}

function runtimeEventKindLabel(input: unknown): string {
  const kind = scalarText(input);
  if (kind === "opening") return "开场";
  if (kind === "user") return "用户互动";
  if (kind === "fixed") return "固定事件";
  if (kind === "scene") return "场景事件";
  if (kind === "ending") return "结束事件";
  return kind || "事件";
}

function runtimeEventFlowLabel(item: RuntimeEventDigestItem | null | undefined): string {
  const flowType = scalarText(item?.eventFlowType).toLowerCase();
  if (flowType === "introduction") return "开场白";
  if (flowType === "chapter_ending_check") return "结束条件检查";
  if (flowType === "free_runtime") return "自由剧情";
  if (flowType === "chapter_content") return "章节内容";
  const kind = scalarText(item?.eventKind).toLowerCase();
  if (kind === "opening") return "开场白";
  if (kind === "ending") return "结束条件检查";
  if (kind === "fixed") return "固定条件";
  if (kind === "scene" || kind === "user") return "章节内容";
  return "章节事件";
}

function isChapterEventItem(item: RuntimeEventDigestItem | null | undefined): boolean {
  const flowType = scalarText(item?.eventFlowType).toLowerCase();
  const kind = scalarText(item?.eventKind).toLowerCase();
  return flowType !== "introduction" && kind !== "opening";
}

function splitCompletionConditionText(input: unknown): { successText: string; failureText: string } {
  const rawText = scalarText(input);
  if (!rawText) {
    return { successText: "", failureText: "" };
  }
  const matched = rawText.match(/^(.*?)[（(]\s*([^()（）]+?)\s*[)）]\s*$/);
  if (!matched) {
    return { successText: rawText, failureText: "" };
  }
  const successText = scalarText(matched[1]);
  const failureText = scalarText(matched[2]);
  if (!successText || !failureText || !/失败|fail|failed|failure/i.test(failureText)) {
    return { successText: rawText, failureText: "" };
  }
  return { successText, failureText };
}

function buildEndingOutlineSummary(input: {
  completionCondition: unknown;
  fixedEvents: Array<Record<string, unknown>>;
}): string {
  const completionText = scalarText(input.completionCondition);
  if (completionText) {
    return `结束条件：${completionText}`;
  }
  const labels = input.fixedEvents.map((item) => scalarText(item.label)).filter(Boolean);
  return labels.length ? `结束条件：${labels.join("；")}` : "结束条件检查";
}

function buildEndingOutlineFacts(fixedEvents: Array<Record<string, unknown>>): string[] {
  const labels = fixedEvents.map((item) => scalarText(item.label)).filter(Boolean);
  if (!labels.length) return [];
  return labels.map((label, index) => `${index === 0 ? "成功条件" : "失败条件"}：${label}`);
}

function normalizeOrchestratorRuntime(input: unknown): OrchestratorRuntimeMeta | null {
  const raw = asMiniRecord(input);
  if (!Object.keys(raw).length) return null;
  const payloadMode = scalarText(raw.payloadMode).toLowerCase();
  const payloadModeSource = scalarText(raw.payloadModeSource).toLowerCase();
  const reasoningEffort = scalarText(raw.reasoningEffort).toLowerCase();
  return {
    modelKey: scalarText(raw.modelKey),
    manufacturer: scalarText(raw.manufacturer),
    model: scalarText(raw.model),
    reasoningEffort: reasoningEffort === "minimal" || reasoningEffort === "low" || reasoningEffort === "medium" || reasoningEffort === "high"
      ? reasoningEffort
      : "",
    payloadMode: payloadMode === "advanced" ? "advanced" : "compact",
    payloadModeSource: payloadModeSource === "explicit" ? "explicit" : "inferred",
  };
}

function readPlayAutoVoicePreference(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(PLAY_AUTO_VOICE_STORAGE_KEY) !== "0";
}

const finishedSessionStatuses = new Set(["chapter_completed", "completed", "success", "finished"]);
const failedSessionStatuses = new Set(["failed", "dead", "lose", "loss"]);

function sessionStatusKey(input: unknown): string {
  return scalarText(input).toLowerCase();
}

/**
 * 切换"故事设定"里的原始状态快照展开状态。
 */
function toggleStatePreview(): void {
  statePreviewExpanded.value = !statePreviewExpanded.value;
}

/**
 * 切换"当前章节事件"里兜底原始事件窗口文本的展开状态。
 */
function toggleRuntimeEventWindowPreview(): void {
  runtimeEventWindowExpanded.value = !runtimeEventWindowExpanded.value;
}

function isRuntimeRetryMessage(message: MessageItem | null | undefined): message is MessageItem & { meta: RuntimeRetryMessageMeta } {
  if (!message || message.eventType !== "on_runtime_retry_error") return false;
  const meta = asMiniRecord(message.meta);
  return meta.kind === "runtime_retry" && typeof meta.token === "string";
}

function isStreamingRuntimeMessage(message: MessageItem | null | undefined): boolean {
  if (!message) return false;
  const meta = asMiniRecord(message.meta);
  return meta.kind === "runtime_stream" && meta.streaming === true;
}

function showRuntimeMessageLoading(message: MessageItem | null | undefined): boolean {
  return !!message && isStreamingRuntimeMessage(message) && !messageDisplayContent(message);
}

function runtimeMessageLoadingText(message: MessageItem | null | undefined): string {
  if (!message || !isStreamingRuntimeMessage(message) || messageDisplayContent(message)) {
    return "";
  }
  const speaker = messageTitle(message);
  const status = runtimeMessageStatus(message);
  if (["orchestrated", "auto_advancing", "waiting_next"].includes(status)) {
    return `${speaker} 正在准备下一句...`;
  }
  if (["streaming", "revealing", "voicing"].includes(status)) {
    return `${speaker} 正在生成台词...`;
  }
  return `${speaker} 正在生成内容...`;
}

/**
 * 判断是否应该在加载状态下显示重试按钮（用户可能卡住了）。
 * 条件：消息正在加载中，且不是玩家消息
 */
function showRuntimeRetryButton(message: MessageItem | null | undefined): boolean {
  if (!message) return false;
  // 只对系统消息（旁白/NPC）显示重试按钮
  const roleType = String(message.roleType || "").trim().toLowerCase();
  if (roleType === "player") return false;
  // 消息正在加载中
  return showRuntimeMessageLoading(message);
}

function runtimeStreamSentences(message: MessageItem | null | undefined): string[] {
  if (!message) return [];
  const meta = asMiniRecord(message.meta);
  return asMiniArray(meta.sentences).map((item) => scalarText(item)).filter(Boolean);
}

function messageDisplayContent(message: MessageItem | null | undefined): string {
  if (!message) return "";
  const content = scalarText(message.content);
  // 如果正在为这条消息打字，返回打字机显示的文本。
  // useToonflowStore 里启动 typewriter 时使用的是 String(message.id)，
  // ScenePlay 的 UI key 则包含 session/createTime/roleType，所以这里兼容两种 key。
  const typingKey = typewriterMessageId.value;
  if (isTyping.value && (typingKey === messageUiKey(message) || typingKey === String(message.id))) {
    return typewriterDisplayText.value;
  }
  if (content) return content;
  return runtimeStreamSentences(message).join("");
}

/**
 * 检查消息是否正在打字
 */
function isMessageTyping(message: MessageItem | null | undefined): boolean {
  if (!message) return false;
  const typingKey = typewriterMessageId.value;
  return isTyping.value && (typingKey === messageUiKey(message) || typingKey === String(message.id));
}

function runtimeMessageStatus(message: MessageItem | null | undefined): string {
  if (!message) return "";
  const meta = asMiniRecord(message.meta);
  return scalarText(meta.status);
}

function isLocalPendingPlayerMessage(message: MessageItem | null | undefined): boolean {
  if (!message || String(message.roleType || "").trim() !== "player") return false;
  const meta = asMiniRecord(message.meta);
  const status = runtimeMessageStatus(message);
  return meta.kind === "runtime_stream" && Number(message.id || 0) < 0 && ["sending", "error"].includes(status);
}

function isLocalFailedPlayerMessage(message: MessageItem | null | undefined): boolean {
  return isLocalPendingPlayerMessage(message) && runtimeMessageStatus(message) === "error";
}

function playerMessagePendingText(message: MessageItem | null | undefined): string {
  if (!isLocalPendingPlayerMessage(message)) return "";
  return isLocalFailedPlayerMessage(message) ? "发送失败" : "处理中...";
}

function runtimeRetryLabel(message: MessageItem | null | undefined): string {
  if (!isRuntimeRetryMessage(message)) return "重试";
  const label = scalarText(message.meta.retryLabel);
  return label || "重试";
}

function conversationMessages(): MessageItem[] {
  return messages.value.filter((message) => !isRuntimeRetryMessage(message));
}

function readRuntimeChatTraceRows(): RuntimeChatTraceRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RUNTIME_CHAT_STORAGE_KEY) || "[]";
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const rows = parsed
      .map((item) => asMiniRecord(item))
      .map((item) => {
        const currentStatus = scalarText(item.currentStatus);
        return {
          conversationId: scalarText(item.conversationId),
          messageId: Number(item.messageId || 0),
          lineIndex: Number(item.lineIndex || 0),
          currentRole: scalarText(item.currentRole),
          currentRoleType: scalarText(item.currentRoleType),
          currentStatus,
          // 禁止把旧缓存里的"下一位是谁"回放到 UI。
          nextRole: "",
          nextRoleType: "",
          updateTime: Number(item.updateTime || 0),
        };
      })
      .filter((item) => item.conversationId);
    const latestByConversation = new Map<string, RuntimeChatTraceRow>();
    rows.forEach((item) => {
      const previous = latestByConversation.get(item.conversationId);
      if (!previous || item.updateTime >= previous.updateTime) {
        latestByConversation.set(item.conversationId, item);
      }
    });
    const normalized = Array.from(latestByConversation.values()).sort((left, right) => left.updateTime - right.updateTime);
    if (normalized.length !== rows.length) {
      window.localStorage.setItem(RUNTIME_CHAT_STORAGE_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return [];
  }
}

function shortRuntimeConversationId(input: string): string {
  const text = scalarText(input);
  if (text.length <= 12) return text || "-";
  return `${text.slice(0, 10)}…`;
}

function currentRuntimeConversationId(): string {
  const runtimeState = store.state.debugMode
    ? asMiniRecord(store.state.debugRuntimeState)
    : asMiniRecord(session.value?.state || session.value?.latestSnapshot?.state || {});
  const debugRuntimeKey = scalarText(runtimeState.debugRuntimeKey);
  if (debugRuntimeKey) return debugRuntimeKey;
  const sessionId = scalarText(store.state.currentSessionId);
  if (sessionId) return `session:${sessionId}`;
  return `world:${store.state.worldId || 0}:chapter:${store.state.debugChapterId || 0}`;
}

function stringifyMiniStateValue(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (Array.isArray(input)) {
    return input.map((item) => stringifyMiniStateValue(item)).filter(Boolean).join("、");
  }
  if (typeof input === "object") {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }
  return String(input);
}

// sanitizeSpeechText, normalizePlayableSpeechText, speakableUnitCount, isDeterministicRuntimeVoiceError,
// setLimitedCacheValue 已移至 orchestrationVoiceFlow.ts

function normalizeChapterTitleLabel(input: unknown, sort?: unknown): string {
  const raw = scalarText(input);
  if (raw && !/^章节\s*\d{10,}$/u.test(raw)) return raw;
  const chapterSort = Number(sort || 0);
  if (Number.isFinite(chapterSort) && chapterSort > 0) {
    return `第 ${chapterSort} 章`;
  }
  return raw || "当前章节";
}

function extractOpeningContentParts(input: unknown): { role: string; line: string; body: string } | null {
  const text = String(input || "").trim();
  if (!text) return null;
  const match = text.match(/^开场白(?:\[(.+?)\]|([^\[\]:：\r\n]+))\s*[:：]\s*([^\r\n]*)(?:\r?\n)*/);
  if (!match) return null;
  return {
    role: String(match[1] || match[2] || "").trim(),
    line: String(match[3] || "").trim(),
    body: text.slice(match[0].length).replace(/^\s*[\r\n]+/, ""),
  };
}
function stripLeadingOpeningBlocks(input: unknown): string {
  let text = String(input || "").trim();
  if (!text) return "";
  for (let i = 0; i < 8; i += 1) {
    const extracted = extractOpeningContentParts(text);
    if (!extracted) break;
    text = extracted.body.replace(/^\s*[\r\n]+/, "");
  }
  return text;
}
const chapterBackgroundPath = computed(() =>
  store.resolveMediaPath(
    currentChapter.value?.backgroundPath || store.state.chapterBackground || currentWorld.value?.settings?.coverBgPath || currentWorld.value?.settings?.coverPath || "",
  ),
);
const chapterEntryText = computed(() => formatConditionText(currentChapter.value?.entryCondition));

function resolveVisibleChapterGoalText(): string {
  const configuredGoal = (formatConditionText(currentChapter.value?.completionCondition) || store.state.chapterCondition).trim();
  if (configuredGoal) return configuredGoal;
  // 底部目标只展示章节结束条件；事件目标统一放到编排信息面板。
  return "";
}

const chapterCompletionText = computed(() => {
  if (currentChapter.value?.showCompletionCondition === false) return "对用户隐藏";
  return resolveVisibleChapterGoalText() || "自由剧情";
});
// 底部目标 chip 只展示章节结束条件，避免把当前事件摘要和结束条件混在一起。
const chapterObjectiveText = computed(() => {
  // 结束条件为空时仍要展示稳定目标，避免底部目标 chip 直接消失。
  return resolveVisibleChapterGoalText() || "自由剧情";
});
const chapterObjectivePreview = computed(() => {
  const normalized = chapterObjectiveText.value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 20 ? `${normalized.slice(0, 20)}...` : normalized;
});
// 编排信息面板单独展示当前事件目标，优先使用当前事件摘要；没有时才回退到章节结束条件。
const currentEventTargetText = computed(() => {
  const currentEventSummary = scalarText(currentEventDigest.value?.eventSummary);
  if (currentEventSummary && currentEventSummary !== "当前事件摘要待生成") {
    return currentEventSummary;
  }
  const nextSummary = eventDigestWindowItems.value.map((item) => scalarText(item.eventSummary)).find(Boolean);
  if (nextSummary && nextSummary !== "当前事件摘要待生成") {
    return nextSummary;
  }
  return chapterObjectiveText.value;
});
const chapterStatusItems = computed(() => [
  { label: "章节状态", value: currentChapter.value?.status || "draft" },
  { label: "完成条件", value: currentChapter.value?.showCompletionCondition === false ? "隐藏" : "可见" },
  { label: "游玩模式", value: store.state.debugMode ? "调试缓存" : "正式会话" },
  { label: "章节序号", value: currentChapter.value?.sort != null ? String(currentChapter.value.sort) : "1" },
]);
const chapterConditionHint = computed(() => {
  if (!currentChapter.value) return "当前没有章节，无法判定进入或结束条件。";
  const entry = chapterEntryText.value || "无";
  const completion = currentChapter.value?.showCompletionCondition === false ? "已对用户隐藏" : (chapterCompletionText.value || "无");
  const modeHint = store.state.debugMode
    ? "当前处于调试缓存，发送消息后会按完成条件自动切章，未保存内容也会参与判定。"
    : "正式会话会由服务端决定章节推进，本地仅展示当前章节状态。";
  return `进入条件：${entry}\n完成条件：${completion}\n${modeHint}`;
});
const chapterOpeningDisplay = computed(() => {
  const openingRole = currentChapter.value?.openingRole || store.state.chapterOpeningRole || "旁白";
  const openingLine = currentChapter.value?.openingText || store.state.chapterOpeningLine || "";
  if (!openingLine) return "无";
  return `${openingRole}：${openingLine}`;
});
const chapterContentText = computed(() => {
  const openingRole = currentChapter.value?.openingRole || store.state.chapterOpeningRole || "旁白";
  const openingLine = currentChapter.value?.openingText || store.state.chapterOpeningLine || "";
  const raw = currentChapter.value?.content || store.state.chapterContent || "";
  const firstPass = stripLeadingOpeningBlocks(raw);
  if (!openingLine) return firstPass || "暂无章节内容";
  const extracted = extractOpeningContentParts(raw);
  if (!extracted) return firstPass || "暂无章节内容";
  const roleMatches = !openingRole || !extracted.role || extracted.role === openingRole;
  const lineMatches = !openingLine || !extracted.line || extracted.line === openingLine;
  return (roleMatches && lineMatches ? stripLeadingOpeningBlocks(extracted.body) : firstPass) || "暂无章节内容";
});
const runtimeState = computed<Record<string, unknown>>(() => {
  if (store.state.debugMode) return asMiniRecord(store.state.debugRuntimeState);
  return asMiniRecord(session.value?.state || session.value?.latestSnapshot?.state || {});
});
const runtimeEventViewRecord = computed(() =>
  store.state.debugMode
    ? asMiniRecord(store.state.debugRuntimeState)
    : asMiniRecord(session.value),
);
const currentEventDigest = computed<RuntimeEventDigestItem | null>(() =>
  normalizeRuntimeEventDigest(runtimeEventViewRecord.value.currentEventDigest || runtimeState.value.currentEventDigest),
);
const eventDigestWindowItems = computed<RuntimeEventDigestItem[]>(() => {
  const source = asMiniArray(runtimeEventViewRecord.value.eventDigestWindow || runtimeState.value.eventDigestWindow);
  return source
    .map((item) => normalizeRuntimeEventDigest(item))
    .filter((item): item is RuntimeEventDigestItem => Boolean(item));
});
const runtimeEventWindowText = computed(() =>
  scalarText(runtimeEventViewRecord.value.eventDigestWindowText || runtimeState.value.eventDigestWindowText),
);

// Stage 进度列表（用于 UI 显示事件链进度）
const allEventStageProgress = computed(() => {
  // 调试模式：从 debugRuntimeState 读取
  if (store.state.debugMode) {
    const fromDebug = (store.state.debugRuntimeState as any)?.allEventStageProgress;
    console.log("[ScenePlay][debug] allEventStageProgress from debugRuntimeState:", fromDebug);
    return (fromDebug || []) as StageProgress[];
  }
  // 正式模式：从 sessionDetail 读取
  const fromSession = (session.value as any)?.allEventStageProgress;
  console.log("[ScenePlay][session] allEventStageProgress:", fromSession, "session keys:", Object.keys(session.value || {}));
  if (fromSession) return fromSession as StageProgress[];
  return [] as StageProgress[];
});

// 当前 stage 进度（用于 UI 显示当前 phase 的 stage 进度）
const currentStageProgress = computed(() => {
  const progress = runtimeChapterProgressRecord.value;
  const currentPhaseId = scalarText(progress.phaseId);
  return allEventStageProgress.value.find(p => p.phaseId === currentPhaseId) || null;
});

// 当前 phase 的 stage 进度（用于内嵌到事件项显示）
const currentPhaseStageProgress = computed(() => currentStageProgress.value);

// Stage 进度状态标签
const stageStatusLabel = (status: StageProgressStatus): string => {
  switch (status) {
    case "s": return "完成";
    case "i": return "进行中";
    case "f": return "失败";
    default: return "未开始";
  }
};

const debugOrchestratorRuntime = computed<OrchestratorRuntimeMeta | null>(() =>
  store.state.debugMode ? normalizeOrchestratorRuntime(store.state.debugLatestPlan?.orchestratorRuntime) : null,
);
const debugOrchestratorRuntimeText = computed(() => {
  const runtime = debugOrchestratorRuntime.value;
  const planSource = scalarText(store.state.debugLatestPlan?.planSource);
  const planSourceLabel = planSource === "opening_preset"
    ? "开场白预设"
    : planSource === "ai_orchestrator"
      ? "正式编排"
      : planSource === "rule_orchestrator"
        ? "规则编排"
        : planSource === "fallback_orchestrator"
          ? "兜底编排"
          : planSource === "preset"
            ? "预设流程"
            : "";
  if (!runtime && !planSourceLabel) return "";
  const modeLabel = runtime?.payloadMode === "advanced" ? "高级版" : "精简版";
  const modeSourceLabel = runtime?.payloadModeSource === "explicit" ? "显式" : "推断";
  const modelLabel = runtime ? [runtime.manufacturer, runtime.model].filter(Boolean).join(" / ") : "";
  const reasoningLabel = runtime?.reasoningEffort || "未指定";
  return [
    planSourceLabel ? `流程：${planSourceLabel}` : "",
    runtime ? `编排运行：${modeLabel}（${modeSourceLabel}）` : "",
    runtime ? `推理强度：${reasoningLabel}` : "",
    modelLabel,
  ].filter(Boolean).join(" · ");
});
const chapterOutlineEventItems = computed<RuntimeEventDigestItem[]>(() => {
  const outline = asMiniRecord(currentChapter.value?.runtimeOutline);
  const phases = asMiniArray<Record<string, unknown>>(outline.phases);
  const fixedEvents = asMiniArray<Record<string, unknown>>(outline.fixedEvents);
  const completionBranches = splitCompletionConditionText(currentChapter.value?.completionCondition);
  const syntheticFixedEvents = fixedEvents.length
    ? []
    : [completionBranches.successText, completionBranches.failureText]
      .filter(Boolean)
      .map((label, index) => ({
        id: `synthetic_fixed_event_${index + 1}`,
        label,
      }));
  const allFixedEvents = fixedEvents.length ? fixedEvents : syntheticFixedEvents;
  if (!phases.length && !allFixedEvents.length) return [];
  const progress = runtimeChapterProgressRecord.value;
  const currentPhaseId = scalarText(progress.phaseId);
  const currentEventStatus = scalarText(progress.eventStatus) || "idle";
  const currentEventKind = scalarText(progress.eventKind) || scalarText(currentEventDigest.value?.eventKind);
  const currentEventFlowType = scalarText(currentEventDigest.value?.eventFlowType);
  const currentEventSummary = scalarText(currentEventDigest.value?.eventSummary);
  const completedEvents = new Set(
    asMiniArray(progress.completedEvents).map((item) => scalarText(item)).filter(Boolean),
  );
  const items: RuntimeEventDigestItem[] = [];

  phases.forEach((phase, phaseIdx) => {
    const phaseId = scalarText(phase.id);
    const phaseKind = scalarText(phase.kind) || "scene";
    const eventIndex = items.length + 1;

    // 生成带状态的 summary
    const stages = asMiniArray(phase.stages);
    const currentStageIndex = Number(progress.stageIndex) || 0;
    let eventSummary: string;

    if (stages.length > 0) {
      // 根据 stage 状态生成 summary
      const isPhaseCompleted = phaseId && completedEvents.has(`phase:${phaseId}`);
      const isCurrentPhase = phaseId && currentPhaseId && phaseId === currentPhaseId;

      const stageParts = stages.map((stage, stageIdx) => {
        const stageLabel = scalarText(stage.label) || `阶段${stageIdx + 1}`;
        let status = "";
        if (isPhaseCompleted) {
          status = "s";
        } else if (isCurrentPhase) {
          if (stageIdx < currentStageIndex) {
            status = "s";
          } else if (stageIdx === currentStageIndex) {
            status = (currentEventStatus === "waiting_input" || currentEventStatus === "active") ? "i" : "s";
          } else {
            status = "";
          }
        } else {
          // 非当前 phase：根据 phaseIndex 判断
          const currentPhaseIndex = phases.findIndex((item) => scalarText(item.id) === currentPhaseId);
          if (currentPhaseIndex >= 0 && phaseIdx < currentPhaseIndex) {
            status = "s";
          } else {
            status = "";
          }
        }
        return `[${status}]${stageLabel}`;
      });
      eventSummary = stageParts.join(" → ");
    } else {
      eventSummary = scalarText(phase.targetSummary) || scalarText(phase.label) || `事件 ${eventIndex}`;
    }

    let eventStatus = "idle";
    if (phaseId && completedEvents.has(`phase:${phaseId}`)) {
      eventStatus = "completed";
    } else if (phaseId && currentPhaseId && phaseId === currentPhaseId) {
      eventStatus = currentEventStatus || "active";
    } else if (currentEventKind && currentEventKind !== "opening" && phaseId && currentPhaseId && phaseId !== currentPhaseId) {
      const currentPhaseIndex = phases.findIndex((item) => scalarText(item.id) === currentPhaseId);
      const phaseIndex = phases.findIndex((item) => scalarText(item.id) === phaseId);
      if (currentPhaseIndex >= 0 && phaseIndex >= 0 && phaseIndex < currentPhaseIndex) {
        eventStatus = "completed";
      }
    } else if (!currentPhaseId && currentEventKind === phaseKind && currentEventSummary && currentEventSummary === eventSummary) {
      eventStatus = currentEventStatus || "active";
    } else if (!currentPhaseId && currentEventKind && currentEventKind !== "opening" && items.length > 0) {
      // 自由章节动态事件模式下，根据 eventIndex 判断 phase 是否已完成
      // eventIndex 从 1 开始，phaseIndex 从 0 开始
      // 如果当前 phase 的索引小于当前事件索引 - 1，说明该 phase 的事件已结束
      const currentEventIndex = Number(progress.eventIndex) || 0;
      if (phaseIdx < currentEventIndex - 1) {
        eventStatus = "completed";
      }
    }
    items.push({
      eventIndex,
      eventKind: phaseKind,
      eventFlowType: "chapter_content",
      eventSummary,
      eventFacts: [],
      eventStatus,
      summarySource: "outline",
      memorySummary: "",
      memoryFacts: [],
      updateTime: 0,
      allowedRoles: asMiniArray(phase.allowedSpeakers).map((item) => scalarText(item)).filter(Boolean),
      userNodeId: scalarText(phase.userNodeId),
    });
  });

  if (allFixedEvents.length) {
    const anyCompleted = allFixedEvents.some((event) => {
      const eventId = scalarText(event.id);
      return eventId && completedEvents.has(eventId);
    });
    let eventStatus = "idle";
    if (currentEventFlowType === "chapter_ending_check" || currentEventKind === "fixed" || currentEventKind === "ending") {
      eventStatus = currentEventStatus || "waiting_input";
    } else if (anyCompleted) {
      eventStatus = "completed";
    }
    items.push({
      eventIndex: items.length + 1,
      eventKind: "fixed",
      eventFlowType: "chapter_ending_check",
      eventSummary: buildEndingOutlineSummary({
        completionCondition: currentChapter.value?.completionCondition,
        fixedEvents: allFixedEvents,
      }),
      eventFacts: buildEndingOutlineFacts(allFixedEvents),
      eventStatus,
      summarySource: "outline",
      memorySummary: "",
      memoryFacts: [],
      updateTime: 0,
      allowedRoles: [],
      userNodeId: "",
    });
  }

  return items;
});
const visibleEventItems = computed<RuntimeEventDigestItem[]>(() => {
  const runtimeItems = eventDigestWindowItems.value.filter((item) => isChapterEventItem(item));
  const outlineItems = chapterOutlineEventItems.value;
  const runtimeLooksReady = runtimeItems.length > 1
    || runtimeItems.some((item) => scalarText(item.eventSummary))
    || runtimeItems.some((item) => (item.eventFacts || []).length > 0);
  if (!outlineItems.length) return runtimeItems;
  if (outlineItems.length > runtimeItems.length) return outlineItems;
  return runtimeLooksReady ? runtimeItems : outlineItems;
});
function normalizeRoleParameterCard(input: unknown): RoleParameterCard | null {
  const raw = asMiniRecord(input);
  if (!Object.keys(raw).length) return null;
  const ageText = scalarText(raw.age);
  const ageValue = ageText && /^\d+$/.test(ageText) ? Number(ageText) : null;
  const levelText = scalarText(raw.level);
  const levelValue = levelText && /^\d+$/.test(levelText) ? Number(levelText) : null;
  const expValue = Number(raw.exp);
  const nextLevelExpValue = Number(raw.next_level_exp ?? raw.nextLevelExp);
  const hpValue = Number(raw.hp);
  const mpValue = Number(raw.mp);
  const moneyValue = Number(raw.money);
  const card: RoleParameterCard = {
    name: scalarText(raw.name),
    raw_setting: scalarText(raw.raw_setting || raw.rawSetting),
    gender: scalarText(raw.gender),
    age: ageValue != null && Number.isFinite(ageValue) ? ageValue : null,
    level: levelValue != null && Number.isFinite(levelValue) ? levelValue : 1,
    // 参数卡里的经验值字段来自运行时 JSON，不在这里显式解析的话，
    // 详情面板就会把已有数字误判成"未设定"。
    exp: Number.isFinite(expValue) ? expValue : 0,
    next_level_exp: Number.isFinite(nextLevelExpValue) ? nextLevelExpValue : 100,
    level_desc: scalarText(raw.level_desc || raw.levelDesc) || "初入此界",
    personality: scalarText(raw.personality),
    appearance: scalarText(raw.appearance),
    voice: scalarText(raw.voice),
    skills: asMiniArray(raw.skills).map((item) => scalarText(item)).filter(Boolean),
    items: asMiniArray(raw.items).map((item) => scalarText(item)).filter(Boolean),
    equipment: asMiniArray(raw.equipment).map((item) => scalarText(item)).filter(Boolean),
    hp: Number.isFinite(hpValue) ? hpValue : 100,
    mp: Number.isFinite(mpValue) ? mpValue : 0,
    money: Number.isFinite(moneyValue) ? moneyValue : 0,
    other: asMiniArray(raw.other).map((item) => scalarText(item)).filter(Boolean),
  };
  return Object.values(card).some((value) => Array.isArray(value) ? value.length > 0 : value !== "" && value != null)
    ? card
    : null;
}

function normalizeRuntimeMixVoices(input: unknown): VoiceMixItem[] {
  return asMiniArray<Record<string, unknown>>(input)
    .map((item) => ({
      voiceId: scalarText(item.voiceId),
      weight: Number(item.weight || 0.7),
    }))
    .filter((item) => item.voiceId);
}

function runtimeRoleSnapshot(roleType: "player" | "narrator"): StoryRole | null {
  const raw = asMiniRecord(runtimeState.value[roleType]);
  if (!Object.keys(raw).length) return null;
  const snapshot: StoryRole = {
    id: scalarText(raw.id) || roleType,
    roleType: scalarText(raw.roleType) || roleType,
    name: scalarText(raw.name) || (roleType === "player" ? "用户" : "旁白"),
    avatarPath: scalarText(raw.avatarPath),
    avatarBgPath: scalarText(raw.avatarBgPath),
    description: scalarText(raw.description),
    voice: scalarText(raw.voice),
    voiceMode: scalarText(raw.voiceMode),
    voicePresetId: scalarText(raw.voicePresetId),
    voiceReferenceAudioPath: scalarText(raw.voiceReferenceAudioPath),
    voiceReferenceAudioName: scalarText(raw.voiceReferenceAudioName),
    voiceReferenceText: scalarText(raw.voiceReferenceText),
    voicePromptText: scalarText(raw.voicePromptText),
    voiceMixVoices: normalizeRuntimeMixVoices(raw.voiceMixVoices),
    sample: scalarText(raw.sample),
    parameterCardJson: normalizeRoleParameterCard(raw.parameterCardJson),
  };
  return snapshot;
}

function runtimeNpcSnapshot(baseRole: StoryRole): StoryRole | null {
  const npcBag = asMiniRecord(runtimeState.value.npcs);
  if (!Object.keys(npcBag).length) return null;
  const baseId = scalarText(baseRole.id);
  const baseName = scalarText(baseRole.name);
  const raw = Object.values(npcBag)
    .map((item) => asMiniRecord(item))
    .find((item) => {
      const itemId = scalarText(item.id);
      const itemName = scalarText(item.name);
      return (baseId && itemId && itemId === baseId) || (baseName && itemName && itemName === baseName);
    });
  if (!raw || !Object.keys(raw).length) return null;
  const snapshot: StoryRole = {
    id: scalarText(raw.id) || baseRole.id,
    roleType: scalarText(raw.roleType) || baseRole.roleType || "npc",
    name: scalarText(raw.name) || baseRole.name,
    avatarPath: scalarText(raw.avatarPath),
    avatarBgPath: scalarText(raw.avatarBgPath),
    description: scalarText(raw.description),
    voice: scalarText(raw.voice),
    voiceMode: scalarText(raw.voiceMode),
    voicePresetId: scalarText(raw.voicePresetId),
    voiceReferenceAudioPath: scalarText(raw.voiceReferenceAudioPath),
    voiceReferenceAudioName: scalarText(raw.voiceReferenceAudioName),
    voiceReferenceText: scalarText(raw.voiceReferenceText),
    voicePromptText: scalarText(raw.voicePromptText),
    voiceMixVoices: normalizeRuntimeMixVoices(raw.voiceMixVoices),
    sample: scalarText(raw.sample),
    parameterCardJson: normalizeRoleParameterCard(raw.parameterCardJson),
  };
  return snapshot;
}

function mergeRoleSnapshot(base: StoryRole, runtime: StoryRole | null): StoryRole {
  if (!runtime) return base;
  return {
    ...base,
    ...runtime,
    id: runtime.id || base.id,
    roleType: runtime.roleType || base.roleType,
    name: runtime.name || base.name,
    avatarPath: runtime.avatarPath || base.avatarPath,
    avatarBgPath: runtime.avatarBgPath || base.avatarBgPath,
    description: runtime.description || base.description,
    voice: runtime.voice || base.voice,
    voiceMode: runtime.voiceMode || base.voiceMode,
    voicePresetId: runtime.voicePresetId || base.voicePresetId,
    voiceReferenceAudioPath: runtime.voiceReferenceAudioPath || base.voiceReferenceAudioPath,
    voiceReferenceAudioName: runtime.voiceReferenceAudioName || base.voiceReferenceAudioName,
    voiceReferenceText: runtime.voiceReferenceText || base.voiceReferenceText,
    voicePromptText: runtime.voicePromptText || base.voicePromptText,
    voiceMixVoices: runtime.voiceMixVoices?.length ? runtime.voiceMixVoices : (base.voiceMixVoices || []),
    sample: runtime.sample || base.sample,
    parameterCardJson: runtime.parameterCardJson ?? base.parameterCardJson ?? null,
  };
}

const roleCards = computed(() => {
  const seen = new Set<string>();
  const list: StoryRole[] = [];
  const pushRole = (role?: StoryRole | null) => {
    if (!role || !role.name) return;
    const key = role.id || `${role.roleType}:${role.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(role);
  };
  if (store.state.debugMode && !currentWorld.value) {
    pushRole({
      id: "player",
      roleType: "player",
      name: store.state.playerName || "用户",
      description: store.state.playerDesc,
      voice: store.state.playerVoice,
      voiceMode: store.state.playerVoiceMode,
      voicePresetId: store.state.playerVoicePresetId,
      voiceReferenceAudioPath: store.state.playerVoiceReferenceAudioPath,
      voiceReferenceAudioName: store.state.playerVoiceReferenceAudioName,
      voiceReferenceText: store.state.playerVoiceReferenceText,
      voicePromptText: store.state.playerVoicePromptText,
      voiceMixVoices: store.state.playerVoiceMixVoices,
      avatarPath: store.state.userAvatarPath,
      avatarBgPath: store.state.userAvatarBgPath,
      sample: "",
      parameterCardJson: null,
    } as StoryRole);
    pushRole({
      id: "narrator",
      roleType: "narrator",
      name: store.state.narratorName || "旁白",
      description: "",
      voice: store.state.narratorVoice,
      voiceMode: store.state.narratorVoiceMode,
      voicePresetId: store.state.narratorVoicePresetId,
      voiceReferenceAudioPath: store.state.narratorVoiceReferenceAudioPath,
      voiceReferenceAudioName: store.state.narratorVoiceReferenceAudioName,
      voiceReferenceText: store.state.narratorVoiceReferenceText,
      voicePromptText: store.state.narratorVoicePromptText,
      voiceMixVoices: store.state.narratorVoiceMixVoices,
      avatarPath: "",
      avatarBgPath: "",
      sample: "",
      parameterCardJson: null,
    } as StoryRole);
    (store.state.npcRoles || []).forEach((role) => pushRole(role));
  } else {
    const world = currentWorld.value;
    pushRole(world?.playerRole || null);
    pushRole(world?.narratorRole || null);
    (world?.settings?.roles || []).forEach((role) => pushRole(role));
  }
  const runtimePlayer = runtimeRoleSnapshot("player");
  const runtimeNarrator = runtimeRoleSnapshot("narrator");
  return list.map((role) => {
    if (role.roleType === "player") {
      return mergeRoleSnapshot(role, runtimePlayer);
    }
    if (role.roleType === "narrator") {
      return mergeRoleSnapshot(role, runtimeNarrator);
    }
    return mergeRoleSnapshot(role, runtimeNpcSnapshot(role));
  });
});
const runtimeTurnState = computed(() => asMiniRecord(runtimeState.value.turnState));
// 正式会话优先认 store 里的 awaitUser 本地兜底态，
// 避免 orchestration 已经交还用户输入，但 storyInfo 旧 turnState 还没追上时短暂锁住输入框。
const canPlayerSpeak = computed(() => store.sessionCanPlayerSpeak());
const playSessionStatus = computed(() => scalarText(session.value?.status));
const expectedSpeaker = computed(() => scalarText(runtimeTurnState.value.expectedRole) || "当前角色");
const activeMiniGame = computed(() => {
  const root = asMiniRecord(runtimeState.value.miniGame);
  const sessionState = asMiniRecord(root.session);
  const ui = asMiniRecord(root.ui);
  const status = scalarText(sessionState.status);
  const gameType = scalarText(sessionState.gameType || sessionState.game_type);
  const uiStateItems = asMiniArray<Record<string, unknown>>(ui.state_items);
  const visibleStatuses = new Set(["preparing", "active", "settling", "suspended"]);
  const pendingExit = Boolean(sessionState.pending_exit);
  if (!gameType) return null;
  if (!visibleStatuses.has(status) && !pendingExit) return null;
  return {
    gameType,
    displayName: scalarText(asMiniRecord(root.rulebook).displayName) || gameType,
    status,
    phase: miniGamePhaseLabel(gameType, scalarText(sessionState.phase), scalarText(ui.phase_label)),
    round: Number(sessionState.round || 0),
    publicState: asMiniRecord(sessionState.public_state),
    ruleSummary: scalarText(ui.rule_summary),
    narration: scalarText(ui.narration),
    pendingExit,
    stateItems: miniGameStateItems(gameType, asMiniRecord(sessionState.public_state), uiStateItems),
    acceptsTextInput: Boolean(ui.accepts_text_input)
      || ((status !== "finished" && status !== "aborted") && ["research_skill", "alchemy", "upgrade_equipment", "battle"].includes(gameType)),
    inputHint: scalarText(ui.input_hint),
  };
});
const latestConversationMessage = computed(() => {
  const list = conversationMessages();
  return list.length ? list[list.length - 1] : null;
});
const currentRuntimeInputStatus = computed(() => {
  if (store.state.sessionOpening) return "session_opening";
  if (store.state.sessionOpenError) return "session_error";
  const latestStatus = runtimeMessageStatus(latestConversationMessage.value);
  if (latestStatus === "waiting_player" && canPlayerSpeak.value) return "waiting_player";
  if (latestStatus === "waiting_next" && !canPlayerSpeak.value) return "waiting_next";
  if (store.state.sendPending || store.state.runtimeProcessingPending) return "sending";
  if (activeMiniGame.value) return "waiting_player";
  if (latestStatus === "sending") return "sending";
  if (canPlayerSpeak.value && latestStatus === "auto_advancing") {
    return "waiting_player";
  }
  if (latestStatus === "orchestrated") {
    return canPlayerSpeak.value ? "waiting_player" : "waiting_next";
  }
  if (
    canPlayerSpeak.value
    && latestStatus
    && !["streaming", "generated", "revealing", "voicing", "auto_advancing", "sending", "orchestrated"].includes(latestStatus)
  ) {
    return "waiting_player";
  }
  if (latestStatus) return latestStatus;
  return canPlayerSpeak.value ? "waiting_player" : "waiting_next";
});
const canPlayerInput = computed(() => {
  if (store.state.sessionOpening) return false;
  if (store.state.sessionOpenError) return false;
  if (activeMiniGame.value) return true;
  if (canPlayerSpeak.value && currentRuntimeInputStatus.value === "waiting_player") return true;
  if (store.state.sendPending || store.state.runtimeProcessingPending) return false;
  if (sessionRuntimeStageText.value) return false;
  return canPlayerSpeak.value && currentRuntimeInputStatus.value === "waiting_player";
});
const processingDots = computed(() => ".".repeat((pendingDotTick.value % 3) + 1));
const sessionOpeningStageText = computed(() => scalarText((store.state as Record<string, unknown>).sessionOpeningStage) || "正在进入故事...");
const sessionOpenErrorText = computed(() => scalarText((store.state as Record<string, unknown>).sessionOpenError) || "");
const playOpenOverlayVisible = computed(() => (
  !store.state.debugMode
  && !store.state.messages.length
  && (store.state.sessionOpening || Boolean(sessionOpenErrorText.value))
));
const playOpenOverlayTitle = computed(() => (store.state.sessionOpening ? "进入故事中" : "打开会话失败"));
const playOpenOverlaySub = computed(() => (store.state.sessionOpening ? sessionOpeningStageText.value : sessionOpenErrorText.value));
const sessionRuntimeStageText = computed(() => scalarText((store.state as Record<string, unknown>).sessionRuntimeStage) || "");
const emptySessionHint = computed(() => {
  if (store.state.sessionOpening) return sessionOpeningStageText.value;
  if (sessionOpenErrorText.value) return "打开会话失败";
  if (store.state.currentSessionId) return "正在等待首句内容...";
  return "当前会话暂无消息";
});
const playInputPlaceholder = computed(() => {
  if (store.state.sessionOpening) return sessionOpeningStageText.value;
  if (sessionOpenErrorText.value) return "打开会话失败，请重试";
  if (activeMiniGame.value) {
    return miniGameInputPlaceholder(activeMiniGame.value, inputMode.value === "text");
  }
  const runtimeStatus = currentRuntimeInputStatus.value;
  const status = sessionStatusKey(playSessionStatus.value);
  if (runtimeStatus === "waiting_player" && canPlayerSpeak.value) {
    return inputMode.value === "text" ? "输入一句话继续故事" : "按住说话";
  }
  if (runtimeStatus === "sending") {
    return `处理中${processingDots.value}`;
  }
  if (sessionRuntimeStageText.value) return `${sessionRuntimeStageText.value}${processingDots.value}`;
  if (finishedSessionStatuses.has(status)) {
    return "当前章节已完成";
  }
  if (failedSessionStatuses.has(status)) {
    return "当前故事已失败";
  }
  // 正式会话不再消费"下一位是谁"的预编排字段。
  // 这里继续展示 expectedRole 很容易把当前说话人或旧缓存误显示成"下一位"，因此统一退回泛化提示。
  return "当前还没轮到用户发言";
});

// 本地发送中状态，解决点击发送到后端状态更新之间的空窗期
// 必须在下面的 watch 之前声明，否则 setup() 执行到 watch 时会 ReferenceError
const androidSubmitting = ref(false);

// 当系统进入可输入/完成/失败等稳定状态时，自动清掉本地发送状态
watch(
  () => [
    currentRuntimeInputStatus.value,
    sessionRuntimeStageText.value,
    canPlayerInput.value,
    playSessionStatus.value,
  ],
  () => {
    if (!androidSubmitting.value) return;
    const status = sessionStatusKey(playSessionStatus.value);
    const rt = currentRuntimeInputStatus.value;
    // 可输入了，或进入明确阶段，或会话结束/失败 → 清掉本地发送状态
    if (canPlayerInput.value) {
      androidSubmitting.value = false;
    } else if (rt === "orchestrated" || rt === "streaming" || rt === "generated" || rt === "revealing" || rt === "voicing" || rt === "auto_advancing" || sessionRuntimeStageText.value) {
      androidSubmitting.value = false;
    } else if (finishedSessionStatuses.has(status) || failedSessionStatuses.has(status)) {
      androidSubmitting.value = false;
    }
  },
);

// 安卓输入区处理中提示，涵盖所有不可输入状态
const androidInputHint = computed(() => {
  if (store.state.sessionOpening) return sessionOpeningStageText.value + "...";
  if (sessionOpenErrorText.value) return "打开会话失败";
  if (activeMiniGame.value) {
    return miniGameInputPlaceholder(activeMiniGame.value, true);
  }
  const runtimeStatus = currentRuntimeInputStatus.value;
  const status = sessionStatusKey(playSessionStatus.value);
  // 明确阶段状态优先显示
  if (runtimeStatus === "orchestrated") return "编排中...";
  if (runtimeStatus === "streaming") return "台词生成中...";
  if (runtimeStatus === "generated") return "台词生成完成...";
  if (runtimeStatus === "revealing") return "台词展示中...";
  if (runtimeStatus === "voicing") return `正在朗读${expectedSpeaker.value || "台词"}...`;
  if (runtimeStatus === "auto_advancing") return "自动推进中...";
  if (sessionRuntimeStageText.value) return `${sessionRuntimeStageText.value}${processingDots.value}`;
  // 发送中：只在点击发送到进入阶段状态之间的空窗期显示
  if (androidSubmitting.value || runtimeStatus === "sending" || store.state.sendPending || store.state.runtimeProcessingPending) {
    return `处理中${processingDots.value}`;
  }
  if (finishedSessionStatuses.has(status)) return "当前章节已完成";
  if (failedSessionStatuses.has(status)) return "当前故事已失败";
  return "当前还没轮到用户发言";
});
const playTurnHint = computed(() => {
  if (store.state.sessionOpening) return sessionOpeningStageText.value;
  if (sessionOpenErrorText.value) return `打开会话失败：${sessionOpenErrorText.value}`;
  if (activeMiniGame.value) {
    return miniGameTurnHint(activeMiniGame.value);
  }
  const runtimeStatus = currentRuntimeInputStatus.value;
  const status = sessionStatusKey(playSessionStatus.value);

  if (runtimeStatus === "waiting_player" && canPlayerSpeak.value) {
    return "";
  }
  if (runtimeStatus === "sending") {
    return `正在处理${processingDots.value}`;
  }
  if (runtimeStatus === "error") {
    return "发送失败，可重试或重新输入。";
  }
  if (sessionRuntimeStageText.value) return `${sessionRuntimeStageText.value}${processingDots.value}`;
  if (finishedSessionStatuses.has(status)) {
    return "当前章节已完成，可刷新或返回历史继续查看。";
  }
  if (failedSessionStatuses.has(status)) {
    return "当前故事已失败，可返回历史重新开始。";
  }
  if (isLocalFailedPlayerMessage(latestConversationMessage.value)) {
    return "发送失败，可重试或重新输入。";
  }
  if (runtimeStatus === "voicing") {
    return `正在朗读${expectedSpeaker.value}的发言，稍后继续。`;
  }
  if (runtimeStatus === "streaming" || runtimeStatus === "generated" || runtimeStatus === "revealing" || runtimeStatus === "auto_advancing" || runtimeStatus === "orchestrated") {
       WebDebugLogUtil.log("[aiGame][runtimeStatus] status", {
          status,
          runtimeStatus,
          canPlayerSpeak: canPlayerSpeak.value,
          expectedSpeaker: expectedSpeaker.value,
        });
    return "正在生成下一句内容...";
  }
  WebDebugLogUtil.log("[aiGame][runtimeStatus] status", {
      status,
      runtimeStatus,
      canPlayerSpeak: canPlayerSpeak.value,
      expectedSpeaker: expectedSpeaker.value,
    });
  // 正式会话的下一位角色名可能滞后于最新 turnState，同样不适合作为主提示直接展示。
  // 这里统一改成泛化文案，避免出现"轮到某角色发言"但实际并非如此的误导状态。
  return "当前还没轮到用户发言，等待剧情继续。";
});


/**
 * 为小游戏输入区生成占位提示。
 *
 * 用途：
 * - 小游戏模式下，长提示应放到底部 turn hint，不应塞进输入框；
 * - 否则移动端和窄屏下输入框会被占位文本撑高，影响输入体验；
 * - 因此文本输入统一返回空串，语音模式仅保留"按住说话"。
 */
function miniGameInputPlaceholder(
  game: NonNullable<typeof activeMiniGame.value>,
  textMode: boolean,
) {
  if (!textMode) {
    return "按住说话";
  }
  return "";
}

/**
 * 为小游戏模式生成底部状态提示。
 *
 * 用途：
 * - 任务和修炼需要明确告诉用户当前处于特殊玩法中；
 * - 普通小游戏若后端已经提供 `inputHint`，这里直接复用，减少前后端文案分叉。
 */
function miniGameTurnHint(game: NonNullable<typeof activeMiniGame.value>) {
  const serverHint = game.inputHint.trim();
  if (game.gameType === "task") {
    return serverHint || "当前处于任务执行状态，直接输入行动推进任务；输入 #退出 视为放弃当前任务。";
  }
  if (game.gameType === "cultivation") {
    return serverHint || "当前处于修炼状态，直接输入修炼动作或目标；输入 #退出 结束本轮修炼。";
  }
  return serverHint;
}

function miniGamePhaseLabel(gameType: string, phase: string, uiPhaseLabel: string) {
  if (uiPhaseLabel) return uiPhaseLabel;
  if (gameType === "fishing") {
    if (phase === "prepare") return "准备中";
    if (phase === "waiting") return "等待结果";
    if (phase === "result") return "本轮结束";
    if (phase === "settling") return "已结束";
  }
  return phase || "进行中";
}

function miniGameStateItems(gameType: string, publicState: Record<string, unknown>, uiItems: Array<Record<string, unknown>>) {
  if (uiItems.length) {
    return uiItems
      .map((item) => ({
        key: scalarText(item.key),
        value: scalarText(item.value),
      }))
      .filter((item) => item.key && item.value);
  }
  if (gameType === "fishing") {
    return [
      { key: "当前水域", value: scalarText(publicState.site_name) || "当前水域" },
      { key: "当前状态", value: scalarText(publicState.current_status) || "准备抛竿" },
      { key: "本轮结果", value: scalarText(publicState.last_result) || "暂无" },
      { key: "最近收获", value: scalarText(publicState.last_reward) || "暂无" },
    ];
  }
  // ★ 任务模式：从 process_steps 数组生成带状态标记的推进过程
  if (gameType === "task") {
    const processSteps = publicState.process_steps;
    if (Array.isArray(processSteps) && processSteps.length > 0) {
      return [
        { key: "任务目标", value: scalarText(publicState.current_objective) || "" },
        {
          key: "推进过程",
          value: processSteps.map((step: unknown) => {
            const s = scalarText(step);
            // 已有 [i]/[s]/[f]/[] 标记的直接显示
            if (/^\[[isaf]\]\s*/.test(s)) return s;
            // 无标记的补上 []
            return `[] ${s}`;
          }).join("\n"),
        },
        { key: "成功条件", value: (publicState.success_conditions as unknown as string[] | undefined)?.join("；") || "" },
        { key: "失败条件", value: (publicState.failure_conditions as unknown as string[] | undefined)?.join("；") || "" },
      ].filter(item => item.value);
    }
  }
  return Object.entries(publicState)
    .map(([key, value]) => ({
      key,
      value: stringifyMiniStateValue(value),
    }))
    .filter((item) => item.value.trim().length > 0)
    .slice(0, 10);
}

/**
 * 将小游戏 public_state 里的敌人列表转换成设置面板可直接展示的结构。
 * battle 规则本会把临时敌人的头像、数值和简介都落在 enemy_list 中，前端只做轻量归一化。
 */
function battleEnemiesFromMiniGame(publicState: Record<string, unknown>): RuntimeBattleEnemyView[] {
  return asMiniArray<Record<string, unknown>>(publicState.enemy_list)
    .map((item, index) => {
      const hp = Number(item.hp || 0) || 0;
      const maxHp = Math.max(Number(item.maxHp || item.max_hp || hp || 0) || 0, hp);
      const mp = Number(item.mp || 0) || 0;
      const maxMp = Math.max(Number(item.maxMp || item.max_mp || mp || 0) || 0, mp);
      return {
        enemyId: scalarText(item.enemyId || item.enemy_id) || `enemy_${index}`,
        name: scalarText(item.name) || `敌人${index + 1}`,
        description: scalarText(item.description) || "临时敌人",
        level: Number(item.level || 1) || 1,
        hp,
        maxHp,
        mp,
        maxMp,
        avatarPath: scalarText(item.avatarPath || item.avatar_path),
        avatarBgPath: scalarText(item.avatarBgPath || item.avatar_bg_path),
        isRoleEnemy: Boolean(item.isRoleEnemy || item.is_role_enemy),
      };
    })
    .filter((item) => item.name);
}

/**
 * 计算血量/蓝量进度条百分比，统一限制在 0 到 100 之间，避免异常数值撑坏 UI。
 */
function battleGaugePercent(current: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

const miniGameSummaryItems = computed(() => {
  if (!activeMiniGame.value) return [];
  return activeMiniGame.value.stateItems || [];
});

/**
 * 监听小游戏面板视图变化，便于排查"为什么小游戏面板出现或消失"。
 */
watch(
  activeMiniGame,
  (game) => {
    WebDebugLogUtil.log("[aiGame][miniGame] activeMiniGame changed", game ? {
      gameType: game.gameType,
      status: game.status,
      phase: game.phase,
      pendingExit: game.pendingExit,
      acceptsTextInput: game.acceptsTextInput,
    } : null);
  },
  { deep: true, immediate: true },
);

const battleEnemies = computed(() => {
  const game = activeMiniGame.value;
  if (!game || game.gameType !== "battle") return [];
  return battleEnemiesFromMiniGame(game.publicState);
});
watch(() => activeMiniGame.value?.gameType || "", () => {
  // 小游戏面板默认折叠，用户手动点击"展开"才显示。
  miniGamePanelExpanded.value = false;
});

const playMode = ref<"live" | "history" | "tips" | "setting">("live");
const playbackCursor = ref(0);
const playbackPlaying = ref(false);
// 观看模式视图模式：list = 列表式逐条堆叠；single = 单台词大屏（只显示当前 cursor 那一条）
const playbackViewMode = ref<"list" | "single">("list");
let playbackRunId = 0;
const isSessionPlaybackMode = computed(() => !store.state.debugMode && store.state.sessionViewMode === "playback");
const inputMode = ref<"voice" | "text">("text");

// 安卓设备模式检测
const isAndroidDevice = ref(false);
function checkAndroidDevice() {
  const urlParams = new URLSearchParams(window.location.search);
  const deviceParam = urlParams.get("device");
  // 默认为非安卓
  isAndroidDevice.value = false;
  if (deviceParam === "pc" || deviceParam === "desktop") {
    isAndroidDevice.value = false;
    return;
  }
  if (deviceParam === "mobile") {
    isAndroidDevice.value = true;
    return;
  }
  if (typeof (window as any).Android !== "undefined") {
    isAndroidDevice.value = true;
    return;
  }
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("android") && (ua.includes("mobile") || ua.includes("toonflow"))) {
    isAndroidDevice.value = true;
  }
}
onMounted(() => {
  checkAndroidDevice();
  // 监听原生语音识别事件
  if (isAndroidDevice.value) {
    window.addEventListener("speechstart", onNativeSpeechStart);
    window.addEventListener("speechpartial", onNativeSpeechPartial);
    window.addEventListener("speechresult", onNativeSpeechResult);
    window.addEventListener("speecherror", onNativeSpeechError);
    window.addEventListener("speechend", onNativeSpeechEnd);
    window.addEventListener("permission-granted", onPermissionGranted);
    window.addEventListener("permission-denied", onPermissionDenied);
  }
});

onBeforeUnmount(() => {
  if (isAndroidDevice.value) {
    window.removeEventListener("speechstart", onNativeSpeechStart);
    window.removeEventListener("speechpartial", onNativeSpeechPartial);
    window.removeEventListener("speechresult", onNativeSpeechResult);
    window.removeEventListener("speecherror", onNativeSpeechError);
    window.removeEventListener("speechend", onNativeSpeechEnd);
    window.removeEventListener("permission-granted", onPermissionGranted);
    window.removeEventListener("permission-denied", onPermissionDenied);
  }
});

let pendingAndroidVoiceMode: "dialogue" | "action" | "scene" | null = null;

function onNativeSpeechStart() {
  // 已在 onAndroidVoiceStart 中设置，这里不需要重复
}

function onNativeSpeechPartial(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (detail) androidVoiceText.value = detail;
}

async function onNativeSpeechResult(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (detail) {
    try {
      // detail 是原生传过来的 WAV base64，传给后端转写接口
      const text = await store.transcribeRuntimeVoice(detail, store.state.currentSessionId);
      // 识别完成立刻清 UI，别等 submit()，不然会卡"识别中"
      voiceListening.value = false;
      voiceTranscribing.value = false;
      resetVoiceHoldState();
      if (!text) {
        store.state.notice = "语音识别未返回文本";
        return;
      }
      const finalText = wrapVoiceText(text, pendingAndroidVoiceMode);
      pendingAndroidVoiceMode = null;
      store.state.sendText = finalText;
      await submit();
    } catch (error: any) {
      voiceListening.value = false;
      voiceTranscribing.value = false;
      resetVoiceHoldState();
      store.state.notice = `语音识别失败: ${error?.message || "未知错误"}`;
    }
  } else {
    voiceListening.value = false;
    voiceTranscribing.value = false;
    resetVoiceHoldState();
  }
}

function onNativeSpeechError(e: Event) {
  const detail = (e as CustomEvent).detail;
  // 对常见错误给友好提示
  const msgMap: Record<string, string> = {
    too_short: "录音时间太短",
    permission: "麦克风权限未授权",
    start_failed: "无法启动录音",
    encode_failed: "音频编码失败",
    network: "网络错误，请重试"
  };
  store.state.notice = msgMap[detail] || `语音识别失败: ${detail}`;
  voiceListening.value = false;
  voiceTranscribing.value = false;
  resetVoiceHoldState();
}

function onNativeSpeechEnd() {
  voiceListening.value = false;
}

function onPermissionGranted() {
  (window as any).Android?.startSpeech();
}

function onPermissionDenied() {
  voiceListening.value = false;
  store.state.notice = "需要麦克风权限才能使用语音输入";
}

// 等待安卓麦克风权限授权完成（系统级权限，非 web 层）
function ensureMicPermission(): Promise<boolean> {
  const android = (window as any).Android;
  if (!android) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let resolved = false;
    const onGrant = () => {
      if (!resolved) {
        resolved = true;
        window.removeEventListener("permission-granted", onGrant);
        window.removeEventListener("permission-denied", onDeny);
        resolve(true);
      }
    };
    const onDeny = () => {
      if (!resolved) {
        resolved = true;
        window.removeEventListener("permission-granted", onGrant);
        window.removeEventListener("permission-denied", onDeny);
        resolve(false);
      }
    };
    window.addEventListener("permission-granted", onGrant);
    window.addEventListener("permission-denied", onDeny);
    android.requestMicPermission();
  });
}

// 安卓语音模式：dialogue(台词/黑色), action(动作/白色), scene(场景/白色)
const androidVoiceMode = ref<"dialogue" | "action" | "scene" | null>(null);
// androidSubmitting 已提前到上方声明，避免 watch 里 TDZ
const androidVoiceStartX = ref(0);
const androidVoiceStartY = ref(0);
const androidVoiceText = ref("");

const androidVoiceBtnText = computed(() => {
  if (voiceTranscribing.value) return "识别中...";
  if (voiceHoldCancelPending.value) return "松开取消";
  if (androidVoiceMode.value === "action") return "动作: (xxx)";
  if (androidVoiceMode.value === "scene") return "场景: [xxx]";
  if (voiceListening.value) return androidVoiceText.value || "松开发送";
  if (androidSubmitting.value || currentRuntimeInputStatus.value === "sending" || sessionRuntimeStageText.value) return androidInputHint.value;
  return "按住说话";
});

const androidVoiceTip = computed(() => {
  if (voiceHoldCancelPending.value) return "松开取消";
  if (androidVoiceMode.value === "action") return "动作模式：(xxx) · 上移取消，侧移输入(台词)";
  if (androidVoiceMode.value === "scene") return "场景模式：[xxx] · 上移取消，侧移输入(台词)";
  return "上移取消，侧移输入(动作、场景)";
});

function onAndroidVoiceStart(e: PointerEvent) {
  if (e.cancelable) e.preventDefault();

  if (voiceTranscribing.value) {
    store.state.notice = "上一段语音还在识别中，请稍候";
    return;
  }
  if (!canPlayerInput.value) {
    store.state.notice = runtimeProgressHint.value || "AI 正在生成，请稍候";
    return;
  }

  (e.target as HTMLElement).setPointerCapture(e.pointerId);

  androidVoiceStartX.value = e.clientX;
  androidVoiceStartY.value = e.clientY;
  androidVoiceMode.value = null;
  androidVoiceText.value = "";
  voiceHoldCancelPending.value = false;
  pendingAndroidVoiceMode = null;
  // 立即进入录音态
  voiceListening.value = true;
  // 统一使用 H5 的 WebAudio API 录音
  startVoiceRecognition();
}

function onAndroidVoiceMove(e: PointerEvent) {
  if (!voiceListening.value) return;
  const deltaX = e.clientX - androidVoiceStartX.value;
  const deltaY = androidVoiceStartY.value - e.clientY;
  const threshold = 60;

  // 上滑取消
  if (deltaY > threshold) {
    voiceHoldCancelPending.value = true;
    androidVoiceMode.value = null;
    return;
  }

  voiceHoldCancelPending.value = false;

  // 右滑 -> 动作模式
  if (deltaX > threshold) {
    androidVoiceMode.value = "action";
  }
  // 左滑 -> 场景模式
  else if (deltaX < -threshold) {
    androidVoiceMode.value = "scene";
  }
  // 中间 -> 台词模式
  else {
    androidVoiceMode.value = null;
  }
}

function onAndroidVoiceEnd(e: PointerEvent) {
  if (!voiceListening.value) return;

  (e.target as HTMLElement).releasePointerCapture(e.pointerId);

  const mode = androidVoiceMode.value;
  const cancelled = voiceHoldCancelPending.value;

  if (cancelled) {
    // 取消录音
    discardNextRecording = true;
    stopVoiceRecognition();
  } else {
    // 停止录音并发送
    pendingAndroidVoiceMode = mode;
    // 调试：显示捕获到的模式
    store.state.notice = `录音结束，模式：${mode || "台词"}`;
    stopVoiceRecordingAndTranscribe();
  }

  voiceHoldCancelPending.value = false;
  androidVoiceMode.value = null;
}

// 修改语音识别结果处理，根据模式包裹文字
function wrapVoiceText(text: string, mode: "dialogue" | "action" | "scene" | null): string {
  if (mode === "action") return `(${text})`;
  if (mode === "scene") return `[${text}]`;
  return text;
}

const autoVoice = ref(readPlayAutoVoicePreference());
const voiceListening = ref(false);
const voiceTranscribing = ref(false);
const voiceHoldActive = ref(false);
const voiceHoldCancelPending = ref(false);
const voiceHoldStartY = ref(0);
const voiceHoldPointerId = ref<number | null>(null);
const settingRoleId = ref("");
const settingModePickerOpen = ref(false);
const eventProgressOpen = ref(true);
const helpOpen = ref(false);
const roleDetailKey = ref("");
const roleDetail = computed<StoryRole | null>(() => {
  if (!roleDetailKey.value) return null;
  return roleCards.value.find((item) => (item.id || `${item.roleType}:${item.name}`) === roleDetailKey.value) || null;
});
const roleParameterRawOpen = ref(false);
const chapterDetailOpen = ref(true);
const enemyStatusOpen = ref(false);
const roleCopyHint = ref("");
const menuOpen = ref(false);
const menuMessage = ref<MessageItem | null>(null);
const menuX = ref(0);
const menuY = ref(0);
const pressTimer = ref<number | null>(null);
const menuVisibleHint = ref("");
const currentLiveMessage = computed(() => {
  // 观看模式 + 单台词观看：currentLive 指向 cursor 那一条，让大图头像 + 单卡片 UI 复用游玩模式
  if (playMode.value === "history") {
    if (isSessionPlaybackMode.value && playbackViewMode.value === "single") {
      return playbackMessages.value[playbackCursor.value] || null;
    }
    return null;
  }
  return displayMessages.value[displayMessages.value.length - 1] || null;
});
const currentLiveFigureRole = computed(() => {
  const message = currentLiveMessage.value;
  if (!message || isRuntimeRetryMessage(message)) return null;
  return messageAvatarRole(message);
});
const currentLiveFigureFgPath = computed(() => roleAvatarForeground(currentLiveFigureRole.value));
const messageViewport = ref<HTMLElement | null>(null);

// WebP 动画控制
const WAIT_DURATION = 3000; // 定格等待时间
let figureAnimTimer: ReturnType<typeof setTimeout> | null = null;
let isAnimatedWebp = false;
function clearFigureAnimTimer() {
  if (figureAnimTimer !== null) {
    clearTimeout(figureAnimTimer);
    figureAnimTimer = null;
  }
}

let speechRecognition: any = null;
let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let mediaChunks: Blob[] = [];
let discardNextRecording = false;
let chapterBgmPlayer: HTMLAudioElement | null = null;
let currentChapterBgmObjectUrl = "";
// 语音播放相关变量已移至 orchestrationVoiceFlow.ts
/** 播放锁已移除：根因是 Watch2 在 voicing 状态时强制改为 waiting_next，
 *  导致语音播放期间就触发下一轮编排，新台词到达后 stopRuntimeVoicePlayback
 *  打断当前语音。修复 Watch2 后不再需要此锁。 */
const revealedMessages = ref<MessageItem[]>([]);

function resetVoiceHoldState() {
  voiceHoldActive.value = false;
  voiceHoldCancelPending.value = false;
  voiceHoldPointerId.value = null;
}

// 用 message.id 拼接，避免 message.content/meta 频繁更新触发 watcher 重启。
// 只关心"哪些消息 ID 出现在列表里"，不关心每条消息内部字段变化。
const liveMessageKeys = computed(() => messages.value.map((m) => String(m.id)).join("|"));
const liveMessageProgressFingerprint = computed(() => messages.value.map((message) => [
  messageUiKey(message),
  messageDisplayContent(message),
  isStreamingRuntimeMessage(message) ? "1" : "0",
  runtimeStreamSentences(message).join("||"),
].join("_")).join("|"));
const playbackMessages = computed(() => messages.value.filter((message) => !isRuntimeRetryMessage(message)));
const latestPendingPlayerMessage = computed(() => {
  const list = conversationMessages();
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (isLocalPendingPlayerMessage(message)) {
      return message;
    }
  }
  return null;
});
const displayMessages = computed(() => {
  if (playMode.value === "history") {
    // 观看模式
    if (isSessionPlaybackMode.value) {
      // 单条模式：只显示 cursor 指向的那一条台词
      if (playbackViewMode.value === "single") {
        const current = playbackMessages.value[playbackCursor.value];
        return current ? [current] : [];
      }
      // 列表模式：显示从 0 到 cursor 的所有台词，让"看到的内容 = 进度条位置"
      const limit = Math.max(0, Math.min(playbackCursor.value + 1, playbackMessages.value.length));
      return playbackMessages.value.slice(0, limit);
    }
    return messages.value;
  }
  const pendingPlayerMessage = latestPendingPlayerMessage.value;
  if (pendingPlayerMessage) {
    return [pendingPlayerMessage];
  }
  return revealedMessages.value.slice(-1);
});
const latestRevealedMessage = computed(() => {
  const list = revealedMessages.value;
  return list.length ? list[list.length - 1] : null;
});
const playStageStyle = computed(() => {
  // 轻微的暗角效果（四个角有淡淡的阴影）
  const vignette = "radial-gradient(circle at center, rgba(10, 21, 36, 0.05) 0%, rgba(10, 21, 36, 0.15) 70%, rgba(10, 21, 36, 0.2) 100%)";

  const layers = [];

  if (chapterBackgroundPath.value) {
    layers.push(`url("${chapterBackgroundPath.value}")`);
  } else {
    // 默认背景也使用轻微渐变
    layers.push("linear-gradient(180deg, rgba(19, 39, 69, 0.9) 0%, rgba(14, 32, 56, 0.95) 100%)");
  }

  // 暗角效果放在最上层
  layers.unshift(vignette);

  return {
    backgroundImage: layers.join(","),
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat"
  };
});
const playTitle = computed(() => currentWorld.value?.name || session.value?.title || store.state.debugSessionTitle || "当前故事");
const playSubtitle = computed(() => {
  const chapterTitle = normalizeChapterTitleLabel(
    currentChapter.value?.title || store.state.debugChapterTitle,
    currentChapter.value?.sort || undefined,
  );
  return store.state.debugMode ? `章节：${chapterTitle}（调试）` : `章节：${chapterTitle}`;
});
const playHandle = computed(() => {
  const role = roleCards.value.find((item) => item.roleType !== "player");
  return `@${role?.name || "故事角色"}`;
});
const playLikeCount = computed(() => Object.values(store.state.messageReactions).filter((item) => item === "like").length);
const statePreviewText = computed(() => {
  if (store.state.debugMode) return store.state.debugStatePreview || "{}";
  const state = session.value?.latestSnapshot?.state || session.value?.state || {};
  try {
    return JSON.stringify(state, null, 2);
  } catch {
    return String(state || "{}");
  }
});
const currentEventProgressText = computed(() => {
  const currentEvent = currentEventDigest.value;
  if (currentEvent && isChapterEventItem(currentEvent)) {
    const summary = scalarText(currentEvent.eventSummary) || "当前事件摘要待生成";
    return `事件 ${Number(currentEvent.eventIndex || 1)} · ${runtimeEventKindLabel(currentEvent.eventKind)} · ${runtimeEventStatusLabel(currentEvent.eventStatus)}：${summary}`;
  }
  const currentOutlineItem = visibleEventItems.value.find((item) => scalarText(item.eventStatus) === "active" || scalarText(item.eventStatus) === "waiting_input")
    || visibleEventItems.value[0]
    || null;
  if (!currentOutlineItem) return "当前章节事件尚未生成";
  return `事件 ${Number(currentOutlineItem.eventIndex || 1)} · ${runtimeEventKindLabel(currentOutlineItem.eventKind)} · ${runtimeEventStatusLabel(currentOutlineItem.eventStatus)}：${scalarText(currentOutlineItem.eventSummary) || "当前事件摘要待生成"}`;
});
const playbackMaxIndex = computed(() => Math.max(0, playbackMessages.value.length - 1));
const playbackCurrentMessage = computed(() => playbackMessages.value[playbackCursor.value] || null);
const playbackProgressLabel = computed(() => {
  if (!playbackMessages.value.length) return "暂无可回放台词";
  return `${playbackCursor.value + 1}/${playbackMessages.value.length} · ${messageTitle(playbackCurrentMessage.value)}`;
});
const playbackCanPlay = computed(() => playbackMessages.value.length > 0 && playbackCursor.value <= playbackMaxIndex.value);
const allowRoleView = computed(() => currentWorld.value?.settings?.allowRoleView !== false);
const canEditCurrentWorld = computed(() => store.canEditWorld(currentWorld.value));
const settingSelectedRole = computed(() => roleCards.value.find((item) => item.id === settingRoleId.value) || roleCards.value[0] || null);

// 玩家行动提示器：动态拉取 3 条第一人称提示。
// 每次点 play-tip-fab 切到 tips 视图，或在 tips 视图下手动刷新时都会拉新的。
const tipOptions = ref<string[]>([]);
const tipsLoading = ref(false);

function defaultTipOptions(): string[] {
  const leadRole = roleCards.value.find((item) => item.roleType === "npc")?.name || currentChapter.value?.openingRole || "旁白";
  const chapterTitle = currentChapter.value?.title || "当前章节";
  return [
    `我想先观察${leadRole}在《${chapterTitle}》中的反应，再决定下一步。`,
    `直接推进当前章节目标，别再绕路。`,
    `你先给我一个稳妥方案，我按方案执行。`,
  ];
}

async function refreshPlayTips() {
  if (tipsLoading.value) return;
  tipsLoading.value = true;
  try {
    const tips = await store.fetchPlayTips();
    tipOptions.value = tips.length ? tips : defaultTipOptions();
  } catch {
    tipOptions.value = defaultTipOptions();
  } finally {
    tipsLoading.value = false;
  }
}
const browserSpeechSupported = computed(() => {
  if (typeof window === "undefined") return false;
  return Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
});
const voiceRecordingStatusText = computed(() => {
  if (voiceTranscribing.value) return "语音识别处理中...";
  if (voiceListening.value || voiceHoldActive.value) {
    return "录音中，再次点击结束并发送";
  }
  return "";
});
const debugLoading = computed(() => store.state.debugLoading);
const debugLoadingStage = computed(() => store.state.debugLoadingStage || "正在初始化调试上下文...");
const debugAutoAdvancing = ref(false);
const runtimeConversationLabel = computed(() => currentRuntimeConversationId());
const runtimeProgressHint = computed(() => {
  if (debugAutoAdvancing.value) {
    return "正在等待编排师继续推进...";
  }
  return playTurnHint.value;
});
// runtimeVoiceMessageKey, runtimeVoicePhase, runtimeVoiceIndicator 已移至 orchestrationVoiceFlow.ts
const runtimeChatTraceRows = ref<RuntimeChatTraceRow[]>([]);
const runtimeDebugPanelOpen = ref(false);
const latestRuntimeChatTrace = computed(() => {
  const rows = runtimeChatTraceRows.value;
  const currentConversationId = runtimeConversationLabel.value;
  if (!currentConversationId) {
    return rows.length ? rows[rows.length - 1] : null;
  }
  const scopedRows = rows.filter((row) => row.conversationId === currentConversationId);
  // 当前会话还没写入 trace 时，不能退回到"所有会话最后一条"，否则会把旧会话角色串进当前 UI。
  return scopedRows.length ? scopedRows[scopedRows.length - 1] : null;
});

const runtimeStateRoot = computed(() => {
  if (store.state.debugMode) return asMiniRecord(store.state.debugRuntimeState);
  return asMiniRecord(session.value?.state || session.value?.latestSnapshot?.state || {});
});

/**
 * 判断消息是否属于固定 opening。
 *
 * 用途：
 * - opening 现在走独立 introduction 流；
 * - 首条 opening 比普通正文更早落地，自动朗读 watcher 偶发会错过它；
 * - 这里只挑出 `on_opening` 的非用户消息，给语音兜底逻辑使用。
 */
function isOpeningNarrativeMessage(message: MessageItem | null | undefined): boolean {
  if (!message || message.roleType === "player") return false;
  return String(message.eventType || "").trim().toLowerCase() === "on_opening";
}
const runtimeChapterProgressRecord = computed(() => asMiniRecord(runtimeStateRoot.value.chapterProgress));
const runtimeChapterProgressDebug = computed(() => {
  const progress = runtimeChapterProgressRecord.value;
  const phaseId = scalarText(progress.phaseId);
  const userNodeId = scalarText(progress.userNodeId);
  const outline = asMiniRecord(currentChapter.value?.runtimeOutline);
  const phases = asMiniArray<Record<string, unknown>>(outline.phases);
  const userNodes = asMiniArray<Record<string, unknown>>(outline.userNodes);
  const phase = phases.find((item) => scalarText(item.id) === phaseId) || null;
  const userNode = userNodes.find((item) => scalarText(item.id) === userNodeId) || null;
  const completedEvents = asMiniArray(progress.completedEvents).map((item) => scalarText(item)).filter(Boolean);
  return {
    phaseLabel: scalarText(phase?.label),
    phaseId,
    pendingGoal: scalarText(progress.pendingGoal),
    userNodeLabel: scalarText(userNode?.goal) || scalarText(userNode?.label),
    completedEvents,
  };
});
const runtimeDebugNextRoleLabel = computed(() => {
  if (store.state.sessionOpening) return "加载中";
  if (sessionOpenErrorText.value) return "--";
  const status = currentRuntimeInputStatus.value;
  if (status === "waiting_player" || canPlayerSpeak.value) return "用户";
  // 正式会话的 turnState.expectedRole 在部分链路里会滞后于最新台词。
  // 这里继续展示具体角色名，只会把旧缓存误显示成"下一位纳兰嫣然"。
  return "剧情继续";
});
const runtimeDebugStatusLabel = computed(() => {
  const status = currentRuntimeInputStatus.value || scalarText(latestRuntimeChatTrace.value?.currentStatus);
  if (!status && canPlayerSpeak.value) return "等待用户";
  if (!status) return store.state.sessionOpening ? "进入中" : "等待下一位";
  if (status === "session_error") return "打开失败";
  if (status === "sending") return "处理中";
  if (status === "orchestrated") return "已编排";
  if (status === "waiting_next") return "等待下一位";
  if (status === "waiting_player") return "等待用户";
  if (status === "auto_advancing") return "自动推进中";
  if (status === "revealing") return "展示中";
  if (status === "streaming") return "流式生成中";
  if (status === "generated") return "已生成";
  if (status === "voicing") return "语音中";
  if (status === "error") return "异常";
  return status;
});
const runtimeDebugConversationLabel = computed(() => shortRuntimeConversationId(latestRuntimeChatTrace.value?.conversationId || ""));
function refreshRuntimeChatTrace() {
  runtimeChatTraceRows.value = readRuntimeChatTraceRows();
}

watch(roleCards, (list) => {
  if (!list.length) {
    settingRoleId.value = "";
    roleDetailKey.value = "";
    return;
  }
  if (!list.find((item) => item.id === settingRoleId.value)) {
    settingRoleId.value = list[0].id;
  }
  if (roleDetailKey.value && !list.find((item) => (item.id || `${item.roleType}:${item.name}`) === roleDetailKey.value)) {
    roleDetailKey.value = "";
  }
}, { immediate: true });

watch(
  () => [
    store.state.currentSessionId,
    liveMessageProgressFingerprint.value,
    runtimeVoiceMessageKey.value,
    runtimeVoicePhase.value,
    debugAutoAdvancing.value ? "1" : "0",
    canPlayerSpeak.value ? "1" : "0",
    playSessionStatus.value,
  ].join("|"),
  () => {
    store.syncRuntimeChatTraceNow?.();
    refreshRuntimeChatTrace();
  },
  { immediate: true },
);

watch(
  () => [store.state.currentSessionId, playMode.value, displayMessages.value.length],
  () => {
    nextTick(() => {
      const el = messageViewport.value;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
  },
  { flush: "post" },
);

watch(
  () => store.state.currentSessionId,
  () => {
    playMode.value = isSessionPlaybackMode.value ? "history" : "live";
    inputMode.value = "text";
    settingModePickerOpen.value = false;
    chapterDetailOpen.value = true;
    eventProgressOpen.value = true;
    closeMenu();
    stopVoiceRecognition();
    stopRuntimeVoicePlayback();
    runtimeVoicePreviewCache.clear();
    runtimeVoicePreviewInflight.clear();
    runtimeVoiceBlobCache.clear();
    runtimeVoiceFallbackBindingCache.clear();
    runtimeVoiceWarmCache.clear();
    revealedMessages.value = [];
    debugAutoAdvancing.value = false;
    playbackCursor.value = Math.max(0, store.state.sessionPlaybackStartIndex || 0);
    playbackPlaying.value = false;
    playbackRunId += 1;
  },
  { immediate: true },
);

watch(
  () => [store.state.currentSessionId, isSessionPlaybackMode.value, playbackMessages.value.length],
  () => {
    playbackCursor.value = Math.min(
      Math.max(0, store.state.sessionPlaybackStartIndex || 0),
      Math.max(0, playbackMessages.value.length - 1),
    );
  },
  { immediate: true },
);

watch(
  () => [playMode.value, isSessionPlaybackMode.value, store.state.currentSessionId],
  ([mode, playback]) => {
    if (mode !== "history" || !playback) {
      stopPlaybackSequence();
    }
  },
);

/**
 * 把章节背景音乐的播放状态和当前"有声/静音"开关保持一致。
 * 关闭时暂停但保留播放进度，恢复时从当前位置继续播放。
 */
function syncChapterBgmAudibility() {
  if (!chapterBgmPlayer) return;
  if (!autoVoice.value) {
    chapterBgmPlayer.pause();
    return;
  }
  chapterBgmPlayer.volume = 0.35;
  void chapterBgmPlayer.play().catch(() => {});
}

/**
 * 切换播放页统一声音开关。
 * 这个开关同时控制运行时台词语音和章节背景音乐。
 */
function toggleAutoVoice() {
  autoVoice.value = !autoVoice.value;
}

watch(autoVoice, (enabled) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PLAY_AUTO_VOICE_STORAGE_KEY, enabled ? "1" : "0");
  }
  if (!enabled) {
    stopRuntimeVoicePlayback();
  }
  if (enabled && !chapterBgmPlayer && currentChapterBgmUrl.value) {
    void syncChapterBgmPlayback(currentChapterBgmUrl.value);
    return;
  }
  syncChapterBgmAudibility();
});

watch(
  () => [runtimeVoiceMessageKey.value, runtimeVoicePhase.value],
  ([messageKey, phase]) => {
    clearRuntimeVoiceIndicatorTimer();
    if (!messageKey || !phase) {
      runtimeVoiceIndicator.value = ".";
      return;
    }
    // streaming/generating -> 3 帧，loading/playing -> 2 帧
    const frames = phase === "streaming"
      ? [".", "..", "..."]
      : phase === "playing"
        ? [".", "。", "."]
        : [".", "。"];
    let index = 0;
    runtimeVoiceIndicator.value = frames[index];
    setRuntimeVoiceIndicatorTimer(window.setInterval(() => {
      index = (index + 1) % frames.length;
      runtimeVoiceIndicator.value = frames[index];
    }, 260));
  },
  { immediate: true },
);

watch(
  () => [store.state.currentSessionId, autoVoice.value, playMode.value],
  async () => {
    if (!autoVoice.value || playMode.value === "history" || playMode.value === "tips" || playMode.value === "setting") return;
    const binding = narratorVoiceBinding() || roleVoiceBinding(roleCards.value.find((item) => item.roleType !== "player"));
    if (!binding) return;
    await warmVoiceBinding(binding);
  },
  { immediate: true },
);

watch(
  () => [store.state.currentSessionId, liveMessageProgressFingerprint.value, playMode.value],
  async () => {
    if (playMode.value === "history") {
      console.log("[ScenePlay Watch2] history mode");
      revealedMessages.value = [...messages.value];
      return;
    }
    const nextMessages = [...messages.value];
    if (!nextMessages.length) {
      console.log("[ScenePlay Watch2] messages empty");
      revealedMessages.value = [];
      return;
    }
    if (playMode.value === "live" && store.state.sessionResumeLatestOnOpen) {
      revealedMessages.value = [...nextMessages];
      store.state.sessionResumeLatestOnOpen = false;
      console.log("[voice lifecycle] 继玩进入故事：历史台词已显示", {
        messageCount: nextMessages.length,
        lastRole: nextMessages[nextMessages.length - 1]?.role,
        lastRoleType: nextMessages[nextMessages.length - 1]?.roleType,
      });
      // 找最后一条 非 player 消息，触发语音播放（继玩重听最后一条 NPC/旁白台词）
      const lastNonPlayer = [...nextMessages].reverse().find((m) => m.roleType !== "player");
      if (!lastNonPlayer) {
        console.log("[voice lifecycle] 继玩：最后一条是用户发言，等待自动编排下一轮");
        return;
      }
      console.log("[voice lifecycle] 继玩：对最后一条 NPC/旁白消息触发 reveal 播放语音", {
        messageId: lastNonPlayer.id,
        role: lastNonPlayer.role,
        content: String(lastNonPlayer.content || "").slice(0, 60),
      });
      const resumeKey = messageUiKey(lastNonPlayer);
      const resumeTokenAtStart = revealRunToken;
      const resumeIsCancelled = () => resumeTokenAtStart !== revealRunActive;
      void waitForMessageReveal(resumeKey, resumeIsCancelled, {
        autoVoice: () => autoVoice.value,
        canPlayerSpeak: () => canPlayerSpeak.value,
        latestMessageByKey,
        messageDisplayContent,
        isStreamingRuntimeMessage,
        isRuntimeRetryMessage,
        runtimeStreamSentences,
      });
      return;
    }
    const nextKeys = nextMessages.map((message) => messageUiKey(message));
    const revealedKeys = revealedMessages.value.map((message) => messageUiKey(message));
    const mismatched = nextKeys.length < revealedKeys.length || revealedKeys.some((key, index) => nextKeys[index] !== key);
    if (mismatched) {
      revealedMessages.value = [...nextMessages];
      return;
    }
    if (!revealedKeys.length) return;
    const syncedMessages = [...revealedMessages.value];
    let changed = false;
    for (let index = 0; index < revealedKeys.length; index += 1) {
      const latest = nextMessages[index];
      if (syncedMessages[index] !== latest) {
        syncedMessages[index] = latest;
        changed = true;
      }
    }
    if (changed) {
      revealedMessages.value = syncedMessages;
      await nextTick();
    }
  },
  { flush: "post", immediate: true },
);

// 全局递增 token：仅当 sessionId / playMode / debugLoading 真的变化时才 ++，
// 让 reveal 流程中的 cancel 判定更稳定，避免 message 内容更新触发 watcher 重启误中断。
let revealRunToken = 0;
let revealRunActive = 0; // 当前活跃 reveal 任务的 token
let revealRunGuardSessionId = "";
let revealRunGuardPlayMode = "";
let revealRunGuardDebugLoading = false;

watch(
  () => [store.state.currentSessionId, liveMessageKeys.value, autoVoice.value, playMode.value, debugLoading.value],
  async (_, __, onCleanup) => {
    // 只有真正的"上下文切换"才视为取消：sessionId、playMode、debugLoading 变化
    const sid = store.state.currentSessionId;
    const pm = playMode.value;
    const dl = debugLoading.value;
    const contextChanged = sid !== revealRunGuardSessionId || pm !== revealRunGuardPlayMode || dl !== revealRunGuardDebugLoading;
    if (contextChanged) {
      revealRunToken += 1;
      revealRunGuardSessionId = sid;
      revealRunGuardPlayMode = pm;
      revealRunGuardDebugLoading = dl;
    }
    const myToken = revealRunActive = revealRunToken;
    onCleanup(() => {
      // 仅 token 变化（真实上下文切换）时认为本次 reveal 被取消
    });
    const isCancelled = () => myToken !== revealRunActive;

    if (playMode.value === "history") {
      revealedMessages.value = [...messages.value];
      console.log("[ScenePlay Watch1] history mode, sync all messages");
      return;
    }
    if (playMode.value === "setting" || playMode.value === "tips" || debugLoading.value) {
      console.log("[ScenePlay Watch1] skip: setting/tips/debugLoading");
      return;
    }
    const nextMessages = [...messages.value];
    if (!nextMessages.length) {
      revealedMessages.value = [];
      console.log("[ScenePlay Watch1] messages empty");
      return;
    }
    if (playMode.value === "live" && store.state.sessionResumeLatestOnOpen) {
      // Watch1 是后置触发，Watch2 已经处理过继玩 reveal 逻辑了
      revealedMessages.value = [...nextMessages];
      store.state.sessionResumeLatestOnOpen = false;
      console.log("[ScenePlay Watch1] resumeLatestOnOpen=true, Watch2 already handled");
      return;
    }
    const nextKeys = nextMessages.map((message) => messageUiKey(message));
    const revealedKeys = revealedMessages.value.map((message) => messageUiKey(message));
    const mismatched = nextKeys.length < revealedKeys.length || revealedKeys.some((key, index) => nextKeys[index] !== key);
    if (mismatched) {
      revealedMessages.value = [...nextMessages];
      console.log("[ScenePlay Watch1] mismatched, sync all");
      return;
    }
    const newMessages = nextMessages.slice(revealedKeys.length);
    if (!newMessages.length) {
      console.log("[ScenePlay Watch1] no new messages", {
        revealedCount: revealedKeys.length,
        nextCount: nextKeys.length,
      });
      return;
    }
    WebDebugLogUtil.log("[voice时序] Watch1 检测到新消息", {
      新消息数: newMessages.length,
      新消息角色列表: newMessages.map(m => `${m.role}(${m.id})`),
      myToken,
      revealRunActive,
    });
    console.log("[ScenePlay] new messages detected, will call waitForMessageReveal", {
      count: newMessages.length,
      roles: newMessages.map(m => `${m.role}(${m.id}|${m.roleType})`),
      lastContent: newMessages[newMessages.length - 1]?.content?.slice(0, 60),
    });
    for (const message of newMessages) {
      if (isCancelled()) return;
      if (isRuntimeRetryMessage(message)) {
        continue;
      }
      // 把流式消息也先入框（即便 content 还空），目的是让"生成中"圆点指示器
      // 能立刻挂在新消息尾部。当首个 delta 到达时内容会自然出现。
      const messageKey = messageUiKey(message);
      console.log("[ScenePlay] waitForMessageReveal about to call", {
        messageId: message.id,
        role: message.role,
        roleType: message.roleType,
        content: message.content?.slice(0, 60),
      });
      if (!revealedMessages.value.some((existing) => messageUiKey(existing) === messageKey)) {
        revealedMessages.value = [...revealedMessages.value, latestMessageByKey(messageKey) || message];
        await nextTick();
        const viewport = messageViewport.value;
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      }
      // 播放锁已移除：根因修复在 Watch2 中——voicing 状态不再被强制改为 waiting_next，
      // 确保语音播完后才触发下一轮编排，新台词不会在语音播放期间到达。
      await waitForMessageReveal(messageKey, isCancelled, {
        autoVoice: () => autoVoice.value,
        canPlayerSpeak: () => canPlayerSpeak.value,
        latestMessageByKey,
        messageDisplayContent,
        isStreamingRuntimeMessage,
        isRuntimeRetryMessage,
        runtimeStreamSentences,
      });
    }
  },
  { flush: "post", immediate: true },
);

watch(
  () => [
    store.state.currentSessionId,
    playMode.value,
    store.state.debugMode,
    store.state.debugLoading,
    store.state.debugEndDialog,
    canPlayerSpeak.value,
    latestRevealedMessage.value ? messageUiKey(latestRevealedMessage.value) : "",
    latestRevealedMessage.value ? isStreamingRuntimeMessage(latestRevealedMessage.value) : false,
    // 必须 watch status 才能在 status 从 streaming → waiting_next 切换时触发自动推进
    latestRevealedMessage.value ? runtimeMessageStatus(latestRevealedMessage.value) : "",
    runtimeVoiceMessageKey.value,
    runtimeVoicePhase.value,
  ],
  async () => {
    if (
      playMode.value !== "live"
      || store.state.debugLoading
      || store.state.runtimeProcessingPending
      || store.state.debugEndDialog
    ) {
      return;
    }
    // 正式游玩必须绑定到有效 session；调试模式则必须显式开启 debugMode，防止两条链串线。
    if (store.state.debugMode) {
      if (!store.state.debugChapterId) {
        return;
      }
    } else if (!store.state.currentSessionId) {
      return;
    }
    const latest = latestRevealedMessage.value;
    if (!latest || isRuntimeRetryMessage(latest) || isStreamingRuntimeMessage(latest)) {
      return;
    }
    const sameVoiceTarget = runtimeVoiceMessageKey.value === messageUiKey(latest);
    let status = runtimeMessageStatus(latest);
    // 小游戏模式下，即使 canPlayerSpeak 为 true，也不应该阻止自动推进，
    // 因为战斗中旁白/敌方回合后还需要继续编排下一轮。
    const isMiniGameActive = store.hasActiveMiniGameInCurrentSession();
    const isMiniGameMessage = String(latest.eventType || "").includes("on_mini_game") && String(latest.eventType || "") !== "on_mini_game_finish";
    const miniGameShouldContinue = isMiniGameActive && isMiniGameMessage;
    if (latest.roleType === "player" && (canPlayerSpeak.value || status !== "waiting_next")) {
      return;
    }
    // 语音播放中（voicing）时绝不能强制改为 waiting_next，
    // 否则 Watch2 会在语音还没播完时就触发下一轮编排，
    // 导致新台词到达后 stopRuntimeVoicePlayback 打断当前语音。
    // 注意：runtimeVoicePhase 不为空说明"有消息正在播放/加载语音"——即使在播的不是 latest，
    // 也不能把 latest 直接推进，否则会触发下一轮编排，连锁打断当前播放。
    const anyVoiceActive = !!runtimeVoicePhase.value;
    if (!miniGameShouldContinue && !anyVoiceActive && (canPlayerSpeak.value || !sameVoiceTarget) && ["", "orchestrated", "generated", "revealing"].includes(status)) {
      status = canPlayerSpeak.value ? "waiting_player" : "waiting_next";
      store.setRuntimeMessageStatus(latest.id, status as any);
    }
    if (!debugAutoAdvancing.value && status === "auto_advancing") {
      status = (canPlayerSpeak.value && !miniGameShouldContinue) ? "waiting_player" : "waiting_next";
      store.setRuntimeMessageStatus(latest.id, status as any);
    }
    if (canPlayerSpeak.value && !miniGameShouldContinue) {
      return;
    }
    if (status !== "waiting_next") {
      return;
    }
    // 如果当前还有任何消息处于语音 loading/playing/streaming 阶段，
    // 不要触发下一轮编排——必须等当前语音播完，否则新台词到达会打断当前语音。
    if (runtimeVoicePhase.value) {
      WebDebugLogUtil.log("[voice时序] Watch 检测到 waiting_next，但有语音正在播放，跳过 auto_advancing", {
        消息id: latest.id,
        当前播放消息key: runtimeVoiceMessageKey.value,
        当前播放阶段: runtimeVoicePhase.value,
      });
      return;
    }
    WebDebugLogUtil.log("[voice时序] Watch 检测到 waiting_next，准备 auto_advancing", {
      消息id: latest.id,
      消息角色: latest.role,
      消息内容: messageDisplayContent(latest)?.slice(0, 40),
      canPlayerSpeak: canPlayerSpeak.value,
      isMiniGameActive: store.hasActiveMiniGameInCurrentSession(),
    });
    const key = messageUiKey(latest);
    if (!key || debugAutoAdvancing.value) {
      return;
    }
    debugAutoAdvancing.value = true;
    store.setRuntimeMessageStatus(latest.id, "auto_advancing");
    try {
      const ok = store.state.debugMode
        ? await store.continueDebugNarrative()
        : await store.continueSessionNarrative();
      if (!ok) {
        store.setRuntimeMessageStatus(latest.id, "error");
      }
    } finally {
      debugAutoAdvancing.value = false;
    }
  },
);

watch(
  () => [
    store.state.currentSessionId,
    playMode.value,
    autoVoice.value,
    store.state.debugMode,
    store.state.debugLoading,
    latestRevealedMessage.value ? messageUiKey(latestRevealedMessage.value) : "",
    latestRevealedMessage.value ? runtimeMessageStatus(latestRevealedMessage.value) : "",
    latestRevealedMessage.value ? isStreamingRuntimeMessage(latestRevealedMessage.value) : false,
    latestRevealedMessage.value ? messageDisplayContent(latestRevealedMessage.value) : "",
    runtimeVoiceMessageKey.value,
    runtimeVoicePhase.value,
    canPlayerSpeak.value,
  ],
  async () => {
    if (!autoVoice.value || playMode.value !== "live" || store.state.debugMode || store.state.debugLoading) {
      return;
    }
    const latest = latestRevealedMessage.value;
    if (!latest || !isOpeningNarrativeMessage(latest)) {
      return;
    }
    if (isRuntimeRetryMessage(latest) || isStreamingRuntimeMessage(latest)) {
      return;
    }
    const content = messageDisplayContent(latest).trim();
    if (!content) {
      return;
    }
    const status = runtimeMessageStatus(latest);
    const messageKey = messageUiKey(latest);
    if (!messageKey || status !== "generated") {
      return;
    }
    if (runtimeVoiceMessageKey.value === messageKey || runtimeVoicePhase.value) {
      return;
    }
    // opening 在启动链里偶发会跳过通用的 reveal->voice 流程。
    // 这里补一次只针对 opening 的自动朗读，确保开场白在自动语音开启时一定会播。
    store.setRuntimeMessageStatus(latest.id, "voicing");
    const played = await playMessageAudio(latest, false, true);
    store.setRuntimeMessageStatus(latest.id, canPlayerSpeak.value ? "waiting_player" : "waiting_next");
    if (!played) {
      await sleep(estimateRevealDelayMs(content));
    }
  },
);

watch(
  () => [
    store.state.currentSessionId,
    playMode.value,
    store.state.debugMode,
    canPlayerSpeak.value,
    latestRevealedMessage.value ? messageUiKey(latestRevealedMessage.value) : "",
    latestRevealedMessage.value ? isStreamingRuntimeMessage(latestRevealedMessage.value) : false,
    latestRevealedMessage.value ? runtimeMessageStatus(latestRevealedMessage.value) : "",
    runtimeVoiceMessageKey.value,
    runtimeVoicePhase.value,
  ],
  () => {
    if (playMode.value !== "live") {
      return;
    }
    const latest = latestRevealedMessage.value;
    if (!latest || latest.roleType === "player" || isRuntimeRetryMessage(latest) || isStreamingRuntimeMessage(latest)) {
      return;
    }
    const status = runtimeMessageStatus(latest);
    const sameVoiceTarget = runtimeVoiceMessageKey.value === messageUiKey(latest);
    // 小游戏模式下，旁白/敌方回合的消息不应被 canPlayerSpeak 强制覆盖为 waiting_player
    const isMiniGameActive = store.hasActiveMiniGameInCurrentSession();
    const isMiniGameMessage = String(latest.eventType || "").includes("on_mini_game") && String(latest.eventType || "") !== "on_mini_game_finish";
    const miniGameShouldContinue = isMiniGameActive && isMiniGameMessage;
    // 语音播放中（voicing）时不能强制改为其他状态，防止打断正在播放的语音
    if (!miniGameShouldContinue && (canPlayerSpeak.value || !sameVoiceTarget) && ["", "orchestrated", "generated", "revealing"].includes(status)) {
      store.setRuntimeMessageStatus(latest.id, canPlayerSpeak.value ? "waiting_player" : "waiting_next");
    }
  },
);

watch(playMode, (mode) => {
  if (mode !== "setting") {
    settingModePickerOpen.value = false;
  }
  if (mode === "tips" || mode === "setting") {
    closeMenu();
    stopRuntimeVoicePlayback();
  }
});

function closeMenu() {
  menuOpen.value = false;
  menuMessage.value = null;
  menuVisibleHint.value = "";
}

function openMenu(message: MessageItem, event: MouseEvent | PointerEvent) {
  if (isRuntimeRetryMessage(message) || isStreamingRuntimeMessage(message)) return;
  menuMessage.value = message;
  const stage = document.querySelector<HTMLElement>(".play-stage");
  const bounds = stage?.getBoundingClientRect();
  const menuWidth = 248;
  const menuHeight = 372;
  const gap = 12;
  const minX = bounds ? bounds.left + gap : 12;
  const maxX = bounds ? Math.max(minX, bounds.right - menuWidth - gap) : Math.max(12, window.innerWidth - menuWidth - gap);
  const minY = bounds ? bounds.top + gap : 16;
  const maxY = bounds ? Math.max(minY, bounds.bottom - menuHeight - gap) : Math.max(16, window.innerHeight - menuHeight - gap);
  const preferredX = Math.min(event.clientX, maxX);
  const preferredY = Math.min(event.clientY, maxY);
  menuX.value = Math.max(minX, preferredX);
  menuY.value = Math.max(minY, preferredY);
  menuOpen.value = true;
  menuVisibleHint.value = `${message.role || (message.roleType === "player" ? "用户" : "旁白")}`;
}

function clearPressTimer() {
  if (pressTimer.value !== null) {
    window.clearTimeout(pressTimer.value);
    pressTimer.value = null;
  }
}

function handlePressStart(message: MessageItem, event: PointerEvent) {
  if (isRuntimeRetryMessage(message) || isStreamingRuntimeMessage(message)) return;
  if (event.pointerType === "mouse") return;
  clearPressTimer();
  pressTimer.value = window.setTimeout(() => {
    openMenu(message, event);
  }, 520);
}

function handlePressEnd() {
  clearPressTimer();
}

let pendingDotsTimer: number | null = null;

/**
 * 停止并释放章节背景音乐播放器，避免章节切换后继续串音。
 */
function stopChapterBgmPlayback() {
  if (chapterBgmPlayer) {
    chapterBgmPlayer.pause();
    chapterBgmPlayer.src = "";
    chapterBgmPlayer.load();
    chapterBgmPlayer = null;
  }
  if (currentChapterBgmObjectUrl) {
    URL.revokeObjectURL(currentChapterBgmObjectUrl);
    currentChapterBgmObjectUrl = "";
  }
}

/**
 * 按当前章节更新背景音乐；没有配置时立即停止，有配置时尝试循环播放。
 */
async function syncChapterBgmPlayback(audioUrl: string) {
  stopChapterBgmPlayback();
  if (!audioUrl) return;
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`BGM 下载失败：${response.status}`);
    }
    const blob = await response.blob();
    currentChapterBgmObjectUrl = URL.createObjectURL(blob);
    const player = new Audio(currentChapterBgmObjectUrl);
    player.loop = true;
    player.preload = "auto";
    player.volume = 0.35;
    chapterBgmPlayer = player;
    syncChapterBgmAudibility();
  } catch {
    stopChapterBgmPlayback();
  }
}

onMounted(() => {
  pendingDotsTimer = window.setInterval(() => {
    pendingDotTick.value = (pendingDotTick.value + 1) % 3;
  }, 420);
});

watch(
  currentChapterBgmUrl,
  (audioUrl) => {
    void syncChapterBgmPlayback(audioUrl);
  },
  { immediate: true },
);

async function submit() {
  if (!canPlayerInput.value) {
    store.state.notice = runtimeProgressHint.value || "当前还没轮到用户发言";
    return;
  }
  androidSubmitting.value = true;
  try {
    await store.sendMessage();
    playMode.value = "live";
  } catch {
    androidSubmitting.value = false;
  }
}

async function retryRuntimeMessage() {
  playMode.value = "live";
  await store.retryRuntimeFailure();
}

async function retryContinueSession() {
  playMode.value = "live";
  await store.retryContinueSessionNarrative();
}

async function submitMiniGameAction(text: string) {
  store.state.sendText = text;
  playMode.value = "live";
  androidSubmitting.value = true;
  try {
    await store.sendMessage();
  } finally {
    androidSubmitting.value = false;
  }
}

function like(id: number) {
  store.reactMessage(id, "like");
}

function dislike(id: number) {
  store.reactMessage(id, "dislike");
}

function resetReaction(id: number) {
  store.reactMessage(id, "reset");
}

function copy(text: string) {
  store.copyMessageText(text);
  menuVisibleHint.value = "已复制";
  store.state.notice = "已复制对话内容";
}

function rewrite(content: string) {
  store.state.sendText = `请改写以下内容：\n${content}\n`;
  playMode.value = "live";
  inputMode.value = "text";
  nextTick(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(".play-textarea");
    textarea?.focus();
  });
  menuVisibleHint.value = "已填入改写内容";
}

function canDeleteMenuMessage(message: MessageItem | null | undefined) {
  if (!message || isRuntimeRetryMessage(message) || isStreamingRuntimeMessage(message)) return false;
  if (String(message.roleType || "").trim() !== "player") return false;
  return Number(latestConversationMessage.value?.id || 0) === Number(message.id || 0);
}

function formatConditionText(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") {
    const text = input.trim();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text) as unknown;
      return formatConditionText(parsed) || text;
    } catch {
      return text;
    }
  }
  if (typeof input === "boolean") return input ? "true" : "false";
  if (Array.isArray(input)) return input.map((item) => formatConditionText(item)).filter(Boolean).join(" 且 ");
  if (typeof input === "object") {
    const node = input as Record<string, unknown>;
    const allowedKeys = new Set(["type", "op", "field", "left", "value", "right"]);
    const op = String(node.type ?? node.op ?? "contains").trim().toLowerCase();
    const field = String(node.field ?? node.left ?? "message").trim().toLowerCase();
    const value = String(node.value ?? node.right ?? "").trim();
    if (
      value
      && Object.keys(node).every((key) => allowedKeys.has(key))
      && ["contains", "equals", "eq"].includes(op)
      && ["message", "message.content", "latest", "latest_message"].includes(field)
    ) {
      return value;
    }
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }
  return String(input);
}

// replayWithBrowserSpeech, messageUiKey, latestMessageByKey, sleep, estimatePlaybackTimeoutMs,
// estimateRevealDelayMs, withTimeout, waitForMessageReveal 已移至 orchestrationVoiceFlow.ts
// stopRuntimeVoicePlayback, clearRuntimeVoiceIndicator, setRuntimeVoiceIndicator 也已移至 voiceFlow

// 以下语音编排相关函数已移至 orchestrationVoiceFlow.ts:
// normalizeBindingMixVoices, splitSpeechSegments, createVoiceBindingDraft, runtimeStoryVoiceConfigId,
// inferFallbackPreset, narratorVoiceBinding, roleVoiceBinding, findMessageRole, resolveMessageVoiceBinding,
// resolveFallbackVoiceBinding, shouldDowngradeRuntimeVoiceBinding, runtimeVoiceBindingKey, runtimeVoicePreviewKey,
// ensureRuntimeCloneBinding, resolveRuntimeVoiceUrl, warmVoiceBinding, fetchRuntimeVoiceBlob,
// playRuntimeVoiceBlob, playMessageAudioWithBinding, playMessageAudio

function menuCopy() {
  const message = menuMessage.value;
  if (!message) return;
  copy(messageDisplayContent(message));
  closeMenu();
}

function menuReplay() {
  const message = menuMessage.value;
  if (!message) return;
  void playMessageAudio(message, true, true);
  closeMenu();
}

function menuLike() {
  if (!menuMessage.value) return;
  like(menuMessage.value.id);
  closeMenu();
}

function menuDislike() {
  if (!menuMessage.value) return;
  dislike(menuMessage.value.id);
  closeMenu();
}

function menuReset() {
  if (!menuMessage.value) return;
  resetReaction(menuMessage.value.id);
  closeMenu();
}

function menuRewrite() {
  const message = menuMessage.value;
  if (!message) return;
  const content = messageDisplayContent(message).trim();
  if (!content) {
    store.state.notice = "这条对话没有可改写内容";
    closeMenu();
    return;
  }
  if (String(message.roleType || "").trim() === "player") {
    const applyTextOnly = () => {
      store.state.sendText = content;
      playMode.value = "live";
      inputMode.value = "text";
      nextTick(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(".play-textarea");
        textarea?.focus();
      });
    };
    if (canDeleteMenuMessage(message)) {
      void store.deleteMessage(message).then(() => {
        applyTextOnly();
      }).catch((error) => {
        store.state.notice = `改写失败：${error instanceof Error ? error.message : "未知错误"}`;
      });
    } else {
      applyTextOnly();
      store.state.notice = "已填回原台词，可修改后重新发送";
    }
    closeMenu();
    return;
  }
  rewrite(content);
  closeMenu();
}

function menuDelete() {
  const message = menuMessage.value;
  if (!message || !canDeleteMenuMessage(message)) return;
  const confirmed = window.confirm("确认删除这条用户台词吗？删除后将回到可重新输入状态。");
  if (!confirmed) return;
  void store.deleteMessage(message).catch((error) => {
    store.state.notice = `删除失败：${error instanceof Error ? error.message : "未知错误"}`;
  });
  closeMenu();
}

function menuRevisit() {
  const message = menuMessage.value;
  if (!message) return;
  const action = store.state.debugMode
    ? store.revisitDebugMessage(Number(message.id || 0))
    : store.revisitSessionMessage(Number(message.id || 0));
  void action.catch((error) => {
    store.state.notice = `回溯失败：${error instanceof Error ? error.message : "未知错误"}`;
  });
  closeMenu();
}

function roleTypeLabel(role: StoryRole): string {
  if (role.roleType === "player") return "用户";
  if (role.roleType === "narrator") return "旁白";
  return "NPC";
}

function voiceModeLabel(mode?: string | null): string {
  if (!mode || mode === "text") return "预设音色";
  if (mode === "clone") return "克隆音色";
  if (mode === "mix") return "混合音色";
  if (mode === "prompt_voice") return "提示词音色";
  return mode;
}

function parameterCardEntries(card: RoleParameterCard | null | undefined) {
  if (!card) return [];
  const fallback = "未设定";
  const stringifyList = (items?: string[]) => items?.length ? items.join("、") : fallback;
  const stringifyExecutingTask = () => {
    const task = card.executing_task;
    if (!task) return fallback;
    return scalarText(task.summary)
      || [
        scalarText(task.title),
        scalarText(task.objective) ? `目标：${scalarText(task.objective)}` : "",
        scalarText(task.status) ? `状态：${scalarText(task.status)}` : "",
      ].filter(Boolean).join("｜")
      || fallback;
  };
  const stringifyOther = () => {
    try {
      return JSON.stringify(card.other ?? [], null, 2);
    } catch {
      return "[]";
    }
  };
  return [
    { label: "角色名", value: scalarText(card.name) || fallback },
    { label: "性别", value: scalarText(card.gender) || fallback },
    { label: "年龄", value: card.age != null ? String(card.age) : fallback },
    { label: "等级", value: card.level != null ? String(card.level) : fallback },
    { label: "经验值", value: card.exp != null ? String(card.exp) : fallback },
    { label: "下一级所需经验", value: card.next_level_exp != null ? String(card.next_level_exp) : fallback },
    { label: "等级称号", value: scalarText(card.level_desc) || fallback },
    { label: "性格", value: scalarText(card.personality) || fallback },
    { label: "外貌", value: scalarText(card.appearance) || fallback },
    { label: "音色特点", value: scalarText(card.voice) || fallback },
    { label: "技能", value: stringifyList(card.skills) },
    { label: "物品", value: stringifyList(card.items) },
    { label: "装备", value: stringifyList(card.equipment) },
    { label: "血量", value: card.hp != null ? String(card.hp) : fallback },
    { label: "蓝量", value: card.mp != null ? String(card.mp) : fallback },
    { label: "金钱", value: card.money != null ? String(card.money) : fallback },
    { label: "正在执行的任务", value: stringifyExecutingTask() },
    { label: "其他", value: stringifyOther() },
  ];
}

function parameterCardRawSetting(card: RoleParameterCard | null | undefined) {
  if (!card) return "未设定";
  return scalarText(card.raw_setting) || "未设定";
}

function roleAvatarForeground(role?: StoryRole | null): string {
  return store.resolveMediaPath(role?.avatarPath || "");
}

function roleAvatarBackground(role?: StoryRole | null): string {
  return store.resolveMediaPath(role?.avatarBgPath || "");
}

function messageAvatarRole(message: MessageItem): StoryRole | null {
  if (isRuntimeRetryMessage(message)) return null;
  if (message.roleType === "player") {
    return roleCards.value.find((item) => item.roleType === "player") || currentWorld.value?.playerRole || null;
  }
  return roleCards.value.find((item) => item.name === message.role || item.id === message.role) || null;
}

function messageAvatarPath(message: MessageItem): string {
  return roleAvatarForeground(messageAvatarRole(message));
}

function messageAvatarBgPath(message: MessageItem): string {
  return roleAvatarBackground(messageAvatarRole(message));
}

function messageTitle(message: MessageItem): string {
  return message.role || (message.roleType === "player" ? "用户" : "旁白");
}

function messageReactionText(message: MessageItem): string {
  const reaction = store.state.messageReactions[String(message.id)];
  if (reaction === "like") return "已点赞";
  if (reaction === "dislike") return "已点踩";
  return "";
}

function openRoleDetail(role: StoryRole) {
  roleDetailKey.value = role.id || `${role.roleType}:${role.name}`;
  roleParameterRawOpen.value = false;
  roleCopyHint.value = "";
}

function closeRoleDetail() {
  roleDetailKey.value = "";
  roleParameterRawOpen.value = false;
  roleCopyHint.value = "";
}

async function editCurrentWorld() {
  if (!currentWorld.value) return;
  await store.openWorldForEdit(currentWorld.value);
}

function buildRoleProfile(role: StoryRole): string {
  const parts = [
    `角色：${role.name || "未命名"}`,
    `类型：${roleTypeLabel(role)}`,
    `音色：${voiceModeLabel(role.voiceMode)}${role.voice ? ` / ${role.voice}` : ""}`,
    `设定：${role.description || "暂无"}`,
    `台词示例：${role.sample || "暂无"}`,
  ];
  if (role.parameterCardJson) {
    parts.push(`参数卡：${JSON.stringify(role.parameterCardJson, null, 2)}`);
  }
  return parts.join("\n");
}

function copyRoleProfile() {
  if (!roleDetail.value) return;
  store.copyMessageText(buildRoleProfile(roleDetail.value));
  roleCopyHint.value = "已复制角色资料";
}

function toggleChapterDetail() {
  chapterDetailOpen.value = !chapterDetailOpen.value;
}

function toggleEventProgress() {
  eventProgressOpen.value = !eventProgressOpen.value;
}

function toggleHelp() {
  helpOpen.value = !helpOpen.value;
}

// Markdown 原文
const helpMdContent = ref(`
# 🌟 主要功能
多角色 ai 游戏

## 特殊功能
- 在输入框输入“#小游戏” 可以进行查看钓鱼等小游戏的玩法。

- 在输入框输入“@记忆管理 xxx” 可以要求ai 变更人物参数
如：@记忆管理 睡觉恢复，可以恢复hp mp

- 战斗属性
### 血量和蓝的恢复（hp 和mp）：
\`\`\`
用户住宿、睡觉和吃下恢复药物等可以恢复血量和蓝到充盈满血满蓝，
要把用户参数进行修改到满血满蓝，hp 和 mp 必须直接输出数字，不能写“已恢复”“满了”“充盈”等中文状态

### 满血：基础血量100 + 等级*10 + 特殊物品或者技能加成，如物品里的血量属性点(2)
### 满蓝：基础蓝量100 + 等级*10 + 特殊物品或者技能加成，如物品里的蓝量属性点(2)
### 攻击力：基础攻击力10 + 等级*10 + 特殊物品或者技能加成，如物品里的攻击点属性点(2)
### 防御力：基础防御1 + 等级*10 + 特殊物品或者技能加成，如物品里的防御点属性点(2)
\`\`\`

- @记忆管理 下个章节
理论上可行
- @事件进度检测 下个事件
理论上可行

- @角色名 xxx
可以呼叫这个角色

### 任务系统（也是小游戏的一种）
输入：“#任务：xxx” 创建任务
也可以被意图分析师 识别为创建任务意图时拆创建任务。
输入：“#退出” 主动退出任务
`);

function closeDebugDialog() {
  store.state.debugEndDialog = null;
  store.state.debugEndDialogDetail = "";
}

function closeSessionEndDialog() {
  store.state.sessionEndDialog = null;
  store.state.sessionEndDialogDetail = "";
}

function exitDebugMode() {
  stopVoiceRecognition();
  store.state.debugEndDialog = null;
  store.state.debugEndDialogDetail = "";
  store.state.debugMode = false;
  store.setTab("create");
}

function toggleHistoryMode() {
  if (isSessionPlaybackMode.value && playMode.value === "history") {
    stopPlaybackSequence();
    stopRuntimeVoicePlayback();
    store.state.sessionViewMode = "live";
    store.state.sessionPlaybackStartIndex = 0;
    playMode.value = "live";
    return;
  }
  playMode.value = playMode.value === "history" ? "live" : "history";
}

function toggleTipsMode() {
  if (playMode.value !== "tips") {
    // 切到 tips 模式时立刻拉新一批提示
    void refreshPlayTips();
    playMode.value = "tips";
  } else {
    playMode.value = "live";
  }
}

function stopPlaybackSequence() {
  playbackPlaying.value = false;
  playbackRunId += 1;
  stopRuntimeVoicePlayback();
}

function openChapterObjective() {
  chapterDetailOpen.value = true;
  eventProgressOpen.value = true;
  playMode.value = "setting";
}

function openSettingMode() {
  playMode.value = playMode.value === "setting" ? "live" : "setting";
}

async function startPlaybackSequence() {
  if (!playbackMessages.value.length) return;
  const runId = playbackRunId + 1;
  playbackRunId = runId;
  playbackPlaying.value = true;
  for (let index = playbackCursor.value; index < playbackMessages.value.length; index += 1) {
    if (runId !== playbackRunId) return;
    playbackCursor.value = index;
    store.state.sessionPlaybackStartIndex = index;
    await nextTick();
    const message = playbackMessages.value[index];
    if (!message) continue;
    // 观看模式下 player / narrator / NPC 都走同一套 playMessageAudio：
    // - 有绑定 → 拉服务端 TTS，await 直到播放结束
    // - 无绑定 / 失败 → 浏览器 SpeechSynthesis 兜底
    // - 静音 (autoVoice=false) → 跳过语音，仅按文本长度停留
    // 任一路径都会等"真实播放结束"或"最小阅读时间"才推进
    const startedAt = Date.now();
    if (autoVoice.value) {
      await playMessageAudio(message, true, true);
      if (runId !== playbackRunId) return;
    }
    // 兜底最小停留：静音模式 / 语音失败时，按文本长度补足"看完字"的时间，
    // 防止字幕一闪而过；正常播放时 elapsed 已超过这个值，不会有额外等待。
    const elapsed = Date.now() - startedAt;
    const speakable = messageDisplayContent(message).trim();
    const minDwellMs = Math.max(1500, Math.min(20000, speakable.length * 200 + 600));
    const remainingMs = minDwellMs - elapsed;
    if (remainingMs > 0) {
      await sleep(remainingMs);
      if (runId !== playbackRunId) return;
    }
    await sleep(120);
  }
  if (runId === playbackRunId) {
    playbackPlaying.value = false;
  }
}

function onPlaybackCursorInput() {
  stopPlaybackSequence();
  store.state.sessionPlaybackStartIndex = playbackCursor.value;
}

function continueFromPlayback() {
  stopPlaybackSequence();
  store.state.sessionViewMode = "live";
  store.state.sessionPlaybackStartIndex = 0;
  playMode.value = "live";
}

function messageVoiceTail(message: MessageItem): string {
  if (!runtimeVoicePhase.value) return "";
  const phaseKey = runtimeVoiceMessageKey.value;
  const uiKey = messageUiKey(message);
  const idKey = String(message.id);
  const idRoleKey = `${message.id}_${message.createTime}_${message.roleType || ""}`;
  // 兼容三种 key 命名：完整 sessionId-key、message.id、id_createTime_roleType
  const matched = phaseKey === uiKey || phaseKey === idKey || phaseKey === idRoleKey;
  if (matched) {
    return runtimeVoiceIndicator.value;
  }
  // 兜底：如果当前消息是最后一条非 player 消息，且 runtimeVoiceMessageKey 不为空，
  // 说明 message id 在 commit 后被替换了（临时 id → 后端 id），
  // 此时把 indicator 挂到这条最新消息上避免视觉断层。
  if (phaseKey && message.roleType !== "player") {
    const lastNonPlayer = [...messages.value].reverse().find((m) => m.roleType !== "player");
    if (lastNonPlayer && messageUiKey(lastNonPlayer) === uiKey) {
      return runtimeVoiceIndicator.value;
    }
  }
  return "";
}

function retryFailedPlayerMessage(message: MessageItem) {
  void store.retryFailedPlayerMessage(Number(message.id || 0)).catch((error) => {
    store.state.notice = `重试发送失败：${error instanceof Error ? error.message : "未知错误"}`;
  });
}

function rewriteFailedPlayerMessage(message: MessageItem) {
  try {
    store.restoreFailedPlayerMessageForRewrite(Number(message.id || 0));
    playMode.value = "live";
    inputMode.value = "text";
    nextTick(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".play-textarea");
      textarea?.focus();
    });
  } catch (error) {
    store.state.notice = `恢复改写失败：${error instanceof Error ? error.message : "未知错误"}`;
  }
}

function toggleInputMode() {
  inputMode.value = inputMode.value === "voice" ? "text" : "voice";
  if (inputMode.value === "text") {
    nextTick(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".play-textarea");
      textarea?.focus();
    });
  } else {
    stopVoiceRecognition();
  }
}

function openHall() {
  stopVoiceRecognition();
  store.setTab("hall");
}

function handleTopBackAction() {
  if (store.state.debugMode) {
    exitDebugMode();
    return;
  }
  openHall();
}

function stopVoiceRecognition() {
  voiceHoldActive.value = false;
  voiceHoldCancelPending.value = false;
  voiceHoldPointerId.value = null;

  // 安卓 App 内：通知原生层直接取消，不返回文字
  if (isAndroidDevice.value && typeof (window as any).Android !== "undefined") {
    (window as any).Android.cancelSpeech();
    voiceListening.value = false;
    voiceTranscribing.value = false;
    return;
  }

  // 网页环境：清空流和实例
  if (speechRecognition) {
    try {
      speechRecognition.stop();
    } catch {
      // noop
    }
    speechRecognition = null;
  }
  if (mediaRecorder) {
    try {
      discardNextRecording = true;
      if (mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    } catch {
      // noop
    }
    mediaRecorder = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  mediaChunks = [];
  voiceListening.value = false;
}

async function transcribeVoiceBlob(blob: Blob) {
  voiceTranscribing.value = true;
  try {
    const audioBase64 = await fileToDataUrl(blob);
    const text = await store.transcribeRuntimeVoice(audioBase64, store.state.currentSessionId);
    if (!text) {
      store.state.notice = "语音识别未返回文本";
      return;
    }
    // 安卓模式下根据模式包裹文字
    const finalText = isAndroidDevice.value && pendingAndroidVoiceMode
      ? wrapVoiceText(text, pendingAndroidVoiceMode)
      : text;
    pendingAndroidVoiceMode = null;
    store.state.sendText = finalText;
    await submit();
  } catch (error: any) {
    store.state.notice = `语音识别失败: ${error?.message || "未知错误"}`;
  } finally {
    voiceTranscribing.value = false;
  }
}

function stopVoiceRecordingAndTranscribe() {
  // 安卓 App 内：通知原生层停止录音，原生会通过 onNativeSpeechResult 把文字传回来
  if (isAndroidDevice.value && typeof (window as any).Android !== "undefined") {
    // 先立刻清 UI 状态，别等原生回调，防止卡住
    voiceListening.value = false;
    voiceTranscribing.value = true;
    (window as any).Android.stopSpeech();
    return;
  }
  // 网页环境
  const recorder = mediaRecorder;
  if (!recorder) return;
  try {
    recorder.stop();
  } catch (error: any) {
    voiceListening.value = false;
    store.state.notice = `结束录音失败: ${error?.message || "未知错误"}`;
  }
}

/**
 * 安卓浏览器的http 的权限可能有所限制
 * chrome-138.0.7204.179.apk
 * https://files06.tchspt.com/down/chrome-138.0.7204.179.apk
 * adb install -r chrome-138.0.7204.179.apk
 *
 * chrome://flags/#unsafely-treat-insecure-origin-as-secure
 * Insecure origins treated as secure（高亮标黄的选项）
 * 填入：http://{ip}:{port}
 * 如：http://10.10.3.183:5173
 * unsafely-treat-insecure-origin-as-secure:已启用
 *
 */
async function startVoiceRecognition() {
  // 安卓 App 内：彻底走原生录音，绝不碰 H5 的 getUserMedia，避免抢麦冲突
  if (isAndroidDevice.value && typeof (window as any).Android !== "undefined") {
    const ok = await ensureMicPermission();
    if (!ok) {
      voiceListening.value = false;
      resetVoiceHoldState();
      store.state.notice = "需要麦克风权限才能录音";
    }
    // 原生已接管麦克风硬件，直接 return，绝不往下走 H5 录音！
    return;
  }

  if (!browserSpeechSupported.value) {
    if (!isAndroidDevice.value) {
      inputMode.value = "text";
      store.state.notice = "当前浏览器暂不支持语音输入，已切换文字输入";
      nextTick(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(".play-textarea");
        textarea?.focus();
      });
    } else {
      store.state.notice = "语音功能需要 App 环境，请在 Toonflow App 内使用";
    }
    return;
  }
  try {
     console.log("getUserMedia ing");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
     console.log("getUserMedia ed");
    mediaStream = stream;
    mediaChunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorder = recorder;
    // 立即进入录音态，避免 onstart 延迟时看起来像"没有按住效果"。
    voiceListening.value = true;
    recorder.onstart = () => {
       console.log("recorder.onstart ");
      voiceListening.value = true;
    };
    recorder.ondataavailable = (event) => {
      console.log(" recorder.ondataavailable ");
      if (event.data && event.data.size > 0) {
        mediaChunks.push(event.data);
      }
    };
    recorder.onerror = () => {
       console.log(" recorder.onerror ");
      voiceListening.value = false;
      store.state.notice = "语音识别失败";
    };
    recorder.onstop = async () => {
       console.log(" recorder.onstop ");
      const chunks = mediaChunks.slice();
      mediaChunks = [];
      voiceListening.value = false;
      mediaRecorder = null;
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }
      if (discardNextRecording) {
        discardNextRecording = false;
        return;
      }
      if (!chunks.length) {
        store.state.notice = "录音内容为空";
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      await transcribeVoiceBlob(blob);
    };
    console.log("recorder.start ing ");
    recorder.start();
    console.log("recorder.start ed ");
  } catch (error: any) {
    console.log("startVoiceRecognition");
    console.log(error);
    voiceListening.value = false;
    resetVoiceHoldState();
    // 安卓设备模式下不切换到文字模式
    if (!isAndroidDevice.value) {
      inputMode.value = "text";
    }
    store.state.notice = `无法开始录音: ${error?.message || "未知错误"}`;
  }
}

function handleVoicePrimary() {
  if (!canPlayerInput.value) {
    store.state.notice = runtimeProgressHint.value || "当前还没轮到用户发言";
    return;
  }
  if (voiceTranscribing.value) return;
  if (voiceListening.value) {
    stopVoiceRecordingAndTranscribe();
    return;
  }
  startVoiceRecognition();
}

// 移动端语音输入面板事件处理
async function onMobileVoiceSend(text: string, mode: "dialogue" | "action") {
  if (!canPlayerInput.value) {
    store.state.notice = runtimeProgressHint.value || "当前还没轮到用户发言";
    return;
  }
  store.state.sendText = text;
  await submit();
}

function onMobileVoiceStart() {
  // 如果不是原生语音，使用 Web 录音
  if (!hasNativeVoice.value && browserSpeechSupported.value) {
    startVoiceRecognition();
  }
}

function onMobileVoiceCancel() {
  stopVoiceRecognition();
}

function onMobileVoiceModeChange(mode: "dialogue" | "action") {
  mobileVoiceMode.value = mode;
}

function beginVoiceHoldInteraction(target: EventTarget | null, startY: number, pointerId: number | null) {
  if (!canPlayerInput.value) {
    store.state.notice = runtimeProgressHint.value || "当前还没轮到用户发言";
    return;
  }
  if (voiceTranscribing.value || voiceListening.value || voiceHoldActive.value) {
    return;
  }
  voiceHoldActive.value = true;
  voiceHoldCancelPending.value = false;
  voiceHoldStartY.value = startY;
  voiceHoldPointerId.value = pointerId;
  if (target instanceof HTMLElement && pointerId != null) {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // noop
    }
  }
  void startVoiceRecognition().catch(() => {
    voiceListening.value = false;
    resetVoiceHoldState();
  });
}

function updateVoiceHoldInteraction(currentY: number) {
  if (!voiceHoldActive.value) return;
  voiceHoldCancelPending.value = voiceHoldStartY.value - currentY > 72;
}

function finishVoiceHoldInteraction(target: EventTarget | null, pointerId: number | null, cancel = false) {
  if (!voiceHoldActive.value) return;
  if (target instanceof HTMLElement && voiceHoldPointerId.value != null && pointerId != null) {
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      // noop
    }
  }
  const shouldCancel = cancel || voiceHoldCancelPending.value;
  resetVoiceHoldState();
  if (!voiceListening.value) return;
  if (shouldCancel) {
    stopVoiceRecognition();
    return;
  }
  stopVoiceRecordingAndTranscribe();
}

function handleVoiceHoldStart(event: PointerEvent) {
  beginVoiceHoldInteraction(event.currentTarget, event.clientY, event.pointerId);
}

function handleVoiceHoldMove(event: PointerEvent) {
  if (!voiceHoldActive.value || voiceHoldPointerId.value !== event.pointerId) return;
  updateVoiceHoldInteraction(event.clientY);
}

function handleVoiceHoldEnd(event: PointerEvent) {
  finishVoiceHoldInteraction(event.currentTarget, event.pointerId, false);
}

function handleVoiceHoldCancel(event: PointerEvent) {
  finishVoiceHoldInteraction(event.currentTarget, event.pointerId, true);
}

function handleVoiceMouseDown(event: MouseEvent) {
  if (typeof window !== "undefined" && "PointerEvent" in window) return;
  if (event.button !== 0) return;
  beginVoiceHoldInteraction(event.currentTarget, event.clientY, null);
}

function handleVoiceMouseMove(event: MouseEvent) {
  if (typeof window !== "undefined" && "PointerEvent" in window) return;
  if (!voiceHoldActive.value) return;
  updateVoiceHoldInteraction(event.clientY);
}

function handleVoiceMouseUp(event: MouseEvent) {
  if (typeof window !== "undefined" && "PointerEvent" in window) return;
  finishVoiceHoldInteraction(event.currentTarget, null, false);
}

function handleVoiceMouseLeave(event: MouseEvent) {
  if (typeof window !== "undefined" && "PointerEvent" in window) return;
  finishVoiceHoldInteraction(event.currentTarget, null, true);
}

function handleVoiceTouchStart(event: TouchEvent) {
  if (typeof window !== "undefined" && "PointerEvent" in window) return;
  const touch = event.touches[0];
  if (!touch) return;
  beginVoiceHoldInteraction(event.currentTarget, touch.clientY, null);
}

function handleVoiceTouchMove(event: TouchEvent) {
  if (typeof window !== "undefined" && "PointerEvent" in window) return;
  const touch = event.touches[0];
  if (!touch || !voiceHoldActive.value) return;
  updateVoiceHoldInteraction(touch.clientY);
}

function handleVoiceTouchEnd(event: TouchEvent) {
  if (typeof window !== "undefined" && "PointerEvent" in window) return;
  finishVoiceHoldInteraction(event.currentTarget, null, false);
}

function handleVoiceTouchCancel(event: TouchEvent) {
  if (typeof window !== "undefined" && "PointerEvent" in window) return;
  finishVoiceHoldInteraction(event.currentTarget, null, true);
}

function onMiniAction(kind: "share" | "comment") {
  if (kind === "share") {
    store.copyMessageText(`${playTitle.value} ${playSubtitle.value}`.trim());
    store.state.notice = "已复制故事标题";
    return;
  }
  store.state.notice = "评论功能待接入";
}

function toggleFavorite() {
  store.state.notice = "收藏功能待接入";
}

async function retrySessionOpen() {
  try {
    await store.retryOpenCurrentSession();
  } catch (error) {
    store.state.notice = `重试打开会话失败: ${error instanceof Error ? error.message : "未知错误"}`;
  }
}

async function pickTip(option: string) {
  if (!canPlayerInput.value) {
    store.state.notice = runtimeProgressHint.value || "当前还没轮到用户发言";
    return;
  }
  store.state.sendText = option;
  await submit();
}

onBeforeUnmount(() => {
  if (pendingDotsTimer !== null) {
    window.clearInterval(pendingDotsTimer);
    pendingDotsTimer = null;
  }
  clearFigureAnimTimer();
  stopChapterBgmPlayback();
  clearPressTimer();
  stopVoiceRecognition();
  // 退出页面时彻底停掉回放循环 + 当前正在播放的语音 +（最关键）置位 runId
  // 防止 startPlaybackSequence 的 for 循环还在背后跑、继续触发 playMessageAudio 生成语音
  stopPlaybackSequence();
  stopRuntimeVoicePlayback();
  clearRuntimeVoiceIndicator();
});
</script>

<template>
  <section class="play-page">
    <div class="play-stage" :style="playStageStyle">
      <div class="play-stage__mask"></div>
      <div class="play-stage__shade"></div>

      <header class="play-head">
        <div class="play-head__lead">
          <button
            type="button"
            class="play-circle-btn play-circle-btn--back"
            :aria-label="store.state.debugMode ? '返回编辑' : '返回故事大厅'"
            @click="handleTopBackAction"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 18l-6-6 6-6"></path>
            </svg>
          </button>
          <div class="play-head__meta">
            <div class="play-head__eyebrow">{{ playTitle }}</div>
            <div class="play-head__sub">{{ playSubtitle }}</div>
          </div>
        </div>
        <div class="play-head__actions">
          <button type="button" class="play-circle-btn" :aria-label="autoVoice ? '静音' : '开启语音'" @click="toggleAutoVoice">
            <svg v-if="autoVoice" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 10v4h4l5 4V6l-5 4H5z"></path>
              <path d="M18 9a4 4 0 010 6"></path>
              <path d="M20 7a7 7 0 010 10"></path>
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 10v4h4l5 4V6l-5 4H5z"></path>
              <path d="M18 9l-6 6"></path>
              <path d="M12 9l6 6"></path>
            </svg>
          </button>
        </div>
      </header>

      <div class="play-ai-mark">内容由 AI 生成</div>
      <div v-if="playMode === 'history'" class="play-mode-badge">{{ isSessionPlaybackMode ? "剧情回放" : "历史模式" }}</div>
      <div
        v-if="(playMode !== 'history' || (isSessionPlaybackMode && playbackViewMode === 'single')) && currentLiveFigureFgPath"
        class="play-figure-stage"
      >
        <div class="play-figure-stage__glow"></div>
        <div v-if="currentLiveFigureFgPath" class="play-figure play-figure--fg" :key="currentLiveFigureFgPath" :style="{ backgroundImage: `url(${currentLiveFigureFgPath})`, backgroundSize:`auto 100%`}"></div>
        <div class="play-figure-stage__fade"></div>
      </div>
      <div
        ref="messageViewport"
        class="play-thread"
        :class="{
          'play-thread--history': playMode === 'history' && !(isSessionPlaybackMode && playbackViewMode === 'single'),
          'play-thread--single-mode': playMode !== 'history' || (isSessionPlaybackMode && playbackViewMode === 'single'),
        }"
      >
        <div v-if="!displayMessages.length && !playOpenOverlayVisible" class="play-empty">{{ emptySessionHint }}</div>
        <div v-else-if="playMode === 'history' && !(isSessionPlaybackMode && playbackViewMode === 'single')" class="play-thread__history">
          <template v-for="message in displayMessages" :key="message.id">
            <article
              v-if="isRuntimeRetryMessage(message)"
              class="play-runtime-retry play-runtime-retry--history"
            >
              <div class="play-runtime-retry__title">{{ messageTitle(message) }}</div>
              <div class="play-runtime-retry__content">{{ message.content || "模型调用失败" }}</div>
              <button type="button" class="play-runtime-retry__button" @click="retryRuntimeMessage">
                {{ runtimeRetryLabel(message) }}
              </button>
            </article>
            <article
              v-else
              class="play-bubble-item"
              :class="{ 'play-bubble-item--player': message.roleType === 'player' }"
              @dblclick.stop="openMenu(message, $event)"
              @contextmenu.prevent.stop="openMenu(message, $event)"
              @pointerdown="handlePressStart(message, $event)"
              @pointerup="handlePressEnd"
              @pointerleave="handlePressEnd"
              @pointercancel="handlePressEnd"
            >
              <div v-if="message.roleType !== 'player'" class="play-bubble-avatar">
                <LayeredAvatar
                  :foreground-path="messageAvatarPath(message)"
                  :background-path="messageAvatarBgPath(message)"
                  :alt="messageTitle(message)"
                >
                  <span>{{ messageTitle(message).slice(0, 1) }}</span>
                </LayeredAvatar>
              </div>

              <div class="play-bubble-wrap">
                <div class="play-bubble-title">{{ messageTitle(message) }}</div>
                <div class="play-bubble" :class="{ 'play-bubble--player': message.roleType === 'player' }">
                  <template v-if="showRuntimeMessageLoading(message)">
                    <span class="play-message-loading" aria-label="正在生成内容">
                      <span class="play-message-loading__text">{{ runtimeMessageLoadingText(message) }}</span>
                      <span class="play-message-loading__dot"></span>
                      <span class="play-message-loading__dot"></span>
                      <span class="play-message-loading__dot"></span>
                      <button
                        v-if="showRuntimeRetryButton(message)"
                        type="button"
                        class="play-bubble-status__action"
                        @click.stop="retryContinueSession"
                      >
                        重试
                      </button>
                    </span>
                  </template>
                  <span v-else class="play-bubble-content">
                    {{ messageDisplayContent(message) || "（空消息）" }}<span v-if="isMessageTyping(message)" class="typing-cursor"></span>
                  </span>
                  <!-- 尾部圆点指示器：在生成中（streaming）、加载语音（loading）、播放语音（playing）阶段都显示，
                       即使消息还处于 showRuntimeMessageLoading（"获取台词中…"）也要显示 -->
                  <span
                    v-if="messageVoiceTail(message)"
                    class="play-bubble-voice-tail"
                    :class="{
                      'is-playing': runtimeVoicePhase === 'playing',
                      'is-streaming': runtimeVoicePhase === 'streaming',
                      'is-loading': runtimeVoicePhase === 'loading',
                    }"
                  >
                    {{ messageVoiceTail(message) }}
                  </span>
                </div>
                <div v-if="messageReactionText(message)" class="play-bubble-reaction">{{ messageReactionText(message) }}</div>
                <div
                  v-if="playerMessagePendingText(message)"
                  class="play-bubble-status"
                  :class="{ 'is-error': isLocalFailedPlayerMessage(message) }"
                >
                  <span>{{ playerMessagePendingText(message) }}</span>
                  <button
                    v-if="isLocalFailedPlayerMessage(message)"
                    type="button"
                    class="play-bubble-status__action"
                    @click.stop="retryFailedPlayerMessage(message)"
                  >
                    重试
                  </button>
                  <button
                    v-if="isLocalFailedPlayerMessage(message)"
                    type="button"
                    class="play-bubble-status__action"
                    @click.stop="rewriteFailedPlayerMessage(message)"
                  >
                    改写
                  </button>
                </div>
              </div>

              <div v-if="message.roleType === 'player'" class="play-bubble-avatar">
                <LayeredAvatar
                  :foreground-path="messageAvatarPath(message)"
                  :background-path="messageAvatarBgPath(message)"
                  :alt="messageTitle(message)"
                >
                  <span>{{ messageTitle(message).slice(0, 1) }}</span>
                </LayeredAvatar>
              </div>
            </article>
          </template>
        </div>
        <div v-else class="play-thread__single">
          <div class="play-thread__single-stage">
            <div class="play-live-stack">
              <article
                v-if="currentLiveMessage && isRuntimeRetryMessage(currentLiveMessage)"
                class="play-live-card play-live-card--runtime-retry"
              >
                <div class="play-live-card__title">{{ messageTitle(currentLiveMessage) }}</div>
                <div class="play-runtime-retry__content">{{ currentLiveMessage.content || "模型调用失败" }}</div>
                <button type="button" class="play-runtime-retry__button" @click="retryRuntimeMessage">
                  {{ runtimeRetryLabel(currentLiveMessage) }}
                </button>
              </article>
              <article
                v-else-if="currentLiveMessage"
                class="play-live-card"
                :class="{ 'play-live-card--player': currentLiveMessage.roleType === 'player' }"
                @dblclick.stop="openMenu(currentLiveMessage, $event)"
                @contextmenu.prevent.stop="openMenu(currentLiveMessage, $event)"
                @pointerdown="handlePressStart(currentLiveMessage, $event)"
                @pointerup="handlePressEnd"
                @pointerleave="handlePressEnd"
                @pointercancel="handlePressEnd"
              >
                <div class="play-live-card__title">{{ messageTitle(currentLiveMessage) }}</div>
                <div class="play-live-card__body">
                  <template v-if="showRuntimeMessageLoading(currentLiveMessage)">
                    <span class="play-message-loading" aria-label="正在生成内容">
                      <span class="play-message-loading__text">{{ runtimeMessageLoadingText(currentLiveMessage) }}</span>
                      <span class="play-message-loading__dot"></span>
                      <span class="play-message-loading__dot"></span>
                      <span class="play-message-loading__dot"></span>
                      <button
                        v-if="showRuntimeRetryButton(currentLiveMessage)"
                        type="button"
                        class="play-bubble-status__action"
                        @click.stop="retryContinueSession"
                      >
                        重试
                      </button>
                    </span>
                  </template>
                  <span v-else>{{ messageDisplayContent(currentLiveMessage) || "（空消息）" }}</span>
                  <span
                    v-if="messageVoiceTail(currentLiveMessage)"
                    class="play-bubble-voice-tail"
                    :class="{
                      'is-playing': runtimeVoicePhase === 'playing',
                      'is-streaming': runtimeVoicePhase === 'streaming',
                      'is-loading': runtimeVoicePhase === 'loading',
                    }"
                  >
                    {{ messageVoiceTail(currentLiveMessage) }}
                  </span>
                </div>
                <div v-if="messageReactionText(currentLiveMessage)" class="play-bubble-reaction play-bubble-reaction--live">
                  {{ messageReactionText(currentLiveMessage) }}
                </div>
                <div
                  v-if="playerMessagePendingText(currentLiveMessage)"
                  class="play-bubble-status play-bubble-status--live"
                  :class="{ 'is-error': isLocalFailedPlayerMessage(currentLiveMessage) }"
                >
                  <span>{{ playerMessagePendingText(currentLiveMessage) }}</span>
                  <button
                    v-if="isLocalFailedPlayerMessage(currentLiveMessage)"
                    type="button"
                    class="play-bubble-status__action"
                    @click.stop="retryFailedPlayerMessage(currentLiveMessage)"
                  >
                    重试
                  </button>
                  <button
                    v-if="isLocalFailedPlayerMessage(currentLiveMessage)"
                    type="button"
                    class="play-bubble-status__action"
                    @click.stop="rewriteFailedPlayerMessage(currentLiveMessage)"
                  >
                    改写
                  </button>
                </div>
              </article>
              <button
                v-if="playMode !== 'history' && playMode !== 'setting' && playMode !== 'tips'"
                type="button"
                class="play-tip-fab"
                @click="toggleTipsMode"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div v-if="playOpenOverlayVisible" class="play-loading-mask">
          <div class="play-loading-card">
            <div v-if="store.state.sessionOpening" class="play-loading-spinner"></div>
            <div class="play-loading-title">{{ playOpenOverlayTitle }}</div>
            <div class="play-loading-sub">{{ playOpenOverlaySub }}</div>
            <button
              v-if="sessionOpenErrorText"
              type="button"
              class="play-loading-action"
              @click="retrySessionOpen"
            >
              重试打开
            </button>
          </div>
        </div>
        <div v-if="debugLoading" class="play-loading-mask">
          <div class="play-loading-card">
            <div class="play-loading-spinner"></div>
            <div class="play-loading-title">进入调试中</div>
            <div class="play-loading-sub">{{ debugLoadingStage }}</div>
          </div>
        </div>
      </div>

      <section v-if="playMode === 'setting'" class="play-sheet play-sheet--setting">
        <div class="play-sheet__head play-sheet__head--center">
          <div>
            <div class="play-sheet__title">{{ playTitle }}</div>
            <div class="play-sheet__sub">故事简介：{{ currentWorld?.intro || store.state.worldIntro || "暂无简介" }}</div>
          </div>
          <button type="button" class="play-sheet__close" @click="openSettingMode">关闭</button>
        </div>

        <div class="play-sheet__label">角色列表</div>
        <div class="play-role-strip">
          <button
            v-for="role in roleCards"
            :key="role.id"
            type="button"
            class="play-role-pill"
            :class="{ 'play-role-pill--active': settingSelectedRole?.id === role.id }"
            @click="settingRoleId = role.id"
          >
            <div class="play-role-pill__avatar">
              <LayeredAvatar
                :foreground-path="roleAvatarForeground(role)"
                :background-path="roleAvatarBackground(role)"
                :alt="role.name"
              >
                <span>{{ role.name.slice(0, 1) }}</span>
              </LayeredAvatar>
            </div>
            <span class="play-role-pill__name">{{ role.name }}</span>
          </button>
        </div>

        <div v-if="!allowRoleView" class="play-inline-card">
          创作者未开放"他人可查看角色设定"，当前仅展示基础信息。
        </div>
        <div v-else-if="settingSelectedRole" class="play-inline-card">
          <div class="play-inline-card__title">{{ settingSelectedRole.name }}</div>
          <div class="play-inline-card__text">角色类型：{{ roleTypeLabel(settingSelectedRole) }}</div>
          <div class="play-inline-card__text">角色设定：{{ settingSelectedRole.description || "暂无角色设定" }}</div>
          <div class="play-inline-card__text">角色音色：{{ settingSelectedRole.voice || "未绑定音色" }}</div>
          <div v-if="settingSelectedRole.sample" class="play-inline-card__text">台词示例：{{ settingSelectedRole.sample }}</div>
          <button type="button" class="play-link-text" @click="openRoleDetail(settingSelectedRole)">查看角色详情</button>
        </div>

        <button type="button" class="play-link-row" @click="enemyStatusOpen = !enemyStatusOpen">
          <span>敌人状态{{ battleEnemies.length ? `（${battleEnemies.length}）` : "" }}</span>
          <span>{{ enemyStatusOpen ? "收起 >" : ">" }}</span>
        </button>
        <div v-if="enemyStatusOpen" class="play-inline-card">
          <template v-if="battleEnemies.length">
            <div class="play-enemy-list">
              <div
                v-for="enemy in battleEnemies"
                :key="enemy.enemyId"
                class="play-enemy-card"
              >
                <div class="play-enemy-card__head">
                  <div class="play-enemy-card__avatar">
                    <LayeredAvatar
                      :foreground-path="enemy.avatarPath || null"
                      :background-path="enemy.avatarBgPath || null"
                      :alt="enemy.name"
                    >
                      <span>{{ enemy.name.slice(0, 1) || "敌" }}</span>
                    </LayeredAvatar>
                  </div>
                  <div class="play-enemy-card__body">
                    <div class="play-enemy-card__name">
                      <span>{{ enemy.name }}</span>
                      <span class="play-enemy-card__tag">{{ enemy.isRoleEnemy ? "角色敌人" : "临时敌人" }}</span>
                    </div>
                    <div class="play-inline-card__text">简介：{{ enemy.description || "暂无简介" }}</div>
                    <div class="play-enemy-card__meta">等级 {{ enemy.level }} · HP {{ enemy.hp }}/{{ enemy.maxHp }} · MP {{ enemy.mp }}/{{ enemy.maxMp }}</div>
                  </div>
                </div>
                <div class="play-enemy-card__bar">
                  <div class="play-enemy-card__bar-fill" :style="{ width: `${battleGaugePercent(enemy.hp, enemy.maxHp)}%` }"></div>
                </div>
                <div class="play-enemy-card__bar play-enemy-card__bar--mana">
                  <div class="play-enemy-card__bar-fill play-enemy-card__bar-fill--mana" :style="{ width: `${battleGaugePercent(enemy.mp, enemy.maxMp)}%` }"></div>
                </div>
              </div>
            </div>
          </template>
          <div v-else class="play-inline-card__text">当前没有敌人。</div>
        </div>

        <button type="button" class="play-link-row" @click="toggleChapterDetail">
          <span>故事设定</span>
          <span>{{ chapterDetailOpen ? "收起 >" : ">" }}</span>
        </button>
        <div v-if="chapterDetailOpen" class="play-inline-card">
          <div class="play-inline-card__text">故事背景：{{ currentWorld?.settings?.globalBackground || store.state.globalBackground || "暂无世界背景" }}</div>
          <div class="play-inline-card__text">章节：{{ currentChapter?.title || "当前章节" }}</div>
          <div class="play-inline-card__text">开场白：{{ chapterOpeningDisplay }}</div>
          <div class="play-inline-card__text">章节编排：仅供编排师内部使用，游玩时不直接展示。</div>
          <div class="play-inline-card__text">章节进入条件：{{ chapterEntryText || "无" }}</div>
          <div class="play-inline-card__text">章节完成条件：{{ chapterCompletionText }}</div>
          <button type="button" class="play-inline-toggle" @click="toggleStatePreview">
            <span>运行状态快照</span>
            <span>{{ statePreviewExpanded ? "收起 >" : "展开 >" }}</span>
          </button>
          <pre v-if="statePreviewExpanded" class="play-state-pre">{{ statePreviewText }}</pre>
        </div>

        <button type="button" class="play-link-row" @click="toggleHelp">
          <span>help(?)</span>
          <span>{{ helpOpen ? "收起 >" : ">" }}</span>
        </button>
          <!-- 全局注册好的 Markdown 组件 -->
        <MarkdownView
          v-if="helpOpen"
          class="play-inline-card"
          :source="helpMdContent"
        />

        <button type="button" class="play-link-row" @click="toggleEventProgress">
          <span>当前章节事件</span>
          <span>{{ eventProgressOpen ? "收起 >" : ">" }}</span>
        </button>
        <div v-if="eventProgressOpen" class="play-inline-card">
          <div class="play-inline-card__title">当前事件进度</div>
          <div v-if="currentEventTargetText" class="play-inline-card__text">
            当前事件目标：{{ currentEventTargetText }}
          </div>
          <div class="play-inline-card__text">{{ currentEventProgressText }}</div>
          <div v-if="debugOrchestratorRuntimeText" class="play-inline-card__text">
            {{ debugOrchestratorRuntimeText }}
          </div>
          <div v-if="currentEventDigest?.eventFacts?.length" class="play-inline-card__text">
            当前事件事实：{{ currentEventDigest.eventFacts.join(" / ") }}
          </div>
          <div v-if="currentEventDigest?.memorySummary" class="play-inline-card__text">
            事件记忆：{{ currentEventDigest.memorySummary }}
          </div>
          <div v-if="visibleEventItems.length" class="play-event-list">
            <div
              v-for="item in visibleEventItems"
              :key="`${item.eventIndex || 0}_${item.eventKind || 'scene'}`"
              class="play-event-item"
            >
              <div class="play-event-item__head">
                <span class="play-event-item__index">事件 {{ item.eventIndex || 1 }}</span>
                <span class="play-event-item__meta">{{ runtimeEventFlowLabel(item) }} · {{ runtimeEventKindLabel(item.eventKind) }} · {{ runtimeEventStatusLabel(item.eventStatus) }}</span>
              </div>
              <div class="play-event-item__summary">{{ item.eventSummary || "当前事件摘要待生成" }}</div>
              <div v-if="item.eventFacts?.length" class="play-event-item__facts">
                事实：{{ item.eventFacts.join(" / ") }}
              </div>
              <div v-if="item.memorySummary" class="play-event-item__memory">
                记忆：{{ item.memorySummary }}
              </div>
            </div>
          </div>
          <template v-else-if="runtimeEventWindowText">
            <button type="button" class="play-inline-toggle" @click="toggleRuntimeEventWindowPreview">
              <span>原始事件窗口</span>
              <span>{{ runtimeEventWindowExpanded ? "收起 >" : "展开 >" }}</span>
            </button>
            <pre v-if="runtimeEventWindowExpanded" class="play-state-pre">{{ runtimeEventWindowText }}</pre>
          </template>
          <div v-else class="play-inline-card__text">当前章节事件尚未生成。</div>
        </div>

        <button type="button" class="play-link-row" @click="settingModePickerOpen = !settingModePickerOpen">
          <span>对话模式</span>
          <span>基础模式 &gt;</span>
        </button>
        <div v-if="settingModePickerOpen" class="play-inline-card">
          <div class="play-inline-card__title">✓ 基础模式（当前唯一）</div>
          <div class="play-inline-card__text">当前仅支持基础模式，后续可扩展其他对话模式。</div>
        </div>
      </section>

      <section v-if="playMode === 'tips'" class="play-sheet play-sheet--tips">
        <div class="play-sheet__title">
          AI 提示
          <button
            type="button"
            class="play-tip-refresh"
            :disabled="tipsLoading"
            @click="refreshPlayTips"
          >{{ tipsLoading ? "生成中…" : "换一批" }}</button>
        </div>
        <div v-if="tipsLoading && !tipOptions.length" class="play-tip-loading">正在为你生成行动建议...</div>
        <button
          v-for="option in tipOptions"
          :key="option"
          type="button"
          class="play-tip-option"
          :disabled="tipsLoading"
          @click="pickTip(option)"
        >{{ option }}</button>
        <button type="button" class="play-tip-back" @click="toggleTipsMode">返回</button>
      </section>

      <section v-if="activeMiniGame && playMode !== 'setting' && playMode !== 'tips' && !isSessionPlaybackMode" class="play-mini-game-panel">
        <div class="play-mini-game-panel__head">
          <div>
            <div class="play-mini-game-panel__title">{{ activeMiniGame.displayName }}</div>
            <div class="play-mini-game-panel__meta">第 {{ activeMiniGame.round || 1 }} 轮 · {{ activeMiniGame.phase || "进行中" }}</div>
          </div>
          <button type="button" class="play-mini-game-panel__status" @click="miniGamePanelExpanded = !miniGamePanelExpanded">
            {{ miniGamePanelExpanded ? "收起" : "展开" }}
          </button>
        </div>
        <div v-if="miniGameSummaryItems.length" class="play-mini-game-panel__summary">
          <span v-for="(item, idx) in miniGameSummaryItems.slice(0, 2)" :key="item.key" class="play-mini-game-panel__summary-item">
            {{ item.key }}: {{ item.value }}
          </span>
        </div>
        <div v-if="miniGamePanelExpanded && activeMiniGame.ruleSummary" class="play-mini-game-panel__hint">{{ activeMiniGame.ruleSummary }}</div>
        <div v-if="miniGamePanelExpanded && miniGameSummaryItems.length" class="play-mini-game-panel__state">
          <div
            v-for="item in miniGameSummaryItems"
            :key="item.key"
            class="play-mini-game-panel__state-item"
          >
            <span class="play-mini-game-panel__state-key">{{ item.key }}</span>
            <span class="play-mini-game-panel__state-value">{{ item.value }}</span>
          </div>
        </div>
      </section>

      <div class="play-story-footer">
        <div class="play-story-main">
<!--          {{ chapterObjectivePreview }}{{ playMode }}-->

          <button
            v-if="chapterObjectivePreview && playMode !== 'history' && playMode !== 'setting' && playMode !== 'tips'"
            type="button"
            class="play-objective-chip play-story-objective"
            :title="chapterConditionHint"
            @click="openChapterObjective"
          >
            当前目标：{{ chapterObjectivePreview }}
          </button>
          <button type="button" class="play-story-entry" @click="openSettingMode">
            <span class="play-story-entry__label">{{ playTitle }}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6"></path>
            </svg>
          </button>
          <div class="play-story-subline">
            <div class="play-story-sub">{{ playHandle }}</div>
            <button
              v-if="latestRuntimeChatTrace"
              type="button"
              class="play-story-info-btn"
              :aria-label="runtimeDebugPanelOpen ? '隐藏调试状态' : '显示调试状态'"
              @click="runtimeDebugPanelOpen = !runtimeDebugPanelOpen"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8"></circle>
                <path d="M12 10v6"></path>
                <circle cx="12" cy="7.5" r="1"></circle>
              </svg>
            </button>
          </div>
        </div>
        <div v-if="!isSessionPlaybackMode" class="play-story-actions">
          <button type="button" class="play-story-action" @click="toggleFavorite">
            <span class="play-story-action__icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 20s-6.7-4.4-9-8.2C1.3 8.9 2.5 5.5 5.8 4.5c2-.6 4 .1 5.2 1.7 1.2-1.6 3.2-2.3 5.2-1.7 3.3 1 4.5 4.4 2.8 7.3C18.7 15.6 12 20 12 20z"></path>
              </svg>
            </span>
            <span>{{ playLikeCount }}</span>
          </button>
          <button type="button" class="play-story-action" @click="onMiniAction('share')">
            <span class="play-story-action__icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 5h5v5"></path>
                <path d="M10 14L19 5"></path>
                <path d="M19 14v5H5V5h5"></path>
              </svg>
            </span>
            <span>分享</span>
          </button>
          <button type="button" class="play-story-action" @click="onMiniAction('comment')">
            <span class="play-story-action__icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 6h14a2 2 0 012 2v7a2 2 0 01-2 2H9l-4 3v-3H5a2 2 0 01-2-2V8a2 2 0 012-2z"></path>
              </svg>
            </span>
            <span>评论</span>
          </button>
          <button type="button" class="play-story-action" @click="toggleHistoryMode">
            <span class="play-story-action__icon">
              <svg v-if="playMode === 'history'" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 7l-5 5 5 5"></path>
                <path d="M19 12H6"></path>
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8"></circle>
                <path d="M12 8v5l3 2"></path>
              </svg>
            </span>
            <span>{{ playMode === "history" ? "返回" : "历史" }}</span>
          </button>
        </div>
      </div>

      <div
        class="play-input-shell"
        :class="{ 'play-input-shell--text': inputMode === 'text', 'play-input-shell--fallback': canPlayerInput && !canPlayerSpeak }"
      >
        <div v-if="latestRuntimeChatTrace && runtimeDebugPanelOpen" class="play-debug-panel">
          <div class="play-debug-panel__meta">
            <span class="play-debug-badge">会话 {{ runtimeDebugConversationLabel }}</span>
            <span class="play-debug-badge">消息 {{ latestRuntimeChatTrace.messageId || "-" }}</span>
            <span class="play-debug-badge">序号 {{ latestRuntimeChatTrace.lineIndex || "-" }}</span>
            <span class="play-debug-badge">{{ latestRuntimeChatTrace.currentRole || "未知角色" }}</span>
            <span class="play-debug-badge">状态 {{ runtimeDebugStatusLabel }}</span>
            <span class="play-debug-badge">下一位 {{ runtimeDebugNextRoleLabel }}</span>
            <span v-if="runtimeChapterProgressDebug.phaseLabel || runtimeChapterProgressDebug.phaseId" class="play-debug-badge">
              阶段 {{ runtimeChapterProgressDebug.phaseLabel || runtimeChapterProgressDebug.phaseId }}
            </span>
            <span v-if="runtimeChapterProgressDebug.userNodeLabel" class="play-debug-badge">
              用户节点 {{ runtimeChapterProgressDebug.userNodeLabel }}
            </span>
            <span v-if="runtimeChapterProgressDebug.pendingGoal" class="play-debug-badge">
              目标 {{ runtimeChapterProgressDebug.pendingGoal }}
            </span>
            <span v-if="runtimeChapterProgressDebug.completedEvents.length" class="play-debug-badge">
              已完成 {{ runtimeChapterProgressDebug.completedEvents.join(" / ") }}
            </span>
          </div>
        </div>
        <div v-if="playMode === 'history' && isSessionPlaybackMode" class="playback-panel">
          <div class="playback-panel__head">
            <span class="playback-panel__label">剧情回放</span>
            <span class="playback-panel__meta">可直接查看全部历史台词</span>
          </div>
          <div class="playback-panel__slider">
            <input
              v-model.number="playbackCursor"
              type="range"
              :min="0"
              :max="playbackMaxIndex"
              :disabled="!playbackCanPlay"
              @input="onPlaybackCursorInput"
            >
            <div class="playback-panel__progress">{{ playbackProgressLabel }}</div>
          </div>
          <div class="playback-panel__actions">
            <button
              type="button"
              class="playback-panel__btn"
              :disabled="!playbackCanPlay"
              @click="playbackPlaying ? stopPlaybackSequence() : startPlaybackSequence()"
            >
              {{ playbackPlaying ? "暂停" : (playbackCursor > 0 ? "继续播放" : "开始播放") }}
            </button>
            <button
              type="button"
              class="playback-panel__btn"
              @click="playbackViewMode = playbackViewMode === 'single' ? 'list' : 'single'"
            >
              {{ playbackViewMode === "single" ? "列表式观看" : "单台词观看" }}
            </button>
            <button type="button" class="playback-panel__btn playback-panel__btn--primary" @click="continueFromPlayback">
              退出回放·继续聊
            </button>
          </div>
        </div>
        <div v-else-if="runtimeProgressHint" class="play-turn-hint" :class="{ 'play-turn-hint--loading': debugAutoAdvancing }">{{ runtimeProgressHint }}</div>
        <template v-if="playMode === 'history' && isSessionPlaybackMode">
          <!-- 观看模式下回放面板已在上方，这里不再重复展示锁定提示，避免占位 -->
        </template>
        <!-- 安卓设备模式 -->
        <template v-else-if="isAndroidDevice">
          <template v-if="inputMode === 'text'">
            <div class="play-text-bar android-text-bar">
              <textarea
                v-if="canPlayerInput && !androidSubmitting"
                v-model="store.state.sendText"
                class="play-textarea"
                rows="1"
                placeholder="输入一句话继续故事"
                @keydown.enter.prevent="submit"
              ></textarea>
              <div v-else class="play-textarea play-textarea--processing">
                {{ androidInputHint }}
              </div>
              <button type="button" class="play-mini-round play-mini-round--voice" :disabled="!canPlayerInput" @click="inputMode = 'voice'">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5a2.8 2.8 0 0 1 2.8 2.8v4.4a2.8 2.8 0 1 1-5.6 0V7.8A2.8 2.8 0 0 1 12 5z"></path>
                  <path d="M7.8 11.8a4.2 4.2 0 0 0 8.4 0"></path>
                  <path d="M12 16v3"></path>
                  <path d="M9.5 19h5"></path>
                </svg>
              </button>
              <button type="button" class="play-mini-round" @click="onMiniAction('comment')">＋</button>
            </div>
          </template>
          <template v-else>
            <div v-if="voiceListening" class="android-voice-tip">{{ androidVoiceTip }}</div>
            <div class="android-voice-bar">
              <button
                type="button"
                class="android-voice-btn"
                :class="{
                  'is-active': voiceListening && !voiceHoldCancelPending && !androidVoiceMode,
                  'is-action': androidVoiceMode === 'action',
                  'is-scene': androidVoiceMode === 'scene',
                  'is-cancel': voiceHoldCancelPending
                }"
                :disabled="voiceTranscribing || !canPlayerInput || currentRuntimeInputStatus === 'sending' || !!sessionRuntimeStageText"
                @pointerdown.prevent="onAndroidVoiceStart"
                @pointermove="onAndroidVoiceMove"
                @pointerup="onAndroidVoiceEnd"
                @pointercancel="onAndroidVoiceEnd"
                @pointerleave="onAndroidVoiceEnd"
                @contextmenu.prevent
              >
                {{ androidVoiceBtnText }}
              </button>
              <template v-if="!voiceListening">
                <button type="button" class="play-mini-round" @click="inputMode = 'text'">键</button>
                <button type="button" class="play-mini-round" @click="onMiniAction('comment')">＋</button>
              </template>
            </div>
          </template>
        </template>
        <!-- 网页端原有UI -->
        <template v-else-if="inputMode === 'text'">
          <div class="play-text-bar">
            <textarea v-model="store.state.sendText" class="play-textarea" rows="1" :placeholder="playInputPlaceholder" :disabled="!canPlayerInput"></textarea>
            <button
              type="button"
              class="play-mini-round play-mini-round--voice"
              :class="{ 'is-active': voiceListening, 'is-cancel': false }"
              :disabled="voiceTranscribing || (!canPlayerInput && !voiceListening)"
              @click="handleVoicePrimary"
            >
              <svg v-if="!voiceListening" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5a2.8 2.8 0 0 1 2.8 2.8v4.4a2.8 2.8 0 1 1-5.6 0V7.8A2.8 2.8 0 0 1 12 5z"></path>
                <path d="M7.8 11.8a4.2 4.2 0 0 0 8.4 0"></path>
                <path d="M12 16v3"></path>
                <path d="M9.5 19h5"></path>
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <rect x="7.2" y="7.2" width="9.6" height="9.6" rx="2.2"></rect>
              </svg>
            </button>
            <button
              v-if="voiceListening"
              type="button"
              class="play-mini-round play-mini-round--cancel"
              aria-label="取消录音"
              @click="stopVoiceRecognition"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7l10 10"></path>
                <path d="M17 7 7 17"></path>
              </svg>
            </button>
            <button type="button" class="play-mini-round" @click="onMiniAction('comment')">＋</button>
            <button type="button" class="play-send-btn" :class="{ 'is-processing': currentRuntimeInputStatus === 'sending' || !!sessionRuntimeStageText }" :disabled="!canPlayerInput" @click="submit">
              {{ currentRuntimeInputStatus === "sending" || sessionRuntimeStageText ? `处理中${processingDots}` : "发送" }}
            </button>
          </div>
          <div v-if="voiceRecordingStatusText" class="play-voice-status">{{ voiceRecordingStatusText }}</div>
        </template>
        <template v-else>
          <div class="play-voice-bar">
            <button
              type="button"
              class="play-voice-btn"
              :class="{ 'is-active': voiceListening, 'is-cancel': false }"
              :disabled="voiceTranscribing || (!canPlayerInput && !voiceListening)"
              @click="handleVoicePrimary"
            >
              {{ voiceTranscribing ? "识别处理中..." : voiceListening ? "结束并发送" : "点击说话" }}
            </button>
            <button
              v-if="voiceListening"
              type="button"
              class="play-mini-round play-mini-round--cancel"
              aria-label="取消录音"
              @click="stopVoiceRecognition"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7l10 10"></path>
                <path d="M17 7 7 17"></path>
              </svg>
            </button>
            <button type="button" class="play-mini-round" @click="toggleInputMode">键</button>
            <button type="button" class="play-mini-round" @click="onMiniAction('share')">＋</button>
          </div>
          <div v-if="voiceRecordingStatusText" class="play-voice-status">{{ voiceRecordingStatusText }}</div>
        </template>
      </div>
    </div>

    <div v-if="menuOpen" class="message-menu-backdrop" @click.self="closeMenu">
      <div class="message-menu play-message-menu" :style="{ left: `${menuX}px`, top: `${menuY}px` }">
        <div class="message-menu-title">{{ menuMessage?.role || "消息操作" }}</div>
        <div class="tiny" style="margin-bottom:8px; color:#c0cee3;">{{ menuVisibleHint || "请选择操作" }}</div>
        <button class="button block" type="button" @click="menuCopy">复制</button>
        <button class="button block" type="button" @click="menuReplay">重听</button>
        <button
          v-if="menuMessage && (store.canRevisitDebugMessage(menuMessage) || store.canRevisitSessionMessage(menuMessage))"
          class="button block"
          type="button"
          @click="menuRevisit"
        >
          回溯到这句
        </button>
        <button class="button block" type="button" @click="menuLike">点赞</button>
        <button class="button block" type="button" @click="menuDislike">点踩</button>
        <button class="button block" type="button" @click="menuReset">取消评价</button>
        <button v-if="menuMessage && canDeleteMenuMessage(menuMessage)" class="button danger block" type="button" @click="menuDelete">删除</button>
        <button class="button accent block" type="button" @click="menuRewrite">改写</button>
      </div>
    </div>

    <div v-if="store.state.debugEndDialog" class="modal-backdrop play-debug-end-backdrop" @click.self="closeDebugDialog">
      <div class="modal-panel play-debug-end-panel" style="width:min(100%,420px);">
        <div class="modal-header">
          <button class="button small" type="button" @click="closeDebugDialog">继续查看</button>
          <div style="font-weight:900;">章节调试结束</div>
          <span class="tiny">{{ store.state.debugEndDialog === '已失败' ? '章节失败' : store.state.debugEndDialog }}</span>
        </div>
        <div class="modal-body">
          <div class="surface section-block surface-soft">
            <div style="font-weight:900; font-size:18px;">{{ store.state.debugEndDialog === '已失败' ? '章节失败' : store.state.debugEndDialog }}</div>
            <div class="subtle" style="margin-top:8px;">
              {{ store.state.debugEndDialogDetail || (store.state.debugEndDialog === '已完结' ? '已没有下一个章节。可返回编辑继续补章节。' : store.state.debugEndDialog === '进入自由剧情' ? '当前章节已完成。继续查看后将进入自由剧情，编排师会继续推进故事。' : '当前调试已结束。') }}
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="button" type="button" @click="closeDebugDialog">继续查看</button>
          <button class="button primary" type="button" @click="exitDebugMode">返回编辑</button>
        </div>
      </div>
    </div>

    <div
      v-if="store.state.sessionEndDialog && !store.state.debugMode"
      class="modal-backdrop play-debug-end-backdrop"
      @click.self="closeSessionEndDialog"
    >
      <div class="modal-panel play-debug-end-panel" style="width:min(100%,420px);">
        <div class="modal-header">
          <button class="button small" type="button" @click="closeSessionEndDialog">继续查看</button>
          <div style="font-weight:900;">章节失败</div>
          <span class="tiny">{{ store.state.sessionEndDialog }}</span>
        </div>
        <div class="modal-body">
          <div class="surface section-block surface-soft">
            <div style="font-weight:900; font-size:18px;">章节失败</div>
            <div class="subtle" style="margin-top:8px;">
              {{ store.state.sessionEndDialogDetail || "当前章节结束条件失败。可继续查看当前记录，或返回历史重新开始。" }}
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="button" type="button" @click="closeSessionEndDialog">继续查看</button>
          <button class="button primary" type="button" @click="toggleHistoryMode">返回历史</button>
        </div>
      </div>
    </div>

    <div v-if="roleDetail" class="modal-backdrop" @click.self="closeRoleDetail">
      <div class="modal-panel" style="width:min(100%,560px);">
        <div class="modal-header">
          <button class="button small" type="button" @click="closeRoleDetail">关闭</button>
          <div style="font-weight:900;">角色详情</div>
          <span class="tiny">{{ roleDetail ? roleTypeLabel(roleDetail) : "" }}</span>
        </div>
        <div class="modal-body" v-if="roleDetail">
          <div class="detail-card">
            <div class="detail-avatar">
              <LayeredAvatar
                :foreground-path="roleAvatarForeground(roleDetail)"
                :background-path="roleAvatarBackground(roleDetail)"
                :alt="roleDetail.name"
              >
                <span>{{ roleDetail.name?.slice(0, 1) || "角" }}</span>
              </LayeredAvatar>
            </div>
            <div class="detail-meta">
              <div class="row" style="gap:8px; align-items:center;">
                <strong style="font-size:20px;">{{ roleDetail.name }}</strong>
                <span class="chip">{{ roleTypeLabel(roleDetail) }}</span>
              </div>
              <div class="subtle">{{ roleDetail.voice || "未绑定音色" }}</div>
              <div class="tiny" v-if="roleDetail.voiceMode">绑定模式：{{ voiceModeLabel(roleDetail.voiceMode) }}</div>
            </div>
          </div>

          <div class="dialog-stack" style="margin-top:14px;">
            <div class="surface section-block surface-soft">
              <div class="tiny">角色设定</div>
              <div style="white-space:pre-wrap; margin-top:6px;">{{ roleDetail.description || "暂无角色设定" }}</div>
            </div>
            <div class="surface section-block surface-soft">
              <div class="tiny">台词示例</div>
              <div style="white-space:pre-wrap; margin-top:6px;">{{ roleDetail.sample || "暂无台词示例" }}</div>
            </div>
            <div class="surface section-block surface-soft">
              <div class="tiny">参数卡</div>
              <div v-if="roleDetail.parameterCardJson" class="dialog-stack" style="margin-top:8px;">
                <div class="row-between">
                  <div class="tiny">已结构化展开，可切回原文核对</div>
                  <button class="button small" type="button" @click="roleParameterRawOpen = !roleParameterRawOpen">
                    {{ roleParameterRawOpen ? "收起原文" : "查看原文" }}
                  </button>
                </div>
                <div class="param-item param-item--wide">
                  <div class="tiny">原始角色设定</div>
                  <div class="param-value param-value--scroll param-value--raw-setting">{{ parameterCardRawSetting(roleDetail.parameterCardJson) }}</div>
                </div>
                <div class="param-grid">
                  <div
                    v-for="item in parameterCardEntries(roleDetail.parameterCardJson)"
                    :key="item.label"
                    class="param-item"
                  >
                    <div class="tiny">{{ item.label }}</div>
                    <div class="param-value" :class="{ 'param-value--scroll': String(item.value || '').length > 120 }">{{ item.value }}</div>
                  </div>
                </div>
                <pre v-if="roleParameterRawOpen" class="detail-pre">{{ JSON.stringify(roleDetail.parameterCardJson, null, 2) }}</pre>
              </div>
              <pre v-else class="detail-pre">无参数卡</pre>
            </div>
            <div class="surface section-block surface-soft">
              <div class="tiny">音色信息</div>
              <div class="dialog-stack" style="margin-top:6px;">
                <div class="tiny">预设：{{ roleDetail.voicePresetId || "无" }}</div>
                <div class="tiny">参考音频：{{ roleDetail.voiceReferenceAudioName || roleDetail.voiceReferenceAudioPath || "无" }}</div>
                <div class="tiny">参考文本：{{ roleDetail.voiceReferenceText || "无" }}</div>
                <div class="tiny">提示词：{{ roleDetail.voicePromptText || "无" }}</div>
                <div class="tiny">
                  混合音色：
                  {{ roleDetail.voiceMixVoices?.length ? roleDetail.voiceMixVoices.map((item) => `${item.voiceId}(${item.weight.toFixed(1)})`).join("、") : "无" }}
                </div>
              </div>
            </div>
          </div>
          <div v-if="roleCopyHint" class="tiny" style="margin-top:10px;">{{ roleCopyHint }}</div>
        </div>
        <div class="modal-actions">
          <button class="button" type="button" @click="copyRoleProfile">复制角色资料</button>
          <button v-if="canEditCurrentWorld" class="button" type="button" @click="editCurrentWorld">编辑当前故事</button>
          <button class="button primary" type="button" @click="closeRoleDetail">知道了</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.play-enemy-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.play-enemy-card {
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.play-enemy-card__head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.play-enemy-card__avatar {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
}

.play-enemy-card__body {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.play-enemy-card__name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: #f4f7ff;
  font-size: 13px;
  font-weight: 700;
}

.play-enemy-card__tag {
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(147, 197, 253, 0.18);
  color: rgba(223, 233, 255, 0.88);
  font-size: 11px;
  font-weight: 600;
}

.play-enemy-card__meta {
  color: rgba(223, 233, 255, 0.74);
  font-size: 12px;
  line-height: 1.5;
}

.play-enemy-card__bar {
  margin-top: 8px;
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.play-enemy-card__bar--mana {
  margin-top: 6px;
}

.play-enemy-card__bar-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #ff7f6f, #ffb36f);
}

.play-enemy-card__bar-fill--mana {
  background: linear-gradient(90deg, #63b8ff, #7ee0ff);
}

.play-event-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.play-event-item {
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.play-event-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
  font-size: 12px;
  color: rgba(223, 233, 255, 0.78);
}

.play-event-item__index {
  font-weight: 700;
  color: #f4f7ff;
}

.play-event-item__summary {
  font-size: 13px;
  line-height: 1.55;
  color: #f4f7ff;
}

.play-event-item__facts,
.play-event-item__memory {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(223, 233, 255, 0.74);
}

.play-event-item__stages {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: rgba(223, 233, 255, 0.7);
}

.play-event-item__phase-label {
  font-weight: 600;
  color: rgba(223, 233, 255, 0.85);
  margin-right: 4px;
}

.play-event-item__stage-chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
}

.play-event-item__stage-node {
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.play-event-item__stage-node--done {
  color: #4ade80;
}

.play-event-item__stage-node--active {
  color: #facc15;
  font-weight: 600;
}

.play-event-item__stage-node--failed {
  color: #f87171;
}

.play-event-item__stage-arrow {
  color: rgba(223, 233, 255, 0.4);
  font-size: 10px;
}
</style>
