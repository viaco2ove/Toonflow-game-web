<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import { ToonflowApi } from "../api/toonflow";
import type { WorldBookEntry } from "../types/toonflow";

const props = defineProps<{
  open: boolean;
  worldId: number | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const store = useToonflowStore();
// 用 store 的 baseUrl/token 建临时 api 实例，不污染 store
const api = computed(() => new ToonflowApi(() => ({ baseUrl: store.state.baseUrl, token: store.state.token })));

const entries = ref<WorldBookEntry[]>([]);
const loading = ref(false);
const editing = ref<Partial<WorldBookEntry> | null>(null);
const editingIndex = ref(-1); // -1 表示新建
const saving = ref(false);
const importMode = ref<"replace" | "merge">("replace");
const fileInput = ref<HTMLInputElement | null>(null);

const CATEGORIES = ["constants", "locations", "characters", "factions", "items", "events", "world", "random"];
const LOGIC_OPTIONS = ["", "AND ANY", "AND ALL", "NOT ANY", "NOT ALL"];

// 类目/逻辑的中文显示映射（值仍存英文，后端按英文匹配；仅 UI 显示中文）
const CATEGORY_LABELS: Record<string, string> = {
  constants: "常驻（世界宪法）",
  locations: "地点",
  characters: "角色",
  factions: "势力/宗门",
  items: "物品/法宝",
  events: "事件/主线",
  world: "世界观",
  random: "随机事件",
};
const LOGIC_LABELS: Record<string, string> = {
  "": "无",
  "AND ANY": "任一命中（AND ANY）",
  "AND ALL": "全部命中（AND ALL）",
  "NOT ANY": "任一不命中（NOT ANY）",
  "NOT ALL": "全部不命中（NOT ALL）",
};

function emptyEntry(): WorldBookEntry {
  return {
    entryId: "",
    title: "",
    category: "world",
    keys: [],
    constant: false,
    probability: 100,
    order: 100,
    group: "",
    selectiveLogic: "",
    selectiveKeys: [],
    content: "",
    sort: 0,
  };
}

async function loadList() {
  if (!props.worldId) return;
  loading.value = true;
  try {
    const res = await api.value.listWorldBook(props.worldId);
    entries.value = res.entries || [];
  } catch (err) {
    store.state.notice = `加载世界书失败: ${(err as Error).message}`;
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.worldId],
  ([isOpen, wid]) => {
    if (isOpen && wid) {
      editing.value = null;
      loadList();
    }
  },
  { immediate: true },
);

function startCreate() {
  editing.value = emptyEntry();
  editingIndex.value = -1;
}

function startEdit(entry: WorldBookEntry, index: number) {
  editing.value = JSON.parse(JSON.stringify(entry)) as WorldBookEntry;
  editingIndex.value = index;
}

function cancelEdit() {
  editing.value = null;
  editingIndex.value = -1;
}

async function saveEntry() {
  if (!props.worldId || !editing.value) return;
  if (!String(editing.value.title || "").trim()) {
    store.state.notice = "请填写条目标题";
    return;
  }
  saving.value = true;
  try {
    // keys/selectiveKeys 在表单里是换行分隔文本，转成数组
    const payload: Partial<WorldBookEntry> = {
      ...editing.value,
      keys: parseKeyList((editing.value as any).keysText ?? editing.value.keys),
      selectiveKeys: parseKeyList((editing.value as any).selectiveKeysText ?? editing.value.selectiveKeys),
    };
    const res = await api.value.saveWorldBookEntry(props.worldId, payload);
    if (editingIndex.value >= 0) {
      entries.value[editingIndex.value] = res.entry;
    } else {
      entries.value.push(res.entry);
    }
    entries.value.sort((a, b) => (a.sort || 0) - (b.sort || 0) || (a.id || 0) - (b.id || 0));
    editing.value = null;
    editingIndex.value = -1;
    store.state.notice = "已保存";
  } catch (err) {
    store.state.notice = `保存失败: ${(err as Error).message}`;
  } finally {
    saving.value = false;
  }
}

async function removeEntry(entry: WorldBookEntry) {
  if (!entry.id) return;
  if (!confirm(`确认删除条目「${entry.title}」？`)) return;
  try {
    await api.value.deleteWorldBookEntry(entry.id);
    entries.value = entries.value.filter((item) => item.id !== entry.id);
    store.state.notice = "已删除";
  } catch (err) {
    store.state.notice = `删除失败: ${(err as Error).message}`;
  }
}

// 导入：选 json 文件 -> parse -> 调 importWorldBook
function triggerImport() {
  fileInput.value?.click();
}

async function onFilePicked(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : Array.isArray(data.entries) ? data.entries : [];
    if (!list.length) {
      store.state.notice = "文件里没有可导入的条目";
      return;
    }
    if (importMode.value === "replace" && entries.value.length) {
      if (!confirm(`替换模式将删除当前 ${entries.value.length} 条，导入 ${list.length} 条新条目，确认？`)) return;
    }
    const res = await api.value.importWorldBook({
      worldId: props.worldId!,
      entries: list,
      mode: importMode.value,
    });
    store.state.notice = `导入完成：新增 ${res.imported} 条${res.deleted ? `，替换旧 ${res.deleted} 条` : ""}`;
    await loadList();
  } catch (err) {
    store.state.notice = `导入失败: ${(err as Error).message}`;
  } finally {
    target.value = ""; // 允许重复选同一文件
  }
}

