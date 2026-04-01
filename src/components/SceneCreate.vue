<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import ImageGenerateDialog from "./ImageGenerateDialog.vue";
import LayeredAvatar from "./LayeredAvatar.vue";
import StoryCover from "./StoryCover.vue";
import VoiceBindingDialog from "./VoiceBindingDialog.vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import type { StoryRole, VoiceBindingDraft } from "../types/toonflow";
import { imageStyleForKey } from "../utils/imageStyles";

type ImageTarget = "user" | "cover" | "chapter" | "npc";
type VoiceTarget = "player" | "narrator" | "npc";
type AvatarPreviewTarget = "user" | "npc";
type AvatarPreviewMode = "composed" | "foreground" | "background";
type ChapterTabItem = {
  id: number | null;
  label: string;
  draft: boolean;
};

const store = useToonflowStore();
const showAdvanced = ref(false);
const showUserEditor = ref(false);
const showNpcEditor = ref(false);
const editingNpcIndex = ref<number | null>(null);
const showImageSourceDialog = ref(false);
const imageSourceTarget = ref<ImageTarget | null>(null);
const imageSourceNpcIndex = ref<number | null>(null);
const avatarPreviewTarget = ref<AvatarPreviewTarget | null>(null);
const avatarPreviewNpcIndex = ref<number | null>(null);
const avatarPreviewMode = ref<AvatarPreviewMode>("composed");

const storyCoverInput = ref<HTMLInputElement | null>(null);
const chapterBgInput = ref<HTMLInputElement | null>(null);
const chapterMusicInput = ref<HTMLInputElement | null>(null);
const userAvatarInput = ref<HTMLInputElement | null>(null);
const userAvatarVideoInput = ref<HTMLInputElement | null>(null);
const npcAvatarInputs = ref<Record<number, HTMLInputElement | null>>({});
const npcAvatarVideoInputs = ref<Record<number, HTMLInputElement | null>>({});
const globalBackgroundInput = ref<HTMLTextAreaElement | null>(null);
const chapterContentInput = ref<HTMLTextAreaElement | null>(null);
const imageDialogTarget = ref<ImageTarget | null>(null);
const imageDialogNpcIndex = ref<number | null>(null);
const voiceDialogTarget = ref<VoiceTarget | null>(null);
const voiceDialogNpcIndex = ref<number | null>(null);
const showDeleteNpcConfirm = ref(false);
const publishPending = ref(false);
let runtimeAudioUnlockContext: AudioContext | null = null;
let runtimeAudioUnlockElement: HTMLAudioElement | null = null;

