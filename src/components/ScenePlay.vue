<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import LayeredAvatar from "./LayeredAvatar.vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import type { MessageItem, OrchestratorRuntimeMeta, RoleParameterCard, RuntimeEventDigestItem, RuntimeRetryMessageMeta, StoryRole, VoiceBindingDraft, VoiceMixItem } from "../types/toonflow";
import { fileToDataUrl } from "../utils/file";

const store = useToonflowStore();
const RUNTIME_FAST_PREVIEW_FORMAT = "mp3";
const RUNTIME_FAST_PREVIEW_SAMPLE_RATE = 16000;
const RUNTIME_VOICE_CACHE_LIMIT = 60;
const RUNTIME_CHAT_STORAGE_KEY = "toonflow.chat";
const PLAY_AUTO_VOICE_STORAGE_KEY = "toonflow.playAutoVoice";
const messages = computed(() => store.state.messages);
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
  if (activeChapterId && Number(sessionChapter?.id || 0) === activeChapterId) {
    return sessionChapter;
  }
  if (activeChapterId) {
    const matched = store.state.chapters.find((item) => Number(item.id || 0) === activeChapterId);
    if (matched) return matched;
  }
  return sessionChapter;
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

function runtimeStreamSentences(message: MessageItem | null | undefined): string[] {
  if (!message) return [];
  const meta = asMiniRecord(message.meta);
  return asMiniArray(meta.sentences).map((item) => scalarText(item)).filter(Boolean);
}

