<script setup lang="ts">
import type { AppTab } from "../types/toonflow";

const props = defineProps<{
  active: AppTab;
}>();

const emit = defineEmits<{
  (event: "change", tab: AppTab): void;
}>();

const items: Array<{ key: AppTab; label: string }> = [
  { key: "home", label: "主页" },
  { key: "create", label: "创建故事" },
  { key: "history", label: "聊过" },
  { key: "my", label: "我的" },
];
</script>

<template>
  <nav class="nav">
    <button
      v-for="item in items"
      :key="item.key"
      :class="{ active: props.active === item.key }"
      type="button"
      @click="emit('change', item.key)"
    >
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>
