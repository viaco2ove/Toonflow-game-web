<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import { ToonflowApi } from "../api/toonflow";
import type { VoiceBindingDraft, VoiceMixItem } from "../types/toonflow";

const props = defineProps<{
  open: boolean;
  title: string;
  roleId?: string;
  initialLabel: string;
  initialPresetId?: string;
  initialMode?: string;
  initialReferenceAudioPath?: string;
  initialReferenceAudioName?: string;
  initialReferenceText?: string;
  initialPromptText?: string;
  initialMixVoices?: VoiceMixItem[];
  // 下次打开时用于下载的已生成音色 URL
  initialGeneratedDownloadUrl?: string;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "confirm", payload: VoiceBindingDraft): void;
}>();

const store = useToonflowStore();
const toonflowApi = new ToonflowApi(() => ({ baseUrl: store.state.baseUrl, token: store.state.token }));
const selectedPresetId = ref("");
const selectedMode = ref("text");
const referenceAudioPath = ref("");
const referenceAudioName = ref("");
const referenceText = ref("");
const promptText = ref("");
const DEFAULT_PREVIEW_TEXT = "恭喜，已成功复刻或生成了属于角色的声音！";
const previewText = ref(DEFAULT_PREVIEW_TEXT);
const previewStatus = ref("");
const previewLoading = ref(false);
const generateLoading = ref(false);
const polishLoading = ref(false);
const audioUploading = ref(false);
const mixVoices = ref<VoiceMixItem[]>([]);
const previewAudioUrl = ref("");
const previewPlayer = ref<HTMLAudioElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
let previewObjectUrl = "";
// 标记本次会话是否生成过音色文件，用于下次打开时依然可以下载
const hasGeneratedVoiceInSession = ref(false);
// 保存生成音色的下载 URL，供下次打开时使用
const generatedDownloadUrl = ref("");
// 阿里云 cosyvoice 预设音色搜索/过滤/分页
const aliyunPresetSearch = ref("");
const aliyunPresetGender = ref("all");
const aliyunPresetAge = ref("all");
const aliyunPresetPageIndex = ref(1);
const aliyunPresetPageSize = 10;
interface AliyunPresetRow {
  voice: string;
  name: string;
  scene: string;
  gender: string;
  age: string;
  language: string;
  model: string;
  family: string;
}
const aliyunPresetList = ref<AliyunPresetRow[]>([]);
const aliyunPresetTotal = ref(0);
const isAliyunDirectCosyVoice = computed(() => {
  const manufacturer = String(selectedModel.value?.manufacturer || "").trim();
  if (manufacturer !== "aliyun_direct") return false;
  const m = String(selectedModel.value?.model || "").trim();
  // 支持 CosyVoice 全系列 + Qwen TTS 全系列
  return m.startsWith("cosyvoice") || m.startsWith("qwen");
});
const aliyunPresetPage = computed(() => aliyunPresetList.value);
const aliyunPresetTotalPages = computed(() => Math.max(1, Math.ceil(aliyunPresetTotal.value / aliyunPresetPageSize)));
const aliyunPresetModel = ref("all"); // 默认全部模型
const aliyunPresetModels = ref<{ value: string; label: string; family: string }[]>([
  { value: "all", label: "全部模型", family: "all" },
]);
function onAliyunModelChange() {
  aliyunPresetPageIndex.value = 1;
  loadAliyunPresets();
}

// minimax 专用音色列表状态
const minimaxPresetList = ref<{ voice: string; name: string; voiceType: string; language: string; gender: string }[]>([]);
const minimaxPresetTotal = ref(0);
const minimaxPresetSearch = ref("");
const minimaxPresetVoiceType = ref("all");
const minimaxPresetGender = ref("all");
const minimaxPresetPageIndex = ref(1);
const isMiniMaxManufacturer = computed(() => {
  return String(selectedModel.value?.manufacturer || "").trim() === "minimax";
});
const minimaxPresetTotalPages = computed(() => Math.max(1, Math.ceil(minimaxPresetTotal.value / aliyunPresetPageSize)));
const modeOptions = [
  { key: "text", label: "预设音色" },
  { key: "clone", label: "克隆音色" },
  { key: "mix", label: "混合音色" },
  { key: "prompt_voice", label: "提示词音色" },
];

