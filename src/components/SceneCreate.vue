<script setup lang="ts">
import { computed, ref } from "vue";
import ImageGenerateDialog from "./ImageGenerateDialog.vue";
import StoryCover from "./StoryCover.vue";
import VoiceBindingDialog from "./VoiceBindingDialog.vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import type { VoiceBindingDraft } from "../types/toonflow";
import { imageStyleForKey } from "../utils/imageStyles";

type ImageTarget = "user" | "cover" | "chapter" | "npc";
type VoiceTarget = "player" | "narrator" | "npc";

const store = useToonflowStore();
const showAdvanced = ref(false);
const storyCoverInput = ref<HTMLInputElement | null>(null);
const chapterBgInput = ref<HTMLInputElement | null>(null);
const userAvatarInput = ref<HTMLInputElement | null>(null);
const npcAvatarInputs = ref<Record<number, HTMLInputElement | null>>({});
const imageDialogTarget = ref<ImageTarget | null>(null);
const imageDialogNpcIndex = ref<number | null>(null);
const voiceDialogTarget = ref<VoiceTarget | null>(null);
const voiceDialogNpcIndex = ref<number | null>(null);

const coverAiPrompt = computed(() => store.state.worldIntro || store.state.worldName || "故事封面");

const imageDialogOpen = computed(() => imageDialogTarget.value !== null);
const voiceDialogOpen = computed(() => voiceDialogTarget.value !== null);

const imageDialogState = computed(() => {
  switch (imageDialogTarget.value) {
    case "user":
      return {
        title: "用户头像",
        initialPrompt: store.state.playerDesc || store.state.playerName || "用户头像",
        initialStyleKey: "general_3",
      };
    case "cover":
      return {
        title: "故事封面",
        initialPrompt: coverAiPrompt.value,
        initialStyleKey: "cinema",
      };
    case "chapter":
      return {
        title: "章节背景图",
        initialPrompt: store.state.chapterContent || store.state.chapterTitle || "章节背景图",
        initialStyleKey: "cinema",
      };
    case "npc": {
      const role = typeof imageDialogNpcIndex.value === "number" ? store.state.npcRoles[imageDialogNpcIndex.value] : null;
      return {
        title: role ? `${role.name || "角色"}头像` : "角色头像",
        initialPrompt: role?.description || role?.sample || role?.name || "角色头像",
        initialStyleKey: "general_3",
      };
    }
    default:
      return {
        title: "图片生成",
        initialPrompt: "角色头像",
        initialStyleKey: "general_3",
      };
  }
});

const voiceDialogState = computed(() => {
  switch (voiceDialogTarget.value) {
    case "player":
      return {
        title: "用户角色音色",
        initialLabel: store.state.playerName || "用户",
        initialConfigId: store.state.playerVoiceConfigId,
        initialPresetId: store.state.playerVoicePresetId,
        initialMode: store.state.playerVoiceMode,
        initialReferenceAudioPath: store.state.playerVoiceReferenceAudioPath,
        initialReferenceAudioName: store.state.playerVoiceReferenceAudioName,
        initialReferenceText: store.state.playerVoiceReferenceText,
        initialPromptText: store.state.playerVoicePromptText,
        initialMixVoices: store.state.playerVoiceMixVoices,
      };
    case "narrator":
      return {
        title: "旁白音色",
        initialLabel: store.state.narratorName || "旁白",
        initialConfigId: store.state.narratorVoiceConfigId,
        initialPresetId: store.state.narratorVoicePresetId,
        initialMode: store.state.narratorVoiceMode,
        initialReferenceAudioPath: store.state.narratorVoiceReferenceAudioPath,
        initialReferenceAudioName: store.state.narratorVoiceReferenceAudioName,
        initialReferenceText: store.state.narratorVoiceReferenceText,
        initialPromptText: store.state.narratorVoicePromptText,
        initialMixVoices: store.state.narratorVoiceMixVoices,
      };
    case "npc": {
      const role = typeof voiceDialogNpcIndex.value === "number" ? store.state.npcRoles[voiceDialogNpcIndex.value] : null;
      return {
        title: role ? `${role.name || "角色"}音色` : "角色音色",
        initialLabel: role?.name || "角色",
        initialConfigId: role?.voiceConfigId ?? null,
        initialPresetId: role?.voicePresetId || "",
        initialMode: role?.voiceMode || "text",
        initialReferenceAudioPath: role?.voiceReferenceAudioPath || "",
        initialReferenceAudioName: role?.voiceReferenceAudioName || "",
        initialReferenceText: role?.voiceReferenceText || "",
        initialPromptText: role?.voicePromptText || "",
        initialMixVoices: role?.voiceMixVoices || [],
      };
    }
    default:
      return {
        title: "选择音色",
        initialLabel: "角色",
        initialConfigId: null,
        initialPresetId: "",
        initialMode: "text",
        initialReferenceAudioPath: "",
        initialReferenceAudioName: "",
        initialReferenceText: "",
        initialPromptText: "",
        initialMixVoices: [],
      };
  }
});

function onUserAvatarFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    void store.updateAvatarFromFile("user", file);
  }
  input.value = "";
}

function onCoverFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    void store.updateCoverFromFile(file);
  }
  input.value = "";
}

function onChapterBgFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    void store.updateChapterBackgroundFromFile(file);
  }
  input.value = "";
}

function onNpcAvatarFile(index: number, e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    void store.updateAvatarFromFile("npc", file, undefined, index);
  }
  input.value = "";
}

function openImageDialog(target: ImageTarget, index: number | null = null) {
  imageDialogTarget.value = target;
  imageDialogNpcIndex.value = index;
}

function closeImageDialog() {
  imageDialogTarget.value = null;
  imageDialogNpcIndex.value = null;
}

function openVoiceDialog(target: VoiceTarget, index: number | null = null) {
  voiceDialogTarget.value = target;
  voiceDialogNpcIndex.value = index;
}

function closeVoiceDialog() {
  voiceDialogTarget.value = null;
  voiceDialogNpcIndex.value = null;
}

async function handleImageConfirm(payload: { prompt: string; styleKey: string; references: string[] }) {
  const target = imageDialogTarget.value;
  if (!target) return;
  const style = imageStyleForKey(payload.styleKey);
  const mergedPrompt = [`风格：${style.title}`, payload.prompt].filter(Boolean).join("，");
  try {
    if (target === "user") {
      await store.applyImageToTarget("user", mergedPrompt, payload.references, store.state.playerName || "用户");
    } else if (target === "cover") {
      await store.applyImageToTarget("cover", mergedPrompt, payload.references, store.state.worldName || "故事封面");
    } else if (target === "chapter") {
      await store.applyImageToTarget("chapter", mergedPrompt, payload.references, store.state.chapterTitle || "章节背景图");
    } else if (target === "npc" && typeof imageDialogNpcIndex.value === "number") {
      const role = store.state.npcRoles[imageDialogNpcIndex.value];
      if (role) {
        await store.applyImageToTarget("npc", mergedPrompt, payload.references, role.name || "角色", (path, bgPath) => {
          store.setNpcRoleAvatar(imageDialogNpcIndex.value as number, path, bgPath);
        });
      }
    }
    store.state.notice = "图片已更新";
  } catch (err) {
    store.state.notice = `AI 生图失败: ${(err as Error).message}`;
  } finally {
    closeImageDialog();
  }
}

function handleVoiceConfirm(binding: VoiceBindingDraft) {
  const target = voiceDialogTarget.value;
  if (!target) return;
  if (target === "player") {
    store.setPlayerVoiceBinding(binding);
  } else if (target === "narrator") {
    store.setNarratorVoiceBinding(binding);
  } else if (target === "npc" && typeof voiceDialogNpcIndex.value === "number") {
    store.setNpcRoleVoice(voiceDialogNpcIndex.value, binding);
  }
  store.state.notice = "音色已更新";
  closeVoiceDialog();
}
</script>

