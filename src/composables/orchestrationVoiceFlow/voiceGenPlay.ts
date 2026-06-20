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

  console.log("[voice lifecycle] ⑥ 开始调用 streamVoice TTS API", {
    mode: playableBinding.mode,
    presetId: playableBinding.presetId,
    configId: playableBinding.configId,
    textLength: text.length,
    textPreview: text.slice(0, 60),
  });
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
    60000,
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
  console.log("[voice lifecycle] ⑦ 拉取音频 audioProxy", { audioUrl });
  console.log("[voiceGenPlay] fetchRuntimeVoiceBlob start", { audioUrl });
  const cached = runtimeVoiceBlobCache.get(audioUrl);
  if (cached) {
    console.log("[voiceGenPlay] fetchRuntimeVoiceBlob cache hit", {
      audioUrl,
      blobSize: cached.size,
      blobType: cached.type,
    });
    return cached;
  }
  let response: Response;
  try {
    response = await withTimeout(fetch(audioUrl), 10000, "音频下载超时");
  } catch (err) {
    console.error("[voiceGenPlay] fetchRuntimeVoiceBlob fetch failed", {
      audioUrl,
      error: String((err as Error)?.message || err),
    });
    throw err;
  }
  console.log("[voiceGenPlay] fetchRuntimeVoiceBlob response", {
    audioUrl,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    contentLength: response.headers.get("content-length"),
    xAudioProxyDebug: response.headers.get("x-audioproxy-debug"),
  });
  if (!response.ok) {
    console.error("[voiceGenPlay] fetchRuntimeVoiceBlob not ok", {
      audioUrl,
      status: response.status,
    });
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  console.log("[voiceGenPlay] fetchRuntimeVoiceBlob blob", {
    audioUrl,
    blobSize: blob.size,
    blobType: blob.type,
  });
  console.log("[voice lifecycle] ⑧ 音频获取成功，即将交给 Audio 元素播放", {
    blobSize: blob.size,
    blobType: blob.type,
  });
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
  // 注意：不在这里清空指示器。指示器状态由 messageReveal/playMessageAudio 的
  // streaming/loading/playing 阶段显式管理；stopRuntimeVoicePlayback 只是打断
  // 当前播放，下一个阶段会自己重新 setRuntimeVoiceIndicator 覆盖。
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
  console.log("[voiceGenPlay] playRuntimeVoiceBlob start", {
    blobSize: blob.size,
    blobType: blob.type,
    waitForCompletion,
    manual,
    speakable: speakable.slice(0, 60),
  });
  console.log("[voice lifecycle] ⑨ Audio.play() 即将调用", { blobSize: blob.size, blobType: blob.type });
  runtimeVoiceObjectUrl = URL.createObjectURL(blob);
  console.log("[voiceGenPlay] playRuntimeVoiceBlob objectURL", { objectUrl: runtimeVoiceObjectUrl });
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
    let timer = window.setTimeout(handleTimeout, timeoutMs);
    function handleTimeout() {
      // ★ 防止短估算误杀：如果 player 仍在播放（未 ended、未暂停、currentTime 在前进），
      // 不立即 finalize，而是按"剩余时长 + 5s"再续一次，最多续 3 次。
      if (
        !finished
        && !player.ended
        && !player.paused
        && Number.isFinite(player.duration)
        && player.duration > 0
        && player.currentTime < player.duration
      ) {
        const remainingMs = Math.max(0, (player.duration - player.currentTime) * 1000);
        const extendMs = Math.min(60000, remainingMs + 5000);
        console.warn("[voiceGenPlay] playRuntimeVoiceBlob timeout but still playing, extending", {
          extendMs,
          currentTime: player.currentTime,
          duration: player.duration,
          remainingMs,
        });
        timer = window.setTimeout(handleTimeout, extendMs);
        return;
      }
      console.warn("[voiceGenPlay] playRuntimeVoiceBlob timeout", {
        timeoutMs,
        speakable: speakable.slice(0, 60),
        readyState: player.readyState,
        networkState: player.networkState,
        currentTime: player.currentTime,
        duration: Number.isFinite(player.duration) ? player.duration : -1,
        paused: player.paused,
        ended: player.ended,
        error: player.error ? { code: player.error.code, message: player.error.message } : null,
      });
      finalize(false, "朗读超时");
    }
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
      console.log("[voiceGenPlay] playRuntimeVoiceBlob finalize", { ok, hint, speakable: speakable.slice(0, 60) });
      resolve(ok);
    };
    player.onplay = () => {
      console.log("[voiceGenPlay] playRuntimeVoiceBlob onplay", {
        currentTime: player.currentTime,
        duration: Number.isFinite(player.duration) ? player.duration : -1,
        speakable: speakable.slice(0, 60),
      });
      console.log("[voice lifecycle] ⑩ 音频真正开始播放", { currentTime: player.currentTime });
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
      console.log("[voiceGenPlay] playRuntimeVoiceBlob onended", {
        currentTime: player.currentTime,
        speakable: speakable.slice(0, 60),
      });
      console.log("[voice lifecycle] ⑪ 音频播放完毕", { currentTime: player.currentTime });
      WebDebugLogUtil.log("[aiGame][miniGame] playRuntimeVoiceBlob 播放结束", {
        currentTime: player.currentTime,
        speakable: speakable.slice(0, 60),
      });
      finalize(true, "朗读完成");
    };
    player.onerror = (event) => {
      console.error("[voiceGenPlay] playRuntimeVoiceBlob onerror", {
        event,
        error: player.error ? { code: player.error.code, message: player.error.message } : null,
        readyState: player.readyState,
        networkState: player.networkState,
        src: player.src,
        currentTime: player.currentTime,
      });
      console.error("[voice lifecycle] ⑫ 音频播放出错", {
        errorCode: player.error?.code,
        errorMessage: player.error?.message,
        readyState: player.readyState,
        networkState: player.networkState,
      });
      WebDebugLogUtil.log("[aiGame][miniGame] playRuntimeVoiceBlob 播放错误", {
        currentTime: player.currentTime,
        speakable: speakable.slice(0, 60),
      });
      finalize(false, "朗读失败");
    };
    player.onpause = () => {
      console.log("[voiceGenPlay] playRuntimeVoiceBlob onpause", {
        currentTime: player.currentTime,
        speakable: speakable.slice(0, 60),
      });
    };
    player.onstalled = () => {
      console.warn("[voiceGenPlay] playRuntimeVoiceBlob onstalled", {
        readyState: player.readyState,
        networkState: player.networkState,
        speakable: speakable.slice(0, 60),
      });
    };
    void player.play().catch((error) => {
      console.error("[voiceGenPlay] playRuntimeVoiceBlob play() rejected", {
        error: String((error as Error)?.message || error || ""),
        errorName: (error as any)?.name,
        speakable: speakable.slice(0, 60),
      });
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
  console.log("[voiceGenPlay] playMessageAudioWithBinding init", {
    messageId: message.id,
    requestId,
    binding: { mode: binding.mode, presetId: binding.presetId, roleId: binding.roleId, configId: binding.configId },
    segments: splitSpeechSegments(speakable).length,
  });
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
      if (requestId !== runtimeVoiceRequestId) {
        console.warn("[voiceGenPlay] requestId mismatch, abort", { requestId, runtimeVoiceRequestId });
        return false;
      }
      try {
        setRuntimeVoiceIndicator(message, "loading", messageUiKey(message));
        console.log("[voiceGenPlay] calling resolveRuntimeVoiceUrl", { segment: segment.slice(0, 30), attempt });
        const audioUrl = await resolveRuntimeVoiceUrl(binding, segment);
        console.log("[voiceGenPlay] resolveRuntimeVoiceUrl result", {
          audioUrl,
          requestId,
          runtimeVoiceRequestId,
          requestIdMatch: requestId === runtimeVoiceRequestId,
          attempt,
        });
        if (WebDebugLogUtil.isEnabled()) {
          console.log(`[debug:fetchRuntimeVoiceBlob] audioUrl=${audioUrl} requestId=${requestId} runtimeVoiceRequestId=${runtimeVoiceRequestId}`);
        }
        if (!audioUrl || requestId !== runtimeVoiceRequestId) {
          console.warn("[voiceGenPlay] abort before fetchRuntimeVoiceBlob", {
            audioUrlEmpty: !audioUrl,
            requestId,
            runtimeVoiceRequestId,
          });
          return false;
        }
        console.log("[voiceGenPlay] calling fetchRuntimeVoiceBlob", { audioUrl });
        const blob = await fetchRuntimeVoiceBlob(audioUrl);
        console.log("[voiceGenPlay] fetchRuntimeVoiceBlob done", { blobSize: blob.size, blobType: blob.type });
        segmentPlayed = await playRuntimeVoiceBlob(blob, manual, waitForCompletion, segment, () => {
          setRuntimeVoiceIndicator(message, "playing", messageUiKey(message));
        });
        console.log("[voiceGenPlay] playRuntimeVoiceBlob result", { segmentPlayed, attempt });
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
        console.error("[voiceGenPlay] segment attempt failed", {
          segment: segment.slice(0, 60),
          attempt,
          errorMessage: messageText,
          errorName: (error as any)?.name,
          errorStack: (error as Error)?.stack?.split("\n").slice(0, 3).join("\n"),
        });
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
  console.log("[voiceGenPlay] playMessageAudio entry", {
    messageId: message.id,
    role: message.role,
    roleType: message.roleType,
    manual,
    waitForCompletion,
    speakable: (overrideContent ?? messageDisplayContent(message))?.slice(0, 40),
  });
  const playableContent = overrideContent ?? messageDisplayContent(message);
  const speakable = normalizePlayableSpeechText(playableContent);
  if (!speakable) {
    console.log("[voiceGenPlay] speakable empty, abort", { messageId: message.id });
    if (manual) getStore().state.menuVisibleHint = "这条内容没有可朗读文本";
    return false;
  }
  const binding = resolveMessageVoiceBinding(message);
  if (!binding) {
    const store = getStore();
    const roleCards = Array.isArray(store.state.roleCards) ? store.state.roleCards : [];
    const matchedRole = roleCards.find((r: any) => r.name === message.role || r.id === message.role);
    console.log("[voiceGenPlay] no binding, fallback to browser speech", {
      messageId: message.id,
      role: message.role,
      roleType: message.roleType,
      roleCardCount: roleCards.length,
      roleCardNames: roleCards.slice(0, 5).map((r: any) => `${r.name}(id=${r.id}, voiceConfigId=${r.voiceConfigId})`),
      matchedRole: matchedRole ? `${matchedRole.name}(id=${matchedRole.id}, voiceConfigId=${matchedRole.voiceConfigId})` : null,
    });
    return replayWithBrowserSpeech(overrideContent ?? message.content, waitForCompletion);
  }
  console.log("[voiceGenPlay] resolved binding", {
    messageId: message.id,
    binding: { mode: binding.mode, presetId: binding.presetId, roleId: binding.roleId, configId: binding.configId, hasRefAudio: !!binding.referenceAudioPath },
  });
  const bindingKey = runtimeVoiceBindingKey(binding);
  const preferredBinding = runtimeVoiceFallbackBindingCache.get(bindingKey) || binding;
  try {
    return await playMessageAudioWithBinding(message, preferredBinding, speakable, manual, waitForCompletion);
  } catch (error: any) {
    console.error("[voiceGenPlay] playMessageAudioWithBinding failed, will fallback", {
      messageId: message.id,
      error: String((error as Error)?.message || error),
      isDeterministic: isDeterministicRuntimeVoiceError(error),
    });
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