/**
 * 语音编排执行流程 - Orchestration Voice Flow
 *
 * 统一导出所有子模块的功能
 *
 * 模块结构：
 * - state.ts              - Reactive 状态和状态清理
 * - textUtils.ts         - 文本处理工具
 * - voiceBinding.ts      - 语音绑定配置
 * - voiceGenPlay.ts      - 语音生成和播放
 * - messageReveal.ts     - 消息揭示流程
 * - streamlinesSteamGen.ts - 流式台词生成（打字机动画）
 * - prefetchOrchestration.ts - 预取编排
 * - resolveSessionOrchestration.ts - 解析会话编排
 * - story_info.ts        - 故事信息
 * - miniGame.ts          - 小游戏相关
 */

// Re-export all modules
export * from "./state";
export * from "./textUtils";
export * from "./voiceBinding";
export * from "./voiceGenPlay";
export * from "./messageReveal";
export * from "./streamlinesSteamGen";
export * from "./prefetchOrchestration";
export * from "./resolveSessionOrchestration";
export * from "./story_info";
export * from "./miniGame";

// ============== 导出 composable ==============
import { runtimeVoiceMessageKey, runtimeVoicePhase, runtimeVoiceIndicator, runtimeVoiceIndicatorTimer, getRuntimeVoiceIndicatorTimer, setRuntimeVoiceIndicatorTimer, clearRuntimeVoiceIndicatorTimer, clearRuntimeVoiceIndicator, setRuntimeVoiceIndicator, startTypewriter, stopTypewriter, typewriterDisplayText, typewriterMessageId, isTyping, isMessageTyping, getTypewriterDisplayText, clearAllTypewriterState } from "./state";
import { sleep, messageUiKey, latestMessageByKey, messageDisplayContent, sanitizeSpeechText, normalizePlayableSpeechText, speakableUnitCount, splitSpeechSegments, estimatePlaybackTimeoutMs, estimateRevealDelayMs, isDeterministicRuntimeVoiceError } from "./textUtils";
import { narratorVoiceBinding, roleVoiceBinding, findMessageRole, resolveMessageVoiceBinding, resolveFallbackVoiceBinding, runtimeVoiceBindingKey, runtimeVoicePreviewKey } from "./voiceBinding";
import { clearVoiceCaches, ensureRuntimeCloneBinding, warmVoiceBinding, stopRuntimeVoicePlayback, playRuntimeVoiceBlob, playMessageAudio, playMessageAudioWithBinding, replayWithBrowserSpeech, runtimeVoicePreviewCache, runtimeVoicePreviewInflight, runtimeVoiceBlobCache, runtimeVoiceFallbackBindingCache, runtimeVoiceWarmCache } from "./voiceGenPlay";
import { waitForMessageReveal } from "./messageReveal";
import { streamingMessageId, accumulatedText, isStreamDone, isStreaming as streamIsStreaming, isPlaying, currentPlaybackMessageId, handleStreamDelta, handleStreamDone, handleStreamSentence, handleStreamError, startStreaming, endStreaming, createMessagePlaybackState, startMessagePlayback, startSentencePlayback, finishSentencePlayback, isAllSentencesPlayed, isLastSentencePlayed, getMessagePlaybackState, getSentencePlaybackStatus, getSentenceList, endMessagePlayback, clearMessagePlaybackState, clearAllPlaybackStates, getDisplayContent, checkIsTyping } from "./streamlinesSteamGen";
import { clearPendingSessionOrchestrationPrefetch, getPendingOrchestrationPrefetch, prefetchNextSessionOrchestration, canUsePrefetchedOrchestration, consumePrefetchedOrchestration } from "./prefetchOrchestration";
import { resolveSessionOrchestration, resolveMinigameOrchestration, normalizeSessionOrchestrationResult } from "./resolveSessionOrchestration";
import { getStoryInfo, canPlayerSpeak as storyCanPlayerSpeak, getRuntimeMessageStatus, getLatestMessage, getRuntimeConversationId } from "./story_info";
import { hasActiveMiniGame, miniGameVoiceWaitEnd, isMiniGameMessage, shouldMiniGameContinue, waitMiniGameExtraTime, getMiniGameNextStatus, getMiniGameVoiceConfig } from "./miniGame";

export function useOrchestrationVoiceFlow() {
  return {
    // 状态
    runtimeVoiceMessageKey,
    runtimeVoicePhase,
    runtimeVoiceIndicator,
    runtimeVoiceIndicatorTimer: runtimeVoiceIndicatorTimer,
    getRuntimeVoiceIndicatorTimer,
    setRuntimeVoiceIndicatorTimer,
    clearRuntimeVoiceIndicatorTimer,
    runtimeVoicePreviewCache,
    runtimeVoicePreviewInflight,
    runtimeVoiceBlobCache,
    runtimeVoiceFallbackBindingCache,
    runtimeVoiceWarmCache,
    // 打字机动画状态
    typewriterDisplayText,
    typewriterMessageId,
    isTyping,
    isMessageTyping,
    // 流式状态
    streamingMessageId,
    accumulatedText,
    isStreamDone,
    isStreaming: streamIsStreaming,
    isPlaying,
    currentPlaybackMessageId,
    // 小游戏状态
    hasActiveMiniGame,
    miniGameVoiceWaitEnd,
    // 缓存清理
    clearVoiceCaches,
    clearRuntimeVoiceIndicator,
    clearAllTypewriterState,
    clearPendingSessionOrchestrationPrefetch,
    // 核心函数
    playMessageAudio,
    playMessageAudioWithBinding,
    playRuntimeVoiceBlob,
    stopRuntimeVoicePlayback,
    setRuntimeVoiceIndicator,
    waitForMessageReveal,
    // 打字机动画函数
    startTypewriter,
    stopTypewriter,
    getTypewriterDisplayText,
    // 流式处理函数
    handleStreamDelta,
    handleStreamDone,
    handleStreamSentence,
    handleStreamError,
    startStreaming,
    endStreaming,
    getDisplayContent,
    checkIsTyping,
    // 播放状态管理
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
    // 编排函数
    prefetchNextSessionOrchestration,
    canUsePrefetchedOrchestration,
    consumePrefetchedOrchestration,
    resolveSessionOrchestration,
    resolveMinigameOrchestration,
    normalizeSessionOrchestrationResult,
    // 故事信息函数
    getStoryInfo,
    canPlayerSpeak: storyCanPlayerSpeak,
    getRuntimeMessageStatus,
    getLatestMessage,
    getRuntimeConversationId,
    // 小游戏函数
    isMiniGameMessage,
    shouldMiniGameContinue,
    waitMiniGameExtraTime,
    getMiniGameNextStatus,
    getMiniGameVoiceConfig,
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