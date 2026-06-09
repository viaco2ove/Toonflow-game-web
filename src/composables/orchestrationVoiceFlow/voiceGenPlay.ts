/**
 * 语音生成播放模块
 *
 * 职责：
 * - 语音绑定生成 (ensureRuntimeCloneBinding)
 * - 语音 URL 解析 (resolveRuntimeVoiceUrl)
 * - 语音 Blob 获取 (fetchRuntimeVoiceBlob)
 * - 语音播放控制 (playRuntimeVoiceBlob, stopRuntimeVoicePlayback)
 * - 消息语音播放 (playMessageAudio, playMessageAudioWithBinding)
 * - 浏览器 Speech API 降级 (replayWithBrowserSpeech)
 *
 * 语音生成：
 * 文本完整生成(NDJSON流完) → 拆分句子 → 逐句串行TTS → 逐句播放语音
 * 当前台词，当前台词是否已完全生成，
 * 拆分句子arr ,每个拆分句的状态。逐句串行TTS。
 * 判断是否把台词最后一个拆分句 播放完毕！！！
 * 生成和播放过程中：。-》. -》。
 * 尾部圆点指示器	✅ 有（金黄色脉冲点 + loading 时圆点数切换）
 *
 * 重听：
 * pc web 右键台词 or 手机长按台词。 弹出的菜单里有给重听按钮
 *
 */
import { computed } from "vue";
import { useToonflowStore } from "../useToonflowStore";
import type { MessageItem, VoiceBindingDraft } from "../../types/toonflow";
import { WebDebugLogUtil } from "../../utils/WebDebugLogUtil";
import {
  sleep,
  messageUiKey,
  messageDisplayContent,
  sanitizeSpeechText,
  normalizePlayableSpeechText,
  speakableUnitCount,
  isDeterministicRuntimeVoiceError,
  estimatePlaybackTimeoutMs,
  splitSpeechSegments,
  setLimitedCacheValue,
} from "./textUtils";
import {
  resolveMessageVoiceBinding,
  narratorVoiceBinding,
  resolveFallbackVoiceBinding,
  runtimeVoiceBindingKey,
  runtimeVoicePreviewKey,
} from "./voiceBinding";
import {
  runtimeVoiceMessageKey,
  runtimeVoicePhase,
  clearRuntimeVoiceIndicator,
  setRuntimeVoiceIndicator,
} from "./state";

// ============== 常量 ==============
const RUNTIME_FAST_PREVIEW_FORMAT = "mp3";
const RUNTIME_FAST_PREVIEW_SAMPLE_RATE = 16000;

// ============== Store 延迟获取 ==============
function getStore() {
  return useToonflowStore();
}

// ============== 缓存变量 ==============
/** 运行时语音播放器实例 */
let runtimeVoicePlayer: HTMLAudioElement | null = null;
/** 运行时语音 Blob URL */
let runtimeVoiceObjectUrl = "";
/** 运行时语音播放 Promise resolve 函数 */
let runtimeVoiceResolve: ((played: boolean) => void) | null = null;
/** 运行时语音请求 ID（用于打断控制） */
let runtimeVoiceRequestId = 0;
/** 运行时语音预览 URL 缓存 */
export const runtimeVoicePreviewCache = new Map<string, string>();
/** 运行时语音预览请求去重 */
export const runtimeVoicePreviewInflight = new Map<string, Promise<string>>();
/** 运行时语音 Blob 缓存 */
export const runtimeVoiceBlobCache = new Map<string, Blob>();
/** 运行时语音降级绑定缓存 */
export const runtimeVoiceFallbackBindingCache = new Map<string, VoiceBindingDraft>();
/** 运行时语音克隆绑定缓存 */
export const runtimeVoiceCloneBindingCache = new Map<string, VoiceBindingDraft>();
/** 运行时语音克隆请求去重 */
export const runtimeVoiceCloneInflight = new Map<string, Promise<VoiceBindingDraft>>();
/** 运行时语音预热缓存（防止重复预热） */
export const runtimeVoiceWarmCache = new Set<string>();

// ============== 计算属性 ==============
const currentWorld = computed(() => getStore().state.sessionDetail?.world || null);

// ============== 状态清理函数 ==============
export function clearVoiceCaches() {
  runtimeVoicePreviewCache.clear();
  runtimeVoicePreviewInflight.clear();
  runtimeVoiceBlobCache.clear();
  runtimeVoiceFallbackBindingCache.clear();
  runtimeVoiceWarmCache.clear();
}

