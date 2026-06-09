/**
 * 状态模块
 *
 * 职责：管理语音播放相关的 reactive 状态和状态清理函数
 */
import { ref } from "vue";
import type { MessageItem } from "../../types/toonflow";
import { WebDebugLogUtil } from "../../utils/WebDebugLogUtil";

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

// ============== 指示器阶段调试：记录开始时间和累计时长 ==============
const phaseStartedAt = new Map<VoiceIndicatorPhase, number>();
const phaseAccumMs = new Map<VoiceIndicatorPhase, number>();
const phaseStartCount = new Map<VoiceIndicatorPhase, number>();

function markPhaseStart(phase: VoiceIndicatorPhase) {
  phaseStartedAt.set(phase, performance.now());
  phaseStartCount.set(phase, (phaseStartCount.get(phase) || 0) + 1);
  WebDebugLogUtil.log("[indicator:start]", {
    phase,
    startCount: phaseStartCount.get(phase),
    timestamp: Date.now(),
  });
}

function markPhaseEnd(phase: VoiceIndicatorPhase) {
  const startedAt = phaseStartedAt.get(phase);
  if (startedAt == null) return;
  const elapsed = performance.now() - startedAt;
  phaseStartedAt.delete(phase);
  phaseAccumMs.set(phase, (phaseAccumMs.get(phase) || 0) + elapsed);
  WebDebugLogUtil.log("[indicator:end]", {
    phase,
    elapsedMs: Math.round(elapsed),
    accumMs: Math.round(phaseAccumMs.get(phase) || 0),
    startCount: phaseStartCount.get(phase) || 0,
    timestamp: Date.now(),
  });
}

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
  const prevKey = runtimeVoiceMessageKey.value;
  const prevPhase = runtimeVoicePhase.value;
  // 当前已经是空状态，无需重复打印
  if (!prevKey && !prevPhase) {
    return;
  }
  // 如果当前还有进行中的阶段，结束它
  if (prevPhase) {
    markPhaseEnd(prevPhase);
  }
  runtimeVoiceMessageKey.value = "";
  runtimeVoicePhase.value = "";
  runtimeVoiceIndicator.value = ".";
  if (runtimeVoiceIndicatorTimer) {
    window.clearInterval(runtimeVoiceIndicatorTimer);
    runtimeVoiceIndicatorTimer = 0;
  }
  WebDebugLogUtil.log("[indicator:clear]", {
    prevKey,
    prevPhase,
    timestamp: Date.now(),
  });
}

export function setRuntimeVoiceIndicator(message: MessageItem | null, phase: VoiceIndicatorPhase, computedKey?: string) {
  if (!message || !phase) {
    clearRuntimeVoiceIndicator();
    return;
  }
  const nextKey = computedKey || `${message.id}_${message.createTime}_${message.roleType || ""}`;
  const prevKey = runtimeVoiceMessageKey.value;
  const prevPhase = runtimeVoicePhase.value;
  // 同 key 同 phase，直接静默忽略，避免日志噪音
  if (prevKey === nextKey && prevPhase === phase) {
    return;
  }
  // 如果切换到不同阶段，先结束上一个
  if (prevPhase && prevPhase !== phase) {
    markPhaseEnd(prevPhase);
  }
  runtimeVoiceMessageKey.value = nextKey;
  runtimeVoicePhase.value = phase;
  // 进入新阶段就开始计时
  if (!phaseStartedAt.has(phase)) {
    markPhaseStart(phase);
  }
  WebDebugLogUtil.log("[indicator:set]", {
    phase,
    prevPhase,
    key: nextKey,
    messageId: message.id,
    role: message.role,
    timestamp: Date.now(),
  });
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