function messageDisplayContent(message: MessageItem | null | undefined): string {
  if (!message) return "";
  const content = scalarText(message.content);
  if (content) return content;
  return runtimeStreamSentences(message).join("");
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
  return isLocalFailedPlayerMessage(message) ? "发送失败" : "发送中...";
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
        const rawNextRole = scalarText(item.nextRole);
        const rawNextRoleType = scalarText(item.nextRoleType);
        const waitingPlayer = currentStatus === "waiting_player" || rawNextRoleType === "player";
        return {
          conversationId: scalarText(item.conversationId),
          messageId: Number(item.messageId || 0),
          lineIndex: Number(item.lineIndex || 0),
          currentRole: scalarText(item.currentRole),
          currentRoleType: scalarText(item.currentRoleType),
          currentStatus,
          nextRole: waitingPlayer ? "用户" : rawNextRole,
          nextRoleType: waitingPlayer ? "player" : rawNextRoleType,
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

function sanitizeSpeechText(input: unknown): string {
  return String(input || "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/【[^】]*】/g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/《[^》]*》/g, "")
    .replace(/〈[^〉]*〉/g, "")
    .replace(/〔[^〕]*〕/g, "")
    .replace(/(^|\n)[：:，,；;、]+/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizePlayableSpeechText(input: unknown): string {
  const text = sanitizeSpeechText(input).replace(/\r/g, "").trim();
  if (!text) return "";
  const compact = text.replace(/\s+/g, "");
  const meaningful = compact.replace(/[0-9０-９.,!?;:，。！？；：、…·"'“”‘’`~!@#$%^&*()\-_=+\[\]{}<>\\/|]+/g, "");
  return meaningful ? text : "";
}

function speakableUnitCount(input: unknown): number {
  const text = normalizePlayableSpeechText(input);
  if (!text) return 0;
  return text
    .replace(/\s+/g, "")
    .replace(/[0-9０-９.,!?;:，。！？；：、…·"'“”‘’`~!@#$%^&*()\-_=+\[\]{}<>\\/|]+/g, "")
    .length;
}

function isDeterministicRuntimeVoiceError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return [
    "detect audio failed",
    "当前语音设计模型与所选故事语音模型不兼容",
    "请先在设置里配置语音设计模型",
    "当前语音模型不支持该绑定模式",
    "克隆模式需要参考音频",
    "提示词模式需要填写提示词",
    "参考音频无法被阿里云解码",
    "语音模型配置不存在",
    "未返回试听音频",
    "http 400",
  ].some((item) => message.includes(item.toLowerCase()));
}

function setLimitedCacheValue<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > RUNTIME_VOICE_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

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
const chapterCompletionText = computed(() => {
  if (currentChapter.value?.showCompletionCondition === false) return "对用户隐藏";
  return formatConditionText(currentChapter.value?.completionCondition) || store.state.chapterCondition || "无";
});
const chapterObjectiveText = computed(() => {
  if (currentChapter.value?.showCompletionCondition !== false) {
    const chapterObjective = (formatConditionText(currentChapter.value?.completionCondition) || store.state.chapterCondition || "").trim();
    if (chapterObjective) return chapterObjective;
  }
  const currentEventSummary = scalarText(currentEventDigest.value?.eventSummary);
  if (currentEventSummary) return currentEventSummary;
  const nextSummary = eventDigestWindowItems.value.map((item) => scalarText(item.eventSummary)).find(Boolean);
  if (nextSummary) return nextSummary;
  return scalarText(runtimeEventWindowText.value);
});
const chapterObjectivePreview = computed(() => {
  const normalized = chapterObjectiveText.value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 20 ? `${normalized.slice(0, 20)}...` : normalized;
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

  phases.forEach((phase) => {
    const phaseId = scalarText(phase.id);
    const phaseKind = scalarText(phase.kind) || "scene";
    const eventIndex = items.length + 1;
    const eventSummary = scalarText(phase.targetSummary) || scalarText(phase.label) || `事件 ${eventIndex}`;
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
      eventStatus = "completed";
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

  allFixedEvents.forEach((event, index) => {
    const eventId = scalarText(event.id);
    const eventSummary = scalarText(event.label) || `固定事件 ${index + 1}`;
    let eventStatus = "idle";
    if (eventId && completedEvents.has(eventId)) {
      eventStatus = "completed";
    } else if ((currentEventFlowType === "chapter_ending_check" || currentEventKind === "fixed" || currentEventKind === "ending") && index === 0) {
      eventStatus = currentEventStatus || "waiting_input";
    } else if (currentEventKind && currentEventKind !== "opening" && currentEventKind !== "scene" && eventId && completedEvents.size > 0) {
      eventStatus = "completed";
    }
    items.push({
      eventIndex: items.length + 1,
      eventKind: "fixed",
      eventFlowType: "chapter_ending_check",
      eventSummary,
      eventFacts: [],
      eventStatus,
      summarySource: "outline",
      memorySummary: "",
      memoryFacts: [],
      updateTime: 0,
      allowedRoles: [],
      userNodeId: "",
    });
  });

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
  const hpValue = Number(raw.hp);
  const mpValue = Number(raw.mp);
  const moneyValue = Number(raw.money);
  const card: RoleParameterCard = {
    name: scalarText(raw.name),
    raw_setting: scalarText(raw.raw_setting || raw.rawSetting),
    gender: scalarText(raw.gender),
    age: ageValue != null && Number.isFinite(ageValue) ? ageValue : null,
    level: levelValue != null && Number.isFinite(levelValue) ? levelValue : 1,
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
const canPlayerSpeak = computed(() => runtimeTurnState.value.canPlayerSpeak !== false);
const playSessionStatus = computed(() => scalarText(session.value?.status));
const expectedSpeaker = computed(() => scalarText(runtimeTurnState.value.expectedRole) || "当前角色");
const latestConversationMessage = computed(() => {
  const list = conversationMessages();
  return list.length ? list[list.length - 1] : null;
});
const currentRuntimeInputStatus = computed(() => {
  if (store.state.sessionOpening) return "session_opening";
  if (store.state.sessionOpenError) return "session_error";
  if (activeMiniGame.value?.acceptsTextInput) return "waiting_player";
  const latestStatus = runtimeMessageStatus(latestConversationMessage.value);
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
  if (sessionRuntimeStageText.value) return false;
  if (activeMiniGame.value?.acceptsTextInput) return true;
  return canPlayerSpeak.value && currentRuntimeInputStatus.value === "waiting_player";
});
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
  if (activeMiniGame.value?.acceptsTextInput) {
    return activeMiniGame.value.inputHint || "直接输入方案";
  }
  const runtimeStatus = currentRuntimeInputStatus.value;
  const status = sessionStatusKey(playSessionStatus.value);
  if (runtimeStatus === "sending") {
    return "发送中...";
  }
  if (sessionRuntimeStageText.value) return sessionRuntimeStageText.value;
  if (runtimeStatus === "waiting_player" && canPlayerSpeak.value) {
    return inputMode.value === "text" ? "输入一句话继续故事" : "按住说话";
  }
  if (finishedSessionStatuses.has(status)) {
    return "当前章节已完成";
  }
  if (failedSessionStatuses.has(status)) {
    return "当前故事已失败";
  }
  return `当前轮到${expectedSpeaker.value}发言`;
});
const playTurnHint = computed(() => {
  if (store.state.sessionOpening) return sessionOpeningStageText.value;
  if (sessionOpenErrorText.value) return `打开会话失败：${sessionOpenErrorText.value}`;
  if (activeMiniGame.value?.acceptsTextInput) {
    return "小游戏进行中，直接输入方案即可。";
  }
  const runtimeStatus = currentRuntimeInputStatus.value;
  const status = sessionStatusKey(playSessionStatus.value);
  if (runtimeStatus === "sending") {
    return "正在发送中...";
  }
  if (runtimeStatus === "error") {
    return "发送失败，可重试或重新输入。";
  }
  if (sessionRuntimeStageText.value) return sessionRuntimeStageText.value;
  if (finishedSessionStatuses.has(status)) {
    return "当前章节已完成，可刷新或返回历史继续查看。";
  }
  if (failedSessionStatuses.has(status)) {
    return "当前故事已失败，可返回历史重新开始。";
  }
  if (isLocalFailedPlayerMessage(latestConversationMessage.value)) {
    return "发送失败，可重试或重新输入。";
  }
  if (runtimeStatus === "waiting_player" && canPlayerSpeak.value) {
    return "";
  }
  if (runtimeStatus === "voicing") {
    return `正在朗读${expectedSpeaker.value}的发言，稍后继续。`;
  }
  if (runtimeStatus === "streaming" || runtimeStatus === "generated" || runtimeStatus === "revealing" || runtimeStatus === "auto_advancing" || runtimeStatus === "orchestrated") {
    return "正在生成下一句内容...";
  }
  return `当前还没轮到用户发言，等待${runtimeDebugNextRoleLabel.value}继续。`;
});
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
  return Object.entries(publicState)
    .map(([key, value]) => ({
      key,
      value: stringifyMiniStateValue(value),
    }))
    .filter((item) => item.value.trim().length > 0)
    .slice(0, 10);
}

const activeMiniGame = computed(() => {
  const root = asMiniRecord(runtimeState.value.miniGame);
  const sessionState = asMiniRecord(root.session);
  const ui = asMiniRecord(root.ui);
  const status = scalarText(sessionState.status);
  const gameType = scalarText(sessionState.game_type || sessionState.gameType);
  const playerOptions = asMiniArray<Record<string, unknown>>(ui.player_options || sessionState.player_options);
  const uiStateItems = asMiniArray<Record<string, unknown>>(ui.state_items);
  const visibleStatuses = new Set(["preparing", "active", "settling", "suspended"]);
  if (!gameType) return null;
  if (!visibleStatuses.has(status) && !playerOptions.length && !sessionState.pending_exit) return null;
  return {
    gameType,
    displayName: scalarText(asMiniRecord(root.rulebook).displayName) || gameType,
    status,
    phase: miniGamePhaseLabel(gameType, scalarText(sessionState.phase), scalarText(ui.phase_label)),
    round: Number(sessionState.round || 0),
    publicState: asMiniRecord(sessionState.public_state),
    playerOptions,
    ruleSummary: scalarText(ui.rule_summary),
    narration: scalarText(ui.narration),
    pendingExit: Boolean(sessionState.pending_exit),
    stateItems: miniGameStateItems(gameType, asMiniRecord(sessionState.public_state), uiStateItems),
    acceptsTextInput: Boolean(ui.accepts_text_input) || ["research_skill", "alchemy", "upgrade_equipment"].includes(gameType),
    inputHint: scalarText(ui.input_hint),
  };
});
const miniGameSummaryItems = computed(() => {
  if (!activeMiniGame.value) return [];
  return activeMiniGame.value.stateItems || [];
});
const miniGameControlOptions = computed(() => {
  const game = activeMiniGame.value;
  if (!game) return [];
  if (game.gameType === "fishing") {
    if (game.pendingExit) {
      return ["继续钓鱼", "退出钓鱼"];
    }
    return ["退出钓鱼"];
  }
  if (game.status === "suspended") {
    return ["恢复小游戏", "查看状态", "查看规则", "申请退出"];
  }
  if (game.pendingExit) {
    return ["确认退出", "继续", "查看状态"];
  }
  return ["查看状态", "查看规则", "暂停", "申请退出"];
});

const playMode = ref<"live" | "history" | "tips" | "setting">("live");
const playbackCursor = ref(0);
const playbackPlaying = ref(false);
let playbackRunId = 0;
const isSessionPlaybackMode = computed(() => !store.state.debugMode && store.state.sessionViewMode === "playback");
const inputMode = ref<"voice" | "text">("text");
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
const roleDetailKey = ref("");
const roleDetail = computed<StoryRole | null>(() => {
  if (!roleDetailKey.value) return null;
  return roleCards.value.find((item) => (item.id || `${item.roleType}:${item.name}`) === roleDetailKey.value) || null;
});
const roleParameterRawOpen = ref(false);
const chapterDetailOpen = ref(true);
const roleCopyHint = ref("");
const menuOpen = ref(false);
const menuMessage = ref<MessageItem | null>(null);
const menuX = ref(0);
const menuY = ref(0);
const pressTimer = ref<number | null>(null);
const menuVisibleHint = ref("");
const currentLiveMessage = computed(() =>
  playMode.value === "history" ? null : (displayMessages.value[displayMessages.value.length - 1] || null),
);
const currentLiveFigureRole = computed(() => {
  const message = currentLiveMessage.value;
  if (!message || isRuntimeRetryMessage(message)) return null;
  return messageAvatarRole(message);
});
const currentLiveFigureFgPath = computed(() => roleAvatarForeground(currentLiveFigureRole.value));
const messageViewport = ref<HTMLElement | null>(null);
let speechRecognition: any = null;
let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let mediaChunks: Blob[] = [];
let discardNextRecording = false;
let runtimeVoicePlayer: HTMLAudioElement | null = null;
let runtimeVoiceObjectUrl = "";
let runtimeVoiceResolve: ((played: boolean) => void) | null = null;
let runtimeVoiceRequestId = 0;
const runtimeVoicePreviewCache = new Map<string, string>();
const runtimeVoicePreviewInflight = new Map<string, Promise<string>>();
const runtimeVoiceBlobCache = new Map<string, Blob>();
const runtimeVoiceFallbackBindingCache = new Map<string, VoiceBindingDraft>();
const runtimeVoiceWarmCache = new Set<string>();
const revealedMessages = ref<MessageItem[]>([]);

function resetVoiceHoldState() {
  voiceHoldActive.value = false;
  voiceHoldCancelPending.value = false;
  voiceHoldPointerId.value = null;
}

const liveMessageKeys = computed(() => messages.value.map((message) => messageUiKey(message)).join("|"));
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
  const layers = ["linear-gradient(180deg, rgba(10, 21, 36, 0.12), rgba(10, 21, 36, 0.45) 55%, rgba(10, 21, 36, 0.86) 100%)"];
  if (chapterBackgroundPath.value) {
    layers.push(`url("${chapterBackgroundPath.value}")`);
  } else {
    layers.push("linear-gradient(180deg, #132745 0%, #0e2038 100%)");
  }
  return { backgroundImage: layers.join(",") };
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
const tipOptions = computed(() => {
  const leadRole = roleCards.value.find((item) => item.roleType === "npc")?.name || currentChapter.value?.openingRole || "旁白";
  const chapterTitle = currentChapter.value?.title || "当前章节";
  return [
    `我想先观察${leadRole}在《${chapterTitle}》中的反应，再决定下一步。`,
    `直接推进当前章节目标，别再绕路。`,
    `你先给我一个稳妥方案，我按方案执行。`,
  ];
});
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
const runtimeVoiceMessageKey = ref("");
const runtimeVoicePhase = ref<"" | "loading" | "playing">("");
const runtimeVoiceIndicator = ref(".");
let runtimeVoiceIndicatorTimer = 0;
const runtimeChatTraceRows = ref<RuntimeChatTraceRow[]>([]);
const runtimeDebugPanelOpen = ref(false);
const latestRuntimeChatTrace = computed(() => {
  const rows = runtimeChatTraceRows.value;
  const currentConversationId = runtimeConversationLabel.value;
  const scopedRows = currentConversationId
    ? rows.filter((row) => row.conversationId === currentConversationId)
    : rows;
  const source = scopedRows.length ? scopedRows : rows;
  return source.length ? source[source.length - 1] : null;
});
const runtimeStateRoot = computed(() => {
  if (store.state.debugMode) return asMiniRecord(store.state.debugRuntimeState);
  return asMiniRecord(session.value?.state || session.value?.latestSnapshot?.state || {});
});
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
  return scalarText(latestRuntimeChatTrace.value?.nextRole) || expectedSpeaker.value || "当前角色";
});
const runtimeDebugStatusLabel = computed(() => {
  const status = scalarText(latestRuntimeChatTrace.value?.currentStatus) || currentRuntimeInputStatus.value;
  if (!status && canPlayerSpeak.value) return "等待用户";
  if (!status) return store.state.sessionOpening ? "进入中" : "等待下一位";
  if (status === "session_error") return "打开失败";
  if (status === "sending") return "发送中";
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

watch(autoVoice, (enabled) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PLAY_AUTO_VOICE_STORAGE_KEY, enabled ? "1" : "0");
  }
  if (!enabled) {
    stopRuntimeVoicePlayback();
  }
});

watch(
  () => [runtimeVoiceMessageKey.value, runtimeVoicePhase.value],
  ([messageKey, phase]) => {
    if (runtimeVoiceIndicatorTimer) {
      window.clearInterval(runtimeVoiceIndicatorTimer);
      runtimeVoiceIndicatorTimer = 0;
    }
    if (!messageKey || !phase) {
      runtimeVoiceIndicator.value = ".";
      return;
    }
    const frames = phase === "playing" ? [".", "。", "."] : [".", "。"];
    let index = 0;
    runtimeVoiceIndicator.value = frames[index];
    runtimeVoiceIndicatorTimer = window.setInterval(() => {
      index = (index + 1) % frames.length;
      runtimeVoiceIndicator.value = frames[index];
    }, 260);
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
      revealedMessages.value = [...messages.value];
      return;
    }
    const nextMessages = [...messages.value];
    if (!nextMessages.length) {
      revealedMessages.value = [];
      return;
    }
    if (playMode.value === "live" && store.state.sessionResumeLatestOnOpen) {
      revealedMessages.value = [...nextMessages];
      store.state.sessionResumeLatestOnOpen = false;
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

watch(
  () => [store.state.currentSessionId, liveMessageKeys.value, autoVoice.value, playMode.value, debugLoading.value],
  async (_, __, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    if (playMode.value === "history") {
      revealedMessages.value = [...messages.value];
      return;
    }
    if (playMode.value === "setting" || playMode.value === "tips" || debugLoading.value) return;
    const nextMessages = [...messages.value];
    if (!nextMessages.length) {
      revealedMessages.value = [];
      return;
    }
    if (playMode.value === "live" && store.state.sessionResumeLatestOnOpen) {
      revealedMessages.value = [...nextMessages];
      store.state.sessionResumeLatestOnOpen = false;
      return;
    }
    const nextKeys = nextMessages.map((message) => messageUiKey(message));
    const revealedKeys = revealedMessages.value.map((message) => messageUiKey(message));
    const mismatched = nextKeys.length < revealedKeys.length || revealedKeys.some((key, index) => nextKeys[index] !== key);
    if (mismatched) {
      revealedMessages.value = [...nextMessages];
      return;
    }
    const newMessages = nextMessages.slice(revealedKeys.length);
    if (!newMessages.length) return;
    for (const message of newMessages) {
      if (cancelled) return;
      const messageKey = messageUiKey(message);
      revealedMessages.value = [...revealedMessages.value, latestMessageByKey(messageKey) || message];
      await nextTick();
      const viewport = messageViewport.value;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
      if (isRuntimeRetryMessage(message)) {
        continue;
      }
      await waitForMessageReveal(messageKey, () => cancelled);
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
    runtimeVoiceMessageKey.value,
    runtimeVoicePhase.value,
  ],
  async () => {
    if (
      playMode.value !== "live"
      || store.state.debugLoading
      || store.state.debugEndDialog
    ) {
      return;
    }
    const latest = latestRevealedMessage.value;
    if (!latest || isRuntimeRetryMessage(latest) || isStreamingRuntimeMessage(latest)) {
      return;
    }
    const sameVoiceTarget = runtimeVoiceMessageKey.value === messageUiKey(latest);
    let status = runtimeMessageStatus(latest);
    if (latest.roleType === "player" && (canPlayerSpeak.value || status !== "waiting_next")) {
      return;
    }
    if ((canPlayerSpeak.value || !sameVoiceTarget) && ["", "orchestrated", "generated", "revealing", "voicing"].includes(status)) {
      status = canPlayerSpeak.value ? "waiting_player" : "waiting_next";
      store.setRuntimeMessageStatus(latest.id, status as any);
    }
    if (!debugAutoAdvancing.value && status === "auto_advancing") {
      status = canPlayerSpeak.value ? "waiting_player" : "waiting_next";
      store.setRuntimeMessageStatus(latest.id, status as any);
    }
    if (canPlayerSpeak.value) {
      return;
    }
    if (status !== "waiting_next") {
      return;
    }
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
    if ((canPlayerSpeak.value || !sameVoiceTarget) && ["", "orchestrated", "generated", "revealing", "voicing"].includes(status)) {
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

async function submit() {
  if (!canPlayerInput.value) {
    store.state.notice = runtimeProgressHint.value || "当前还没轮到用户发言";
    return;
  }
  await store.sendMessage();
  playMode.value = "live";
}

async function retryRuntimeMessage() {
  playMode.value = "live";
  await store.retryRuntimeFailure();
}

async function submitMiniGameAction(text: string) {
  store.state.sendText = text;
  playMode.value = "live";
  await store.sendMessage();
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

async function replayWithBrowserSpeech(content: string, waitForCompletion = false): Promise<boolean> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    menuVisibleHint.value = "当前浏览器不支持朗读";
    return false;
  }
  window.speechSynthesis.cancel();
  const sanitized = sanitizeSpeechText(content);
  if (!sanitized) {
    menuVisibleHint.value = "这条内容没有可朗读文本";
    return false;
  }
  const utterance = new SpeechSynthesisUtterance(sanitized);
  utterance.lang = "zh-CN";
  utterance.rate = 1;
  utterance.pitch = 1;
  menuVisibleHint.value = "正在朗读";
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const timeoutMs = waitForCompletion ? estimatePlaybackTimeoutMs(sanitized) : 5000;
    const timer = window.setTimeout(() => finalize(false, "朗读超时"), timeoutMs);
    const finalize = (ok: boolean, hint: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      menuVisibleHint.value = hint;
      resolve(ok);
    };
    utterance.onstart = () => {
      if (!waitForCompletion) {
        finalize(true, "正在朗读");
      }
    };
    utterance.onend = () => finalize(true, "朗读完成");
    utterance.onerror = () => finalize(false, "朗读失败");
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      finalize(false, "朗读失败");
    }
  });
}

function messageUiKey(message: MessageItem): string {
  return `${store.state.currentSessionId}_${message.id}_${message.createTime}_${message.roleType || ""}`;
}

function latestMessageByKey(messageKey: string): MessageItem | null {
  return messages.value.find((message) => messageUiKey(message) === messageKey) || null;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function estimatePlaybackTimeoutMs(text: string): number {
  const normalized = sanitizeSpeechText(text);
  const estimated = normalized.length * 180 + 6000;
  return Math.max(8000, Math.min(45000, estimated));
}

function estimateRevealDelayMs(text: string): number {
  const normalized = sanitizeSpeechText(text);
  const estimated = normalized.length * 90 + 1200;
  return Math.max(1400, Math.min(4800, estimated));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer = 0;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(label)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    window.clearTimeout(timer);
  }
}

async function waitForMessageReveal(messageKey: string, isCancelled: () => boolean) {
  let currentMessage = latestMessageByKey(messageKey);
  if (!currentMessage) return;
  if (isRuntimeRetryMessage(currentMessage)) {
    await sleep(120);
    return;
  }
  store.setRuntimeMessageStatus(currentMessage.id, "revealing");
  let streamedSentenceCount = 0;
  let streamedVoicePlayed = false;
  if (isStreamingRuntimeMessage(currentMessage)) {
    while (!isCancelled()) {
      currentMessage = latestMessageByKey(messageKey);
      if (!currentMessage || !isStreamingRuntimeMessage(currentMessage)) break;
      const sentences = runtimeStreamSentences(currentMessage);
      while (!isCancelled() && autoVoice.value && streamedSentenceCount < sentences.length) {
        const sentence = sentences[streamedSentenceCount];
        streamedSentenceCount += 1;
        if (!sentence) continue;
        store.setRuntimeMessageStatus(currentMessage.id, "voicing");
        const played = await playMessageAudio(currentMessage, false, true, sentence);
        streamedVoicePlayed = streamedVoicePlayed || played;
      }
      await sleep(120);
    }
    if (isCancelled()) return;
    currentMessage = latestMessageByKey(messageKey) || currentMessage;
    const sentences = runtimeStreamSentences(currentMessage);
    while (!isCancelled() && autoVoice.value && streamedSentenceCount < sentences.length) {
      const sentence = sentences[streamedSentenceCount];
      streamedSentenceCount += 1;
      if (!sentence) continue;
      store.setRuntimeMessageStatus(currentMessage.id, "voicing");
      const played = await playMessageAudio(currentMessage, false, true, sentence);
      streamedVoicePlayed = streamedVoicePlayed || played;
    }
  }
  currentMessage = latestMessageByKey(messageKey) || currentMessage;
  if (currentMessage.roleType === "player") {
    store.setRuntimeMessageStatus(currentMessage.id, "waiting_player");
    await sleep(180);
    return;
  }
  if (!autoVoice.value) {
    store.setRuntimeMessageStatus(currentMessage.id, canPlayerSpeak.value ? "waiting_player" : "waiting_next");
    await sleep(estimateRevealDelayMs(messageDisplayContent(currentMessage)));
    return;
  }
  if (streamedVoicePlayed || streamedSentenceCount > 0) {
    store.setRuntimeMessageStatus(currentMessage.id, canPlayerSpeak.value ? "waiting_player" : "waiting_next");
    await sleep(260);
    return;
  }
  if (isCancelled()) return;
  store.setRuntimeMessageStatus(currentMessage.id, "voicing");
  const played = await playMessageAudio(currentMessage, false, true);
  if (isCancelled()) return;
  store.setRuntimeMessageStatus(currentMessage.id, canPlayerSpeak.value ? "waiting_player" : "waiting_next");
  await sleep(played ? 260 : estimateRevealDelayMs(messageDisplayContent(currentMessage)));
}

function stopRuntimeVoicePlayback() {
  runtimeVoiceRequestId += 1;
  runtimeVoiceResolve?.(false);
  runtimeVoiceResolve = null;
  clearRuntimeVoiceIndicator();
  if (runtimeVoicePlayer) {
    runtimeVoicePlayer.pause();
    runtimeVoicePlayer.currentTime = 0;
    runtimeVoicePlayer.src = "";
    runtimeVoicePlayer = null;
  }
  if (runtimeVoiceObjectUrl) {
    URL.revokeObjectURL(runtimeVoiceObjectUrl);
    runtimeVoiceObjectUrl = "";
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function clearRuntimeVoiceIndicator() {
  runtimeVoiceMessageKey.value = "";
  runtimeVoicePhase.value = "";
  runtimeVoiceIndicator.value = ".";
  if (runtimeVoiceIndicatorTimer) {
    window.clearInterval(runtimeVoiceIndicatorTimer);
    runtimeVoiceIndicatorTimer = 0;
  }
}

function setRuntimeVoiceIndicator(message: MessageItem | null, phase: "" | "loading" | "playing") {
  if (!message || !phase) {
    clearRuntimeVoiceIndicator();
    return;
  }
  runtimeVoiceMessageKey.value = messageUiKey(message);
  runtimeVoicePhase.value = phase;
}

function normalizeBindingMixVoices(input?: VoiceMixItem[] | null): VoiceMixItem[] {
  return (input || [])
    .filter((item) => String(item.voiceId || "").trim())
    .map((item) => ({
      voiceId: String(item.voiceId || "").trim(),
      weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0.7,
    }));
}

function splitSpeechSegments(input: string): string[] {
  const text = normalizePlayableSpeechText(input);
  if (!text) return [];
  const segments: string[] = [];
  let buffer = "";
  const push = () => {
    const value = normalizePlayableSpeechText(buffer);
    if (value && speakableUnitCount(value) >= 2) segments.push(value);
    buffer = "";
  };
  for (const char of text) {
    buffer += char;
    const length = buffer.replace(/\s/g, "").length;
    if (/[。！？!?；;\n]/.test(char)) {
      push();
      continue;
    }
    if (length >= 40) {
      push();
    }
  }
  push();
  return segments.filter(Boolean);
}

function createVoiceBindingDraft(source: {
  label?: string | null;
  configId?: number | null;
  presetId?: string | null;
  mode?: string | null;
  referenceAudioPath?: string | null;
  referenceAudioName?: string | null;
  referenceText?: string | null;
  promptText?: string | null;
  mixVoices?: VoiceMixItem[] | null;
}): VoiceBindingDraft | null {
  const draft: VoiceBindingDraft = {
    label: String(source.label || "").trim(),
    configId: source.configId ?? null,
    presetId: String(source.presetId || "").trim(),
    mode: String(source.mode || "text").trim() || "text",
    referenceAudioPath: String(source.referenceAudioPath || "").trim(),
    referenceAudioName: String(source.referenceAudioName || "").trim(),
    referenceText: String(source.referenceText || "").trim(),
    promptText: String(source.promptText || "").trim(),
  mixVoices: normalizeBindingMixVoices(source.mixVoices),
  };
  if (draft.mode === "clone" && !draft.referenceAudioPath) return null;
  if (draft.mode === "mix" && !(draft.mixVoices || []).some((item) => item.voiceId.trim())) return null;
  if (draft.mode === "prompt_voice" && !draft.promptText) return null;
  if (draft.mode === "text" && !draft.presetId) return null;
  return draft;
}

function runtimeStoryVoiceConfigId(): number | null {
  const value = store.state.settingsAiModelMap.find((item) => item.key === "storyVoiceModel")?.configId;
  return value && value > 0 ? value : null;
}

function inferFallbackPreset(roleType: string, name = "", description = ""): string {
  if (roleType === "narrator") return "story_narrator";
  const text = `${name} ${description}`.toLowerCase();
  if (/[女姐妈妹娘妃后妻她]|female|woman|girl|lady/.test(text)) {
    return "story_std_female";
  }
  return "story_std_male";
}

function narratorVoiceBinding(): VoiceBindingDraft | null {
  const settings = currentWorld.value?.settings;
  const narratorRole = currentWorld.value?.narratorRole;
  const debugConfigId = store.state.debugMode && !currentWorld.value ? runtimeStoryVoiceConfigId() : null;
  const configId = settings?.narratorVoiceConfigId ?? narratorRole?.voiceConfigId ?? debugConfigId;
  const normalizedMode = settings?.narratorVoiceMode || narratorRole?.voiceMode || store.state.narratorVoiceMode || "text";
  const presetId = settings?.narratorVoicePresetId || narratorRole?.voicePresetId || store.state.narratorVoicePresetId || "";
  return createVoiceBindingDraft({
    label: settings?.narratorVoice || narratorRole?.voice || store.state.narratorVoice || narratorRole?.name || store.state.narratorName || "旁白",
    configId: configId ?? null,
    presetId: !presetId && normalizedMode === "text" ? "story_narrator" : presetId,
    mode: normalizedMode,
    referenceAudioPath: settings?.narratorVoiceReferenceAudioPath || narratorRole?.voiceReferenceAudioPath || store.state.narratorVoiceReferenceAudioPath || "",
    referenceAudioName: settings?.narratorVoiceReferenceAudioName || narratorRole?.voiceReferenceAudioName || store.state.narratorVoiceReferenceAudioName || "",
    referenceText: settings?.narratorVoiceReferenceText || narratorRole?.voiceReferenceText || store.state.narratorVoiceReferenceText || "",
    promptText: settings?.narratorVoicePromptText || narratorRole?.voicePromptText || store.state.narratorVoicePromptText || "",
    mixVoices: settings?.narratorVoiceMixVoices || narratorRole?.voiceMixVoices || store.state.narratorVoiceMixVoices || [],
  });
}

function roleVoiceBinding(role?: StoryRole | null): VoiceBindingDraft | null {
  if (!role) return null;
  const configId = role.voiceConfigId ?? (store.state.debugMode && !currentWorld.value ? runtimeStoryVoiceConfigId() : null);
  const mode = role.voiceMode || "text";
  const presetId = role.voicePresetId || (mode === "text" ? inferFallbackPreset(role.roleType, role.name, role.description) : "");
  return createVoiceBindingDraft({
    label: role.voice || role.name,
    configId: configId ?? null,
    presetId,
    mode,
    referenceAudioPath: role.voiceReferenceAudioPath || "",
    referenceAudioName: role.voiceReferenceAudioName || "",
    referenceText: role.voiceReferenceText || "",
    promptText: role.voicePromptText || "",
    mixVoices: role.voiceMixVoices || [],
  });
}

function findMessageRole(message: MessageItem): StoryRole | null {
  if (message.roleType === "player" || message.roleType === "narrator") return null;
  const roleName = String(message.role || "").trim();
  return roleCards.value.find((role) => {
    if (!roleName) return role.roleType === message.roleType;
    return role.name === roleName || role.id === roleName;
  }) || roleCards.value.find((role) => role.roleType === message.roleType) || null;
}

function resolveMessageVoiceBinding(message: MessageItem): VoiceBindingDraft | null {
  if (message.roleType === "player") return null;
  if (message.roleType === "narrator") return narratorVoiceBinding();
  return roleVoiceBinding(findMessageRole(message));
}

function resolveFallbackVoiceBinding(message: MessageItem, originalBinding?: VoiceBindingDraft | null): VoiceBindingDraft | null {
  if (message.roleType === "player") return null;
  if (message.roleType === "narrator") {
    return createVoiceBindingDraft({
      label: originalBinding?.label || store.state.narratorVoice || store.state.narratorName || "旁白",
      configId: originalBinding?.configId ?? narratorVoiceBinding()?.configId ?? null,
      mode: "text",
      presetId: "story_narrator",
    });
  }
  const role = findMessageRole(message);
  const roleName = role?.name || String(message.role || "").trim();
  const fallbackPresetId = inferFallbackPreset(
    role?.roleType || message.roleType || "",
    roleName,
    role?.description || "",
  );
  return createVoiceBindingDraft({
    label: originalBinding?.label || role?.voice || roleName || "角色",
    configId: originalBinding?.configId ?? role?.voiceConfigId ?? null,
    mode: "text",
    presetId: fallbackPresetId,
  });
}

function shouldDowngradeRuntimeVoiceBinding(binding: VoiceBindingDraft | null | undefined, error: unknown): boolean {
  if (!binding || binding.mode === "text") return false;
  return isDeterministicRuntimeVoiceError(error);
}

function runtimeVoiceBindingKey(binding: VoiceBindingDraft): string {
  const runtimeContextKey = binding.configId || currentWorld.value?.id || store.state.currentSessionId || "runtime";
  return [
    runtimeContextKey,
    binding.mode || "text",
    binding.presetId || "",
    binding.referenceAudioPath || "",
    binding.referenceText || "",
    binding.promptText || "",
    (binding.mixVoices || []).map((item) => `${item.voiceId}:${item.weight}`).join(";"),
  ].join("|");
}

function runtimeVoicePreviewKey(binding: VoiceBindingDraft, text: string): string {
  return `${runtimeVoiceBindingKey(binding)}|${text}`;
}

async function resolveRuntimeVoiceUrl(binding: VoiceBindingDraft, text: string): Promise<string> {
  const cacheKey = runtimeVoicePreviewKey(binding, text);
  const cached = runtimeVoicePreviewCache.get(cacheKey);
  if (cached) return cached;
  const inflight = runtimeVoicePreviewInflight.get(cacheKey);
  if (inflight) return inflight;
  const task = withTimeout(
    store.streamVoice(
      binding.configId,
      text,
      binding.mode,
      binding.presetId,
      binding.referenceAudioPath,
      binding.referenceText,
      binding.promptText,
      binding.mixVoices || [],
      {
        format: RUNTIME_FAST_PREVIEW_FORMAT,
        sampleRate: RUNTIME_FAST_PREVIEW_SAMPLE_RATE,
      },
    ),
    15000,
    "语音生成超时",
  )
    .then((audioUrl) => {
      if (!audioUrl) {
        throw new Error("未返回试听音频");
      }
      setLimitedCacheValue(runtimeVoicePreviewCache, cacheKey, audioUrl);
      return audioUrl;
    })
    .finally(() => {
      runtimeVoicePreviewInflight.delete(cacheKey);
    });
  runtimeVoicePreviewInflight.set(cacheKey, task);
  return task;
}

async function warmVoiceBinding(binding: VoiceBindingDraft) {
  if (binding.mode !== "text") return;
  const bindingKey = runtimeVoiceBindingKey(binding);
  if (runtimeVoiceWarmCache.has(bindingKey)) return;
  runtimeVoiceWarmCache.add(bindingKey);
  try {
    await resolveRuntimeVoiceUrl(binding, "你好啊，有什么可以帮到你");
  } catch {
    // 保持静默，预热失败不影响正式播放
  }
}

async function fetchRuntimeVoiceBlob(audioUrl: string): Promise<Blob> {
  const cached = runtimeVoiceBlobCache.get(audioUrl);
  if (cached) return cached;
  const response = await withTimeout(fetch(audioUrl), 10000, "音频下载超时");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  setLimitedCacheValue(runtimeVoiceBlobCache, audioUrl, blob);
  return blob;
}

async function playRuntimeVoiceBlob(
  blob: Blob,
  manual: boolean,
  waitForCompletion: boolean,
  speakable: string,
  onPlay?: () => void,
): Promise<boolean> {
  runtimeVoiceObjectUrl = URL.createObjectURL(blob);
  const player = new Audio(runtimeVoiceObjectUrl);
  player.preload = "auto";
  runtimeVoicePlayer = player;
  const completed = await new Promise<boolean>((resolve) => {
    runtimeVoiceResolve = resolve;
    let finished = false;
    const timeoutMs = waitForCompletion ? estimatePlaybackTimeoutMs(speakable) : 8000;
    const timer = window.setTimeout(() => finalize(false, "朗读超时"), timeoutMs);
    const finalize = (ok: boolean, hint: string) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      if (runtimeVoicePlayer === player) runtimeVoicePlayer = null;
      if (runtimeVoiceObjectUrl) {
        URL.revokeObjectURL(runtimeVoiceObjectUrl);
        runtimeVoiceObjectUrl = "";
      }
      runtimeVoiceResolve = null;
      if (manual) menuVisibleHint.value = hint;
      resolve(ok);
    };
    player.onplay = () => {
      onPlay?.();
      if (manual) menuVisibleHint.value = "正在播放试听";
      if (!waitForCompletion) {
        finalize(true, "正在播放试听");
      }
    };
    player.onended = () => finalize(true, "朗读完成");
    player.onerror = () => finalize(false, "朗读失败");
    void player.play().catch(() => finalize(false, "朗读失败"));
  });
  return completed;
}

async function playMessageAudioWithBinding(
  message: MessageItem,
  binding: VoiceBindingDraft,
  speakable: string,
  manual: boolean,
  waitForCompletion: boolean,
): Promise<boolean> {
  stopRuntimeVoicePlayback();
  const requestId = runtimeVoiceRequestId;
  if (manual) {
    menuVisibleHint.value = "正在生成语音";
  }
  const segments = splitSpeechSegments(speakable);
  if (!segments.length) return false;
  setRuntimeVoiceIndicator(message, "loading");
  for (const segment of segments) {
    let segmentPlayed = false;
    let lastError: unknown = null;
    const previewKey = runtimeVoicePreviewKey(binding, segment);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let shouldRetry = true;
      if (requestId !== runtimeVoiceRequestId) return false;
      try {
        setRuntimeVoiceIndicator(message, "loading");
        const audioUrl = await resolveRuntimeVoiceUrl(binding, segment);
        if (!audioUrl || requestId !== runtimeVoiceRequestId) return false;
        const blob = await fetchRuntimeVoiceBlob(audioUrl);
        segmentPlayed = await playRuntimeVoiceBlob(blob, manual, waitForCompletion, segment, () => {
          setRuntimeVoiceIndicator(message, "playing");
        });
        if (segmentPlayed) break;
        lastError = new Error("朗读失败");
      } catch (error: any) {
        lastError = error;
        const messageText = String(error?.message || "");
        if (/^HTTP\s+\d+/i.test(messageText) || messageText.includes("音频下载超时")) {
          runtimeVoicePreviewCache.delete(previewKey);
          runtimeVoicePreviewInflight.delete(previewKey);
        }
        shouldRetry = !isDeterministicRuntimeVoiceError(error);
      }
      if (!shouldRetry) {
        break;
      }
      await sleep(220);
    }
    if (!segmentPlayed) {
      throw (lastError instanceof Error ? lastError : new Error("朗读失败"));
    }
    if (!waitForCompletion) {
      return true;
    }
    await sleep(120);
  }
  return true;
}

async function playMessageAudio(
  message: MessageItem,
  manual = false,
  waitForCompletion = false,
  overrideContent?: string,
): Promise<boolean> {
  const playableContent = overrideContent ?? messageDisplayContent(message);
  const speakable = normalizePlayableSpeechText(playableContent);
  if (!speakable) {
    if (manual) menuVisibleHint.value = "这条内容没有可朗读文本";
    return false;
  }
  const binding = resolveMessageVoiceBinding(message);
  if (!binding) {
    return replayWithBrowserSpeech(overrideContent ?? message.content, waitForCompletion);
  }
  const bindingKey = runtimeVoiceBindingKey(binding);
  const preferredBinding = runtimeVoiceFallbackBindingCache.get(bindingKey) || binding;
  try {
    return await playMessageAudioWithBinding(message, preferredBinding, speakable, manual, waitForCompletion);
  } catch (error: any) {
    let finalError: unknown = error;
    if (
      runtimeVoiceBindingKey(preferredBinding) === bindingKey
      && shouldDowngradeRuntimeVoiceBinding(preferredBinding, error)
    ) {
      const fallbackBinding = resolveFallbackVoiceBinding(message, binding);
      if (fallbackBinding && runtimeVoiceBindingKey(fallbackBinding) !== bindingKey) {
        setLimitedCacheValue(runtimeVoiceFallbackBindingCache, bindingKey, fallbackBinding);
        try {
          if (manual) {
            menuVisibleHint.value = "当前绑定音色不可用，正在切换兼容音色";
          }
          return await playMessageAudioWithBinding(message, fallbackBinding, speakable, manual, waitForCompletion);
        } catch (fallbackError) {
          finalError = fallbackError;
        }
      }
    }
    const browserFallbackPlayed = await replayWithBrowserSpeech(playableContent, waitForCompletion);
    if (browserFallbackPlayed) {
      return true;
    }
    if (!manual) {
      store.state.notice = "自动语音失败，已跳过，可点重听重试";
    }
    if (manual) {
      menuVisibleHint.value = `朗读失败: ${(finalError as any)?.message || "未知错误"}`;
    }
    return false;
  } finally {
    if (runtimeVoiceMessageKey.value === messageUiKey(message)) {
      clearRuntimeVoiceIndicator();
    }
  }
}

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

function closeDebugDialog() {
  store.state.debugEndDialog = null;
  store.state.debugEndDialogDetail = "";
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
  playMode.value = playMode.value === "tips" ? "live" : "tips";
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
    await playMessageAudio(message, true, true);
    if (runId !== playbackRunId) return;
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
  if (runtimeVoiceMessageKey.value !== messageUiKey(message) || !runtimeVoicePhase.value) return "";
  return runtimeVoiceIndicator.value;
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
    store.state.sendText = text;
    await submit();
  } catch (error: any) {
    store.state.notice = `语音识别失败: ${error?.message || "未知错误"}`;
  } finally {
    voiceTranscribing.value = false;
  }
}

function stopVoiceRecordingAndTranscribe() {
  const recorder = mediaRecorder;
  if (!recorder) return;
  try {
    recorder.stop();
  } catch (error: any) {
    voiceListening.value = false;
    store.state.notice = `结束录音失败: ${error?.message || "未知错误"}`;
  }
}

async function startVoiceRecognition() {
  if (!browserSpeechSupported.value) {
    inputMode.value = "text";
    store.state.notice = "当前浏览器暂不支持语音输入，已切换文字输入";
    nextTick(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".play-textarea");
      textarea?.focus();
    });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStream = stream;
    mediaChunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorder = recorder;
    // 立即进入录音态，避免 onstart 延迟时看起来像“没有按住效果”。
    voiceListening.value = true;
    recorder.onstart = () => {
      voiceListening.value = true;
    };
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        mediaChunks.push(event.data);
      }
    };
    recorder.onerror = () => {
      voiceListening.value = false;
      store.state.notice = "语音识别失败";
    };
    recorder.onstop = async () => {
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
    recorder.start();
  } catch (error: any) {
    inputMode.value = "text";
    voiceListening.value = false;
    resetVoiceHoldState();
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

function pickTip(option: string) {
  if (!canPlayerInput.value) {
    store.state.notice = runtimeProgressHint.value || "当前还没轮到用户发言";
    return;
  }
  store.state.sendText = option;
  void submit();
}

onBeforeUnmount(() => {
  clearPressTimer();
  stopVoiceRecognition();
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
          <button type="button" class="play-circle-btn" :aria-label="autoVoice ? '静音' : '开启语音'" @click="autoVoice = !autoVoice">
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
      <div v-if="!autoVoice" class="play-entry-toast">静音进入</div>
      <div v-if="playMode === 'history'" class="play-mode-badge">{{ isSessionPlaybackMode ? "剧情回放" : "历史模式" }}</div>
      <div
        v-if="playMode !== 'history' && currentLiveFigureFgPath"
        class="play-figure-stage"
      >
        <div class="play-figure-stage__glow"></div>
        <div v-if="currentLiveFigureFgPath" class="play-figure play-figure--fg" :style="{ backgroundImage: `url(${currentLiveFigureFgPath})` }"></div>
        <div class="play-figure-stage__fade"></div>
      </div>
      <div
        ref="messageViewport"
        class="play-thread"
        :class="{ 'play-thread--history': playMode === 'history', 'play-thread--single-mode': playMode !== 'history' }"
      >
        <div v-if="!displayMessages.length && !playOpenOverlayVisible" class="play-empty">{{ emptySessionHint }}</div>
        <div v-else-if="playMode === 'history'" class="play-thread__history">
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
                    </span>
                  </template>
                  <span v-else>{{ messageDisplayContent(message) || "（空消息）" }}</span>
                  <span
                    v-if="messageVoiceTail(message)"
                    class="play-bubble-voice-tail"
                    :class="{ 'is-playing': runtimeVoicePhase === 'playing' }"
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
                    </span>
                  </template>
                  <span v-else>{{ messageDisplayContent(currentLiveMessage) || "（空消息）" }}</span>
                  <span
                    v-if="messageVoiceTail(currentLiveMessage)"
                    class="play-bubble-voice-tail"
                    :class="{ 'is-playing': runtimeVoicePhase === 'playing' }"
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
                v-if="playMode !== 'history' && playMode !== 'setting' && playMode !== 'tips' && tipOptions.length"
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
          创作者未开放“他人可查看角色设定”，当前仅展示基础信息。
        </div>
        <div v-else-if="settingSelectedRole" class="play-inline-card">
          <div class="play-inline-card__title">{{ settingSelectedRole.name }}</div>
          <div class="play-inline-card__text">角色类型：{{ roleTypeLabel(settingSelectedRole) }}</div>
          <div class="play-inline-card__text">角色设定：{{ settingSelectedRole.description || "暂无角色设定" }}</div>
          <div class="play-inline-card__text">角色音色：{{ settingSelectedRole.voice || "未绑定音色" }}</div>
          <div v-if="settingSelectedRole.sample" class="play-inline-card__text">台词示例：{{ settingSelectedRole.sample }}</div>
          <button type="button" class="play-link-text" @click="openRoleDetail(settingSelectedRole)">查看角色详情</button>
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
          <pre class="play-state-pre">{{ statePreviewText }}</pre>
        </div>

        <button type="button" class="play-link-row" @click="toggleEventProgress">
          <span>当前章节事件</span>
          <span>{{ eventProgressOpen ? "收起 >" : ">" }}</span>
        </button>
        <div v-if="eventProgressOpen" class="play-inline-card">
          <div class="play-inline-card__title">当前事件进度</div>
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
          <pre v-else-if="runtimeEventWindowText" class="play-state-pre">{{ runtimeEventWindowText }}</pre>
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
        <div class="play-sheet__title">AI 提示</div>
        <button v-for="option in tipOptions" :key="option" type="button" class="play-tip-option" @click="pickTip(option)">{{ option }}</button>
        <button type="button" class="play-tip-back" @click="toggleTipsMode">返回</button>
      </section>

      <section v-if="activeMiniGame && playMode !== 'setting' && playMode !== 'tips'" class="play-mini-game-panel">
        <div class="play-mini-game-panel__head">
          <div>
            <div class="play-mini-game-panel__title">{{ activeMiniGame.displayName }}</div>
            <div class="play-mini-game-panel__meta">第 {{ activeMiniGame.round || 1 }} 轮 · {{ activeMiniGame.phase || "进行中" }}</div>
          </div>
          <div class="play-mini-game-panel__status">{{ activeMiniGame.status || "active" }}</div>
        </div>
        <div v-if="activeMiniGame.ruleSummary" class="play-mini-game-panel__hint">{{ activeMiniGame.ruleSummary }}</div>
        <div v-if="miniGameSummaryItems.length" class="play-mini-game-panel__state">
          <div
            v-for="item in miniGameSummaryItems"
            :key="item.key"
            class="play-mini-game-panel__state-item"
          >
            <span class="play-mini-game-panel__state-key">{{ item.key }}</span>
            <span class="play-mini-game-panel__state-value">{{ item.value }}</span>
          </div>
        </div>
        <div v-if="!activeMiniGame.pendingExit" class="play-mini-game-panel__actions">
          <button
            v-for="option in activeMiniGame.playerOptions"
            :key="String(option.action_id || option.label || option.desc || '')"
            type="button"
            class="play-mini-game-panel__action"
            @click="submitMiniGameAction(String(option.label || option.action_id || ''))"
          >
            {{ option.label || option.action_id }}
          </button>
        </div>
        <div class="play-mini-game-panel__controls">
          <button
            v-for="action in miniGameControlOptions"
            :key="action"
            type="button"
            class="play-mini-game-panel__control"
            @click="submitMiniGameAction(action)"
          >
            {{ action }}
          </button>
        </div>
      </section>

      <div class="play-story-footer">
        <div class="play-story-main">
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
        <div class="play-story-actions">
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
            <span>{{ playMode === "history" ? (isSessionPlaybackMode ? "继续聊" : "返回") : "历史" }}</span>
          </button>
        </div>
      </div>

      <div class="play-input-shell" :class="{ 'play-input-shell--text': inputMode === 'text', 'play-input-shell--fallback': canPlayerInput && !canPlayerSpeak }">
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
              :disabled="!playbackCanPlay || playbackPlaying"
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
              {{ playbackPlaying ? "暂停回放" : "开始回放" }}
            </button>
            <button type="button" class="playback-panel__btn playback-panel__btn--primary" @click="continueFromPlayback">
              继续聊
            </button>
          </div>
        </div>
        <div v-else-if="runtimeProgressHint" class="play-turn-hint" :class="{ 'play-turn-hint--loading': debugAutoAdvancing }">{{ runtimeProgressHint }}</div>
        <div v-if="activeMiniGame && !activeMiniGame.acceptsTextInput && playMode !== 'setting' && playMode !== 'tips'" class="play-mini-game-input-lock">
          小游戏进行中，请使用上方面板操作。
        </div>
        <template v-else-if="playMode === 'history' && isSessionPlaybackMode">
          <div class="play-playback-lock">当前为剧情回放模式，可查看全部历史台词。</div>
        </template>
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
            <button type="button" class="play-send-btn" :disabled="!canPlayerInput" @click="submit">
              {{ currentRuntimeInputStatus === "sending" ? "发送中..." : sessionRuntimeStageText ? "处理中..." : "发送" }}
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

    <div v-if="store.state.debugEndDialog" class="modal-backdrop" @click.self="closeDebugDialog">
      <div class="modal-panel" style="width:min(100%,420px);">
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
</style>
