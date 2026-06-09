/**
 * 语音绑定模块
 *
 * 职责：管理角色语音绑定的配置和解析
 */
import { computed } from "vue";
import { useToonflowStore } from "../useToonflowStore";
import type { MessageItem, StoryRole, VoiceBindingDraft, VoiceMixItem } from "../../types/toonflow";
import { normalizeBindingMixVoices, runtimeVoiceBindingKey as computeRuntimeVoiceBindingKey } from "./textUtils";

// ============== Store 引用 ==============
const store = useToonflowStore();

// ============== 计算属性 ==============
const roleCards = computed(() => store.state.roleCards);
const currentWorld = computed(() => store.state.sessionDetail?.world || null);

// ============== 辅助函数 ==============
export function runtimeStoryVoiceConfigId(): number | null {
  const value = store.state.settingsAiModelMap.find((item) => item.key === "storyVoiceModel")?.configId;
  return value && value > 0 ? value : null;
}

export function inferFallbackPreset(roleType: string, name = "", description = ""): string {
  if (roleType === "narrator") return "story_narrator";
  const text = `${name} ${description}`.toLowerCase();
  if (/[女姐妈妹娘妃后妻她]|female|woman|girl|lady/.test(text)) {
    return "story_std_female";
  }
  return "story_std_male";
}

export function narratorVoiceBinding(): VoiceBindingDraft | null {
  const settings = currentWorld.value?.settings;
  const narratorRole = currentWorld.value?.narratorRole;
  const debugConfigId = store.state.debugMode && !currentWorld.value ? runtimeStoryVoiceConfigId() : null;
  const configId = settings?.narratorVoiceConfigId ?? narratorRole?.voiceConfigId ?? debugConfigId;
  const normalizedMode = settings?.narratorVoiceMode || narratorRole?.voiceMode || store.state.narratorVoiceMode || "text";
  const presetId = settings?.narratorVoicePresetId || narratorRole?.voicePresetId || store.state.narratorVoicePresetId || "";
  return createVoiceBindingDraft({
    label: settings?.narratorVoice || narratorRole?.voice || store.state.narratorVoice || narratorRole?.name || store.state.narratorName || "旁白",
    configId: configId ?? null,
    roleId: "narrator",
    presetId: !presetId && normalizedMode === "text" ? "story_narrator" : presetId,
    mode: normalizedMode,
    referenceAudioPath: settings?.narratorVoiceReferenceAudioPath || narratorRole?.voiceReferenceAudioPath || store.state.narratorVoiceReferenceAudioPath || "",
    referenceAudioName: settings?.narratorVoiceReferenceAudioName || narratorRole?.voiceReferenceAudioName || store.state.narratorVoiceReferenceAudioName || "",
    referenceText: settings?.narratorVoiceReferenceText || narratorRole?.voiceReferenceText || store.state.narratorVoiceReferenceText || "",
    promptText: settings?.narratorVoicePromptText || narratorRole?.voicePromptText || store.state.narratorVoicePromptText || "",
    mixVoices: settings?.narratorVoiceMixVoices || narratorRole?.voiceMixVoices || store.state.narratorVoiceMixVoices || [],
  });
}

export function roleVoiceBinding(role?: StoryRole | null): VoiceBindingDraft | null {
  if (!role) return null;
  const configId = role.voiceConfigId ?? (store.state.debugMode && !currentWorld.value ? runtimeStoryVoiceConfigId() : null);
  const mode = role.voiceMode || "text";
  const presetId = role.voicePresetId || (mode === "text" ? inferFallbackPreset(role.roleType, role.name, role.description) : "");
  return createVoiceBindingDraft({
    label: role.voice || role.name,
    configId: configId ?? null,
    roleId: role.id || "",
    presetId,
    mode,
    referenceAudioPath: role.voiceReferenceAudioPath || "",
    referenceAudioName: role.voiceReferenceAudioName || "",
    referenceText: role.voiceReferenceText || "",
    promptText: role.voicePromptText || "",
    mixVoices: role.voiceMixVoices || [],
  });
}