<template>
  <section class="surface section-block">
    <div class="row-between">
      <div>
        <h2 class="section-title">故事设定</h2>
      </div>
      <div class="row">
        <button class="button small" type="button" @click="store.state.createStep = store.state.createStep === 0 ? 1 : 0">下一步</button>
      </div>
    </div>
  </section>

  <section v-if="store.state.createStep === 1" class="stack-gap">
    <section class="surface section-block">
      <div class="row-between">
        <div>
          <div class="section-title" style="font-size:16px;">基本信息</div>
          <div class="subtle">故事图标、名称、简介。</div>
        </div>
        <button class="button small" type="button" @click="store.state.createStep = 0">返回</button>
      </div>

      <div class="stack-gap">
        <div class="field">
          <label>故事图标</label>
          <div class="row" style="align-items:flex-start;">
            <div class="story-cover" style="width:100%; max-width: 320px; height: 160px; border-radius: 18px; border:1px solid var(--line);">
              <StoryCover :title="store.state.worldName || '故事'" :cover-path="store.resolveMediaPath(store.state.worldCoverPath)" empty-text="故事图标" />
            </div>
            <div class="dialog-stack" style="min-width: 160px;">
              <input ref="storyCoverInput" type="file" accept="image/*" hidden @change="onCoverFile" />
              <input ref="chapterBgInput" type="file" accept="image/*" hidden @change="onChapterBgFile" />
              <button class="button block" type="button" @click="storyCoverInput?.click()">上传图片</button>
              <button class="button block" type="button" @click="openImageDialog('cover')">AI 生图</button>
            </div>
          </div>
        </div>

        <div class="field">
          <label>故事名称</label>
          <input v-model="store.state.worldName" class="input" type="text" placeholder="输入故事名称" />
        </div>
        <div class="field">
          <label>故事简介</label>
          <textarea v-model="store.state.worldIntro" class="textarea" rows="5" placeholder="输入故事简介"></textarea>
        </div>
        <div class="row">
          <button class="button" type="button" @click="store.state.createStep = 0">返回</button>
          <button class="button" type="button" @click="store.saveStoryEditor(false, false, '故事草稿已保存')">存草稿</button>
          <button class="button primary" type="button" @click="store.saveStoryEditor(true, false, '故事已发布并可游玩')">发布</button>
        </div>
      </div>
    </section>
  </section>

  <section v-else class="stack-gap">
    <section class="surface section-block">
      <div class="section-title" style="font-size:16px;">角色（用户固定，旁白单独）</div>
      <div class="split">
        <div class="surface section-block surface-soft">
          <div class="row-between">
            <div class="row">
              <div class="avatar" style="width:64px; height:64px;" @click="userAvatarInput?.click()">
                <img v-if="store.state.userAvatarPath" :src="store.resolveMediaPath(store.state.userAvatarPath)" />
                <div v-else class="placeholder">U</div>
                <div class="badge">+</div>
              </div>
              <input ref="userAvatarInput" type="file" accept="image/*" hidden @change="onUserAvatarFile" />
              <div>
                <div class="chip active">用户</div>
                <div class="tiny">点击上传 / AI 生图</div>
              </div>
            </div>
            <button class="button small" type="button" @click="openImageDialog('user')">AI 生图</button>
          </div>
          <div class="field stack-gap">
            <label>角色名</label>
            <input v-model="store.state.playerName" class="input" type="text" placeholder="用户" />
          </div>
          <div class="field stack-gap">
            <label>角色设定</label>
            <textarea v-model="store.state.playerDesc" class="textarea" rows="3" placeholder="用户在故事中的主视角角色"></textarea>
          </div>
          <div class="field stack-gap">
            <label>角色音色</label>
            <div class="row">
              <input :value="store.state.playerVoice || '未选择音色'" class="input" type="text" readonly />
              <button class="button small" type="button" @click="openVoiceDialog('player')">选择音色</button>
            </div>
          </div>
        </div>

        <div class="surface section-block surface-soft">
          <div class="row-between">
            <div class="chip">旁白</div>
            <button class="button small" type="button" @click="openVoiceDialog('narrator')">选择音色</button>
          </div>
          <div class="field stack-gap">
            <label>旁白名称</label>
            <input v-model="store.state.narratorName" class="input" type="text" />
          </div>
          <div class="field stack-gap">
            <label>旁白音色</label>
            <div class="row">
              <input :value="store.state.narratorVoice || '默认旁白'" class="input" type="text" readonly />
              <button class="button small" type="button" @click="openVoiceDialog('narrator')">选择音色</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="surface section-block">
      <div class="row-between">
        <div>
          <div class="section-title" style="font-size:16px;">章节 1</div>
        </div>
        <div class="row">
          <button class="button small" type="button" @click="store.selectChapter(null)">新章节</button>
          <button class="button small" type="button" @click="store.startDebugCurrentChapter()">调试</button>
        </div>
      </div>

      <div class="dialog-stack">
        <div class="field">
          <label>章节进入条件</label>
          <textarea v-model="store.state.chapterEntryCondition" class="textarea" rows="3" placeholder="章节开始前的进入条件，可选 JSON 或文本。"></textarea>
        </div>
        <div class="field">
          <label>章节标题</label>
          <input v-model="store.state.chapterTitle" class="input" type="text" placeholder="章节标题" />
        </div>
        <div class="field">
          <label>章节开场白角色</label>
          <select v-model="store.state.chapterOpeningRole" class="select">
            <option v-for="role in store.mentionRoleNames()" :key="role" :value="role">{{ role }}</option>
          </select>
        </div>
        <div class="field">
          <label>开场白</label>
          <textarea v-model="store.state.chapterOpeningLine" class="textarea" rows="3" placeholder="作为选定角色/旁白的第一句话开启整个故事"></textarea>
        </div>
        <div class="field">
          <label>章节内容</label>
          <textarea v-model="store.state.chapterContent" class="textarea" rows="6" placeholder="描述主要情节，提及时请使用角色原名或用户，不要使用“你”来代称。"></textarea>
        </div>
        <div class="field">
          <label>成功条件（结局）</label>
          <textarea v-model="store.state.chapterCondition" class="textarea" rows="4" placeholder="只有用户达成该条件才进入下一章节。为空代表无结束。"></textarea>
        </div>
        <div class="row">
          <button class="button" type="button" @click="store.saveCurrentChapterAndSelect(null)">添加下一章节</button>
          <button class="button primary" type="button" @click="store.saveChapterDraft()">保存章节</button>
        </div>
      </div>
    </section>

    <section class="surface section-block">
      <div class="row-between">
        <div class="section-title" style="font-size:16px;">章节列表</div>
      </div>
      <div class="surface surface-soft section-block" style="padding:12px; margin-bottom:12px;">
        <div class="row-between">
          <div>
            <div style="font-weight:900;">当前章节</div>
            <div class="tiny">
              {{ store.state.selectedChapterId ? `${store.state.chapterTitle || '未命名章节'} · #${store.state.selectedChapterId}` : '新章节草稿' }}
            </div>
          </div>
          <button class="button small" type="button" @click="store.saveCurrentChapterAndSelect(null)">保存并下一章</button>
        </div>
      </div>
      <div class="tag-row">
        <button
          v-for="chapter in store.state.chapters"
          :key="chapter.id"
          class="chip"
          :class="{ active: store.state.selectedChapterId === chapter.id }"
          type="button"
          @click="store.selectChapter(chapter.id)"
        >
          {{ chapter.title || `章节 ${chapter.sort || 0}` }}
          <span class="tiny">{{ chapter.status || 'draft' }}</span>
        </button>
        <button class="chip" type="button" @click="store.selectChapter(null)">新章节</button>
      </div>
    </section>

    <section class="surface section-block">
      <div class="row-between">
        <div>
          <div class="section-title" style="font-size:16px;">旁白面板</div>
        </div>
      </div>
      <div class="field">
        <label>旁白背景</label>
        <textarea v-model="store.state.globalBackground" class="textarea" rows="3" placeholder="多章节故事时可填写世界背景。"></textarea>
      </div>
      <div class="field stack-gap">
        <label>结局条件对用户可见</label>
        <select v-model="store.state.chapterConditionVisible" class="select">
          <option :value="true">显示</option>
          <option :value="false">隐藏</option>
        </select>
      </div>
    </section>

    <section class="surface section-block">
      <div class="row-between">
        <div>
          <div class="section-title" style="font-size:16px;">高级设定</div>
        </div>
        <button class="button small" type="button" @click="showAdvanced = !showAdvanced">{{ showAdvanced ? "收起" : "展开" }}</button>
      </div>
      <div v-if="showAdvanced" class="dialog-stack">
        <div class="field">
          <label>章节背景图</label>
          <div class="row" style="align-items:flex-start;">
            <div class="story-cover" style="width:100%; max-width: 320px; height: 140px; border:1px solid var(--line); border-radius: 18px;">
              <StoryCover :title="store.state.chapterTitle || '章节背景'" :cover-path="store.resolveMediaPath(store.state.chapterBackground)" empty-text="上传 / AI 生成章节背景图" />
            </div>
            <div class="dialog-stack" style="min-width: 160px;">
              <input ref="chapterBgInput" type="file" accept="image/*" hidden @change="onChapterBgFile" />
              <button class="button block" type="button" @click="chapterBgInput?.click()">上传图片</button>
              <button class="button block" type="button" @click="openImageDialog('chapter')">AI 生图</button>
            </div>
          </div>
        </div>

        <div class="field">
          <label>背景音乐</label>
          <input v-model="store.state.chapterMusic" class="input" type="text" placeholder="背景音乐（可选）" />
        </div>
        <div class="field">
          <label>他人可查看角色设定</label>
          <select v-model="store.state.allowRoleView" class="select">
            <option :value="true">是</option>
            <option :value="false">否</option>
          </select>
        </div>
        <div class="field">
          <label>他人可分享对话剧情</label>
          <select v-model="store.state.allowChatShare" class="select">
            <option :value="true">是</option>
            <option :value="false">否</option>
          </select>
        </div>
      </div>
    </section>

    <section class="surface section-block">
      <div class="section-title" style="font-size:16px;">NPC 列表</div>
      <div class="dialog-stack">
        <article v-for="(role, index) in store.state.npcRoles" :key="role.id" class="surface section-block surface-soft">
          <div class="row-between">
            <div class="row" style="align-items:flex-start;">
              <div class="avatar" style="width:56px; height:56px;" @click="npcAvatarInputs[index]?.click()">
                <img v-if="role.avatarPath" :src="store.resolveMediaPath(role.avatarPath)" />
                <div v-else class="placeholder">{{ role.name.slice(0,1) || "R" }}</div>
                <div class="badge">+</div>
              </div>
              <input :ref="(el) => (npcAvatarInputs[index] = el as HTMLInputElement | null)" type="file" accept="image/*" hidden @change="onNpcAvatarFile(index, $event)" />
              <div>
                <div class="chip active">角色</div>
                <div class="tiny">第 {{ index + 1 }} 个 NPC</div>
              </div>
            </div>
            <div class="row">
              <button class="button small" type="button" @click="openImageDialog('npc', index)">AI 生图</button>
              <button class="button small" type="button" @click="store.removeNpcRole(index)">删除</button>
            </div>
          </div>
          <div class="field stack-gap">
            <label>角色名</label>
            <input v-model="role.name" class="input" type="text" />
          </div>
          <div class="field stack-gap">
            <label>角色设定</label>
            <textarea v-model="role.description" class="textarea" rows="3"></textarea>
          </div>
          <div class="field stack-gap">
            <label>角色音色</label>
            <div class="row">
              <input :value="role.voice || '未选择音色'" class="input" type="text" readonly />
              <button class="button small" type="button" @click="openVoiceDialog('npc', index)">选择音色</button>
            </div>
          </div>
          <div class="field stack-gap">
            <label>台词示例</label>
            <input v-model="role.sample" class="input" type="text" placeholder="例如：欢迎来到这里。" />
          </div>
        </article>
        <button class="button block" type="button" @click="store.addNpcRole()">新增角色</button>
      </div>
    </section>

    <section class="row">
      <button class="button" type="button" @click="store.saveStoryEditor(false, false, '故事设定已保存')">存草稿</button>
      <button class="button primary" type="button" @click="store.saveStoryEditor(true, false, '故事已发布并可游玩')">发布</button>
      <button class="button accent" type="button" @click="store.state.createStep = 1">下一步</button>
    </section>
  </section>

  <ImageGenerateDialog
    v-if="imageDialogTarget"
    :open="imageDialogOpen"
    :title="imageDialogState.title"
    :initial-prompt="imageDialogState.initialPrompt"
    :initial-style-key="imageDialogState.initialStyleKey"
    :loading="store.state.aiGenerating"
    @close="closeImageDialog"
    @confirm="handleImageConfirm"
  />

  <VoiceBindingDialog
    v-if="voiceDialogTarget"
    :open="voiceDialogOpen"
    :title="voiceDialogState.title"
    :initial-label="voiceDialogState.initialLabel"
    :initial-config-id="voiceDialogState.initialConfigId"
    :initial-preset-id="voiceDialogState.initialPresetId"
    :initial-mode="voiceDialogState.initialMode"
    :initial-reference-audio-path="voiceDialogState.initialReferenceAudioPath"
    :initial-reference-audio-name="voiceDialogState.initialReferenceAudioName"
    :initial-reference-text="voiceDialogState.initialReferenceText"
    :initial-prompt-text="voiceDialogState.initialPromptText"
    :initial-mix-voices="voiceDialogState.initialMixVoices"
    @close="closeVoiceDialog"
    @confirm="handleVoiceConfirm"
  />
</template>