// 导出：取当前列表 -> Blob 下载
function exportJson() {
  const payload = {
    name: "世界书导出",
    version: "1.0.0",
    totalEntries: entries.value.length,
    entries: entries.value.map(({ id, worldId, createTime, updateTime, ...rest }) => rest),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `worldbook_${props.worldId || "export"}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// keys 数组 <-> 换行文本 互转辅助
function parseKeyList(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((x) => String(x || "").trim()).filter(Boolean);
  return String(input || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function keysToText(keys: string[] | undefined): string {
  return Array.isArray(keys) ? keys.join("\n") : "";
}

// 编辑表单里 keys/selectiveKeys 用文本暂存（computed 保证响应式，输入时实时刷新）
const editingKeysText = computed(() => {
  const e = editing.value as any;
  return e ? keysToText(e.keysText != null ? e.keysText : e.keys) : "";
});
const editingSelectiveKeysText = computed(() => {
  const e = editing.value as any;
  return e ? keysToText(e.selectiveKeysText != null ? e.selectiveKeysText : e.selectiveKeys) : "";
});
// 输入时写回暂存字段（editing.value 是 ref 解包后的对象，直接赋属性即可触发响应式）
function setEditingKeysText(value: string) {
  if (editing.value) (editing.value as any).keysText = value;
}
function setEditingSelectiveKeysText(value: string) {
  if (editing.value) (editing.value as any).selectiveKeysText = value;
}

function close() {
  emit("close");
}
</script>

<template>
  <div v-if="open" class="modal-backdrop world-book-backdrop" @click.self="close">
    <div class="modal-panel world-book-panel">
      <div class="modal-header">
        <div style="font-weight: 900;">世界书条目</div>
        <button class="icon-btn settings-close-x" type="button" aria-label="关闭" @click="close">×</button>
      </div>
      <div class="modal-body world-book-body">
        <div class="world-book-toolbar">
          <div class="world-book-toolbar-left">
            <button class="button small" type="button" :disabled="loading" @click="loadList">
              {{ loading ? "加载中..." : "刷新" }}
            </button>
            <span class="world-book-count">共 {{ entries.length }} 条</span>
          </div>
          <div class="world-book-toolbar-right">
            <label class="world-book-import-mode">
              导入模式
              <select v-model="importMode" class="world-book-select">
                <option value="replace">替换</option>
                <option value="merge">追加</option>
              </select>
            </label>
            <button class="button small" type="button" @click="triggerImport">导入 JSON</button>
            <button class="button small" type="button" :disabled="!entries.length" @click="exportJson">导出 JSON</button>
            <button class="button small primary-solid" type="button" @click="startCreate">新增条目</button>
            <input ref="fileInput" type="file" accept=".json,application/json" style="display:none" @change="onFilePicked" />
          </div>
        </div>

        <div v-if="!editing">
          <div v-if="loading && !entries.length" class="world-book-empty">加载中...</div>
          <div v-else-if="!entries.length" class="world-book-empty">暂无条目，点击「新增条目」或「导入 JSON」开始</div>
          <div v-else class="world-book-list">
            <div v-for="(entry, index) in entries" :key="entry.id || index" class="world-book-item">
              <div class="world-book-item-main">
                <span class="world-book-item-title">{{ entry.title || "(无标题)" }}</span>
                <span class="world-book-tag" :data-category="entry.category">{{ entry.category }}</span>
                <span v-if="entry.constant" class="world-book-tag world-book-tag--const">常驻</span>
                <span v-if="entry.keys.length" class="world-book-item-keys">关键词: {{ entry.keys.join("、") }}</span>
              </div>
              <div class="world-book-item-actions">
                <button class="button small" type="button" @click="startEdit(entry, index)">编辑</button>
                <button class="button small danger-solid" type="button" @click="removeEntry(entry)">删除</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 编辑表单 -->
        <div v-else class="world-book-form">
          <div class="field">
            <label>标题</label>
            <input v-model="editing.title" class="input" type="text" placeholder="条目标题" />
          </div>
          <div class="world-book-form-row">
            <div class="field">
              <label>类目 category</label>
              <select v-model="editing.category" class="input">
                <option v-for="c in CATEGORIES" :key="c" :value="c">{{ CATEGORY_LABELS[c] || c }}</option>
              </select>
            </div>
            <div class="field">
              <label>排序 order</label>
              <input v-model.number="editing.order" class="input" type="number" />
            </div>
            <div class="field">
              <label>列表序号 sort</label>
              <input v-model.number="editing.sort" class="input" type="number" />
            </div>
          </div>
          <div class="world-book-form-row">
            <div class="field">
              <label>常驻 constant</label>
              <select v-model="editing.constant" class="input">
                <option :value="false">否（关键词触发）</option>
                <option :value="true">是（每轮注入）</option>
              </select>
            </div>
            <div class="field">
              <label>概率 probability (0-100)</label>
              <input v-model.number="editing.probability" class="input" type="number" min="0" max="100" />
            </div>
            <div class="field">
              <label>互斥组 group</label>
              <input v-model="editing.group" class="input" type="text" placeholder="留空表示无" />
            </div>
          </div>
          <div class="field">
            <label>关键词 keys（每行一个，支持 /正则/）</label>
            <textarea
              :value="editingKeysText"
              @input="(e) => setEditingKeysText((e.target as HTMLTextAreaElement).value)"
              class="input world-book-textarea"
              rows="3"
              placeholder="铁匠铺&#10;老王&#10;/打[铁鍛]/"
            ></textarea>
          </div>
          <div class="world-book-form-row">
            <div class="field">
              <label>选择性逻辑 selectiveLogic</label>
              <select v-model="editing.selectiveLogic" class="input">
                <option v-for="l in LOGIC_OPTIONS" :key="l" :value="l">{{ LOGIC_LABELS[l] || l }}</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>选择关键词 selectiveKeys（每行一个，配合 selectiveLogic）</label>
            <textarea
              :value="editingSelectiveKeysText"
              @input="(e) => setEditingSelectiveKeysText((e.target as HTMLTextAreaElement).value)"
              class="input world-book-textarea"
              rows="2"
              placeholder="留空表示无"
            ></textarea>
          </div>
          <div class="field">
            <label>正文 content（注入到 AI 上下文，须自描述）</label>
            <textarea v-model="editing.content" class="input world-book-textarea world-book-content" rows="8" placeholder="[条目名] 正文内容..."></textarea>
          </div>
          <div class="world-book-form-actions">
            <button class="button" type="button" @click="cancelEdit">取消</button>
            <button class="button primary-solid" type="button" :disabled="saving" @click="saveEntry">
              {{ saving ? "保存中..." : "保存" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>