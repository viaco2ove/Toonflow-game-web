<script setup lang="ts">
import { computed, useSlots } from "vue";
import { useWebpAvatar } from "../composables/useWebpAvatar";

const props = defineProps<{
  foregroundPath?: string | null;
  backgroundPath?: string | null;
  /** 是否启用 WebP 动画播放（播放后定格） */
  animated?: boolean;
  /** 动画播放时长（毫秒），0 表示无限 */
  animationDuration?: number;
  alt?: string;
  placeholderText?: string;
}>();

const emit = defineEmits<{
  (e: "animation-end"): void;
}>();

// WebP 动画控制
const {
  displayedPath: effectiveFgPath,
  isLoading: fgIsLoading,
  isAnimated: fgIsAnimated,
  isPlaying: fgIsPlaying,
  play: playFgAnimation,
  pause: pauseFgAnimation,
} = useWebpAvatar(props.foregroundPath, {
  playDuration: props.animationDuration ?? 3000,
  autoPlay: props.animated ?? false,
  onAnimationEnd: () => emit("animation-end"),
});

const slots = useSlots();
const hasImage = computed(() => !!String(effectiveFgPath.value || props.backgroundPath || "").trim());
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

    <!-- 前景层：WebP 动画或第一帧 -->
    <img
      v-if="effectiveFgPath"
      class="layered-avatar__fg"
      :class="{
        'is-animated': fgIsAnimated && fgIsPlaying,
        'is-static': fgIsAnimated && !fgIsPlaying && fgIsAnimated,
      }"
      :src="effectiveFgPath"
      :alt="alt || ''"
    />

    <!-- 加载指示器 -->
    <div v-if="fgIsLoading" class="layered-avatar__loading">
      <span class="layered-avatar__loading-dot"></span>
    </div>
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

/* 动画播放中的样式 */
.layered-avatar__fg.is-animated {
  /* 可以添加一些视觉提示，如微妙的边框发光 */
}

/* 静态（定格）样式 */
.layered-avatar__fg.is-static {
  /* 定格后的样式 */
}

/* 加载指示器 */
.layered-avatar__loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  border-radius: inherit;
}

.layered-avatar__loading-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.layered-avatar__placeholder {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
}
</style>