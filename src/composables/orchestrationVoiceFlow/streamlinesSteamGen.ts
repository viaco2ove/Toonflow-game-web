/**
 * 流式台词生成模块
 *
 * 职责：
 * - 处理 /game/streamlines 接口的流式数据
 * - 实现打字机动画效果
 * - 管理流式状态
 *
 * ### 流式接口：
 * /game/streamlines
 * /game/streamlines/introduction
 *
 * ## 效果
 * 有累积，有渐显 ✅
 * -实时接收：前端用 ReadableStream 读取，能边收边累积 delta 数据
 * - 逐字追加：使用 requestAnimationFrame 实现打字机效果，逐字追加显示
 * - 打字机光标：CSS 闪烁光标效果
 *
 * ### 已解决的问题：
 * ✅ 直接覆盖 → 改为逐字追加显示（通过 typewriterDisplayText）
 * ✅ 无打字机动画 → 添加 requestAnimationFrame 逐字渲染（startTypewriter）
 * ✅ 无光标闪烁 → 添加 CSS 闪烁光标效果（.typing-cursor）
 *
 * 记录是否整个台词都已经生成完毕，是否已经播放语音完毕。
 * 生成过程中：
 * 加载中效果：。-》. -》。
 * 尾部圆点指示器	✅ 有（金黄色脉冲点 + loading 时圆点数切换）
 *
 * ## 流程
 * 台词开始：首先加载台词前 先出现“。。。”
 * 加载过程：流式逐字追加显示
 * 加载完成：马上显示 语音生成中效果，同时进行预编排
 * voiceGenPlay.ts 负责语音生成中效果
 * 语音播放中：马上显示语音播放中效果
 * voiceGenPlay.ts 显示播放中效果
 * 全部拆分句都播放完毕。然后进行下一轮的正式编排（resolveSessionOrchestration）
 *
 */
import { ref, computed } from "vue";
import { useToonflowStore } from "../useToonflowStore";
import { WebDebugLogUtil } from "../../utils/WebDebugLogUtil";
import {
  startTypewriter,
  stopTypewriter,
  isMessageTyping as checkIsMessageTyping,
  getTypewriterDisplayText,
  clearAllTypewriterState,
  typewriterDisplayText,
  typewriterMessageId,
  isTyping,
} from "./state";

// ============== Store 延迟获取 ==============
function getStore() {
  return useToonflowStore();
}

// ============== 流式状态管理 ==============
/** 当前正在流式生成的消息 ID */
export const streamingMessageId = ref<string | null>(null);
/** 累积的完整文本（用于语音播放） */
export const accumulatedText = ref("");
/** 流式是否完成 */
export const isStreamDone = ref(false);

// ============== 播放状态追踪 ==============
/** 句子播放状态 */
export type SentencePlayStatus = "pending" | "playing" | "played" | "failed";
/** 句子播放记录 */
export interface SentencePlaybackRecord {
  sentence: string;
  status: SentencePlayStatus;
  playedAt?: number;
  error?: string;
}
/** 消息播放状态 */
export interface MessagePlaybackState {
  messageId: string;
  phase: "streaming" | "generated" | "playing" | "played" | "failed";
  sentences: SentencePlaybackRecord[];
  playedCount: number;
  lastSentencePlayed: boolean;
  updatedAt: number;
}
/** 消息播放状态映射表 */
const messagePlaybackStates = new Map<string, MessagePlaybackState>();
/** 当前正在播放的消息 ID */
export const currentPlaybackMessageId = ref<string | null>(null);

// ============== 计算属性 ==============
/** 是否正在流式生成 */
export const isStreaming = computed(() => streamingMessageId.value !== null && !isStreamDone.value);
/** 是否正在播放 */
export const isPlaying = computed(() => currentPlaybackMessageId.value !== null);

// ============== 流式处理函数 ==============
/**
 * 处理流式 delta 事件（逐字追加）
 */
export function handleStreamDelta(messageId: string, deltaText: string) {
  if (!deltaText) return;

  // 更新累积文本（完整文本，用于后续处理）
  accumulatedText.value += deltaText;

  // 启动或更新打字机动画
  startTypewriter(messageId, accumulatedText.value);

  WebDebugLogUtil.log("[typewriter] delta", {
    messageId,
    deltaText,
    accumulatedSoFar: accumulatedText.value,
    totalLength: accumulatedText.value.length,
    timestamp: Date.now(),
  });
}

