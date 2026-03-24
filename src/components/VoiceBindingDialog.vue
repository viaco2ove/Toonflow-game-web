<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import type { VoiceBindingDraft, VoiceMixItem } from "../types/toonflow";

const props = defineProps<{
  open: boolean;
  title: string;
  initialLabel: string;
  initialConfigId?: number | null;
  initialPresetId?: string;
  initialMode?: string;
  initialReferenceAudioPath?: string;
  initialReferenceAudioName?: string;
  initialReferenceText?: string;
  initialPromptText?: string;
  initialMixVoices?: VoiceMixItem[];
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "confirm", payload: VoiceBindingDraft): void;
}>();

const store = useToonflowStore();
const selectedConfigId = ref<number | null>(null);
const selectedPresetId = ref("");
const selectedMode = ref("text");
const referenceAudioPath = ref("");
const referenceAudioName = ref("");
const referenceText = ref("");
const promptText = ref("");
const previewText = ref("你好，很高兴见到你。");
const previewStatus = ref("");
const previewLoading = ref(false);
const audioUploading = ref(false);
const mixVoices = ref<VoiceMixItem[]>([]);
const audioElement = ref<HTMLAudioElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const modeOptions = [
  { key: "text", label: "预设音色" },
  { key: "clone", label: "克隆音色" },
  { key: "mix", label: "混合音色" },
  { key: "prompt_voice", label: "提示词音色" },
];

const presets = computed(() => store.voicePresetsForConfig(selectedConfigId.value));

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      stopPreview();
      return;
    }
    selectedConfigId.value = props.initialConfigId ?? null;
    selectedPresetId.value = props.initialPresetId || "";
    selectedMode.value = props.initialMode || "text";
    referenceAudioPath.value = props.initialReferenceAudioPath || "";
    referenceAudioName.value = props.initialReferenceAudioName || "";
    referenceText.value = props.initialReferenceText || "";
    promptText.value = props.initialPromptText || "";
    mixVoices.value = [...(props.initialMixVoices || [])];
    previewText.value = props.initialLabel ? `你好，我是${props.initialLabel}` : "你好，很高兴见到你。";
    previewStatus.value = "";
    await store.fetchVoiceModels();
    if (!selectedConfigId.value && store.state.voiceModels.length) {
      selectedConfigId.value = store.state.voiceModels[0].id;
    }
    if (selectedConfigId.value) {
      await store.fetchVoicePresets(selectedConfigId.value);
    }
  },
  { immediate: true },
);

watch(selectedConfigId, async (configId) => {
  if (configId) {
    await store.fetchVoicePresets(configId);
  }
});

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
      return preset?.name || props.initialLabel || "预设音色";
    }
  }
}

function validate(): string | null {
  if (!selectedConfigId.value) return "请先选择语音模型";
  if (selectedMode.value === "text" && !selectedPresetId.value) return "请先选择音色预设";
  if (selectedMode.value === "clone" && !referenceAudioPath.value) return "克隆模式需要上传参考音频";
  if (selectedMode.value === "mix" && !mixVoices.value.some((item) => item.voiceId)) return "混合模式至少选择一个音色";
  if (selectedMode.value === "prompt_voice" && !promptText.value.trim()) return "提示词模式需要填写提示词";
  if (!previewText.value.trim()) return "请输入试听文本";
  return null;
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

async function playPreview() {
  const errorText = validate();
  if (errorText) {
    previewStatus.value = errorText;
    return;
  }
  previewLoading.value = true;
  previewStatus.value = "";
  try {
    const audioUrl = await store.previewVoice(
      selectedConfigId.value,
      previewText.value.trim(),
      selectedMode.value,
      selectedPresetId.value,
      referenceAudioPath.value,
      referenceText.value.trim(),
      promptText.value.trim(),
      mixVoices.value,
    );
    if (!audioUrl) throw new Error("未返回试听音频");
    if (audioElement.value) {
      audioElement.value.pause();
      audioElement.value = null;
    }
    const audio = new Audio(audioUrl);
    audioElement.value = audio;
    audio.onplay = () => (previewStatus.value = "正在播放试听");
    audio.onended = () => (previewStatus.value = "试听完成");
    audio.onerror = () => {
      previewStatus.value = "试听播放失败";
      previewLoading.value = false;
    };
    await audio.play();
  } catch (err) {
    previewStatus.value = `试听失败: ${(err as Error).message}`;
  } finally {
    previewLoading.value = false;
  }
}

function stopPreview() {
  if (audioElement.value) {
    audioElement.value.pause();
    audioElement.value = null;
  }
  previewLoading.value = false;
  previewStatus.value = "已停止试听";
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
    configId: selectedConfigId.value,
    presetId: selectedPresetId.value,
    mode: selectedMode.value,
    referenceAudioPath: referenceAudioPath.value,
    referenceAudioName: referenceAudioName.value,
    referenceText: referenceText.value.trim(),
    promptText: promptText.value.trim(),
    mixVoices: mixVoices.value.filter((item) => item.voiceId),
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
            <div class="voice-dialog-section__title">语音模型</div>
            <div v-if="store.state.voiceModels.length" class="voice-dialog-list">
              <button
                v-for="model in store.state.voiceModels"
                :key="model.id"
                class="voice-dialog-select"
                :class="{ 'is-active': selectedConfigId === model.id }"
                type="button"
                @click="selectedConfigId = model.id; selectedPresetId = ''"
              >
                {{ model.model || "未命名模型" }} <span v-if="model.manufacturer">· {{ model.manufacturer }}</span>
              </button>
            </div>
            <div v-else class="voice-dialog-note">未加载到语音模型，请先在设置中配置 voice 模型。</div>
          </section>

          <section class="voice-dialog-section">
            <div class="voice-dialog-section__title">绑定模式</div>
            <div class="voice-dialog-list">
              <button
                v-for="mode in modeOptions"
                :key="mode.key"
                class="voice-dialog-select"
                :class="{ 'is-active': selectedMode === mode.key }"
                type="button"
                @click="selectedMode = mode.key"
              >
                {{ mode.label }}
              </button>
            </div>
          </section>

          <section v-if="selectedMode === 'text'" class="voice-dialog-section">
            <div class="voice-dialog-section__title">音色预设</div>
            <div v-if="!presets.length" class="voice-dialog-note">当前模型还没有返回可用音色。</div>
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
            <div v-if="!presets.length" class="voice-dialog-note">当前模型还没有返回可用音色。</div>
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
            <div class="voice-dialog-section__title">提示词</div>
            <textarea v-model="promptText" class="voice-dialog-textarea voice-dialog-textarea--prompt" rows="3" placeholder="例如：温柔、清亮、成熟、治愈、讲故事感"></textarea>
          </section>

          <section class="voice-dialog-section">
            <div class="voice-dialog-section__title">试听文本</div>
            <textarea v-model="previewText" class="voice-dialog-textarea voice-dialog-textarea--preview" rows="2" placeholder="输入要试听的文本"></textarea>
            <div class="voice-dialog-preview-actions">
              <button class="voice-dialog-preview-btn voice-dialog-preview-btn--primary" type="button" :disabled="previewLoading" @click="playPreview">{{ previewLoading ? '加载中...' : '试听' }}</button>
              <button class="voice-dialog-preview-btn" type="button" :disabled="!previewStatus && !audioElement" @click="stopPreview">停止</button>
            </div>
            <div v-if="previewStatus" class="voice-dialog-note">{{ previewStatus }}</div>
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