const coverAiPrompt = computed(() => store.state.worldIntro || store.state.worldName || "故事封面");
const imageDialogOpen = computed(() => imageDialogTarget.value !== null);
const voiceDialogOpen = computed(() => voiceDialogTarget.value !== null);
const mentionRoles = computed(() => store.mentionRoleNames());
const chapterUsed = computed(() => (store.state.chapterContent || "").length);
const runtimeOutlinePreview = computed(() => {
  const raw = String(store.state.chapterRuntimeOutlineText || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const phases = Array.isArray(parsed?.phases) ? parsed.phases as Array<Record<string, unknown>> : [];
    const userNodes = Array.isArray(parsed?.userNodes) ? parsed.userNodes as Array<Record<string, unknown>> : [];
    const fixedEvents = Array.isArray(parsed?.fixedEvents) ? parsed.fixedEvents as Array<Record<string, unknown>> : [];
    const endingRules = typeof parsed?.endingRules === "object" && parsed?.endingRules !== null
      ? parsed.endingRules as Record<string, unknown>
      : {};
    return {
      phases: phases.map((item, index) => ({
        id: String(item?.id || `phase_${index + 1}`),
        label: String(item?.label || `阶段 ${index + 1}`),
        nextPhaseIds: Array.isArray(item?.nextPhaseIds) ? item.nextPhaseIds.map((entry) => String(entry || "")).filter(Boolean) : [],
        allowedSpeakers: Array.isArray(item?.allowedSpeakers) ? item.allowedSpeakers.map((entry) => String(entry || "")).filter(Boolean) : [],
      })),
      userNodes: userNodes.map((item, index) => ({
        id: String(item?.id || `user_node_${index + 1}`),
        goal: String(item?.goal || item?.label || `用户节点 ${index + 1}`),
        promptRole: String(item?.promptRole || "系统"),
      })),
      fixedEvents: fixedEvents.map((item, index) => ({
        id: String(item?.id || `fixed_event_${index + 1}`),
        label: String(item?.label || `固定事件 ${index + 1}`),
      })),
      endingRules: {
        success: Array.isArray(endingRules?.success) ? endingRules.success.map((entry) => String(entry || "")).filter(Boolean) : [],
        failure: Array.isArray(endingRules?.failure) ? endingRules.failure.map((entry) => String(entry || "")).filter(Boolean) : [],
        nextChapterId: String(endingRules?.nextChapterId || "").trim(),
      },
    };
  } catch {
    return null;
  }
});
const canUndoPersist = computed(() => store.canUndoStoryAutoPersist());
const currentEditorChapterSort = computed(() => {
  if (store.state.selectedChapterId) {
    return Number(store.state.chapters.find((item) => item.id === store.state.selectedChapterId)?.sort || 1);
  }
  return Math.max(1, ...store.state.chapters.map((item) => Number(item.sort || 0))) + (store.state.chapters.length ? 1 : 0);
});
const showChapterOpeningEditor = computed(() => currentEditorChapterSort.value <= 1);
const chapterTabs = computed<ChapterTabItem[]>(() => {
  const tabs = [...store.state.chapters]
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
    .map((chapter) => ({
      id: chapter.id,
      label: chapter.title || `第 ${chapter.sort || 1} 章`,
      draft: false,
    }));
  if (store.state.selectedChapterId === null && store.state.chapters.length > 0) {
    tabs.push({
      id: null,
      label: `${store.state.chapterTitle || `第 ${currentEditorChapterSort.value} 章`}（草稿）`,
      draft: true,
    });
  }
  return tabs;
});
const currentNpcRole = computed<StoryRole | null>(() => {
  const index = editingNpcIndex.value;
  if (typeof index !== "number") return null;
  return store.state.npcRoles[index] || null;
});
const userAvatarProcessing = computed(() => store.isAvatarProcessing("user"));
const currentNpcAvatarProcessing = computed(() => {
  const index = editingNpcIndex.value;
  return typeof index === "number" && index >= 0 ? store.isAvatarProcessing("npc", index) : false;
});
const hasUserAvatarPreview = computed(() =>
  !!String(store.state.userAvatarPath || store.state.userAvatarBgPath || "").trim(),
);
const hasCurrentNpcAvatarPreview = computed(() =>
  !!String(currentNpcRole.value?.avatarPath || currentNpcRole.value?.avatarBgPath || "").trim(),
);
const avatarPreviewState = computed(() => {
  if (avatarPreviewTarget.value === "user") {
    return {
      title: store.state.playerName || "用户头像",
      foregroundPath: store.resolveMediaPath(store.state.userAvatarPath),
      backgroundPath: store.resolveMediaPath(store.state.userAvatarBgPath),
      fallbackText: (store.state.playerName || "用户").slice(0, 1) || "用",
    };
  }
  if (avatarPreviewTarget.value === "npc") {
    const role = typeof avatarPreviewNpcIndex.value === "number" ? store.state.npcRoles[avatarPreviewNpcIndex.value] : null;
    return {
      title: role?.name || "角色头像",
      foregroundPath: store.resolveMediaPath(role?.avatarPath || ""),
      backgroundPath: store.resolveMediaPath(role?.avatarBgPath || ""),
      fallbackText: role?.name?.slice(0, 1) || "角",
    };
  }
  return null;
});
const avatarPreviewHasForeground = computed(() => !!String(avatarPreviewState.value?.foregroundPath || "").trim());
const avatarPreviewHasBackground = computed(() => !!String(avatarPreviewState.value?.backgroundPath || "").trim());

function resolveInitialAvatarPreviewMode(target: AvatarPreviewTarget, index: number | null): AvatarPreviewMode {
  const foregroundPath = target === "user"
    ? store.resolveMediaPath(store.state.userAvatarPath)
    : store.resolveMediaPath((typeof index === "number" ? store.state.npcRoles[index]?.avatarPath : "") || "");
  const backgroundPath = target === "user"
    ? store.resolveMediaPath(store.state.userAvatarBgPath)
    : store.resolveMediaPath((typeof index === "number" ? store.state.npcRoles[index]?.avatarBgPath : "") || "");
  if (String(foregroundPath || "").trim() && String(backgroundPath || "").trim()) return "composed";
  if (String(foregroundPath || "").trim()) return "foreground";
  return "background";
}

