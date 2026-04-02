<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import type { LocalAvatarMattingStatus, ModelConfigItem } from "../types/toonflow";
import {
  MODEL_MANUFACTURERS,
  MODEL_TYPE_OPTIONS,
  defaultBaseUrlFor,
  defaultManufacturerFor,
  defaultModelNameFor,
  defaultModelTypeFor,
  isApiKeyRequiredFor,
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

function isVoiceDesignSlot(): boolean {
  return props.configType === "voice_design" || props.slotKey === "storyVoiceDesignModel";
}

function isVoiceDesignModel(model?: string | null): boolean {
  const normalized = String(model || "").trim().toLowerCase();
  return !!normalized && (
    normalized === "qwen-voice-design"
    || normalized.startsWith("qwen3-tts-vd")
    || normalized === "voice-enrollment"
    || normalized.startsWith("cosyvoice-v3")
    || normalized.startsWith("cosyvoice-v3.5")
  );
}

function isVoiceDesignManufacturer(manufacturer?: string | null): boolean {
  return String(manufacturer || "").trim() === "qwen";
}

function isAvatarMattingManufacturer(manufacturer?: string | null): boolean {
  const normalized = String(manufacturer || "").trim().toLowerCase();
  return normalized === "bria" || normalized === "aliyun_imageseg" || normalized === "tencent_ci" || normalized === "local_birefnet";
}

function isLocalBiRefNetManufacturer(manufacturer?: string | null): boolean {
  return String(manufacturer || "").trim().toLowerCase() === "local_birefnet";
}

function isAutoDlTextManufacturer(manufacturer?: string | null): boolean {
  return String(manufacturer || "").trim().toLowerCase() === "autodl_chat";
}

function defaultSlotManufacturer(): string {
  if (isVoiceDesignSlot()) {
    return "qwen";
  }
  if (props.slotKey === "storyAvatarMattingModel") {
    return "bria";
  }
  if (props.configType === "voice" && props.slotKey === "storyAsrModel") {
    return "aliyun_direct";
  }
  return defaultManufacturerFor(props.configType);
}

function defaultSlotModelType(): string {
  if (isVoiceDesignSlot()) {
    return "voice_design";
  }
  if (props.configType === "voice" && props.slotKey === "storyAsrModel") {
    return "asr";
  }
  return defaultModelTypeFor(props.configType);
}

function defaultSlotModelName(manufacturer = defaultSlotManufacturer(), modelType = defaultSlotModelType()): string {
  if (props.configType === "text" && manufacturer === "deepseek") {
    return "deepseek-chat";
  }
  if (props.configType === "text" && manufacturer === "autodl_chat") {
    return "DeepSeek-R1-0528";
  }
  if (props.configType === "text" && manufacturer === "lmstudio") {
    return "qwen3.5-9b";
  }
  if (isVoiceDesignSlot() && manufacturer === "qwen") {
    return "qwen3-tts-vd-2026-01-26";
  }
  if (props.slotKey === "storyAvatarMattingModel" && manufacturer === "bria") {
    return "RMBG-2.0";
  }
  if (props.slotKey === "storyAvatarMattingModel" && manufacturer === "aliyun_imageseg") {
    return "SegmentCommonImage";
  }
  if (props.slotKey === "storyAvatarMattingModel" && manufacturer === "tencent_ci") {
    return "AIPortraitMatting";
  }
  if (props.slotKey === "storyAvatarMattingModel" && manufacturer === "local_birefnet") {
    return "birefnet-portrait";
  }
  return defaultModelNameFor(manufacturer, props.configType, modelType);
}

function rowMatchesSlot(item: ModelConfigItem): boolean {
  if (isVoiceDesignSlot()) {
    return isVoiceDesignManufacturer(item.manufacturer) && isVoiceDesignModel(item.model);
  }
  if (props.slotKey === "storyAvatarMattingModel") {
    return isAvatarMattingManufacturer(item.manufacturer);
  }
  if (props.configType === "image" && isAvatarMattingManufacturer(item.manufacturer)) {
    return false;
  }
  if (props.configType !== "voice") return true;
  const modelType = String(item.modelType || "").trim() || "tts";
  if (props.slotKey === "storyAsrModel") {
    return modelType === "asr";
  }
  return modelType !== "asr";
}

function displayKindLabel(type: string, slotKey = props.slotKey): string {
  if (slotKey === "storyVoiceDesignModel") {
    return "语音设计模型";
  }
  return modelKindLabel(type);
}

function displayModelTypeLabel(type: string, slotKey = props.slotKey): string {
  if (slotKey === "storyVoiceDesignModel") {
    return "voice_design";
  }
  return type;
}

const keyword = ref("");
const selectedId = ref<number | null>(props.selectedId ?? null);
const showEditor = ref(false);
const editingId = ref<number | null>(null);
const testingId = ref<number | null>(null);
const visibleKeys = reactive<Record<number, boolean>>({});
const localAvatarMattingStatus = ref<LocalAvatarMattingStatus | null>(null);
const autodlModelPreset = ref<string>("__custom__");
const localAvatarMattingInstalling = ref(false);
const form = reactive({
  manufacturer: defaultSlotManufacturer(),
  modelType: defaultSlotModelType(),
  model: defaultSlotModelName(),
  baseUrl: defaultBaseUrlFor(defaultSlotManufacturer(), props.configType, defaultSlotModelType()),
  apiKey: "",
  inputPricePer1M: 0,
  outputPricePer1M: 0,
  cacheReadPricePer1M: 0,
  currency: "CNY",
});

const testResult = reactive({
  visible: false,
  kind: "text" as "text" | "image" | "audio",
  content: "",
  title: "",
});

const manufacturerOptions = computed(() =>
  MODEL_MANUFACTURERS.filter((item) => {
    if (isVoiceDesignSlot()) {
      return item.value === "qwen";
    }
    if (props.slotKey === "storyAvatarMattingModel") {
      return item.value === "bria" || item.value === "aliyun_imageseg" || item.value === "tencent_ci" || item.value === "local_birefnet";
    }
    if (props.configType === "text") {
      return item.value !== "ai_voice_tts"
        && item.value !== "aliyun"
        && item.value !== "aliyun_direct"
        && item.value !== "bria"
        && item.value !== "aliyun_imageseg"
        && item.value !== "tencent_ci"
        && item.value !== "local_birefnet";
    }
    if (props.configType === "voice") {
      return item.value !== "qwen" && item.value !== "lmstudio" && item.value !== "autodl_chat";
    }
    return item.value !== "ai_voice_tts"
      && item.value !== "aliyun"
      && item.value !== "aliyun_direct"
      && item.value !== "bria"
      && item.value !== "aliyun_imageseg"
      && item.value !== "tencent_ci"
      && item.value !== "local_birefnet"
      && item.value !== "lmstudio";
  }),
);

const modelTypeOptions = computed(() => {
  if (isVoiceDesignSlot()) {
    return [{ value: "voice_design", label: "语音设计" }];
  }
  return MODEL_TYPE_OPTIONS[props.configType];
});

const shouldShowModelType = computed(() => props.configType !== "image" && modelTypeOptions.value.length > 1);
const shouldShowTokenPricing = computed(() => props.configType === "text");
const usesLocalAvatarMatting = computed(() => props.slotKey === "storyAvatarMattingModel" && isLocalBiRefNetManufacturer(form.manufacturer));
const shouldShowRemoteConfigFields = computed(() => !usesLocalAvatarMatting.value);
const isAutoDlTextConfig = computed(() => props.configType === "text" && isAutoDlTextManufacturer(form.manufacturer));
const autodlTextModelOptions = computed(() => store.state.settingsTextModelList.autodl_chat || []);

const slotRows = computed(() =>
  store
    .settingsConfigOptions(props.configType)
    .filter((item) => rowMatchesSlot(item)),
);

const recommendation = computed(() => store.settingsRecommendedModel(props.slotKey));
const advisory = computed(() => store.settingsModelAdvisory(props.slotKey));
const apiKeyPlaceholder = computed(() => {
  if (props.configType === "text" && form.manufacturer === "lmstudio") {
    return "本地 LM Studio 可留空";
  }
  if (props.slotKey === "storyAvatarMattingModel" && form.manufacturer === "local_birefnet") {
    return "本地模型无需填写";
  }
  if (!isApiKeyRequiredFor(form.manufacturer, props.configType)) {
    return "本地 ai_voice_tts 可留空";
  }
  if (props.slotKey === "storyAvatarMattingModel" && form.manufacturer === "aliyun_imageseg") {
    return "AccessKeyId|AccessKeySecret";
  }
  if (props.slotKey === "storyAvatarMattingModel" && form.manufacturer === "tencent_ci") {
    return "SecretId|SecretKey";
  }
  return "请输入 API Key";
});
const apiKeyHint = computed(() => {
  if (props.configType === "text" && form.manufacturer === "lmstudio") {
    return "LM Studio 运行在本机时不需要 API Key，Base URL 默认可填 http://127.0.0.1:1234/v1。";
  }
  if (props.slotKey === "storyAvatarMattingModel" && form.manufacturer === "aliyun_imageseg") {
    return "阿里云视觉这里不是单个 token。请填写 AccessKeyId|AccessKeySecret，或填写 {\"accessKeyId\":\"...\",\"accessKeySecret\":\"...\"}。";
  }
  if (props.slotKey === "storyAvatarMattingModel" && form.manufacturer === "bria") {
    return "Bria 这里填写平台生成的 API token。";
  }
  if (props.slotKey === "storyAvatarMattingModel" && form.manufacturer === "tencent_ci") {
    return "腾讯云这里请填写 SecretId|SecretKey；Base URL 请填标准 COS 桶域名，例如 https://bucket-appid.cos.ap-shanghai.myqcloud.com。";
  }
  if (props.slotKey === "storyAvatarMattingModel" && form.manufacturer === "local_birefnet") {
    return "本地 BiRefNet 不需要 Base URL 或 API Key。首次选择会提示安装 Python 依赖和模型文件，安装完成后即可直接使用。";
  }
  return "";
});

watch(
  () => props.modelValue,
  (value) => {
    if (value) {
      store.ensureSettingsPanelData();
      keyword.value = "";
      selectedId.value = slotRows.value.some((item) => item.id === (props.selectedId ?? null)) ? (props.selectedId ?? null) : null;
    }
  },
);

watch(
  () => props.selectedId,
  (value) => {
    selectedId.value = slotRows.value.some((item) => item.id === (value ?? null)) ? (value ?? null) : null;
  },
);

watch(
  () => [form.manufacturer, form.modelType, props.configType] as const,
  ([manufacturer, modelType, configType], [prevManufacturer, prevModelType]) => {
    const prevDefaultModel = defaultSlotModelName(prevManufacturer, prevModelType);
    if ((manufacturer !== prevManufacturer || modelType !== prevModelType) && (!editingId.value || !form.baseUrl.trim())) {
      form.baseUrl = defaultBaseUrlFor(manufacturer, configType, modelType);
    }
    if (
      manufacturer !== prevManufacturer ||
      modelType !== prevModelType
    ) {
      if (!editingId.value || !form.model.trim() || form.model === prevDefaultModel) {
        form.model = defaultSlotModelName(manufacturer, modelType);
      }
    }
  },
);

watch(
  () => form.manufacturer,
  async (value, oldValue) => {
    if (muteLocalManufacturerPrompt || props.slotKey !== "storyAvatarMattingModel" || !showEditor.value) {
      if (!isLocalBiRefNetManufacturer(value)) {
        localAvatarMattingStatus.value = null;
      }
      return;
    }
    if (!isLocalBiRefNetManufacturer(value)) {
      localAvatarMattingStatus.value = null;
      return;
    }
    try {
      const ready = await ensureLocalAvatarMattingInstalled(true);
      if (ready) {
        await refreshLocalAvatarMattingStatus();
        return;
      }
      muteLocalManufacturerPrompt = true;
      form.manufacturer = oldValue || defaultSlotManufacturer();
      queueMicrotask(() => {
        muteLocalManufacturerPrompt = false;
      });
    } catch (err) {
      store.state.notice = `本地 BiRefNet 安装失败: ${(err as Error).message}`;
      muteLocalManufacturerPrompt = true;
      form.manufacturer = oldValue || defaultSlotManufacturer();
      queueMicrotask(() => {
        muteLocalManufacturerPrompt = false;
      });
    }
  },
);

watch(
  () => [showEditor.value, form.manufacturer, form.model] as const,
  async ([visible, manufacturer, model]) => {
    if (isAutoDlTextConfig.value) {
      autodlModelPreset.value = autodlTextModelOptions.value.some((item) => item.value === model) ? String(model || "") : "__custom__";
    } else {
      autodlModelPreset.value = "__custom__";
    }
    if (!visible || !isLocalBiRefNetManufacturer(manufacturer)) {
      if (!visible) {
        localAvatarMattingStatus.value = null;
        localAvatarMattingInstalling.value = false;
      }
      return;
    }
    try {
      await refreshLocalAvatarMattingStatus();
    } catch (err) {
      store.state.notice = `读取本地 BiRefNet 状态失败: ${(err as Error).message}`;
    }
  },
);

const rows = computed(() =>
  slotRows.value
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

let muteLocalManufacturerPrompt = false;

async function refreshLocalAvatarMattingStatus(): Promise<LocalAvatarMattingStatus | null> {
  if (!usesLocalAvatarMatting.value) {
    localAvatarMattingStatus.value = null;
    return null;
  }
  const status = await store.fetchLocalAvatarMattingStatus(form.manufacturer, form.model.trim());
  localAvatarMattingStatus.value = status;
  return status;
}

async function ensureLocalAvatarMattingInstalled(interactive = true): Promise<boolean> {
  if (!usesLocalAvatarMatting.value) return true;
  const status = await refreshLocalAvatarMattingStatus();
  if (!status) return false;
  if (status.status === "installed") return true;
  if (status.status === "installing") {
    store.state.notice = status.message || "本地 BiRefNet 安装中，请稍候";
    return false;
  }
  if (!status.canInstall) {
    throw new Error(status.message || "当前环境无法安装本地 BiRefNet");
  }
  if (!interactive) return false;
  const confirmed = window.confirm(`${status.message || "首次使用需要安装本地 BiRefNet。"}\n\n确认后会自动安装 Python 依赖和模型文件。`);
  if (!confirmed) return false;
  localAvatarMattingInstalling.value = true;
  store.state.notice = "正在安装本地 BiRefNet，请稍候... pip install torch opencv-python pillow onnxruntime onnx";
  try {
    const installed = await store.installLocalAvatarMattingModel(form.manufacturer, form.model.trim());
    localAvatarMattingStatus.value = installed;
    store.state.notice = installed.message || "本地 BiRefNet 已安装";
    return installed.status === "installed";
  } finally {
    localAvatarMattingInstalling.value = false;
  }
}

async function installLocalAvatarMattingFromButton() {
  try {
    await ensureLocalAvatarMattingInstalled(true);
  } catch (err) {
    store.state.notice = `本地 BiRefNet 安装失败: ${(err as Error).message}`;
  }
}

function applyAutodlModelPreset(value: string) {
  autodlModelPreset.value = value;
  if (value !== "__custom__") {
    form.model = value;
  }
}

function normalizePriceInput(input: unknown): number {
  const value = Number(input || 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatPricePer1M(input: unknown, currency = "CNY"): string {
  const value = normalizePriceInput(input);
  if (value <= 0) return "-";
  return `${currency || "CNY"} ${value}/100万`;
}

function syncAutodlModelPreset(value?: string | null) {
  const model = String(value || form.model || "").trim();
  autodlModelPreset.value = autodlTextModelOptions.value.some((item) => item.value === model) ? model : "__custom__";
}

function close() {
  emit("update:modelValue", false);
}

function useRecommendation() {
  if (!recommendation.value?.id) return;
  selectedId.value = recommendation.value.id;
}

function openCreate() {
  editingId.value = null;
  form.manufacturer = defaultSlotManufacturer();
  form.modelType = defaultSlotModelType();
  form.model = defaultSlotModelName(form.manufacturer, form.modelType);
  form.baseUrl = defaultBaseUrlFor(form.manufacturer, props.configType, form.modelType);
  form.apiKey = "";
  form.inputPricePer1M = 0;
  form.outputPricePer1M = 0;
  form.cacheReadPricePer1M = 0;
  form.currency = "CNY";
  localAvatarMattingStatus.value = null;
  syncAutodlModelPreset(form.model);
  showEditor.value = true;
}

function openEdit(row: ModelConfigItem) {
  editingId.value = row.id;
  form.manufacturer = isVoiceDesignSlot() && !isVoiceDesignManufacturer(row.manufacturer)
    ? defaultSlotManufacturer()
    : (row.manufacturer || "other");
  form.modelType = isVoiceDesignSlot()
    ? defaultSlotModelType()
    : (row.modelType || defaultSlotModelType());
  form.model = isVoiceDesignSlot() && !isVoiceDesignModel(row.model)
    ? defaultSlotModelName(form.manufacturer, form.modelType)
    : (row.model || "");
  form.baseUrl = row.baseUrl || defaultBaseUrlFor(form.manufacturer, props.configType, form.modelType);
  form.apiKey = row.apiKey || "";
  form.inputPricePer1M = normalizePriceInput(row.inputPricePer1M);
  form.outputPricePer1M = normalizePriceInput(row.outputPricePer1M);
  form.cacheReadPricePer1M = normalizePriceInput(row.cacheReadPricePer1M);
  form.currency = String(row.currency || "CNY").trim().toUpperCase() || "CNY";
  localAvatarMattingStatus.value = null;
  syncAutodlModelPreset(form.model);
  showEditor.value = true;
}

async function submitEditor() {
  try {
    const manufacturer = isVoiceDesignSlot() ? defaultSlotManufacturer() : form.manufacturer;
    const modelType = isVoiceDesignSlot() ? defaultSlotModelType() : form.modelType;
    if (!form.model.trim()) {
      store.state.notice = "模型名称不能为空";
      return;
    }
    if (isApiKeyRequiredFor(manufacturer, props.configType) && !form.apiKey.trim()) {
      store.state.notice = "API Key 不能为空";
      return;
    }
    if (props.slotKey === "storyAvatarMattingModel" && isLocalBiRefNetManufacturer(manufacturer)) {
      const ready = await ensureLocalAvatarMattingInstalled(true);
      if (!ready) return;
    }
    if (editingId.value) {
      await store.updateManagedModelConfig({
        id: editingId.value,
        type: props.configType,
        manufacturer,
        modelType,
        model: form.model.trim(),
        baseUrl: shouldShowRemoteConfigFields.value ? form.baseUrl.trim() : "",
        apiKey: shouldShowRemoteConfigFields.value ? form.apiKey.trim() : "",
        inputPricePer1M: shouldShowTokenPricing.value ? normalizePriceInput(form.inputPricePer1M) : 0,
        outputPricePer1M: shouldShowTokenPricing.value ? normalizePriceInput(form.outputPricePer1M) : 0,
        cacheReadPricePer1M: shouldShowTokenPricing.value ? normalizePriceInput(form.cacheReadPricePer1M) : 0,
        currency: shouldShowTokenPricing.value ? (String(form.currency || "CNY").trim().toUpperCase() || "CNY") : "CNY",
      });
    } else {
      await store.addManagedModelConfig({
        type: props.configType,
        manufacturer,
        modelType,
        model: form.model.trim(),
        baseUrl: shouldShowRemoteConfigFields.value ? form.baseUrl.trim() : "",
        apiKey: shouldShowRemoteConfigFields.value ? form.apiKey.trim() : "",
        inputPricePer1M: shouldShowTokenPricing.value ? normalizePriceInput(form.inputPricePer1M) : 0,
        outputPricePer1M: shouldShowTokenPricing.value ? normalizePriceInput(form.outputPricePer1M) : 0,
        cacheReadPricePer1M: shouldShowTokenPricing.value ? normalizePriceInput(form.cacheReadPricePer1M) : 0,
        currency: shouldShowTokenPricing.value ? (String(form.currency || "CNY").trim().toUpperCase() || "CNY") : "CNY",
      });
    }
    showEditor.value = false;
  } catch (err) {
    store.state.notice = `保存模型配置失败: ${(err as Error).message}`;
  }
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
  try {
    if (!selectedId.value || !slotRows.value.some((row) => row.id === selectedId.value)) {
      store.state.notice = "请先选中一个模型配置";
      return;
    }
    const selectedRow = slotRows.value.find((row) => row.id === selectedId.value) || null;
    if (props.slotKey === "storyAvatarMattingModel" && selectedRow && isLocalBiRefNetManufacturer(selectedRow.manufacturer)) {
      const status = await store.fetchLocalAvatarMattingStatus(selectedRow.manufacturer || "", selectedRow.model || "");
      if (status.status !== "installed") {
        if (!status.canInstall) {
          store.state.notice = status.message || "当前环境无法安装本地 BiRefNet";
          return;
        }
        const confirmed = window.confirm(`${status.message || "本地 BiRefNet 尚未安装。"}\n\n确认后会自动安装，再继续绑定。`);
        if (!confirmed) return;
        localAvatarMattingInstalling.value = true;
        store.state.notice = "正在安装本地 BiRefNet，请稍候...";
        try {
          const installed = await store.installLocalAvatarMattingModel(selectedRow.manufacturer || "", selectedRow.model || "");
          if (installed.status !== "installed") {
            store.state.notice = installed.message || "本地 BiRefNet 尚未安装完成";
            return;
          }
        } finally {
          localAvatarMattingInstalling.value = false;
        }
      }
    }
    await store.bindGameModel(props.slotKey, selectedId.value);
    emit("confirmed");
    close();
  } catch (err) {
    store.state.notice = `保存模型配置失败: ${(err as Error).message}`;
  }
}
</script>

<template>
  <div v-if="modelValue" class="modal-backdrop" @click.self="close">
    <section class="modal-panel settings-model-manager">
      <div class="modal-header settings-modal-header settings-manager-header">
          <div>
          <div class="modal-title">模型数据管理</div>
          <div class="settings-manager-subtitle">{{ slotLabel }} · {{ displayKindLabel(configType) }}</div>
        </div>
        <button class="icon-btn settings-close-x" type="button" aria-label="关闭" @click="close">×</button>
      </div>

      <div class="modal-body settings-manager-body">
        <div
          v-if="advisory || recommendation"
          class="settings-manager-recommend"
        >
          <div class="settings-manager-recommend-copy">
            <div class="settings-manager-recommend-title">当前建议</div>
            <div v-if="advisory" class="settings-manager-recommend-text">{{ advisory.text }}</div>
            <div v-if="recommendation" class="settings-manager-recommend-model">
              推荐模型：{{ manufacturerLabel(recommendation.manufacturer || '') }} / {{ recommendation.model || `配置${recommendation.id}` }}
            </div>
          </div>
          <button
            v-if="recommendation && selectedId !== recommendation.id"
            class="button settings-outline-btn"
            type="button"
            @click="useRecommendation"
          >
            选中推荐
          </button>
        </div>

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
                <th v-if="configType === 'text'">单价</th>
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
                  <span class="settings-manager-type">{{ displayKindLabel(row.type || configType) }}</span>
                  <span v-if="shouldShowModelType" class="settings-manager-model-type">{{ displayModelTypeLabel(row.modelType || defaultModelTypeFor(configType)) }}</span>
                </td>
                <td>{{ row.model || `配置${row.id}` }}</td>
                <td class="settings-manager-url">{{ row.baseUrl || "默认" }}</td>
                <td class="settings-manager-key">
                  <span>{{ visibleKeys[row.id] ? (row.apiKey || "") : "••••••••" }}</span>
                  <button class="settings-key-toggle" type="button" @click.stop="visibleKeys[row.id] = !visibleKeys[row.id]">
                    {{ visibleKeys[row.id] ? "隐藏" : "显示" }}
                  </button>
                </td>
                <td v-if="configType === 'text'" class="settings-manager-url">
                  <div>输入：{{ formatPricePer1M(row.inputPricePer1M, row.currency || 'CNY') }}</div>
                  <div>输出：{{ formatPricePer1M(row.outputPricePer1M, row.currency || 'CNY') }}</div>
                  <div>缓存：{{ formatPricePer1M(row.cacheReadPricePer1M, row.currency || 'CNY') }}</div>
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
                <td class="settings-manager-empty" :colspan="configType === 'text' ? 9 : 8">暂无模型配置</td>
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
              <option v-for="item in manufacturerOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          <a v-if="manufacturerWebsite(form.manufacturer)" :href="manufacturerWebsite(form.manufacturer)" class="settings-help-link" target="_blank" rel="noreferrer">
            点击获取厂商 API
          </a>
        </div>
        <div v-if="shouldShowModelType" class="field">
          <label>类型</label>
          <select v-model="form.modelType" class="select">
            <option v-for="item in modelTypeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </div>
        <div class="field">
          <label>模型</label>
          <template v-if="isAutoDlTextConfig">
            <select
              v-model="autodlModelPreset"
              class="select"
              @change="applyAutodlModelPreset(autodlModelPreset)"
            >
              <option value="__custom__">手动输入模型标识</option>
              <option
                v-for="item in autodlTextModelOptions"
                :key="item.value"
                :value="item.value"
              >
                {{ item.label }}
              </option>
            </select>
            <input
              v-model="form.model"
              class="input"
              type="text"
              placeholder="也可直接输入 AutoDL 模型标识"
            />
            <div class="settings-field-hint">
              可先从下拉框选预设模型，也可以直接手动输入 AutoDL 支持的模型标识。
            </div>
          </template>
          <input
            v-else
            v-model="form.model"
            class="input"
            type="text"
            placeholder="请输入模型标识"
          />
        </div>
        <div v-if="usesLocalAvatarMatting" class="field">
          <label>本地安装</label>
          <div class="settings-local-model-card">
            <div class="settings-local-model-copy">
              <div class="settings-local-model-title">BiRefNet 本地模型</div>
              <div class="settings-local-model-text">
                {{ localAvatarMattingStatus?.message || '首次使用需要安装 Python 依赖和模型文件。' }}
              </div>
            </div>
            <button
              v-if="localAvatarMattingStatus?.status !== 'installed'"
              class="button settings-outline-btn"
              type="button"
              :disabled="localAvatarMattingInstalling || localAvatarMattingStatus?.canInstall === false"
              @click="installLocalAvatarMattingFromButton"
            >
              {{ localAvatarMattingInstalling ? '安装中' : (localAvatarMattingStatus?.status === 'failed' ? '重新安装' : '立即安装') }}
            </button>
          </div>
        </div>
        <div v-if="shouldShowRemoteConfigFields" class="field">
          <label>Base URL</label>
          <input v-model="form.baseUrl" class="input" type="text" placeholder="请输入 Base URL" />
        </div>
        <div v-if="shouldShowRemoteConfigFields" class="field">
          <label>API Key</label>
          <input
            v-model="form.apiKey"
            class="input"
            type="password"
            :placeholder="apiKeyPlaceholder"
          />
          <div v-if="apiKeyHint" class="settings-field-hint">{{ apiKeyHint }}</div>
        </div>
        <template v-if="shouldShowTokenPricing">
          <div class="field">
            <label>输入单价</label>
            <input v-model.number="form.inputPricePer1M" class="input" type="number" min="0" step="0.000001" placeholder="按每100万 token 计价" />
          </div>
          <div class="field">
            <label>输出单价</label>
            <input v-model.number="form.outputPricePer1M" class="input" type="number" min="0" step="0.000001" placeholder="按每100万 token 计价" />
          </div>
          <div class="field">
            <label>缓存命中单价</label>
            <input v-model.number="form.cacheReadPricePer1M" class="input" type="number" min="0" step="0.000001" placeholder="按每100万 token 计价，可留0" />
          </div>
          <div class="field">
            <label>货币</label>
            <input v-model="form.currency" class="input" type="text" placeholder="默认 CNY" />
            <div class="settings-field-hint">单价单位统一按每 100 万 token 计算，金额日志会按这里的配置实时换算。</div>
          </div>
        </template>
      </div>
      <div class="modal-actions">
        <button class="button settings-outline-btn" type="button" @click="showEditor = false">取消</button>
        <button class="button primary settings-solid-btn" type="button" :disabled="localAvatarMattingInstalling" @click="submitEditor">
          {{ localAvatarMattingInstalling ? '安装中' : '保存' }}
        </button>
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
