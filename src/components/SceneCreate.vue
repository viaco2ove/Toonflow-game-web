<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import ImageGenerateDialog from "./ImageGenerateDialog.vue";
import StoryCover from "./StoryCover.vue";
import VoiceBindingDialog from "./VoiceBindingDialog.vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import type { StoryRole, VoiceBindingDraft } from "../types/toonflow";
import { imageStyleForKey } from "../utils/imageStyles";

type ImageTarget = "user" | "cover" | "chapter" | "npc";
type VoiceTarget = "player" | "narrator" | "npc";

const store = useToonflowStore();
const showAdvanced = ref(false);
const showUserEditor = ref(false);
const showNpcEditor = ref(false);
const editingNpcIndex = ref<number | null>(null);
const showImageSourceDialog = ref(false);
const imageSourceTarget = ref<ImageTarget | null>(null);
const imageSourceNpcIndex = ref<number | null>(null);

const storyCoverInput = ref<HTMLInputElement | null>(null);
const chapterBgInput = ref<HTMLInputElement | null>(null);
const userAvatarInput = ref<HTMLInputElement | null>(null);
const npcAvatarInputs = ref<Record<number, HTMLInputElement | null>>({});
const imageDialogTarget = ref<ImageTarget | null>(null);
const imageDialogNpcIndex = ref<number | null>(null);
const voiceDialogTarget = ref<VoiceTarget | null>(null);
const voiceDialogNpcIndex = ref<number | null>(null);
const showDeleteNpcConfirm = ref(false);

const coverAiPrompt = computed(() => store.state.worldIntro || store.state.worldName || "故事封面");
const imageDialogOpen = computed(() => imageDialogTarget.value !== null);
const voiceDialogOpen = computed(() => voiceDialogTarget.value !== null);
const mentionRoles = computed(() => store.mentionRoleNames());
const chapterRemain = computed(() => Math.max(0, 1500 - (store.state.chapterContent || "").length));
const chapterUsed = computed(() => Math.min(1500, (store.state.chapterContent || "").length));
const canUndoPersist = computed(() => store.canUndoStoryAutoPersist());
const showGlobalBackground = computed(() => store.state.chapters.length > 1 || !!store.state.globalBackground.trim());
const currentNpcRole = computed<StoryRole | null>(() => {
  const index = editingNpcIndex.value;
  if (typeof index !== "number") return null;
  return store.state.npcRoles[index] || null;
});

const imageDialogState = computed(() => {
  switch (imageDialogTarget.value) {
    case "user":
      return {
        title: "创建角色",
        initialPrompt: store.state.playerDesc || store.state.playerName || "用户头像",
        initialStyleKey: "general_3",
      };
    case "cover":
      return {
        title: "创建故事封面",
        initialPrompt: coverAiPrompt.value,
        initialStyleKey: "cinema",
      };
    case "chapter":
      return {
        title: "创建章节背景",
        initialPrompt: store.state.chapterContent || store.state.chapterTitle || "章节背景图",
        initialStyleKey: "cinema",
      };
    case "npc": {
      const role = typeof imageDialogNpcIndex.value === "number" ? store.state.npcRoles[imageDialogNpcIndex.value] : null;
      return {
        title: "创建角色",
        initialPrompt: role?.description || role?.sample || role?.name || "角色头像",
        initialStyleKey: "general_3",
      };
    }
    default:
      return {
        title: "创建角色",
        initialPrompt: "角色头像",
        initialStyleKey: "general_3",
      };
  }
});

