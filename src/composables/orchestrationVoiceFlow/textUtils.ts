/**
 * 文本处理工具模块
 *
 * 职责：提供文本处理相关的工具函数
 */
import { computed } from "vue";
import { useToonflowStore } from "../useToonflowStore";
import type { MessageItem } from "../../types/toonflow";

const RUNTIME_VOICE_CACHE_LIMIT = 60;

// ============== Store 引用 ==============
const store = useToonflowStore();

// ============== 计算属性 ==============
const messages = computed(() => store.state.messages);

// ============== 辅助函数 ==============
export function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function messageUiKey(message: MessageItem): string {
  return `${store.state.currentSessionId}_${message.id}_${message.createTime}_${message.roleType || ""}`;
}

export function latestMessageByKey(messageKey: string): MessageItem | null {
  return messages.value.find((message) => messageUiKey(message) === messageKey) || null;
}

export function messageDisplayContent(message: MessageItem): string {
  if (message.sentence) return message.sentence;
  if (message.content) return message.content;
  return "";
}

export function isStreamingRuntimeMessage(message: MessageItem): boolean {
  return message.status === "streaming";
}

export function isRuntimeRetryMessage(message: MessageItem): boolean {
  return !!(message as any).retryMeta;
}

export function runtimeStreamSentences(message: MessageItem): string[] {
  if (!message.sentences || !Array.isArray(message.sentences)) return [];
  return message.sentences.filter(Boolean);
}

export function runtimeMessageStatus(message: MessageItem): string {
  return String(message.status || "");
}

export function canPlayerSpeak(): boolean {
  return !!store.state.canPlayerSpeak;
}

export function hasActiveMiniGame(): boolean {
  return store.hasActiveMiniGameInCurrentSession();
}

export function isOpeningNarrativeMessage(message: MessageItem): boolean {
  return !!(message as any).isOpening;
}

// ============== 文本处理函数 ==============
export function sanitizeSpeechText(input: unknown): string {
  return String(input || "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/【[^】]*】/g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/《[^》]*》/g, "")
    .replace(/〈[^〉]*〉/g, "")
    .replace(/〔[^〕]*〕/g, "")
    .replace(/(^|\n)[：:，,；;、]+/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizePlayableSpeechText(input: unknown): string {
  const text = sanitizeSpeechText(input).replace(/\r/g, "").trim();
  if (!text) return "";
  const compact = text.replace(/\s+/g, "");
  const meaningful = compact.replace(/[0-9０-９.,!?;:，。！？；：、…·"'""''`~!@#$%^&*()\-_=+\[\]{}<>\\/|]+/g, "");
  return meaningful ? text : "";
}

export function speakableUnitCount(input: unknown): number {
  const text = normalizePlayableSpeechText(input);
  if (!text) return 0;
  return text
    .replace(/\s+/g, "")
    .replace(/[0-9０-９.,!?;:，。！？；：、…·"'""''`~!@#$%^&*()\-_=+\[\]{}<>\\/|]+/g, "")
    .length;
}

export function isDeterministicRuntimeVoiceError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return [
    "detect audio failed",
    "当前语音设计模型与所选故事语音模型不兼容",
    "请先在设置里配置语音设计模型",
    "当前语音模型不支持该绑定模式",
    "克隆模式需要参考音频",
    "提示词模式需要填写提示词",
    "参考音频无法被阿里云解码",
    "语音模型配置不存在",
    "未返回试听音频",
    "http 400",
  ].some((item) => message.includes(item.toLowerCase()));
}

export function setLimitedCacheValue<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > RUNTIME_VOICE_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

export function estimatePlaybackTimeoutMs(text: string): number {
  const normalized = sanitizeSpeechText(text);
  const estimated = normalized.length * 180 + 6000;
  return Math.max(8000, Math.min(45000, estimated));
}

export function estimateRevealDelayMs(text: string): number {
  const normalized = sanitizeSpeechText(text);
  const estimated = normalized.length * 90 + 1200;
  return Math.max(1400, Math.min(4800, estimated));
}

// ============== 文本分句 ==============
export function splitSpeechSegments(input: string): string[] {
  const text = normalizePlayableSpeechText(input);
  if (!text) return [];
  const segments: string[] = [];
  let buffer = "";
  const push = () => {
    const value = normalizePlayableSpeechText(buffer);
    if (value && speakableUnitCount(value) >= 2) segments.push(value);
    buffer = "";
  };
  for (const char of text) {
    buffer += char;
    const length = buffer.replace(/\s/g, "").length;
    if (/[。！？!?；;\n]/.test(char)) {
      push();
      continue;
    }
    if (length >= 40) {
      push();
    }
  }
  push();
  return segments.filter(Boolean);
}