function displayMediaName(input: string, fallback: string) {
  const raw = String(input || "").trim();
  if (!raw) return fallback;
  const clean = raw.split("?")[0]?.split("#")[0] || raw;
  return clean.split("/").filter(Boolean).pop() || fallback;
}

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
    playerVoicePresetId: store.state.playerVoicePresetId,
    playerVoiceMode: store.state.playerVoiceMode,
    playerVoiceReferenceAudioPath: store.state.playerVoiceReferenceAudioPath,
    playerVoiceReferenceAudioName: store.state.playerVoiceReferenceAudioName,
    playerVoiceReferenceText: store.state.playerVoiceReferenceText,
    playerVoicePromptText: store.state.playerVoicePromptText,
    playerVoiceMixVoices: store.state.playerVoiceMixVoices,
    narratorName: store.state.narratorName,
    narratorVoice: store.state.narratorVoice,
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

function openAvatarPreview(target: AvatarPreviewTarget, index: number | null = null) {
  avatarPreviewTarget.value = target;
  avatarPreviewNpcIndex.value = index;
  avatarPreviewMode.value = resolveInitialAvatarPreviewMode(target, index);
}

function closeAvatarPreview() {
  avatarPreviewTarget.value = null;
  avatarPreviewNpcIndex.value = null;
  avatarPreviewMode.value = "composed";
}

function triggerUserAvatarUpload() {
  userAvatarInput.value?.click();
}

function triggerUserAvatarVideoUpload() {
  userAvatarVideoInput.value?.click();
}

function triggerNpcAvatarUpload(index: number | null) {
  if (typeof index === "number") {
    npcAvatarInputs.value[index]?.click();
  }
}

function triggerNpcAvatarVideoUpload(index: number | null) {
  if (typeof index === "number") {
    npcAvatarVideoInputs.value[index]?.click();
  }
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

function handleImageSourceGifUpload() {
  const target = imageSourceTarget.value;
  if (!target) return;
  if (target === "user") userAvatarVideoInput.value?.click();
  if (target === "npc" && typeof imageSourceNpcIndex.value === "number") {
    npcAvatarVideoInputs.value[imageSourceNpcIndex.value]?.click();
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
    try {
      await store.updateAvatarFromFile("user", file);
      store.scheduleStoryEditorAutoPersist(120);
    } catch (err) {
      store.state.notice = `头像分离失败: ${err instanceof Error ? err.message : "未知错误"}`;
    }
  }
  input.value = "";
}

async function onUserAvatarVideoFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    try {
      await store.updateAvatarFromMp4("user", file);
      store.scheduleStoryEditorAutoPersist(120);
    } catch (err) {
      store.state.notice = `头像动图转换失败: ${err instanceof Error ? err.message : "未知错误"}`;
    }
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

async function onChapterMusicFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    const uploaded = await store.uploadVoiceReferenceAudio(file);
    store.state.chapterMusic = uploaded.path;
    store.state.notice = "背景音乐已上传";
    store.scheduleStoryEditorAutoPersist(120);
  }
  input.value = "";
}

async function onNpcAvatarFile(index: number, e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    try {
      await store.updateAvatarFromFile("npc", file, undefined, index);
      store.scheduleStoryEditorAutoPersist(120);
    } catch (err) {
      store.state.notice = `头像分离失败: ${err instanceof Error ? err.message : "未知错误"}`;
    }
  }
  input.value = "";
}

