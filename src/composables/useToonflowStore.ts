import { computed, reactive, watch } from "vue";
import { ToonflowApi } from "../api/toonflow";
import {
  AiModelMapItem,
  AppTab,
  ChapterExtra,
  ChapterItem,
  DebugNarrativePlan,
  DebugStepResult,
  LocalAvatarMattingStatus,
  MessageItem,
  ModelConfigItem,
  ModelConfigPayload,
  ModelTestResult,
  ProjectItem,
  PromptItem,
  RoleAvatarTaskResult,
  RuntimeRetryMessageMeta,
  SessionDetail,
  SessionItem,
  SessionNarrativeResult,
  StoryRole,
  VoiceBindingDraft,
  VoiceMixItem,
  VoiceModelConfig,
  VoicePresetItem,
  WorldItem,
  createBasicRoleParameterCard,
  createDefaultNarratorRole,
  createDefaultPlayerRole,
  createEmptyChapter,
} from "../types/toonflow";
import { fileToBase64Payload, fileToDataUrl } from "../utils/file";
import { manufacturerLabel } from "../utils/modelConfigCatalog";

type Loadable<T> = T | null;
const RUNTIME_RETRY_EVENT = "on_runtime_retry_error";
const RUNTIME_STREAM_EVENT = "on_streaming_reply";

type RuntimeRetryTask = {
  token: string;
  run: () => Promise<void>;
};

type RuntimeLineStatus =
  | "orchestrated"
  | "streaming"
  | "generated"
  | "revealing"
  | "voicing"
  | "waiting_next"
  | "waiting_player"
  | "auto_advancing"
  | "ended"
  | "error";

type RuntimeStreamMeta = {
  kind: "runtime_stream";
  streaming: boolean;
  sentences?: string[];
  lineIndex?: number;
  status?: RuntimeLineStatus;
  nextRole?: string;
  nextRoleType?: string;
};

type RuntimeChatTraceItem = {
  conversationId: string;
  messageId: number;
  lineIndex: number;
  currentRole: string;
  currentRoleType: string;
  currentStatus: RuntimeLineStatus | "";
  nextRole: string;
  nextRoleType: string;
  updateTime: number;
};

const RUNTIME_CHAT_STORAGE_KEY = "toonflow.chat";
const RUNTIME_CHAT_STORAGE_LIMIT = 24;

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

function storageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // noop
  }
}

function asMiniRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, any>) };
}

function scalarText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function isBenignRuntimeCancellation(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  const message = String((error as any)?.message || error || "").trim().toLowerCase();
  return message.includes("aborterror")
    || message.includes("the operation was aborted")
    || message.includes("scope left the composition");
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

const AVATAR_STD_SIZE = 512;
const AVATAR_BG_SIZE = 768;
const COVER_STD_WIDTH = 1280;
const COVER_STD_HEIGHT = 720;
const COVER_BG_WIDTH = 1536;
const COVER_BG_HEIGHT = 864;
const ROLE_AVATAR_TASK_POLL_INTERVAL_MS = 1000;
const ROLE_AVATAR_TASK_TIMEOUT_MS = 180000;

type EditorImageTarget = "account" | "user" | "npc" | "cover" | "chapter";

function buildSafeUploadBaseName(input: string, fallback: string): string {
  const normalized = String(input || "")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function fileNameFromSource(source: File | string, fallback: string): string {
  if (source instanceof File) {
    return String(source.name || "").trim() || fallback;
  }
  const raw = String(source || "").trim();
  if (!raw) return fallback;
  const clean = raw.split("#")[0]?.split("?")[0] || raw;
  const tail = clean.split("/").pop() || "";
  return tail.trim() || fallback;
}

function looksLikeGifName(input: string): boolean {
  const raw = String(input || "").trim();
  if (!raw) return false;
  const clean = raw.split("#")[0]?.split("?")[0] || raw;
  return /\.gif$/i.test(clean);
}

function looksLikeMp4Name(input: string): boolean {
  const raw = String(input || "").trim();
  if (!raw) return false;
  const clean = raw.split("#")[0]?.split("?")[0] || raw;
  return /\.mp4$/i.test(clean);
}

function cropRectForTarget(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const sourceRatio = sourceWidth / Math.max(sourceHeight, 1);
  const targetRatio = targetWidth / Math.max(targetHeight, 1);
  if (sourceRatio > targetRatio) {
    const width = sourceHeight * targetRatio;
    return {
      sx: (sourceWidth - width) / 2,
      sy: 0,
      sw: width,
      sh: sourceHeight,
    };
  }
  const height = sourceWidth / targetRatio;
  return {
    sx: 0,
    sy: (sourceHeight - height) / 2,
    sw: sourceWidth,
    sh: height,
  };
}

async function loadHtmlImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图片解码失败"));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadImageSourceAsset(
  baseUrl: string,
  source: File | string,
  fallbackName: string,
): Promise<{ blob: Blob; image: HTMLImageElement; isGif: boolean }> {
  const binary = await loadBinaryImageAsset(baseUrl, source, fallbackName);
  const image = await loadHtmlImageFromBlob(binary.blob);
  return { blob: binary.blob, image, isGif: binary.isGif };
}

async function loadBinaryImageAsset(
  baseUrl: string,
  source: File | string,
  fallbackName: string,
): Promise<{ blob: Blob; fileName: string; isGif: boolean }> {
  const sourceName = fileNameFromSource(source, fallbackName);
  let blob: Blob;
  let isGif = looksLikeGifName(sourceName);
  if (source instanceof File) {
    blob = source;
    isGif = isGif || String(source.type || "").trim().toLowerCase() === "image/gif";
  } else {
    const resolved = resolveMediaUrl(baseUrl, source);
    if (!resolved) {
      throw new Error("未找到可处理的图片资源");
    }
    const response = await fetch(resolved);
    if (!response.ok) {
      throw new Error(`图片下载失败: HTTP ${response.status}`);
    }
    blob = await response.blob();
    isGif = isGif || String(blob.type || "").trim().toLowerCase() === "image/gif" || looksLikeGifName(source);
  }
  return { blob, fileName: sourceName, isGif };
}

function renderCroppedPngDataUrl(image: HTMLImageElement, targetWidth: number, targetHeight: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("当前浏览器不支持图片标准化");
  }
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("图片尺寸无效");
  }
  const { sx, sy, sw, sh } = cropRectForTarget(sourceWidth, sourceHeight, targetWidth, targetHeight);
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL("image/png");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

function asUiErrorMessage(error: unknown, fallback = "未知错误"): string {
  if (error instanceof Error) {
    const text = String(error.message || "").trim();
    if (text) return text;
  }
  const text = String(error || "").trim();
  return text || fallback;
}

function isRuntimeRetryMeta(input: unknown): input is RuntimeRetryMessageMeta {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const meta = input as Record<string, unknown>;
  return meta.kind === "runtime_retry" && typeof meta.token === "string";
}

function isRuntimeStreamMeta(input: unknown): input is RuntimeStreamMeta {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const meta = input as Record<string, unknown>;
  return meta.kind === "runtime_stream" && typeof meta.streaming === "boolean";
}

function isRuntimeRetryMessage(message: MessageItem | null | undefined): message is MessageItem & { meta: RuntimeRetryMessageMeta } {
  return Boolean(message && message.eventType === RUNTIME_RETRY_EVENT && isRuntimeRetryMeta(message.meta));
}

function isStreamingRuntimeMessage(message: MessageItem | null | undefined): boolean {
  return Boolean(message && isRuntimeStreamMeta(message.meta) && message.meta.streaming);
}

function stripRuntimeRetryMessages(messages: MessageItem[]): MessageItem[] {
  return messages.filter((message) => !isRuntimeRetryMessage(message));
}

function safeJsonParse<T>(text: string, fallback: T): T {
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function normalizeRuntimeChatTraceItem(input: unknown): RuntimeChatTraceItem | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const conversationId = String(record["conversationId"] || "").trim();
  if (!conversationId) return null;
  const messageId = Number(record["messageId"] || 0);
  const lineIndex = Number(record["lineIndex"] || 0);
  const updateTime = Number(record["updateTime"] || 0);
  const currentStatus = (String(record["currentStatus"] || "").trim() as RuntimeLineStatus | "");
  const rawNextRole = String(record["nextRole"] || "").trim();
  const rawNextRoleType = String(record["nextRoleType"] || "").trim();
  const waitingPlayer = currentStatus === "waiting_player" || rawNextRoleType === "player";
  return {
    conversationId,
    messageId: Number.isFinite(messageId) ? messageId : 0,
    lineIndex: Number.isFinite(lineIndex) ? lineIndex : 0,
    currentRole: String(record["currentRole"] || "").trim(),
    currentRoleType: String(record["currentRoleType"] || "").trim(),
    currentStatus,
    nextRole: waitingPlayer ? "玩家" : rawNextRole,
    nextRoleType: waitingPlayer ? "player" : rawNextRoleType,
    updateTime: Number.isFinite(updateTime) ? updateTime : 0,
  };
}

function readRuntimeChatTraceStorage(): RuntimeChatTraceItem[] {
  const parsed = safeJsonParse<unknown>(storageGet(RUNTIME_CHAT_STORAGE_KEY, "[]"), []);
  if (!Array.isArray(parsed)) return [];
  const rows = parsed
    .map((item) => normalizeRuntimeChatTraceItem(item))
    .filter((item): item is RuntimeChatTraceItem => Boolean(item));
  if (!rows.length) return [];
  const latestByConversation = new Map<string, RuntimeChatTraceItem>();
  rows.forEach((item) => {
    const previous = latestByConversation.get(item.conversationId);
    if (!previous || item.updateTime >= previous.updateTime) {
      latestByConversation.set(item.conversationId, item);
    }
  });
  return Array.from(latestByConversation.values()).sort((left, right) => left.updateTime - right.updateTime);
}

function normalizeScalarEditorText(input: unknown): string {
  if (input === null || input === undefined) return "";
  const raw = String(input);
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (["null", "undefined", "\"\"", "''", "\"null\"", "\"undefined\""].includes(trimmed)) return "";
  return raw;
}

