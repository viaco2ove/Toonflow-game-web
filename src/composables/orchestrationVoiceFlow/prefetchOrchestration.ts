/**
 * 预取编排模块
 *
 * 职责：
 * - 预取 orchestration 数据，当前轮获取完台词后，获取下一轮的角色编排数据：那个角色，什么说话动机
 * - 等到 streamlinesSteamGen.ts voiceGenPlay.ts 都认为当当前轮台词播放完毕后，
 * - resolveSessionOrchestration.ts 正式进行角色编排行为，生成下一轮的台词。
 *
 * ## 预取机制
 *
 * 编排NPC-A → 台词A生成完 → prefetch 预编排 NPC-B (后台) → Watch: 语音A 开始播放
 *
 * break退出for循环 → 等待 continueSessionNarrative
 *   ↓
 * ScenePlay播放语音A(流式多段) → 播完(多段串行)
 *   ↓
 * status = "waiting_next" → Watch检测到
 *   ↓
 * auto_advancing → continueSessionNarrative()
 *   ↓
 * resolveSessionOrchestration 复用预取的编排结果 → 台词B生成完 → break
 *   ↓
 * ScenePlay播放语音B(流式多段) → 播完(多段串行)
 *   ↓
 * ...循环直到轮到用户发言
 *
 * ## 预取触发条件
 * - 当前消息不是用户回合 (canPlayerSpeak !== false)
 * - 没有正在进行的预取（避免重复请求）
 * - 不是流式生成中
 */
import { computed, ref } from "vue";
import { useToonflowStore } from "../useToonflowStore";
import { WebDebugLogUtil } from "../../utils/WebDebugLogUtil";

// ============== 类型定义 ==============
interface PendingSessionOrchestrationPrefetch {
  sessionId: string;
  triggerMessageId: number;
  promise: Promise<unknown>;
}

// ============== Store 延迟获取 ==============
function getStore() {
  return useToonflowStore();
}

// ============== 状态 ==============
/** 当前正在预取的编排结果 */
let pendingSessionOrchestrationPrefetch: PendingSessionOrchestrationPrefetch | null = null;

// ============== 计算属性 ==============
const canPlayerSpeak = computed(() => getStore().state.canPlayerSpeak);

// ============== 预取编排函数 ==============
/**
 * 清除预取的编排结果
 */
export function clearPendingSessionOrchestrationPrefetch() {
  if (pendingSessionOrchestrationPrefetch) {
    WebDebugLogUtil.log("[prefetchOrchestration] clearPendingSessionOrchestrationPrefetch");
  }
  pendingSessionOrchestrationPrefetch = null;
}

/**
 * 获取当前预取的编排结果
 */
export function getPendingOrchestrationPrefetch(): PendingSessionOrchestrationPrefetch | null {
  return pendingSessionOrchestrationPrefetch;
}

/**
 * 预取下一轮编排
 *
 * 在当前台词播放完毕后调用，后台发起 /game/orchestration 请求
 * 复用预取结果可以节省编排 AI 调用时间（约 2~4 秒）
 */
export function prefetchNextSessionOrchestration(triggerMessageId: number) {
  const sessionId = String(getStore().state.currentSessionId || "").trim();
  if (!sessionId) return;

  // 如果是用户回合，不进行预取
  if (canPlayerSpeak.value !== false) {
    WebDebugLogUtil.log("[prefetchOrchestration] 跳过预取，用户回合");
    clearPendingSessionOrchestrationPrefetch();
    return;
  }

  // 如果已经有匹配的预取，不重复请求
  if (
    pendingSessionOrchestrationPrefetch
    && pendingSessionOrchestrationPrefetch.sessionId === sessionId
    && pendingSessionOrchestrationPrefetch.triggerMessageId === Number(triggerMessageId)
  ) {
    WebDebugLogUtil.log("[prefetchOrchestration] 已有相同预取，跳过", {
      sessionId,
      triggerMessageId,
    });
    return;
  }

  // 清除之前的预取
  clearPendingSessionOrchestrationPrefetch();

  // 创建新的预取
  const promise = getStore().api.orchestrateSession(sessionId);
  WebDebugLogUtil.log("[prefetchOrchestration] 开始预取编排", {
    sessionId,
    triggerMessageId,
  });

  pendingSessionOrchestrationPrefetch = {
    sessionId,
    triggerMessageId: Number(triggerMessageId),
    promise: promise as Promise<unknown>,
  };
}

/**
 * 检查是否可以复用预取的编排结果
 */
export function canUsePrefetchedOrchestration(triggerMessageId: number): boolean {
  const sessionId = String(getStore().state.currentSessionId || "").trim();
  if (!sessionId) return false;

  const pending = pendingSessionOrchestrationPrefetch;
  if (
    pending
    && pending.sessionId === sessionId
    && pending.triggerMessageId === Number(triggerMessageId)
  ) {
    return true;
  }
  return false;
}

/**
 * 消费预取的编排结果
 * 返回预取的 promise，并清除预取状态
 */
export async function consumePrefetchedOrchestration<T>(triggerMessageId: number): Promise<T | null> {
  if (!canUsePrefetchedOrchestration(triggerMessageId)) {
    clearPendingSessionOrchestrationPrefetch();
    return null;
  }

  const pending = pendingSessionOrchestrationPrefetch!;
  clearPendingSessionOrchestrationPrefetch();

  WebDebugLogUtil.log("[prefetchOrchestration] 消费预取结果", {
    sessionId: pending.sessionId,
    triggerMessageId: pending.triggerMessageId,
  });

  return await pending.promise as Promise<T>;
}

// ============== 导出 composable ==============
export function usePrefetchOrchestration() {
  return {
    clearPendingSessionOrchestrationPrefetch,
    getPendingOrchestrationPrefetch,
    prefetchNextSessionOrchestration,
    canUsePrefetchedOrchestration,
    consumePrefetchedOrchestration,
  };
}