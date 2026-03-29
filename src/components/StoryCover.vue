<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  title: string;
  coverPath?: string | null;
  emptyText?: string;
  height?: string;
  variant?: "card" | "plain";
}>(), {
  variant: "card",
});

const titleInitial = computed(() => {
  const text = String(props.title || "").trim();
  return text ? text.slice(0, 1).toUpperCase() : "故";
});

const loadFailed = ref(false);

watch(
  () => props.coverPath,
  () => {
    loadFailed.value = false;
  },
  { immediate: true },
);
</script>

<template>
  <div :class="['story-cover', `story-cover--${variant}`]" :style="height ? { height } : undefined">
    <img v-if="coverPath && !loadFailed" :src="coverPath" :alt="title" @error="loadFailed = true" />
    <div v-else class="placeholder">
      <div class="story-cover-placeholder">
        <div class="story-cover-placeholder__initial">{{ titleInitial }}</div>
        <div class="story-cover-placeholder__text">{{ emptyText || title || "无封面" }}</div>
      </div>
    </div>
  </div>
</template>
