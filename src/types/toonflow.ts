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
  level?: number | null;
  level_desc?: string;
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

export interface ImportableRoleListItem {
  sourceWorldId: number;
  sourceWorldName: string;
  sourceWorldCoverPath?: string;
  role: StoryRole;
}

export interface ImportableRoleListResult {
  items: ImportableRoleListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ImportWorldRoleResult {
  role: StoryRole;
  sourceWorldId: number;
  sourceWorldName: string;
}

export interface ChapterExtra {
  chapterId?: number | null;
  sort?: number;
  openingRole?: string;
  openingLine?: string;
  background?: string;
  music?: string;
  musicAutoPlay?: boolean;
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
  bgmAutoPlay?: boolean;
  showCompletionCondition?: boolean;
  runtimeOutline?: unknown;
}

export interface MessageItem {
  id: number;
  role?: string;
  roleType?: string;
  eventType?: string;
  content: string;
  createTime?: number;
  meta?: unknown;
  revisitData?: unknown;
}

export interface RuntimeEventDigestItem {
  eventIndex?: number;
  eventKind?: string;
  eventFlowType?: string;
  eventSummary?: string;
  eventFacts?: string[];
  eventStatus?: string;
  summarySource?: string;
  memorySummary?: string;
  memoryFacts?: string[];
  updateTime?: number;
  allowedRoles?: string[];
  userNodeId?: string;
}

export interface RuntimeRetryMessageMeta {
  kind: "runtime_retry";
  token: string;
  retryLabel?: string;
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
  currentEventDigest?: RuntimeEventDigestItem | null;
  eventDigestWindow?: RuntimeEventDigestItem[];
  eventDigestWindowText?: string;
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
  currentEventDigest?: RuntimeEventDigestItem | null;
  eventDigestWindow?: RuntimeEventDigestItem[];
  eventDigestWindowText?: string;
}

export interface SessionNarrativeResult {
  sessionId: string;
  status: string;
  chapterId?: number | null;
  chapter?: ChapterItem | null;
  state?: Record<string, unknown> | null;
  message?: MessageItem | null;
  chapterSwitchMessage?: MessageItem | null;
  narrativeMessage?: MessageItem | null;
  generatedMessages?: MessageItem[];
  narrativePlan?: DebugNarrativePlan | null;
  snapshotSaved?: boolean;
  snapshotReason?: string;
  currentEventDigest?: RuntimeEventDigestItem | null;
  eventDigestWindow?: RuntimeEventDigestItem[];
  eventDigestWindowText?: string;
}

export interface SessionOrchestrationResult {
  role?: string;
  roleType?: string;
  motive?: string;
  awaitUser?: boolean;
  command?: {
    type: "init_chapter";
    chapterId: number;
    chapterTitle: string;
    trigger: "chapter_completed";
  } | null;
  sessionId: string;
  status: string;
  chapterId?: number | null;
  expectedRole?: string;
  expectedRoleType?: string;
  plan?: DebugNarrativePlan | null;
  currentEventDigest?: RuntimeEventDigestItem | null;
  eventDigestWindow?: RuntimeEventDigestItem[];
  eventDigestWindowText?: string;
}

export interface InitChapterResult {
  sessionId: string;
  status: string;
  worldId: number;
  chapterId: number | null;
  chapterTitle?: string;
  state?: Record<string, unknown> | null;
  chapter?: ChapterItem | null;
  currentEventDigest?: RuntimeEventDigestItem | null;
  eventDigestWindow?: RuntimeEventDigestItem[];
  eventDigestWindowText?: string;
}

export interface DebugStepResult {
  chapterId: number | null;
  chapterTitle?: string;
  state?: Record<string, unknown> | null;
  endDialog?: string | null;
  endDialogDetail?: string | null;
  messages?: MessageItem[];
  currentEventDigest?: RuntimeEventDigestItem | null;
  eventDigestWindow?: RuntimeEventDigestItem[];
  eventDigestWindowText?: string;
}

export interface OrchestratorRuntimeMeta {
  modelKey?: string;
  manufacturer?: string;
  model?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "";
  payloadMode?: "compact" | "advanced";
  payloadModeSource?: "explicit" | "inferred";
}

export interface DebugNarrativePlan {
  role?: string;
  roleType?: string;
  motive?: string;
  awaitUser?: boolean;
  nextRole?: string;
  nextRoleType?: string;
  source?: "ai" | "fallback";
  planSource?: string;
  triggerMemoryAgent?: boolean;
  eventType?: string;
  presetContent?: string | null;
  orchestratorRuntime?: OrchestratorRuntimeMeta | null;
}

export interface DebugOrchestrationResult {
  role?: string;
  roleType?: string;
  motive?: string;
  chapterId: number | null;
  chapterTitle?: string;
  state?: Record<string, unknown> | null;
  endDialog?: string | null;
  endDialogDetail?: string | null;
  plan?: DebugNarrativePlan | null;
  currentEventDigest?: RuntimeEventDigestItem | null;
  eventDigestWindow?: RuntimeEventDigestItem[];
  eventDigestWindowText?: string;
}

export interface DebugInitResult {
  worldId: number;
  chapterId: number | null;
  chapterTitle?: string;
  state?: Record<string, unknown> | null;
  endDialog?: string | null;
  endDialogDetail?: string | null;
  currentEventDigest?: RuntimeEventDigestItem | null;
  eventDigestWindow?: RuntimeEventDigestItem[];
  eventDigestWindowText?: string;
}

export interface DebugRevisitResult {
  state?: Record<string, unknown> | null;
  messages?: MessageItem[];
  round?: number;
  chapterId?: number | null;
  messageCount?: number;
}

export interface StoryInitResult {
  sessionId: string;
  worldId: number;
  chapterId: number | null;
  chapterTitle?: string;
  state?: Record<string, unknown> | null;
  opening?: DebugNarrativePlan | null;
  firstChapter?: DebugNarrativePlan | null;
  currentEventDigest?: RuntimeEventDigestItem | null;
  eventDigestWindow?: RuntimeEventDigestItem[];
  eventDigestWindowText?: string;
}

/**
 * 故事运行信息接口的统一返回。
 *
 * 用途：
 * - 承载“故事设定 / 当前章节事件 / 调试锚点”等非台词数据；
 * - 让 orchestration 和 streamlines 回到各自职责，不再夹带整份运行态。
 */
export interface StoryInfoResult {
  worldId: number;
  chapterId: number | null;
  chapterTitle?: string;
  state?: Record<string, unknown> | null;
  world?: WorldItem | null;
  chapter?: ChapterItem | null;
  currentEventDigest?: RuntimeEventDigestItem | null;
  eventDigestWindow?: RuntimeEventDigestItem[];
  eventDigestWindowText?: string;
}

export interface AiTokenUsageLogItem {
  id: number;
  createTime: number;
  type: string;
  manufacturer?: string;
  model?: string;
  channel?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  cacheReadPricePer1M?: number;
  amount?: number;
  currency?: string;
  remark?: string;
  meta?: Record<string, unknown> | null;
}

export interface AiTokenUsageStatsItem {
  bucketTime: string;
  type: string;
  manufacturer?: string;
  model?: string;
  channel?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  amount?: number;
  currency?: string;
  callCount?: number;
  remark?: string;
}

export interface StreamLinesEvent {
  type: "start" | "delta" | "sentence" | "done" | "error";
  data?: Record<string, unknown> | null;
}

export interface GeneratedImageResult {
  path?: string;
  filePath?: string;
}

export interface SeparatedRoleImageResult {
  foregroundPath?: string;
  foregroundFilePath?: string;
  backgroundPath?: string;
  backgroundFilePath?: string;
}

export interface RoleAvatarTaskResult {
  taskId: number;
  status: string;
  progress?: number;
  message?: string;
  errorMessage?: string;
  foregroundPath?: string;
  foregroundFilePath?: string;
  backgroundPath?: string;
  backgroundFilePath?: string;
}

export interface VoiceModelConfig {
  id: number;
  type?: string;
  model?: string;
  modelType?: string;
  manufacturer?: string;
  baseUrl?: string;
  apiKey?: string;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  cacheReadPricePer1M?: number;
  currency?: string;
  modes?: string[];
  createTime?: number;
}

export interface VoicePresetItem {
  voiceId: string;
  name: string;
  provider?: string;
  modes?: string[];
  description?: string;
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
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  cacheReadPricePer1M?: number;
  currency?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "";
  createTime?: number;
}

export interface ModelConfigPayload {
  id?: number;
  type: "text" | "image" | "voice" | "voice_design";
  model: string;
  modelType: string;
  manufacturer: string;
  baseUrl: string;
  apiKey: string;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  cacheReadPricePer1M?: number;
  currency?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}

export interface ModelTestResult {
  kind: "text" | "image" | "audio";
  content: string;
}

export interface LocalAvatarMattingStatus {
  manufacturer: string;
  model: string;
  status: "not_installed" | "installing" | "installed" | "failed";
  installed: boolean;
  canInstall: boolean;
  message: string;
}

export interface AiModelMapItem {
  id: number;
  key: string;
  name: string;
  configId?: number | null;
  model?: string | null;
  manufacturer?: string | null;
  payloadMode?: "compact" | "advanced" | null;
}

export interface AiModelOptionItem {
  label: string;
  value: string;
}

export type AiModelListMap = Record<string, AiModelOptionItem[]>;

export interface StoryRuntimeConfig {
  storyOrchestratorPayloadMode: "compact" | "advanced";
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

export function createBasicRoleParameterCard(name: string, description = "", voice = ""): RoleParameterCard {
  return {
    name: name || "用户",
    raw_setting: description || "",
    gender: "",
    age: null,
    level: 1,
    level_desc: "初入此界",
    personality: "",
    appearance: "",
    voice: voice || "",
    skills: [],
    items: [],
    equipment: [],
    hp: 100,
    mp: 0,
    money: 0,
    other: [],
  };
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
    bgmAutoPlay: true,
    showCompletionCondition: true,
    runtimeOutline: null,
  };
}