const runtimeStoryVoiceConfigId = computed(() => {
  const value = store.state.settingsAiModelMap.find((item) => item.key === "storyVoiceModel")?.configId;
  return value && value > 0 ? value : null;
});
const runtimeVoiceDesignConfigId = computed(() => {
  const value = store.state.settingsAiModelMap.find((item) => item.key === "storyVoiceDesignModel")?.configId;
  return value && value > 0 ? value : null;
});
const runtimeVoiceCloneConfigId = computed(() => {
  const value = store.state.settingsAiModelMap.find((item) => item.key === "storyVoiceCloneModel")?.configId;
  return value && value > 0 ? value : null;
});
const effectiveConfigId = computed(() => runtimeStoryVoiceConfigId.value);
const presets = computed(() => store.voicePresetsForConfig(effectiveConfigId.value));
const selectedModel = computed(() => store.state.voiceModels.find((item) => item.id === effectiveConfigId.value) || null);
const selectedPreset = computed(() => presets.value.find((item) => item.voiceId === selectedPresetId.value) || null);
const hasVoiceDesignModel = computed(() => !!runtimeVoiceDesignConfigId.value);
const hasVoiceCloneModel = computed(() => !!runtimeVoiceCloneConfigId.value);
const modelSupportedModes = computed(() => resolveModelSupportedModes(selectedModel.value));
const supportedModes = computed(() => {
  const modes = new Set(modelSupportedModes.value);
  if (!hasVoiceDesignModel.value) {
    modes.delete("prompt_voice");
  }
  return Array.from(modes);
});
const modeSupportNote = computed(() => {
  const notes: string[] = [];
  const supportedModelLabels = modeOptions
    .filter((item) => item.key !== "prompt_voice" && modelSupportedModes.value.includes(item.key))
    .map((item) => item.label);
  const unsupportedModelLabels = modeOptions.filter((item) => item.key !== "prompt_voice" && !modelSupportedModes.value.includes(item.key));
  if (unsupportedModelLabels.length && supportedModelLabels.length) {
    notes.push(`当前模型仅支持：${supportedModelLabels.join("、")}`);
  }
  if (!hasVoiceDesignModel.value) {
    notes.push("提示词音色需要先在设置里配置语音设计模型");
  }
  return notes.join("；");
});

function isAliyunDirectCosyVoiceModel(model?: string | null): boolean {
  const normalized = String(model || "").trim().toLowerCase();
  if (normalized.startsWith("cosyvoice")) return true;
  if (normalized.startsWith("qwen")) return true;
  return false;
}

/**
 * 判断当前试听文本是否满足 CosyVoice 的最小可播放要求。
 *
 * 用途：
 * - 后端会拒绝“纯编号 / 纯标点 / 纯空白”的试听文本；
 * - web 端提前拦截，避免用户点试听后才收到后端 InvalidParameter 报错。
 */
function isPlayableCosyVoicePreviewText(input?: string | null): boolean {
  const normalizedText = String(input || "").replace(/\s+/g, " ").trim();
  if (!normalizedText) return false;
  // 这里复用后端同口径的字符过滤规则，保证两端行为一致。
  const meaningfulText = normalizedText
    .replace(/\s+/g, "")
    .replace(/[0-9０-９.,!?;:，。！？；：、…·"'“”‘’`~!@#$%^&*()\-_=+\[\]{}<>\\/|]+/g, "");
  return !!meaningfulText;
}

function isAliyunDirectQwenVoiceCloneModel(model?: string | null): boolean {
  return String(model || "").trim().toLowerCase().startsWith("qwen3-tts-vc");
}

function isAliyunDirectQwenVoiceDesignModel(model?: string | null): boolean {
  return String(model || "").trim().toLowerCase().startsWith("qwen3-tts-vd");
}

function resolveModelSupportedModes(model: { manufacturer?: string | null; model?: string | null; modes?: string[] | null } | null): string[] {
  const declaredModes = Array.isArray(model?.modes)
    ? model.modes.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (declaredModes.length) return declaredModes;
  if (String(model?.manufacturer || "").trim() === "aliyun_direct") {
    const normalizedModel = String(model?.model || "").trim().toLowerCase();
    if (isAliyunDirectCosyVoiceModel(model?.model)) {
      return normalizedModel.startsWith("cosyvoice-v3.5")
        ? ["clone", "mix", "prompt_voice"]
        : ["text", "clone", "mix", "prompt_voice"];
    }
    if (isAliyunDirectQwenVoiceCloneModel(model?.model)) {
      return ["clone", "mix"];
    }
    if (isAliyunDirectQwenVoiceDesignModel(model?.model)) {
      return ["prompt_voice"];
    }
    return ["text"];
  }
  return modeOptions.map((item) => item.key);
}

function unsupportedModeReason(mode: string): string {
  const normalizedMode = String(mode || "").trim();
  if (!normalizedMode || !modelSupportedModes.value.includes(normalizedMode)) {
    return normalizedMode ? "当前语音模型不支持该绑定模式" : "";
  }
  if (normalizedMode === "prompt_voice" && !hasVoiceDesignModel.value) {
    return "请先在设置里配置语音设计模型";
  }
  if (supportedModes.value.includes(normalizedMode)) {
    return "";
  }
  return "当前语音模型不支持该绑定模式";
}

function fallbackSupportedMode(): string {
  return supportedModes.value.includes("text") ? "text" : supportedModes.value[0] || "text";
}

function ensureSelectedModeSupported(mode?: string | null) {
  const nextMode = modeOptions.some((item) => item.key === mode) ? String(mode) : selectedMode.value || "text";
  const reason = unsupportedModeReason(nextMode);
  if (!reason) {
    selectedMode.value = nextMode;
    return;
  }
  selectedMode.value = fallbackSupportedMode();
  if (props.open) {
    previewStatus.value = reason;
  }
}

function selectMode(mode: string) {
  const reason = unsupportedModeReason(mode);
  if (reason) {
    previewStatus.value = reason;
    return;
  }
  selectedMode.value = mode;
  previewStatus.value = "";
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      stopPreview();
      return;
    }
    await store.ensureSettingsPanelData();
    selectedPresetId.value = props.initialPresetId || "";
    selectedMode.value = modeOptions.some((item) => item.key === props.initialMode) ? (props.initialMode as string) : "text";
    referenceAudioPath.value = props.initialReferenceAudioPath || "";
    referenceAudioName.value = props.initialReferenceAudioName || "";
    referenceText.value = props.initialReferenceText || "";
    promptText.value = props.initialPromptText || "";
    mixVoices.value = [...(props.initialMixVoices || [])];
    previewText.value = DEFAULT_PREVIEW_TEXT;
    previewStatus.value = "";
    previewAudioUrl.value = "";
    // 如果有初始的已生成音色 URL，恢复下载能力
    if (props.initialGeneratedDownloadUrl || props.initialReferenceAudioPath) {
      generatedDownloadUrl.value = props.initialGeneratedDownloadUrl || props.initialReferenceAudioPath || "";
      hasGeneratedVoiceInSession.value = true;
    }
    await store.fetchVoiceModels();
    if (effectiveConfigId.value) {
      await store.fetchVoicePresets(effectiveConfigId.value);
    }
    ensureSelectedModeSupported(props.initialMode || selectedMode.value);
  },
  { immediate: true },
);