function extractSimpleConditionText(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const node = input as Record<string, unknown>;
  const allowedKeys = new Set(["type", "op", "field", "left", "value", "right"]);
  if (Object.keys(node).some((key) => !allowedKeys.has(key))) return "";
  const op = String(node.type ?? node.op ?? "contains").trim().toLowerCase();
  const field = String(node.field ?? node.left ?? "message").trim().toLowerCase();
  const value = normalizeScalarEditorText(node.value ?? node.right).trim();
  if (!value) return "";
  if (!["contains", "equals", "eq"].includes(op)) return "";
  if (!["message", "message.content", "latest", "latest_message"].includes(field)) return "";
  return value;
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
      const simple = extractSimpleConditionText(parsed);
      if (simple) return simple;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return scalar;
    }
  }
  const simple = extractSimpleConditionText(input);
  if (simple) return simple;
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
    playerVoicePresetId: "",
    playerVoiceMode: "text",
    playerVoiceReferenceAudioPath: "",
    playerVoiceReferenceAudioName: "",
    playerVoiceReferenceText: "",
    playerVoicePromptText: "",
    playerVoiceMixVoices: [] as VoiceMixItem[],
    narratorName: "旁白",
    narratorVoice: "混合（清朗温润）",
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
  playerVoicePresetId: string;
  playerVoiceMode: string;
  playerVoiceReferenceAudioPath: string;
  playerVoiceReferenceAudioName: string;
  playerVoiceReferenceText: string;
  playerVoicePromptText: string;
  playerVoiceMixVoices: VoiceMixItem[];
  narratorName: string;
  narratorVoice: string;
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
  { key: "storySpeakerModel", label: "角色发言", configType: "text" },
  { key: "storyMemoryModel", label: "记忆管理", configType: "text" },
  { key: "storyImageModel", label: "AI生图", configType: "image" },
  { key: "storyAvatarMattingModel", label: "头像分离", configType: "image" },
  { key: "storyVoiceDesignModel", label: "语音设计", configType: "voice_design" },
  { key: "storyVoiceModel", label: "语音生成", configType: "voice" },
  { key: "storyAsrModel", label: "语音识别", configType: "voice" },
] as const;

const STORY_PROMPT_CODES = [
  "story-main",
  "story-orchestrator",
  "story-speaker",
  "story-memory",
  "story-chapter",
  "story-mini-game",
  "story-safety",
] as const;

