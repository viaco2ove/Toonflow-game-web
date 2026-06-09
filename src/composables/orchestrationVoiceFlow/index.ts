/**
 * 语音编排执行流程 - Orchestration Voice Flow
 *
 * 统一导出所有子模块的功能
 *
 * 模块结构：
 * - state.ts          - Reactive 状态和状态清理
 * - textUtils.ts      - 文本处理工具
 * - voiceBinding.ts   - 语音绑定配置
 * - voiceGenPlay.ts - 语音生成和播放
 * - messageReveal.ts  - 消息揭示流程
 */

// Re-export all modules
export * from "./state";
export * from "./textUtils";
export * from "./voiceBinding";
export * from "./voiceGenPlay";
export * from "./messageReveal";

// ============== 导出 composable ==============
import { runtimeVoiceMessageKey, runtimeVoicePhase, runtimeVoiceIndicator, clearRuntimeVoiceIndicator, setRuntimeVoiceIndicator } from "./state";
import { sleep, messageUiKey, latestMessageByKey, messageDisplayContent, sanitizeSpeechText, normalizePlayableSpeechText, speakableUnitCount, splitSpeechSegments, estimatePlaybackTimeoutMs, estimateRevealDelayMs, isDeterministicRuntimeVoiceError } from "./textUtils";
import { narratorVoiceBinding, roleVoiceBinding, findMessageRole, resolveMessageVoiceBinding, resolveFallbackVoiceBinding, runtimeVoiceBindingKey, runtimeVoicePreviewKey } from "./voiceBinding";
import { clearVoiceCaches, ensureRuntimeCloneBinding, warmVoiceBinding, stopRuntimeVoicePlayback, playRuntimeVoiceBlob, playMessageAudio, playMessageAudioWithBinding, replayWithBrowserSpeech } from "./voiceGenPlay";
import { waitForMessageReveal } from "./messageReveal";

export function useOrchestrationVoiceFlow() {
  return {
    // 状态
    runtimeVoiceMessageKey,
    runtimeVoicePhase,
    runtimeVoiceIndicator,
    // 缓存清理
    clearVoiceCaches,
    clearRuntimeVoiceIndicator,
    // 核心函数
    playMessageAudio,
    playMessageAudioWithBinding,
    playRuntimeVoiceBlob,
    stopRuntimeVoicePlayback,
    setRuntimeVoiceIndicator,
    waitForMessageReveal,
    // 工具函数
    sleep,
    messageUiKey,
    latestMessageByKey,
    messageDisplayContent,
    // 语音绑定
    resolveMessageVoiceBinding,
    narratorVoiceBinding,
    roleVoiceBinding,
    findMessageRole,
    resolveFallbackVoiceBinding,
    warmVoiceBinding,
    ensureRuntimeCloneBinding,
    // 缓存键
    runtimeVoiceBindingKey,
    runtimeVoicePreviewKey,
    // 文本处理
    sanitizeSpeechText,
    normalizePlayableSpeechText,
    speakableUnitCount,
    splitSpeechSegments,
    estimatePlaybackTimeoutMs,
    estimateRevealDelayMs,
    // 错误判断
    isDeterministicRuntimeVoiceError,
  };
}