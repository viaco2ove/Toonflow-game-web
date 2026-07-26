<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import { ToonflowApi } from "../api/toonflow";
import type { WorldBookEntry } from "../types/toonflow";

const props = defineProps<{
  open: boolean;
  worldId: number | null;
  worldName?: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const store = useToonflowStore();
const api = computed(() => new ToonflowApi(() => ({ baseUrl: store.state.baseUrl, token: store.state.token })));

const entries = ref<WorldBookEntry[]>([]);
const loading = ref(false);
const expandedTitle = ref<string | null>(null); // 展开详情的条目标题，null 表示都折叠

const CATEGORIES = ["constants", "locations", "characters", "factions", "items", "events", "world", "random"];
const CATEGORY_LABELS: Record<string, string> = {
  constants: "常驻",
  locations: "地点",
  characters: "角色",
  factions: "势力",
  items: "物品",
  events: "事件",
  world: "世界观",
  random: "随机",
};

async function loadList() {
  if (!props.worldId) return;
  loading.value = true;
  try {
    const res = await api.value.listWorldBook(props.worldId);
    entries.value = res.entries || [];
  } catch (err) {
    store.state.notice = `加载世界书失败: ${(err as Error).message}`;
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.worldId],
  ([isOpen, wid]) => {
    if (isOpen && wid) {
      expandedTitle.value = null;
      loadList();
    }
  },
  { immediate: true },
);

// 按类目分组，方便浏览
const groupedEntries = computed(() => {
  const groups: { category: string; label: string; items: WorldBookEntry[] }[] = [];
  for (const c of CATEGORIES) {
    const items = entries.value.filter((e) => e.category === c);
    if (items.length) groups.push({ category: c, label: CATEGORY_LABELS[c] || c, items });
  }
  return groups;
});

function toggleExpand(title: string) {
  expandedTitle.value = expandedTitle.value === title ? null : title;
}

function close() {
  emit("close");
}
</script>

<template>
  <div v-if="open" class="modal-backdrop world-book-backdrop" @click.self="close">
    <div class="modal-panel world-book-panel">
      <div class="modal-header">
        <div style="font-weight: 900;">世界书{{ worldName ? ` · ${worldName}` : "" }}</div>
        <button class="icon-btn settings-close-x" type="button" aria-label="关闭" @click="close">×</button>
      </div>
      <div class="modal-body world-book-body">
        <div class="world-book-toolbar">
          <span class="world-book-count">共 {{ entries.length }} 条（只读）</span>
          <button class="button small" type="button" :disabled="loading" @click="loadList">
            {{ loading ? "加载中..." : "刷新" }}
          </button>
        </div>

        <div v-if="loading && !entries.length" class="world-book-empty">加载中...</div>
        <div v-else-if="!entries.length" class="world-book-empty">该故事暂无世界书条目</div>

        <template v-else>
          <div v-for="group in groupedEntries" :key="group.category" class="world-book-group">
            <div class="world-book-group-title">{{ group.label }}（{{ group.items.length }}）</div>
            <div class="world-book-list">
              <div
                v-for="(entry, index) in group.items"
                :key="`${group.category}_${index}`"
                class="world-book-item world-book-item--readonly"
                @click="toggleExpand(entry.title || `(无标题)_${index}`)"
              >
                <div class="world-book-item-main">
                  <span class="world-book-item-title">{{ entry.title || "(无标题)" }}</span>
                  <span v-if="entry.constant" class="world-book-tag world-book-tag--const">常驻</span>
                  <span v-if="entry.keys.length" class="world-book-item-keys">关键词: {{ entry.keys.join("、") }}</span>
                  <span class="world-book-item-toggle">{{ expandedTitle === (entry.title || `(无标题)_${index}`) ? "收起" : "展开" }}</span>
                </div>
                <div v-if="expandedTitle === (entry.title || `(无标题)_${index}`)" class="world-book-item-content">
                  {{ entry.content }}
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>