async function onNpcAvatarVideoFile(index: number, e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    try {
      await store.updateAvatarFromMp4("npc", file, undefined, index);
      store.scheduleStoryEditorAutoPersist(120);
    } catch (err) {
      store.state.notice = `头像动图转换失败: ${err instanceof Error ? err.message : "未知错误"}`;
    }
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

async function handleVoiceConfirm(binding: VoiceBindingDraft) {
  const target = voiceDialogTarget.value;
  if (!target) return;
  try {
    if (target === "player") {
      store.setPlayerVoiceBinding(binding);
    } else if (target === "narrator") {
      store.setNarratorVoiceBinding(binding);
    } else if (target === "npc" && typeof voiceDialogNpcIndex.value === "number") {
      store.setNpcRoleVoice(voiceDialogNpcIndex.value, binding);
    }
    // 旁白音色需要立即落库，避免调试入口拿到旧配置。
    await store.saveWorldOnly(false);
    store.state.notice = target === "narrator" ? "旁白音色已保存" : "音色已更新";
    store.scheduleStoryEditorAutoPersist(120);
    closeVoiceDialog();
  } catch (err) {
    store.state.notice = `音色保存失败: ${(err as Error).message}`;
  }
}

function cycleOpeningRole() {
  const roles = mentionRoles.value;
  if (!roles.length) return;
  const currentIndex = Math.max(0, roles.indexOf(store.state.chapterOpeningRole));
  store.state.chapterOpeningRole = roles[(currentIndex + 1) % roles.length] || roles[0];
}

async function goNextStep() {
  await store.saveStoryEditor(null, false, null);
  store.state.createStep = 1;
}

async function backToStoryStep() {
  await store.saveStoryEditor(null, false, null);
  store.state.createStep = 0;
}

async function saveDraft() {
  await store.saveStoryEditor(false, false, "故事草稿已保存");
}

async function publishStory() {
  if (publishPending.value) return;
  publishPending.value = true;
  try {
    await store.saveStoryEditor(true, false, "故事已发布并可游玩");
  } catch (err) {
    store.state.notice = `发布失败: ${(err as Error).message}`;
  } finally {
    publishPending.value = false;
  }
}

async function addNextChapter() {
  await store.saveStoryEditor(null, true, "当前章节已保存，并已新建下一章节草稿");
}

async function primeRuntimeAudioUnlock() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      if (!runtimeAudioUnlockContext) {
        runtimeAudioUnlockContext = new AudioCtx();
      }
      if (runtimeAudioUnlockContext.state === "suspended") {
        await runtimeAudioUnlockContext.resume();
      }
      const buffer = runtimeAudioUnlockContext.createBuffer(1, 1, 22050);
      const source = runtimeAudioUnlockContext.createBufferSource();
      source.buffer = buffer;
      source.connect(runtimeAudioUnlockContext.destination);
      source.start(0);
    }
  } catch {
    // ignore
  }
  try {
    if (!runtimeAudioUnlockElement) {
      runtimeAudioUnlockElement = new Audio(
        "data:audio/wav;base64,UklGRjwAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQgAAAAAAAAAAAAA",
      );
      runtimeAudioUnlockElement.preload = "auto";
      runtimeAudioUnlockElement.volume = 0;
      runtimeAudioUnlockElement.muted = true;
    }
    runtimeAudioUnlockElement.currentTime = 0;
    await runtimeAudioUnlockElement.play().catch(() => void 0);
    runtimeAudioUnlockElement.pause();
  } catch {
    // 浏览器自动播放策略差异较大，这里只做静默预热
  }
}

async function startDebug() {
  await primeRuntimeAudioUnlock();
  await store.startDebugCurrentChapter();
}

async function selectChapter(targetChapterId: number | null) {
  await store.saveCurrentChapterAndSelect(targetChapterId);
}