/**
 * 处理流式完成事件
 */
export function handleStreamDone(messageId: string, finalContent: string) {
  isStreamDone.value = true;

  // 确保打字机显示完整文本
  if (accumulatedText.value !== finalContent) {
    accumulatedText.value = finalContent;
    startTypewriter(messageId, finalContent);
  }

  // 等待打字完成（或直接显示完整内容）
  // 如果打字还在进行，会在下一帧完成时自然停止
  WebDebugLogUtil.log("[typewriter] done", {
    messageId,
    finalLength: finalContent.length,
  });
}

/**
 * 处理流式句子事件（用于语音播放）
 */
export function handleStreamSentence(sentence: string, overrideMessageKey?: string): number {
  const messageId = overrideMessageKey || streamingMessageId.value;
  if (!messageId || !sentence) return -1;

  // 获取或创建消息播放状态
  let state = messagePlaybackStates.get(messageId);
  if (!state) {
    state = createMessagePlaybackState(messageId);
    messagePlaybackStates.set(messageId, state);
  }

  // 检查是否已存在该句子
  const existingIndex = state.sentences.findIndex(s => s.sentence === sentence);
  if (existingIndex >= 0) {
    return existingIndex;
  }

  // 添加新句子
  state.sentences.push({
    sentence,
    status: "pending",
  });
  state.updatedAt = Date.now();

  WebDebugLogUtil.log("[typewriter] sentence added", {
    messageId,
    sentence,
    sentenceLength: sentence.length,
    totalSentences: state.sentences.length,
    sentencesSnapshot: state.sentences.map((s, idx) => ({
      序号: idx + 1,
      内容: s.sentence,
      状态: s.status,
    })),
    timestamp: Date.now(),
  });

  return state.sentences.length - 1;
}

// ============== 播放状态管理函数 ==============
/**
 * 创建消息播放状态
 */
export function createMessagePlaybackState(messageId: string): MessagePlaybackState {
  return {
    messageId,
    phase: "streaming",
    sentences: [],
    playedCount: 0,
    lastSentencePlayed: false,
    updatedAt: Date.now(),
  };
}

/**
 * 开始播放消息
 */
export function startMessagePlayback(messageId: string) {
  currentPlaybackMessageId.value = messageId;
  let state = messagePlaybackStates.get(messageId);
  if (!state) {
    state = createMessagePlaybackState(messageId);
    messagePlaybackStates.set(messageId, state);
  }
  state.phase = "playing";
  state.updatedAt = Date.now();
  WebDebugLogUtil.log("[playback] startMessagePlayback", { messageId, sentencesCount: state.sentences.length });
}

/**
 * 开始播放指定句子
 */
export function startSentencePlayback(messageId: string, sentenceIndex: number): boolean {
  const state = messagePlaybackStates.get(messageId);
  if (!state || sentenceIndex < 0 || sentenceIndex >= state.sentences.length) return false;
  state.sentences[sentenceIndex].status = "playing";
  state.updatedAt = Date.now();
  return true;
}

/**
 * 标记句子播放完成
 */
export function finishSentencePlayback(messageId: string, sentenceIndex: number, success: boolean, error?: string): boolean {
  const state = messagePlaybackStates.get(messageId);
  if (!state || sentenceIndex < 0 || sentenceIndex >= state.sentences.length) return false;

  const sentence = state.sentences[sentenceIndex];
  sentence.status = success ? "played" : "failed";
  sentence.playedAt = Date.now();
  if (error) sentence.error = error;

  state.playedCount = state.sentences.filter(s => s.status === "played").length;
  state.lastSentencePlayed = sentenceIndex === state.sentences.length - 1 && success;
  state.updatedAt = Date.now();

  WebDebugLogUtil.log("[playback] finishSentencePlayback", {
    messageId, sentenceIndex, success,
    playedCount: state.playedCount,
    totalSentences: state.sentences.length,
    lastSentencePlayed: state.lastSentencePlayed,
  });

  return true;
}

/**
 * 检查所有句子是否都已播放完成
 */
