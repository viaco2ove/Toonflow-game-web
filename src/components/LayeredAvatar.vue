<script setup lang="ts">
import { computed, useSlots } from "vue";
import { useWebpAvatar } from "../composables/useWebpAvatar";
import { WebDebugLogUtil } from "../utils/WebDebugLogUtil";
import { WEBP_LOG_TAGS } from "../utils/logTagList";

const props = defineProps<{
  foregroundPath?: string | null;
  backgroundPath?: string | null;
  /** 是否启用 WebP 动画播放（播放后定格） */
  animated?: boolean;
  /** 动画播放时长（毫秒），0 表示无限。优先用 backendDurationMs（后端精确值） */
  animationDuration?: number;
  /** 后端预处理的第一帧图片 URL（PNG）。没有则前端走 canvas 提取。 */
  firstFramePath?: string | null;
  /** 后端计算的精确动画时长（毫秒），优先级高于 animationDuration */
  backendDurationMs?: number;
  alt?: string;
  placeholderText?: string;
}>();

const emit = defineEmits<{
  (e: "animation-end"): void;
}>();

// 优先使用后端精确时长，否则用 props.animationDuration，最后默认 3000
const effectiveDuration = computed(() => {
  return props.backendDurationMs && props.backendDurationMs > 0
    ? props.backendDurationMs
    : props.animationDuration ?? 3000;
});

// 是否有后端第一帧 PNG（作为定格帧）
const hasBackendPng = computed(() => !!props.firstFramePath);

// 是否有 webp 前景（播放动画）
const hasWebp = computed(() => !!props.foregroundPath);

WebDebugLogUtil.log(WEBP_LOG_TAGS.render, "LayeredAvatar 初始化", {
  foregroundPath: props.foregroundPath || "",
  backgroundPath: props.backgroundPath || "",
  animated: props.animated,
  duration: effectiveDuration.value,
  firstFramePath: props.firstFramePath || "",
  hasBackendPng: hasBackendPng.value,
  hasWebp: hasWebp.value,
});
WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "props：", props);
// WebP 动画状态控制
const {
  isPlaying: fgIsPlaying,
  play: playFgAnimation,
  pause: pauseFgAnimation,
} = useWebpAvatar(props.foregroundPath, {
  playDuration: effectiveDuration.value,
  autoPlay: props.animated ?? false,
  onAnimationEnd: () => {
    WebDebugLogUtil.log(WEBP_LOG_TAGS.play, "定时器到点，定格", { foregroundPath: props.foregroundPath || "", firstFramePath: props.firstFramePath || "" });
    emit("animation-end");
  },
});

// 有 webp + 有后端 PNG + 播放中 → webp 显示，png 隐藏
// 有 webp + 有后端 PNG + 定格 → png 显示，webp 隐藏
// 有 webp + 无 PNG → webp 显示，定格时继续显示 webp（无帧可切）
// 无 webp → 只显示 PNG（或背景）

const slots = useSlots();
const hasImage = computed(() => !!(props.foregroundPath || props.backgroundPath));
</script>

<template>
  <template v-if="hasImage">
    <!-- 背景层：普通图片 -->
    <img
      v-if="backgroundPath"
      class="layered-avatar__bg"
      :src="backgroundPath"
      :alt="alt || ''"
    />

    <!-- PNG 层：后端第一帧，定格时显示，播放中隐藏 -->
    <img
      v-if="hasBackendPng"
      class="layered-avatar__fg layered-avatar__fg--png"
      :class="{ 'is-hidden': hasWebp && fgIsPlaying }"
      :src="firstFramePath || ''"
      :alt="alt || ''"
    />

    <!-- WebP 层：原始动画，播放中显示，定格时（有 PNG 则隐藏，无 PNG 则保持显示） -->
    <img
      v-if="hasWebp"
      class="layered-avatar__fg layered-avatar__fg--webp"
      :class="{ 'is-hidden': fgIsPlaying && hasBackendPng }"
      :src="foregroundPath"
      :alt="alt || ''"
    />
  </template>
  <div v-else class="layered-avatar__placeholder">
    <slot>{{ placeholderText || "?" }}</slot>
  </div>
</template>

<style scoped>
.layered-avatar__bg,
.layered-avatar__fg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.layered-avatar__bg {
  object-fit: cover;
}

.layered-avatar__fg {
  object-fit: contain;
  object-position: center bottom;
}

/* PNG 层默认显示 */
.layered-avatar__fg--png {
  visibility: visible;
}

/* WebP 层默认显示（无 PNG 时定格也保持显示） */
.layered-avatar__fg--webp {
  visibility: visible;
}

/* 播放中有 PNG 时：隐藏 PNG，显示 WebP */
.is-hidden {
  visibility: hidden;
  pointer-events: none;
}

.layered-avatar__placeholder {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
}
</style>