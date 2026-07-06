/**
 * WebP 头像动画控制 Composable
 *
 * 功能：
 * 1. 检测 WebP 动画
 * 2. 控制动画播放/定格
 * 3. 缓存已解码的第一帧
 * 4. 提供可逆的切换能力
 */

import { ref, computed, watch, onBeforeUnmount, onMounted, unref, type ComputedRef, type Ref } from "vue";
import {
  extractWebpFirstFrame,
  isWebpUrl,
  clearWebpFrameCache,
  extractFrameFromImgEl,
  type ExtractWebpFrameResult,
} from "../utils/webpFrameExtractor";
import { WebDebugLogUtil } from "../utils/WebDebugLogUtil";
import { WEBP_LOG_TAGS } from "../utils/logTagList";


export interface UseWebpAvatarOptions {
  /** 动画播放时长（毫秒），0 表示无限循环。支持 getter 以便响应式更新 */
  playDuration?: number | (() => number);
  /** 是否自动开始播放 */
  autoPlay?: boolean;
  /** 加载完成后的回调 */
  onLoaded?: (result: ExtractWebpFrameResult) => void;
  /** 动画结束后的回调 */
  onAnimationEnd?: () => void;
  /** 后端预处理的第一帧 URL，优先级高于前端 canvas 提取。支持 getter 以便响应式更新 */
  backendFirstFrameUrl?: string | (() => string | undefined);
  /** 循环间隔（毫秒）：onAnimationEnd 后等待多久再次播放，0 表示不循环。默认 5000 */
  loopInterval?: number | (() => number);
}

export interface UseWebpAvatarReturn {
  /** 显示的图像路径（可能是第一帧 DataURL） */
  displayedPath: string | ComputedRef<string>;
  /** 是否正在加载 */
  isLoading: boolean | ComputedRef<boolean>;
  /** 是否为动画 WebP */
  isAnimated: boolean | ComputedRef<boolean>;
  /** 当前是否为播放状态 */
  isPlaying: boolean | ComputedRef<boolean>;
  /** 错误信息 */
  error: string | null | ComputedRef<string | null>;
  /** 当前原始路径 */
  path: string | ComputedRef<string>;
  /** 注册 DOM img 元素，用于从已加载的图片提取第一帧（绕过 CORS） */
  registerImgEl: (imgEl: HTMLImageElement) => void;
  /** 注入已提取好的第一帧 DataURL（推荐从 DOM img 元素提取后传入） */
  setExtractedFirstFrame: (dataUrl: string, isAnimated: boolean) => void;
  /** 播放动画 */
  play: () => void;
  /** 暂停/定格 */
  pause: () => void;
  /** 切换播放状态 */
  toggle: () => void;
  /** 刷新（重新提取第一帧） */
  refresh: () => Promise<void>;
  /** 重置到初始状态 */
  reset: () => void;
}

