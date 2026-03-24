<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import type { ModelConfigItem } from "../types/toonflow";
import {
  MODEL_MANUFACTURERS,
  MODEL_TYPE_OPTIONS,
  defaultBaseUrlFor,
  defaultModelTypeFor,
  manufacturerLabel,
  manufacturerWebsite,
  modelKindLabel,
  type ModelConfigKind,
} from "../utils/modelConfigCatalog";

const props = defineProps<{
  modelValue: boolean;
  slotKey: string;
  slotLabel: string;
  configType: ModelConfigKind;
  selectedId?: number | null;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "confirmed"): void;
}>();

const store = useToonflowStore();

const keyword = ref("");
const selectedId = ref<number | null>(props.selectedId ?? null);
const showEditor = ref(false);
const editingId = ref<number | null>(null);
const testingId = ref<number | null>(null);
const visibleKeys = reactive<Record<number, boolean>>({});
const form = reactive({
  manufacturer: "volcengine",
  modelType: defaultModelTypeFor(props.configType),
  model: "",
  baseUrl: defaultBaseUrlFor("volcengine", props.configType),
  apiKey: "",
});

const testResult = reactive({
  visible: false,
  kind: "text" as "text" | "image" | "audio",
  content: "",
  title: "",
});

watch(
  () => props.modelValue,
  (value) => {
    if (value) {
      keyword.value = "";
      selectedId.value = props.selectedId ?? null;
    }
  },
);

watch(
  () => props.selectedId,
  (value) => {
    selectedId.value = value ?? null;
  },
);

watch(
  () => [form.manufacturer, props.configType] as const,
  ([manufacturer, configType], [prevManufacturer]) => {
    if (manufacturer !== prevManufacturer && !editingId.value) {
      form.baseUrl = defaultBaseUrlFor(manufacturer, configType);
    }
  },
);

const rows = computed(() =>
  store
    .settingsConfigOptions(props.configType)
    .filter((item) => {
      const q = keyword.value.trim().toLowerCase();
      if (!q) return true;
      return [
        item.manufacturer || "",
        item.model || "",
        item.baseUrl || "",
        item.modelType || "",
      ].some((text) => String(text).toLowerCase().includes(q));
    })
    .sort((a, b) => Number(b.createTime || 0) - Number(a.createTime || 0) || Number(b.id || 0) - Number(a.id || 0)),
);

function close() {
  emit("update:modelValue", false);
}

function openCreate() {
  editingId.value = null;
  form.manufacturer = "volcengine";
  form.modelType = defaultModelTypeFor(props.configType);
  form.model = "";
  form.baseUrl = defaultBaseUrlFor(form.manufacturer, props.configType);
  form.apiKey = "";
  showEditor.value = true;
}

function openEdit(row: ModelConfigItem) {
  editingId.value = row.id;
  form.manufacturer = row.manufacturer || "other";
  form.modelType = row.modelType || defaultModelTypeFor(props.configType);
  form.model = row.model || "";
  form.baseUrl = row.baseUrl || "";
  form.apiKey = row.apiKey || "";
  showEditor.value = true;
}

async function submitEditor() {
  if (!form.model.trim()) {
    store.state.notice = "模型名称不能为空";
    return;
  }
  if (!form.apiKey.trim()) {
    store.state.notice = "API Key 不能为空";
    return;
  }
  if (editingId.value) {
    await store.updateManagedModelConfig({
      id: editingId.value,
      type: props.configType,
      manufacturer: form.manufacturer,
      modelType: form.modelType,
      model: form.model.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
    });
  } else {
    await store.addManagedModelConfig({
      type: props.configType,
      manufacturer: form.manufacturer,
      modelType: form.modelType,
      model: form.model.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
    });
  }
  showEditor.value = false;
}

async function removeRow(row: ModelConfigItem) {
  if (!window.confirm(`确定删除模型配置「${row.model || `配置${row.id}`}」吗？`)) return;
  await store.deleteManagedModelConfig(row.id);
  if (selectedId.value === row.id) {
    selectedId.value = null;
  }
}

async function testRow(row: ModelConfigItem) {
  testingId.value = row.id;
  try {
    const result = await store.testManagedModelConfig(row);
    testResult.kind = result.kind;
    testResult.content = result.content;
    testResult.title = `${manufacturerLabel(row.manufacturer || "")} / ${row.model || `配置${row.id}`}`;
    testResult.visible = true;
  } finally {
    testingId.value = null;
  }
}

async function confirmBinding() {
  if (!selectedId.value) {
    store.state.notice = "请先选中一个模型配置";
    return;
  }
  await store.bindGameModel(props.slotKey, selectedId.value);
  emit("confirmed");
  close();
}
</script>

