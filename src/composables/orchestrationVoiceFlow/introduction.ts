/**
 * Introduction 模块 - 开场白相关业务
 *
 * 职责：
 * - 判断是否走开场白流（on_opening + presetContent）
 * - 调试模式的开场白流开关
 * - 开场白流的处理（delta / done / sentence / error）
 * - 开场白展示时间（waitForSessionOpeningPresentation）
 * - 开场白 commitNarrativeTurn 回填
 *
 * ## 接口：
 * /game/streamlines/introduction
 * - 只消费 preset 分片
 * - opening 必须直接播放章节写死文案，不能再复用普通台词流的 speaker 改写链
 *
 * ## 效果
 * 有累积，有渐显 ✅
 * - 实时接收：使用 ReadableStream 读取
 * - 逐字追加：使用 requestAnimationFrame 实现打字机效果
 * - 提交成功后额外等待一段 opening 展示时间，避免一闪而过
 *
 * ## 流程
 * 开场白开始：首先加载开场白 先出现“。。。”
 * 加载过程：流式逐字追加显示
 * 加载完成：马上显示 语音生成中效果，同时进行预编排
 * voiceGenPlay.ts 负责语音生成中效果
 * 语音播放中：马上显示语音播放中效果
 * voiceGenPlay.ts 显示播放中效果
 * 全部拆分句都播放完毕。然后进行下一轮的正式编排（resolveSessionOrchestration）
 */
import { useToonflowStore } from "../useToonflowStore";
import { WebDebugLogUtil } from "../../utils/WebDebugLogUtil";
import {
  startTypewriter,
} from "./state";
import {
  handleStreamSentence,
} from "./streamlinesSteamGen";

// ============== Store 延迟获取 ==============
function getStore() {
  return useToonflowStore();
}

// ============== 类型定义 ==============
export interface IntroductionPlan {
  role?: string;
  roleType?: string;
  motive?: string;
  eventType?: string;
  presetContent?: string;
  /** 完整 plan 引用（向 /game/streamlines/introduction 提交时透传） */
  plan?: unknown;
}

export type IntroductionEventType = "delta" | "done" | "sentence" | "error";

export interface IntroductionDeltaEvent {
  type: "delta";
  data: { text: string };
}

export interface IntroductionDoneEvent {
  type: "done";
  data: { message?: Record<string, unknown> };
}

export interface IntroductionSentenceEvent {
  type: "sentence";
  data: { text: string };
}

export interface IntroductionErrorEvent {
  type: "error";
  data: { message: string };
}

export type IntroductionEvent =
  | IntroductionDeltaEvent
  | IntroductionDoneEvent
  | IntroductionSentenceEvent
  | IntroductionErrorEvent;

// ============== 判定逻辑 ==============

/**
 * 判断 plan 是否属于开场白
 *
 * 条件：
 * - eventType === "on_opening"
 * - presetContent 非空
 */
export function shouldUseIntroductionStream(plan: IntroductionPlan | null | undefined): boolean {
  if (!plan) return false;
  const eventType = String((plan as any).eventType || "").trim().toLowerCase();
  const presetContent = String((plan as any).presetContent || "").trim();
  return eventType === "on_opening" && Boolean(presetContent);
}

/**
 * 判断是否使用开场白流（兼容调试模式）
 */
export function shouldUseDebugIntroductionStream(plan: any): boolean {
  if (!plan) return false;
  return String(plan.eventType || "").trim().toLowerCase() === "on_opening"
    && Boolean(String(plan.presetContent || "").trim());
}

// ============== 开场白流的处理 ==============

/**
 * 处理开场白流式 delta 事件（逐字追加）
 */
function handleIntroductionDelta(
  streamingMessageId: string,
  accumulated: string,
  deltaText: string,
): string {
  const text = String(deltaText || "");
  if (!text) return accumulated;
  const next = accumulated + text;
  // 启动打字机动画
  startTypewriter(streamingMessageId, next);
  // 同步完整 content
  getStore().updateMessageById(streamingMessageId, (message) => ({
    ...message,
    content: next,
  }));
  WebDebugLogUtil.log("[introduction] delta", {
    streamingMessageId,
    deltaText: text,
    accumulatedSoFar: next,
    totalLength: next.length,
    timestamp: Date.now(),
  });
  return next;
}

/**
 * 处理开场白流式 sentence 事件（用于语音播放）
 */
function handleIntroductionSentence(
  streamingMessageId: string,
  sentence: string,
  messageKey: string,
): void {
  const text = String(sentence || "").trim();
  if (!text) return;
  // 把句子加到 store message meta.sentences
  getStore().updateMessageById(streamingMessageId, (message) => {
    const metaRecord = getStore().buildRuntimeStreamMeta(message.meta, {
      streaming: true,
      status: "streaming",
    });
    const rawSentences = Array.isArray(metaRecord.sentences) ? metaRecord.sentences : [];
    const sentences = rawSentences.map((item: any) => String(item || "").trim()).filter(Boolean);
    if (!sentences.includes(text)) {
      sentences.push(text);
    }
    return {
      ...message,
      meta: getStore().buildRuntimeStreamMeta(metaRecord, { sentences }),
    };
  }, true);
  // 同时注册到独立播放状态追踪
  handleStreamSentence(text, messageKey);
  WebDebugLogUtil.log("[introduction] sentence added", {
    streamingMessageId,
    sentence: text,
    timestamp: Date.now(),
  });
}

/**
 * 处理开场白流式 done 事件（生成完成）
 */