const voiceDialogState = computed(() => {
  switch (voiceDialogTarget.value) {
    case "player":
      return {
        title: "选择用户音色",
        initialLabel: store.state.playerVoice,
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
        title: "选择旁白音色",
        initialLabel: store.state.narratorVoice,
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
        title: "选择角色音色",
        initialLabel: role?.voice || "",
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

store.primeStoryEditorPersistState();
let autosaveReady = false;
watch(
  () => JSON.stringify({
    step: store.state.createStep,
    worldName: store.state.worldName,
    worldIntro: store.state.worldIntro,
    worldCoverPath: store.state.worldCoverPath,
    worldCoverBgPath: store.state.worldCoverBgPath,
    playerName: store.state.playerName,
    playerDesc: store.state.playerDesc,
    playerVoice: store.state.playerVoice,
    playerVoiceConfigId: store.state.playerVoiceConfigId,
    playerVoicePresetId: store.state.playerVoicePresetId,
    playerVoiceMode: store.state.playerVoiceMode,
    playerVoiceReferenceAudioPath: store.state.playerVoiceReferenceAudioPath,
    playerVoiceReferenceAudioName: store.state.playerVoiceReferenceAudioName,
    playerVoiceReferenceText: store.state.playerVoiceReferenceText,
    playerVoicePromptText: store.state.playerVoicePromptText,
    playerVoiceMixVoices: store.state.playerVoiceMixVoices,
    narratorName: store.state.narratorName,
    narratorVoice: store.state.narratorVoice,
    narratorVoiceConfigId: store.state.narratorVoiceConfigId,
    narratorVoicePresetId: store.state.narratorVoicePresetId,
    narratorVoiceMode: store.state.narratorVoiceMode,
    narratorVoiceReferenceAudioPath: store.state.narratorVoiceReferenceAudioPath,
    narratorVoiceReferenceAudioName: store.state.narratorVoiceReferenceAudioName,
    narratorVoiceReferenceText: store.state.narratorVoiceReferenceText,
    narratorVoicePromptText: store.state.narratorVoicePromptText,
    narratorVoiceMixVoices: store.state.narratorVoiceMixVoices,
    globalBackground: store.state.globalBackground,
    allowRoleView: store.state.allowRoleView,
    allowChatShare: store.state.allowChatShare,
    npcRoles: store.state.npcRoles.map((role) => ({
      id: role.id,
      name: role.name,
      avatarPath: role.avatarPath,
      avatarBgPath: role.avatarBgPath,
      description: role.description,
      voice: role.voice,
      voiceMode: role.voiceMode,
      voiceConfigId: role.voiceConfigId,
      voicePresetId: role.voicePresetId,
      voiceReferenceAudioPath: role.voiceReferenceAudioPath,
      voiceReferenceAudioName: role.voiceReferenceAudioName,
      voiceReferenceText: role.voiceReferenceText,
      voicePromptText: role.voicePromptText,
      voiceMixVoices: role.voiceMixVoices,
      sample: role.sample,
    })),
    chapterTitle: store.state.chapterTitle,
    chapterContent: store.state.chapterContent,
    chapterEntryCondition: store.state.chapterEntryCondition,
    chapterCondition: store.state.chapterCondition,
    chapterOpeningRole: store.state.chapterOpeningRole,
    chapterOpeningLine: store.state.chapterOpeningLine,
    chapterBackground: store.state.chapterBackground,
    chapterMusic: store.state.chapterMusic,
    chapterConditionVisible: store.state.chapterConditionVisible,
  }),
  () => {
    if (!autosaveReady) {
      autosaveReady = true;
      return;
    }
    store.scheduleStoryEditorAutoPersist();
  },
);

onUnmounted(() => {
  store.cancelStoryEditorAutoPersist();
});

function openUserEditor() {
  showUserEditor.value = true;
}

function openNpcEditor(index: number) {
  editingNpcIndex.value = index;
  showNpcEditor.value = true;
}

function createNpcAndOpen() {
  store.addNpcRole();
  editingNpcIndex.value = Math.max(0, store.state.npcRoles.length - 1);
  showNpcEditor.value = true;
}

function closeNpcEditor() {
  showNpcEditor.value = false;
  editingNpcIndex.value = null;
}

function openImageDialog(target: ImageTarget, index: number | null = null) {
  imageDialogTarget.value = target;
  imageDialogNpcIndex.value = index;
}

function closeImageDialog() {
  imageDialogTarget.value = null;
  imageDialogNpcIndex.value = null;
}

function openImageSource(target: ImageTarget, index: number | null = null) {
  imageSourceTarget.value = target;
  imageSourceNpcIndex.value = index;
  showImageSourceDialog.value = true;
}

function closeImageSource() {
  showImageSourceDialog.value = false;
  imageSourceTarget.value = null;
  imageSourceNpcIndex.value = null;
}

function handleImageSourceUpload() {
  const target = imageSourceTarget.value;
  if (!target) return;
  if (target === "user") userAvatarInput.value?.click();
  if (target === "cover") storyCoverInput.value?.click();
  if (target === "chapter") chapterBgInput.value?.click();
  if (target === "npc" && typeof imageSourceNpcIndex.value === "number") {
    npcAvatarInputs.value[imageSourceNpcIndex.value]?.click();
  }
  closeImageSource();
}

function handleImageSourceAi() {
  const target = imageSourceTarget.value;
  if (!target) return;
  openImageDialog(target, imageSourceNpcIndex.value);
  closeImageSource();
}

async function onUserAvatarFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    await store.updateAvatarFromFile("user", file);
    store.scheduleStoryEditorAutoPersist(120);
  }
  input.value = "";
}

async function onCoverFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    await store.updateCoverFromFile(file);
    store.scheduleStoryEditorAutoPersist(120);
  }
  input.value = "";
}

