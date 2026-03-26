import { computed, reactive, watch } from "vue";
import { ToonflowApi } from "../api/toonflow";
import {
  AiModelMapItem,
  AppTab,
  ChapterExtra,
  ChapterItem,
  MessageItem,
  ModelConfigItem,
  ModelConfigPayload,
  ModelTestResult,
  ProjectItem,
  PromptItem,
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
import { fileToBase64Payload } from "../utils/file";

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

function normalizeAliyunDirectConfigFields(manufacturer: string, modelType: string, model: string, baseUrl: string) {
  if (manufacturer !== "aliyun_direct") {
    return { model, baseUrl };
  }
  return {
    model: model.trim() || (modelType === "asr" ? "qwen3-asr-flash" : "cosyvoice-v3-flash"),
    baseUrl: modelType === "asr" ? "https://dashscope.aliyuncs.com/compatible-mode" : "https://dashscope.aliyuncs.com",
  };
}

function normalizeVoiceModelConfig(input: VoiceModelConfig): VoiceModelConfig {
  const manufacturer = String(input.manufacturer || "").trim();
  const modelType = String(input.modelType || "").trim().toLowerCase();
  if (manufacturer !== "aliyun_direct") return input;
  const normalized = normalizeAliyunDirectConfigFields(manufacturer, modelType, String(input.model || "").trim(), String(input.baseUrl || "").trim());
  return {
    ...input,
    model: normalized.model,
    baseUrl: normalized.baseUrl,
  };
}

function normalizeModelConfigItem(input: ModelConfigItem): ModelConfigItem {
  const manufacturer = String(input.manufacturer || "").trim();
  const modelType = String(input.modelType || "").trim().toLowerCase();
  if (manufacturer !== "aliyun_direct") return input;
  const normalized = normalizeAliyunDirectConfigFields(manufacturer, modelType, String(input.model || "").trim(), String(input.baseUrl || "").trim());
  return {
    ...input,
    model: normalized.model,
    baseUrl: normalized.baseUrl,
  };
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

function normalizeScalarEditorText(input: unknown): string {
  if (input === null || input === undefined) return "";
  const raw = String(input);
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (["null", "undefined", "\"\"", "''", "\"null\"", "\"undefined\""].includes(trimmed)) return "";
  return raw;
}

function normalizeConditionEditorText(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") {
    const scalar = normalizeScalarEditorText(input).trim();
    if (!scalar) return "";
    try {
      const parsed = JSON.parse(scalar) as unknown;
      if (parsed === null || parsed === undefined || parsed === "") return "";
      if (typeof parsed === "string") return normalizeScalarEditorText(parsed).trim();
      return JSON.stringify(parsed, null, 2);
    } catch {
      return scalar;
    }
  }
  return JSON.stringify(input, null, 2);
}

function extractOpeningContentParts(input: unknown): { role: string; line: string; body: string } | null {
  const text = normalizeScalarEditorText(input);
  if (!text) return null;
  const match = text.match(/^开场白(?:\[(.+?)\]|([^\[\]:：\r\n]+))\s*[:：]\s*([^\r\n]*)(?:\r?\n)*/);
  if (!match) return null;
  const role = String(match[1] || match[2] || "").trim();
  const line = String(match[3] || "").trim();
  const body = text.slice(match[0].length).replace(/^\s*[\r\n]+/, "");
  if (!role && !line) return null;
  return { role, line, body };
}

function stripLeadingOpeningBlocks(input: unknown): string {
  let text = normalizeScalarEditorText(input);
  if (!text) return "";
  for (let i = 0; i < 8; i += 1) {
    const extracted = extractOpeningContentParts(text);
    if (!extracted) break;
    text = extracted.body.replace(/^\s*[\r\n]+/, "");
  }
  return text;
}

function normalizeDisplayChapterTitle(input: unknown, sort?: unknown): string {
  const raw = normalizeScalarEditorText(input).trim();
  if (raw && !/^章节\s*\d{10,}$/u.test(raw)) return raw;
  const chapterSort = Number(sort || 0);
  if (Number.isFinite(chapterSort) && chapterSort > 0) {
    return `第 ${chapterSort} 章`;
  }
  return raw;
}

function splitParagraphs(input: string): string[] {
  return String(input || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeRegExp(input: string): string {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripOpeningHeader(input: unknown, openingRole: string): string {
  const text = normalizeScalarEditorText(input).trimStart();
  if (!text) return "";
  const role = normalizeScalarEditorText(openingRole).trim();
  const header = role
    ? new RegExp(`^开场白(?:\\[${escapeRegExp(role)}\\]|${escapeRegExp(role)})?\\s*[:：]\\s*`)
    : /^开场白(?:\[(.+?)\]|([^\[\]:：\r\n]+))?\s*[:：]\s*/;
  return text.replace(header, "").replace(/^\s*[\r\n]+/, "");
}

function stripLeadingOpeningParagraphs(input: string, openingLine: string): string {
  const openingParagraphs = splitParagraphs(openingLine);
  if (!openingParagraphs.length) return input.trim();
  const openingSet = new Set(openingParagraphs);
  const contentParagraphs = splitParagraphs(input);
  while (contentParagraphs.length && openingSet.has(contentParagraphs[0])) {
    contentParagraphs.shift();
  }
  return contentParagraphs.join("\n\n").trim();
}

function normalizeOpeningEditorFields(openingRole: string, openingLine: string, content: string): {
  openingRole: string;
  openingLine: string;
  content: string;
} {
  const role = normalizeScalarEditorText(openingRole).trim() || "旁白";
  let line = normalizeScalarEditorText(openingLine).trim();
  let body = normalizeScalarEditorText(content).trim();
  const openingParagraphs = splitParagraphs(line);
  if (openingParagraphs.length > 1) {
    line = openingParagraphs[0];
    const remainder = openingParagraphs.slice(1).join("\n\n").trim();
    if (remainder) {
      const remainderParagraphs = splitParagraphs(remainder);
      const contentParagraphs = splitParagraphs(body);
      const alreadyPrefixed = remainderParagraphs.every((item, index) => contentParagraphs[index] === item);
      if (!alreadyPrefixed) {
        body = [remainder, body].filter(Boolean).join("\n\n").trim();
      }
    }
  }
  return { openingRole: role, openingLine: line, content: body };
}

function stripLeadingOpeningArtifacts(input: unknown, openingRole: string, openingLine: string): string {
  let text = normalizeScalarEditorText(input);
  if (!text) return "";
  const expectedRole = normalizeScalarEditorText(openingRole).trim();
  const expectedLine = normalizeScalarEditorText(openingLine).trim();
  const expectedParagraphs = splitParagraphs(expectedLine).sort((a, b) => b.length - a.length);
  for (let i = 0; i < 64; i += 1) {
    const before = text;
    text = stripOpeningHeader(text, expectedRole);
    const extracted = extractOpeningContentParts(text);
    if (extracted) {
      const roleMatches = !expectedRole || !extracted.role || extracted.role === expectedRole;
      const lineMatches = !expectedLine || !extracted.line || expectedLine.startsWith(extracted.line) || extracted.line === expectedLine;
      if (roleMatches && lineMatches) {
        text = extracted.body.replace(/^\s*[\r\n]+/, "");
      }
    }
    if (expectedLine && text.startsWith(expectedLine)) {
      text = text.slice(expectedLine.length).replace(/^\s*[\r\n]+/, "");
    }
    const paragraphMatch = expectedParagraphs.find((item) => item && text.startsWith(item));
    if (paragraphMatch) {
      text = text.slice(paragraphMatch.length).replace(/^\s*[\r\n]+/, "");
    }
    if (text === before) break;
  }
  if (expectedLine) {
    text = stripLeadingOpeningParagraphs(text, expectedLine);
  }
  return text.trim();
}

function stripOpeningPrefix(input: unknown, openingRole: string, openingLine: string): string {
  return stripLeadingOpeningArtifacts(input, openingRole, openingLine);
}

function dedupeSessionsByWorld<T extends { worldId?: number | null; updateTime?: number | null }>(rows: T[]): T[] {
  const latestByWorld = new Map<number, T>();
  for (const row of rows || []) {
    const worldId = Number(row?.worldId || 0);
    if (worldId <= 0) continue;
    const current = latestByWorld.get(worldId);
    const nextTime = Number(row?.updateTime || 0);
    const currentTime = Number(current?.updateTime || 0);
    if (!current || nextTime >= currentTime) {
      latestByWorld.set(worldId, row);
    }
  }
  return Array.from(latestByWorld.values()).sort((a, b) => Number(b.updateTime || 0) - Number(a.updateTime || 0));
}

function buildPersistedChapterContent(input: unknown, openingRole: string, openingLine: string, fallbackRole = "旁白"): string {
  const role = normalizeScalarEditorText(openingRole).trim() || fallbackRole;
  const line = normalizeScalarEditorText(openingLine).trim();
  return stripLeadingOpeningArtifacts(input, role, line);
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
    narratorVoice: "混合（清朗温润）",
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

interface StoryEditorSnapshot {
  createStep: 0 | 1;
  worldId: number;
  worldName: string;
  worldIntro: string;
  worldCoverPath: string;
  worldCoverBgPath: string;
  playerName: string;
  playerDesc: string;
  playerVoice: string;
  playerVoiceConfigId: number | null;
  playerVoicePresetId: string;
  playerVoiceMode: string;
  playerVoiceReferenceAudioPath: string;
  playerVoiceReferenceAudioName: string;
  playerVoiceReferenceText: string;
  playerVoicePromptText: string;
  playerVoiceMixVoices: VoiceMixItem[];
  narratorName: string;
  narratorVoice: string;
  narratorVoiceConfigId: number | null;
  narratorVoicePresetId: string;
  narratorVoiceMode: string;
  narratorVoiceReferenceAudioPath: string;
  narratorVoiceReferenceAudioName: string;
  narratorVoiceReferenceText: string;
  narratorVoicePromptText: string;
  narratorVoiceMixVoices: VoiceMixItem[];
  globalBackground: string;
  allowRoleView: boolean;
  allowChatShare: boolean;
  worldPublishStatus: string;
  npcRoles: StoryRole[];
  chapters: ChapterItem[];
  selectedChapterId: number | null;
  chapterTitle: string;
  chapterContent: string;
  chapterEntryCondition: string;
  chapterCondition: string;
  chapterOpeningRole: string;
  chapterOpeningLine: string;
  chapterBackground: string;
  chapterMusic: string;
  chapterConditionVisible: boolean;
}

type ToonflowStore = ReturnType<typeof createToonflowStore>;
type DebugChapterResult = "continue" | "success" | "failed";

let singletonStore: ToonflowStore | null = null;

const GAME_MODEL_SLOTS = [
  { key: "storyOrchestratorModel", label: "编排师", configType: "text" },
  { key: "storyMemoryModel", label: "记忆管理", configType: "text" },
  { key: "storyImageModel", label: "AI生图", configType: "image" },
  { key: "storyVoiceModel", label: "语音生成", configType: "voice" },
  { key: "storyAsrModel", label: "语音识别", configType: "voice" },
] as const;

const STORY_PROMPT_CODES = [
  "story-main",
  "story-orchestrator",
  "story-memory",
  "story-chapter",
  "story-mini-game",
  "story-safety",
] as const;

function createToonflowStore() {
  const state = reactive({
    baseUrl: storageGet("toonflow.baseUrl", "http://127.0.0.1:60000"),
    token: storageGet("toonflow.token", ""),
    loginUsername: storageGet("toonflow.loginUsername", "admin"),
    loginPassword: storageGet("toonflow.loginPassword", "admin123"),
    notice: "",
    activeTab: "home" as AppTab,
    loading: false,
    userName: storageGet("toonflow.userName", ""),
    userId: Number(storageGet("toonflow.userId", "0")) || 0,
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
    settingsPanelLoading: false,
    settingsPanelLoaded: false,
    settingsTextConfigs: [] as ModelConfigItem[],
    settingsImageConfigs: [] as ModelConfigItem[],
    settingsVoiceConfigs: [] as VoiceModelConfig[],
    settingsAiModelMap: [] as AiModelMapItem[],
    storyPrompts: [] as PromptItem[],
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
    debugRuntimeState: {} as Record<string, unknown>,
    debugStatePreview: "{}",
    debugEndDialog: null as string | null,
    debugLoading: false,
    debugLoadingStage: "",
    messageReactions: safeJsonParse(storageGet("toonflow.messageReactions", "{}"), {} as Record<string, string>),
  });

  const api = new ToonflowApi(() => ({ baseUrl: state.baseUrl, token: state.token }));
  let editorAutoPersistTimer: number | null = null;
  let editorPersistMuted = false;
  let lastPersistedEditorSnapshot: StoryEditorSnapshot | null = null;
  let lastPersistedEditorSignature = "";
  let undoEditorSnapshot: StoryEditorSnapshot | null = null;

  function saveSettings() {
    storageSet("toonflow.baseUrl", state.baseUrl.trim());
    storageSet("toonflow.token", state.token.trim());
    storageSet("toonflow.loginUsername", state.loginUsername.trim());
    storageSet("toonflow.loginPassword", state.loginPassword);
    storageSet("toonflow.userName", state.userName.trim());
    storageSet("toonflow.userId", String(state.userId || 0));
    storageSet("toonflow.accountAvatarPath", state.accountAvatarPath);
    storageSet("toonflow.accountAvatarBgPath", state.accountAvatarBgPath);
  }

  async function persistAccountAvatar() {
    if (!state.token.trim() || state.userId <= 0) return;
    await api.saveUser({
      avatarPath: state.accountAvatarPath,
      avatarBgPath: state.accountAvatarBgPath || state.accountAvatarPath,
    });
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
    state.settingsPanelLoaded = false;
    state.settingsTextConfigs = [];
    state.settingsImageConfigs = [];
    state.settingsVoiceConfigs = [];
    state.settingsAiModelMap = [];
    state.storyPrompts = [];
    state.debugLoading = false;
    state.debugLoadingStage = "";
    state.notice = "";
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
    primeStoryEditorPersistState();
  }

  function cloneStoryEditorSnapshot(snapshot: StoryEditorSnapshot): StoryEditorSnapshot {
    return JSON.parse(JSON.stringify(snapshot)) as StoryEditorSnapshot;
  }

  function captureStoryEditorSnapshot(): StoryEditorSnapshot {
    return {
      createStep: state.createStep,
      worldId: state.worldId,
      worldName: state.worldName,
      worldIntro: state.worldIntro,
      worldCoverPath: state.worldCoverPath,
      worldCoverBgPath: state.worldCoverBgPath,
      playerName: state.playerName,
      playerDesc: state.playerDesc,
      playerVoice: state.playerVoice,
      playerVoiceConfigId: state.playerVoiceConfigId,
      playerVoicePresetId: state.playerVoicePresetId,
      playerVoiceMode: state.playerVoiceMode,
      playerVoiceReferenceAudioPath: state.playerVoiceReferenceAudioPath,
      playerVoiceReferenceAudioName: state.playerVoiceReferenceAudioName,
      playerVoiceReferenceText: state.playerVoiceReferenceText,
      playerVoicePromptText: state.playerVoicePromptText,
      playerVoiceMixVoices: JSON.parse(JSON.stringify(state.playerVoiceMixVoices || [])) as VoiceMixItem[],
      narratorName: state.narratorName,
      narratorVoice: state.narratorVoice,
      narratorVoiceConfigId: state.narratorVoiceConfigId,
      narratorVoicePresetId: state.narratorVoicePresetId,
      narratorVoiceMode: state.narratorVoiceMode,
      narratorVoiceReferenceAudioPath: state.narratorVoiceReferenceAudioPath,
      narratorVoiceReferenceAudioName: state.narratorVoiceReferenceAudioName,
      narratorVoiceReferenceText: state.narratorVoiceReferenceText,
      narratorVoicePromptText: state.narratorVoicePromptText,
      narratorVoiceMixVoices: JSON.parse(JSON.stringify(state.narratorVoiceMixVoices || [])) as VoiceMixItem[],
      globalBackground: state.globalBackground,
      allowRoleView: state.allowRoleView,
      allowChatShare: state.allowChatShare,
      worldPublishStatus: state.worldPublishStatus,
      npcRoles: JSON.parse(JSON.stringify(state.npcRoles || [])) as StoryRole[],
      chapters: JSON.parse(JSON.stringify(state.chapters || [])) as ChapterItem[],
      selectedChapterId: state.selectedChapterId,
      chapterTitle: state.chapterTitle,
      chapterContent: state.chapterContent,
      chapterEntryCondition: state.chapterEntryCondition,
      chapterCondition: state.chapterCondition,
      chapterOpeningRole: state.chapterOpeningRole,
      chapterOpeningLine: state.chapterOpeningLine,
      chapterBackground: state.chapterBackground,
      chapterMusic: state.chapterMusic,
      chapterConditionVisible: state.chapterConditionVisible,
    };
  }

  function applyStoryEditorSnapshot(snapshot: StoryEditorSnapshot) {
    editorPersistMuted = true;
    const extractedOpening = extractOpeningContentParts(snapshot.chapterContent);
    const snapshotOpeningRole =
      normalizeScalarEditorText(snapshot.chapterOpeningRole).trim() ||
      extractedOpening?.role ||
      snapshot.narratorName ||
      "旁白";
    const snapshotOpeningLine =
      normalizeScalarEditorText(snapshot.chapterOpeningLine).trim() ||
      extractedOpening?.line ||
      "";
    const normalizedChapter = normalizeOpeningEditorFields(
      snapshotOpeningRole,
      snapshotOpeningLine,
      stripOpeningPrefix(snapshot.chapterContent, snapshotOpeningRole, snapshotOpeningLine),
    );
    state.createStep = snapshot.createStep;
    state.worldId = snapshot.worldId;
    state.worldName = snapshot.worldName;
    state.worldIntro = snapshot.worldIntro;
    state.worldCoverPath = snapshot.worldCoverPath;
    state.worldCoverBgPath = snapshot.worldCoverBgPath;
    state.playerName = snapshot.playerName;
    state.playerDesc = snapshot.playerDesc;
    state.playerVoice = snapshot.playerVoice;
    state.playerVoiceConfigId = snapshot.playerVoiceConfigId;
    state.playerVoicePresetId = snapshot.playerVoicePresetId;
    state.playerVoiceMode = snapshot.playerVoiceMode;
    state.playerVoiceReferenceAudioPath = snapshot.playerVoiceReferenceAudioPath;
    state.playerVoiceReferenceAudioName = snapshot.playerVoiceReferenceAudioName;
    state.playerVoiceReferenceText = snapshot.playerVoiceReferenceText;
    state.playerVoicePromptText = snapshot.playerVoicePromptText;
    state.playerVoiceMixVoices = JSON.parse(JSON.stringify(snapshot.playerVoiceMixVoices || [])) as VoiceMixItem[];
    state.narratorName = snapshot.narratorName;
    state.narratorVoice = snapshot.narratorVoice;
    state.narratorVoiceConfigId = snapshot.narratorVoiceConfigId;
    state.narratorVoicePresetId = snapshot.narratorVoicePresetId;
    state.narratorVoiceMode = snapshot.narratorVoiceMode;
    state.narratorVoiceReferenceAudioPath = snapshot.narratorVoiceReferenceAudioPath;
    state.narratorVoiceReferenceAudioName = snapshot.narratorVoiceReferenceAudioName;
    state.narratorVoiceReferenceText = snapshot.narratorVoiceReferenceText;
    state.narratorVoicePromptText = snapshot.narratorVoicePromptText;
    state.narratorVoiceMixVoices = JSON.parse(JSON.stringify(snapshot.narratorVoiceMixVoices || [])) as VoiceMixItem[];
    state.globalBackground = snapshot.globalBackground;
    state.allowRoleView = snapshot.allowRoleView;
    state.allowChatShare = snapshot.allowChatShare;
    state.worldPublishStatus = snapshot.worldPublishStatus;
    state.npcRoles = JSON.parse(JSON.stringify(snapshot.npcRoles || [])) as StoryRole[];
    state.chapters = JSON.parse(JSON.stringify(snapshot.chapters || [])) as ChapterItem[];
    state.selectedChapterId = snapshot.selectedChapterId;
    const selectedSort = state.selectedChapterId
      ? Number(state.chapters.find((item) => item.id === state.selectedChapterId)?.sort || 0)
      : 0;
    state.chapterTitle = normalizeDisplayChapterTitle(snapshot.chapterTitle, selectedSort);
    state.chapterContent = normalizedChapter.content;
    state.chapterEntryCondition = normalizeConditionEditorText(snapshot.chapterEntryCondition);
    state.chapterCondition = normalizeConditionEditorText(snapshot.chapterCondition);
    state.chapterOpeningRole = normalizedChapter.openingRole;
    state.chapterOpeningLine = normalizedChapter.openingLine;
    state.chapterBackground = snapshot.chapterBackground;
    state.chapterMusic = snapshot.chapterMusic;
    state.chapterConditionVisible = snapshot.chapterConditionVisible;
    window.setTimeout(() => {
      editorPersistMuted = false;
    }, 0);
  }

  function hasPersistableStoryEditorContent(snapshot = captureStoryEditorSnapshot()): boolean {
    if (snapshot.worldId > 0) return true;
    if (snapshot.worldName.trim() || snapshot.worldIntro.trim()) return true;
    if (snapshot.worldCoverPath.trim() || snapshot.playerDesc.trim() || snapshot.globalBackground.trim()) return true;
    if (snapshot.chapterTitle.trim() || snapshot.chapterContent.trim() || snapshot.chapterOpeningLine.trim()) return true;
    if (snapshot.chapterEntryCondition.trim() || snapshot.chapterCondition.trim()) return true;
    if (snapshot.chapterBackground.trim() || snapshot.chapterMusic.trim()) return true;
    return snapshot.npcRoles.some((role) =>
      [
        role.name,
        role.description,
        role.avatarPath,
        role.avatarBgPath,
        role.voice,
        role.sample,
      ].some((value) => String(value || "").trim().length > 0),
    );
  }

  function cancelStoryEditorAutoPersist() {
    if (editorAutoPersistTimer) {
      window.clearTimeout(editorAutoPersistTimer);
      editorAutoPersistTimer = null;
    }
  }

  function primeStoryEditorPersistState(clearUndo = true) {
    cancelStoryEditorAutoPersist();
    lastPersistedEditorSnapshot = captureStoryEditorSnapshot();
    lastPersistedEditorSignature = JSON.stringify(lastPersistedEditorSnapshot);
    if (clearUndo) {
      undoEditorSnapshot = null;
    }
  }

  function canUndoStoryAutoPersist(): boolean {
    return !!undoEditorSnapshot;
  }

  async function autoPersistStoryEditor() {
    if (editorPersistMuted || state.activeTab !== "create" || state.selectedProjectId <= 0) return;
    const current = captureStoryEditorSnapshot();
    if (!hasPersistableStoryEditorContent(current)) return;
    const currentSignature = JSON.stringify(current);
    if (currentSignature === lastPersistedEditorSignature) return;
    const previous = lastPersistedEditorSnapshot ? cloneStoryEditorSnapshot(lastPersistedEditorSnapshot) : null;
    editorPersistMuted = true;
    try {
      await saveStoryEditor(false, false, null);
      lastPersistedEditorSnapshot = captureStoryEditorSnapshot();
      lastPersistedEditorSignature = JSON.stringify(lastPersistedEditorSnapshot);
      undoEditorSnapshot = previous;
    } finally {
      editorPersistMuted = false;
    }
  }

  function scheduleStoryEditorAutoPersist(delayMs = 900) {
    if (editorPersistMuted || state.activeTab !== "create") return;
    const snapshot = captureStoryEditorSnapshot();
    if (!hasPersistableStoryEditorContent(snapshot)) return;
    if (JSON.stringify(snapshot) === lastPersistedEditorSignature) return;
    cancelStoryEditorAutoPersist();
    editorAutoPersistTimer = window.setTimeout(() => {
      void autoPersistStoryEditor();
    }, delayMs);
  }

  async function undoStoryAutoPersist() {
    if (!undoEditorSnapshot) return;
    const target = cloneStoryEditorSnapshot(undoEditorSnapshot);
    undoEditorSnapshot = null;
    applyStoryEditorSnapshot(target);
    editorPersistMuted = true;
    try {
      await saveStoryEditor(false, false, "已撤回到上一次自动保存前");
      lastPersistedEditorSnapshot = captureStoryEditorSnapshot();
      lastPersistedEditorSignature = JSON.stringify(lastPersistedEditorSnapshot);
    } finally {
      editorPersistMuted = false;
    }
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
    const trimmed = role.trim();
    if (!trimmed) return;
    const prefix = state.globalBackground.trim().length ? " " : "";
    state.globalBackground = `${state.globalBackground}${prefix}@${trimmed} `;
  }

  function appendChapterMention(role: string) {
    const trimmed = role.trim();
    if (!trimmed) return;
    const prefix = state.chapterContent.trim().length ? " " : "";
    state.chapterContent = `${state.chapterContent}${prefix}@${trimmed} `;
  }

  function orderedChapters(): ChapterItem[] {
    return [...state.chapters].sort((a, b) => {
      const sortA = Number(a.sort || 0);
      const sortB = Number(b.sort || 0);
      if (sortA !== sortB) return sortA - sortB;
      return Number(a.id || 0) - Number(b.id || 0);
    });
  }

  function buildEditorChapterSnapshot(): ChapterItem | null {
    const normalizedTitle = normalizeScalarEditorText(state.chapterTitle).trim();
    const normalizedBody = stripOpeningPrefix(
      state.chapterContent,
      state.chapterOpeningRole,
      state.chapterOpeningLine,
    ).trim();
    const normalizedOpeningRole =
      normalizeScalarEditorText(state.chapterOpeningRole).trim() ||
      state.narratorName ||
      "旁白";
    const normalizedOpeningLine = normalizeScalarEditorText(state.chapterOpeningLine).trim();
    const normalizedConditionText = normalizeConditionEditorText(state.chapterCondition);
    const normalizedEntryConditionText = normalizeConditionEditorText(state.chapterEntryCondition);
    const draftSort = state.selectedChapterId
      ? state.chapters.find((item) => item.id === state.selectedChapterId)?.sort || 0
      : Math.max(0, ...state.chapters.map((item) => Number(item.sort || 0))) + 1;
    const hasContent =
      normalizedTitle.length > 0 ||
      normalizedBody.length > 0 ||
      normalizedOpeningLine.length > 0 ||
      normalizedConditionText.length > 0 ||
      normalizedEntryConditionText.length > 0 ||
      normalizeScalarEditorText(state.chapterBackground).trim().length > 0 ||
      normalizeScalarEditorText(state.chapterMusic).trim().length > 0;
    if (!hasContent || draftSort <= 0) return null;
    return {
      id: state.selectedChapterId || -Date.now(),
      worldId: state.worldId || undefined,
      title: normalizedTitle || `第 ${draftSort} 章`,
      content: buildPersistedChapterContent(
        normalizedBody,
        normalizedOpeningRole,
        normalizedOpeningLine,
        state.narratorName || "旁白",
      ),
      entryCondition: safeJsonParse(normalizedEntryConditionText, normalizedEntryConditionText || null),
      completionCondition: safeJsonParse(normalizedConditionText, normalizedConditionText || null),
      sort: draftSort,
      status: state.worldPublishStatus || "draft",
      backgroundPath: normalizeScalarEditorText(state.chapterBackground).trim(),
      openingRole: normalizedOpeningRole,
      openingText: normalizedOpeningLine,
      bgmPath: normalizeScalarEditorText(state.chapterMusic).trim(),
      showCompletionCondition: state.chapterConditionVisible,
    };
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
      state.debugRuntimeState = {
        worldId: state.worldId,
        chapterId: null,
        player: state.playerName,
        narrator: state.narratorName,
      };
      state.debugStatePreview = JSON.stringify(state.debugRuntimeState, null, 2);
      return null;
    }
    state.debugEndDialog = null;
    state.debugChapterId = chapter.id;
    state.debugChapterTitle = normalizeDisplayChapterTitle(chapter.title, chapter.sort || index + 1) || "当前章节";
    state.debugRuntimeState = {
      ...state.debugRuntimeState,
      worldId: state.worldId,
      chapterId: chapter.id,
      chapterTitle: normalizeDisplayChapterTitle(chapter.title, chapter.sort || index + 1),
      player: state.playerName,
      narrator: state.narratorName,
    };
    state.debugStatePreview = JSON.stringify(state.debugRuntimeState, null, 2);
    return chapter;
  }

  function buildDebugChapterSummary(chapter: ChapterItem): string {
    const extractedOpening = extractOpeningContentParts(chapter.content);
    const openingRole = normalizeScalarEditorText(chapter.openingRole).trim() || extractedOpening?.role || state.narratorName || "旁白";
    const openingLine = normalizeScalarEditorText(chapter.openingText).trim() || extractedOpening?.line || "";
    if (openingLine) {
      return openingLine;
    }
    const chapterBody = stripLeadingOpeningArtifacts(chapter.content, openingRole, openingLine).trim();
    if (chapterBody) {
      return chapterBody.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean)[0] || chapterBody.slice(0, 80);
    }
    return `进入章节《${chapter.title || `章节 ${chapter.sort || 1}`}》`;
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

  function extractDebugOutcome(input: unknown): DebugChapterResult {
    if (!input || typeof input !== "object" || Array.isArray(input)) return "success";
    const raw = String(
      (input as Record<string, unknown>).result ??
        (input as Record<string, unknown>).status ??
        (input as Record<string, unknown>).outcome ??
        (input as Record<string, unknown>).onMatched ??
        "success",
    ).trim().toLowerCase();
    return ["failed", "fail", "failure", "lose", "dead"].includes(raw) ? "failed" : "success";
  }

  function extractDebugNextChapterId(input: unknown): number | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const raw = (input as Record<string, unknown>).nextChapterId ?? (input as Record<string, unknown>).nextChapter;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  function evaluateDebugConditionNode(input: unknown, latestMessage: string, currentChapter: ChapterItem): boolean {
    if (input === null || input === undefined) return false;
    if (Array.isArray(input)) {
      if (!input.length) return false;
      return input.some((item) => evaluateDebugConditionNode(item, latestMessage, currentChapter));
    }
    if (typeof input === "string") {
      const token = input.trim();
      if (!token) return false;
      return latestMessage.toLowerCase().includes(token.toLowerCase());
    }
    if (typeof input !== "object") return false;
    const node = input as Record<string, unknown>;
    if (Array.isArray(node.all)) {
      return node.all.length > 0 && node.all.every((item) => evaluateDebugConditionNode(item, latestMessage, currentChapter));
    }
    if (Array.isArray(node.any)) {
      return node.any.length > 0 && node.any.some((item) => evaluateDebugConditionNode(item, latestMessage, currentChapter));
    }
    if (node.not !== undefined) {
      return !evaluateDebugConditionNode(node.not, latestMessage, currentChapter);
    }
    const type = String(node.type ?? "contains").trim().toLowerCase();
    const field = String(node.field ?? "message").trim().toLowerCase();
    const value = String(node.value ?? "").trim();
    const fullText = state.messages.map((item) => item.content).join("\n");
    const target = (() => {
      if (["message", "latest", "latest_message"].includes(field)) return latestMessage;
      if (["messages", "history", "full", "all"].includes(field)) return fullText;
      if (["chapter", "chapter_title"].includes(field)) return currentChapter.title || "";
      if (field === "chapter_content") return currentChapter.content || "";
      return latestMessage;
    })();
    if (!value && !["length_gte", "lengthgte", "length_lte", "lengthlte"].includes(type)) return false;
    switch (type) {
      case "contains":
        return target.toLowerCase().includes(value.toLowerCase());
      case "not_contains":
      case "notcontains":
        return !target.toLowerCase().includes(value.toLowerCase());
      case "equals":
      case "eq":
        return target.trim().toLowerCase() === value.toLowerCase();
      case "not_equals":
      case "neq":
        return target.trim().toLowerCase() !== value.toLowerCase();
      case "regex":
        try {
          return new RegExp(value, "i").test(target);
        } catch {
          return false;
        }
      case "length_gte":
      case "lengthgte":
        return target.length >= Number(value || Number.MAX_SAFE_INTEGER);
      case "length_lte":
      case "lengthlte":
        return target.length <= Number(value || Number.MIN_SAFE_INTEGER);
      default:
        return target.toLowerCase().includes(value.toLowerCase());
    }
  }

  function resolveNextDebugChapter(currentChapterId: number, explicitNextId: number | null): ChapterItem | null {
    const list = orderedChapters();
    if (explicitNextId && explicitNextId > 0) {
      const explicit = list.find((item) => item.id === explicitNextId);
      if (explicit) return explicit;
    }
    const currentIndex = list.findIndex((item) => item.id === currentChapterId);
    if (currentIndex < 0) return null;
    return list[currentIndex + 1] || null;
  }

  function evaluateDebugChapterResult(chapter: ChapterItem, latestMessage: string): { result: DebugChapterResult; nextChapterId: number | null } {
    const condition = chapter.completionCondition;
    if (!hasEffectiveCondition(condition)) {
      return { result: "continue", nextChapterId: null };
    }
    if (condition && typeof condition === "object" && !Array.isArray(condition)) {
      const node = condition as Record<string, unknown>;
      const failureNode = node.failure ?? node.failed ?? node.fail;
      if (failureNode !== undefined && evaluateDebugConditionNode(failureNode, latestMessage, chapter)) {
        return { result: "failed", nextChapterId: extractDebugNextChapterId(node) };
      }
      const successNode = node.success ?? node.pass;
      if (successNode !== undefined && evaluateDebugConditionNode(successNode, latestMessage, chapter)) {
        return { result: "success", nextChapterId: extractDebugNextChapterId(node) };
      }
    }
    const matched = evaluateDebugConditionNode(condition, latestMessage, chapter);
    if (!matched) {
      return { result: "continue", nextChapterId: null };
    }
    return {
      result: extractDebugOutcome(condition),
      nextChapterId: extractDebugNextChapterId(condition),
    };
  }

  function advanceDebugChapterIfNeeded(messageContent: string) {
    const currentChapter = debugChapterContent();
    if (!currentChapter) {
      state.debugEndDialog = "当前没有章节可调试";
      return;
    }
    const decision = evaluateDebugChapterResult(currentChapter, messageContent);
    if (decision.result === "continue") return;
    if (decision.result === "failed") {
      state.messages.push({
        id: Date.now(),
        role: state.narratorName || "旁白",
        roleType: "narrator",
        eventType: "on_debug_failed",
        content: `章节《${currentChapter.title || "当前章节"}》判定失败，调试结束。`,
        createTime: Date.now(),
      });
      state.debugEndDialog = "已失败";
      return;
    }
    const nextChapter = resolveNextDebugChapter(currentChapter.id, decision.nextChapterId);
    if (!nextChapter) {
      state.messages.push({
        id: Date.now(),
        role: state.narratorName || "旁白",
        roleType: "narrator",
        eventType: "on_debug_complete",
        content: `章节《${currentChapter.title || "当前章节"}》完成，故事已完结。`,
        createTime: Date.now(),
      });
      state.debugEndDialog = "已完结";
      return;
    }
    syncDebugChapter(orderedChapters().findIndex((item) => item.id === nextChapter.id));
    const summary = buildDebugChapterSummary(nextChapter);
    state.messages.push({
      id: Date.now(),
      role: state.narratorName || "旁白",
      roleType: "narrator",
      eventType: "on_debug_next_chapter",
      content: summary || `已进入下一章节：《${nextChapter.title || `章节 ${nextChapter.sort || 1}`}》。`,
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
      state.voiceModels = (await api.getVoiceModels()).map(normalizeVoiceModelConfig).filter((item) => {
        const modelType = String(item.modelType || "").trim();
        return !modelType || modelType === "tts";
      });
      if (state.notice.startsWith("加载音色模型失败")) {
        state.notice = "";
      }
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
      if (state.notice.startsWith("加载音色列表失败")) {
        state.notice = "";
      }
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

  function isAdminAccount(): boolean {
    return state.userId === 1 || state.userName.trim().toLowerCase() === "admin";
  }

  function settingsConfigOptions(type: "text" | "image" | "voice"): ModelConfigItem[] {
    if (type === "text") return state.settingsTextConfigs;
    if (type === "image") return state.settingsImageConfigs;
    return state.settingsVoiceConfigs.map((item) => ({
      id: item.id,
      type: item.type || "voice",
      model: normalizeModelConfigItem(item).model,
      modelType: item.modelType,
      manufacturer: item.manufacturer,
      baseUrl: normalizeModelConfigItem(item).baseUrl,
      apiKey: item.apiKey,
      createTime: item.createTime,
    }));
  }

  function settingsModelBinding(key: string): AiModelMapItem | null {
    return state.settingsAiModelMap.find((item) => item.key === key) || null;
  }

  async function resolveRuntimeVoiceConfigId(key: string): Promise<number | null> {
    const current = settingsModelBinding(key)?.configId;
    if (current && current > 0) return current;
    await ensureSettingsPanelData();
    const loaded = settingsModelBinding(key)?.configId;
    return loaded && loaded > 0 ? loaded : null;
  }

  function currentStoryPromptValue(code: string): string {
    const row = state.storyPrompts.find((item) => item.code === code);
    return String(row?.customValue || row?.defaultValue || "");
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

  async function polishVoicePrompt(text: string, style = ""): Promise<string> {
    const result = await api.polishVoicePrompt(text, style);
    return String(result.prompt || "").trim();
  }

  async function transcribeRuntimeVoice(audioBase64: string, sessionId = ""): Promise<string> {
    const configId = await resolveRuntimeVoiceConfigId("storyAsrModel");
    const result = await api.transcribeVoice({
      configId: configId || undefined,
      audioBase64,
      lang: "zh",
      sessionId: sessionId || undefined,
      withSegments: false,
    });
    return String(result?.text || "").trim();
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
    return result.filePath || result.path || "";
  }

  async function uploadImage(target: "account" | "user" | "npc" | "cover" | "chapter", file: File): Promise<string> {
    if (target !== "account" && state.selectedProjectId <= 0) {
      throw new Error("请先选择项目后再上传图片");
    }
    const result = await api.uploadImage({
      projectId: target === "account" ? undefined : state.selectedProjectId || undefined,
      type: target === "cover" || target === "chapter" ? "scene" : "role",
      fileName: file.name || undefined,
      base64Data: await fileToBase64Payload(file),
    });
    return result.filePath || result.path || "";
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
        await persistAccountAvatar();
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
    const path = await uploadImage(target, file);
    if (target === "account") {
      state.accountAvatarPath = path;
      state.accountAvatarBgPath = path;
      await persistAccountAvatar();
    } else if (target === "user") {
      state.userAvatarPath = path;
      state.userAvatarBgPath = path;
    } else if (target === "npc" && typeof roleIndex === "number" && state.npcRoles[roleIndex]) {
      state.npcRoles[roleIndex].avatarPath = path;
      state.npcRoles[roleIndex].avatarBgPath = path;
      onReady?.(path, path);
    }
  }

  async function updateCoverFromFile(file: File) {
    state.worldCoverPath = await uploadImage("cover", file);
    state.worldCoverBgPath = state.worldCoverPath;
  }

  async function updateChapterBackgroundFromFile(file: File) {
    state.chapterBackground = await uploadImage("chapter", file);
  }

  async function ensureSettingsPanelData(force = false) {
    if (!state.token.trim()) return;
    if (state.settingsPanelLoading) return;
    if (state.settingsPanelLoaded && !force) return;
    state.settingsPanelLoading = true;
    try {
      const [configs, voiceConfigs, aiModelMap, prompts] = await Promise.all([
        api.getModelConfigs().catch(() => []),
        api.getVoiceModels().catch(() => []),
        api.getAiModelMap().catch(() => []),
        api.getPrompts().catch(() => []),
      ]);
      state.settingsTextConfigs = configs.filter((item) => String(item.type || "").trim() === "text");
      state.settingsImageConfigs = configs.filter((item) => String(item.type || "").trim() === "image");
      state.settingsVoiceConfigs = (voiceConfigs || [])
        .map(normalizeVoiceModelConfig)
        .filter((item) => String(item.type || "voice").trim() === "voice");
      state.settingsAiModelMap = aiModelMap.filter((item) => GAME_MODEL_SLOTS.some((slot) => slot.key === item.key));
      state.storyPrompts = prompts.filter((item) => STORY_PROMPT_CODES.includes(item.code as (typeof STORY_PROMPT_CODES)[number]));
      state.settingsPanelLoaded = true;
    } catch (err) {
      state.notice = `加载设置失败: ${(err as Error).message}`;
    } finally {
      state.settingsPanelLoading = false;
    }
  }

  async function bindGameModel(key: string, configId: number) {
    const row = settingsModelBinding(key);
    if (!row?.id) {
      throw new Error("模型槽位不存在");
    }
    await api.bindModelConfig(row.id, configId);
    await ensureSettingsPanelData(true);
    state.notice = "模型配置已保存";
  }

  async function addManagedModelConfig(payload: ModelConfigPayload) {
    await api.addModelConfig(payload);
    await ensureSettingsPanelData(true);
    state.notice = "模型配置已新增";
  }

  async function updateManagedModelConfig(payload: ModelConfigPayload) {
    await api.updateModelConfig(payload);
    await ensureSettingsPanelData(true);
    state.notice = "模型配置已更新";
  }

  async function deleteManagedModelConfig(id: number) {
    await api.deleteModelConfig(id);
    await ensureSettingsPanelData(true);
    state.notice = "模型配置已删除";
  }

  async function testManagedModelConfig(config: ModelConfigItem): Promise<ModelTestResult> {
    const type = String(config.type || "").trim();
    const modelType = String(config.modelType || "").trim();
    if (type === "text") {
      const result = await api.testTextModel({
        modelName: String(config.model || "").trim(),
        apiKey: String(config.apiKey || "").trim(),
        baseURL: String(config.baseUrl || "").trim() || undefined,
        manufacturer: String(config.manufacturer || "").trim(),
      });
      return {
        kind: "text",
        content: String(result || "").trim(),
      };
    }
    if (type === "image") {
      const result = await api.testImageModel({
        modelName: String(config.model || "").trim() || undefined,
        apiKey: String(config.apiKey || "").trim(),
        baseURL: String(config.baseUrl || "").trim() || undefined,
        manufacturer: String(config.manufacturer || "").trim(),
      });
      return {
        kind: "image",
        content: resolveMediaUrl(state.baseUrl, String(result || "").trim()),
      };
    }
    if (modelType === "asr") {
      return {
        kind: "text",
        content: "当前为语音识别模型。设置页暂不内置样本音频测试，请在录音入口验证。",
      };
    }
    const presets = await api.getVoicePresets(config.id);
    const firstVoice = presets.find((item) => item.voiceId.trim())?.voiceId || "";
    if (!firstVoice) {
      throw new Error("当前语音模型没有可用音色，无法测试");
    }
    const voice = await api.previewVoice({
      configId: config.id,
      text: "这是 AI 故事设置页的语音模型测试。",
      mode: "text",
      voiceId: firstVoice,
    });
    return {
      kind: "audio",
      content: resolveMediaUrl(state.baseUrl, String(voice.audioUrl || "").trim()),
    };
  }

  async function saveStoryPrompt(code: string, customValue: string) {
    const row = state.storyPrompts.find((item) => item.code === code);
    if (!row?.id) {
      throw new Error("提示词不存在");
    }
    await api.updatePrompt(row.id, code, customValue);
    row.customValue = customValue;
    state.notice = "提示词已保存";
  }

  async function resetStoryPrompt(code: string) {
    await saveStoryPrompt(code, "");
    state.notice = "提示词已重置为默认值";
  }

  function storySettingsObject() {
    const chapterExtras: ChapterExtra[] = state.chapters
      .map((chapter) => ({
        chapterId: chapter.id,
        sort: Number(chapter.sort || 0),
        openingRole: normalizeScalarEditorText(chapter.openingRole).trim(),
        openingLine: normalizeScalarEditorText(chapter.openingText).trim(),
        background: normalizeScalarEditorText(chapter.backgroundPath).trim(),
        music: normalizeScalarEditorText(chapter.bgmPath).trim(),
        conditionVisible: chapter.showCompletionCondition ?? true,
      }))
      .filter((item) => item.sort > 0);
    const draftSort = state.selectedChapterId
      ? state.chapters.find((item) => item.id === state.selectedChapterId)?.sort || 0
      : Math.max(0, ...state.chapters.map((item) => Number(item.sort || 0))) + 1;
    const hasDraftExtra =
      normalizeScalarEditorText(state.chapterOpeningLine).trim().length > 0 ||
      normalizeScalarEditorText(state.chapterBackground).trim().length > 0 ||
      normalizeScalarEditorText(state.chapterMusic).trim().length > 0 ||
      state.chapterConditionVisible !== true;
    if (hasDraftExtra && draftSort > 0) {
      const draftExtra = {
        chapterId: state.selectedChapterId || null,
        sort: draftSort,
        openingRole: normalizeScalarEditorText(state.chapterOpeningRole).trim() || state.narratorName || "旁白",
        openingLine: normalizeScalarEditorText(state.chapterOpeningLine).trim(),
        background: normalizeScalarEditorText(state.chapterBackground).trim(),
        music: normalizeScalarEditorText(state.chapterMusic).trim(),
        conditionVisible: state.chapterConditionVisible,
      };
      const index = chapterExtras.findIndex((item) => (draftExtra.chapterId ? item.chapterId === draftExtra.chapterId : item.sort === draftExtra.sort));
      if (index >= 0) {
        chapterExtras[index] = draftExtra;
      } else {
        chapterExtras.push(draftExtra);
      }
    }
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
      publishStatus: state.worldPublishStatus,
      chapterExtras,
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
        const accountAvatarPath = String((user as any).avatarPath || "").trim();
        const accountAvatarBgPath = String((user as any).avatarBgPath || "").trim();
        state.accountAvatarPath = accountAvatarPath || state.accountAvatarPath;
        state.accountAvatarBgPath = accountAvatarBgPath || state.accountAvatarBgPath || state.accountAvatarPath;
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
      state.sessions = dedupeSessionsByWorld(sessions || []);
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
      await ensureSettingsPanelData(true);
      state.activeTab = "my";
    } catch (err) {
      state.notice = `登录失败: ${(err as Error).message}`;
    } finally {
      state.loading = false;
    }
  }

  async function registerAndLogin(username: string, password: string) {
    const trimmedName = username.trim();
    if (!trimmedName || !password.trim()) {
      throw new Error("请输入账号和密码");
    }
    state.loading = true;
    try {
      const result = await api.register(trimmedName, password);
      state.loginUsername = trimmedName;
      state.loginPassword = password;
      state.token = result.token;
      state.userName = result.name || trimmedName;
      state.userId = result.id || 0;
      saveSettings();
      state.notice = "注册成功";
      await reloadAll();
      await ensureSettingsPanelData(true);
      state.activeTab = "my";
    } finally {
      state.loading = false;
    }
  }

  async function changePassword(oldPassword: string, newPassword: string) {
    if (!state.token.trim()) throw new Error("请先登录账号");
    await api.changePassword(oldPassword, newPassword);
    state.loginPassword = newPassword;
    saveSettings();
    state.notice = "密码已更新";
  }

  function saveConnection() {
    saveSettings();
    state.notice = state.token.trim() ? "连接设置已保存" : "连接设置已保存，请先登录";
  }

  function clearToken() {
    state.token = "";
    state.accountAvatarPath = "";
    state.accountAvatarBgPath = "";
    state.settingsPanelLoaded = false;
    state.settingsTextConfigs = [];
    state.settingsImageConfigs = [];
    state.settingsVoiceConfigs = [];
    state.settingsAiModelMap = [];
    state.storyPrompts = [];
    saveSettings();
    clearRuntime();
    state.notice = "已退出登录";
  }

  function setTab(tab: AppTab) {
    state.activeTab = tab;
    if (tab === "settings" && state.token.trim()) {
      void ensureSettingsPanelData();
    }
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
    primeStoryEditorPersistState();
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
      state.narratorVoice = worldDetail.narratorRole?.voice || "混合（清朗温润）";
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
      primeStoryEditorPersistState();
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

  function beginNewChapterDraft() {
    const nextSort = Math.max(0, ...state.chapters.map((item) => Number(item.sort || 0))) + 1;
    state.selectedChapterId = null;
    state.chapterTitle = `第 ${nextSort} 章`;
    state.chapterContent = "";
    state.chapterEntryCondition = "";
    state.chapterCondition = "";
    state.chapterOpeningRole = state.narratorName || "旁白";
    state.chapterOpeningLine = "";
    state.chapterBackground = "";
    state.chapterMusic = "";
    state.chapterConditionVisible = true;
    primeStoryEditorPersistState();
  }

  async function selectChapter(chapterId: number | null, saveCurrent = true) {
    if (saveCurrent) {
      await saveChapterDraft(false);
    }
    if (chapterId === null) {
      beginNewChapterDraft();
      return;
    }
    const chapter = state.chapters.find((item) => item.id === chapterId);
    if (!chapter) {
      resetChapterDraft();
      return;
    }
    const extractedOpening = extractOpeningContentParts(chapter.content);
    const openingRole = normalizeScalarEditorText(chapter.openingRole).trim() || extractedOpening?.role || "旁白";
    const openingLine = normalizeScalarEditorText(chapter.openingText).trim() || extractedOpening?.line || "";
    const normalizedChapter = normalizeOpeningEditorFields(
      openingRole,
      openingLine,
      stripLeadingOpeningArtifacts(chapter.content, openingRole, openingLine),
    );
    state.selectedChapterId = chapter.id;
    state.chapterTitle = normalizeDisplayChapterTitle(chapter.title, chapter.sort);
    state.chapterContent = normalizedChapter.content;
    state.chapterEntryCondition = normalizeConditionEditorText(chapter.entryCondition);
    state.chapterCondition = normalizeConditionEditorText(chapter.completionCondition);
    state.chapterOpeningRole = normalizedChapter.openingRole;
    state.chapterOpeningLine = normalizedChapter.openingLine;
    state.chapterBackground = normalizeScalarEditorText(chapter.backgroundPath);
    state.chapterMusic = normalizeScalarEditorText(chapter.bgmPath);
    state.chapterConditionVisible = chapter.showCompletionCondition ?? true;
    primeStoryEditorPersistState();
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

  async function saveChapterDraft(showNotice = true, statusOverride?: "draft" | "published") {
    if (!state.worldId) {
      const world = await saveWorldOnly(false);
      state.worldId = world.id;
    }
    const chapterBody = stripLeadingOpeningArtifacts(state.chapterContent, state.chapterOpeningRole, state.chapterOpeningLine);
    const persistedContent = buildPersistedChapterContent(
      chapterBody,
      state.chapterOpeningRole,
      state.chapterOpeningLine,
      state.narratorName || "旁白",
    );
    const entryConditionText = normalizeConditionEditorText(state.chapterEntryCondition);
    const completionConditionText = normalizeConditionEditorText(state.chapterCondition);
    state.chapterContent = chapterBody;
    state.chapterEntryCondition = entryConditionText;
    state.chapterCondition = completionConditionText;
    state.chapterOpeningLine = normalizeScalarEditorText(state.chapterOpeningLine).trim();
    state.chapterOpeningRole = normalizeScalarEditorText(state.chapterOpeningRole).trim() || state.narratorName || "旁白";
    state.chapterBackground = normalizeScalarEditorText(state.chapterBackground).trim();
    state.chapterMusic = normalizeScalarEditorText(state.chapterMusic).trim();
    const chapterSort = state.selectedChapterId
      ? state.chapters.find((item) => item.id === state.selectedChapterId)?.sort || state.chapters.length + 1
      : state.chapters.length + 1;
    const chapterTitle = normalizeDisplayChapterTitle(state.chapterTitle, chapterSort) || `第 ${chapterSort} 章`;
    const chapterPayload = {
      chapterId: state.selectedChapterId || undefined,
      worldId: state.worldId,
      chapterKey: chapterTitle,
      backgroundPath: state.chapterBackground,
      openingRole: state.chapterOpeningRole,
      openingText: state.chapterOpeningLine,
      bgmPath: state.chapterMusic,
      showCompletionCondition: state.chapterConditionVisible,
      title: chapterTitle,
      content: persistedContent,
      entryCondition: safeJsonParse(entryConditionText, entryConditionText || null),
      completionCondition: safeJsonParse(completionConditionText, completionConditionText || null),
      sort: chapterSort,
      status: statusOverride || "draft",
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
    await saveWorldOnly(statusOverride === "published");
    await reloadWorldsAfterSave();
    primeStoryEditorPersistState();
    return saved;
  }

  async function saveStoryEditor(publish = false, startNextDraft = false, successNotice: string | null = "保存成功") {
    const world = await saveWorldOnly(publish);
    if (state.chapterTitle.trim() || state.chapterContent.trim() || state.chapterOpeningLine.trim()) {
      await saveChapterDraft(false, publish ? "published" : "draft");
    }
    if (startNextDraft) {
      beginNewChapterDraft();
    }
    if (successNotice !== null) {
      state.notice = successNotice || (publish ? "故事已发布" : "故事已保存");
    }
    if (publish) {
      state.worldPublishStatus = "published";
    }
    primeStoryEditorPersistState();
    return world;
  }

  async function reloadWorldsAfterSave() {
    const [worlds, sessions] = await Promise.all([
      api.listWorlds(undefined).catch(() => state.worlds),
      api.listSession(undefined).catch(() => state.sessions),
    ]);
    state.worlds = worlds;
    state.sessions = dedupeSessionsByWorld(sessions);
  }

  async function saveCurrentChapterAndSelect(targetChapterId: number | null) {
    await saveChapterDraft(false);
    if (targetChapterId === null) {
      beginNewChapterDraft();
    } else {
      await selectChapter(targetChapterId, false);
    }
    primeStoryEditorPersistState();
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
    state.debugLoading = false;
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

  function applyDebugStepResult(
    result: {
      state?: Record<string, unknown> | null;
      chapterId?: number | null;
      chapterTitle?: string | null;
      endDialog?: string | null;
      messages?: MessageItem[] | null;
    },
    fallbackChapter?: ChapterItem | null,
    appendMessages = false,
  ) {
    state.debugRuntimeState = (result.state || {}) as Record<string, unknown>;
    state.debugStatePreview = JSON.stringify(state.debugRuntimeState, null, 2);
    if (typeof result.chapterId === "number" && result.chapterId > 0) {
      state.debugChapterId = result.chapterId;
    }
    const activeChapter = state.chapters.find((item) => item.id === (result.chapterId ?? state.debugChapterId))
      || fallbackChapter
      || null;
    state.debugChapterTitle = normalizeDisplayChapterTitle(
      result.chapterTitle || activeChapter?.title || state.chapterTitle,
      activeChapter?.sort,
    ) || "当前章节";
    if (appendMessages) {
      if (Array.isArray(result.messages) && result.messages.length) {
        state.messages.push(...result.messages);
      }
    } else {
      state.messages = Array.isArray(result.messages) ? result.messages : [];
    }
    state.debugEndDialog = result.endDialog || null;
    state.sessionDetail = null;
    state.activeTab = "play";
  }

  async function startDebugCurrentChapter() {
    if (state.selectedProjectId <= 0) {
      state.notice = "请先选择项目";
      return;
    }
    if (!state.worldId && !state.worldName.trim() && !state.chapterTitle.trim() && !state.chapterContent.trim() && !state.chapterOpeningLine.trim()) {
      state.notice = "请先填写当前章节";
      return;
    }
    state.debugMode = true;
    state.debugLoading = true;
    state.debugLoadingStage = "进入调试界面";
    state.debugEndDialog = null;
    state.currentSessionId = `debug_${Date.now()}`;
    state.debugSessionTitle = state.worldName || "调试会话";
    state.debugWorldName = state.worldName || "";
    state.debugWorldIntro = state.worldIntro || "";
    state.debugRuntimeState = {};
    state.messages = [];
    state.sessionDetail = null;
    state.activeTab = "play";
    state.notice = "进入调试中...";
    try {
      state.debugLoadingStage = "保存草稿";
      await saveWorldOnly(false);
      if (state.chapterTitle.trim() || state.chapterContent.trim() || state.chapterOpeningLine.trim()) {
        await saveChapterDraft(false, state.worldPublishStatus === "published" ? "published" : "draft");
      }
      state.debugLoadingStage = "创建这次会话环境";
      if (state.worldId) {
        state.chapters = await api.getChapter(state.worldId).catch(() => state.chapters);
        if (state.selectedChapterId) {
          await selectChapter(state.selectedChapterId, false);
        }
      }
      await reloadWorldsAfterSave();

      let preferredDebugChapterId: number | null = state.selectedChapterId;
      const editorChapter = buildEditorChapterSnapshot();
      if (editorChapter) {
        const index = state.chapters.findIndex((item) => item.id === editorChapter.id);
        if (index >= 0) {
          state.chapters[index] = editorChapter;
        } else {
          state.chapters = [...state.chapters, editorChapter];
        }
        preferredDebugChapterId = state.selectedChapterId || editorChapter.id;
      }
      state.debugChapterId = preferredDebugChapterId;
      const index = getDebugChapterIndex();
      const chapter = syncDebugChapter(index);
      if (!chapter) {
        state.debugEndDialog = "当前没有章节可调试";
        state.messages = [];
        state.sessionDetail = null;
        state.activeTab = "play";
        return;
      }
      state.debugLoadingStage = "读取记忆";
      const result = await api.debugStep({
        worldId: state.worldId,
        chapterId: chapter.id,
        state: state.debugRuntimeState,
        messages: [],
      });
      state.debugLoadingStage = "准备剧情编排完毕";
      applyDebugStepResult(result, chapter, false);
    } catch (error: any) {
      state.debugMode = false;
      state.currentSessionId = "";
      state.debugChapterId = null;
      state.messages = [];
      state.sessionDetail = null;
      state.activeTab = "create";
      state.notice = `进入调试失败: ${error?.message || "未知错误"}`;
    } finally {
      state.debugLoading = false;
      state.debugLoadingStage = "";
    }
  }

  async function continueDebugNarrative() {
    if (!state.debugMode || !state.worldId) return;
    for (let step = 0; step < 3; step += 1) {
      const currentChapter = state.chapters.find((item) => item.id === state.debugChapterId) || null;
      const beforeCount = state.messages.length;
      const result = await api.debugStep({
        worldId: state.worldId,
        chapterId: state.debugChapterId || undefined,
        state: state.debugRuntimeState,
        messages: state.messages,
        playerContent: null,
      });
      applyDebugStepResult(result, currentChapter, true);
      const canPlayerSpeak = (state.debugRuntimeState as Record<string, any>)?.turnState?.canPlayerSpeak !== false;
      if (state.messages.length > beforeCount || state.debugEndDialog || canPlayerSpeak) {
        break;
      }
    }
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
      state.sendText = "";
      const result = await api.debugStep({
        worldId: state.worldId,
        chapterId: state.debugChapterId || undefined,
        playerContent: content,
        state: state.debugRuntimeState,
        messages: state.messages,
      });
      const currentChapter = state.chapters.find((item) => item.id === state.debugChapterId) || null;
      applyDebugStepResult(result, currentChapter, true);
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
    registerAndLogin,
    changePassword,
    saveConnection,
    clearToken,
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
    beginNewChapterDraft,
    scheduleStoryEditorAutoPersist,
    cancelStoryEditorAutoPersist,
    canUndoStoryAutoPersist,
    undoStoryAutoPersist,
    primeStoryEditorPersistState,
    selectChapter,
    startFromWorld,
    quickStart,
    openSession,
    refreshCurrentSession,
    startDebugCurrentChapter,
    continueDebugNarrative,
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
    ensureSettingsPanelData,
    bindGameModel,
    addManagedModelConfig,
    updateManagedModelConfig,
    deleteManagedModelConfig,
    testManagedModelConfig,
    saveStoryPrompt,
    resetStoryPrompt,
    isAdminAccount,
    settingsConfigOptions,
    settingsModelBinding,
    currentStoryPromptValue,
    uploadVoiceReferenceAudio,
    previewVoice,
    polishVoicePrompt,
    transcribeRuntimeVoice,
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
    GAME_MODEL_SLOTS,
    STORY_PROMPT_CODES,
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