function insertMentionAtCursor(target: "global" | "chapter", role: string) {
  const trimmed = role.trim();
  if (!trimmed) return;
  const mention = `@${trimmed} `;
  const input = target === "global" ? globalBackgroundInput.value : chapterContentInput.value;
  const sourceText = target === "global" ? store.state.globalBackground : store.state.chapterContent;
  if (!input) {
    if (target === "global") {
      store.appendGlobalMention(trimmed);
    } else {
      store.appendChapterMention(trimmed);
    }
    return;
  }
  const start = input.selectionStart ?? sourceText.length;
  const end = input.selectionEnd ?? sourceText.length;
  const nextValue = `${sourceText.slice(0, start)}${mention}${sourceText.slice(end)}`;
  if (target === "global") {
    store.state.globalBackground = nextValue;
  } else {
    store.state.chapterContent = nextValue;
  }
  requestAnimationFrame(() => {
    input.focus();
    const caret = start + mention.length;
    input.setSelectionRange(caret, caret);
  });
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
          <button class="create-footer-btn" type="button" :disabled="publishPending" @click="backToStoryStep">返回</button>
          <button class="create-footer-btn" type="button" :disabled="publishPending" @click="saveDraft">存草稿</button>
          <button class="create-footer-btn create-footer-btn--primary" type="button" :disabled="publishPending" @click="publishStory">
            {{ publishPending ? "发布中..." : "发布" }}
          </button>
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
                <LayeredAvatar
                  :foreground-path="store.resolveMediaPath(store.state.userAvatarPath)"
                  :background-path="store.resolveMediaPath(store.state.userAvatarBgPath || store.state.userAvatarPath)"
                  alt="用户头像"
                >
                  <div class="placeholder create-user-placeholder">
                    <span class="create-user-glyph"></span>
                  </div>
                </LayeredAvatar>
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
                <LayeredAvatar
                  :foreground-path="store.resolveMediaPath(role.avatarPath || '')"
                  :background-path="store.resolveMediaPath(role.avatarBgPath || '')"
                  :alt="role.name || '角色头像'"
                >
                  <div class="placeholder">{{ role.name.slice(0, 1) || '角' }}</div>
                </LayeredAvatar>
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

      <section class="create-section">
        <div class="create-card create-card--compact">
          <div class="create-card-title">全局背景（选填）</div>
          <div class="field">
            <textarea
              ref="globalBackgroundInput"
              v-model="store.state.globalBackground"
              class="textarea create-short-textarea"
              rows="4"
              placeholder="多章节故事时可填写世界背景，提及时请使用角色名或‘用户’。"
            ></textarea>
          </div>
          <div class="create-mention-row">
            <button v-for="role in mentionRoles" :key="`global-${role}`" class="chip" type="button" @click="insertMentionAtCursor('global', role)">{{ role }}</button>
          </div>
        </div>
      </section>

      <section v-if="showChapterOpeningEditor" class="create-section">
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
          <div class="create-card-title">章节背景图片</div>
          <button class="create-cover-btn create-chapter-bg-btn" type="button" @click="openImageSource('chapter')">
            <StoryCover :title="store.state.chapterTitle || '章节背景'" :cover-path="store.resolveMediaPath(store.state.chapterBackground)" empty-text="上传 / AI 生成章节背景图" />
          </button>
        </div>
      </section>

      <section class="create-section">
        <div class="create-card create-card--compact">
          <div class="create-section-head">
            <div class="create-card-title">故事内容（章节内容）</div>
            <button class="create-link-btn create-debug-btn" type="button" @click="startDebug">调试</button>
          </div>
          <div class="create-tip">提及用户扮演的角色时，请用“用户”一词称呼</div>
          <div class="field">
            <textarea
              ref="chapterContentInput"
              v-model="store.state.chapterContent"
              class="textarea"
              rows="6"
              placeholder="描述主要情节，包括用户在故事中和其他角色的互动。提及时请使用角色原名或用户，不要使用‘你’来代称。"
            ></textarea>
          </div>
          <div class="create-mention-row">
            <button v-for="role in mentionRoles" :key="role" class="chip" type="button" @click="insertMentionAtCursor('chapter', role)">{{ role }}</button>
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
          <label class="create-switch-row create-switch-row--spaced">
            <span>结局条件对用户可见</span>
            <input v-model="store.state.chapterConditionVisible" type="checkbox" />
          </label>
        </div>
      </section>

      <section class="create-section">
        <div class="create-card create-card--compact">
          <div class="create-card-title">Phase Graph（高级）</div>
          <div class="create-tip">可直接填写章节运行模板 JSON。为空时由系统根据章节正文和指令自动推断。</div>
          <div class="field">
            <textarea
              v-model="store.state.chapterRuntimeOutlineText"
              class="textarea create-short-textarea"
              rows="8"
              placeholder='例如：{"phases":[{"id":"phase_1_opening","label":"开场","nextPhaseIds":["phase_2_user"]}]}'
            ></textarea>
          </div>
          <div v-if="runtimeOutlinePreview?.phases?.length" class="create-phase-preview">
            <div
              v-for="phase in runtimeOutlinePreview.phases"
              :key="phase.id"
              class="create-phase-preview__item"
            >
              <div class="create-phase-preview__title">{{ phase.label }}</div>
              <div class="create-phase-preview__meta">ID：{{ phase.id }}</div>
              <div class="create-phase-preview__meta">允许角色：{{ phase.allowedSpeakers.join(" / ") || "未限制" }}</div>
              <div class="create-phase-preview__meta">下一阶段：{{ phase.nextPhaseIds.join(" -> ") || "顺序回退" }}</div>
            </div>
          </div>
          <div v-if="runtimeOutlinePreview?.userNodes?.length" class="create-phase-preview">
            <div class="create-card-title create-card-title--sub">用户节点</div>
            <div
              v-for="node in runtimeOutlinePreview.userNodes"
              :key="node.id"
              class="create-phase-preview__item"
            >
              <div class="create-phase-preview__title">{{ node.goal }}</div>
              <div class="create-phase-preview__meta">ID：{{ node.id }}</div>
              <div class="create-phase-preview__meta">提示角色：{{ node.promptRole || "系统" }}</div>
            </div>
          </div>
          <div v-if="runtimeOutlinePreview?.fixedEvents?.length" class="create-phase-preview">
            <div class="create-card-title create-card-title--sub">固定事件</div>
            <div
              v-for="event in runtimeOutlinePreview.fixedEvents"
              :key="event.id"
              class="create-phase-preview__item"
            >
              <div class="create-phase-preview__title">{{ event.label }}</div>
              <div class="create-phase-preview__meta">ID：{{ event.id }}</div>
            </div>
          </div>
          <div
            v-if="runtimeOutlinePreview?.endingRules?.success?.length || runtimeOutlinePreview?.endingRules?.failure?.length || runtimeOutlinePreview?.endingRules?.nextChapterId"
            class="create-phase-preview"
          >
            <div class="create-card-title create-card-title--sub">章节结算</div>
            <div class="create-phase-preview__item">
              <div class="create-phase-preview__meta">成功条件：{{ runtimeOutlinePreview.endingRules.success.join(" / ") || "无" }}</div>
              <div class="create-phase-preview__meta">失败条件：{{ runtimeOutlinePreview.endingRules.failure.join(" / ") || "无" }}</div>
              <div class="create-phase-preview__meta">下一章节：{{ runtimeOutlinePreview.endingRules.nextChapterId || "无" }}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="create-section">
        <div class="create-card create-card--compact">
          <div class="create-card-title">背景音乐（可选）</div>
          <button class="create-picker-btn" type="button" @click="chapterMusicInput?.click()">
            <span>{{ displayMediaName(store.state.chapterMusic, '可选预设音乐（现在无），也可以上传') }}</span>
            <strong>上传 ＞</strong>
          </button>
        </div>
      </section>

      <button class="create-add-chapter-btn" type="button" @click="addNextChapter">
        <span>添加下一章节</span>
        <strong>＋</strong>
      </button>

      <div v-if="chapterTabs.length > 1" class="create-chapter-tabs">
        <button
          v-for="chapter in chapterTabs"
          :key="chapter.id === null ? 'draft' : chapter.id"
          class="create-chapter-pill"
          :class="{ active: store.state.selectedChapterId === chapter.id }"
          type="button"
          @click="chapter.id !== null ? selectChapter(chapter.id) : undefined"
        >
          {{ chapter.label }}
        </button>
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
    <input ref="chapterMusicInput" type="file" accept="audio/*" hidden @change="onChapterMusicFile" />
    <input ref="userAvatarInput" type="file" accept="image/*" hidden @change="onUserAvatarFile" />
    <input ref="userAvatarVideoInput" type="file" accept="video/mp4" hidden @change="onUserAvatarVideoFile" />

    <div v-if="showUserEditor" class="modal-backdrop">
      <div class="modal-panel fullscreen create-editor-panel">
        <div class="create-editor-header">
          <div class="create-editor-title">用户扮演角色资料</div>
          <button class="create-link-btn" type="button" @click="showUserEditor = false">完成</button>
        </div>
        <div class="create-editor-body">
          <div class="field">
            <label>头像（可上传 / AI 生成）</label>
            <button class="create-editor-avatar-row" type="button" :disabled="userAvatarProcessing" @click="openImageSource('user')">
              <div class="avatar create-editor-avatar create-editor-avatar--compact" :class="{ 'avatar--busy': userAvatarProcessing }">
                <LayeredAvatar
                  :foreground-path="store.resolveMediaPath(store.state.userAvatarPath)"
                  :background-path="store.resolveMediaPath(store.state.userAvatarBgPath)"
                  alt="用户头像"
                >
                  <div class="placeholder">
                    <span class="create-user-glyph"></span>
                  </div>
                </LayeredAvatar>
                <div v-if="userAvatarProcessing" class="avatar-processing-mask">
                  <span class="avatar-processing-spinner"></span>
                </div>
              </div>
              <div class="create-editor-avatar-copy">
                <strong>{{ userAvatarProcessing ? '头像处理中...' : '点击头像更换' }}</strong>
                <span>支持 PNG / GIF / MP4，保存时会自动标准化。</span>
                <span>可选：上传、GIF、AI 生图、图标查看大图。</span>
              </div>
            </button>
            <div class="create-editor-avatar-actions">
              <button class="create-editor-avatar-btn" type="button" :disabled="userAvatarProcessing" @click="triggerUserAvatarUpload">上传</button>
              <button class="create-editor-avatar-btn create-editor-avatar-btn--gif" type="button" :disabled="userAvatarProcessing" title="上传 MP4 转 GIF" @click="triggerUserAvatarVideoUpload">GIF</button>
              <button class="create-editor-avatar-btn" type="button" :disabled="userAvatarProcessing" @click="openImageDialog('user')">AI 生图</button>
              <button
                class="create-editor-avatar-btn create-editor-avatar-btn--icon"
                type="button"
                :disabled="!hasUserAvatarPreview"
                aria-label="查看头像大图"
                title="查看头像大图"
                @click="openAvatarPreview('user')"
              >
                <svg class="create-editor-avatar-btn-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M1.8 12s3.7-6.4 10.2-6.4S22.2 12 22.2 12s-3.7 6.4-10.2 6.4S1.8 12 1.8 12Z" />
                  <circle cx="12" cy="12" r="3.2" />
                </svg>
              </button>
            </div>
          </div>
          <div class="field">
            <label>角色名（选填）</label>
            <input v-model="store.state.playerName" class="input" type="text" placeholder="用户" />
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
            <button class="create-editor-avatar-row" type="button" :disabled="currentNpcAvatarProcessing" @click="openImageSource('npc', editingNpcIndex)">
              <div class="avatar create-editor-avatar create-editor-avatar--compact" :class="{ 'avatar--busy': currentNpcAvatarProcessing }">
                <LayeredAvatar
                  :foreground-path="store.resolveMediaPath(currentNpcRole.avatarPath || '')"
                  :background-path="store.resolveMediaPath(currentNpcRole.avatarBgPath || '')"
                  :alt="currentNpcRole.name || '角色头像'"
                >
                  <div class="placeholder">{{ currentNpcRole.name?.slice(0, 1) || '角' }}</div>
                </LayeredAvatar>
                <div v-if="currentNpcAvatarProcessing" class="avatar-processing-mask">
                  <span class="avatar-processing-spinner"></span>
                </div>
              </div>
              <div class="create-editor-avatar-copy">
                <strong>{{ currentNpcAvatarProcessing ? '头像处理中...' : '点击头像更换' }}</strong>
                <span>支持 PNG / GIF / MP4，保存时会自动标准化。</span>
                <span>可选：上传、GIF、AI 生图、图标查看大图。</span>
              </div>
            </button>
            <div class="create-editor-avatar-actions">
              <button class="create-editor-avatar-btn" type="button" :disabled="currentNpcAvatarProcessing" @click="triggerNpcAvatarUpload(editingNpcIndex)">上传</button>
              <button class="create-editor-avatar-btn create-editor-avatar-btn--gif" type="button" :disabled="currentNpcAvatarProcessing" title="上传 MP4 转 GIF" @click="triggerNpcAvatarVideoUpload(editingNpcIndex)">GIF</button>
              <button class="create-editor-avatar-btn" type="button" :disabled="currentNpcAvatarProcessing" @click="openImageDialog('npc', editingNpcIndex)">AI 生图</button>
              <button
                class="create-editor-avatar-btn create-editor-avatar-btn--icon"
                type="button"
                :disabled="!hasCurrentNpcAvatarPreview"
                aria-label="查看头像大图"
                title="查看头像大图"
                @click="openAvatarPreview('npc', editingNpcIndex)"
              >
                <svg class="create-editor-avatar-btn-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M1.8 12s3.7-6.4 10.2-6.4S22.2 12 22.2 12s-3.7 6.4-10.2 6.4S1.8 12 1.8 12Z" />
                  <circle cx="12" cy="12" r="3.2" />
                </svg>
              </button>
            </div>
            <input :ref="(el) => { if (typeof editingNpcIndex === 'number') npcAvatarInputs[editingNpcIndex] = el as HTMLInputElement | null; }" type="file" accept="image/*" hidden @change="editingNpcIndex !== null ? onNpcAvatarFile(editingNpcIndex, $event) : undefined" />
            <input :ref="(el) => { if (typeof editingNpcIndex === 'number') npcAvatarVideoInputs[editingNpcIndex] = el as HTMLInputElement | null; }" type="file" accept="video/mp4" hidden @change="editingNpcIndex !== null ? onNpcAvatarVideoFile(editingNpcIndex, $event) : undefined" />
          </div>
          <div class="field">
            <label>角色名</label>
            <input v-model="currentNpcRole.name" class="input" type="text" placeholder="角色名" />
          </div>
          <div class="field">
            <label>角色设定(性别,年龄,性格,外貌,音色特点,技能,物品,装备,等级,血量,蓝量,金钱,其他)</label>
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
          <button
            v-if="imageSourceTarget === 'user' || imageSourceTarget === 'npc'"
            class="image-source-action-btn image-source-action-btn--gif"
            type="button"
            @click="handleImageSourceGifUpload"
          >
            <span class="image-source-action-btn-glyph">GIF</span>
            <span>上传 MP4</span>
          </button>
          <button class="image-source-action-btn" type="button" @click="handleImageSourceAi">AI 生图</button>
          <button class="image-source-action-btn image-source-action-btn--ghost" type="button" @click="closeImageSource">取消</button>
        </div>
      </div>
    </div>

    <div v-if="avatarPreviewTarget && avatarPreviewState" class="modal-backdrop create-avatar-preview-backdrop" @click.self="closeAvatarPreview">
      <div class="modal-panel create-avatar-preview-panel">
        <div class="modal-header">
          <div style="font-weight:900;">查看头像</div>
          <button class="icon-btn settings-close-x" type="button" aria-label="关闭" @click="closeAvatarPreview">×</button>
        </div>
        <div class="modal-body create-avatar-preview-body">
          <div class="create-avatar-preview-title">{{ avatarPreviewState.title }}</div>
          <div class="create-avatar-preview-toolbar">
            <button
              class="chip"
              :class="{ active: avatarPreviewMode === 'composed' }"
              type="button"
              :disabled="!avatarPreviewHasForeground && !avatarPreviewHasBackground"
              @click="avatarPreviewMode = 'composed'"
            >
              合成
            </button>
            <button
              class="chip"
              :class="{ active: avatarPreviewMode === 'foreground' }"
              type="button"
              :disabled="!avatarPreviewHasForeground"
              @click="avatarPreviewMode = 'foreground'"
            >
              仅主体
            </button>
            <button
              class="chip"
              :class="{ active: avatarPreviewMode === 'background' }"
              type="button"
              :disabled="!avatarPreviewHasBackground"
              @click="avatarPreviewMode = 'background'"
            >
              仅背景
            </button>
          </div>
          <div class="create-avatar-preview-stage">
            <div
              class="create-avatar-preview-art"
              :class="avatarPreviewMode === 'composed' ? 'create-avatar-preview-art--scene' : 'create-avatar-preview-art--checker'"
            >
              <LayeredAvatar
                v-if="avatarPreviewMode === 'composed'"
                :foreground-path="avatarPreviewState.foregroundPath"
                :background-path="avatarPreviewState.backgroundPath"
                :alt="avatarPreviewState.title"
              >
                <div class="placeholder">{{ avatarPreviewState.fallbackText }}</div>
              </LayeredAvatar>
              <img
                v-else-if="avatarPreviewMode === 'foreground' && avatarPreviewState.foregroundPath"
                class="create-avatar-preview-image create-avatar-preview-image--foreground"
                :src="avatarPreviewState.foregroundPath"
                :alt="`${avatarPreviewState.title} 主体图`"
              />
              <img
                v-else-if="avatarPreviewMode === 'background' && avatarPreviewState.backgroundPath"
                class="create-avatar-preview-image create-avatar-preview-image--background"
                :src="avatarPreviewState.backgroundPath"
                :alt="`${avatarPreviewState.title} 背景图`"
              />
              <div v-else class="placeholder">{{ avatarPreviewState.fallbackText }}</div>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="button settings-outline-btn" type="button" @click="closeAvatarPreview">关闭</button>
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