export function findMessageRole(message: MessageItem): StoryRole | null {
  if (message.roleType === "player" || message.roleType === "narrator") return null;
  const roleName = String(message.role || "").trim();
  return roleCards.value.find((role) => {
    if (!roleName) return role.roleType === message.roleType;
    return role.name === roleName || role.id === roleName;
  }) || roleCards.value.find((role) => role.roleType === message.roleType) || null;
}

export function resolveMessageVoiceBinding(message: MessageItem): VoiceBindingDraft | null {
  if (message.roleType === "player") return null;
  if (message.roleType === "narrator") return narratorVoiceBinding();
  return roleVoiceBinding(findMessageRole(message));
}

export function resolveFallbackVoiceBinding(message: MessageItem, originalBinding?: VoiceBindingDraft | null): VoiceBindingDraft | null {
  if (message.roleType === "player") return null;
  if (message.roleType === "narrator") {
    return createVoiceBindingDraft({
      label: originalBinding?.label || store.state.narratorVoice || store.state.narratorName || "旁白",
      configId: originalBinding?.configId ?? narratorVoiceBinding()?.configId ?? null,
      roleId: originalBinding?.roleId || "narrator",
      mode: "text",
      presetId: "story_narrator",
    });
  }
  const role = findMessageRole(message);
  const roleName = role?.name || String(message.role || "").trim();
  const fallbackPresetId = inferFallbackPreset(
    role?.roleType || message.roleType || "",
    roleName,
    role?.description || "",
  );
  return createVoiceBindingDraft({
    label: originalBinding?.label || role?.voice || roleName || "角色",
    configId: originalBinding?.configId ?? role?.voiceConfigId ?? null,
    roleId: originalBinding?.roleId || role?.id || "",
    mode: "text",
    presetId: fallbackPresetId,
  });
}

// ============== 缓存键函数 ==============
export function runtimeVoiceBindingKey(binding: VoiceBindingDraft): string {
  const runtimeContextKey = binding.configId || currentWorld.value?.id || store.state.currentSessionId || "runtime";
  return [
    runtimeContextKey,
    binding.roleId || "",
    binding.mode || "text",
    binding.presetId || "",
    binding.referenceAudioPath || "",
    binding.referenceText || "",
    binding.promptText || "",
    (binding.mixVoices || []).map((item) => `${item.voiceId}:${item.weight}`).join(";"),
  ].join("|");
}

export function runtimeVoicePreviewKey(binding: VoiceBindingDraft, text: string): string {
  return `${runtimeVoiceBindingKey(binding)}|${text}`;
}

// ============== VoiceBindingDraft 创建 ==============
export function createVoiceBindingDraft(source: {
  label?: string | null;
  configId?: number | null;
  roleId?: string | null;
  presetId?: string | null;
  mode?: string | null;
  referenceAudioPath?: string | null;
  referenceAudioName?: string | null;
  referenceText?: string | null;
  promptText?: string | null;
  mixVoices?: VoiceMixItem[] | null;
}): VoiceBindingDraft | null {
  const draft: VoiceBindingDraft = {
    label: String(source.label || "").trim(),
    configId: source.configId ?? null,
    roleId: String(source.roleId || "").trim(),
    presetId: String(source.presetId || "").trim(),
    mode: String(source.mode || "text").trim() || "text",
    referenceAudioPath: String(source.referenceAudioPath || "").trim(),
    referenceAudioName: String(source.referenceAudioName || "").trim(),
    referenceText: String(source.referenceText || "").trim(),
    promptText: String(source.promptText || "").trim(),
    mixVoices: normalizeBindingMixVoices(source.mixVoices),
  };
  if (draft.mode === "clone" && !draft.referenceAudioPath) return null;
  if (draft.mode === "mix" && !(draft.mixVoices || []).some((item) => item.voiceId.trim())) return null;
  if (draft.mode === "prompt_voice" && !draft.promptText) return null;
  if (draft.mode === "text" && !draft.presetId) return null;
  return draft;
}

export function normalizeBindingMixVoices(input?: VoiceMixItem[] | null): VoiceMixItem[] {
  return (input || [])
    .filter((item) => String(item.voiceId || "").trim())
    .map((item) => ({
      voiceId: String(item.voiceId || "").trim(),
      weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0.7,
    }));
}