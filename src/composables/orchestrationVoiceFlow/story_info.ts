/**
 * 故事信息模块
 *
 * 职责：
 * - 获取正在游玩的故事的静态和动态数据
 * - 管理会话状态、章节信息、运行时状态等
 */
import { computed } from "vue";
import { useToonflowStore } from "../useToonflowStore";
import { WebDebugLogUtil } from "../../utils/WebDebugLogUtil";

// ============== Store 延迟获取 ==============
function getStore() {
  return useToonflowStore();
}

// ============== 计算属性 ==============
/** 当前会话 */
const session = computed(() => getStore().state.sessionDetail);
/** 当前世界 */
const currentWorld = computed(() => session.value?.world || null);
/** 当前章节 */
const currentChapter = computed(() => {
  const latestState = asMiniRecord(session.value?.latestSnapshot?.state);
  const currentState = asMiniRecord(session.value?.state);
  const raw = Number(latestState.chapterId || currentState.chapterId || session.value?.chapterId || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
});
/** 当前会话 ID */
const currentSessionId = computed(() => getStore().state.currentSessionId);
/** 是否调试模式 */
const isDebugMode = computed(() => getStore().state.debugMode);
/** 运行时状态记录 */
const runtimeStateRecord = computed(() => {
  const source = getStore().state.debugMode
    ? getStore().state.debugRuntimeState
    : (session.value?.state || session.value?.latestSnapshot?.state || null);
  return typeof source === "object" && source !== null && !Array.isArray(source)
    ? (source as Record<string, unknown>)
    : {};
});
/** 回合状态记录 */
const runtimeTurnStateRecord = computed(() => {
  const turnState = runtimeStateRecord.value["turnState"];
  return typeof turnState === "object" && turnState !== null && !Array.isArray(turnState)
    ? (turnState as Record<string, unknown>)
    : {};
});

// ============== 辅助函数 ==============
function asMiniRecord(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

/**
 * 获取故事信息
 * 包括世界信息、章节信息、运行时状态等
 */
export function getStoryInfo() {
  return {
    sessionId: currentSessionId.value,
    worldId: getStore().state.worldId,
    world: currentWorld.value,
    chapterId: currentChapter.value,
    isDebugMode: isDebugMode.value,
    runtimeState: runtimeStateRecord.value,
    turnState: runtimeTurnStateRecord.value,
    canPlayerSpeak: getStore().state.canPlayerSpeak,
  };
}

/**
 * 判断当前是否允许用户发言
 */
export function canPlayerSpeak(): boolean {
  // 正式链以服务端 `storyInfo.turnState` 为准
  const turnState = runtimeTurnStateRecord.value;
  if (turnState["canPlayerSpeak"] === false) {
    return false;
  }
  return true;
}

/**
 * 判断当前是否正在流式生成
 */
export function isStreaming(): boolean {
  return getStore().state.messages.some((item) => item.status === "streaming");
}

/**
 * 获取当前消息的运行时状态
 */
export function getRuntimeMessageStatus(messageId: number | string): string {
  const message = getStore().state.messages.find((item) => String(item.id) === String(messageId));
  if (!message) return "";
  return String(message.status || "");
}

/**
 * 获取当前会话的最新消息
 */
export function getLatestMessage() {
  const messages = getStore().state.messages;
  return messages.length > 0 ? messages[messages.length - 1] : null;
}

/**
 * 获取当前会话的运行时对话 ID
 */
export function getRuntimeConversationId(): string {
  const runtimeState = runtimeStateRecord.value;
  const debugRuntimeKey = String(runtimeState?.["debugRuntimeKey"] || "").trim();
  if (debugRuntimeKey) return debugRuntimeKey;
  const sessionId = getStore().state.currentSessionId.trim();
  if (sessionId) return `session:${sessionId}`;
  return `world:${getStore().state.worldId || 0}:chapter:${getStore().state.debugChapterId || 0}`;
}

// ============== 导出 composable ==============
export function useStoryInfo() {
  return {
    // 计算属性
    session,
    currentWorld,
    currentChapter,
    currentSessionId,
    isDebugMode,
    runtimeStateRecord,
    runtimeTurnStateRecord,
    // 函数
    getStoryInfo,
    canPlayerSpeak,
    isStreaming,
    getRuntimeMessageStatus,
    getLatestMessage,
    getRuntimeConversationId,
  };
}