// 加载阿里云模型列表
async function loadAliyunModelList() {
  try {
    const data: any = await toonflowApi.postPublic<any>("/voice/listAliyunPresets/listAliyunModels", {});
    if (data?.items?.length) {
      aliyunPresetModels.value = data.items;
    }
  } catch { /* ignore */ }
}

// 加载阿里云预设音色
async function loadAliyunPresets() {
  if (!isAliyunDirectCosyVoice.value) {
    aliyunPresetList.value = [];
    aliyunPresetTotal.value = 0;
    return;
  }
  // 首次加载时拉取模型列表
  if (aliyunPresetModels.value.length <= 1) {
    await loadAliyunModelList();
  }
  const model = aliyunPresetModel.value || "all";
  try {
    const data: any = await toonflowApi.postPublic<any>("/voice/listAliyunPresets", {
      model,
      page: aliyunPresetPageIndex.value,
      pageSize: aliyunPresetPageSize,
      search: aliyunPresetSearch.value,
      gender: aliyunPresetGender.value,
      age: aliyunPresetAge.value,
    });
    aliyunPresetList.value = data?.items || [];
    aliyunPresetTotal.value = Number(data?.total || 0);
  } catch (err) {
    aliyunPresetList.value = [];
    aliyunPresetTotal.value = 0;
    previewStatus.value = `加载阿里云音色失败: ${(err as Error).message}`;
  }
}

async function loadMiniMaxPresets() {
  if (!isMiniMaxManufacturer.value) {
    minimaxPresetList.value = [];
    minimaxPresetTotal.value = 0;
    return;
  }
  const configId = effectiveConfigId.value;
  if (!configId) return;
  try {
    const data: any = await toonflowApi.postPublic<any>("/voice/listMiniMaxPresets", {
      configId,
      page: minimaxPresetPageIndex.value,
      pageSize: aliyunPresetPageSize,
      search: minimaxPresetSearch.value,
      voiceType: minimaxPresetVoiceType.value,
      gender: minimaxPresetGender.value,
    });
    minimaxPresetList.value = data?.items || [];
    minimaxPresetTotal.value = Number(data?.total || 0);
  } catch (err) {
    minimaxPresetList.value = [];
    minimaxPresetTotal.value = 0;
    previewStatus.value = `加载 minimax 音色失败: ${(err as Error).message}`;
  }
}

watch(
  [minimaxPresetSearch, minimaxPresetVoiceType, minimaxPresetGender],
  () => {
    minimaxPresetPageIndex.value = 1;
    loadMiniMaxPresets();
  },
);

watch(minimaxPresetPageIndex, () => loadMiniMaxPresets());

watch(
  [isMiniMaxManufacturer, () => props.open],
  () => {
    if (props.open && isMiniMaxManufacturer.value) {
      minimaxPresetPageIndex.value = 1;
      loadMiniMaxPresets();
    }
  },
  { immediate: true },
);

watch(
  [aliyunPresetSearch, aliyunPresetGender, aliyunPresetAge],
  () => {
    aliyunPresetPageIndex.value = 1;
    loadAliyunPresets();
  },
);

watch(
  aliyunPresetPageIndex,
  () => loadAliyunPresets(),
);

watch(
  [isAliyunDirectCosyVoice, () => props.open],
  () => {
    if (props.open && isAliyunDirectCosyVoice.value) {
      // 默认展示全部模型，用户可手动切换
      aliyunPresetModel.value = "all";
      aliyunPresetPageIndex.value = 1;
      loadAliyunPresets();
    }
  },
  { immediate: true },
);

watch(
  selectedModel,
  () => {
    if (!props.open) return;
    ensureSelectedModeSupported(selectedMode.value);
  },
  { immediate: true },
);