async function onChapterBgFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    await store.updateChapterBackgroundFromFile(file);
    store.scheduleStoryEditorAutoPersist(120);
  }
  input.value = "";
}

async function onNpcAvatarFile(index: number, e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    await store.updateAvatarFromFile("npc", file, undefined, index);
    store.scheduleStoryEditorAutoPersist(120);
  }
  input.value = "";
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
    store.scheduleStoryEditorAutoPersist(120);
  } catch (err) {
    store.state.notice = `AI 生图失败: ${(err as Error).message}`;
  } finally {
    closeImageDialog();
  }
}

function openVoiceDialog(target: VoiceTarget, index: number | null = null) {
  voiceDialogTarget.value = target;
  voiceDialogNpcIndex.value = index;
}

function closeVoiceDialog() {
  voiceDialogTarget.value = null;
  voiceDialogNpcIndex.value = null;
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
  store.scheduleStoryEditorAutoPersist(120);
  closeVoiceDialog();
}

function cycleOpeningRole() {
  const roles = mentionRoles.value;
  if (!roles.length) return;
  const currentIndex = Math.max(0, roles.indexOf(store.state.chapterOpeningRole));
  store.state.chapterOpeningRole = roles[(currentIndex + 1) % roles.length] || roles[0];
}

async function goNextStep() {
  await store.saveStoryEditor(false, false, null);
  store.state.createStep = 1;
}

async function backToStoryStep() {
  await store.saveStoryEditor(false, false, null);
  store.state.createStep = 0;
}

async function saveDraft() {
  await store.saveStoryEditor(false, false, "故事草稿已保存");
}

async function publishStory() {
  await store.saveStoryEditor(true, false, "故事已发布并可游玩");
}

async function addNextChapter() {
  await store.saveStoryEditor(false, true, "当前章节已保存，并已新建下一章节草稿");
}

async function selectChapter(targetChapterId: number | null) {
  await store.saveCurrentChapterAndSelect(targetChapterId);
}

function removeCurrentNpc() {
  if (typeof editingNpcIndex.value !== "number") return;
  showDeleteNpcConfirm.value = true;
}

function confirmRemoveCurrentNpc() {
  if (typeof editingNpcIndex.value !== "number") return;
  store.removeNpcRole(editingNpcIndex.value);
  showDeleteNpcConfirm.value = false;
  closeNpcEditor();
  store.scheduleStoryEditorAutoPersist(120);
}

function cancelRemoveCurrentNpc() {
  showDeleteNpcConfirm.value = false;
}
</script>