async function handleIntroductionDone(
  streamingMessageId: string,
  finalMessage: Record<string, unknown> | null,
  accumulated: string,
): Promise<{ done: true; content: string; finalMessage: Record<string, unknown> | null }> {
  const finalMessageRecord = finalMessage || {};
  const eventData = (finalMessage as Record<string, unknown>) || {};
  const finalContent = getStore().resolveStreamDoneContent(eventData, finalMessageRecord, accumulated);
  // 确保打字机动画显示完整内容
  startTypewriter(streamingMessageId, finalContent);
  // 等待一小段时间让打字机完成
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  // 更新 store message
  getStore().updateMessageById(streamingMessageId, (message) => ({
    ...message,
    role: String(finalMessageRecord.role || message.role || ""),
    roleType: String(finalMessageRecord.roleType || message.roleType || ""),
    eventType: String(finalMessageRecord.eventType || message.eventType || "on_opening"),
    content: finalContent,
    meta: getStore().buildRuntimeStreamMeta(message.meta, {
      streaming: false,
      status: "generated",
    }),
  }), true);
  WebDebugLogUtil.log("[introduction] done", {
    streamingMessageId,
    finalContent,
    finalLength: finalContent.length,
    timestamp: Date.now(),
  });
  return { done: true, content: finalContent, finalMessage: finalMessageRecord };
}

/**
 * 处理开场白流式 error 事件
 */
function handleIntroductionError(errorMessage: string): Error {
  WebDebugLogUtil.log("[introduction] error", {
    error: errorMessage,
    timestamp: Date.now(),
  });
  return new Error(errorMessage || "开场白流播放失败");
}

// ============== 开场白完整播放流程 ==============

/**
 * 完整播放一场开场白流式生成
 *
 * 流程：
 * 1. 创建 streamingMessage
 * 2. 监听 NDJSON 事件（delta/done/sentence/error）
 * 3. done 后调用 commitNarrativeTurn 回填后端
 * 4. 等待 opening 展示时间
 */
export async function streamSessionIntroductionPlan(
  orchestration: { plan?: IntroductionPlan | null } | null,
  historyMessages: any[],
): Promise<void> {
  const plan = orchestration?.plan;
  const store = getStore();
  if (!store.state.currentSessionId || !plan) return;

  const streamingMessage = store.createStreamingMessage(plan as any, historyMessages.length + 1);
  let accumulated = "";
  let finalMessage: Record<string, unknown> | null = null;
  let done = false;

  store.state.messages = [...historyMessages, streamingMessage];
  store.syncRuntimeChatTrace();

  const messageKey = `${store.state.currentSessionId}_${streamingMessage.id}_${streamingMessage.createTime}_${streamingMessage.roleType || ""}`;

  try {
    await store.api.streamIntroductionLines({
      sessionId: store.state.currentSessionId,
      plan: plan as any,
    }, async (event: IntroductionEvent) => {
      switch (event.type) {
        case "delta": {
          accumulated = handleIntroductionDelta(String(streamingMessage.id), accumulated, event.data.text);
          break;
        }
        case "sentence": {
          handleIntroductionSentence(String(streamingMessage.id), event.data.text, messageKey);
          break;
        }
        case "done": {
          const result = await handleIntroductionDone(String(streamingMessage.id), event.data.message || null, accumulated);
          finalMessage = result.finalMessage;
          done = result.done;
          accumulated = result.content;
          break;
        }
        case "error": {
          throw handleIntroductionError(event.data.message);
        }
      }
    });

    if (!done) {
      throw new Error("开场白流未正常结束");
    }

    const committedContent = store.resolveStreamDoneContent(null, finalMessage as any, accumulated);
    const committedCreateTime = Number((finalMessage as Record<string, unknown> | null)?.["createTime"] || Date.now());
    const committedRole = String((finalMessage as Record<string, unknown> | null)?.["role"] || streamingMessage.role || "旁白");
    const committedRoleType = String((finalMessage as Record<string, unknown> | null)?.["roleType"] || streamingMessage.roleType || "narrator");
    const committedEventType = String((finalMessage as Record<string, unknown> | null)?.["eventType"] || plan.eventType || "on_opening");

    const committed = await store.api.commitNarrativeTurn({
      sessionId: store.state.currentSessionId,
      role: committedRole,
      roleType: committedRoleType,
      eventType: committedEventType,
      content: committedContent,
      createTime: committedCreateTime,
      saveSnapshot: true,
    });

    const fallbackCommittedMessage = {
      id: Number((finalMessage as Record<string, unknown> | null)?.["id"] || committedCreateTime),
      role: committedRole,
      roleType: committedRoleType,
      eventType: committedEventType,
      content: committedContent,
      createTime: committedCreateTime,
    };

    store.state.messages = [...historyMessages];
    store.syncRuntimeChatTrace();
    if (!committed.message && !(Array.isArray(committed.generatedMessages) && committed.generatedMessages.length)) {
      store.applySessionNarrativeResult({
        ...committed,
        message: fallbackCommittedMessage,
      });
    } else {
      store.applySessionNarrativeResult(committed);
    }
    await store.refreshSessionStoryInfo();
    await store.waitForSessionOpeningPresentation(committedContent);
  } catch (error) {
    store.updateMessageById(streamingMessage.id, () => null, true);
    throw error;
  }
}

// ============== 导出 composable ==============
export function useIntroduction() {
  return {
    // 判定
    shouldUseIntroductionStream,
    shouldUseDebugIntroductionStream,
    // 处理函数（导出供 useToonflowStore 调用）
    handleIntroductionDelta,
    handleIntroductionSentence,
    handleIntroductionDone,
    handleIntroductionError,
    // 完整流程
    streamSessionIntroductionPlan,
  };
}