<template>
  <div v-if="modelValue" class="modal-backdrop" @click.self="close">
    <section class="modal-panel settings-model-manager">
      <div class="modal-header settings-modal-header settings-manager-header">
        <div>
          <div class="modal-title">模型数据管理</div>
          <div class="settings-manager-subtitle">{{ slotLabel }} · {{ modelKindLabel(configType) }}</div>
        </div>
        <button class="icon-btn settings-close-x" type="button" aria-label="关闭" @click="close">×</button>
      </div>

      <div class="modal-body settings-manager-body">
        <div class="settings-manager-toolbar">
          <button class="button primary settings-solid-btn" type="button" @click="openCreate">+ 新增模型</button>
          <input v-model="keyword" class="input settings-manager-search" type="text" placeholder="搜索模型名称..." />
          <div class="settings-manager-count">共 {{ rows.length }} 个模型</div>
        </div>

        <div class="settings-manager-table-wrap">
          <table class="settings-manager-table">
            <thead>
              <tr>
                <th>选中</th>
                <th>厂商</th>
                <th>类型</th>
                <th>模型名称</th>
                <th>Base URL</th>
                <th>API Key</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id" :class="{ active: selectedId === row.id }" @click="selectedId = row.id">
                <td class="center">
                  <input :checked="selectedId === row.id" type="radio" name="settings-model-row" @change="selectedId = row.id" />
                </td>
                <td>
                  <span class="settings-manager-tag">{{ manufacturerLabel(row.manufacturer || "") }}</span>
                </td>
                <td>
                  <span class="settings-manager-type">{{ modelKindLabel(row.type || configType) }}</span>
                  <span class="settings-manager-model-type">{{ row.modelType || defaultModelTypeFor(configType) }}</span>
                </td>
                <td>{{ row.model || `配置${row.id}` }}</td>
                <td class="settings-manager-url">{{ row.baseUrl || "默认" }}</td>
                <td class="settings-manager-key">
                  <span>{{ visibleKeys[row.id] ? (row.apiKey || "") : "••••••••" }}</span>
                  <button class="settings-key-toggle" type="button" @click.stop="visibleKeys[row.id] = !visibleKeys[row.id]">
                    {{ visibleKeys[row.id] ? "隐藏" : "显示" }}
                  </button>
                </td>
                <td>{{ row.createTime ? new Date(row.createTime).toLocaleString("zh-CN", { hour12: false }) : "-" }}</td>
                <td>
                  <div class="settings-manager-actions">
                    <button class="button small settings-solid-btn" type="button" :disabled="testingId === row.id" @click.stop="testRow(row)">
                      {{ testingId === row.id ? "测试中" : "测试" }}
                    </button>
                    <button class="button small settings-outline-btn" type="button" @click.stop="openEdit(row)">编辑</button>
                    <button class="button small settings-danger-btn" type="button" @click.stop="removeRow(row)">删除</button>
                  </div>
                </td>
              </tr>
              <tr v-if="!rows.length">
                <td class="settings-manager-empty" colspan="8">暂无模型配置</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="modal-actions">
        <button class="button settings-outline-btn" type="button" @click="close">取消</button>
        <button class="button primary settings-solid-btn" type="button" @click="confirmBinding">确认配置</button>
      </div>
    </section>
  </div>

  <div v-if="showEditor" class="modal-backdrop" @click.self="showEditor = false">
    <section class="modal-panel settings-account-modal">
      <div class="modal-header settings-modal-header">
        <div class="modal-title">{{ editingId ? "编辑模型" : "新增模型" }}</div>
        <button class="icon-btn settings-close-x" type="button" aria-label="关闭" @click="showEditor = false">×</button>
      </div>
      <div class="modal-body settings-account-body">
        <div class="field">
          <label>厂商</label>
          <select v-model="form.manufacturer" class="select">
            <option v-for="item in MODEL_MANUFACTURERS" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
          <a v-if="manufacturerWebsite(form.manufacturer)" :href="manufacturerWebsite(form.manufacturer)" class="settings-help-link" target="_blank" rel="noreferrer">
            点击获取厂商 API
          </a>
        </div>
        <div class="field">
          <label>类型</label>
          <select v-model="form.modelType" class="select">
            <option v-for="item in MODEL_TYPE_OPTIONS[configType]" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </div>
        <div class="field">
          <label>模型</label>
          <input v-model="form.model" class="input" type="text" placeholder="请输入模型标识" />
        </div>
        <div class="field">
          <label>Base URL</label>
          <input v-model="form.baseUrl" class="input" type="text" placeholder="请输入 Base URL" />
        </div>
        <div class="field">
          <label>API Key</label>
          <input v-model="form.apiKey" class="input" type="password" placeholder="请输入 API Key" />
        </div>
      </div>
      <div class="modal-actions">
        <button class="button settings-outline-btn" type="button" @click="showEditor = false">取消</button>
        <button class="button primary settings-solid-btn" type="button" @click="submitEditor">保存</button>
      </div>
    </section>
  </div>

  <div v-if="testResult.visible" class="modal-backdrop" @click.self="testResult.visible = false">
    <section class="modal-panel settings-test-modal">
      <div class="modal-header settings-modal-header">
        <div class="modal-title">测试结果</div>
        <button class="icon-btn settings-close-x" type="button" aria-label="关闭" @click="testResult.visible = false">×</button>
      </div>
      <div class="modal-body settings-account-body">
        <div class="settings-test-title">{{ testResult.title }}</div>
        <template v-if="testResult.kind === 'text'">
          <div class="settings-test-text">{{ testResult.content }}</div>
        </template>
        <template v-else-if="testResult.kind === 'image'">
          <img class="settings-test-image" :src="testResult.content" alt="测试图片" />
        </template>
        <template v-else>
          <audio class="settings-test-audio" :src="testResult.content" controls autoplay />
        </template>
      </div>
    </section>
  </div>
</template>