<template>
  <section class="create-page">
    <div v-if="store.state.createStep === 1" class="create-step-page stack-gap">
      <div class="create-page-header">
        <h2 class="create-page-title">基本信息</h2>
        <button class="create-link-btn" type="button" @click="backToStoryStep">返回</button>
      </div>

      <div v-if="canUndoPersist" class="create-undo-row">
        <button class="create-link-btn" type="button" @click="store.undoStoryAutoPersist()">撤回</button>
      </div>

      <section class="create-card">
        <div class="field">
          <label>故事图标</label>
          <button class="create-cover-btn create-cover-btn--basic" type="button" @click="openImageSource('cover')">
            <StoryCover :title="store.state.worldName || '故事'" :cover-path="store.resolveMediaPath(store.state.worldCoverPath)" empty-text="故事图标" />
          </button>
        </div>
        <div class="field">
          <label>故事名称</label>
          <input v-model="store.state.worldName" class="input" type="text" placeholder="输入故事名称" />
        </div>
        <div class="field">
          <label>故事简介</label>
          <textarea v-model="store.state.worldIntro" class="textarea" rows="5" placeholder="输入故事简介"></textarea>
        </div>
        <div class="create-footer-actions">
          <button class="create-footer-btn" type="button" @click="backToStoryStep">返回</button>
          <button class="create-footer-btn" type="button" @click="saveDraft">存草稿</button>
          <button class="create-footer-btn create-footer-btn--primary" type="button" @click="publishStory">发布</button>
        </div>
      </section>
    </div>

    <div v-else class="create-step-page stack-gap">
      <div class="create-page-header">
        <h2 class="create-page-title">故事设定</h2>
        <button class="create-link-btn" type="button" @click="goNextStep">下一步</button>
      </div>

      <div v-if="canUndoPersist" class="create-undo-row">
        <button class="create-link-btn" type="button" @click="store.undoStoryAutoPersist()">撤回</button>
      </div>

      <section class="create-section">
        <div class="create-card create-card--compact">
          <div class="create-card-title">角色</div>
          <div class="create-avatar-row">
            <button class="create-avatar-item" type="button" @click="openUserEditor">
              <div class="avatar create-role-avatar">
                <img v-if="store.state.userAvatarPath" :src="store.resolveMediaPath(store.state.userAvatarPath)" />
                <div v-else class="placeholder create-user-placeholder">
                  <span class="create-user-glyph"></span>
                </div>
                <div class="badge">✎</div>
              </div>
              <span>用户</span>
            </button>
            <button
              v-for="(role, index) in store.state.npcRoles"
              :key="role.id"
              class="create-avatar-item"
              type="button"
              @click="openNpcEditor(index)"
            >
              <div class="avatar create-role-avatar">
                <img v-if="role.avatarPath" :src="store.resolveMediaPath(role.avatarPath)" />
                <div v-else class="placeholder">{{ role.name.slice(0, 1) || '角' }}</div>
                <div class="badge">✎</div>
              </div>
              <span>{{ role.name || '新角色' }}</span>
            </button>
            <button class="create-avatar-item" type="button" @click="createNpcAndOpen">
              <div class="avatar create-role-avatar create-role-avatar-add">
                <div class="placeholder">＋</div>
              </div>
              <span>新增</span>
            </button>
          </div>
        </div>
      </section>

      <section v-if="showGlobalBackground" class="create-section">
        <div class="create-card create-card--compact">
          <div class="create-card-title">全局背景（选填）</div>
          <div class="field">
            <textarea
              v-model="store.state.globalBackground"
              class="textarea create-short-textarea"
              rows="4"
              placeholder="多章节故事时可填写世界背景，提及时请使用角色名或‘用户’。"
            ></textarea>
          </div>
          <div class="create-mention-row">
            <button v-for="role in mentionRoles" :key="`global-${role}`" class="chip" type="button" @click="store.appendGlobalMention(role)">{{ role }}</button>
          </div>
        </div>
      </section>

      <section class="create-section">
        <div class="create-card create-card--compact">
          <div class="create-card-title">故事描述</div>
          <div class="field">
            <label>开场白</label>
            <button class="create-picker-btn" type="button" @click="cycleOpeningRole">
              <span>选择开场白发言角色</span>
              <strong>{{ store.state.chapterOpeningRole || '旁白' }} ＞</strong>
            </button>
          </div>
          <div class="field">
            <textarea
              v-model="store.state.chapterOpeningLine"
              class="textarea create-short-textarea"
              rows="3"
              placeholder="作为选定角色/旁白的第一句话开启整个故事"
            ></textarea>
          </div>
        </div>
      </section>

      <section class="create-section">
        <div class="create-card create-card--compact">
          <div class="create-section-head">
            <div class="create-card-title">故事内容（章节内容）</div>
            <button class="create-link-btn create-debug-btn" type="button" @click="store.startDebugCurrentChapter()">调试</button>
          </div>
          <div class="create-tip">提及用户扮演的角色时，请用“用户”一词称呼</div>
          <div class="field">
            <textarea
              v-model="store.state.chapterContent"
              class="textarea"
              rows="6"
              maxlength="1500"
              placeholder="描述主要情节，包括用户在故事中和其他角色的互动。提及时请使用角色原名或用户，不要使用‘你’来代称。"
            ></textarea>
          </div>
          <div class="create-mention-row">
            <button v-for="role in mentionRoles" :key="role" class="chip" type="button" @click="store.appendChapterMention(role)">{{ role }}</button>
          </div>
          <div class="create-count-row">
            <span>还可输入1500字</span>
            <span>{{ chapterUsed }}/1500</span>
          </div>
        </div>
      </section>

      <section class="create-section">
        <div class="create-card create-card--compact">
          <div class="create-card-title">成功条件（章节结局）</div>
          <div class="field">
            <textarea
              v-model="store.state.chapterCondition"
              class="textarea create-short-textarea"
              rows="4"
              placeholder="只有用户达成该条件才进入下一章节。为空代表无结束，AI 持续编排。"
            ></textarea>
          </div>
        </div>
      </section>

      <button class="create-add-chapter-btn" type="button" @click="addNextChapter">
        <span>添加下一章节</span>
        <strong>＋</strong>
      </button>

      <div v-if="store.state.chapters.length || store.state.chapterTitle || store.state.chapterContent || store.state.chapterOpeningLine" class="create-chapter-tabs">
        <button
          v-for="chapter in store.state.chapters"
          :key="chapter.id"
          class="create-chapter-pill"
          :class="{ active: store.state.selectedChapterId === chapter.id }"
          type="button"
          @click="selectChapter(chapter.id)"
        >
          {{ chapter.title || `章节 ${chapter.sort || 0}` }}
        </button>
        <button
          v-if="!store.state.selectedChapterId && (store.state.chapterTitle || store.state.chapterContent || store.state.chapterOpeningLine)"
          class="create-chapter-pill active"
          type="button"
        >
          {{ store.state.chapterTitle || '新章节草稿' }}
        </button>
        <button class="create-chapter-pill" type="button" @click="selectChapter(null)">新章节</button>
      </div>

      <section class="create-section">
        <div class="create-card create-card--compact">
          <div class="create-card-title">旁白面板</div>
          <button class="create-picker-btn" type="button" @click="openVoiceDialog('narrator')">
            <span>旁白音色</span>
            <strong>{{ store.state.narratorVoice || '混合（清朗温润）' }} ＞</strong>
          </button>
        </div>
      </section>

      <section class="create-section">
        <div class="create-card create-card--compact create-card--toggle">
          <button class="create-advanced-toggle" type="button" @click="showAdvanced = !showAdvanced">
            <span>高级设定</span>
            <strong>{{ showAdvanced ? '收起' : '展开' }}</strong>
          </button>
          <div v-if="showAdvanced" class="create-advanced-body">
            <div class="field">
              <label>章节背景图</label>
              <button class="create-cover-btn create-chapter-bg-btn" type="button" @click="openImageSource('chapter')">
                <StoryCover :title="store.state.chapterTitle || '章节背景'" :cover-path="store.resolveMediaPath(store.state.chapterBackground)" empty-text="上传 / AI 生成章节背景图" />
              </button>
            </div>
            <div class="field">
              <label>背景音乐</label>
              <input v-model="store.state.chapterMusic" class="input" type="text" placeholder="背景音乐（可选）" />
            </div>
            <label class="create-switch-row">
              <span>结局条件对用户可见</span>
              <input v-model="store.state.chapterConditionVisible" type="checkbox" />
            </label>
            <label class="create-switch-row">
              <span>他人可查看角色设定</span>
              <input v-model="store.state.allowRoleView" type="checkbox" />
            </label>
            <label class="create-switch-row">
              <span>他人可分享对话剧情</span>
              <input v-model="store.state.allowChatShare" type="checkbox" />
            </label>
          </div>
        </div>
      </section>

      <button class="create-primary-btn" type="button" @click="goNextStep">下一步</button>
    </div>

    <input ref="storyCoverInput" type="file" accept="image/*" hidden @change="onCoverFile" />
    <input ref="chapterBgInput" type="file" accept="image/*" hidden @change="onChapterBgFile" />
    <input ref="userAvatarInput" type="file" accept="image/*" hidden @change="onUserAvatarFile" />

    <div v-if="showUserEditor" class="modal-backdrop">
      <div class="modal-panel fullscreen create-editor-panel">
        <div class="create-editor-header">
          <div class="create-editor-title">用户扮演角色资料</div>
          <button class="create-link-btn" type="button" @click="showUserEditor = false">完成</button>
        </div>
        <div class="create-editor-body">
          <div class="field">
            <label>头像（可上传 / AI 生成）</label>
            <button class="create-editor-avatar-row" type="button" @click="openImageSource('user')">
              <div class="avatar create-editor-avatar create-editor-avatar--compact">
                <img v-if="store.state.userAvatarPath" :src="store.resolveMediaPath(store.state.userAvatarPath)" />
                <div v-else class="placeholder">
                  <span class="create-user-glyph"></span>
                </div>
              </div>
              <div class="create-editor-avatar-copy">
                <strong>点击头像更换</strong>
                <span>支持 PNG / GIF，保存时会自动标准化。</span>
                <span>可选：上传、AI 生图。</span>
              </div>
            </button>
          </div>
          <div class="field">
            <label>角色名（选填）</label>
            <input v-model="store.state.playerName" class="input" type="text" placeholder="玩家" />
          </div>
          <div class="field">
            <label>角色设定（选填）</label>
            <textarea v-model="store.state.playerDesc" class="textarea" rows="5" placeholder="用户在故事中的主视角角色"></textarea>
          </div>
          <div class="field">
            <label>角色音色（选填）</label>
            <button class="create-picker-btn" type="button" @click="openVoiceDialog('player')">
              <span>{{ store.state.playerVoice || '例如：温和女声 / 少年音' }}</span>
              <strong>选择音色 ＞</strong>
            </button>
          </div>
          <div class="create-note">用户是固定角色，不可删除。参数卡会在保存后自动生成。</div>
        </div>
      </div>
    </div>

    <div v-if="showNpcEditor && currentNpcRole" class="modal-backdrop">
      <div class="modal-panel fullscreen create-editor-panel">
        <div class="create-editor-header">
          <div class="create-editor-title">{{ editingNpcIndex === null || editingNpcIndex < 0 ? '新增角色资料' : '编辑角色资料' }}</div>
          <button class="create-link-btn" type="button" @click="closeNpcEditor">确定</button>
        </div>
        <div class="create-editor-body">
          <div class="field">
            <label>头像</label>
            <button class="create-editor-avatar-row" type="button" @click="openImageSource('npc', editingNpcIndex)">
              <div class="avatar create-editor-avatar create-editor-avatar--compact">
                <img v-if="currentNpcRole.avatarPath" :src="store.resolveMediaPath(currentNpcRole.avatarPath)" />
                <div v-else class="placeholder">{{ currentNpcRole.name?.slice(0, 1) || '角' }}</div>
              </div>
              <div class="create-editor-avatar-copy">
                <strong>点击头像更换</strong>
                <span>支持 PNG / GIF，保存时会自动标准化。</span>
                <span>可选：上传、AI 生图。</span>
              </div>
            </button>
            <input :ref="(el) => { if (typeof editingNpcIndex === 'number') npcAvatarInputs[editingNpcIndex] = el as HTMLInputElement | null; }" type="file" accept="image/*" hidden @change="editingNpcIndex !== null ? onNpcAvatarFile(editingNpcIndex, $event) : undefined" />
          </div>
          <div class="field">
            <label>角色名</label>
            <input v-model="currentNpcRole.name" class="input" type="text" placeholder="角色名" />
          </div>
          <div class="field">
            <label>角色设定</label>
            <textarea v-model="currentNpcRole.description" class="textarea" rows="5" placeholder="角色设定"></textarea>
          </div>
          <div class="field">
            <label>角色音色</label>
            <button class="create-picker-btn" type="button" @click="openVoiceDialog('npc', editingNpcIndex)">
              <span>{{ currentNpcRole.voice || '未选择音色' }}</span>
              <strong>选择音色 ＞</strong>
            </button>
          </div>
          <div class="field">
            <label>台词示例</label>
            <textarea v-model="currentNpcRole.sample" class="textarea create-short-textarea" rows="3" placeholder="例如：欢迎来到这里。"></textarea>
          </div>
          <div class="create-note">参数卡会在保存角色后自动生成到 parameterCardJson。</div>
          <button class="create-remove-btn" type="button" @click="removeCurrentNpc">删除当前角色</button>
          <div v-if="showDeleteNpcConfirm" class="modal-backdrop" @click.self="cancelRemoveCurrentNpc">
            <div class="modal-panel create-delete-dialog">
              <div class="modal-header">
                <div style="font-weight:900;">确认删除角色</div>
              </div>
              <div class="modal-body">
                <div class="subtle">删除后无法恢复，确认删除当前角色吗？</div>
              </div>
              <div class="modal-actions">
                <button class="button" type="button" @click="cancelRemoveCurrentNpc">取消</button>
                <button class="button danger-solid" type="button" @click="confirmRemoveCurrentNpc">删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showImageSourceDialog" class="modal-backdrop image-source-dialog-backdrop">
      <div class="modal-panel image-source-dialog-panel">
        <div class="modal-header">选择图片来源</div>
        <div class="dialog-stack">
          <button class="image-source-action-btn" type="button" @click="handleImageSourceUpload">上传图片</button>
          <button class="image-source-action-btn" type="button" @click="handleImageSourceAi">AI 生图</button>
          <button class="image-source-action-btn image-source-action-btn--ghost" type="button" @click="closeImageSource">取消</button>
        </div>
      </div>
    </div>

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
  </section>
</template>