// ============== 辅助函数 ==============
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer = 0;
  const timeout = new Promise<T>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(label)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

// ============== 语音绑定生成 ==============
/**
 * 调试和正式游玩统一优先使用 clone 通道。
 * 如果当前绑定还没有参考音频文件，就先按原模式生成一个稳定文件，再切回 clone。
 */
export async function ensureRuntimeCloneBinding(binding: VoiceBindingDraft): Promise<VoiceBindingDraft> {
  if (binding.mode === "clone" && binding.referenceAudioPath) {
    return binding;
  }
  if (binding.referenceAudioPath) {
    return {
      ...binding,
      mode: "clone",
    };
  }
  const cacheKey = runtimeVoiceBindingKey(binding);
  const cached = runtimeVoiceCloneBindingCache.get(cacheKey);
  if (cached) return cached;
  const inflight = runtimeVoiceCloneInflight.get(cacheKey);
  if (inflight) return inflight;
  const task = getStore().generateVoiceBinding(
    binding.configId,
    binding.mode,
    binding.presetId,
    binding.referenceAudioPath,
    binding.referenceText,
    binding.promptText,
    binding.mixVoices || [],
    { roleId: binding.roleId || "" },
  )
    .then((generated) => {
      if (!generated.audioPath) {
        throw new Error("未生成可复用的参考音频");
      }
      const cloneBinding: VoiceBindingDraft = {
        ...binding,
        mode: "clone",
        referenceAudioPath: generated.audioPath,
        referenceAudioName: generated.audioName || binding.referenceAudioName || "",
        referenceText: generated.referenceText || binding.referenceText || "",
      };
      setLimitedCacheValue(runtimeVoiceCloneBindingCache, cacheKey, cloneBinding);
      return cloneBinding;
    })
    .finally(() => {
      runtimeVoiceCloneInflight.delete(cacheKey);
    });
  runtimeVoiceCloneInflight.set(cacheKey, task);
  return task;
}

