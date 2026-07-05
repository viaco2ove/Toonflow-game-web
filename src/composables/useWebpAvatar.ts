/**
 * WebP 头像动画控制 Composable
 *
 * 功能：
 * 1. 检测 WebP 动画
 * 2. 控制动画播放/定格
 * 3. 缓存已解码的第一帧
 * 4. 提供可逆的切换能力
 */

import { ref, computed, watch, onBeforeUnmount, onMounted } from "vue";
import {
  extractWebpFirstFrame,
  isWebpUrl,
  clearWebpFrameCache,
  type ExtractWebpFrameResult,
} from "../utils/webpFrameExtractor";
import { WebDebugLogUtil } from "../utils/WebDebugLogUtil";
import { WEBP_LOG_TAGS } from "../utils/logTagList";

// TODO: 调试用，验证模块是否被打包加载
console.warn("[webp:module] useWebpAvatar 模块加载");

export interface UseWebpAvatarOptions {
  /** 动画播放时长（毫秒），0 表示无限循环 */
  playDuration?: number;
  /** 是否自动开始播放 */
  autoPlay?: boolean;
  /** 加载完成后的回调 */
  onLoaded?: (result: ExtractWebpFrameResult) => void;
  /** 动画结束后的回调 */
  onAnimationEnd?: () => void;
}

export interface UseWebpAvatarReturn {
  /** 显示的图像路径（可能是第一帧 DataURL） */
  displayedPath: string;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 是否为动画 WebP */
  isAnimated: boolean;
  /** 当前是否为播放状态 */
  isPlaying: boolean;
  /** 错误信息 */
  error: string | null;
  /** 原始路径 */
  originalPath: string;
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
  avatarPath: string | null | undefined,
  options: UseWebpAvatarOptions = {}
): UseWebpAvatarReturn {
  const { playDuration = 3000, autoPlay = false, onLoaded, onAnimationEnd } = options;

  // ============== 状态 ==============
  const originalPath = ref(avatarPath || "");
  const firstFrameDataUrl = ref("");
  const isLoading = ref(false);
  const isAnimated = ref(false);
  const isPlaying = ref(false);
  const error = ref<string | null>(null);

  // 定时器引用
  let animationTimer: ReturnType<typeof setTimeout> | null = null;

  // ============== 计算属性 ==============

  /**
   * 最终显示的路径
   * - 如果是动画且正在播放：显示原始 WebP
   * - 否则：显示第一帧 DataURL（如果是动画）或原始路径
   */
  const displayedPath = computed(() => {
    if (!originalPath.value) return "";

    // 如果正在播放动画，显示原始路径
    if (isPlaying.value && isAnimated.value) {
      return originalPath.value;
    }

    // 如果有第一帧缓存，优先使用
    if (firstFrameDataUrl.value) {
      return firstFrameDataUrl.value;
    }

    // 降级：使用原始路径
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
    WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "开始播放", { path: originalPath.value, playDuration });

    // 如果还没有第一帧，先提取
    if (!firstFrameDataUrl.value) {
      void extractFrame();
    }

    // 设置定时器（如果是限时播放）
    if (playDuration > 0) {
      clearAnimationTimer();
      animationTimer = setTimeout(() => {
        WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "定时器到点，触发 onAnimationEnd", { path: originalPath.value });
        pause();
        onAnimationEnd?.();
      }, playDuration);
    }
  }

  /**
   * 暂停/定格动画
   */
  function pause(): void {
    if (!isPlaying.value) return;

    isPlaying.value = false;
    clearAnimationTimer();
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
   * 重置到初始状态
   */
  function reset(): void {
    pause();
    firstFrameDataUrl.value = "";
    isAnimated.value = false;
    error.value = null;
    WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "reset 重置", { path: originalPath.value });
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

  // 初始化：在 onMounted 中处理初始路径，避免 setup 阶段 immediate watch 的 reactive 只读问题
  onMounted(async () => {
    const initPath = avatarPath;
    if (!initPath) return;
    try {
      WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "初始化路径", { initPath, autoPlay });
      reset();
      originalPath.value = initPath;
      if (autoPlay) {
        await extractFrame();
        if (isAnimated.value) {
          play();
        } else {
          WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "非动画或提取未成功，不自动播放", { path: originalPath.value });
        }
      }
    } catch (e) {
      WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "初始化异常", { error: e instanceof Error ? e.message : String(e) });
    }
  });

  // 监听路径变化（setup 完成后才触发，不会与初始化冲突）
  watch(
    () => avatarPath,
    async (newPath) => {
      if (!newPath) return; // onMounted 已处理过 initPath，这里只管后续切换
      try {
        WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "路径变化", { newPath, autoPlay });
        reset();
        originalPath.value = newPath;
        if (autoPlay) {
          await extractFrame();
          if (isAnimated.value) {
            play();
          } else {
            WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "非动画或提取未成功，不自动播放", { path: originalPath.value });
          }
        }
      } catch (e) {
        WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "watch 异常", { error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  // ============== 清理 ==============

  onBeforeUnmount(() => {
    WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "组件卸载，清理定时器", { path: originalPath.value, isPlaying: isPlaying.value });
    clearAnimationTimer();
  });

  return {
    displayedPath,
    isLoading,
    isAnimated,
    isPlaying,
    error,
    originalPath,
    setPath: (path: string) => {
      originalPath.value = path;
    },
    play,
    pause,
    toggle,
    refresh,
    reset,
  };
}