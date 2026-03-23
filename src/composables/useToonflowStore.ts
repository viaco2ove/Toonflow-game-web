import { computed, reactive, watch } from "vue";
import { ToonflowApi } from "../api/toonflow";
import {
  AppTab,
  ChapterItem,
  MessageItem,
  ProjectItem,
  SessionDetail,
  SessionItem,
  StoryRole,
  VoiceBindingDraft,
  VoiceMixItem,
  VoiceModelConfig,
  VoicePresetItem,
  WorldItem,
  createDefaultNarratorRole,
  createDefaultPlayerRole,
  createEmptyChapter,
} from "../types/toonflow";
import { fileToDataUrl, fileToBase64Payload } from "../utils/file";

type Loadable<T> = T | null;

function storageGet(key: string, fallback = ""): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // noop
  }
}

function normalizeBaseUrl(input: string): string {
  return String(input || "").trim().replace(/\/+$/, "");
}

function resolveMediaUrl(baseUrl: string, input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^(https?:|data:|blob:|file:)/i.test(raw)) return raw;
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return raw;
  if (raw.startsWith("/")) return `${base}${raw}`;
  return `${base}/${raw}`;
}

function safeJsonParse<T>(text: string, fallback: T): T {
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function createEmptyWorldState() {
  return {
    worldId: 0,
    worldName: "",
    worldIntro: "",
    worldCoverPath: "",
    worldCoverBgPath: "",
    playerName: "用户",
    playerDesc: "",
    playerVoice: "",
    playerVoiceConfigId: null as number | null,
    playerVoicePresetId: "",
    playerVoiceMode: "text",
    playerVoiceReferenceAudioPath: "",
    playerVoiceReferenceAudioName: "",
    playerVoiceReferenceText: "",
    playerVoicePromptText: "",
    playerVoiceMixVoices: [] as VoiceMixItem[],
    narratorName: "旁白",
    narratorVoice: "默认旁白",
    narratorVoiceConfigId: null as number | null,
    narratorVoicePresetId: "",
    narratorVoiceMode: "text",
    narratorVoiceReferenceAudioPath: "",
    narratorVoiceReferenceAudioName: "",
    narratorVoiceReferenceText: "",
    narratorVoicePromptText: "",
    narratorVoiceMixVoices: [] as VoiceMixItem[],
    globalBackground: "",
    allowRoleView: true,
    allowChatShare: true,
    worldPublishStatus: "draft",
  };
}

function createEmptyEditorState(sort = 1) {
  return createEmptyChapter(sort);
}

type ToonflowStore = ReturnType<typeof createToonflowStore>;

let singletonStore: ToonflowStore | null = null;

function createToonflowStore() {
  const state = reactive({
    baseUrl: storageGet("toonflow.baseUrl", "http://127.0.0.1:60000"),
    token: storageGet("toonflow.token", ""),
    loginUsername: storageGet("toonflow.loginUsername", "admin"),
    loginPassword: storageGet("toonflow.loginPassword", "admin123"),
    notice: "",
    activeTab: "home" as AppTab,
    loading: false,
    userName: "",
    userId: 0 as number,
    accountAvatarPath: storageGet("toonflow.accountAvatarPath", ""),
    accountAvatarBgPath: storageGet("toonflow.accountAvatarBgPath", ""),
    userAvatarPath: "",
    userAvatarBgPath: "",
    projects: [] as ProjectItem[],
    selectedProjectId: Number(storageGet("toonflow.selectedProjectId", "-1")) || -1,
    selectedProjectNameCache: storageGet("toonflow.selectedProjectNameCache", ""),
    worlds: [] as WorldItem[],
    hallKeyword: "",
    hallCategory: "all",
    createStep: 0 as 0 | 1,
    ...createEmptyWorldState(),
    npcRoles: [] as StoryRole[],
    voiceModels: [] as VoiceModelConfig[],
    voicePresetsCache: {} as Record<number, VoicePresetItem[]>,
    voiceLoading: false,
    aiGenerating: false,
    chapters: [] as ChapterItem[],
    selectedChapterId: null as number | null,
    chapterTitle: "",
    chapterContent: "",
    chapterEntryCondition: "",
    chapterCondition: "",
    chapterOpeningRole: "旁白",
    chapterOpeningLine: "",
    chapterBackground: "",
    chapterMusic: "",
    chapterConditionVisible: true,
    sessions: [] as SessionItem[],
    currentSessionId: "",
    sessionDetail: null as Loadable<SessionDetail>,
    messages: [] as MessageItem[],
    quickInput: "",
    sendText: "",
    debugMode: false,
    debugSessionTitle: "",
    debugWorldName: "",
    debugWorldIntro: "",
    debugChapterId: null as number | null,
    debugChapterTitle: "",
    debugStatePreview: "{}",
    debugEndDialog: null as string | null,
    messageReactions: safeJsonParse(storageGet("toonflow.messageReactions", "{}"), {} as Record<string, string>),
  });

  const api = new ToonflowApi(() => ({ baseUrl: state.baseUrl, token: state.token }));

  function saveSettings() {
    storageSet("toonflow.baseUrl", state.baseUrl.trim());
    storageSet("toonflow.token", state.token.trim());
    storageSet("toonflow.loginUsername", state.loginUsername.trim());
    storageSet("toonflow.loginPassword", state.loginPassword);
    storageSet("toonflow.accountAvatarPath", state.accountAvatarPath);
    storageSet("toonflow.accountAvatarBgPath", state.accountAvatarBgPath);
  }

  function clearRuntime() {
    state.userName = "";
    state.userId = 0;
    state.projects = [];
    state.selectedProjectId = -1;
    state.worlds = [];
    state.sessions = [];
    state.sessionDetail = null;
    state.messages = [];
    state.currentSessionId = "";
    state.notice = "请先登录账号";
    state.activeTab = "settings";
  }

  function resetStoryEditor() {
    Object.assign(state, createEmptyWorldState());
    state.chapters = [];
    state.selectedChapterId = null;
    state.chapterTitle = "";
    state.chapterContent = "";
    state.chapterEntryCondition = "";
    state.chapterCondition = "";
    state.chapterOpeningRole = "旁白";
    state.chapterOpeningLine = "";
    state.chapterBackground = "";
    state.chapterMusic = "";
    state.chapterConditionVisible = true;
    state.npcRoles = [];
    state.createStep = 0;
  }

  function isWorldPublished(world: WorldItem): boolean {
    return String(world?.publishStatus || world?.settings?.publishStatus || "draft") === "published";
  }

  function worldCoverPath(world: WorldItem | null | undefined): string {
    if (!world) return "";
    return resolveMediaUrl(
      state.baseUrl,
      String(world.coverPath || world.settings?.coverPath || world.settings?.coverBgPath || "").trim(),
    );
  }

  function resolveMediaPath(path: string): string {
    return resolveMediaUrl(state.baseUrl, path);
  }

  function selectedProjectName(): string {
    const current = state.projects.find((item) => item.id === state.selectedProjectId);
    if (current?.name) return current.name;
    if (state.selectedProjectNameCache.trim()) return state.selectedProjectNameCache.trim();
    return state.projects[0]?.name || "";
  }

  function selectedProjectIntro(): string {
    const current = state.projects.find((item) => item.id === state.selectedProjectId);
    return current?.intro || state.projects[0]?.intro || "";
  }

  function worldsForSelectedProject(): WorldItem[] {
    if (state.selectedProjectId <= 0) return state.worlds;
    return state.worlds.filter((item) => item.projectId === state.selectedProjectId);
  }

  function publishedWorldsForSelectedProject(): WorldItem[] {
    return worldsForSelectedProject().filter((item) => isWorldPublished(item));
  }

  function draftWorldsForSelectedProject(): WorldItem[] {
    return worldsForSelectedProject().filter((item) => !isWorldPublished(item));
  }

  function recommendedWorld(): WorldItem | null {
    const list = publishedWorldsForSelectedProject();
    if (!list.length) return null;
    const idx = Math.abs((state.selectedProjectId * 17 + list.length) % list.length);
    return list[idx] || list[0] || null;
  }

  function filteredHallWorlds(): WorldItem[] {
    const keyword = state.hallKeyword.trim().toLowerCase();
    const base = publishedWorldsForSelectedProject();
    return base.filter((item) => {
      const matchesKeyword =
        !keyword ||
        [item.name, item.intro, item.settings?.globalBackground || ""].some((text) => String(text || "").toLowerCase().includes(keyword));
      const hasChapter = (item.chapterCount || 0) > 0;
      if (state.hallCategory === "hasChapter" && !hasChapter) return false;
      if (state.hallCategory === "noChapter" && hasChapter) return false;
      return matchesKeyword;
    });
  }

  function mentionRoleNames(): string[] {
    const names = [state.playerName || "用户", state.narratorName || "旁白", ...state.npcRoles.map((item) => item.name)];
    return Array.from(new Set(names.filter(Boolean)));
  }

  function appendGlobalMention(role: string) {
    const suffix = state.globalBackground.endsWith(" ") || !state.globalBackground ? "" : " ";
    state.globalBackground = `${state.globalBackground}${suffix}${role}`.trim();
  }

  function appendChapterMention(role: string) {
    const suffix = state.chapterContent.endsWith(" ") || !state.chapterContent ? "" : " ";
    state.chapterContent = `${state.chapterContent}${suffix}${role}`.trim();
  }

  function orderedChapters(): ChapterItem[] {
    return [...state.chapters].sort((a, b) => {
      const sortA = Number(a.sort || 0);
      const sortB = Number(b.sort || 0);
      if (sortA !== sortB) return sortA - sortB;
      return Number(a.id || 0) - Number(b.id || 0);
    });
  }

  function getDebugChapterIndex(): number {
    const list = orderedChapters();
    if (!list.length) return -1;
    if (state.debugChapterId) {
      const found = list.findIndex((item) => item.id === state.debugChapterId);
      if (found >= 0) return found;
    }
    if (state.selectedChapterId) {
      const found = list.findIndex((item) => item.id === state.selectedChapterId);
      if (found >= 0) return found;
    }
    return 0;
  }

  function syncDebugChapter(index: number): ChapterItem | null {
    const list = orderedChapters();
    const chapter = list[index] || null;
    if (!chapter) {
      state.debugChapterId = null;
      state.debugChapterTitle = "当前章节";
      state.debugStatePreview = JSON.stringify(
        {
          worldId: state.worldId,
          chapterId: null,
          player: state.playerName,
          narrator: state.narratorName,
        },
        null,
        2,
      );
      return null;
    }
    state.debugEndDialog = null;
    state.debugChapterId = chapter.id;
    state.debugChapterTitle = chapter.title || `章节 ${chapter.sort || index + 1}`;
    state.debugStatePreview = JSON.stringify(
      {
        worldId: state.worldId,
        chapterId: chapter.id,
        chapterTitle: chapter.title || "",
        player: state.playerName,
        narrator: state.narratorName,
      },
      null,
      2,
    );
    return chapter;
  }

  function debugChapterContent(): ChapterItem | null {
    const list = orderedChapters();
    const index = getDebugChapterIndex();
    return list[index] || null;
  }

  function hasEffectiveCondition(input: unknown): boolean {
    if (input === null || input === undefined) return false;
    if (typeof input === "string") return input.trim().length > 0;
    if (Array.isArray(input)) return input.length > 0;
    if (typeof input === "object") return Object.keys(input as Record<string, unknown>).length > 0;
    return true;
  }

  function readConditionValue(source: Record<string, unknown>, fieldRaw: unknown): unknown {
    const field = String(fieldRaw || "").trim();
    if (!field) return undefined;
    if (field === "message" || field === "message.content") return source.messageContent;
    if (field === "event" || field === "eventType") return source.eventType;
    if (field.startsWith("state.")) {
      return field.slice("state.".length).split(".").reduce((acc: unknown, key) => {
        if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
        return undefined;
      }, source.state);
    }
    if (field.startsWith("meta.")) {
      return field.slice("meta.".length).split(".").reduce((acc: unknown, key) => {
        if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
        return undefined;
      }, source.meta);
    }
    return field.split(".").reduce((acc: unknown, key) => {
      if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
      return undefined;
    }, source.state);
  }

  function compareConditionValue(left: unknown, right: unknown, op: string): boolean {
    if (op === "contains") {
      if (Array.isArray(left)) return left.some((item) => String(item).includes(String(right)));
      return String(left ?? "").includes(String(right ?? ""));
    }
    if (op === "equals") {
      if (Array.isArray(left)) return left.some((item) => String(item) === String(right));
      return String(left ?? "") === String(right ?? "");
    }
    if (op === "in") {
      if (Array.isArray(right)) return right.some((item) => String(item) === String(left));
      return String(right ?? "").includes(String(left ?? ""));
    }
    const leftNum = Number(left);
    const rightNum = Number(right);
    if (!Number.isFinite(leftNum) || !Number.isFinite(rightNum)) return false;
    if (op === "gt") return leftNum > rightNum;
    if (op === "gte") return leftNum >= rightNum;
    if (op === "lt") return leftNum < rightNum;
    if (op === "lte") return leftNum <= rightNum;
    return false;
  }

  function evaluateDebugCondition(input: unknown, ctx: { state: Record<string, unknown>; messageContent: string; eventType: string; meta: Record<string, unknown> }): boolean {
    if (input === null || input === undefined) return true;
    if (typeof input === "boolean") return input;
    if (typeof input === "string") {
      const text = input.trim();
      if (!text) return true;
      return ctx.messageContent.includes(text);
    }
    if (Array.isArray(input)) {
      return input.every((item) => evaluateDebugCondition(item, ctx));
    }
    if (typeof input !== "object") return false;
    const condition = input as Record<string, unknown>;
    const op = String(condition.type || condition.op || "equals").trim().toLowerCase();
    if (op === "always") return true;
    if (op === "and") {
      const list = Array.isArray(condition.conditions) ? condition.conditions : [];
      return list.every((item) => evaluateDebugCondition(item, ctx));
    }
    if (op === "or") {
      const list = Array.isArray(condition.conditions) ? condition.conditions : [];
      return list.some((item) => evaluateDebugCondition(item, ctx));
    }
    if (op === "not") {
      const child = condition.condition ?? (Array.isArray(condition.conditions) ? condition.conditions[0] : null);
      return !evaluateDebugCondition(child, ctx);
    }
    const left = readConditionValue({ state: ctx.state, messageContent: ctx.messageContent, eventType: ctx.eventType, meta: ctx.meta }, condition.field ?? condition.left);
    const right = condition.value ?? condition.right;
    return compareConditionValue(left, right, op);
  }

  function advanceDebugChapterIfNeeded(messageContent: string) {
    const list = orderedChapters();
    const currentIndex = getDebugChapterIndex();
    const currentChapter = list[currentIndex] || null;
    if (!currentChapter) {
      state.debugEndDialog = "当前没有章节可调试";
      return;
    }
    if (!hasEffectiveCondition(currentChapter.completionCondition)) return;
    const completed = evaluateDebugCondition(currentChapter.completionCondition, {
      state: state as unknown as Record<string, unknown>,
      messageContent,
      eventType: "on_message",
      meta: {},
    });
    if (!completed) return;

    const nextChapter = list[currentIndex + 1] || null;
    if (!nextChapter) {
      state.debugEndDialog = "已完结";
      return;
    }
    syncDebugChapter(currentIndex + 1);
    state.messages.push({
      id: Date.now(),
      role: state.narratorName || "旁白",
      roleType: "narrator",
      eventType: "on_debug_next_chapter",
      content: `已进入下一章节：《${nextChapter.title || `章节 ${nextChapter.sort || currentIndex + 2}`}》。`,
      createTime: Date.now(),
    });
  }

  function jumpDebugChapter(step: number) {
    const list = orderedChapters();
    if (!list.length) {
      state.debugEndDialog = "当前没有章节可调试";
      return;
    }
    const currentIndex = getDebugChapterIndex();
    const nextIndex = currentIndex < 0 ? 0 : currentIndex + step;
    if (nextIndex < 0 || nextIndex >= list.length) {
      state.debugEndDialog = step > 0 ? "已完结" : "已回到起始章节";
      return;
    }
    syncDebugChapter(nextIndex);
    state.messages.push({
      id: Date.now(),
      role: state.narratorName || "旁白",
      roleType: "narrator",
      eventType: "on_debug_jump_chapter",
      content: `已切换到《${list[nextIndex].title || `章节 ${list[nextIndex].sort || nextIndex + 1}`}》。`,
      createTime: Date.now(),
    });
  }

  function normalizeMixVoices(input: VoiceMixItem[]): VoiceMixItem[] {
    return input
      .filter((item) => item.voiceId.trim())
      .map((item) => ({
        voiceId: item.voiceId,
        weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0.7,
      }));
  }

  function setPlayerVoiceBinding(binding: VoiceBindingDraft) {
    state.playerVoice = binding.label;
    state.playerVoiceConfigId = binding.configId ?? null;
    state.playerVoicePresetId = binding.presetId || "";
    state.playerVoiceMode = binding.mode || "text";
    state.playerVoiceReferenceAudioPath = binding.referenceAudioPath || "";
    state.playerVoiceReferenceAudioName = binding.referenceAudioName || "";
    state.playerVoiceReferenceText = binding.referenceText || "";
    state.playerVoicePromptText = binding.promptText || "";
    state.playerVoiceMixVoices = normalizeMixVoices(binding.mixVoices || []);
  }

  function setNarratorVoiceBinding(binding: VoiceBindingDraft) {
    state.narratorVoice = binding.label;
    state.narratorVoiceConfigId = binding.configId ?? null;
    state.narratorVoicePresetId = binding.presetId || "";
    state.narratorVoiceMode = binding.mode || "text";
    state.narratorVoiceReferenceAudioPath = binding.referenceAudioPath || "";
    state.narratorVoiceReferenceAudioName = binding.referenceAudioName || "";
    state.narratorVoiceReferenceText = binding.referenceText || "";
    state.narratorVoicePromptText = binding.promptText || "";
    state.narratorVoiceMixVoices = normalizeMixVoices(binding.mixVoices || []);
  }

  function setNpcRoleVoice(index: number, binding: VoiceBindingDraft) {
    const role = state.npcRoles[index];
    if (!role) return;
    role.voice = binding.label;
    role.voiceConfigId = binding.configId ?? null;
    role.voicePresetId = binding.presetId || "";
    role.voiceMode = binding.mode || "text";
    role.voiceReferenceAudioPath = binding.referenceAudioPath || "";
    role.voiceReferenceAudioName = binding.referenceAudioName || "";
    role.voiceReferenceText = binding.referenceText || "";
    role.voicePromptText = binding.promptText || "";
    role.voiceMixVoices = normalizeMixVoices(binding.mixVoices || []);
  }

  function setNpcRoleAvatar(index: number, avatarPath: string, avatarBgPath = "") {
    const role = state.npcRoles[index];
    if (!role) return;
    role.avatarPath = avatarPath;
    role.avatarBgPath = avatarBgPath;
  }

  function setNpcRoleName(index: number, name: string) {
    const role = state.npcRoles[index];
    if (!role) return;
    role.name = name;
  }

  function setNpcRoleDescription(index: number, description: string) {
    const role = state.npcRoles[index];
    if (!role) return;
    role.description = description;
  }

  function setNpcRoleSample(index: number, sample: string) {
    const role = state.npcRoles[index];
    if (!role) return;
    role.sample = sample;
  }

  function addNpcRole() {
    state.npcRoles.push({
      id: `npc_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      roleType: "npc",
      name: "新角色",
      avatarPath: "",
      avatarBgPath: "",
      description: "",
      voice: "",
      voiceMode: "text",
      voiceConfigId: null,
      voicePresetId: "",
      voiceReferenceAudioPath: "",
      voiceReferenceAudioName: "",
      voiceReferenceText: "",
      voicePromptText: "",
      voiceMixVoices: [],
      sample: "",
      parameterCardJson: null,
    });
  }

  function removeNpcRole(index: number) {
    state.npcRoles.splice(index, 1);
  }

  async function fetchVoiceModels() {
    if (state.voiceLoading || state.voiceModels.length) return;
    state.voiceLoading = true;
    try {
      state.voiceModels = await api.getVoiceModels();
    } catch (err) {
      state.notice = `加载音色模型失败: ${(err as Error).message}`;
    } finally {
      state.voiceLoading = false;
    }
  }

  async function fetchVoicePresets(configId: number | null | undefined): Promise<VoicePresetItem[]> {
    const key = Number(configId || 0);
    if (!key) return [];
    if (state.voicePresetsCache[key]) return state.voicePresetsCache[key];
    try {
      const list = await api.getVoicePresets(key);
      state.voicePresetsCache[key] = list;
      return list;
    } catch (err) {
      state.notice = `加载音色列表失败: ${(err as Error).message}`;
      return [];
    }
  }

  function voicePresetsForConfig(configId: number | null | undefined): VoicePresetItem[] {
    const key = Number(configId || 0);
    return key && state.voicePresetsCache[key] ? state.voicePresetsCache[key] : [];
  }

  async function uploadVoiceReferenceAudio(file: File): Promise<{ path: string; name: string }> {
    const payload = await fileToBase64Payload(file);
    const result = await api.uploadVoiceAudio(state.selectedProjectId, payload, file.name || "reference.wav");
    return {
      path: result.filePath || result.url || "",
      name: file.name || "reference.wav",
    };
  }

  async function previewVoice(
    configId: number | null | undefined,
    text: string,
    mode: string,
    voiceId = "",
    referenceAudioPath = "",
    referenceText = "",
    promptText = "",
    mixVoices: VoiceMixItem[] = [],
  ): Promise<string> {
    const result = await api.previewVoice({
      configId: configId || undefined,
      text,
      mode,
      voiceId,
      referenceAudioPath,
      referenceText,
      promptText,
      mixVoices,
    });
    return result.audioUrl || "";
  }

  async function generateImage(target: "role" | "scene", prompt: string, referenceList: string[], name: string): Promise<string> {
    const result = await api.generateImage({
      projectId: state.selectedProjectId,
      type: target,
      prompt,
      name,
      base64: referenceList[0] || undefined,
      base64List: referenceList,
      size: "2K",
    });
    return result.path || result.filePath || "";
  }

  async function applyImageToTarget(target: "account" | "user" | "npc" | "cover" | "chapter", prompt: string, referenceList: string[], name: string, onReady?: (path: string, bgPath?: string) => void) {
    state.aiGenerating = true;
    try {
      const path = await generateImage(target === "chapter" || target === "cover" ? "scene" : "role", prompt, referenceList, name);
      if (!path) {
        throw new Error("未生成图片");
      }
      if (target === "account") {
        state.accountAvatarPath = path;
        state.accountAvatarBgPath = path;
      } else if (target === "user") {
        state.userAvatarPath = path;
        state.userAvatarBgPath = path;
      } else if (target === "npc") {
        onReady?.(path, path);
      } else if (target === "cover") {
        state.worldCoverPath = path;
        state.worldCoverBgPath = path;
      } else if (target === "chapter") {
        state.chapterBackground = path;
      }
      return path;
    } finally {
      state.aiGenerating = false;
    }
  }

  async function updateAvatarFromFile(target: "account" | "user" | "npc", file: File, onReady?: (path: string, bgPath?: string) => void, roleIndex?: number) {
    const dataUrl = await fileToDataUrl(file);
    if (target === "account") {
      state.accountAvatarPath = dataUrl;
      state.accountAvatarBgPath = dataUrl;
    } else if (target === "user") {
      state.userAvatarPath = dataUrl;
      state.userAvatarBgPath = dataUrl;
    } else if (target === "npc" && typeof roleIndex === "number" && state.npcRoles[roleIndex]) {
      state.npcRoles[roleIndex].avatarPath = dataUrl;
      state.npcRoles[roleIndex].avatarBgPath = dataUrl;
      onReady?.(dataUrl, dataUrl);
    }
  }

  async function updateCoverFromFile(file: File) {
    state.worldCoverPath = await fileToDataUrl(file);
    state.worldCoverBgPath = state.worldCoverPath;
  }

  async function updateChapterBackgroundFromFile(file: File) {
    state.chapterBackground = await fileToDataUrl(file);
  }

  function storySettingsObject() {
    return {
      roles: state.npcRoles,
      narratorVoice: state.narratorVoice,
      narratorVoiceMode: state.narratorVoiceMode,
      narratorVoiceConfigId: state.narratorVoiceConfigId,
      narratorVoicePresetId: state.narratorVoicePresetId,
      narratorVoiceReferenceAudioPath: state.narratorVoiceReferenceAudioPath,
      narratorVoiceReferenceAudioName: state.narratorVoiceReferenceAudioName,
      narratorVoiceReferenceText: state.narratorVoiceReferenceText,
      narratorVoicePromptText: state.narratorVoicePromptText,
      narratorVoiceMixVoices: state.narratorVoiceMixVoices,
      globalBackground: state.globalBackground,
      coverPath: state.worldCoverPath,
      coverBgPath: state.worldCoverBgPath,
      allowRoleView: state.allowRoleView,
      allowChatShare: state.allowChatShare,
      miniGameState: {
        gameType: "",
        status: "idle",
        round: 0,
        stage: "",
        winner: "",
        rewards: [],
        notes: "",
      },
      publishStatus: state.worldPublishStatus,
      chapterExtras: [],
    };
  }

  function currentPlayerRole() {
    return {
      ...createDefaultPlayerRole(),
      name: state.playerName,
      avatarPath: state.userAvatarPath,
      avatarBgPath: state.userAvatarBgPath,
      description: state.playerDesc,
      voice: state.playerVoice,
      voiceMode: state.playerVoiceMode,
      voiceConfigId: state.playerVoiceConfigId,
      voicePresetId: state.playerVoicePresetId,
      voiceReferenceAudioPath: state.playerVoiceReferenceAudioPath,
      voiceReferenceAudioName: state.playerVoiceReferenceAudioName,
      voiceReferenceText: state.playerVoiceReferenceText,
      voicePromptText: state.playerVoicePromptText,
      voiceMixVoices: state.playerVoiceMixVoices,
    };
  }

  function currentNarratorRole() {
    return {
      ...createDefaultNarratorRole(),
      name: state.narratorName,
      voice: state.narratorVoice,
      voiceMode: state.narratorVoiceMode,
      voiceConfigId: state.narratorVoiceConfigId,
      voicePresetId: state.narratorVoicePresetId,
      voiceReferenceAudioPath: state.narratorVoiceReferenceAudioPath,
      voiceReferenceAudioName: state.narratorVoiceReferenceAudioName,
      voiceReferenceText: state.narratorVoiceReferenceText,
      voicePromptText: state.narratorVoicePromptText,
      voiceMixVoices: state.narratorVoiceMixVoices,
    };
  }

  async function reloadAll() {
    saveSettings();
    if (!state.token.trim()) {
      clearRuntime();
      return;
    }
    state.loading = true;
    try {
      const [user, projects, worlds, sessions] = await Promise.all([
        api.getUser().catch(() => null),
        api.getProjects().catch(() => []),
        api.listWorlds(undefined).catch(() => []),
        api.listSession(undefined).catch(() => []),
      ]);
      if (user) {
        state.userName = String((user as any).name || "");
        state.userId = Number((user as any).id || 0);
      }
      state.projects = projects || [];
      if (state.projects.length && !state.projects.find((item) => item.id === state.selectedProjectId)) {
        state.selectedProjectId = state.projects[0].id;
      }
      if (state.selectedProjectId <= 0 && state.projects.length) {
        state.selectedProjectId = state.projects[0].id;
      }
      if (state.selectedProjectId > 0) {
        const currentProject = state.projects.find((item) => item.id === state.selectedProjectId) || state.projects[0];
        if (currentProject?.name) {
          state.selectedProjectNameCache = currentProject.name;
          storageSet("toonflow.selectedProjectNameCache", currentProject.name);
        }
      }
      state.worlds = worlds || [];
      state.sessions = sessions || [];
      if (!state.worldId && state.selectedProjectId > 0) {
        const maybeWorld = worlds.find((item) => item.projectId === state.selectedProjectId && isWorldPublished(item));
        if (maybeWorld) {
          state.notice = `已加载 ${maybeWorld.name}`;
        }
      }
      if (!state.projects.length) {
        state.notice = "当前账号暂无项目";
      } else if (!state.notice) {
        state.notice = `已加载 ${state.projects.length} 个项目`;
      }
    } catch (err) {
      state.notice = `加载失败: ${(err as Error).message}`;
    } finally {
      state.loading = false;
    }
  }

  async function loginAndSaveToken() {
    if (!state.loginUsername.trim() || !state.loginPassword.trim()) {
      state.notice = "请输入用户名和密码";
      return;
    }
    state.loading = true;
    try {
      const result = await api.login(state.loginUsername.trim(), state.loginPassword);
      state.token = result.token;
      state.userName = result.name || state.loginUsername.trim();
      state.userId = result.id || 0;
      saveSettings();
      state.notice = "登录成功";
      await reloadAll();
    } catch (err) {
      state.notice = `登录失败: ${(err as Error).message}`;
    } finally {
      state.loading = false;
    }
  }

  function saveConnection() {
    saveSettings();
    state.notice = state.token.trim() ? "连接设置已保存" : "连接设置已保存，请先登录";
  }

  function setTab(tab: AppTab) {
    state.activeTab = tab;
  }

  function selectProject(projectId: number) {
    state.selectedProjectId = projectId;
    storageSet("toonflow.selectedProjectId", String(projectId));
    const currentProject = state.projects.find((item) => item.id === projectId);
    if (currentProject?.name) {
      state.selectedProjectNameCache = currentProject.name;
      storageSet("toonflow.selectedProjectNameCache", currentProject.name);
    }
  }

  async function startNewStoryDraft() {
    resetStoryEditor();
    state.createStep = 0;
    state.worldPublishStatus = "draft";
    state.activeTab = "create";
    if (!state.selectedProjectId && state.projects.length) {
      state.selectedProjectId = state.projects[0].id;
    }
  }

  async function loadWorldForEdit(world: WorldItem) {
    state.loading = true;
    try {
      const worldDetail = await api.getWorldById(world.id);
      const chapters = await api.getChapter(world.id).catch(() => []);
      if (!worldDetail) {
        throw new Error("未找到世界观");
      }
      state.worldId = worldDetail.id;
      state.worldName = worldDetail.name || "";
      state.worldIntro = worldDetail.intro || "";
      state.worldCoverPath = worldDetail.coverPath || worldDetail.settings?.coverPath || worldDetail.settings?.coverBgPath || "";
      state.worldCoverBgPath = worldDetail.settings?.coverBgPath || worldDetail.coverPath || worldDetail.settings?.coverPath || "";
      state.worldPublishStatus = worldDetail.publishStatus || worldDetail.settings?.publishStatus || "draft";
      state.globalBackground = worldDetail.settings?.globalBackground || "";
      state.allowRoleView = worldDetail.settings?.allowRoleView ?? true;
      state.allowChatShare = worldDetail.settings?.allowChatShare ?? true;
      state.playerName = worldDetail.playerRole?.name || "用户";
      state.playerDesc = worldDetail.playerRole?.description || "";
      state.userAvatarPath = worldDetail.playerRole?.avatarPath || "";
      state.userAvatarBgPath = worldDetail.playerRole?.avatarBgPath || "";
      state.playerVoice = worldDetail.playerRole?.voice || "";
      state.playerVoiceMode = worldDetail.playerRole?.voiceMode || "text";
      state.playerVoiceConfigId = worldDetail.playerRole?.voiceConfigId ?? null;
      state.playerVoicePresetId = worldDetail.playerRole?.voicePresetId || "";
      state.playerVoiceReferenceAudioPath = worldDetail.playerRole?.voiceReferenceAudioPath || "";
      state.playerVoiceReferenceAudioName = worldDetail.playerRole?.voiceReferenceAudioName || "";
      state.playerVoiceReferenceText = worldDetail.playerRole?.voiceReferenceText || "";
      state.playerVoicePromptText = worldDetail.playerRole?.voicePromptText || "";
      state.playerVoiceMixVoices = worldDetail.playerRole?.voiceMixVoices || [];
      state.narratorName = worldDetail.narratorRole?.name || "旁白";
      state.narratorVoice = worldDetail.narratorRole?.voice || "默认旁白";
      state.narratorVoiceMode = worldDetail.narratorRole?.voiceMode || "text";
      state.narratorVoiceConfigId = worldDetail.narratorRole?.voiceConfigId ?? null;
      state.narratorVoicePresetId = worldDetail.narratorRole?.voicePresetId || "";
      state.narratorVoiceReferenceAudioPath = worldDetail.narratorRole?.voiceReferenceAudioPath || "";
      state.narratorVoiceReferenceAudioName = worldDetail.narratorRole?.voiceReferenceAudioName || "";
      state.narratorVoiceReferenceText = worldDetail.narratorRole?.voiceReferenceText || "";
      state.narratorVoicePromptText = worldDetail.narratorRole?.voicePromptText || "";
      state.narratorVoiceMixVoices = worldDetail.narratorRole?.voiceMixVoices || [];
      state.npcRoles = (worldDetail.settings?.roles || []).filter((item) => item.id !== "player" && item.id !== "narrator");
      state.chapters = chapters || [];
      const firstChapter = state.chapters[0] || null;
      if (firstChapter) {
        await selectChapter(firstChapter.id, false);
      } else {
        resetChapterDraft();
      }
      state.createStep = 0;
      state.activeTab = "create";
    } finally {
      state.loading = false;
    }
  }

  async function openWorldForEdit(world: WorldItem) {
    await loadWorldForEdit(world);
  }

  async function reopenPublishedWorldAsDraft(world: WorldItem) {
    await loadWorldForEdit(world);
    state.worldPublishStatus = "draft";
    await saveWorldOnly(false);
    state.notice = "已转回草稿，可继续编辑";
  }

  async function deleteWorld(world: WorldItem) {
    await api.deleteWorld(Number(world.id));
    if (Number(state.worldId || 0) === Number(world.id || 0)) {
      resetStoryEditor();
    }
    await reloadAll();
    state.notice = "草稿已删除";
  }

  function resetChapterDraft() {
    const nextSort = Math.max(0, ...state.chapters.map((item) => Number(item.sort || 0))) + 1;
    const empty = createEmptyEditorState(nextSort);
    state.selectedChapterId = null;
    state.chapterTitle = empty.title;
    state.chapterContent = empty.content || "";
    state.chapterEntryCondition = "";
    state.chapterCondition = "";
    state.chapterOpeningRole = empty.openingRole || "旁白";
    state.chapterOpeningLine = empty.openingText || "";
    state.chapterBackground = empty.backgroundPath || "";
    state.chapterMusic = empty.bgmPath || "";
    state.chapterConditionVisible = empty.showCompletionCondition ?? true;
  }

  async function selectChapter(chapterId: number | null, saveCurrent = true) {
    if (saveCurrent) {
      await saveChapterDraft(false);
    }
    if (chapterId === null) {
      resetChapterDraft();
      return;
    }
    const chapter = state.chapters.find((item) => item.id === chapterId);
    if (!chapter) {
      resetChapterDraft();
      return;
    }
    state.selectedChapterId = chapter.id;
    state.chapterTitle = chapter.title || "";
    state.chapterContent = chapter.content || "";
    state.chapterEntryCondition = typeof chapter.entryCondition === "string" ? chapter.entryCondition : JSON.stringify(chapter.entryCondition || "", null, 0);
    state.chapterCondition = typeof chapter.completionCondition === "string" ? chapter.completionCondition : JSON.stringify(chapter.completionCondition || "", null, 0);
    state.chapterOpeningRole = chapter.openingRole || "旁白";
    state.chapterOpeningLine = chapter.openingText || "";
    state.chapterBackground = chapter.backgroundPath || "";
    state.chapterMusic = chapter.bgmPath || "";
    state.chapterConditionVisible = chapter.showCompletionCondition ?? true;
  }

  async function saveWorldOnly(publish = false) {
    const payload = {
      worldId: state.worldId || undefined,
      projectId: state.selectedProjectId,
      name: state.worldName.trim(),
      intro: state.worldIntro.trim(),
      coverPath: state.worldCoverPath,
      publishStatus: publish ? "published" : state.worldPublishStatus || "draft",
      settings: storySettingsObject(),
      playerRole: currentPlayerRole(),
      narratorRole: currentNarratorRole(),
    };
    const result = await api.saveWorld(payload);
    state.worldId = result.id;
    state.worldPublishStatus = publish ? "published" : "draft";
    await reloadWorldsAfterSave();
    return result;
  }

  async function saveChapterDraft(showNotice = true) {
    if (!state.worldId) {
      const world = await saveWorldOnly(false);
      state.worldId = world.id;
    }
    const chapterPayload = {
      chapterId: state.selectedChapterId || undefined,
      worldId: state.worldId,
      chapterKey: state.chapterTitle.trim() || `chapter_${Date.now()}`,
      backgroundPath: state.chapterBackground,
      openingRole: state.chapterOpeningRole,
      openingText: state.chapterOpeningLine,
      bgmPath: state.chapterMusic,
      showCompletionCondition: state.chapterConditionVisible,
      title: state.chapterTitle.trim() || `章节 ${Date.now()}`,
      content: state.chapterContent,
      entryCondition: safeJsonParse(state.chapterEntryCondition, state.chapterEntryCondition || null),
      completionCondition: safeJsonParse(state.chapterCondition, state.chapterCondition || null),
      sort: state.selectedChapterId ? state.chapters.find((item) => item.id === state.selectedChapterId)?.sort || state.chapters.length + 1 : state.chapters.length + 1,
      status: "draft",
    };
    const saved = await api.saveChapter(chapterPayload);
    const index = state.chapters.findIndex((item) => item.id === saved.id);
    if (index >= 0) {
      state.chapters[index] = saved;
    } else {
      state.chapters.push(saved);
    }
    state.selectedChapterId = saved.id;
    if (showNotice) {
      state.notice = "章节已保存";
    }
    await reloadWorldsAfterSave();
    return saved;
  }

  async function saveStoryEditor(publish = false, startNextDraft = false, successNotice = "保存成功") {
    const world = await saveWorldOnly(publish);
    if (state.chapterTitle.trim() || state.chapterContent.trim() || state.chapterOpeningLine.trim()) {
      await saveChapterDraft(false);
    }
    if (startNextDraft) {
      await selectChapter(null, false);
    }
    state.notice = successNotice || (publish ? "故事已发布" : "故事已保存");
    if (publish) {
      state.worldPublishStatus = "published";
    }
    return world;
  }

  async function reloadWorldsAfterSave() {
    state.worlds = await api.listWorlds(state.selectedProjectId || undefined).catch(() => state.worlds);
  }

  async function saveCurrentChapterAndSelect(targetChapterId: number | null) {
    await saveChapterDraft(false);
    await selectChapter(targetChapterId, false);
  }

  async function startFromWorld(world: WorldItem, quickText = "") {
    const chapters = await api.getChapter(world.id).catch(() => []);
    const startChapter = chapters[0] || null;
    const session = await api.startSession({
      worldId: world.id,
      projectId: world.projectId,
      chapterId: startChapter?.id || undefined,
      title: world.name || "会话",
      initialState: null,
    });
    await openSession(session.sessionId);
    if (quickText.trim()) {
      state.sendText = quickText.trim();
      await sendMessage();
    }
    state.activeTab = "play";
  }

  async function quickStart() {
    const world = recommendedWorld();
    if (!world) {
      state.notice = "当前没有可游玩故事";
      return;
    }
    await startFromWorld(world, state.quickInput.trim());
    state.quickInput = "";
  }

  async function openSession(sessionId: string) {
    state.debugMode = false;
    state.currentSessionId = sessionId;
    const detail = await api.getSession(sessionId);
    state.sessionDetail = detail;
    state.messages = detail.messages || [];
    state.activeTab = "play";
  }

  async function refreshCurrentSession() {
    if (state.debugMode || !state.currentSessionId) return;
    const detail = await api.getSession(state.currentSessionId);
    state.sessionDetail = detail;
    state.messages = detail.messages || [];
  }

  function startDebugCurrentChapter() {
    state.debugMode = true;
    state.currentSessionId = `debug_${Date.now()}`;
    state.debugSessionTitle = state.worldName || "调试会话";
    state.debugWorldName = state.worldName || "";
    state.debugWorldIntro = state.worldIntro || "";
    state.debugEndDialog = null;
    const index = getDebugChapterIndex();
    const chapter = syncDebugChapter(index);
    if (!chapter) {
      state.debugEndDialog = "当前没有章节可调试";
      state.messages = [];
      state.sessionDetail = null;
      state.activeTab = "play";
      return;
    }
    state.messages = [
      {
        id: Date.now(),
        role: state.narratorName || "旁白",
        roleType: "narrator",
        eventType: "on_enter_debug",
        content: `调试模式：从《${chapter?.title || state.chapterTitle || "当前章节"}》开始。`,
        createTime: Date.now(),
      },
    ];
    state.sessionDetail = null;
    state.activeTab = "play";
  }

  async function sendMessage() {
    const content = state.sendText.trim();
    if (!content) return;
    if (state.debugMode) {
      const now = Date.now();
      state.messages.push({
        id: now,
        role: state.playerName || "用户",
        roleType: "player",
        eventType: "on_message",
        content,
        createTime: now,
      });
      state.messages.push({
        id: now + 1,
        role: state.narratorName || "旁白",
        roleType: "narrator",
        eventType: "on_message",
        content: `调试回应：已接收“${content}”。`,
        createTime: now + 1,
      });
      state.sendText = "";
      advanceDebugChapterIfNeeded(content);
      return;
    }
    if (!state.currentSessionId) return;
    await api.addMessage({
      sessionId: state.currentSessionId,
      roleType: "player",
      role: state.playerName || "用户",
      content,
      eventType: "on_message",
    });
    state.sendText = "";
    await refreshCurrentSession();
  }

  function copyMessageText(text: string) {
    navigator.clipboard?.writeText(text).catch(() => void 0);
  }

  function reactMessage(messageId: number, kind: "like" | "dislike" | "reset") {
    const key = String(messageId);
    if (kind === "reset") {
      delete state.messageReactions[key];
    } else if (state.messageReactions[key] === kind) {
      delete state.messageReactions[key];
    } else {
      state.messageReactions[key] = kind;
    }
  }

  watch(
    () => state.messageReactions,
    () => {
      storageSet("toonflow.messageReactions", JSON.stringify(state.messageReactions));
    },
    { deep: true },
  );

  watch(
    () => [state.baseUrl, state.token, state.accountAvatarPath, state.accountAvatarBgPath, state.selectedProjectId],
    () => saveSettings(),
    { deep: true },
  );

  const apiFacade = {
    state,
    api,
    saveSettings,
    reloadAll,
    loginAndSaveToken,
    saveConnection,
    setTab,
    selectProject,
    startNewStoryDraft,
    openWorldForEdit,
    reopenPublishedWorldAsDraft,
    deleteWorld,
    saveStoryEditor,
    saveWorldOnly,
    saveChapterDraft,
    saveCurrentChapterAndSelect,
    selectChapter,
    startFromWorld,
    quickStart,
    openSession,
    refreshCurrentSession,
    startDebugCurrentChapter,
    advanceDebugChapterIfNeeded,
    jumpDebugChapter,
    getDebugChapterIndex,
    syncDebugChapter,
    sendMessage,
    copyMessageText,
    reactMessage,
    fetchVoiceModels,
    fetchVoicePresets,
    voicePresetsForConfig,
    uploadVoiceReferenceAudio,
    previewVoice,
    applyImageToTarget,
    updateAvatarFromFile,
    updateCoverFromFile,
    updateChapterBackgroundFromFile,
    setPlayerVoiceBinding,
    setNarratorVoiceBinding,
    setNpcRoleVoice,
    setNpcRoleAvatar,
    setNpcRoleName,
    setNpcRoleDescription,
    setNpcRoleSample,
    addNpcRole,
    removeNpcRole,
    isWorldPublished,
    worldCoverPath,
    selectedProjectName,
    selectedProjectIntro,
    worldsForSelectedProject,
    publishedWorldsForSelectedProject,
    draftWorldsForSelectedProject,
    recommendedWorld,
    filteredHallWorlds,
    mentionRoleNames,
    appendGlobalMention,
    appendChapterMention,
    resolveMediaPath,
  };

  return apiFacade;
}

export function useToonflowStore(): ToonflowStore {
  if (!singletonStore) {
    singletonStore = createToonflowStore();
  }
  return singletonStore;
}

export type { ToonflowStore };
