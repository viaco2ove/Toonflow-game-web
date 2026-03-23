<script setup lang="ts">
defineProps<{
  title: string;
  coverPath?: string | null;
  emptyText?: string;
  height?: string;
}>();
</script>

<template>
  <div class="card story-cover" :style="{ height: height || '100%' }">
    <img v-if="coverPath" :src="coverPath" :alt="title" />
    <div v-else class="placeholder">
      {{ emptyText || title || "无封面" }}
    </div>
  </div>
</template>
