export interface ApiEnvelope<T> {
  code: number;
  data: T;
  message: string;
}

export interface ProjectItem {
  id: number;
  name: string;
  intro?: string | null;
}

export interface RoleParameterCard {
  name?: string;
  raw_setting?: string;
  gender?: string;
  age?: number | null;
  personality?: string;
  appearance?: string;
  voice?: string;
  skills?: string[];
  items?: string[];
  equipment?: string[];
  hp?: number;
  mp?: number;
  money?: number;
  other?: string[];
}

export interface VoiceMixItem {
  voiceId: string;
  weight: number;
}

export interface StoryRole {
  id: string;
  roleType: string;
  name: string;
  avatarPath?: string;
  avatarBgPath?: string;
  description?: string;
  voice?: string;
  voiceMode?: string;
  voiceConfigId?: number | null;
  voicePresetId?: string;
  voiceReferenceAudioPath?: string;
  voiceReferenceAudioName?: string;
  voiceReferenceText?: string;
  voicePromptText?: string;
  voiceMixVoices?: VoiceMixItem[];
  sample?: string;
  parameterCardJson?: RoleParameterCard | null;
}

export interface VoiceBindingDraft {
  label: string;
  configId?: number | null;
  presetId: string;
  mode: string;
  referenceAudioPath?: string;
  referenceAudioName?: string;
  referenceText?: string;
  promptText?: string;
  mixVoices?: VoiceMixItem[];
}

export interface MiniGameState {
  gameType: string;
  status: string;
  round: number;
  stage: string;
  winner: string;
  rewards: string[];
  notes: string;
}

export interface ChapterExtra {
  chapterId?: number | null;
  sort?: number;
  openingRole?: string;
  openingLine?: string;
  background?: string;
  music?: string;
  conditionVisible?: boolean;
}

export interface WorldSettings {
  roles?: StoryRole[];
  narratorVoice?: string;
  narratorVoiceMode?: string;
  narratorVoiceConfigId?: number | null;
  narratorVoicePresetId?: string;
  narratorVoiceReferenceAudioPath?: string;
  narratorVoiceReferenceAudioName?: string;
  narratorVoiceReferenceText?: string;
  narratorVoicePromptText?: string;
  narratorVoiceMixVoices?: VoiceMixItem[];
  globalBackground?: string;
  coverPath?: string;
  coverBgPath?: string;
  allowRoleView?: boolean;
  allowChatShare?: boolean;
  miniGameState?: MiniGameState;
  publishStatus?: string;
  chapterExtras?: ChapterExtra[];
}

export interface WorldItem {
  id: number;
  projectId: number;
  name: string;
  intro?: string;
  coverPath?: string;
  publishStatus?: string;
  chapterCount?: number;
  sessionCount?: number;
  settings?: WorldSettings | null;
  playerRole?: StoryRole | null;
  narratorRole?: StoryRole | null;
}

export interface ChapterItem {
  id: number;
  worldId?: number;
  title: string;
  content?: string;
  entryCondition?: unknown;
  sort?: number;
  status?: string;
  completionCondition?: unknown;
  chapterKey?: string;
  backgroundPath?: string;
  openingRole?: string;
  openingText?: string;
  bgmPath?: string;
  showCompletionCondition?: boolean;
}

export interface MessageItem {
  id: number;
  role?: string;
  roleType?: string;
  eventType?: string;
  content: string;
  createTime?: number;
  meta?: unknown;
}

export interface SessionItem {
  sessionId: string;
  worldId: number;
  worldName?: string;
  worldIntro?: string;
  worldCoverPath?: string;
  chapterId?: number | null;
  chapterTitle?: string;
  projectId?: number | null;
  projectName?: string;
  title?: string;
  status?: string;
  updateTime?: number;
  latestMessage?: MessageItem | null;
}

export interface SessionDetail {
  sessionId?: string;
  title?: string;
  status?: string;
  chapterId?: number | null;
  state?: Record<string, unknown> | null;
  world?: WorldItem | null;
  chapter?: ChapterItem | null;
  messages?: MessageItem[];
  latestSnapshot?: { state?: Record<string, unknown> | null } | null;
}

export interface GeneratedImageResult {
  path?: string;
  filePath?: string;
}

export interface VoiceModelConfig {
  id: number;
  type?: string;
  model?: string;
  modelType?: string;
  manufacturer?: string;
  baseUrl?: string;
  apiKey?: string;
  createTime?: number;
}

export interface VoicePresetItem {
  voiceId: string;
  name: string;
}

export interface UploadedVoiceAudioResult {
  filePath?: string;
  url?: string;
}

export interface ModelConfigItem {
  id: number;
  type?: string;
  model?: string;
  modelType?: string;
  manufacturer?: string;
  baseUrl?: string;
  apiKey?: string;
  createTime?: number;
}

export interface ModelConfigPayload {
  id?: number;
  type: "text" | "image" | "voice";
  model: string;
  modelType: string;
  manufacturer: string;
  baseUrl: string;
  apiKey: string;
}

export interface ModelTestResult {
  kind: "text" | "image" | "audio";
  content: string;
}

export interface AiModelMapItem {
  id: number;
  key: string;
  name: string;
  configId?: number | null;
  model?: string | null;
  manufacturer?: string | null;
}

export interface PromptItem {
  id: number;
  code: string;
  name?: string | null;
  type?: string | null;
  parentCode?: string | null;
  defaultValue?: string | null;
  customValue?: string | null;
}

export type AppTab = "home" | "hall" | "create" | "history" | "my" | "settings" | "play";

export interface CreateStepState {
  current: 0 | 1;
}

export function createDefaultPlayerRole(): StoryRole {
  return {
    id: "player",
    roleType: "player",
    name: "用户",
    avatarPath: "",
    avatarBgPath: "",
    description: "用户在故事中的主视角角色",
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
  };
}

export function createDefaultNarratorRole(): StoryRole {
  return {
    id: "narrator",
    roleType: "narrator",
    name: "旁白",
    avatarPath: "",
    avatarBgPath: "",
    description: "负责环境推进、规则提示与节奏控制",
    voice: "混合（清朗温润）",
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
  };
}

export function createEmptyVoiceBinding(label = "", mode = "text"): VoiceBindingDraft {
  return {
    label,
    configId: null,
    presetId: "",
    mode,
    referenceAudioPath: "",
    referenceAudioName: "",
    referenceText: "",
    promptText: "",
    mixVoices: [],
  };
}

export function createEmptyChapter(sort = 1): ChapterItem {
  return {
    id: 0,
    title: "",
    content: "",
    sort,
    status: "draft",
    entryCondition: null,
    completionCondition: null,
    backgroundPath: "",
    openingRole: "旁白",
    openingText: "",
    bgmPath: "",
    showCompletionCondition: true,
  };
}
