<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import { fileToDataUrl } from "../utils/file";
import { IMAGE_STYLE_PRESETS, imageStyleForKey, type ImageStylePreset } from "../utils/imageStyles";

const props = defineProps<{
  open: boolean;
  title: string;
  initialPrompt: string;
  initialStyleKey: string;
  initialReferences?: string[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "confirm", payload: { prompt: string; styleKey: string; references: string[] }): void;
}>();

const store = useToonflowStore();
const prompt = ref("");
const styleKey = ref("general_3");
const references = ref<string[]>([]);
const status = ref("");
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const selectedPreset = computed<ImageStylePreset>(() => imageStyleForKey(styleKey.value));

watch(
  () => props.open,
  (open) => {
    if (open) {
      prompt.value = props.initialPrompt || "";
      styleKey.value = props.initialStyleKey || "general_3";
      references.value = [...(props.initialReferences || [])];
      status.value = "";
    }
  },
  { immediate: true },
);

function addHint() {
  prompt.value = selectedPreset.value.promptHint;
}

async function onChooseFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  if (!files.length) return;
  uploading.value = true;
  try {
    const urls = await Promise.all(files.map((file) => fileToDataUrl(file)));
    urls.forEach((url) => {
      if (!references.value.includes(url)) {
        references.value.push(url);
      }
    });
  } catch (err) {
    status.value = (err as Error).message || "参考图添加失败";
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

async function askPolishPrompt() {
  const text = prompt.value.trim();
  if (!text) {
    status.value = "请先填写形象描述";
    return;
  }
  status.value = "AI 帮写中...";
  try {
    const result = await store.api.polishPrompt(text);
    prompt.value = result.prompt || result.text || text;
    status.value = "已生成润色描述";
  } catch (err) {
    status.value = `AI 帮写失败: ${(err as Error).message}`;
  }
}

function confirm() {
  if (props.loading) return;
  if (!prompt.value.trim()) {
    status.value = "请先填写形象描述";
    return;
  }
  emit("confirm", {
    prompt: prompt.value.trim(),
    styleKey: styleKey.value,
    references: [...references.value],
  });
}
</script>

<template>
  <div v-if="props.open" class="modal-backdrop">
    <div class="modal-panel fullscreen">
      <div class="modal-header">
        <button class="button small" type="button" :disabled="props.loading" @click="emit('close')">返回</button>
        <div style="font-weight:900;">{{ props.title }}</div>
        <span class="tiny">无参考图 = 文生图</span>
      </div>

      <div class="modal-body">
        <section class="card section soft">
          <div class="row-between">
            <div class="subtle">选择绘图风格</div>
            <div class="chip" :style="{ color: selectedPreset.accent, borderColor: selectedPreset.accent + '55' }">{{ selectedPreset.title }}</div>
          </div>
          <div class="grid-4" style="margin-top:10px;">
            <button
              v-for="item in IMAGE_STYLE_PRESETS"
              :key="item.key"
              class="card"
              type="button"
              style="padding:8px; border-radius:16px;"
              @click="styleKey = item.key"
            >
              <div class="story-cover" style="height:64px; border-radius:12px;" :style="{ background: `linear-gradient(135deg, ${item.colors[0]}, ${item.colors[1]})` }">
                <div v-if="styleKey === item.key" class="badge" style="position:absolute; top:6px; right:6px; left:auto; bottom:auto;">✓</div>
              </div>
              <div style="padding-top:6px; font-size:13px; font-weight:800;">{{ item.title }}</div>
              <div class="tiny">{{ item.subtitle }}</div>
            </button>
          </div>
        </section>

        <section class="card section stack-gap">
          <div class="row-between">
            <div class="subtle">形象描述</div>
            <button class="button small" type="button" :disabled="props.loading" @click="askPolishPrompt">AI帮写</button>
          </div>
          <textarea v-model="prompt" class="textarea" rows="6" :placeholder="selectedPreset.promptHint"></textarea>
          <div class="row-between">
            <span class="tiny">还可输入 {{ Math.max(0, 500 - prompt.length) }} 字</span>
            <span class="tiny">{{ prompt.length }}/500</span>
          </div>
        </section>

        <section class="card section stack-gap">
          <div class="subtle">参考图（可选）</div>
          <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onChooseFiles" />
          <div class="card story-cover" style="height:92px; border-radius:18px; border:1px solid var(--line); cursor:pointer;" @click="fileInput?.click()">
            <div v-if="references.length" class="placeholder" style="background:rgba(246,248,252,0.78); flex-direction:column; gap:4px;">
              <div style="font-weight:800;">已选择 {{ references.length }} 张参考图</div>
              <div class="tiny">继续添加会自动作为图生图参考</div>
            </div>
            <div v-else class="placeholder" style="flex-direction:column; gap:4px;">
              <div style="font-weight:800; font-size:20px;">+ 点击上传</div>
              <div class="tiny">不上传就是文生图</div>
            </div>
          </div>
          <div v-if="references.length" class="row">
            <button class="button small" type="button" :disabled="props.loading" @click="references = []">清空参考图</button>
          </div>
          <div class="row" style="gap:8px; flex-wrap: wrap;">
            <img v-for="(src, idx) in references" :key="idx" :src="src" alt="参考图" style="width:74px; height:74px; object-fit:cover; border-radius:14px; border:1px solid var(--line);" />
          </div>
          <div v-if="status" class="subtle">{{ status }}</div>
        </section>
      </div>

      <div class="modal-actions">
        <button class="button" type="button" :disabled="props.loading" @click="emit('close')">取消</button>
        <button class="button accent" type="button" :disabled="props.loading || !prompt.trim()" @click="confirm">
          {{ props.loading ? "生成中..." : "重新生成" }}
        </button>
      </div>
    </div>
  </div>
</template>
