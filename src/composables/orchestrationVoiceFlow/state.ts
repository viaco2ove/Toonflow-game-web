/**
 * 状态模块
 *
 * 职责：管理语音播放相关的 reactive 状态和状态清理函数
 */
import { ref } from "vue";
import type { MessageItem } from "../../types/toonflow";
import { messageUiKey } from "./textUtils";

// ============== 类型定义 ==============
export type VoiceIndicatorPhase = "" | "loading" | "playing";

// ============== Reactive 状态 ==============
/** 当前播放语音的消息 key */
export const runtimeVoiceMessageKey = ref("");
/** 当前播放语音的阶段 */
export const runtimeVoicePhase = ref<VoiceIndicatorPhase>("");
/** 当前播放语音的指示器文本 */
export const runtimeVoiceIndicator = ref(".");
/** 语音指示器定时器 */
let runtimeVoiceIndicatorTimer = 0;

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

export function setRuntimeVoiceIndicator(message: MessageItem | null, phase: VoiceIndicatorPhase) {
  if (!message || !phase) {
    clearRuntimeVoiceIndicator();
    return;
  }
  runtimeVoiceMessageKey.value = messageUiKey(message);
  runtimeVoicePhase.value = phase;
}