watch(
  [presets, selectedMode],
  ([nextPresets, mode]) => {
    if (mode !== "text" || !nextPresets.length) return;
    if (!selectedPresetId.value || !nextPresets.some((item) => item.voiceId === selectedPresetId.value)) {
      selectedPresetId.value = nextPresets[0].voiceId;
    }
  },
  { immediate: true },
);

function labelForSelected() {
  switch (selectedMode.value) {
    case "clone":
      return referenceAudioName.value ? `克隆：${referenceAudioName.value}` : "克隆音色";
    case "mix":
      return mixVoices.value.length ? `混合：${mixVoices.value.map((item) => presets.value.find((p) => p.voiceId === item.voiceId)?.name || item.voiceId).join(" + ")}` : "混合音色";
    case "prompt_voice":
      return promptText.value.trim() ? `提示词：${promptText.value.trim().slice(0, 12)}` : "提示词音色";
    default: {
      const preset = presets.value.find((item) => item.voiceId === selectedPresetId.value);
      if (preset?.name) return preset.name;
      const aliyunRow = aliyunPresetList.value.find((item) => item.voice === selectedPresetId.value);
      if (aliyunRow?.name) return aliyunRow.name;
      const minimaxRow = minimaxPresetList.value.find((item) => item.voice === selectedPresetId.value);
      if (minimaxRow?.name) return minimaxRow.name;
      return props.initialLabel || "预设音色";
    }
  }
}

function validate(): string | null {
  if (selectedMode.value === "prompt_voice" && !hasVoiceDesignModel.value) return "请先在设置里配置语音设计模型";
  if (!effectiveConfigId.value) return "请先在设置里配置语音生成模型";
  const modeReason = unsupportedModeReason(selectedMode.value);
  if (modeReason) return modeReason;
  if (selectedMode.value === "text" && !selectedPresetId.value) return "请先选择音色预设";
  if (selectedMode.value === "clone" && !referenceAudioPath.value) return "克隆模式需要上传参考音频";
  if (selectedMode.value === "mix" && !mixVoices.value.some((item) => item.voiceId)) return "混合模式至少选择一个音色";
  if (selectedMode.value === "prompt_voice" && !promptText.value.trim()) return "提示词模式需要填写提示词";
  if (!previewText.value.trim()) return "请输入试听文本";
  const isDirectCosyVoice = String(selectedModel.value?.manufacturer || "").trim() === "aliyun_direct"
    && isAliyunDirectCosyVoiceModel(selectedModel.value?.model);
  if (isDirectCosyVoice && !isPlayableCosyVoicePreviewText(previewText.value)) {
    return "当前阿里云语音试听文本不能只包含编号、标点或空白";
  }
  return null;
}

/**
 * 生成音色文件不依赖试听文本，但仍需要当前绑定模式本身是可用的。
 */
function validateGenerate(): string | null {
  if (selectedMode.value === "prompt_voice" && !hasVoiceDesignModel.value) return "请先在设置里配置语音设计模型";
  if (!effectiveConfigId.value) return "请先在设置里配置语音生成模型";
  const modeReason = unsupportedModeReason(selectedMode.value);
  if (modeReason) return modeReason;
  if (selectedMode.value === "text" && !selectedPresetId.value) return "请先选择音色预设";
  if (selectedMode.value === "clone" && !referenceAudioPath.value) return "克隆模式需要上传参考音频";
  if (selectedMode.value === "mix" && !mixVoices.value.some((item) => item.voiceId)) return "混合模式至少选择一个音色";
  if (selectedMode.value === "prompt_voice" && !promptText.value.trim()) return "提示词模式需要填写提示词";
  return null;
}

function revokePreviewObjectUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = "";
  }
}

async function chooseAudio(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  audioUploading.value = true;
  try {
    const uploaded = await store.uploadVoiceReferenceAudio(file);
    referenceAudioPath.value = uploaded.path;
    referenceAudioName.value = uploaded.name;
  } catch (err) {
    previewStatus.value = `参考音频上传失败: ${(err as Error).message}`;
  } finally {
    audioUploading.value = false;
    input.value = "";
  }
}

/**
 * 把后端返回的试听地址加载到浏览器播放器中。
 * 这样“直接试听”和“生成音色后再次试听”都复用同一套播放逻辑，避免两边行为漂移。
 */
async function loadPreviewAudioUrl(audioUrl: string) {
  if (!audioUrl) throw new Error("未返回试听音频");
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const contentType = String(response.headers.get("content-type") || "").trim().toLowerCase();
  if (contentType && !contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
    const detail = (await response.text().catch(() => "")).trim();
    throw new Error(detail || `返回了非音频内容: ${contentType}`);
  }
  const blob = await response.blob();
  if (!blob.size) {
    throw new Error("返回的音频内容为空");
  }
  const playableBlob = blob.type ? blob : new Blob([blob], { type: "audio/wav" });
  revokePreviewObjectUrl();
  previewObjectUrl = URL.createObjectURL(playableBlob);
  previewAudioUrl.value = previewObjectUrl;
  await nextTick();
  const audio = previewPlayer.value;
  if (!audio) throw new Error("播放器初始化失败");
  audio.pause();
  audio.currentTime = 0;
  audio.load();
  audio.onplay = () => (previewStatus.value = "正在播放试听");
  audio.onended = () => (previewStatus.value = "试听完成");
  audio.onerror = () => {
    previewAudioUrl.value = "";
    revokePreviewObjectUrl();
    previewStatus.value = "试听播放失败";
    previewLoading.value = false;
  };
  await audio.play();
}