export function isAllSentencesPlayed(messageId: string): boolean {
  const state = messagePlaybackStates.get(messageId);
  if (!state) return false;
  return state.sentences.length > 0 && state.sentences.every(s => s.status === "played");
}

/**
 * 检查最后一个句子是否播放完成
 */
export function isLastSentencePlayed(messageId: string): boolean {
  const state = messagePlaybackStates.get(messageId);
  return state?.lastSentencePlayed ?? false;
}

/**
 * 获取消息播放状态
 */
export function getMessagePlaybackState(messageId: string): MessagePlaybackState | null {
  return messagePlaybackStates.get(messageId) || null;
}

/**
 * 获取句子播放状态
 */
export function getSentencePlaybackStatus(messageId: string, sentenceIndex: number): SentencePlayStatus | null {
  const state = messagePlaybackStates.get(messageId);
  if (!state || sentenceIndex < 0 || sentenceIndex >= state.sentences.length) return null;
  return state.sentences[sentenceIndex].status;
}

/**
 * 获取句子列表
 */
export function getSentenceList(messageId: string): SentencePlaybackRecord[] {
  return messagePlaybackStates.get(messageId)?.sentences ?? [];
}

/**
 * 结束消息播放
 */
export function endMessagePlayback(messageId: string) {
  const state = messagePlaybackStates.get(messageId);
  if (state) {
    state.phase = isAllSentencesPlayed(messageId) ? "played" : "failed";
    state.updatedAt = Date.now();
  }
  if (currentPlaybackMessageId.value === messageId) {
    currentPlaybackMessageId.value = null;
  }
}

/**
 * 清理指定消息的播放状态
 */
export function clearMessagePlaybackState(messageId: string) {
  messagePlaybackStates.delete(messageId);
  if (currentPlaybackMessageId.value === messageId) {
    currentPlaybackMessageId.value = null;
  }
}

/**
 * 清理所有播放状态
 */
export function clearAllPlaybackStates() {
  messagePlaybackStates.clear();
  currentPlaybackMessageId.value = null;
}

/**
 * 处理流式错误事件
 */
export function handleStreamError(errorMessage: string) {
  stopTypewriter();
  WebDebugLogUtil.log("[typewriter] error", { error: errorMessage });
}

/**
 * 开始新的流式会话
 */
export function startStreaming(messageId: string) {
  // 清理之前的状态
  clearAllTypewriterState();

  streamingMessageId.value = messageId;
  accumulatedText.value = "";
  isStreamDone.value = false;
}

/**
 * 结束流式会话
 */
export function endStreaming() {
  streamingMessageId.value = null;
  isStreamDone.value = false;
}

/**
 * 获取消息的显示内容（打字机效果）
 * @param messageId 消息 ID
 * @param content 原始内容（累积的完整文本）
 * @returns 返回打字机显示的文本
 */
export function getDisplayContent(messageId: string, content: string): string {
  // 如果正在为这条消息打字，返回打字机显示的文本
  if (typewriterMessageId.value === messageId && isTyping.value) {
    return typewriterDisplayText.value;
  }
  // 否则返回原始内容
  return content;
}

/**
 * 检查消息是否正在打字
 */
export function checkIsTyping(messageId: string): boolean {
  return typewriterMessageId.value === messageId && isTyping.value;
}

// ============== 导出 composable ==============
export function useStreamlinesSteamGen() {
  return {
    // 状态
    streamingMessageId,
    accumulatedText,
    isStreamDone,
    isStreaming,
    isPlaying,
    currentPlaybackMessageId,
    isTyping,
    typewriterDisplayText,
    typewriterMessageId,
    // 流式处理
    handleStreamDelta,
    handleStreamDone,
    handleStreamSentence,
    handleStreamError,
    startStreaming,
    endStreaming,
    // 播放状态
    createMessagePlaybackState,
    startMessagePlayback,
    startSentencePlayback,
    finishSentencePlayback,
    isAllSentencesPlayed,
    isLastSentencePlayed,
    getMessagePlaybackState,
    getSentencePlaybackStatus,
    getSentenceList,
    endMessagePlayback,
    clearMessagePlaybackState,
    clearAllPlaybackStates,
    // 打字机
    getDisplayContent,
    checkIsTyping,
    startTypewriter,
    stopTypewriter,
    clearAllTypewriterState,
  };
}