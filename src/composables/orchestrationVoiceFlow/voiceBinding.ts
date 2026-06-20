/**
 * 语音绑定模块
 *
 * 职责：管理角色语音绑定的配置和解析
 */
import { useToonflowStore } from "../useToonflowStore";
import type { MessageItem, StoryRole, VoiceBindingDraft, VoiceMixItem } from "../../types/toonflow";

// ============== Store 延迟获取 ==============
let cachedStore: ReturnType<typeof useToonflowStore> | null = null;
function getStore() {
  if (!cachedStore) {
    cachedStore = useToonflowStore();
  }
  return cachedStore;
}

// ============== 辅助函数 ==============
export function runtimeStoryVoiceConfigId(): number | null {
  const store = getStore();
  const value = store.state.settingsAiModelMap.find((item: any) => item.key === "storyVoiceModel")?.configId;
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
  const store = getStore();
  const sessionDetail = store.state.sessionDetail;
  const world = sessionDetail?.world || null;
  const settings = world?.settings;
  const narratorRole = world?.narratorRole;
  const debugConfigId = store.state.debugMode && !world ? runtimeStoryVoiceConfigId() : null;
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
  const store = getStore();
  const sessionDetail = store.state.sessionDetail;
  const world = sessionDetail?.world || null;
  const configId = role.voiceConfigId ?? (store.state.debugMode && !world ? runtimeStoryVoiceConfigId() : null);
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

/**
 * 从 store 派生角色卡列表（与 ScenePlay.vue 中的 roleCards computed 保持一致逻辑）。
 * 之前的实现错误地读取了 store.state.roleCards（该字段不存在），导致 NPC 消息的 voice binding 永远找不到。
 */
function resolveRoleCardsFromStore(): StoryRole[] {
  const store = getStore();
  const sessionDetail = store.state.sessionDetail;
  const world = sessionDetail?.world || null;
  const settings = world?.settings;
  const seen = new Set<string>();
  const list: StoryRole[] = [];
  const pushRole = (role?: StoryRole | null) => {
    if (!role || !role.name) return;
    const key = role.id || `${role.roleType}:${role.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(role);
  };
  if (store.state.debugMode && !world) {
    pushRole({
      id: "player",
      roleType: "player",
      name: store.state.playerName || "用户",
    } as StoryRole);
    pushRole({
      id: "narrator",
      roleType: "narrator",
      name: store.state.narratorName || "旁白",
    } as StoryRole);
    (store.state.npcRoles || []).forEach((role) => pushRole(role));
  } else {
    pushRole(world?.playerRole || null);
    pushRole(world?.narratorRole || null);
    (settings?.roles || []).forEach((role) => pushRole(role));
  }
  return list;
}

export function findMessageRole(message: MessageItem): StoryRole | null {
  const roleCards = resolveRoleCardsFromStore();
  if (message.roleType === "player" || message.roleType === "narrator") return null;
  const roleName = String(message.role || "").trim();
  const exactMatch = roleCards.find((role: StoryRole) => {
    if (!roleName) return role.roleType === message.roleType;
    return role.name === roleName || role.id === roleName;
  });
  const fallbackMatch = exactMatch || roleCards.find((role: StoryRole) => role.roleType === message.roleType) || null;
  console.log("[voiceBinding] findMessageRole", {
    messageId: message.id,
    role: message.role,
    roleType: message.roleType,
    roleCardCount: roleCards.length,
    roleNames: roleCards.slice(0, 5).map((r) => `${r.name}(${r.roleType})`),
    exactMatch: exactMatch ? { name: exactMatch.name, id: exactMatch.id, voiceConfigId: exactMatch.voiceConfigId, voiceMode: exactMatch.voiceMode } : null,
    fallbackMatch: fallbackMatch ? { name: fallbackMatch.name, id: fallbackMatch.id, voiceConfigId: fallbackMatch.voiceConfigId, voiceMode: fallbackMatch.voiceMode } : null,
  });
  return fallbackMatch;
}

/**
 * 解析"用户角色"的语音绑定。
 * 与 narrator/npc 路径对齐：观看模式回放用户台词时也需要用绑定的音色生成语音，
 * 不再无视 world.playerRole 直接 return null。
 */
export function playerVoiceBinding(): VoiceBindingDraft | null {
  const store = getStore();
  const sessionDetail = store.state.sessionDetail;
  const world = sessionDetail?.world || null;
  const playerRole = world?.playerRole;
  if (!playerRole) return null;
  // 调试模式（无 world）允许从全局配置回退取一个默认 configId
  const configId = playerRole.voiceConfigId ?? (store.state.debugMode && !world ? runtimeStoryVoiceConfigId() : null);
  const mode = playerRole.voiceMode || store.state.playerVoiceMode || "text";
  const presetId = playerRole.voicePresetId
    || store.state.playerVoicePresetId
    || (mode === "text" ? inferFallbackPreset("player", playerRole.name, playerRole.description) : "");
  return createVoiceBindingDraft({
    label: playerRole.voice || store.state.playerVoice || playerRole.name || store.state.playerName || "用户",
    configId: configId ?? null,
    roleId: playerRole.id || "player",
    presetId,
    mode,
    referenceAudioPath: playerRole.voiceReferenceAudioPath || store.state.playerVoiceReferenceAudioPath || "",
    referenceAudioName: playerRole.voiceReferenceAudioName || store.state.playerVoiceReferenceAudioName || "",
    referenceText: playerRole.voiceReferenceText || store.state.playerVoiceReferenceText || "",
    promptText: playerRole.voicePromptText || store.state.playerVoicePromptText || "",
    mixVoices: playerRole.voiceMixVoices || store.state.playerVoiceMixVoices || [],
  });
}

export function resolveMessageVoiceBinding(message: MessageItem): VoiceBindingDraft | null {
  if (message.roleType === "player") return playerVoiceBinding();
  if (message.roleType === "narrator") return narratorVoiceBinding();
  return roleVoiceBinding(findMessageRole(message));
}

export function resolveFallbackVoiceBinding(message: MessageItem, originalBinding?: VoiceBindingDraft | null): VoiceBindingDraft | null {
  const store = getStore();
  if (message.roleType === "player") {
    return createVoiceBindingDraft({
      label: originalBinding?.label || store.state.playerVoice || store.state.playerName || "用户",
      configId: originalBinding?.configId ?? playerVoiceBinding()?.configId ?? null,
      roleId: originalBinding?.roleId || "player",
      mode: "text",
      presetId: inferFallbackPreset("player", store.state.playerName || "", store.state.playerDesc || ""),
    });
  }
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
  const store = getStore();
  const sessionDetail = store.state.sessionDetail;
  const world = sessionDetail?.world || null;
  const runtimeContextKey = binding.configId || world?.id || store.state.currentSessionId || "runtime";
  return [
    runtimeContextKey,
    binding.roleId || "",
    binding.mode || "text",
    binding.presetId || "",
    binding.referenceAudioPath || "",
    binding.referenceText || "",
    binding.promptText || "",
    (binding.mixVoices || []).map((item: VoiceMixItem) => `${item.voiceId}:${item.weight}`).join(";"),
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
  if (draft.mode === "mix" && !(draft.mixVoices || []).some((item: VoiceMixItem) => item.voiceId.trim())) return null;
  if (draft.mode === "prompt_voice" && !draft.promptText) return null;
  if (draft.mode === "text" && !draft.presetId) return null;
  return draft;
}

export function normalizeBindingMixVoices(input?: VoiceMixItem[] | null): VoiceMixItem[] {
  return (input || [])
    .filter((item: VoiceMixItem) => String(item.voiceId || "").trim())
    .map((item: VoiceMixItem) => ({
      voiceId: String(item.voiceId || "").trim(),
      weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0.7,
    }));
}