/**
 * 用指定绑定参数向后端请求一段试听音频。
 * “直接试听”和“生成音色后用 clone 通道验证结果”都会走这里。
 */
async function requestPreviewAudio(options?: {
  mode?: string;
  presetId?: string;
  referenceAudioPath?: string;
  referenceText?: string;
  promptText?: string;
  mixVoices?: VoiceMixItem[];
}) {
  return store.previewVoice(
    effectiveConfigId.value,
    previewText.value.trim(),
    options?.mode || selectedMode.value,
    options?.presetId ?? selectedPresetId.value,
    options?.referenceAudioPath ?? referenceAudioPath.value,
    options?.referenceText ?? referenceText.value.trim(),
    options?.promptText ?? promptText.value.trim(),
    options?.mixVoices ?? mixVoices.value,
    {
      roleId: props.roleId || "",
    },
  );
}

async function playPreview() {
  const errorText = validate();
  if (errorText) {
    previewStatus.value = errorText;
    return;
  }
  previewLoading.value = true;
  previewStatus.value = "";
  try {
    const audioUrl = await requestPreviewAudio();
    await loadPreviewAudioUrl(audioUrl);
  } catch (err) {
    previewStatus.value = `试听失败: ${(err as Error).message}`;
  } finally {
    previewLoading.value = false;
  }
}

function stopPreview() {
  if (previewPlayer.value) {
    previewPlayer.value.pause();
    previewPlayer.value.currentTime = 0;
  }
  revokePreviewObjectUrl();
  previewAudioUrl.value = "";
  previewLoading.value = false;
  previewStatus.value = "已停止试听";
}

async function polishPrompt() {
  const source = promptText.value.trim() || props.initialLabel.trim();
  if (!source) {
    previewStatus.value = "请先输入提示词或角色名";
    return;
  }
  polishLoading.value = true;
  previewStatus.value = "";
  try {
    const polished = await store.polishVoicePrompt(source, {
      configId: effectiveConfigId.value,
      mode: selectedMode.value,
      provider: selectedPreset.value?.provider || "",
    });
    if (!polished) throw new Error("未返回润色结果");
    promptText.value = polished;
    previewStatus.value = "提示词已润色";
  } catch (err) {
    previewStatus.value = `AI润色失败: ${(err as Error).message}`;
  } finally {
    polishLoading.value = false;
  }
}

/**
 * 生成一个可复用的参考音频文件，并把路径写回当前角色绑定。
 * 后续调试/游玩都将优先把这个文件作为 clone 通道的参考音频。
 */
async function generateVoiceFile() {
  const errorText = validateGenerate();
  if (errorText) {
    previewStatus.value = errorText;
    return;
  }
  generateLoading.value = true;
  previewStatus.value = "";
  try {
    const generated = await store.generateVoiceBinding(
      effectiveConfigId.value,
      selectedMode.value,
      selectedPresetId.value,
      referenceAudioPath.value,
      referenceText.value.trim(),
      promptText.value.trim(),
      mixVoices.value,
      {
        roleId: props.roleId || "",
      },
    );
    if (!generated.audioPath) {
      throw new Error("未返回生成音色文件");
    }
    // 生成后的参考文件会被运行时 clone 通道复用，因此这里直接回写到绑定数据中。
    referenceAudioPath.value = generated.audioPath;
    referenceAudioName.value = generated.audioName || referenceAudioName.value || "generated_voice.wav";
    if (generated.referenceText) {
      referenceText.value = generated.referenceText;
    }
    // 生成出的文件只是 clone 参考源，真正给用户听的应该还是“当前试听文本”的成品音频。
    previewLoading.value = true;
    const previewUrl = await requestPreviewAudio({
      mode: "clone",
      presetId: generated.customVoiceId || "",
      referenceAudioPath: generated.audioPath,
      referenceText: generated.referenceText || referenceText.value.trim(),
      promptText: "",
      mixVoices: [],
    });
    await loadPreviewAudioUrl(previewUrl);
    previewStatus.value = "音色文件已生成，并已按当前试听文本重新试听";
    // 标记本次会话已生成音色，下次打开依然可以下载
    hasGeneratedVoiceInSession.value = true;
    // 保存下载 URL，下次打开时可以用 referenceAudioPath 下载生成的文件
    generatedDownloadUrl.value = previewUrl || generated.audioPath || "";
  } catch (err) {
    previewStatus.value = `生成音色失败: ${(err as Error).message}`;
  } finally {
    previewLoading.value = false;
    generateLoading.value = false;
  }
}

function downloadAudioName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = props.title.replace(/\s+/g, "").replace(/[^\w\u4e00-\u9fa5-]/g, "") || "voice_preview";
  return `${base}_${stamp}.wav`;
}