function stripRoleVoiceConfig(role: StoryRole): StoryRole {
  const cloned = JSON.parse(JSON.stringify(role || {})) as StoryRole & { voiceConfigId?: number | null };
  delete cloned.voiceConfigId;
  cloned.voiceMixVoices = (cloned.voiceMixVoices || []).map((item) => ({
    voiceId: String(item?.voiceId || ""),
    weight: Number.isFinite(Number(item?.weight)) ? Number(item.weight) : 0.7,
  }));
  return cloned;
}

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
    homeRecommendWorldId: Number(storageGet("toonflow.homeRecommendWorldId", "0")) || 0,
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
    settingsVoiceDesignConfigs: [] as ModelConfigItem[],
    settingsVoiceConfigs: [] as VoiceModelConfig[],
    settingsAiModelMap: [] as AiModelMapItem[],
    storyPrompts: [] as PromptItem[],
    aiGenerating: false,
    avatarProcessingTarget: "" as "" | "account" | "user" | "npc",
    avatarProcessingNpcIndex: null as number | null,
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
    sessionViewMode: "live" as "live" | "playback",
    sessionPlaybackStartIndex: 0,
    sessionOpening: false,
    sessionOpeningStage: "",
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
  let runtimeRetryTask: RuntimeRetryTask | null = null;
  let runtimeRetrySeed = 0;
  let runtimeRetrying = false;

  const api = new ToonflowApi(() => ({ baseUrl: state.baseUrl, token: state.token }));

  async function fetchLatestSessionForWorld(worldId: number): Promise<SessionItem | null> {
    const targetWorldId = Number(worldId || 0);
    if (!Number.isFinite(targetWorldId) || targetWorldId <= 0) return null;
    const rows = await api.listSession(undefined, targetWorldId).catch(() => []);
    const [latest] = dedupeSessionsByWorld(rows || []);
    return (latest as SessionItem | undefined) || null;
  }

  async function refreshSessionListState() {
    const sessions = await api.listSession(undefined).catch(() => state.sessions);
    state.sessions = dedupeSessionsByWorld(sessions || []);
  }
  let editorAutoPersistTimer: number | null = null;
  let editorPersistMuted = false;
  let lastPersistedEditorSnapshot: StoryEditorSnapshot | null = null;
  let lastPersistedEditorSignature = "";
  let undoEditorSnapshot: StoryEditorSnapshot | null = null;

  function runtimeMetaRecord(meta: unknown): Record<string, unknown> | null {
    if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return null;
    return meta as Record<string, unknown>;
  }

  function runtimeConversationId(): string {
    const runtimeState = runtimeStateRecord();
    const debugRuntimeKey = String(runtimeState?.["debugRuntimeKey"] || "").trim();
    if (debugRuntimeKey) return debugRuntimeKey;
    const sessionId = state.currentSessionId.trim();
    if (sessionId) return `session:${sessionId}`;
    return `world:${state.worldId || 0}:chapter:${state.debugChapterId || 0}`;
  }

  function runtimeStateRecord(): Record<string, unknown> {
    const source = state.debugMode
      ? state.debugRuntimeState
      : (state.sessionDetail?.state || state.sessionDetail?.latestSnapshot?.state || null);
    return typeof source === "object" && source !== null && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : {};
  }

  function runtimeTurnStateRecord(): Record<string, unknown> {
    const turnState = runtimeStateRecord()["turnState"];
    return typeof turnState === "object" && turnState !== null && !Array.isArray(turnState)
      ? (turnState as Record<string, unknown>)
      : {};
  }

  function cloneDebugRuntimeRecord(input: unknown): Record<string, unknown> {
    return typeof input === "object" && input !== null && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : {};
  }

  function normalizeDebugPlayerProfileGender(input: unknown): string {
    const text = normalizeScalarEditorText(input).trim();
    if (!text) return "";
    if (["男", "男性", "男生"].includes(text)) return "男";
    if (["女", "女性", "女生"].includes(text)) return "女";
    return "";
  }

  function normalizeDebugPlayerProfileAge(input: unknown): number | null {
    const text = normalizeScalarEditorText(input).trim();
    if (!text) return null;
    const matched = text.match(/(\d{1,3})/);
    if (!matched) return null;
    const value = Number(matched[1]);
    if (!Number.isFinite(value) || value <= 0 || value > 150) return null;
    return value;
  }

  function parseDebugPlayerProfileDraft(message: string, currentName: string): {
    name?: string;
    gender?: string;
    age?: number;
  } {
    const text = normalizeScalarEditorText(message)
      .replace(/[。！？!?\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return {};

    const result: { name?: string; gender?: string; age?: number } = {};
    const compact = text.match(/^([A-Za-z\u4e00-\u9fa5·•]{1,12}?)(男|女)(?:性|生)?(?:[，,、/\s]+(\d{1,3})(?:岁)?)?$/u);
    if (compact) {
      result.name = normalizeScalarEditorText(compact[1]);
      result.gender = normalizeDebugPlayerProfileGender(compact[2]);
      const age = normalizeDebugPlayerProfileAge(compact[3]);
      if (age !== null) result.age = age;
      return result;
    }

    const explicitName = text.match(/(?:我叫|我是|姓名(?:是|[:：])?|名字(?:是|[:：])?)\s*([A-Za-z\u4e00-\u9fa5·•]{1,16})/u);
    if (explicitName) {
      result.name = normalizeScalarEditorText(explicitName[1]);
    }

    const explicitGender = text.match(/(?:性别(?:是|[:：])?\s*)?(男|女|男性|女性|男生|女生)/u);
    const gender = normalizeDebugPlayerProfileGender(explicitGender?.[1]);
    if (gender) {
      result.gender = gender;
    }

    const explicitAge = text.match(/(?:年龄(?:是|[:：])?\s*|我今年|今年)\s*(\d{1,3})\s*岁?/u);
    const age = normalizeDebugPlayerProfileAge(explicitAge?.[1] || "");
    if (age !== null) {
      result.age = age;
    }

    if (!result.name && text.length <= 24) {
      const segments = text
        .split(/[，,、/|｜]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const hasProfileSegment = segments.some((item) => Boolean(normalizeDebugPlayerProfileGender(item)) || normalizeDebugPlayerProfileAge(item) !== null);
      if (segments.length >= 2 && segments.length <= 4 && hasProfileSegment) {
        const nameCandidate = segments.find((item) => /^[A-Za-z\u4e00-\u9fa5·•]{1,16}$/u.test(item) && !normalizeDebugPlayerProfileGender(item) && normalizeDebugPlayerProfileAge(item) === null);
        if (nameCandidate) {
          result.name = normalizeScalarEditorText(nameCandidate);
        }
        if (!result.gender) {
          const segmentGender = segments.map((item) => normalizeDebugPlayerProfileGender(item)).find(Boolean);
          if (segmentGender) result.gender = segmentGender;
        }
        if (result.age == null) {
          const segmentAge = segments.map((item) => normalizeDebugPlayerProfileAge(item)).find((item) => item != null) ?? null;
          if (segmentAge !== null) result.age = segmentAge;
        }
      }
    }

    if (result.name === currentName) {
      delete result.name;
    }
    return result;
  }

  function normalizeDebugPlayerStringList(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input
      .map((item) => normalizeScalarEditorText(item))
      .filter(Boolean);
  }

  function applyLocalDebugPlayerProfile(content: string) {
    if (!state.debugMode) return;
    const root = cloneDebugRuntimeRecord(state.debugRuntimeState);
    const currentPlayer = cloneDebugRuntimeRecord(root.player);
    const displayName = normalizeScalarEditorText(currentPlayer.name || state.playerName || "用户") || "用户";
    const description = normalizeScalarEditorText(currentPlayer.description || state.playerDesc || "用户在故事中的主视角角色");
    const voice = normalizeScalarEditorText(currentPlayer.voice || state.playerVoice);
    const currentCard = cloneDebugRuntimeRecord(currentPlayer.parameterCardJson);
    const nextCard: Record<string, unknown> = {
      ...createBasicRoleParameterCard(displayName, description, voice),
      ...currentCard,
      name: normalizeScalarEditorText(currentCard.name ?? displayName) || displayName,
      raw_setting: normalizeScalarEditorText(currentCard.raw_setting ?? currentCard.rawSetting ?? description),
      gender: normalizeScalarEditorText(currentCard.gender),
      age: normalizeDebugPlayerProfileAge(currentCard.age),
      personality: normalizeScalarEditorText(currentCard.personality),
      appearance: normalizeScalarEditorText(currentCard.appearance),
      voice: normalizeScalarEditorText(currentCard.voice ?? voice),
      skills: normalizeDebugPlayerStringList(currentCard.skills),
      items: normalizeDebugPlayerStringList(currentCard.items),
      equipment: normalizeDebugPlayerStringList(currentCard.equipment),
      hp: Number.isFinite(Number(currentCard.hp)) ? Number(currentCard.hp) : 100,
      mp: Number.isFinite(Number(currentCard.mp)) ? Number(currentCard.mp) : 0,
      money: Number.isFinite(Number(currentCard.money)) ? Number(currentCard.money) : 0,
      other: normalizeDebugPlayerStringList(currentCard.other),
    };
    const parsed = parseDebugPlayerProfileDraft(content, normalizeScalarEditorText(nextCard.name || displayName) || displayName);
    if (!parsed.name && !parsed.gender && parsed.age == null) return;
    nextCard.name = normalizeScalarEditorText(parsed.name || nextCard.name || displayName) || displayName;
    if (parsed.gender) {
      nextCard.gender = parsed.gender;
    }
    if (parsed.age != null) {
      nextCard.age = parsed.age;
    }
    root.player = {
      ...currentPlayer,
      id: normalizeScalarEditorText(currentPlayer.id || "player") || "player",
      roleType: "player",
      name: displayName,
      avatarPath: normalizeScalarEditorText(currentPlayer.avatarPath || state.userAvatarPath),
      avatarBgPath: normalizeScalarEditorText(currentPlayer.avatarBgPath || state.userAvatarBgPath),
      description,
      voice,
      voiceMode: normalizeScalarEditorText(currentPlayer.voiceMode || state.playerVoiceMode || "text") || "text",
      voicePresetId: normalizeScalarEditorText(currentPlayer.voicePresetId || state.playerVoicePresetId),
      voiceReferenceAudioPath: normalizeScalarEditorText(currentPlayer.voiceReferenceAudioPath || state.playerVoiceReferenceAudioPath),
      voiceReferenceAudioName: normalizeScalarEditorText(currentPlayer.voiceReferenceAudioName || state.playerVoiceReferenceAudioName),
      voiceReferenceText: normalizeScalarEditorText(currentPlayer.voiceReferenceText || state.playerVoiceReferenceText),
      voicePromptText: normalizeScalarEditorText(currentPlayer.voicePromptText || state.playerVoicePromptText),
      voiceMixVoices: Array.isArray(currentPlayer.voiceMixVoices) ? currentPlayer.voiceMixVoices : state.playerVoiceMixVoices,
      sample: normalizeScalarEditorText(currentPlayer.sample),
      parameterCardJson: nextCard,
    };
    const turnState = cloneDebugRuntimeRecord(root.turnState);
    if ((normalizeScalarEditorText(turnState.expectedRoleType || "player") || "player").toLowerCase() === "player") {
      root.turnState = {
        ...turnState,
        expectedRole: displayName,
      };
    }
    state.debugRuntimeState = root;
    state.debugStatePreview = JSON.stringify(state.debugRuntimeState, null, 2);
  }

  function runtimeMessageStatus(message: MessageItem | null | undefined): RuntimeLineStatus | "" {
    if (!message) return "";
    if (isRuntimeRetryMessage(message)) return "error";
    const meta = runtimeMetaRecord(message.meta);
    return (String(meta?.["status"] || "").trim() as RuntimeLineStatus | "") || "";
  }

  function syncRuntimeChatTrace() {
    const conversationId = runtimeConversationId();
    const turnState = runtimeTurnStateRecord();
    const history = conversationMessages().filter((message) => !isRuntimeRetryMessage(message));
    const latestMessage = history.slice(-1)[0] || null;
    const nextRows = readRuntimeChatTraceStorage().filter((item) => item.conversationId !== conversationId);
    if (!latestMessage) {
      if (!nextRows.length) {
        storageRemove(RUNTIME_CHAT_STORAGE_KEY);
        return;
      }
      storageSet(RUNTIME_CHAT_STORAGE_KEY, JSON.stringify(nextRows.slice(-RUNTIME_CHAT_STORAGE_LIMIT)));
      return;
    }
    const latestMeta = runtimeMetaRecord(latestMessage.meta);
    const latestLineIndex = Number(latestMeta?.["lineIndex"]);
    const currentStatus = runtimeMessageStatus(latestMessage);
    const canPlayerSpeakNow = turnState["canPlayerSpeak"] !== false;
    const fallbackNextRole = canPlayerSpeakNow || currentStatus === "waiting_player"
      ? "玩家"
      : String(turnState["expectedRole"] || "").trim() || "当前角色";
    const fallbackNextRoleType = canPlayerSpeakNow || currentStatus === "waiting_player"
      ? "player"
      : String(turnState["expectedRoleType"] || "").trim() || "npc";
    const latestRow: RuntimeChatTraceItem = {
      conversationId,
      messageId: Number(latestMessage.id || 0),
      lineIndex: Number.isFinite(latestLineIndex) && latestLineIndex > 0 ? latestLineIndex : history.length,
      currentRole: String(latestMessage.role || "").trim(),
      currentRoleType: String(latestMessage.roleType || "").trim(),
      currentStatus: currentStatus || (canPlayerSpeakNow ? "waiting_player" : "waiting_next"),
      nextRole: String(latestMeta?.["nextRole"] || fallbackNextRole || "").trim(),
      nextRoleType: String(latestMeta?.["nextRoleType"] || fallbackNextRoleType || "").trim(),
      updateTime: Date.now(),
    };
    storageSet(
      RUNTIME_CHAT_STORAGE_KEY,
      JSON.stringify([...nextRows.slice(-(RUNTIME_CHAT_STORAGE_LIMIT - 1)), latestRow]),
    );
  }

  function buildRuntimeStreamMeta(current: unknown, patch: Partial<RuntimeStreamMeta>): RuntimeStreamMeta {
    const record = runtimeMetaRecord(current);
    const next: RuntimeStreamMeta = {
      kind: "runtime_stream",
      streaming: false,
    };
    if (record) {
      if (Array.isArray(record["sentences"])) {
        next.sentences = (record["sentences"] as unknown[]).map((item) => String(item || "").trim()).filter(Boolean);
      }
      const lineIndex = Number(record["lineIndex"]);
      if (Number.isFinite(lineIndex) && lineIndex > 0) next.lineIndex = lineIndex;
      const status = String(record["status"] || "").trim() as RuntimeLineStatus | "";
      if (status) next.status = status;
      const nextRole = String(record["nextRole"] || "").trim();
      const nextRoleType = String(record["nextRoleType"] || "").trim();
      if (nextRole) next.nextRole = nextRole;
      if (nextRoleType) next.nextRoleType = nextRoleType;
      if (typeof record["streaming"] === "boolean") {
        next.streaming = Boolean(record["streaming"]);
      }
    }
    if (patch.sentences) next.sentences = patch.sentences;
    if (typeof patch.lineIndex === "number") next.lineIndex = patch.lineIndex;
    if (typeof patch.streaming === "boolean") next.streaming = patch.streaming;
    if (patch.status) next.status = patch.status;
    if (patch.nextRole !== undefined) next.nextRole = String(patch.nextRole || "").trim();
    if (patch.nextRoleType !== undefined) next.nextRoleType = String(patch.nextRoleType || "").trim();
    return next;
  }

  function setRuntimeMessageStatus(messageId: number, status: RuntimeLineStatus) {
    const turnState = runtimeTurnStateRecord();
    const canPlayerSpeakNow = turnState["canPlayerSpeak"] !== false;
    updateMessageById(messageId, (message) => ({
      ...message,
      meta: buildRuntimeStreamMeta(message.meta, {
        status,
        nextRole: status === "waiting_player" || canPlayerSpeakNow ? "玩家" : String(turnState["expectedRole"] || "").trim() || "当前角色",
        nextRoleType: status === "waiting_player" || canPlayerSpeakNow ? "player" : String(turnState["expectedRoleType"] || "").trim() || "npc",
      }),
    }), true);
  }

  function createRuntimeRetryToken() {
    runtimeRetrySeed += 1;
    return `runtime_retry_${Date.now()}_${runtimeRetrySeed}`;
  }

  function clearRuntimeRetryMessage() {
    const nextMessages = stripRuntimeRetryMessages(state.messages);
    if (nextMessages.length !== state.messages.length) {
      state.messages = nextMessages;
      syncRuntimeChatTrace();
    }
  }

  function clearRuntimeRetryState() {
    runtimeRetryTask = null;
    clearRuntimeRetryMessage();
  }

  function conversationMessages(): MessageItem[] {
    return stripRuntimeRetryMessages(state.messages);
  }

  function restoreDebugPlayerTurnAfterDeletion() {
    const root = asMiniRecord(state.debugRuntimeState);
    const turnState = asMiniRecord(root.turnState);
    const history = conversationMessages();
    const previous = history.slice(-1)[0] || null;
    const playerName = scalarText(asMiniRecord(root.player).name) || state.playerName || "用户";
    turnState.canPlayerSpeak = true;
    turnState.expectedRoleType = "player";
    turnState.expectedRole = playerName;
    turnState.lastSpeakerRoleType = scalarText(previous?.roleType);
    turnState.lastSpeaker = scalarText(previous?.role);
    root.turnState = turnState;
    const round = Number(root.round || 0);
    root.round = Number.isFinite(round) ? Math.max(0, round - 1) : 0;
    if (Array.isArray(root.recentEvents) && root.recentEvents.length) {
      root.recentEvents = root.recentEvents.slice(0, -1);
    }
    state.debugRuntimeState = root;
    state.debugStatePreview = JSON.stringify(state.debugRuntimeState, null, 2);
  }

  function updateMessageById(
    messageId: number,
    updater: (message: MessageItem) => MessageItem | null,
    syncTrace = false,
  ) {
    const index = state.messages.findIndex((item) => item.id === messageId);
    if (index < 0) return;
    const current = state.messages[index];
    const next = updater(current);
    if (!next) {
      state.messages.splice(index, 1);
      if (syncTrace) syncRuntimeChatTrace();
      return;
    }
    Object.assign(current, next);
    state.messages.splice(index, 1, current);
    if (syncTrace) syncRuntimeChatTrace();
  }

  function createStreamingMessage(plan: DebugNarrativePlan, lineIndex: number): MessageItem {
    const now = Date.now();
    return {
      id: now,
      role: String(plan.role || "旁白"),
      roleType: String(plan.roleType || "narrator"),
      eventType: String(plan.eventType || RUNTIME_STREAM_EVENT),
      content: "",
      createTime: now,
      meta: {
        kind: "runtime_stream",
        streaming: true,
        sentences: [],
        lineIndex,
        status: "orchestrated",
        nextRole: String(plan.nextRole || "").trim(),
        nextRoleType: String(plan.nextRoleType || "").trim(),
      } satisfies RuntimeStreamMeta,
    };
  }

  function runtimeMessageIdentity(message: MessageItem | null | undefined): string {
    if (!message) return "";
    return `${Number(message.id || 0)}_${Number(message.createTime || 0)}`;
  }

  function mergeConversationMessages(base: MessageItem[], incoming: MessageItem[]): MessageItem[] {
    const next = [...base];
    for (const message of incoming) {
      const identity = runtimeMessageIdentity(message);
      if (!identity) continue;
      const index = next.findIndex((item) => runtimeMessageIdentity(item) === identity);
      if (index >= 0) {
        next[index] = {
          ...next[index],
          ...message,
        };
      } else {
        next.push(message);
      }
    }
    return next;
  }

  function normalizeSessionRuntimeMessage(
    message: MessageItem,
    lineIndex: number,
    turnState: Record<string, unknown>,
  ): MessageItem {
    if (isRuntimeRetryMessage(message) || scalarText(message.roleType).toLowerCase() === "player") {
      return message;
    }
    const canPlayerSpeakNow = turnState["canPlayerSpeak"] !== false;
    return {
      ...message,
      meta: buildRuntimeStreamMeta(message.meta, {
        lineIndex,
        streaming: false,
        status: "generated",
        nextRole: canPlayerSpeakNow ? "玩家" : scalarText(turnState["expectedRole"]),
        nextRoleType: canPlayerSpeakNow ? "player" : scalarText(turnState["expectedRoleType"]),
      }),
    };
  }

  function sessionTurnState(detail: SessionDetail | null | undefined): Record<string, unknown> {
    const latestState = asMiniRecord(detail?.latestSnapshot?.state);
    const currentState = asMiniRecord(detail?.state);
    return asMiniRecord(latestState.turnState || currentState.turnState);
  }

  function normalizeLoadedSessionMessages(detail: SessionDetail | null | undefined): MessageItem[] {
    const source = Array.isArray(detail?.messages) ? detail!.messages! : [];
    if (!source.length) return [];
    const turnState = sessionTurnState(detail);
    if (!Object.keys(turnState).length) return [...source];
    const normalized = source.map((message, index) => normalizeSessionRuntimeMessage(message, index + 1, turnState));
    const latestIndex = normalized.map((message) => !isRuntimeRetryMessage(message)).lastIndexOf(true);
    if (latestIndex < 0) return normalized;
    const latestMessage = normalized[latestIndex]!;
    const canPlayerSpeakNow = turnState["canPlayerSpeak"] !== false;
    normalized[latestIndex] = {
      ...latestMessage,
      meta: buildRuntimeStreamMeta(latestMessage.meta, {
        streaming: false,
        lineIndex: latestIndex + 1,
        status: canPlayerSpeakNow ? "waiting_player" : "waiting_next",
        nextRole: canPlayerSpeakNow ? "玩家" : (scalarText(turnState["expectedRole"]) || "当前角色"),
        nextRoleType: canPlayerSpeakNow ? "player" : (scalarText(turnState["expectedRoleType"]) || "npc"),
      }),
    };
    return normalized;
  }

  function applyLoadedSessionDetail(detail: SessionDetail) {
    const normalizedMessages = normalizeLoadedSessionMessages(detail);
    state.sessionDetail = {
      ...detail,
      messages: normalizedMessages,
    };
    state.messages = normalizedMessages;
    syncRuntimeChatTrace();
  }

  function applySessionNarrativeResult(result: SessionNarrativeResult) {
    const existingDetail = state.sessionDetail || null;
    const nextState = (result.state || existingDetail?.state || {}) as Record<string, unknown>;
    const incoming = [
      result.message || null,
      ...(Array.isArray(result.generatedMessages) ? result.generatedMessages : []),
    ].filter(Boolean) as MessageItem[];
    const existingMessages = conversationMessages();
    const turnState = typeof nextState === "object" && nextState !== null && !Array.isArray(nextState)
      ? ((nextState as Record<string, unknown>).turnState as Record<string, unknown> | undefined) || {}
      : {};
    const lineStart = existingMessages.length;
    const normalizedIncoming = incoming.map((message, index) => normalizeSessionRuntimeMessage(message, lineStart + index + 1, turnState));
    const mergedMessages = mergeConversationMessages(existingMessages, normalizedIncoming);

    state.sessionDetail = {
      ...(existingDetail || {}),
      sessionId: result.sessionId || existingDetail?.sessionId || state.currentSessionId,
      status: result.status || existingDetail?.status || "",
      chapterId: result.chapterId ?? existingDetail?.chapterId ?? null,
      state: nextState,
      chapter: result.chapter || existingDetail?.chapter || null,
      world: existingDetail?.world || null,
      latestSnapshot: {
        ...(existingDetail?.latestSnapshot || {}),
        state: nextState,
      },
      messages: mergedMessages,
    };
    state.messages = mergedMessages;
    if (result.chapter) {
      const index = state.chapters.findIndex((item) => Number(item.id || 0) === Number(result.chapter?.id || 0));
      if (index >= 0) {
        state.chapters.splice(index, 1, result.chapter);
      } else {
        state.chapters = [...state.chapters, result.chapter];
      }
    }
    syncRuntimeChatTrace();
  }

  function showRuntimeRetryMessage(message: string, run: () => Promise<void>, retryLabel = "重试") {
    const token = createRuntimeRetryToken();
    const now = Date.now();
    const retryMessage: MessageItem = {
      id: -now,
      role: "系统",
      roleType: "system",
      eventType: RUNTIME_RETRY_EVENT,
      content: message,
      createTime: now,
      meta: {
        kind: "runtime_retry",
        token,
        retryLabel,
      } satisfies RuntimeRetryMessageMeta,
    };
    runtimeRetryTask = { token, run };
    state.notice = "";
    state.activeTab = "play";
    state.messages = [...conversationMessages(), retryMessage];
  }

  function createRuntimeRetryRunner(
    task: () => Promise<void>,
    options?: {
      retryLabel?: string;
      formatErrorMessage?: (message: string) => string;
    },
  ) {
    const retryLabel = options?.retryLabel || "重试";
    const formatErrorMessage = options?.formatErrorMessage;
    return async () => {
      try {
        await task();
      } catch (error) {
        if (isBenignRuntimeCancellation(error)) {
          return;
        }
        const message = asUiErrorMessage(error);
        showRuntimeRetryMessage(
          formatErrorMessage ? formatErrorMessage(message) : message,
          createRuntimeRetryRunner(task, options),
          retryLabel,
        );
      }
    };
  }

  async function retryRuntimeFailure() {
    if (!runtimeRetryTask || runtimeRetrying) return;
    const task = runtimeRetryTask;
    runtimeRetrying = true;
    clearRuntimeRetryState();
    try {
      await task.run();
    } finally {
      runtimeRetrying = false;
    }
  }

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
      avatarBgPath: state.accountAvatarBgPath,
    });
  }

  function clearRuntime() {
    clearRuntimeRetryState();
    state.userName = "";
    state.userId = 0;
    state.projects = [];
    state.selectedProjectId = -1;
    state.worlds = [];
    state.sessions = [];
    state.sessionDetail = null;
    state.messages = [];
    state.currentSessionId = "";
    state.sessionOpening = false;
    state.sessionOpeningStage = "";
    state.settingsPanelLoaded = false;
    state.settingsTextConfigs = [];
    state.settingsImageConfigs = [];
    state.settingsVoiceDesignConfigs = [];
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
      playerVoicePresetId: state.playerVoicePresetId,
      playerVoiceMode: state.playerVoiceMode,
      playerVoiceReferenceAudioPath: state.playerVoiceReferenceAudioPath,
      playerVoiceReferenceAudioName: state.playerVoiceReferenceAudioName,
      playerVoiceReferenceText: state.playerVoiceReferenceText,
      playerVoicePromptText: state.playerVoicePromptText,
      playerVoiceMixVoices: JSON.parse(JSON.stringify(state.playerVoiceMixVoices || [])) as VoiceMixItem[],
      narratorName: state.narratorName,
      narratorVoice: state.narratorVoice,
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
    state.playerVoicePresetId = snapshot.playerVoicePresetId;
    state.playerVoiceMode = snapshot.playerVoiceMode;
    state.playerVoiceReferenceAudioPath = snapshot.playerVoiceReferenceAudioPath;
    state.playerVoiceReferenceAudioName = snapshot.playerVoiceReferenceAudioName;
    state.playerVoiceReferenceText = snapshot.playerVoiceReferenceText;
    state.playerVoicePromptText = snapshot.playerVoicePromptText;
    state.playerVoiceMixVoices = JSON.parse(JSON.stringify(snapshot.playerVoiceMixVoices || [])) as VoiceMixItem[];
    state.narratorName = snapshot.narratorName;
    state.narratorVoice = snapshot.narratorVoice;
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
    state.npcRoles = (JSON.parse(JSON.stringify(snapshot.npcRoles || [])) as StoryRole[]).map(stripRoleVoiceConfig);
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

  function allPublishedWorlds(): WorldItem[] {
    return state.worlds.filter((item) => isWorldPublished(item));
  }

  function playablePublishedWorlds(): WorldItem[] {
    return allPublishedWorlds().filter((item) => (item.chapterCount || 0) > 0);
  }

  function canEditWorld(world: WorldItem | null | undefined): boolean {
    if (!world) return false;
    const projectId = Number(world.projectId || 0);
    if (!Number.isFinite(projectId) || projectId <= 0) return false;
    return state.projects.some((item) => Number(item.id || 0) === projectId);
  }

  function refreshRecommendedWorld() {
    const pool = playablePublishedWorlds();
    if (!pool.length) {
      state.homeRecommendWorldId = 0;
      storageSet("toonflow.homeRecommendWorldId", "0");
      return;
    }
    const currentId = Number(state.homeRecommendWorldId || 0);
    const candidates = pool.filter((item) => Number(item.id || 0) !== currentId);
    const source = candidates.length ? candidates : pool;
    const picked = source[Math.floor(Math.random() * source.length)] || pool[0];
    state.homeRecommendWorldId = Number(picked?.id || 0);
    storageSet("toonflow.homeRecommendWorldId", String(state.homeRecommendWorldId || 0));
  }

  function recommendedWorld(): WorldItem | null {
    const list = playablePublishedWorlds();
    if (!list.length) return null;
    const picked = list.find((item) => Number(item.id || 0) === Number(state.homeRecommendWorldId || 0));
    return picked || list[0] || null;
  }

  function filteredHallWorlds(): WorldItem[] {
    const keyword = state.hallKeyword.trim().toLowerCase();
    const base = allPublishedWorlds();
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
    return "";
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
    if (summary) {
      state.messages.push({
        id: Date.now(),
        role: state.narratorName || "旁白",
        roleType: "narrator",
        eventType: "on_debug_next_chapter",
        content: summary,
        createTime: Date.now(),
      });
    }
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

  function settingsConfigOptions(type: "text" | "image" | "voice" | "voice_design"): ModelConfigItem[] {
    if (type === "text") return state.settingsTextConfigs;
    if (type === "image") return state.settingsImageConfigs;
    if (type === "voice_design") return state.settingsVoiceDesignConfigs;
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

  function normalizeModelHintText(value: string | null | undefined): string {
    return String(value || "").trim().toLowerCase();
  }

  function formatSettingsModelLabel(input: { manufacturer?: string | null; model?: string | null } | null | undefined): string {
    const manufacturer = manufacturerLabel(String(input?.manufacturer || "").trim());
    const model = String(input?.model || "").trim();
    return [manufacturer, model].filter(Boolean).join(" / ").trim();
  }

  function isAvatarMattingManufacturer(manufacturer: string | null | undefined): boolean {
    const normalized = String(manufacturer || "").trim().toLowerCase();
    return normalized === "bria" || normalized === "aliyun_imageseg" || normalized === "tencent_ci" || normalized === "local_birefnet";
  }

  function avatarMattingRecommendationScore(item: ModelConfigItem): number {
    const manufacturer = String(item.manufacturer || "").trim().toLowerCase();
    let score = 0;
    if (manufacturer === "bria") score += 1000;
    if (manufacturer === "local_birefnet") score += 960;
    if (manufacturer === "tencent_ci") score += 850;
    if (manufacturer === "aliyun_imageseg") score += 700;
    if (String(item.model || "").trim().toLowerCase() === "segmentcommonimage") score += 80;
    if (String(item.model || "").trim().toLowerCase() === "aiportraitmatting") score += 120;
    if (String(item.model || "").trim().toLowerCase() === "birefnet-portrait") score += 160;
    score += Math.min(Number(item.createTime || 0) / 1_000_000_000_000, 50);
    return score;
  }

  function storySpeakerRecommendationScore(item: ModelConfigItem, orchestratorConfigId: number | null): number {
    if (Number(item.id || 0) <= 0) return Number.NEGATIVE_INFINITY;
    if (orchestratorConfigId && Number(item.id) === orchestratorConfigId) return Number.NEGATIVE_INFINITY;
    const model = normalizeModelHintText(item.model);
    const modelType = normalizeModelHintText(item.modelType);
    let score = 0;
    if (!modelType || modelType === "text") score += 180;
    if (modelType === "deepthinkingtext") score -= 420;
    if (model.includes("flash")) score += 320;
    if (model.includes("lite")) score += 220;
    if (model.includes("mini")) score += 180;
    if (model.includes("turbo") || model.includes("instant") || model.includes("speed")) score += 120;
    if (model.includes("reason") || model.includes("think") || model.includes("deep")) score -= 260;
    if (model.includes("pro") || model.includes("max") || model.includes("ultra")) score -= 120;
    score += Math.min(Number(item.createTime || 0) / 1_000_000_000_000, 50);
    return score;
  }

  function settingsRecommendedModel(key: string): ModelConfigItem | null {
    if (key === "storyAvatarMattingModel") {
      const ranked = state.settingsImageConfigs
        .filter((item) => isAvatarMattingManufacturer(item.manufacturer))
        .sort((a, b) => avatarMattingRecommendationScore(b) - avatarMattingRecommendationScore(a) || Number(b.id || 0) - Number(a.id || 0));
      return ranked[0] || null;
    }
    if (key !== "storySpeakerModel") return null;
    const orchestratorConfigId = settingsModelBinding("storyOrchestratorModel")?.configId || null;
    const ranked = state.settingsTextConfigs
      .map((item) => ({
        item,
        score: storySpeakerRecommendationScore(item, orchestratorConfigId),
      }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => b.score - a.score || Number(b.item.id || 0) - Number(a.item.id || 0));
    return ranked[0]?.item || null;
  }

  function settingsModelAdvisory(key: string): { tone: "info" | "warn"; text: string } | null {
    if (key === "storyAvatarMattingModel") {
      const binding = settingsModelBinding("storyAvatarMattingModel");
      const recommendation = settingsRecommendedModel("storyAvatarMattingModel");
      const recommendationText = recommendation ? formatSettingsModelLabel(recommendation) : "Bria / RMBG-2.0";
      const credentialHint = "Bria 的 API Key 直接填 token；阿里云视觉请填 AccessKeyId|AccessKeySecret 或 JSON；腾讯云数据万象请填 SecretId|SecretKey，Base URL 填标准 COS 桶域名；BiRefNet 本地无需 Key，但首次选择会提示安装本地依赖和模型文件。";
      if (!binding?.configId) {
        return {
          tone: "warn",
          text: `用于角色头像的主体/背景分离。建议绑定：${recommendationText}。未配置时会回退旧的图像大模型分离链路，效果通常更差。${credentialHint}`,
        };
      }
      return {
        tone: "info",
        text: `这个槽位专门负责角色头像主体/背景分离，不参与普通生图。${credentialHint}`,
      };
    }
    if (key !== "storySpeakerModel") return null;
    const speaker = settingsModelBinding("storySpeakerModel");
    const orchestrator = settingsModelBinding("storyOrchestratorModel");
    const recommendation = settingsRecommendedModel("storySpeakerModel");
    const recommendationText = recommendation ? formatSettingsModelLabel(recommendation) : "";
    if (!speaker?.configId) {
      return recommendation
        ? {
          tone: "warn",
          text: `未单独配置。建议绑定：${recommendationText}。未配置时运行时会直接提示缺少角色发言模型。`,
        }
        : {
          tone: "warn",
          text: "未单独配置，且当前没有可直接推荐的独立文本模型。建议先新增一个更快的文本模型后再绑定。",
        };
    }
    if (orchestrator?.configId && speaker.configId === orchestrator.configId) {
      return recommendation && recommendation.id !== speaker.configId
        ? {
          tone: "warn",
          text: `当前与编排师共用同一模型，单次调试会串行调用两次。建议改绑：${recommendationText}。`,
        }
        : {
          tone: "warn",
          text: "当前与编排师共用同一模型，单次调试会串行调用两次，容易明显变慢。",
        };
    }
    return null;
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
    options: {
      speed?: number | null;
      format?: string | null;
      sampleRate?: number | null;
    } = {},
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
      speed: typeof options.speed === "number" ? options.speed : undefined,
      format: options.format || undefined,
      sampleRate: typeof options.sampleRate === "number" ? options.sampleRate : undefined,
    });
    return result.audioUrl || "";
  }

  async function streamVoice(
    configId: number | null | undefined,
    text: string,
    mode: string,
    voiceId = "",
    referenceAudioPath = "",
    referenceText = "",
    promptText = "",
    mixVoices: VoiceMixItem[] = [],
    options: {
      speed?: number | null;
      format?: string | null;
      sampleRate?: number | null;
    } = {},
  ): Promise<string> {
    const result = await api.streamVoice({
      configId: configId || undefined,
      text,
      mode,
      voiceId,
      referenceAudioPath,
      referenceText,
      promptText,
      mixVoices,
      speed: typeof options.speed === "number" ? options.speed : undefined,
      format: options.format || undefined,
      sampleRate: typeof options.sampleRate === "number" ? options.sampleRate : undefined,
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

  async function uploadImagePayload(target: EditorImageTarget, fileName: string, base64Data: string): Promise<string> {
    if (target !== "account" && state.selectedProjectId <= 0) {
      throw new Error("请先选择项目后再上传图片");
    }
    const result = await api.uploadImage({
      projectId: target === "account" ? undefined : state.selectedProjectId || undefined,
      type: target === "cover" || target === "chapter" ? "scene" : "role",
      fileName,
      base64Data,
    });
    return result.filePath || result.path || "";
  }

  async function convertAvatarVideoToGifPayload(target: "account" | "user" | "npc", file: File): Promise<{ path: string; bgPath: string }> {
    if (target !== "account" && state.selectedProjectId <= 0) {
      throw new Error("请先选择项目后再上传 MP4");
    }
    const isMp4 = String(file.type || "").trim().toLowerCase() === "video/mp4" || looksLikeMp4Name(file.name || "");
    if (!isMp4) {
      throw new Error("仅支持上传 MP4 视频转换 GIF");
    }
    const result = await api.convertAvatarVideoToGif({
      projectId: target === "account" ? undefined : state.selectedProjectId || undefined,
      fileName: file.name || "avatar.mp4",
      base64Data: await fileToDataUrl(file),
    });
    const path = String(result.foregroundFilePath || result.foregroundPath || "").trim();
    const bgPath = String(result.backgroundFilePath || result.backgroundPath || "").trim();
    if (!path || !bgPath) {
      throw new Error("MP4 转 GIF 失败，未返回头像资源");
    }
    return { path, bgPath };
  }

  async function uploadStandardizedImageAsset(target: EditorImageTarget, source: File | string, baseName: string): Promise<{ path: string; bgPath: string }> {
    if (target === "account" || target === "user" || target === "npc") {
      return await separateRoleImageAsset(target, source, baseName);
    }
    const safeBaseName = buildSafeUploadBaseName(baseName, target);
    const asset = await loadImageSourceAsset(state.baseUrl, source, safeBaseName);
    const version = Date.now();
    const isWide = target === "cover" || target === "chapter";
    const path = await uploadImagePayload(
      target,
      `${safeBaseName}_${version}_fg.png`,
      renderCroppedPngDataUrl(
        asset.image,
        isWide ? COVER_STD_WIDTH : AVATAR_STD_SIZE,
        isWide ? COVER_STD_HEIGHT : AVATAR_STD_SIZE,
      ),
    );
    if (target === "chapter") {
      return { path, bgPath: "" };
    }
    const bgPath = await uploadImagePayload(
      target,
      `${safeBaseName}_${version}_bg.png`,
      renderCroppedPngDataUrl(
        asset.image,
        isWide ? COVER_BG_WIDTH : AVATAR_BG_SIZE,
        isWide ? COVER_BG_HEIGHT : AVATAR_BG_SIZE,
      ),
    );
    return { path, bgPath };
  }

  function resolveSeparatedRolePaths(result: Pick<RoleAvatarTaskResult, "foregroundFilePath" | "foregroundPath" | "backgroundFilePath" | "backgroundPath">) {
    const path = String(result.foregroundFilePath || result.foregroundPath || "").trim();
    const bgPath = String(result.backgroundFilePath || result.backgroundPath || "").trim();
    if (!path || !bgPath) {
      throw new Error("图像模型分离失败，未返回主体或背景图片");
    }
    return { path, bgPath };
  }

  async function waitForSeparateRoleAvatarTask(taskId: number) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < ROLE_AVATAR_TASK_TIMEOUT_MS) {
      const task = await api.getSeparateRoleAvatarTask(taskId);
      const status = String(task.status || "").trim().toLowerCase();
      if (status === "success") {
        return resolveSeparatedRolePaths(task);
      }
      if (status === "failed") {
        throw new Error(String(task.errorMessage || task.message || "头像分离失败").trim() || "头像分离失败");
      }
      await sleep(ROLE_AVATAR_TASK_POLL_INTERVAL_MS);
    }
    throw new Error("头像分离处理超时，请稍后重试");
  }

  async function separateRoleImageAsset(target: "account" | "user" | "npc", source: File | string, baseName: string): Promise<{ path: string; bgPath: string }> {
    if (target !== "account" && state.selectedProjectId <= 0) {
      throw new Error("请先选择项目后再上传图片");
    }
    const safeBaseName = buildSafeUploadBaseName(baseName, target);
    const asset = await loadBinaryImageAsset(state.baseUrl, source, safeBaseName);
    const task = await api.startSeparateRoleAvatarTask({
      projectId: target === "account" ? undefined : state.selectedProjectId || undefined,
      fileName: asset.fileName || `${safeBaseName}${asset.isGif ? ".gif" : ".png"}`,
      name: safeBaseName,
      base64Data: await fileToDataUrl(asset.blob),
      asyncTask: true,
    });
    const taskId = Number(task.taskId || 0);
    if (!Number.isFinite(taskId) || taskId <= 0) {
      throw new Error("头像分离任务创建失败");
    }
    return await waitForSeparateRoleAvatarTask(taskId);
  }

  function setAvatarProcessing(target: "account" | "user" | "npc" | null, npcIndex: number | null = null) {
    state.avatarProcessingTarget = target || "";
    state.avatarProcessingNpcIndex = target === "npc" && typeof npcIndex === "number" ? npcIndex : null;
  }

  function clearAvatarFailureNotice() {
    const current = String(state.notice || "").trim();
    if (!current) return;
    if (current.startsWith("头像分离失败")) {
      state.notice = "";
    }
  }

  function isAvatarProcessing(target: "account" | "user" | "npc", npcIndex: number | null = null) {
    if (state.avatarProcessingTarget !== target) return false;
    if (target !== "npc") return true;
    return typeof npcIndex === "number" && state.avatarProcessingNpcIndex === npcIndex;
  }

  async function applyImageToTarget(target: "account" | "user" | "npc" | "cover" | "chapter", prompt: string, referenceList: string[], name: string, onReady?: (path: string, bgPath?: string) => void) {
    state.aiGenerating = true;
    if (target === "account" || target === "user" || target === "npc") {
      clearAvatarFailureNotice();
    }
    try {
      const path = await generateImage(target === "chapter" || target === "cover" ? "scene" : "role", prompt, referenceList, name);
      if (!path) {
        throw new Error("未生成图片");
      }
      const prepared = await uploadStandardizedImageAsset(target, path, name || target);
      if (target === "account") {
        state.accountAvatarPath = prepared.path;
        state.accountAvatarBgPath = prepared.bgPath || prepared.path;
        await persistAccountAvatar();
      } else if (target === "user") {
        state.userAvatarPath = prepared.path;
        state.userAvatarBgPath = prepared.bgPath || prepared.path;
      } else if (target === "npc") {
        onReady?.(prepared.path, prepared.bgPath || prepared.path);
      } else if (target === "cover") {
        state.worldCoverPath = prepared.path;
        state.worldCoverBgPath = prepared.bgPath || prepared.path;
      } else if (target === "chapter") {
        state.chapterBackground = prepared.path;
      }
      if (target === "account" || target === "user" || target === "npc") {
        clearAvatarFailureNotice();
      }
      return prepared.path;
    } finally {
      state.aiGenerating = false;
    }
  }

  async function updateAvatarFromFile(target: "account" | "user" | "npc", file: File, onReady?: (path: string, bgPath?: string) => void, roleIndex?: number) {
    clearAvatarFailureNotice();
    setAvatarProcessing(target, typeof roleIndex === "number" ? roleIndex : null);
    try {
      const prepared = await uploadStandardizedImageAsset(target, file, file.name || target);
      if (target === "account") {
        state.accountAvatarPath = prepared.path;
        state.accountAvatarBgPath = prepared.bgPath;
        await persistAccountAvatar();
      } else if (target === "user") {
        state.userAvatarPath = prepared.path;
        state.userAvatarBgPath = prepared.bgPath;
      } else if (target === "npc" && typeof roleIndex === "number" && state.npcRoles[roleIndex]) {
        state.npcRoles[roleIndex].avatarPath = prepared.path;
        state.npcRoles[roleIndex].avatarBgPath = prepared.bgPath;
        onReady?.(prepared.path, prepared.bgPath);
      }
      clearAvatarFailureNotice();
    } finally {
      setAvatarProcessing(null);
    }
  }

  async function updateAvatarFromMp4(target: "account" | "user" | "npc", file: File, onReady?: (path: string, bgPath?: string) => void, roleIndex?: number) {
    clearAvatarFailureNotice();
    setAvatarProcessing(target, typeof roleIndex === "number" ? roleIndex : null);
    try {
      const prepared = await convertAvatarVideoToGifPayload(target, file);
      if (target === "account") {
        state.accountAvatarPath = prepared.path;
        state.accountAvatarBgPath = prepared.bgPath;
        await persistAccountAvatar();
      } else if (target === "user") {
        state.userAvatarPath = prepared.path;
        state.userAvatarBgPath = prepared.bgPath;
      } else if (target === "npc" && typeof roleIndex === "number" && state.npcRoles[roleIndex]) {
        onReady?.(prepared.path, prepared.bgPath);
        if (!onReady) {
          state.npcRoles[roleIndex].avatarPath = prepared.path;
          state.npcRoles[roleIndex].avatarBgPath = prepared.bgPath;
        }
      }
      clearAvatarFailureNotice();
    } finally {
      setAvatarProcessing(null);
    }
  }

  async function updateCoverFromFile(file: File) {
    const prepared = await uploadStandardizedImageAsset("cover", file, file.name || "story_cover");
    state.worldCoverPath = prepared.path;
    state.worldCoverBgPath = prepared.bgPath || prepared.path;
  }

  async function updateChapterBackgroundFromFile(file: File) {
    const prepared = await uploadStandardizedImageAsset("chapter", file, file.name || "chapter_bg");
    state.chapterBackground = prepared.path;
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
      state.settingsVoiceDesignConfigs = configs.filter((item) => String(item.type || "").trim() === "voice_design");
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
    if (key === "storyAvatarMattingModel") {
      clearAvatarFailureNotice();
    }
    state.notice = "模型配置已保存";
  }

  async function bindRecommendedGameModel(key: string) {
    const recommendation = settingsRecommendedModel(key);
    if (!recommendation?.id) {
      state.notice = key === "storySpeakerModel"
        ? "当前没有可直接推荐的独立角色发言模型，请先新增一个文本模型"
        : "当前没有可直接推荐的模型";
      return;
    }
    await bindGameModel(key, recommendation.id);
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

  async function fetchLocalAvatarMattingStatus(manufacturer: string, model: string): Promise<LocalAvatarMattingStatus> {
    return await api.getLocalAvatarMattingStatus({
      manufacturer: manufacturer.trim(),
      model: model.trim(),
    });
  }

  async function installLocalAvatarMattingModel(manufacturer: string, model: string): Promise<LocalAvatarMattingStatus> {
    const result = await api.installLocalAvatarMatting({
      manufacturer: manufacturer.trim(),
      model: model.trim(),
    });
    clearAvatarFailureNotice();
    return result;
  }

  async function deleteManagedModelConfig(id: number) {
    await api.deleteModelConfig(id);
    await ensureSettingsPanelData(true);
    state.notice = "模型配置已删除";
  }

  async function testManagedModelConfig(config: ModelConfigItem): Promise<ModelTestResult> {
    const type = String(config.type || "").trim();
    const modelType = String(config.modelType || "").trim();
    if (type === "voice_design") {
      const result = await api.testVoiceDesignModel({
        modelName: String(config.model || "").trim(),
        apiKey: String(config.apiKey || "").trim(),
        baseURL: String(config.baseUrl || "").trim() || undefined,
        manufacturer: String(config.manufacturer || "").trim(),
      });
      return {
        kind: "audio",
        content: resolveMediaUrl(state.baseUrl, String(result || "").trim()),
      };
    }
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
      if (isAvatarMattingManufacturer(config.manufacturer)) {
        return {
          kind: "text",
          content: "当前是头像分离专用模型，不走普通生图测试。请在角色头像上传或 AI 生成后直接验证主体/背景分离效果。",
        };
      }
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
      roles: state.npcRoles.map(stripRoleVoiceConfig),
      narratorVoice: state.narratorVoice,
      narratorVoiceMode: state.narratorVoiceMode,
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
      voicePresetId: state.playerVoicePresetId,
      voiceReferenceAudioPath: state.playerVoiceReferenceAudioPath,
      voiceReferenceAudioName: state.playerVoiceReferenceAudioName,
      voiceReferenceText: state.playerVoiceReferenceText,
      voicePromptText: state.playerVoicePromptText,
      voiceMixVoices: state.playerVoiceMixVoices,
      parameterCardJson: null,
    };
  }

  function currentNarratorRole() {
    return {
      ...createDefaultNarratorRole(),
      name: state.narratorName,
      voice: state.narratorVoice,
      voiceMode: state.narratorVoiceMode,
      voicePresetId: state.narratorVoicePresetId,
      voiceReferenceAudioPath: state.narratorVoiceReferenceAudioPath,
      voiceReferenceAudioName: state.narratorVoiceReferenceAudioName,
      voiceReferenceText: state.narratorVoiceReferenceText,
      voicePromptText: state.narratorVoicePromptText,
      voiceMixVoices: state.narratorVoiceMixVoices,
      parameterCardJson: null,
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
        api.listWorlds(undefined, true).catch(() => []),
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
      refreshRecommendedWorld();
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
    state.settingsVoiceDesignConfigs = [];
    state.settingsVoiceConfigs = [];
    state.settingsAiModelMap = [];
    state.storyPrompts = [];
    saveSettings();
    clearRuntime();
    state.notice = "已退出登录";
  }

  function setTab(tab: AppTab) {
    state.activeTab = tab;
    if (tab === "home") {
      refreshRecommendedWorld();
    }
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
      state.playerVoicePresetId = worldDetail.playerRole?.voicePresetId || "";
      state.playerVoiceReferenceAudioPath = worldDetail.playerRole?.voiceReferenceAudioPath || "";
      state.playerVoiceReferenceAudioName = worldDetail.playerRole?.voiceReferenceAudioName || "";
      state.playerVoiceReferenceText = worldDetail.playerRole?.voiceReferenceText || "";
      state.playerVoicePromptText = worldDetail.playerRole?.voicePromptText || "";
      state.playerVoiceMixVoices = worldDetail.playerRole?.voiceMixVoices || [];
      state.narratorName = worldDetail.narratorRole?.name || "旁白";
      state.narratorVoice = worldDetail.narratorRole?.voice || "混合（清朗温润）";
      state.narratorVoiceMode = worldDetail.narratorRole?.voiceMode || "text";
      state.narratorVoicePresetId = worldDetail.narratorRole?.voicePresetId || "";
      state.narratorVoiceReferenceAudioPath = worldDetail.narratorRole?.voiceReferenceAudioPath || "";
      state.narratorVoiceReferenceAudioName = worldDetail.narratorRole?.voiceReferenceAudioName || "";
      state.narratorVoiceReferenceText = worldDetail.narratorRole?.voiceReferenceText || "";
      state.narratorVoicePromptText = worldDetail.narratorRole?.voicePromptText || "";
      state.narratorVoiceMixVoices = worldDetail.narratorRole?.voiceMixVoices || [];
      state.npcRoles = (worldDetail.settings?.roles || [])
        .filter((item) => item.id !== "player" && item.id !== "narrator")
        .map(stripRoleVoiceConfig);
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
    if (!canEditWorld(world)) {
      state.notice = "只能编辑自己的故事";
      return;
    }
    await loadWorldForEdit(world);
  }

  async function reopenPublishedWorldAsDraft(world: WorldItem) {
    if (!canEditWorld(world)) {
      state.notice = "只能编辑自己的故事";
      return;
    }
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
      api.listWorlds(undefined, true).catch(() => state.worlds),
      api.listSession(undefined).catch(() => state.sessions),
    ]);
    state.worlds = worlds;
    refreshRecommendedWorld();
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
    try {
      state.notice = "正在进入故事...";
      state.activeTab = "play";
      state.sessionViewMode = "live";
      state.sessionPlaybackStartIndex = 0;
      state.sessionOpening = true;
      state.sessionOpeningStage = "初始化会话";
      state.sessionDetail = null;
      state.messages = [];
      const existingSession = await fetchLatestSessionForWorld(Number(world.id || 0))
        || state.sessions.find((item) => Number(item.worldId || 0) === Number(world.id || 0))
        || null;
      if (existingSession?.sessionId) {
        await openSession(existingSession.sessionId);
        if (quickText.trim()) {
          state.sendText = quickText.trim();
          await sendMessage();
        }
        return;
      }
      const chapters = await api.getChapter(world.id).catch(() => []);
      const startChapter = chapters[0] || null;
      state.sessionOpeningStage = "创建会话";
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
    } catch (error) {
      state.notice = `进入游玩失败: ${asUiErrorMessage(error)}`;
    } finally {
      state.sessionOpening = false;
      state.sessionOpeningStage = "";
    }
  }

  async function continueSessionForWorld(
    worldId: number,
    fallbackSessionId = "",
    options?: { playback?: boolean; playbackIndex?: number },
  ) {
    state.notice = options?.playback ? "正在打开剧情回放..." : "正在进入故事...";
    state.sessionOpening = true;
    state.sessionOpeningStage = options?.playback ? "加载回放进度" : "定位会话";
    const targetWorldId = Number(worldId || 0);
    const fallbackId = String(fallbackSessionId || "").trim();
    const existingSession = Number.isFinite(targetWorldId) && targetWorldId > 0
      ? await fetchLatestSessionForWorld(targetWorldId)
        || state.sessions.find((item) => Number(item.worldId || 0) === targetWorldId)
        || null
      : null;
    const sessionId = String(existingSession?.sessionId || fallbackId).trim();
    if (!sessionId) {
      state.sessionOpening = false;
      state.sessionOpeningStage = "";
      throw new Error("未找到可继续的会话");
    }
    try {
      await openSession(sessionId, options);
    } finally {
      state.sessionOpening = false;
      state.sessionOpeningStage = "";
    }
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

  async function openSession(sessionId: string, options?: { playback?: boolean; playbackIndex?: number }) {
    clearRuntimeRetryState();
    state.debugMode = false;
    state.debugLoading = false;
    state.notice = options?.playback ? "正在打开剧情回放..." : "正在进入故事...";
    state.activeTab = "play";
    state.sessionViewMode = options?.playback ? "playback" : "live";
    state.sessionPlaybackStartIndex = Math.max(0, Number(options?.playbackIndex || 0));
    state.currentSessionId = sessionId;
    state.sessionOpening = true;
    state.sessionOpeningStage = options?.playback ? "读取回放数据" : "读取记忆";
    state.sessionDetail = null;
    state.messages = [];
    try {
      const [detail] = await Promise.all([
        api.getSession(sessionId),
        refreshSessionListState(),
      ]);
      state.sessionOpeningStage = options?.playback ? "同步回放进度" : "同步游戏进度";
      applyLoadedSessionDetail(detail);
    } finally {
      state.sessionOpening = false;
      state.sessionOpeningStage = "";
    }
  }

  async function deleteSession(sessionId: string) {
    const id = String(sessionId || "").trim();
    if (!id) return;
    await api.deleteSession(id);
    state.sessions = state.sessions.filter((item) => item.sessionId !== id);
    if (state.currentSessionId === id) {
      clearRuntimeRetryState();
      state.currentSessionId = "";
      state.sessionDetail = null;
      state.messages = [];
      state.sessionViewMode = "live";
      state.sessionPlaybackStartIndex = 0;
      state.activeTab = "history";
    }
  }

  async function refreshCurrentSession() {
    if (state.debugMode || !state.currentSessionId) return;
    const [detail] = await Promise.all([
      api.getSession(state.currentSessionId),
      refreshSessionListState(),
    ]);
    applyLoadedSessionDetail(detail);
  }

  function applyDebugOrchestrationResult(
    result: {
      state?: Record<string, unknown> | null;
      chapterId?: number | null;
      chapterTitle?: string | null;
      endDialog?: string | null;
    },
    fallbackChapter?: ChapterItem | null,
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
    state.debugEndDialog = result.endDialog || null;
    state.sessionDetail = null;
    state.activeTab = "play";
    syncRuntimeChatTrace();
  }

  function stripKnownDebugHistory(historyMessages: MessageItem[], incomingMessages: MessageItem[]) {
    if (!historyMessages.length || !incomingMessages.length) return incomingMessages;
    if (incomingMessages.length < historyMessages.length) return incomingMessages;
    const signature = (message: MessageItem) => [
      String(message.roleType || "").trim(),
      String(message.role || "").trim(),
      String(message.eventType || "").trim(),
      String(message.content || "").trim(),
    ].join("|");
    const historyPrefix = historyMessages.map(signature);
    const incomingPrefix = incomingMessages.slice(0, historyMessages.length).map(signature);
    return historyPrefix.join("\n") === incomingPrefix.join("\n")
      ? incomingMessages.slice(historyMessages.length)
      : incomingMessages;
  }

  function applyDebugStepResult(
    result: DebugStepResult,
    historyMessages: MessageItem[],
    fallbackChapter?: ChapterItem | null,
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
    state.debugEndDialog = result.endDialog || null;
    state.messages = [...historyMessages, ...stripKnownDebugHistory(historyMessages, result.messages || [])];
    state.sessionDetail = null;
    state.activeTab = "play";
    syncRuntimeChatTrace();
  }

  function debugCanPlayerSpeakFromState(runtimeState: Record<string, unknown> | null | undefined = state.debugRuntimeState as Record<string, unknown>) {
    const turnState = (runtimeState && typeof runtimeState === "object"
      ? (runtimeState as Record<string, any>).turnState
      : null) as Record<string, any> | null;
    return turnState?.canPlayerSpeak !== false;
  }

  async function streamDebugPlanOrFallback(
    plan: DebugNarrativePlan,
    historyMessages: MessageItem[],
    playerContent?: string | null,
  ) {
    try {
      await streamDebugPlan(plan, historyMessages, playerContent);
    } catch (error) {
      if (isBenignRuntimeCancellation(error)) {
        throw error;
      }
      const fallbackResult = await api.debugStep({
        worldId: state.worldId,
        chapterId: state.debugChapterId || undefined,
        state: state.debugRuntimeState,
        messages: historyMessages,
        playerContent: playerContent || undefined,
      });
      clearRuntimeRetryState();
      applyDebugStepResult(fallbackResult, historyMessages, state.chapters.find((item) => item.id === state.debugChapterId) || null);
      const advanced = conversationMessages().length > historyMessages.length || Boolean(state.debugEndDialog) || debugCanPlayerSpeakFromState(fallbackResult.state as Record<string, unknown>);
      if (!advanced) {
        throw error;
      }
    }
  }

  async function streamDebugPlan(
    plan: DebugNarrativePlan,
    historyMessages: MessageItem[],
    playerContent?: string | null,
  ) {
    const streamingMessage = createStreamingMessage(plan, historyMessages.length + 1);
    let accumulated = "";
    state.messages = [...historyMessages, streamingMessage];
    syncRuntimeChatTrace();
    let done = false;
    try {
      await api.streamDebugLines({
        worldId: state.worldId,
        chapterId: state.debugChapterId || undefined,
        state: state.debugRuntimeState,
        messages: historyMessages,
        playerContent: playerContent || undefined,
        plan,
      }, async (event) => {
        if (event.type === "delta") {
          const text = String(event.data?.text || "");
          if (!text) return;
          accumulated += text;
          updateMessageById(streamingMessage.id, (message) => ({
            ...message,
            content: accumulated,
          }));
          return;
        }
        if (event.type === "done") {
          done = true;
          const finalMessage = (event.data?.message || {}) as Record<string, unknown>;
          const finalContent = String(finalMessage.content || accumulated || "");
          updateMessageById(streamingMessage.id, (message) => ({
            ...message,
            role: String(finalMessage.role || message.role || ""),
            roleType: String(finalMessage.roleType || message.roleType || ""),
            eventType: String(finalMessage.eventType || message.eventType || RUNTIME_STREAM_EVENT),
            content: finalContent,
            meta: buildRuntimeStreamMeta(message.meta, {
              streaming: false,
              status: "generated",
            }),
          }), true);
          return;
        }
        if (event.type === "sentence") {
          const text = String(event.data?.text || "").trim();
          if (!text) return;
          updateMessageById(streamingMessage.id, (message) => {
            const metaRecord = buildRuntimeStreamMeta(message.meta, {
              streaming: true,
              status: "streaming",
            });
            const rawSentences = Array.isArray(metaRecord.sentences) ? metaRecord.sentences : [];
            const sentences = rawSentences.map((item) => String(item || "").trim()).filter(Boolean);
            if (!sentences.includes(text)) {
              sentences.push(text);
            }
            return {
              ...message,
              meta: buildRuntimeStreamMeta(metaRecord, { sentences }),
            };
          }, true);
          return;
        }
        if (event.type === "error") {
          throw new Error(String(event.data?.message || "台词流生成失败"));
        }
      });
      if (!done) {
        throw new Error("台词流未正常结束");
      }
    } catch (error) {
      updateMessageById(streamingMessage.id, () => null, true);
      throw error;
    }
  }

  async function performStartDebugCurrentChapter() {
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
    syncRuntimeChatTrace();
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
      const result = await api.orchestrateDebug({
        worldId: state.worldId,
        chapterId: chapter.id,
        state: state.debugRuntimeState,
        messages: [],
      });
      state.debugLoadingStage = "准备剧情编排完毕";
      clearRuntimeRetryState();
      applyDebugOrchestrationResult(result, chapter);
      state.debugLoading = false;
      state.debugLoadingStage = "";
      if (result.plan) {
        await streamDebugPlan(result.plan, []);
      } else {
        state.messages = [];
      }
    } finally {
      state.debugLoading = false;
      state.debugLoadingStage = "";
    }
  }

  async function startDebugCurrentChapter() {
    clearRuntimeRetryState();
    try {
      await performStartDebugCurrentChapter();
    } catch (error) {
      if (isBenignRuntimeCancellation(error)) {
        return;
      }
      showRuntimeRetryMessage(
        `进入调试失败：${asUiErrorMessage(error)}`,
        createRuntimeRetryRunner(performStartDebugCurrentChapter, {
          formatErrorMessage: (message) => `进入调试失败：${message}`,
        }),
      );
    }
  }

  async function performContinueDebugNarrative() {
    if (!state.debugMode || !state.worldId) return;
    let advanced = false;
    for (let step = 0; step < 3; step += 1) {
      const currentChapter = state.chapters.find((item) => item.id === state.debugChapterId) || null;
      const beforeCount = conversationMessages().length;
      const history = conversationMessages();
      const result = await api.orchestrateDebug({
        worldId: state.worldId,
        chapterId: state.debugChapterId || undefined,
        state: state.debugRuntimeState,
        messages: history,
        playerContent: null,
      });
      clearRuntimeRetryState();
      applyDebugOrchestrationResult(result, currentChapter);
      if (result.plan) {
        await streamDebugPlanOrFallback(result.plan, history);
      }
      const canPlayerSpeak = debugCanPlayerSpeakFromState();
      if (conversationMessages().length > beforeCount || state.debugEndDialog || canPlayerSpeak) {
        advanced = true;
        break;
      }
    }
    if (!advanced) {
      throw new Error("自动推进没有产出新内容");
    }
  }

  async function continueDebugNarrative() {
    clearRuntimeRetryState();
    try {
      await performContinueDebugNarrative();
      return true;
    } catch (error) {
      if (isBenignRuntimeCancellation(error)) {
        return false;
      }
      showRuntimeRetryMessage(
        `继续调试失败：${asUiErrorMessage(error)}`,
        createRuntimeRetryRunner(performContinueDebugNarrative, {
          formatErrorMessage: (message) => `继续调试失败：${message}`,
        }),
      );
      return false;
    }
  }

  async function performDebugPlayerMessage(content: string, appendPlayerMessage: boolean) {
    if (appendPlayerMessage) {
      const now = Date.now();
      state.messages = [
        ...conversationMessages(),
        {
          id: now,
          role: state.playerName || "用户",
          roleType: "player",
          eventType: "on_message",
          content,
          createTime: now,
        },
      ];
      syncRuntimeChatTrace();
      state.sendText = "";
    }
    applyLocalDebugPlayerProfile(content);
    const history = conversationMessages();
    const result = await api.orchestrateDebug({
      worldId: state.worldId,
      chapterId: state.debugChapterId || undefined,
      playerContent: content,
      state: state.debugRuntimeState,
      messages: history,
    });
    const currentChapter = state.chapters.find((item) => item.id === state.debugChapterId) || null;
    clearRuntimeRetryState();
    applyDebugOrchestrationResult(result, currentChapter);
    if (result.plan) {
      await streamDebugPlanOrFallback(result.plan, conversationMessages(), content);
    }
  }

  async function performSessionPlayerMessage(content: string) {
    if (!state.currentSessionId) return;
    const result = await api.addMessage({
      sessionId: state.currentSessionId,
      roleType: "player",
      role: state.playerName || "用户",
      content,
      eventType: "on_message",
    });
    state.sendText = "";
    clearRuntimeRetryState();
    applySessionNarrativeResult(result);
    await refreshSessionListState();
  }

  async function performContinueSessionNarrative() {
    if (!state.currentSessionId) return;
    const beforeCount = conversationMessages().length;
    const result = await api.continueSession(state.currentSessionId);
    clearRuntimeRetryState();
    applySessionNarrativeResult(result);
    await refreshSessionListState();
    const afterCount = conversationMessages().length;
    const latest = conversationMessages().slice(-1)[0] || null;
    const latestStatus = runtimeMessageStatus(latest);
    const canPlayerSpeakNow = runtimeTurnStateRecord()["canPlayerSpeak"] !== false;
    if (afterCount <= beforeCount && !canPlayerSpeakNow && latestStatus !== "waiting_player") {
      throw new Error("自动推进没有产出新内容");
    }
  }

  async function continueSessionNarrative() {
    clearRuntimeRetryState();
    try {
      await performContinueSessionNarrative();
      return true;
    } catch (error) {
      if (isBenignRuntimeCancellation(error)) {
        return false;
      }
      showRuntimeRetryMessage(
        `继续剧情失败：${asUiErrorMessage(error)}`,
        createRuntimeRetryRunner(performContinueSessionNarrative, {
          formatErrorMessage: (message) => `继续剧情失败：${message}`,
        }),
      );
      return false;
    }
  }

  async function sendMessage() {
    const content = state.sendText.trim();
    if (!content) return;
    clearRuntimeRetryState();
    try {
      if (state.debugMode) {
        await performDebugPlayerMessage(content, true);
        return;
      }
      await performSessionPlayerMessage(content);
    } catch (error) {
      const rawMessage = asUiErrorMessage(error);
      if (!state.debugMode && (rawMessage.includes("当前还没轮到用户发言") || rawMessage.includes("409"))) {
        state.notice = rawMessage;
        try {
          await refreshCurrentSession();
        } catch {
          // Ignore follow-up refresh failures after a 409 turn conflict.
        }
        return;
      }
      const message = `发送失败：${asUiErrorMessage(error)}`;
      const retryTask = state.debugMode
        ? createRuntimeRetryRunner(() => performDebugPlayerMessage(content, false), {
          formatErrorMessage: (text) => `发送失败：${text}`,
        })
        : createRuntimeRetryRunner(() => performSessionPlayerMessage(content), {
          formatErrorMessage: (text) => `发送失败：${text}`,
        });
      showRuntimeRetryMessage(message, retryTask);
    }
  }

  async function deleteMessage(message: MessageItem) {
    const messageId = Number(message.id || 0);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      throw new Error("消息不存在");
    }
    const latest = conversationMessages().slice(-1)[0] || null;
    if (!latest || Number(latest.id || 0) !== messageId) {
      throw new Error("当前只支持删除最后一条台词");
    }
    if (String(message.roleType || "").trim() !== "player") {
      throw new Error("当前只支持删除最后一条玩家台词");
    }

    if (state.debugMode) {
      state.messages = state.messages.filter((item) => Number(item.id || 0) !== messageId);
      delete state.messageReactions[String(messageId)];
      restoreDebugPlayerTurnAfterDeletion();
      syncRuntimeChatTrace();
      state.notice = "已删除上一句玩家台词";
      return;
    }

    if (!state.currentSessionId) {
      throw new Error("当前没有可删除的会话");
    }
    await api.deleteMessage(state.currentSessionId, messageId);
    delete state.messageReactions[String(messageId)];
    await refreshCurrentSession();
    state.notice = "已删除上一句玩家台词";
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
    continueSessionForWorld,
    quickStart,
    openSession,
    syncRuntimeChatTraceNow: syncRuntimeChatTrace,
    deleteSession,
    refreshCurrentSession,
    startDebugCurrentChapter,
    continueDebugNarrative,
    continueSessionNarrative,
    setRuntimeMessageStatus,
    retryRuntimeFailure,
    advanceDebugChapterIfNeeded,
    jumpDebugChapter,
    getDebugChapterIndex,
    syncDebugChapter,
    sendMessage,
    deleteMessage,
    copyMessageText,
    reactMessage,
    fetchVoiceModels,
    fetchVoicePresets,
    voicePresetsForConfig,
    ensureSettingsPanelData,
    bindGameModel,
    bindRecommendedGameModel,
    addManagedModelConfig,
    updateManagedModelConfig,
    fetchLocalAvatarMattingStatus,
    installLocalAvatarMattingModel,
    deleteManagedModelConfig,
    testManagedModelConfig,
    saveStoryPrompt,
    resetStoryPrompt,
    isAdminAccount,
    settingsConfigOptions,
    settingsModelBinding,
    settingsRecommendedModel,
    settingsModelAdvisory,
    currentStoryPromptValue,
    uploadVoiceReferenceAudio,
    previewVoice,
    streamVoice,
    polishVoicePrompt,
    transcribeRuntimeVoice,
    applyImageToTarget,
    updateAvatarFromFile,
    updateAvatarFromMp4,
    isAvatarProcessing,
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
    canEditWorld,
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
