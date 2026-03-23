<script setup lang="ts">
withDefaults(defineProps<{
  title: string;
  coverPath?: string | null;
  emptyText?: string;
  height?: string;
  variant?: "card" | "plain";
}>(), {
  variant: "card",
});
</script>

<template>
  <div :class="['story-cover', `story-cover--${variant}`]" :style="{ height: height || '100%' }">
    <img v-if="coverPath" :src="coverPath" :alt="title" />
    <div v-else class="placeholder">
      {{ emptyText || title || "无封面" }}
    </div>
  </div>
</template>