export function useWebpAvatar(
  avatarPath: string | ComputedRef<string | null | undefined> | Ref<string | null | undefined> | (() => string | null | undefined),
  options: UseWebpAvatarOptions = {}
): UseWebpAvatarReturn {
  WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "UseWebpAvatarOptions", options);

  const { playDuration: playDurationOpt = 3000, autoPlay = false, onLoaded, onAnimationEnd, backendFirstFrameUrl: backendFirstFrameUrlOpt, loopInterval: loopIntervalOpt = 5000 } = options;

  // 把 avatarPath 解包成响应式 ref，支持 string / ComputedRef / Ref / Getter
  const avatarPathRef = computed(() => {
    if (typeof avatarPath === "function") {
      return avatarPath() ?? "";
    }
    return unref(avatarPath) ?? "";
  });

  // playDuration / backendFirstFrameUrl 也支持 getter 以便响应式更新
  const playDurationRef = computed(() => {
    return typeof playDurationOpt === "function" ? (playDurationOpt() || 3000) : (playDurationOpt || 3000);
  });
  const backendFirstFrameUrlRef = computed(() => {
    return typeof backendFirstFrameUrlOpt === "function" ? backendFirstFrameUrlOpt() : backendFirstFrameUrlOpt;
  });
  const loopIntervalRef = computed(() => {
    return typeof loopIntervalOpt === "function" ? loopIntervalOpt() : loopIntervalOpt;
  });

  // ============== 状态 ==============
  const originalPath = ref(avatarPathRef.value);
  const firstFrameDataUrl = ref("");
  const isLoading = ref(false);
  const isAnimated = ref(false);
  const isPlaying = ref(false);
  const error = ref<string | null>(null);

  // 定时器引用
  let animationTimer: ReturnType<typeof setTimeout> | null = null;

  WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "第一帧png url", { path: originalPath.value, backendFirstFrameUrl: backendFirstFrameUrlRef.value, playDuration: playDurationRef.value });
  // 如果后端提供了第一帧，直接注入（无需前端 canvas 提取）
  const initialBackendUrl = backendFirstFrameUrlRef.value;
  if (initialBackendUrl) {
    firstFrameDataUrl.value = initialBackendUrl;
    isAnimated.value = true;
    WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "使用后端第一帧", { path: originalPath.value, backendFirstFrameUrl: initialBackendUrl });
  }

  // 监听后端第一帧 URL 变化（响应式更新）
  watch(backendFirstFrameUrlRef, (newUrl) => {
    if (newUrl) {
      firstFrameDataUrl.value = newUrl;
      isAnimated.value = true;
      WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "更新后端第一帧", { path: originalPath.value, backendFirstFrameUrl: newUrl });
    }
  });

  // ============== 计算属性 ==============

  /**
   * 最终显示的路径
   * - 有第一帧 DataURL（后端/canvas/DOM提取）且不在播放 → 显示第一帧（定格）
   * - 在播放动画中 → 显示原始 WebP
   * - 有第一帧但动画已暂停 → 显示原始 WebP（播放结束停在动画最后一帧）
   * - 无第一帧 → 显示原始路径
   */
  const displayedPath = computed(() => {
    if (!originalPath.value) return "";

    // 有第一帧缓存，且不在播放动画 → 显示第一帧（定格）
    if (firstFrameDataUrl.value && !isPlaying.value) {
      return firstFrameDataUrl.value;
    }

    // 正在播放 → 显示原始 WebP
    return originalPath.value;
  });

  // ============== 核心方法 ==============

  /**
   * 提取并缓存第一帧
   */
  async function extractFrame(forceRefresh = false): Promise<void> {
    const path = originalPath.value;

    // 非 WebP 或空路径直接跳过
    if (!path || !isWebpUrl(path)) {
      WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "skip: 非webp或空路径", { path, isWebp: !!path && isWebpUrl(path) });
      isAnimated.value = false;
      isLoading.value = false;
      return;
    }

    WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "开始提取第一帧", { path, forceRefresh });
    isLoading.value = true;
    error.value = null;

    try {
      const result = await extractWebpFirstFrame(path, forceRefresh);

      if (result.success) {
        firstFrameDataUrl.value = result.dataUrl;
        isAnimated.value = result.isAnimated;
        WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "提取成功", {
          path,
          isAnimated: result.isAnimated,
          dataUrlLength: result.dataUrl?.length || 0,
        });
        onLoaded?.(result);
      } else {
        error.value = result.error || "提取第一帧失败";
        // 失败时使用原始路径
        firstFrameDataUrl.value = "";
        isAnimated.value = false;
        WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "提取失败，降级原始路径", { path, error: error.value });
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : "未知错误";
      firstFrameDataUrl.value = "";
      isAnimated.value = false;
      WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "提取异常，降级原始路径", { path, error: error.value });
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 开始播放动画
   */
  function play(): void {
    if (!isAnimated.value || isPlaying.value) {
      WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "play 跳过", {
        path: originalPath.value,
        isAnimated: isAnimated.value,
        isPlaying: isPlaying.value,
      });
      return;
    }

    isPlaying.value = true;
    WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "第一帧png url", { path: originalPath.value, backendFirstFrameUrl: backendFirstFrameUrlRef.value, playDuration: playDurationRef.value });
    WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "开始播放", { path: originalPath.value, playDuration: playDurationRef.value });

    // 如果还没有第一帧，先提取
    if (!firstFrameDataUrl.value) {
      void extractFrame();
    }

    // 设置定时器（如果是限时播放）
    if (playDurationRef.value > 0) {
      clearAnimationTimer();
      animationTimer = setTimeout(() => {
        WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "第一帧png url", { path: originalPath.value, backendFirstFrameUrl:backendFirstFrameUrlRef.value, playDuration: playDurationRef.value });
        WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "定时器到点，触发 onAnimationEnd", { path: originalPath.value });
        pause();
        onAnimationEnd?.();
        // 循环播放：等待 loopInterval 后再次播放
        if (loopIntervalRef.value > 0) {
          WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "循环等待", { path: originalPath.value, loopInterval: loopIntervalRef.value });
          animationTimer = setTimeout(() => {
            WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "循环触发再播", { path: originalPath.value });
            play();
          }, loopIntervalRef.value);
        }
      }, playDurationRef.value);
    }
  }

  /**
   * 暂停/定格动画
   */
  function pause(): void {
    if (!isPlaying.value) return;

    isPlaying.value = false;
    stopTimer();
    WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "第一帧png url", { path: originalPath.value, backendFirstFrameUrl: backendFirstFrameUrlRef.value, playDuration: playDurationRef.value });
    WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "暂停/定格", { path: originalPath.value });
  }

  /**
   * 切换播放状态
   */
  function toggle(): void {
    if (isPlaying.value) {
      pause();
    } else {
      play();
    }
  }

  /**
   * 刷新第一帧
   */
  async function refresh(): Promise<void> {
    // 清除缓存
    if (originalPath.value) {
      clearWebpFrameCache(originalPath.value);
    }
    firstFrameDataUrl.value = "";
    WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "refresh 重新提取", { path: originalPath.value });

    // 重新提取
    await extractFrame(true);
  }

  /**
   * 停止播放定时器（不清 firstFrameDataUrl/isAnimated，定格帧跨路径保持）
   */
  function stopTimer(): void {
    if (animationTimer !== null) {
      clearTimeout(animationTimer);
      animationTimer = null;
    }
  }

  /**
   * 重置播放状态（停定时器、停播放，清 error，保留 firstFrameDataUrl 和 isAnimated）
   */
  function reset(): void {
    stopTimer();
    isPlaying.value = false;
    error.value = null;
    WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "reset", { path: originalPath.value, hasFirstFrame: !!firstFrameDataUrl.value, isAnimated: isAnimated.value });
  }

  /**
   * 注册 DOM img 元素：提取完成后自动用该元素提取第一帧并注入状态。
   * 用于从已加载的 DOM img 元素提取第一帧，绕过 CORS。
   */
  function registerImgEl(imgEl: HTMLImageElement): void {
    if (!originalPath.value || !isWebpUrl(originalPath.value)) return;
    void (async () => {
      WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "registerImgEl 开始提取", { url: originalPath.value });
      const result = await extractFrameFromImgEl(imgEl, originalPath.value);
      if (result.success) {
        firstFrameDataUrl.value = result.dataUrl;
        isAnimated.value = result.isAnimated;
        WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "registerImgEl 提取成功", {
          url: originalPath.value,
          isAnimated: result.isAnimated,
          dataUrlLength: result.dataUrl.length,
        });
        onLoaded?.(result);
      } else {
        error.value = result.error || "提取第一帧失败";
        firstFrameDataUrl.value = "";
        isAnimated.value = false;
        WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "registerImgEl 提取失败", { url: originalPath.value, error: result.error });
      }
      isLoading.value = false;
    })();
  }

  /**
   * 注入已提取好的第一帧 DataURL。
   * 推荐从 DOM img 元素提取后传入，绕过 CORS。
   */
  function setExtractedFirstFrame(dataUrl: string, isAnimatedFlag: boolean): void {
    firstFrameDataUrl.value = dataUrl;
    isAnimated.value = isAnimatedFlag;
    WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "注入第一帧", { path: originalPath.value, isAnimated: isAnimatedFlag, dataUrlLength: dataUrl.length });
  }

  /**
   * 清除动画定时器
   */
  function clearAnimationTimer(): void {
    if (animationTimer !== null) {
      clearTimeout(animationTimer);
      animationTimer = null;
    }
  }

  // ============== 监听器 ==============

  // 监听路径变化：设置 originalPath，不发网络请求。
  // DOM img :src 自然加载，完成后 registerImgEl 提取第一帧并自动播放。
  watch(
    () => avatarPathRef.value,
    (newPath) => {
      if (!newPath) return;
      WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "路径变化", { newPath, autoPlay });
      reset();
      originalPath.value = newPath;
      // 不发网络请求：让 Vue 模板的 <img :src> 自然加载
      // DOM img 加载完成后 registerImgEl 会自动提取第一帧
      if (autoPlay) {
        isPlaying.value = true;
        WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "开始播放（等待 DOM img 加载后提取第一帧）", { path: originalPath.value, playDuration: playDurationRef.value });
        // 设置定时器（如果是限时播放）
        if (playDurationRef.value > 0) {
          stopTimer();
          animationTimer = setTimeout(() => {
            WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "定时器到点，触发 onAnimationEnd", { path: originalPath.value });
            pause();
            onAnimationEnd?.();
            // 循环播放
            if (loopIntervalRef.value > 0) {
              WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "循环等待", { path: originalPath.value, loopInterval: loopIntervalRef.value });
              animationTimer = setTimeout(() => {
                WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "循环触发再播", { path: originalPath.value });
                play();
              }, loopIntervalRef.value);
            }
          }, playDurationRef.value);
        }
      }
    },
    { immediate: true }
  );

  // ============== 清理 ==============

  onBeforeUnmount(() => {
    WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "组件卸载，清理定时器", { path: originalPath.value, isPlaying: isPlaying.value });
    clearAnimationTimer();
  });

  return {
    displayedPath: displayedPath,
    isLoading: computed(() => isLoading.value),
    isAnimated: computed(() => isAnimated.value),
    isPlaying: computed(() => isPlaying.value),
    error: computed(() => error.value),
    path: computed(() => originalPath.value),
    registerImgEl,
    setExtractedFirstFrame,
    play,
    pause,
    toggle,
    refresh,
    reset,
  };
}