async function downloadPreviewAudio() {
  let url = previewAudioUrl.value.trim();
  // 如果没有试听音频但有生成过的音色文件，直接用该文件下载
  if (!url && hasGeneratedVoiceInSession.value) {
    url = generatedDownloadUrl.value.trim()
      || referenceAudioPath.value.trim()
      || (props.initialReferenceAudioPath ? props.initialReferenceAudioPath : "");
  }
  if (!url) {
    previewStatus.value = "请先试听或生成音色后再下载";
    return;
  }
  previewStatus.value = "正在准备下载...";
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = downloadAudioName();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    previewStatus.value = "下载已开始";
  } catch (err) {
    previewStatus.value = `下载失败: ${(err as Error).message}`;
  }
}

function openAudioPicker() {
  fileInput.value?.click();
}

function confirm() {
  const errorText = validate();
  if (errorText) {
    previewStatus.value = errorText;
    return;
  }
  emit("confirm", {
    label: labelForSelected(),
    presetId: selectedPresetId.value,
    mode: selectedMode.value,
    referenceAudioPath: referenceAudioPath.value,
    referenceAudioName: referenceAudioName.value,
    referenceText: referenceText.value.trim(),
    promptText: promptText.value.trim(),
    mixVoices: mixVoices.value.filter((item) => item.voiceId),
    generatedDownloadUrl: generatedDownloadUrl.value,
  });
}

function toggleMixVoice(voiceId: string) {
  const index = mixVoices.value.findIndex((item) => item.voiceId === voiceId);
  if (index >= 0) {
    mixVoices.value.splice(index, 1);
    if (!mixVoices.value.length) {
      mixVoices.value.push({ voiceId: "", weight: 0.7 });
    }
    return;
  }
  if (mixVoices.value.filter((item) => item.voiceId).length >= 3) {
    previewStatus.value = "最多只能混合 3 个音色";
    return;
  }
  const blankIndex = mixVoices.value.findIndex((item) => !item.voiceId);
  if (blankIndex >= 0) {
    mixVoices.value[blankIndex] = { voiceId, weight: 0.3 };
  } else {
    mixVoices.value.push({ voiceId, weight: 0.3 });
  }
}

onMounted(() => {
  store.fetchVoiceModels();
});

onBeforeUnmount(() => {
  stopPreview();
  revokePreviewObjectUrl();
});
</script>

