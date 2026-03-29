<script setup lang="ts">
import { computed, useSlots } from "vue";

const props = defineProps<{
  foregroundPath?: string | null;
  backgroundPath?: string | null;
  alt?: string;
  placeholderText?: string;
}>();

const slots = useSlots();
const hasImage = computed(() => !!String(props.foregroundPath || props.backgroundPath || "").trim());
</script>

<template>
  <template v-if="hasImage">
    <img v-if="backgroundPath" class="layered-avatar__bg" :src="backgroundPath" :alt="alt || ''" />
    <img v-if="foregroundPath" class="layered-avatar__fg" :src="foregroundPath" :alt="alt || ''" />
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

.layered-avatar__placeholder {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
}
</style>
