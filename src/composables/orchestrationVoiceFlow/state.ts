/**
 * 状态模块
 *
 * 职责：管理语音播放相关的 reactive 状态和状态清理函数
 */
import { ref } from "vue";
import type { MessageItem } from "../../types/toonflow";

// ============== 类型定义 ==============
export type VoiceIndicatorPhase = "" | "streaming" | "loading" | "playing";

// ============== Reactive 状态 ==============
/** 当前播放语音的消息 key */
export const runtimeVoiceMessageKey = ref("");
/** 当前播放语音的阶段 */
export const runtimeVoicePhase = ref<VoiceIndicatorPhase>("");
/** 当前播放语音的指示器文本 */
export const runtimeVoiceIndicator = ref(".");
/** 语音指示器定时器 */
export let runtimeVoiceIndicatorTimer = 0;

// ============== 语音指示器定时器管理 ==============
export function getRuntimeVoiceIndicatorTimer(): number {
  return runtimeVoiceIndicatorTimer;
}

export function setRuntimeVoiceIndicatorTimer(timer: number): void {
  runtimeVoiceIndicatorTimer = timer;
}

export function clearRuntimeVoiceIndicatorTimer(): void {
  if (runtimeVoiceIndicatorTimer) {
    window.clearInterval(runtimeVoiceIndicatorTimer);
    runtimeVoiceIndicatorTimer = 0;
  }
}

// ============== 打字机动画状态 ==============
/** 打字机动画目标文本（累积的完整文本） */
export const typewriterTargetText = ref("");
/** 打字机动画当前显示文本（已显示的部分） */
export const typewriterDisplayText = ref("");
/** 当前正在打字的消息 ID */
export const typewriterMessageId = ref<string | null>(null);
/** 是否正在打字 */
export const isTyping = ref(false);

// ============== 状态清理函数 ==============
export function clearRuntimeVoiceIndicator() {
  runtimeVoiceMessageKey.value = "";
  runtimeVoicePhase.value = "";
  runtimeVoiceIndicator.value = ".";
  if (runtimeVoiceIndicatorTimer) {
    window.clearInterval(runtimeVoiceIndicatorTimer);
    runtimeVoiceIndicatorTimer = 0;
  }
}

export function setRuntimeVoiceIndicator(message: MessageItem | null, phase: VoiceIndicatorPhase, computedKey?: string) {
  if (!message || !phase) {
    clearRuntimeVoiceIndicator();
    return;
  }
  // 默认使用 message.id 拼一个 key（无 sessionId）作为内部表示；
  // UI 渲染时会同时匹配 sessionId-included key 和这个 key，所以这里保持简单。
  // 若调用方提供了 computedKey（建议），则用其作为唯一 key。
  runtimeVoiceMessageKey.value = computedKey || `${message.id}_${message.createTime}_${message.roleType || ""}`;
  runtimeVoicePhase.value = phase;
}

// ============== 打字机动画函数 ==============
let typewriterAnimationFrame: number | null = null;
let typewriterLastCharTime = 0;
const TYPING_SPEED_MS = 30; // 每字符间隔（毫秒）

/**
 * 开始打字机动画
 * @param messageId 消息 ID
 * @param targetText 目标完整文本
 */
export function startTypewriter(messageId: string, targetText: string) {
  // 如果已经在为同一条消息打字，直接更新目标文本
  if (typewriterMessageId.value === messageId && isTyping.value) {
    typewriterTargetText.value = targetText;
    return;
  }

  // 停止之前的打字动画
  stopTypewriter();

  typewriterMessageId.value = messageId;
  typewriterTargetText.value = targetText;
  typewriterDisplayText.value = "";
  isTyping.value = true;
  typewriterLastCharTime = 0;

  // 开始动画循环
  typewriterAnimationFrame = requestAnimationFrame(typewriterTick);
}

/**
 * 打字机动画的每一帧
 */
function typewriterTick(timestamp: number) {
  if (!isTyping.value || !typewriterMessageId.value) {
    return;
  }

  // 检查是否需要添加新字符
  if (typewriterDisplayText.value.length < typewriterTargetText.value.length) {
    // 计算需要添加多少个字符
    const elapsed = timestamp - typewriterLastCharTime;
    if (elapsed >= TYPING_SPEED_MS) {
      const charsToAdd = Math.min(
        1, // 每次只添加一个字符
        typewriterTargetText.value.length - typewriterDisplayText.value.length
      );
      typewriterDisplayText.value += typewriterTargetText.value.slice(
        typewriterDisplayText.value.length,
        typewriterDisplayText.value.length + charsToAdd
      );
      typewriterLastCharTime = timestamp;
    }
  }

  // 检查是否完成
  if (typewriterDisplayText.value.length >= typewriterTargetText.value.length) {
    // 打字完成，保留最终状态
    isTyping.value = false;
    typewriterMessageId.value = null;
    return;
  }

  // 继续下一帧
  typewriterAnimationFrame = requestAnimationFrame(typewriterTick);
}

/**
 * 停止打字机动画
 */
export function stopTypewriter() {
  if (typewriterAnimationFrame !== null) {
    cancelAnimationFrame(typewriterAnimationFrame);
    typewriterAnimationFrame = null;
  }
  isTyping.value = false;
  typewriterMessageId.value = null;
  typewriterTargetText.value = "";
  // 保留当前显示的文本，以便切换时不会丢失
}

/**
 * 获取打字机显示文本（用于渲染）
 */
export function getTypewriterDisplayText(messageId: string): string {
  if (typewriterMessageId.value === messageId && isTyping.value) {
    return typewriterDisplayText.value;
  }
  return ""; // 如果不在打字，返回空字符串
}

/**
 * 检查消息是否正在打字
 */
export function isMessageTyping(messageId: string): boolean {
  return typewriterMessageId.value === messageId && isTyping.value;
}

/**
 * 清除所有打字机状态
 */
export function clearAllTypewriterState() {
  stopTypewriter();
  typewriterDisplayText.value = "";
  typewriterTargetText.value = "";
}