<template>
  <div v-if="props.open" class="modal-backdrop voice-dialog-backdrop">
    <div class="modal-panel voice-dialog-panel">
      <div class="modal-header voice-dialog-header">
        <button class="voice-dialog-back" type="button" @click="emit('close')">返回</button>
        <div class="voice-dialog-title">{{ props.title }}</div>
        <span class="voice-dialog-hint">可试听</span>
      </div>
      <div class="modal-body voice-dialog-body">
        <div class="dialog-stack voice-dialog-stack">
          <section class="voice-dialog-section">
            <div class="voice-dialog-section__title">绑定模式</div>
            <div class="voice-dialog-list">
              <button
                v-for="mode in modeOptions"
                :key="mode.key"
                class="voice-dialog-select"
                :class="{ 'is-active': selectedMode === mode.key, 'is-disabled': !!unsupportedModeReason(mode.key) }"
                type="button"
                @click="selectMode(mode.key)"
              >
                {{ mode.label }}
              </button>
            </div>
            <div v-if="modeSupportNote" class="voice-dialog-note voice-dialog-note--warn">{{ modeSupportNote }}</div>
          </section>

          <section v-if="selectedMode === 'text'" class="voice-dialog-section">
            <div class="voice-dialog-section__title">音色预设</div>
            <div v-if="!effectiveConfigId" class="voice-dialog-note">请先在设置里配置语音生成模型。</div>
            <div v-else-if="!presets.length" class="voice-dialog-note">当前语音生成配置还没有返回可用音色。</div>
            <!-- 阿里云 cosyvoice 专用搜索列表 -->
            <div v-else-if="isAliyunDirectCosyVoice" class="voice-dialog-aliyun-presets">
              <div class="voice-dialog-preset-row">
                <select v-model="aliyunPresetModel" class="select voice-dialog-preset-filter" @change="onAliyunModelChange">
                  <option v-for="m in aliyunPresetModels" :key="m.value" :value="m.value">{{ m.label }}</option>
                </select>
              </div>
              <div class="voice-dialog-preset-row">
                <input
                  v-model="aliyunPresetSearch"
                  class="input voice-dialog-preset-search"
                  type="text"
                  placeholder="搜索音色名称或 voice id"
                />
                <select v-model="aliyunPresetGender" class="select voice-dialog-preset-filter">
                  <option value="all">全部性别</option>
                  <option value="male">男</option>
                  <option value="female">女</option>
                </select>
                <select v-model="aliyunPresetAge" class="select voice-dialog-preset-filter">
                  <option value="all">全部年龄</option>
                  <option value="child">儿童</option>
                  <option value="youth">少年</option>
                  <option value="adult">青年</option>
                  <option value="middle">中年</option>
                  <option value="elder">老年</option>
                </select>
              </div>
              <div class="voice-dialog-preset-list">
                <button
                  v-for="row in aliyunPresetPage"
                  :key="row.voice"
                  class="voice-dialog-preset-row-item"
                  :class="{ 'is-active': selectedPresetId === row.voice }"
                  type="button"
                  @click="selectedPresetId = row.voice"
                >
                  <span class="voice-dialog-preset-name">{{ row.name }}</span>
                  <span class="voice-dialog-preset-id">{{ row.voice }}</span>
                  <span v-if="row.family === 'business_preset'" class="voice-dialog-preset-scene" style="background:#e8f5e9;color:#2e7d32">预设克隆</span>
                  <span v-else-if="row.family === 'qwen_tts'" class="voice-dialog-preset-scene" style="background:#e3f2fd;color:#1565c0">Qwen</span>
                  <span v-else-if="row.model" class="voice-dialog-preset-scene">{{ row.model }}</span>
                  <span v-if="row.scene && row.family !== 'business_preset'" class="voice-dialog-preset-scene">{{ row.scene }}</span>
                </button>
              </div>
              <div v-if="aliyunPresetTotal === 0" class="voice-dialog-note">无匹配音色</div>
              <div v-else class="voice-dialog-preset-pager">
                <button class="button small" type="button" :disabled="aliyunPresetPageIndex <= 1" @click="aliyunPresetPageIndex = Math.max(1, aliyunPresetPageIndex - 1)">上一页</button>
                <span class="voice-dialog-preset-page-text">{{ aliyunPresetPageIndex }} / {{ aliyunPresetTotalPages }}（共 {{ aliyunPresetTotal }} 条）</span>
                <button class="button small" type="button" :disabled="aliyunPresetPageIndex >= aliyunPresetTotalPages" @click="aliyunPresetPageIndex = Math.min(aliyunPresetTotalPages, aliyunPresetPageIndex + 1)">下一页</button>
              </div>
            </div>
            <!-- minimax 专用搜索列表 -->
            <div v-else-if="isMiniMaxManufacturer" class="voice-dialog-aliyun-presets">
              <div class="voice-dialog-preset-row">
                <input
                  v-model="minimaxPresetSearch"
                  class="input voice-dialog-preset-search"
                  type="text"
                  placeholder="搜索 minimax 音色名称或 voice id"
                />
                <select v-model="minimaxPresetVoiceType" class="select voice-dialog-preset-filter">
                  <option value="all">全部类型</option>
                  <option value="business_preset">业务预设</option>
                  <option value="system">系统音色</option>
                  <option value="voice_cloning">克隆音色</option>
                  <option value="voice_generation">文生音色</option>
                </select>
                <select v-model="minimaxPresetGender" class="select voice-dialog-preset-filter">
                  <option value="all">全部性别</option>
                  <option value="male">男</option>
                  <option value="female">女</option>
                </select>
              </div>
              <div class="voice-dialog-preset-list">
                <button
                  v-for="row in minimaxPresetList"
                  :key="row.voice"
                  class="voice-dialog-preset-row-item"
                  :class="{ 'is-active': selectedPresetId === row.voice }"
                  type="button"
                  @click="selectedPresetId = row.voice"
                >
                  <span class="voice-dialog-preset-name">{{ row.name }}</span>
                  <span class="voice-dialog-preset-id">{{ row.voice }}</span>
                  <span v-if="row.voiceType" class="voice-dialog-preset-scene">{{ row.voiceType }}</span>
                </button>
              </div>
              <div v-if="minimaxPresetTotal === 0" class="voice-dialog-note">无匹配音色</div>
              <div v-else class="voice-dialog-preset-pager">
                <button class="button small" type="button" :disabled="minimaxPresetPageIndex <= 1" @click="minimaxPresetPageIndex = Math.max(1, minimaxPresetPageIndex - 1)">上一页</button>
                <span class="voice-dialog-preset-page-text">{{ minimaxPresetPageIndex }} / {{ minimaxPresetTotalPages }}（共 {{ minimaxPresetTotal }} 条）</span>
                <button class="button small" type="button" :disabled="minimaxPresetPageIndex >= minimaxPresetTotalPages" @click="minimaxPresetPageIndex = Math.min(minimaxPresetTotalPages, minimaxPresetPageIndex + 1)">下一页</button>
              </div>
            </div>
            <!-- 其他厂商用旧列表 -->
            <div v-else class="voice-dialog-list">
              <button
                v-for="preset in presets"
                :key="preset.voiceId"
                class="voice-dialog-select"
                :class="{ 'is-active': selectedPresetId === preset.voiceId }"
                type="button"
                @click="selectedPresetId = preset.voiceId"
              >
                {{ preset.name }}
              </button>
            </div>
          </section>

          <section v-else-if="selectedMode === 'clone'" class="voice-dialog-section">
            <div class="voice-dialog-section__title">参考音频</div>
            <div class="voice-dialog-note voice-dialog-note--warn">语音合成与语音克隆必须使用相同供应商和匹配的模型</div>
            <div class="voice-dialog-note">CosyVoice 音色只认该模型，换模型（包括 Qwen‑TTS）会导致音色无法使用</div>
            <input ref="fileInput" type="file" accept="audio/*" hidden @change="chooseAudio" />
            <button class="voice-dialog-upload" type="button" :disabled="audioUploading" @click="openAudioPicker">
              {{ audioUploading ? "上传中..." : "选择并上传音频" }}
            </button>
            <div class="voice-dialog-note">{{ referenceAudioName || '未选择参考音频' }}</div>
            <textarea v-model="referenceText" class="voice-dialog-textarea voice-dialog-textarea--short" rows="2" placeholder="参考音频对应文本（可选）"></textarea>
          </section>

          <section v-else-if="selectedMode === 'mix'" class="voice-dialog-section">
            <div class="voice-dialog-section__title">已选混合音色</div>
            <div class="voice-dialog-stack">
              <div v-for="(item, index) in mixVoices" :key="index" class="voice-dialog-mix-card">
                <div class="voice-dialog-mix-name">
                  {{ presets.find((item2) => item2.voiceId === item.voiceId)?.name || item.voiceId || '未选择音色' }}
                </div>
                <div class="voice-dialog-mix-actions">
                  <span class="voice-dialog-mix-weight">权重 {{ item.weight.toFixed(1) }}</span>
                  <button class="voice-dialog-inline-btn" type="button" @click="mixVoices[index].weight = Math.max(0.1, Number((mixVoices[index].weight - 0.1).toFixed(1)))">-</button>
                  <button class="voice-dialog-inline-btn" type="button" @click="mixVoices[index].weight = Math.min(1, Number((mixVoices[index].weight + 0.1).toFixed(1)))">+</button>
                  <button class="voice-dialog-inline-btn" type="button" @click="mixVoices.splice(index, 1); if (!mixVoices.length) mixVoices.push({ voiceId: '', weight: 0.7 });">删除</button>
                </div>
              </div>
            </div>
            <div class="voice-dialog-section__title voice-dialog-section__title--sub">可选预设</div>
            <div v-if="!effectiveConfigId" class="voice-dialog-note">请先在设置里配置语音生成模型。</div>
            <div v-else-if="!presets.length" class="voice-dialog-note">当前语音生成配置还没有返回可用音色。</div>
            <div v-else class="voice-dialog-list">
              <button
                v-for="preset in presets"
                :key="preset.voiceId"
                class="voice-dialog-select"
                :class="{ 'is-active': mixVoices.some((item) => item.voiceId === preset.voiceId) }"
                type="button"
                @click="toggleMixVoice(preset.voiceId)"
              >
                {{ mixVoices.some((item) => item.voiceId === preset.voiceId) ? `${preset.name} · 已加入` : preset.name }}
              </button>
            </div>
          </section>

          <section v-else class="voice-dialog-section">
            <div class="voice-dialog-section__head">
              <div class="voice-dialog-section__title">提示词</div>
              <button class="voice-dialog-inline-btn voice-dialog-inline-btn--accent" type="button" :disabled="polishLoading" @click="polishPrompt">
                {{ polishLoading ? "润色中..." : "AI润色" }}
              </button>
            </div>
            <textarea v-model="promptText" class="voice-dialog-textarea voice-dialog-textarea--prompt" rows="3" placeholder="例如：温柔、清亮、成熟、治愈、讲故事感"></textarea>
          </section>

          <section class="voice-dialog-section">
            <div class="voice-dialog-section__title">试听文本</div>
            <textarea v-model="previewText" class="voice-dialog-textarea voice-dialog-textarea--preview" rows="2" placeholder="输入要试听的文本"></textarea>
            <div class="voice-dialog-preview-actions">
              <button class="voice-dialog-preview-btn voice-dialog-preview-btn--primary" type="button" :disabled="previewLoading" @click="playPreview">{{ previewLoading ? '加载中...' : '试听' }}</button>
              <button class="voice-dialog-preview-btn" type="button" :disabled="!previewAudioUrl" @click="stopPreview">停止</button>
              <button class="voice-dialog-preview-btn  generated-timbre-btn" type="button" :disabled="generateLoading" @click="generateVoiceFile">{{ generateLoading ? '生成中...' : '生成音色文件' }}</button>
              <button v-if="previewAudioUrl || (hasGeneratedVoiceInSession && (referenceAudioPath || generatedDownloadUrl)) || (props.initialReferenceAudioPath && hasGeneratedVoiceInSession)" class="voice-dialog-preview-btn voice-dialog-preview-btn--download" type="button" @click="downloadPreviewAudio">下载音色</button>
            </div>
            <div v-if="previewStatus" class="voice-dialog-note">{{ previewStatus }}</div>
            <audio v-if="previewAudioUrl" ref="previewPlayer" class="voice-dialog-audio" :src="previewAudioUrl" controls preload="metadata"></audio>
          </section>
        </div>
      </div>
      <div class="modal-actions voice-dialog-actions">
        <button class="voice-dialog-text-btn" type="button" @click="emit('close')">取消</button>
        <button class="voice-dialog-confirm" type="button" @click="confirm">确定</button>
      </div>
    </div>
  </div>
</template>
