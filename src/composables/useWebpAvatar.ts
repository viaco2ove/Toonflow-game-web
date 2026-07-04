/**
 * WebP 头像动画控制 Composable
 *
 * 功能：
 * 1. 检测 WebP 动画
 * 2. 控制动画播放/定格
 * 3. 缓存已解码的第一帧
 * 4. 提供可逆的切换能力
 */

import { ref, computed, watch, onBeforeUnmount, nextTick } from "vue";
import {
  extractWebpFirstFrame,
  isWebpUrl,
  clearWebpFrameCache,
  type ExtractWebpFrameResult,
} from "../utils/webpFrameExtractor";

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
      isAnimated.value = false;
      isLoading.value = false;
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      const result = await extractWebpFirstFrame(path, forceRefresh);

      if (result.success) {
        firstFrameDataUrl.value = result.dataUrl;
        isAnimated.value = result.isAnimated;
        onLoaded?.(result);
      } else {
        error.value = result.error || "提取第一帧失败";
        // 失败时使用原始路径
        firstFrameDataUrl.value = "";
        isAnimated.value = false;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : "未知错误";
      firstFrameDataUrl.value = "";
      isAnimated.value = false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 开始播放动画
   */
  function play(): void {
    if (!isAnimated.value || isPlaying.value) return;

    isPlaying.value = true;

    // 如果还没有第一帧，先提取
    if (!firstFrameDataUrl.value) {
      void extractFrame();
    }

    // 设置定时器（如果是限时播放）
    if (playDuration > 0) {
      clearAnimationTimer();
      animationTimer = setTimeout(() => {
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

  // 监听路径变化（不使用 immediate，避免在 setup 阶段过早执行）
  watch(
    () => avatarPath,
    async (newPath) => {
      // 重置状态
      reset();
      originalPath.value = newPath || "";

      // 如果有新路径且自动播放，开始处理
      if (originalPath.value && autoPlay) {
        await extractFrame();
        if (isAnimated.value) {
          play();
        }
      }
    }
  );

  // 初始路径处理（在 nextTick 中执行，避免访问未初始化的 computed）
  if (avatarPath) {
    nextTick(async () => {
      originalPath.value = avatarPath || "";
      if (autoPlay) {
        await extractFrame();
        if (isAnimated.value) {
          play();
        }
      }
    });
  }

  // ============== 清理 ==============

  onBeforeUnmount(() => {
    clearAnimationTimer();
  });

  return {
    displayedPath,
    isLoading,
    isAnimated,
    isPlaying,
    error,
    originalPath,
    play,
    pause,
    toggle,
    refresh,
    reset,
  };
}