// ============== 语音 URL 解析 ==============
export async function resolveRuntimeVoiceUrl(binding: VoiceBindingDraft, text: string, source: "common" | "warmVoiceBinding" = "common"): Promise<string> {
  if (WebDebugLogUtil.isEnabled()) {
    console.log("resolveRuntimeVoiceUrl");
  }

  const playableBinding = await ensureRuntimeCloneBinding(binding);
  const cacheKey = runtimeVoicePreviewKey(playableBinding, text);
  const cached = runtimeVoicePreviewCache.get(cacheKey);
  WebDebugLogUtil.log("resolveRuntimeVoiceUrl cached", cached);
  if (cached) return cached;
  const inflight = runtimeVoicePreviewInflight.get(cacheKey);
  WebDebugLogUtil.log("resolveRuntimeVoiceUrl inflight", inflight);
  if (inflight) return inflight;

  const task = withTimeout(
    getStore().streamVoice(
      playableBinding.configId,
      text,
      playableBinding.mode,
      playableBinding.presetId,
      playableBinding.referenceAudioPath,
      playableBinding.referenceText,
      playableBinding.promptText,
      playableBinding.mixVoices || [],
      {
        format: RUNTIME_FAST_PREVIEW_FORMAT,
        sampleRate: RUNTIME_FAST_PREVIEW_SAMPLE_RATE,
        roleId: playableBinding.roleId || "",
      },
    ),
    15000,
    "语音生成超时",
  )
    .then((audioUrl) => {
      WebDebugLogUtil.log("resolveRuntimeVoiceUrl", { audioUrl });
      if (!audioUrl) {
        throw new Error("未返回试听音频");
      }
      WebDebugLogUtil.log("resolveRuntimeVoiceUrl", { activeMiniGame: getStore().hasActiveMiniGameInCurrentSession() });
      // 判断 roleType 打 tag（只在小游戏模式中打印）
      if (getStore().hasActiveMiniGameInCurrentSession()) {
        const isNarratorVoice = !playableBinding.roleId || playableBinding.roleId === "narrator" || playableBinding.roleId === "旁白";
        const isEnemyVoice = playableBinding.roleId && (playableBinding.roleId.includes("enemy") || playableBinding.roleId.includes("敌方"));
        const voiceTag = isNarratorVoice
          ? "[aiGame][miniGame] 旁白播报-台词-语音播放-预热"
          : (isEnemyVoice
            ? "[aiGame][miniGame] 敌方回合-语音播放-预热"
            : "[aiGame][miniGame] 陪练角色回合-语音播放-预热");
        WebDebugLogUtil.log(voiceTag, { roleId: playableBinding.roleId, text: text.slice(0, 60), source });
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

// ============== 语音预热 ==============
export async function warmVoiceBinding(binding: VoiceBindingDraft) {
  if (binding.mode !== "text") return;
  const bindingKey = runtimeVoiceBindingKey(binding);
  if (runtimeVoiceWarmCache.has(bindingKey)) return;
  runtimeVoiceWarmCache.add(bindingKey);
  try {
    await resolveRuntimeVoiceUrl(binding, "恭喜，已成功复刻或生成了属于角色的声音！", "warmVoiceBinding");
  } catch {
    // 保持静默，预热失败不影响正式播放
  }
}

// ============== 语音 Blob 获取 ==============
export async function fetchRuntimeVoiceBlob(audioUrl: string): Promise<Blob> {
  const cached = runtimeVoiceBlobCache.get(audioUrl);
  if (cached) return cached;
  const response = await withTimeout(fetch(audioUrl), 10000, "音频下载超时");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  setLimitedCacheValue(runtimeVoiceBlobCache, audioUrl, blob);
  return blob;
}

// ============== 语音播放控制 ==============
/**
 * 停止并清理当前语音播放
 */
export function stopRuntimeVoicePlayback() {
  WebDebugLogUtil.log("[voice打断] stopRuntimeVoicePlayback 被调用", {
    调用栈: new Error().stack?.split("\n").slice(1, 5).map(s => s.trim()),
    runtimeVoiceRequestId: runtimeVoiceRequestId + 1,
    当前播放的消息key: runtimeVoiceMessageKey.value,
    当前播放阶段: runtimeVoicePhase.value,
  });
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

/**
 * 播放语音 Blob
 */
export async function playRuntimeVoiceBlob(
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
  WebDebugLogUtil.log("[aiGame][miniGame] playRuntimeVoiceBlob 准备播放", {
    waitForCompletion,
    speakable: speakable.slice(0, 60),
    blobSize: blob.size,
    blobType: blob.type,
    activeMiniGame: getStore().hasActiveMiniGameInCurrentSession(),
  });
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
      if (manual) getStore().state.menuVisibleHint = hint;
      resolve(ok);
    };
    player.onplay = () => {
      WebDebugLogUtil.log("[aiGame][miniGame] playRuntimeVoiceBlob 真正开始播放", {
        waitForCompletion,
        currentTime: player.currentTime,
        duration: Number.isFinite(player.duration) ? player.duration : -1,
        speakable: speakable.slice(0, 60),
      });
      onPlay?.();
      if (manual) getStore().state.menuVisibleHint = "正在播放试听";
      if (!waitForCompletion) {
        finalize(true, "正在播放试听");
      }
    };
    player.onended = () => {
      WebDebugLogUtil.log("[aiGame][miniGame] playRuntimeVoiceBlob 播放结束", {
        currentTime: player.currentTime,
        speakable: speakable.slice(0, 60),
      });
      finalize(true, "朗读完成");
    };
    player.onerror = () => {
      WebDebugLogUtil.log("[aiGame][miniGame] playRuntimeVoiceBlob 播放错误", {
        currentTime: player.currentTime,
        speakable: speakable.slice(0, 60),
      });
      finalize(false, "朗读失败");
    };
    void player.play().catch((error) => {
      WebDebugLogUtil.log("[aiGame][miniGame] playRuntimeVoiceBlob play() rejected", {
        error: String((error as Error)?.message || error || ""),
        speakable: speakable.slice(0, 60),
      });
      finalize(false, "朗读失败");
    });
  });
  return completed;
}

// ============== 浏览器语音降级 ==============
export async function replayWithBrowserSpeech(content: string, waitForCompletion = false): Promise<boolean> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    getStore().state.menuVisibleHint = "当前浏览器不支持朗读";
    return false;
  }
  window.speechSynthesis.cancel();
  const sanitized = sanitizeSpeechText(content);
  if (!sanitized) {
    getStore().state.menuVisibleHint = "这条内容没有可朗读文本";
    return false;
  }
  const utterance = new SpeechSynthesisUtterance(sanitized);
  utterance.lang = "zh-CN";
  utterance.rate = 1;
  utterance.pitch = 1;
  getStore().state.menuVisibleHint = "正在朗读";
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const timeoutMs = waitForCompletion ? estimatePlaybackTimeoutMs(sanitized) : 5000;
    const timer = window.setTimeout(() => finalize(false, "朗读超时"), timeoutMs);
    const finalize = (ok: boolean, hint: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      getStore().state.menuVisibleHint = hint;
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

// ============== 语音播放核心函数 ==============
/**
 * 使用指定绑定播放消息语音（多段串行）
 */
export async function playMessageAudioWithBinding(
  message: MessageItem,
  binding: VoiceBindingDraft,
  speakable: string,
  manual: boolean,
  waitForCompletion: boolean,
): Promise<boolean> {
  WebDebugLogUtil.log("[voice打断] playMessageAudioWithBinding 开始", {
    消息id: message.id,
    消息角色: message.role,
    消息内容: messageDisplayContent(message)?.slice(0, 40),
    waitForCompletion,
    当前播放消息key: runtimeVoiceMessageKey.value,
  });
  stopRuntimeVoicePlayback();
  const requestId = runtimeVoiceRequestId;
  if (manual) {
    getStore().state.menuVisibleHint = "正在生成语音";
  }
  const segments = splitSpeechSegments(speakable);
  if (!segments.length) return false;
  setRuntimeVoiceIndicator(message, "loading", messageUiKey(message));
  for (const segment of segments) {
    let segmentPlayed = false;
    let lastError: unknown = null;
    const previewKey = runtimeVoicePreviewKey(binding, segment);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let shouldRetry = true;
      if (requestId !== runtimeVoiceRequestId) return false;
      try {
        setRuntimeVoiceIndicator(message, "loading", messageUiKey(message));
        const audioUrl = await resolveRuntimeVoiceUrl(binding, segment);
        if (WebDebugLogUtil.isEnabled()) {
          console.log(`[debug:fetchRuntimeVoiceBlob] audioUrl=${audioUrl} requestId=${requestId} runtimeVoiceRequestId=${runtimeVoiceRequestId}`);
        }
        if (!audioUrl || requestId !== runtimeVoiceRequestId) return false;
        const blob = await fetchRuntimeVoiceBlob(audioUrl);
        segmentPlayed = await playRuntimeVoiceBlob(blob, manual, waitForCompletion, segment, () => {
          setRuntimeVoiceIndicator(message, "playing", messageUiKey(message));
        });
        if (getStore().hasActiveMiniGameInCurrentSession()) {
          WebDebugLogUtil.log("[aiGame][miniGame] 台词-语音播放-playRuntimeVoiceBlob", segmentPlayed);
        } else {
          WebDebugLogUtil.log("[aiGame] 台词-语音播放-playRuntimeVoiceBlob", segmentPlayed);
        }
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

/**
 * 播放消息语音（包含降级逻辑）
 */
export async function playMessageAudio(
  message: MessageItem,
  manual = false,
  waitForCompletion = false,
  overrideContent?: string,
): Promise<boolean> {
  WebDebugLogUtil.log("[voice时序] playMessageAudio 入口", {
    消息id: message.id,
    消息角色: message.role,
    消息内容: (overrideContent ?? messageDisplayContent(message))?.slice(0, 40),
    manual,
    waitForCompletion,
  });
  const playableContent = overrideContent ?? messageDisplayContent(message);
  const speakable = normalizePlayableSpeechText(playableContent);
  if (!speakable) {
    if (manual) getStore().state.menuVisibleHint = "这条内容没有可朗读文本";
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
      && isDeterministicRuntimeVoiceError(error)
    ) {
      const fallbackBinding = resolveFallbackVoiceBinding(message, binding);
      if (fallbackBinding && runtimeVoiceBindingKey(fallbackBinding) !== bindingKey) {
        setLimitedCacheValue(runtimeVoiceFallbackBindingCache, bindingKey, fallbackBinding);
        try {
          if (manual) {
            getStore().state.menuVisibleHint = "当前绑定音色不可用，正在切换兼容音色";
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
      getStore().state.notice = "自动语音失败，已跳过，可点重听重试";
    }
    if (manual) {
      getStore().state.menuVisibleHint = `朗读失败: ${(finalError as any)?.message || "未知错误"}`;
    }
    return false;
  } finally {
    if (runtimeVoiceMessageKey.value === messageUiKey(message)) {
      clearRuntimeVoiceIndicator();
    }
  }
}