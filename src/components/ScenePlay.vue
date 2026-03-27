<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import type { MessageItem, RoleParameterCard, RuntimeRetryMessageMeta, StoryRole, VoiceBindingDraft, VoiceMixItem } from "../types/toonflow";
import { fileToDataUrl } from "../utils/file";

const store = useToonflowStore();
const RUNTIME_FAST_PREVIEW_FORMAT = "mp3";
const RUNTIME_FAST_PREVIEW_SAMPLE_RATE = 16000;
const messages = computed(() => store.state.messages);
const session = computed(() => store.state.sessionDetail);
const currentWorld = computed(() => session.value?.world || null);
const debugChapterIndex = computed(() => store.getDebugChapterIndex());
const currentChapter = computed(() => session.value?.chapter || store.state.chapters[debugChapterIndex.value] || null);
const debugChapter = computed(() => store.state.chapters[debugChapterIndex.value] || null);
function asMiniRecord(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function asMiniArray<T = unknown>(input: unknown): T[] {
  return Array.isArray(input) ? (input as T[]) : [];
}

function scalarText(input: unknown): string {
  const text = String(input ?? "").trim();
  if (!text || text === "null" || text === "undefined") return "";
  return text;
}

function isRuntimeRetryMessage(message: MessageItem | null | undefined): message is MessageItem & { meta: RuntimeRetryMessageMeta } {
  if (!message || message.eventType !== "on_runtime_retry_error") return false;
  const meta = asMiniRecord(message.meta);
  return meta.kind === "runtime_retry" && typeof meta.token === "string";
}

function runtimeRetryLabel(message: MessageItem | null | undefined): string {
  if (!isRuntimeRetryMessage(message)) return "重试";
  const label = scalarText(message.meta.retryLabel);
  return label || "重试";
}

function stringifyMiniStateValue(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (Array.isArray(input)) {
    return input.map((item) => stringifyMiniStateValue(item)).filter(Boolean).join("、");
  }
  if (typeof input === "object") {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }
  return String(input);
}

function sanitizeSpeechText(input: unknown): string {
  return String(input || "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/【[^】]*】/g, "")
    .replace(/\[[^\]]*]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isDeterministicRuntimeVoiceError(error: unknown): boolean {
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

function normalizeChapterTitleLabel(input: unknown, sort?: unknown): string {
  const raw = scalarText(input);
  if (raw && !/^章节\s*\d{10,}$/u.test(raw)) return raw;
  const chapterSort = Number(sort || 0);
  if (Number.isFinite(chapterSort) && chapterSort > 0) {
    return `第 ${chapterSort} 章`;
  }
  return raw || "当前章节";
}

function extractOpeningContentParts(input: unknown): { role: string; line: string; body: string } | null {
  const text = String(input || "").trim();
  if (!text) return null;
  const match = text.match(/^开场白(?:\[(.+?)\]|([^\[\]:：\r\n]+))\s*[:：]\s*([^\r\n]*)(?:\r?\n)*/);
  if (!match) return null;
  return {
    role: String(match[1] || match[2] || "").trim(),
    line: String(match[3] || "").trim(),
    body: text.slice(match[0].length).replace(/^\s*[\r\n]+/, ""),
  };
}
function stripLeadingOpeningBlocks(input: unknown): string {
  let text = String(input || "").trim();
  if (!text) return "";
  for (let i = 0; i < 8; i += 1) {
    const extracted = extractOpeningContentParts(text);
    if (!extracted) break;
    text = extracted.body.replace(/^\s*[\r\n]+/, "");
  }
  return text;
}
const chapterBackgroundPath = computed(() =>
  store.resolveMediaPath(
    currentChapter.value?.backgroundPath || store.state.chapterBackground || currentWorld.value?.settings?.coverBgPath || currentWorld.value?.settings?.coverPath || "",
  ),
);
const chapterEntryText = computed(() => formatConditionText(currentChapter.value?.entryCondition));
const chapterCompletionText = computed(() => {
  if (currentChapter.value?.showCompletionCondition === false) return "对用户隐藏";
  return formatConditionText(currentChapter.value?.completionCondition) || store.state.chapterCondition || "无";
});
const chapterObjectiveText = computed(() => {
  if (currentChapter.value?.showCompletionCondition === false) return "";
  return (formatConditionText(currentChapter.value?.completionCondition) || store.state.chapterCondition || "").trim();
});
const chapterObjectivePreview = computed(() => {
  const normalized = chapterObjectiveText.value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 20 ? `${normalized.slice(0, 20)}...` : normalized;
});
const chapterStatusItems = computed(() => [
  { label: "章节状态", value: currentChapter.value?.status || "draft" },
  { label: "完成条件", value: currentChapter.value?.showCompletionCondition === false ? "隐藏" : "可见" },
  { label: "游玩模式", value: store.state.debugMode ? "调试缓存" : "正式会话" },
  { label: "章节序号", value: currentChapter.value?.sort != null ? String(currentChapter.value.sort) : "1" },
]);
const chapterConditionHint = computed(() => {
  if (!currentChapter.value) return "当前没有章节，无法判定进入或结束条件。";
  const entry = chapterEntryText.value || "无";
  const completion = currentChapter.value?.showCompletionCondition === false ? "已对用户隐藏" : (chapterCompletionText.value || "无");
  const modeHint = store.state.debugMode
    ? "当前处于调试缓存，发送消息后会按完成条件自动切章，未保存内容也会参与判定。"
    : "正式会话会由服务端决定章节推进，本地仅展示当前章节状态。";
  return `进入条件：${entry}\n完成条件：${completion}\n${modeHint}`;
});
const chapterOpeningDisplay = computed(() => {
  const openingRole = currentChapter.value?.openingRole || store.state.chapterOpeningRole || "旁白";
  const openingLine = currentChapter.value?.openingText || store.state.chapterOpeningLine || "";
  if (!openingLine) return "无";
  return `${openingRole}：${openingLine}`;
});
const chapterContentText = computed(() => {
  const openingRole = currentChapter.value?.openingRole || store.state.chapterOpeningRole || "旁白";
  const openingLine = currentChapter.value?.openingText || store.state.chapterOpeningLine || "";
  const raw = currentChapter.value?.content || store.state.chapterContent || "";
  const firstPass = stripLeadingOpeningBlocks(raw);
  if (!openingLine) return firstPass || "暂无章节内容";
  const extracted = extractOpeningContentParts(raw);
  if (!extracted) return firstPass || "暂无章节内容";
  const roleMatches = !openingRole || !extracted.role || extracted.role === openingRole;
  const lineMatches = !openingLine || !extracted.line || extracted.line === openingLine;
  return (roleMatches && lineMatches ? stripLeadingOpeningBlocks(extracted.body) : firstPass) || "暂无章节内容";
});
const roleCards = computed(() => {
  const seen = new Set<string>();
  const list: StoryRole[] = [];
  const pushRole = (role?: StoryRole | null) => {
    if (!role || !role.name) return;
    const key = role.id || `${role.roleType}:${role.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(role);
  };
  if (store.state.debugMode && !currentWorld.value) {
    pushRole({
      id: "player",
      roleType: "player",
      name: store.state.playerName || "用户",
      description: store.state.playerDesc,
      voice: store.state.playerVoice,
      voiceMode: store.state.playerVoiceMode,
      voicePresetId: store.state.playerVoicePresetId,
      voiceReferenceAudioPath: store.state.playerVoiceReferenceAudioPath,
      voiceReferenceAudioName: store.state.playerVoiceReferenceAudioName,
      voiceReferenceText: store.state.playerVoiceReferenceText,
      voicePromptText: store.state.playerVoicePromptText,
      voiceMixVoices: store.state.playerVoiceMixVoices,
      avatarPath: store.state.userAvatarPath,
      avatarBgPath: store.state.userAvatarBgPath,
      sample: "",
    } as StoryRole);
    pushRole({
      id: "narrator",
      roleType: "narrator",
      name: store.state.narratorName || "旁白",
      description: "",
      voice: store.state.narratorVoice,
      voiceMode: store.state.narratorVoiceMode,
      voicePresetId: store.state.narratorVoicePresetId,
      voiceReferenceAudioPath: store.state.narratorVoiceReferenceAudioPath,
      voiceReferenceAudioName: store.state.narratorVoiceReferenceAudioName,
      voiceReferenceText: store.state.narratorVoiceReferenceText,
      voicePromptText: store.state.narratorVoicePromptText,
      voiceMixVoices: store.state.narratorVoiceMixVoices,
      avatarPath: "",
      avatarBgPath: "",
      sample: "",
    } as StoryRole);
    (store.state.npcRoles || []).forEach((role) => pushRole(role));
    return list;
  }
  const world = currentWorld.value;
  pushRole(world?.playerRole || null);
  pushRole(world?.narratorRole || null);
  (world?.settings?.roles || []).forEach((role) => pushRole(role));
  return list;
});
const runtimeState = computed<Record<string, unknown>>(() => {
  if (store.state.debugMode) return asMiniRecord(store.state.debugRuntimeState);
  return asMiniRecord(session.value?.state || session.value?.latestSnapshot?.state || {});
});
const runtimeTurnState = computed(() => asMiniRecord(runtimeState.value.turnState));
const canPlayerSpeak = computed(() => runtimeTurnState.value.canPlayerSpeak !== false);
const expectedSpeaker = computed(() => scalarText(runtimeTurnState.value.expectedRole) || "当前角色");
const playInputPlaceholder = computed(() =>
  canPlayerSpeak.value
    ? (inputMode.value === "text" ? "输入一句话开始故事" : "按住说话")
    : `当前轮到${expectedSpeaker.value}发言`,
);
const playTurnHint = computed(() => canPlayerSpeak.value ? "" : `当前还没轮到用户发言，等待${expectedSpeaker.value}继续。`);
const activeMiniGame = computed(() => {
  const root = asMiniRecord(runtimeState.value.miniGame);
  const sessionState = asMiniRecord(root.session);
  const ui = asMiniRecord(root.ui);
  const status = scalarText(sessionState.status);
  const playerOptions = asMiniArray<Record<string, unknown>>(ui.player_options || sessionState.player_options);
  const visibleStatuses = new Set(["preparing", "active", "settling", "suspended"]);
  if (!scalarText(sessionState.game_type) && !scalarText(sessionState.gameType)) return null;
  if (!visibleStatuses.has(status) && !playerOptions.length && !sessionState.pending_exit) return null;
  return {
    gameType: scalarText(sessionState.game_type || sessionState.gameType),
    displayName: scalarText(asMiniRecord(root.rulebook).displayName) || scalarText(sessionState.game_type || sessionState.gameType),
    status,
    phase: scalarText(sessionState.phase),
    round: Number(sessionState.round || 0),
    publicState: asMiniRecord(sessionState.public_state),
    playerOptions,
    ruleSummary: scalarText(ui.rule_summary),
    narration: scalarText(ui.narration),
    pendingExit: Boolean(sessionState.pending_exit),
  };
});
const miniGameSummaryItems = computed(() => {
  if (!activeMiniGame.value) return [];
  return Object.entries(activeMiniGame.value.publicState)
    .map(([key, value]) => ({
      key,
      value: stringifyMiniStateValue(value),
    }))
    .filter((item) => item.value.trim().length > 0)
    .slice(0, 10);
});
const miniGameControlOptions = computed(() => {
  const game = activeMiniGame.value;
  if (!game) return [];
  if (game.status === "suspended") {
    return ["恢复小游戏", "查看状态", "查看规则", "申请退出"];
  }
  if (game.pendingExit) {
    return ["确认退出", "继续", "查看状态"];
  }
  return ["查看状态", "查看规则", "暂停", "申请退出"];
});

const playMode = ref<"live" | "history" | "tips" | "setting">("live");
const inputMode = ref<"voice" | "text">("voice");
const autoVoice = ref(true);
const voiceListening = ref(false);
const voiceTranscribing = ref(false);
const settingRoleId = ref("");
const settingModePickerOpen = ref(false);
const roleDetail = ref<StoryRole | null>(null);
const roleParameterRawOpen = ref(false);
const chapterDetailOpen = ref(true);
const roleCopyHint = ref("");
const menuOpen = ref(false);
const menuMessage = ref<MessageItem | null>(null);
const menuX = ref(0);
const menuY = ref(0);
const pressTimer = ref<number | null>(null);
const menuVisibleHint = ref("");
const currentLiveMessage = computed(() =>
  playMode.value === "history" ? null : (displayMessages.value[displayMessages.value.length - 1] || null),
);
const currentLiveFigurePath = computed(() => {
  const message = currentLiveMessage.value;
  if (!message || message.roleType === "player" || isRuntimeRetryMessage(message)) return "";
  const role = roleCards.value.find((item) => item.name === message.role || item.id === message.role);
  return store.resolveMediaPath(role?.avatarBgPath || role?.avatarPath || "");
});
const messageViewport = ref<HTMLElement | null>(null);
let speechRecognition: any = null;
let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let mediaChunks: Blob[] = [];
let discardNextRecording = false;
let runtimeVoicePlayer: HTMLAudioElement | null = null;
let runtimeVoiceObjectUrl = "";
let runtimeVoiceResolve: ((played: boolean) => void) | null = null;
let runtimeVoiceRequestId = 0;
const runtimeVoicePreviewCache = new Map<string, string>();
const runtimeVoiceWarmCache = new Set<string>();
const revealedMessages = ref<MessageItem[]>([]);
const liveMessageKeys = computed(() => messages.value.map((message) => messageUiKey(message)).join("|"));
const displayMessages = computed(() => (playMode.value === "history" ? messages.value : revealedMessages.value.slice(-1)));
const latestRevealedMessage = computed(() => {
  const list = revealedMessages.value;
  return list.length ? list[list.length - 1] : null;
});
const playStageStyle = computed(() => {
  const layers = ["linear-gradient(180deg, rgba(10, 21, 36, 0.12), rgba(10, 21, 36, 0.45) 55%, rgba(10, 21, 36, 0.86) 100%)"];
  if (chapterBackgroundPath.value) {
    layers.push(`url("${chapterBackgroundPath.value}")`);
  } else {
    layers.push("linear-gradient(180deg, #132745 0%, #0e2038 100%)");
  }
  return { backgroundImage: layers.join(",") };
});
const playTitle = computed(() => currentWorld.value?.name || session.value?.title || store.state.debugSessionTitle || "当前故事");
const playSubtitle = computed(() => {
  const chapterTitle = normalizeChapterTitleLabel(
    currentChapter.value?.title || store.state.debugChapterTitle,
    currentChapter.value?.sort || undefined,
  );
  return store.state.debugMode ? `章节：${chapterTitle}（调试）` : `章节：${chapterTitle}`;
});
const playHandle = computed(() => {
  const role = roleCards.value.find((item) => item.roleType !== "player");
  return `@${role?.name || "故事角色"}`;
});
const playLikeCount = computed(() => Object.values(store.state.messageReactions).filter((item) => item === "like").length);
const statePreviewText = computed(() => {
  if (store.state.debugMode) return store.state.debugStatePreview || "{}";
  const state = session.value?.latestSnapshot?.state || session.value?.state || {};
  try {
    return JSON.stringify(state, null, 2);
  } catch {
    return String(state || "{}");
  }
});
const allowRoleView = computed(() => currentWorld.value?.settings?.allowRoleView !== false);
const settingSelectedRole = computed(() => roleCards.value.find((item) => item.id === settingRoleId.value) || roleCards.value[0] || null);
const tipOptions = computed(() => {
  const leadRole = roleCards.value.find((item) => item.roleType === "npc")?.name || currentChapter.value?.openingRole || "旁白";
  const chapterTitle = currentChapter.value?.title || "当前章节";
  return [
    `我想先观察${leadRole}在《${chapterTitle}》中的反应，再决定下一步。`,
    `直接推进当前章节目标，别再绕路。`,
    `你先给我一个稳妥方案，我按方案执行。`,
  ];
});
const browserSpeechSupported = computed(() => {
  if (typeof window === "undefined") return false;
  return Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
});
const debugLoading = computed(() => store.state.debugLoading);
const debugLoadingStage = computed(() => store.state.debugLoadingStage || "正在初始化调试上下文...");
const debugAutoAdvancing = ref(false);
const lastAutoAdvanceMessageKey = ref("");
const runtimeVoiceMessageKey = ref("");
const runtimeVoicePhase = ref<"" | "loading" | "playing">("");
const runtimeVoiceIndicator = ref(".");
let runtimeVoiceIndicatorTimer = 0;

watch(roleCards, (list) => {
  if (!list.length) {
    settingRoleId.value = "";
    return;
  }
  if (!list.find((item) => item.id === settingRoleId.value)) {
    settingRoleId.value = list[0].id;
  }
}, { immediate: true });

watch(
  () => [store.state.currentSessionId, playMode.value, displayMessages.value.length],
  () => {
    nextTick(() => {
      const el = messageViewport.value;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
  },
  { flush: "post" },
);

watch(
  () => store.state.currentSessionId,
  () => {
    playMode.value = "live";
    inputMode.value = "voice";
    settingModePickerOpen.value = false;
    chapterDetailOpen.value = true;
    closeMenu();
    stopVoiceRecognition();
    stopRuntimeVoicePlayback();
    runtimeVoicePreviewCache.clear();
    runtimeVoiceWarmCache.clear();
    revealedMessages.value = [];
    debugAutoAdvancing.value = false;
    lastAutoAdvanceMessageKey.value = "";
  },
);

watch(autoVoice, (enabled) => {
  if (!enabled) {
    stopRuntimeVoicePlayback();
  }
});

watch(
  () => [runtimeVoiceMessageKey.value, runtimeVoicePhase.value],
  ([messageKey, phase]) => {
    if (runtimeVoiceIndicatorTimer) {
      window.clearInterval(runtimeVoiceIndicatorTimer);
      runtimeVoiceIndicatorTimer = 0;
    }
    if (!messageKey || !phase) {
      runtimeVoiceIndicator.value = ".";
      return;
    }
    const frames = phase === "playing" ? [".", "。", "."] : [".", "。"];
    let index = 0;
    runtimeVoiceIndicator.value = frames[index];
    runtimeVoiceIndicatorTimer = window.setInterval(() => {
      index = (index + 1) % frames.length;
      runtimeVoiceIndicator.value = frames[index];
    }, 260);
  },
  { immediate: true },
);

watch(
  () => [store.state.currentSessionId, autoVoice.value, playMode.value],
  async () => {
    if (!autoVoice.value || playMode.value === "history" || playMode.value === "tips" || playMode.value === "setting") return;
    const binding = narratorVoiceBinding() || roleVoiceBinding(roleCards.value.find((item) => item.roleType !== "player"));
    if (!binding) return;
    await warmVoiceBinding(binding);
  },
  { immediate: true },
);

watch(
  () => [store.state.currentSessionId, liveMessageKeys.value, autoVoice.value, playMode.value, debugLoading.value],
  async (_, __, onCleanup) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    if (playMode.value === "history") {
      revealedMessages.value = [...messages.value];
      return;
    }
    if (playMode.value === "setting" || playMode.value === "tips" || debugLoading.value) return;
    const nextMessages = [...messages.value];
    if (!nextMessages.length) {
      revealedMessages.value = [];
      return;
    }
    const nextKeys = nextMessages.map((message) => messageUiKey(message));
    const revealedKeys = revealedMessages.value.map((message) => messageUiKey(message));
    const mismatched = nextKeys.length < revealedKeys.length || revealedKeys.some((key, index) => nextKeys[index] !== key);
    if (mismatched) {
      revealedMessages.value = [...nextMessages];
      return;
    }
    const newMessages = nextMessages.slice(revealedKeys.length);
    if (!newMessages.length) return;
    for (const message of newMessages) {
      if (cancelled) return;
      revealedMessages.value = [...revealedMessages.value, message];
      await nextTick();
      const viewport = messageViewport.value;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
      if (isRuntimeRetryMessage(message)) {
        continue;
      }
      await waitForMessageReveal(message, () => cancelled);
    }
  },
  { flush: "post", immediate: true },
);

watch(
  () => [
    store.state.currentSessionId,
    playMode.value,
    store.state.debugMode,
    store.state.debugLoading,
    store.state.debugEndDialog,
    canPlayerSpeak.value,
    latestRevealedMessage.value ? messageUiKey(latestRevealedMessage.value) : "",
  ],
  async () => {
    if (
      !store.state.debugMode
      || playMode.value !== "live"
      || store.state.debugLoading
      || store.state.debugEndDialog
      || canPlayerSpeak.value
    ) {
      return;
    }
    const latest = latestRevealedMessage.value;
    if (!latest || latest.roleType === "player" || isRuntimeRetryMessage(latest)) {
      return;
    }
    const key = messageUiKey(latest);
    if (!key || key === lastAutoAdvanceMessageKey.value || debugAutoAdvancing.value) {
      return;
    }
    lastAutoAdvanceMessageKey.value = key;
    debugAutoAdvancing.value = true;
    try {
      await store.continueDebugNarrative();
    } finally {
      debugAutoAdvancing.value = false;
    }
  },
);

watch(playMode, (mode) => {
  if (mode !== "setting") {
    settingModePickerOpen.value = false;
  }
  if (mode === "tips" || mode === "setting") {
    closeMenu();
    stopRuntimeVoicePlayback();
  }
});

function closeMenu() {
  menuOpen.value = false;
  menuMessage.value = null;
  menuVisibleHint.value = "";
}

function openMenu(message: MessageItem, event: MouseEvent | PointerEvent) {
  if (isRuntimeRetryMessage(message)) return;
  menuMessage.value = message;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(event.clientX, vw - 292);
  const top = Math.min(event.clientY, vh - 260);
  menuX.value = Math.max(12, left);
  menuY.value = Math.max(16, top);
  menuOpen.value = true;
  menuVisibleHint.value = `${message.role || (message.roleType === "player" ? "用户" : "旁白")}`;
}

function clearPressTimer() {
  if (pressTimer.value !== null) {
    window.clearTimeout(pressTimer.value);
    pressTimer.value = null;
  }
}

function handlePressStart(message: MessageItem, event: PointerEvent) {
  if (isRuntimeRetryMessage(message)) return;
  if (event.pointerType === "mouse") return;
  clearPressTimer();
  pressTimer.value = window.setTimeout(() => {
    openMenu(message, event);
  }, 520);
}

function handlePressEnd() {
  clearPressTimer();
}

async function submit() {
  if (!canPlayerSpeak.value) {
    store.state.notice = playTurnHint.value || "当前还没轮到用户发言";
    return;
  }
  await store.sendMessage();
  playMode.value = "live";
}

async function retryRuntimeMessage() {
  playMode.value = "live";
  await store.retryRuntimeFailure();
}

async function submitMiniGameAction(text: string) {
  store.state.sendText = text;
  await submit();
}

function like(id: number) {
  store.reactMessage(id, "like");
}

function dislike(id: number) {
  store.reactMessage(id, "dislike");
}

function resetReaction(id: number) {
  store.reactMessage(id, "reset");
}

function copy(text: string) {
  store.copyMessageText(text);
  menuVisibleHint.value = "已复制";
  store.state.notice = "已复制对话内容";
}

function rewrite(content: string) {
  store.state.sendText = `请改写以下内容：\n${content}\n`;
  playMode.value = "live";
  inputMode.value = "text";
  nextTick(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(".play-textarea");
    textarea?.focus();
  });
  menuVisibleHint.value = "已填入改写内容";
}

function formatConditionText(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") {
    const text = input.trim();
    if (!text) return "";
    try {
      const parsed = JSON.parse(text) as unknown;
      return formatConditionText(parsed) || text;
    } catch {
      return text;
    }
  }
  if (typeof input === "boolean") return input ? "true" : "false";
  if (Array.isArray(input)) return input.map((item) => formatConditionText(item)).filter(Boolean).join(" 且 ");
  if (typeof input === "object") {
    const node = input as Record<string, unknown>;
    const allowedKeys = new Set(["type", "op", "field", "left", "value", "right"]);
    const op = String(node.type ?? node.op ?? "contains").trim().toLowerCase();
    const field = String(node.field ?? node.left ?? "message").trim().toLowerCase();
    const value = String(node.value ?? node.right ?? "").trim();
    if (
      value
      && Object.keys(node).every((key) => allowedKeys.has(key))
      && ["contains", "equals", "eq"].includes(op)
      && ["message", "message.content", "latest", "latest_message"].includes(field)
    ) {
      return value;
    }
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }
  return String(input);
}

function replayWithBrowserSpeech(content: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    menuVisibleHint.value = "当前浏览器不支持朗读";
    return;
  }
  window.speechSynthesis.cancel();
  const sanitized = sanitizeSpeechText(content);
  if (!sanitized) {
    menuVisibleHint.value = "这条内容没有可朗读文本";
    return;
  }
  const utterance = new SpeechSynthesisUtterance(sanitized);
  utterance.lang = "zh-CN";
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onend = () => {
    if (menuVisibleHint.value === "正在朗读") menuVisibleHint.value = "朗读完成";
  };
  utterance.onerror = () => {
    menuVisibleHint.value = "朗读失败";
  };
  menuVisibleHint.value = "正在朗读";
  window.speechSynthesis.speak(utterance);
}

function messageUiKey(message: MessageItem): string {
  return `${store.state.currentSessionId}_${message.id}_${message.createTime}_${message.roleType || ""}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function estimatePlaybackTimeoutMs(text: string): number {
  const normalized = sanitizeSpeechText(text);
  const estimated = normalized.length * 180 + 6000;
  return Math.max(8000, Math.min(45000, estimated));
}

function estimateRevealDelayMs(text: string): number {
  const normalized = sanitizeSpeechText(text);
  const estimated = normalized.length * 90 + 1200;
  return Math.max(1400, Math.min(4800, estimated));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer = 0;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(label)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    window.clearTimeout(timer);
  }
}

async function waitForMessageReveal(message: MessageItem, isCancelled: () => boolean) {
  if (isRuntimeRetryMessage(message)) {
    await sleep(120);
    return;
  }
  if (message.roleType === "player") {
    await sleep(180);
    return;
  }
  if (!autoVoice.value) {
    await sleep(estimateRevealDelayMs(message.content));
    return;
  }
  if (isCancelled()) return;
  const played = await playMessageAudio(message, false, true);
  if (isCancelled()) return;
  await sleep(played ? 260 : estimateRevealDelayMs(message.content));
}

function stopRuntimeVoicePlayback() {
  runtimeVoiceRequestId += 1;
  runtimeVoiceResolve?.(false);
  runtimeVoiceResolve = null;
  clearRuntimeVoiceIndicator();
  if (runtimeVoicePlayer) {
    runtimeVoicePlayer.pause();
    runtimeVoicePlayer.currentTime = 0;
    runtimeVoicePlayer.src = "";
    runtimeVoicePlayer = null;
  }
  if (runtimeVoiceObjectUrl) {
    URL.revokeObjectURL(runtimeVoiceObjectUrl);
    runtimeVoiceObjectUrl = "";
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function clearRuntimeVoiceIndicator() {
  runtimeVoiceMessageKey.value = "";
  runtimeVoicePhase.value = "";
  runtimeVoiceIndicator.value = ".";
  if (runtimeVoiceIndicatorTimer) {
    window.clearInterval(runtimeVoiceIndicatorTimer);
    runtimeVoiceIndicatorTimer = 0;
  }
}

function setRuntimeVoiceIndicator(message: MessageItem | null, phase: "" | "loading" | "playing") {
  if (!message || !phase) {
    clearRuntimeVoiceIndicator();
    return;
  }
  runtimeVoiceMessageKey.value = messageUiKey(message);
  runtimeVoicePhase.value = phase;
}

function normalizeBindingMixVoices(input?: VoiceMixItem[] | null): VoiceMixItem[] {
  return (input || [])
    .filter((item) => String(item.voiceId || "").trim())
    .map((item) => ({
      voiceId: String(item.voiceId || "").trim(),
      weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0.7,
    }));
}

function splitSpeechSegments(input: string): string[] {
  const text = sanitizeSpeechText(input).replace(/\r/g, "").trim();
  if (!text) return [];
  const segments: string[] = [];
  let buffer = "";
  const push = () => {
    const value = buffer.trim();
    if (value) segments.push(value);
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

function createVoiceBindingDraft(source: {
  label?: string | null;
  configId?: number | null;
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

function runtimeStoryVoiceConfigId(): number | null {
  const value = store.state.settingsAiModelMap.find((item) => item.key === "storyVoiceModel")?.configId;
  return value && value > 0 ? value : null;
}

function inferFallbackPreset(roleType: string, name = "", description = ""): string {
  if (roleType === "narrator") return "story_narrator";
  const text = `${name} ${description}`.toLowerCase();
  if (/[女姐妈妹娘妃后妻她]|female|woman|girl|lady/.test(text)) {
    return "story_std_female";
  }
  return "story_std_male";
}

function narratorVoiceBinding(): VoiceBindingDraft | null {
  const settings = currentWorld.value?.settings;
  const narratorRole = currentWorld.value?.narratorRole;
  const debugConfigId = store.state.debugMode && !currentWorld.value ? runtimeStoryVoiceConfigId() : null;
  const configId = settings?.narratorVoiceConfigId ?? narratorRole?.voiceConfigId ?? debugConfigId;
  const normalizedMode = settings?.narratorVoiceMode || narratorRole?.voiceMode || store.state.narratorVoiceMode || "text";
  const presetId = settings?.narratorVoicePresetId || narratorRole?.voicePresetId || store.state.narratorVoicePresetId || "";
  return createVoiceBindingDraft({
    label: settings?.narratorVoice || narratorRole?.voice || store.state.narratorVoice || narratorRole?.name || store.state.narratorName || "旁白",
    configId: configId ?? null,
    presetId: !presetId && normalizedMode === "text" ? "story_narrator" : presetId,
    mode: normalizedMode,
    referenceAudioPath: settings?.narratorVoiceReferenceAudioPath || narratorRole?.voiceReferenceAudioPath || store.state.narratorVoiceReferenceAudioPath || "",
    referenceAudioName: settings?.narratorVoiceReferenceAudioName || narratorRole?.voiceReferenceAudioName || store.state.narratorVoiceReferenceAudioName || "",
    referenceText: settings?.narratorVoiceReferenceText || narratorRole?.voiceReferenceText || store.state.narratorVoiceReferenceText || "",
    promptText: settings?.narratorVoicePromptText || narratorRole?.voicePromptText || store.state.narratorVoicePromptText || "",
    mixVoices: settings?.narratorVoiceMixVoices || narratorRole?.voiceMixVoices || store.state.narratorVoiceMixVoices || [],
  });
}

function roleVoiceBinding(role?: StoryRole | null): VoiceBindingDraft | null {
  if (!role) return null;
  const configId = role.voiceConfigId ?? (store.state.debugMode && !currentWorld.value ? runtimeStoryVoiceConfigId() : null);
  const mode = role.voiceMode || "text";
  const presetId = role.voicePresetId || (mode === "text" ? inferFallbackPreset(role.roleType, role.name, role.description) : "");
  return createVoiceBindingDraft({
    label: role.voice || role.name,
    configId: configId ?? null,
    presetId,
    mode,
    referenceAudioPath: role.voiceReferenceAudioPath || "",
    referenceAudioName: role.voiceReferenceAudioName || "",
    referenceText: role.voiceReferenceText || "",
    promptText: role.voicePromptText || "",
    mixVoices: role.voiceMixVoices || [],
  });
}

function resolveMessageVoiceBinding(message: MessageItem): VoiceBindingDraft | null {
  if (message.roleType === "player") return null;
  if (message.roleType === "narrator") return narratorVoiceBinding();
  const roleName = String(message.role || "").trim();
  const matchedRole = roleCards.value.find((role) => {
    if (!roleName) return role.roleType === message.roleType;
    return role.name === roleName || role.id === roleName;
  }) || roleCards.value.find((role) => role.roleType === message.roleType);
  return roleVoiceBinding(matchedRole);
}

function runtimeVoiceBindingKey(binding: VoiceBindingDraft): string {
  const runtimeContextKey = binding.configId || currentWorld.value?.id || store.state.currentSessionId || "runtime";
  return [
    runtimeContextKey,
    binding.mode || "text",
    binding.presetId || "",
    binding.referenceAudioPath || "",
    binding.referenceText || "",
    binding.promptText || "",
    (binding.mixVoices || []).map((item) => `${item.voiceId}:${item.weight}`).join(";"),
  ].join("|");
}

function runtimeVoicePreviewKey(binding: VoiceBindingDraft, text: string): string {
  return `${runtimeVoiceBindingKey(binding)}|${text}`;
}

async function resolveRuntimeVoiceUrl(binding: VoiceBindingDraft, text: string): Promise<string> {
  const cacheKey = runtimeVoicePreviewKey(binding, text);
  const cached = runtimeVoicePreviewCache.get(cacheKey);
  if (cached) return cached;
  const audioUrl = await withTimeout(
    store.previewVoice(
      binding.configId,
      text,
      binding.mode,
      binding.presetId,
      binding.referenceAudioPath,
      binding.referenceText,
      binding.promptText,
      binding.mixVoices || [],
      {
        format: RUNTIME_FAST_PREVIEW_FORMAT,
        sampleRate: RUNTIME_FAST_PREVIEW_SAMPLE_RATE,
      },
    ),
    15000,
    "语音生成超时",
  );
  if (!audioUrl) {
    throw new Error("未返回试听音频");
  }
  runtimeVoicePreviewCache.set(cacheKey, audioUrl);
  return audioUrl;
}

async function warmVoiceBinding(binding: VoiceBindingDraft) {
  if (binding.mode !== "text") return;
  const bindingKey = runtimeVoiceBindingKey(binding);
  if (runtimeVoiceWarmCache.has(bindingKey)) return;
  runtimeVoiceWarmCache.add(bindingKey);
  try {
    await resolveRuntimeVoiceUrl(binding, "你好啊，有什么可以帮到你");
  } catch {
    // 保持静默，预热失败不影响正式播放
  }
}

async function fetchRuntimeVoiceBlob(audioUrl: string): Promise<Blob> {
  const response = await withTimeout(fetch(audioUrl), 10000, "音频下载超时");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

async function playRuntimeVoiceBlob(
  blob: Blob,
  manual: boolean,
  waitForCompletion: boolean,
  speakable: string,
  onPlay?: () => void,
): Promise<boolean> {
  runtimeVoiceObjectUrl = URL.createObjectURL(blob);
  const player = new Audio(runtimeVoiceObjectUrl);
  player.preload = "auto";
  runtimeVoicePlayer = player;
  const completed = await new Promise<boolean>((resolve) => {
    runtimeVoiceResolve = resolve;
    let finished = false;
    const timeoutMs = waitForCompletion ? estimatePlaybackTimeoutMs(speakable) : 8000;
    const timer = window.setTimeout(() => finalize(false, "朗读超时"), timeoutMs);
    const finalize = (ok: boolean, hint: string) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      if (runtimeVoicePlayer === player) runtimeVoicePlayer = null;
      if (runtimeVoiceObjectUrl) {
        URL.revokeObjectURL(runtimeVoiceObjectUrl);
        runtimeVoiceObjectUrl = "";
      }
      runtimeVoiceResolve = null;
      if (manual) menuVisibleHint.value = hint;
      resolve(ok);
    };
    player.onplay = () => {
      onPlay?.();
      if (manual) menuVisibleHint.value = "正在播放试听";
      if (!waitForCompletion) {
        finalize(true, "正在播放试听");
      }
    };
    player.onended = () => finalize(true, "朗读完成");
    player.onerror = () => finalize(false, "朗读失败");
    void player.play().catch(() => finalize(false, "朗读失败"));
  });
  return completed;
}

async function playMessageAudio(message: MessageItem, manual = false, waitForCompletion = false): Promise<boolean> {
  const speakable = sanitizeSpeechText(message.content);
  if (!speakable) {
    if (manual) menuVisibleHint.value = "这条内容没有可朗读文本";
    return false;
  }
  const binding = resolveMessageVoiceBinding(message);
  if (!binding) {
    if (manual) replayWithBrowserSpeech(message.content);
    return false;
  }
  stopRuntimeVoicePlayback();
  const requestId = runtimeVoiceRequestId;
  if (manual) {
    menuVisibleHint.value = "正在生成语音";
  }
  try {
    const segments = splitSpeechSegments(speakable);
    if (!segments.length) return false;
    setRuntimeVoiceIndicator(message, "loading");
    for (const segment of segments) {
      let segmentPlayed = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let shouldRetry = true;
        if (requestId !== runtimeVoiceRequestId) return false;
        try {
          setRuntimeVoiceIndicator(message, "loading");
          const audioUrl = await resolveRuntimeVoiceUrl(binding, segment);
          if (!audioUrl || requestId !== runtimeVoiceRequestId) return false;
          const blob = await fetchRuntimeVoiceBlob(audioUrl);
          segmentPlayed = await playRuntimeVoiceBlob(blob, manual, waitForCompletion, segment, () => {
            setRuntimeVoiceIndicator(message, "playing");
          });
          if (segmentPlayed) break;
        } catch (error: any) {
          shouldRetry = !isDeterministicRuntimeVoiceError(error);
          if (manual) {
            menuVisibleHint.value = `朗读失败: ${error?.message || "未知错误"}`;
          }
        }
        if (!shouldRetry) {
          break;
        }
        await sleep(220);
      }
      if (!segmentPlayed) {
        return false;
      }
      if (!waitForCompletion) {
        return true;
      }
      await sleep(120);
    }
    return true;
  } catch (error: any) {
    if (manual) {
      menuVisibleHint.value = `朗读失败: ${error?.message || "未知错误"}`;
    }
    return false;
  } finally {
    if (runtimeVoiceMessageKey.value === messageUiKey(message)) {
      clearRuntimeVoiceIndicator();
    }
  }
}

function menuCopy() {
  if (!menuMessage.value) return;
  copy(menuMessage.value.content);
  closeMenu();
}

function menuReplay() {
  if (!menuMessage.value) return;
  void playMessageAudio(menuMessage.value, true, true);
  closeMenu();
}

function menuLike() {
  if (!menuMessage.value) return;
  like(menuMessage.value.id);
  closeMenu();
}

function menuDislike() {
  if (!menuMessage.value) return;
  dislike(menuMessage.value.id);
  closeMenu();
}

function menuReset() {
  if (!menuMessage.value) return;
  resetReaction(menuMessage.value.id);
  closeMenu();
}

function menuRewrite() {
  if (!menuMessage.value) return;
  rewrite(menuMessage.value.content);
  closeMenu();
}

function roleTypeLabel(role: StoryRole): string {
  if (role.roleType === "player") return "用户";
  if (role.roleType === "narrator") return "旁白";
  return "NPC";
}

function voiceModeLabel(mode?: string | null): string {
  if (!mode || mode === "text") return "预设音色";
  if (mode === "clone") return "克隆音色";
  if (mode === "mix") return "混合音色";
  if (mode === "prompt_voice") return "提示词音色";
  return mode;
}

function parameterCardEntries(card: RoleParameterCard | null | undefined) {
  if (!card) return [];
  return [
    { label: "名称", value: card.name },
    { label: "原始设定", value: card.raw_setting },
    { label: "性别", value: card.gender },
    { label: "年龄", value: card.age != null ? String(card.age) : "" },
    { label: "性格", value: card.personality },
    { label: "外观", value: card.appearance },
    { label: "音色", value: card.voice },
    { label: "技能", value: card.skills?.length ? card.skills.join("、") : "" },
    { label: "道具", value: card.items?.length ? card.items.join("、") : "" },
    { label: "装备", value: card.equipment?.length ? card.equipment.join("、") : "" },
    { label: "HP", value: card.hp != null ? String(card.hp) : "" },
    { label: "MP", value: card.mp != null ? String(card.mp) : "" },
    { label: "金钱", value: card.money != null ? String(card.money) : "" },
    { label: "其他", value: card.other?.length ? card.other.join("、") : "" },
  ].filter((item) => String(item.value || "").trim().length > 0);
}

function messageAvatarPath(message: MessageItem): string {
  if (isRuntimeRetryMessage(message)) return "";
  if (message.roleType === "player") {
    return store.resolveMediaPath(currentWorld.value?.playerRole?.avatarPath || store.state.userAvatarPath || "");
  }
  const role = roleCards.value.find((item) => item.name === message.role || item.id === message.role);
  return store.resolveMediaPath(role?.avatarPath || "");
}

function messageTitle(message: MessageItem): string {
  return message.role || (message.roleType === "player" ? "用户" : "旁白");
}

function messageReactionText(message: MessageItem): string {
  const reaction = store.state.messageReactions[String(message.id)];
  if (reaction === "like") return "已点赞";
  if (reaction === "dislike") return "已点踩";
  return "";
}

function openRoleDetail(role: StoryRole) {
  roleDetail.value = role;
  roleParameterRawOpen.value = false;
  roleCopyHint.value = "";
}

function closeRoleDetail() {
  roleDetail.value = null;
  roleParameterRawOpen.value = false;
  roleCopyHint.value = "";
}

async function editCurrentWorld() {
  if (!currentWorld.value) return;
  await store.openWorldForEdit(currentWorld.value);
}

function buildRoleProfile(role: StoryRole): string {
  const parts = [
    `角色：${role.name || "未命名"}`,
    `类型：${roleTypeLabel(role)}`,
    `音色：${voiceModeLabel(role.voiceMode)}${role.voice ? ` / ${role.voice}` : ""}`,
    `设定：${role.description || "暂无"}`,
    `台词示例：${role.sample || "暂无"}`,
  ];
  if (role.parameterCardJson) {
    parts.push(`参数卡：${JSON.stringify(role.parameterCardJson, null, 2)}`);
  }
  return parts.join("\n");
}

function copyRoleProfile() {
  if (!roleDetail.value) return;
  store.copyMessageText(buildRoleProfile(roleDetail.value));
  roleCopyHint.value = "已复制角色资料";
}

function toggleChapterDetail() {
  chapterDetailOpen.value = !chapterDetailOpen.value;
}

function closeDebugDialog() {
  store.state.debugEndDialog = null;
}

function exitDebugMode() {
  stopVoiceRecognition();
  store.state.debugEndDialog = null;
  store.state.debugMode = false;
  store.setTab("create");
}

function toggleHistoryMode() {
  playMode.value = playMode.value === "history" ? "live" : "history";
}

function toggleTipsMode() {
  playMode.value = playMode.value === "tips" ? "live" : "tips";
}

function openChapterObjective() {
  chapterDetailOpen.value = true;
  playMode.value = "setting";
}

function openSettingMode() {
  playMode.value = playMode.value === "setting" ? "live" : "setting";
}

function messageVoiceTail(message: MessageItem): string {
  if (runtimeVoiceMessageKey.value !== messageUiKey(message) || !runtimeVoicePhase.value) return "";
  return runtimeVoiceIndicator.value;
}

function toggleInputMode() {
  inputMode.value = inputMode.value === "voice" ? "text" : "voice";
  if (inputMode.value === "text") {
    nextTick(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".play-textarea");
      textarea?.focus();
    });
  } else {
    stopVoiceRecognition();
  }
}

function openHall() {
  stopVoiceRecognition();
  store.setTab("hall");
}

function handleTopBackAction() {
  if (store.state.debugMode) {
    exitDebugMode();
    return;
  }
  openHall();
}

function stopVoiceRecognition() {
  if (speechRecognition) {
    try {
      speechRecognition.stop();
    } catch {
      // noop
    }
    speechRecognition = null;
  }
  if (mediaRecorder) {
    try {
      discardNextRecording = true;
      if (mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    } catch {
      // noop
    }
    mediaRecorder = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  mediaChunks = [];
  voiceListening.value = false;
}

async function transcribeVoiceBlob(blob: Blob) {
  voiceTranscribing.value = true;
  try {
    const audioBase64 = await fileToDataUrl(blob);
    const text = await store.transcribeRuntimeVoice(audioBase64, store.state.currentSessionId);
    if (!text) {
      store.state.notice = "语音识别未返回文本";
      return;
    }
    store.state.sendText = text;
    await submit();
  } catch (error: any) {
    store.state.notice = `语音识别失败: ${error?.message || "未知错误"}`;
  } finally {
    voiceTranscribing.value = false;
  }
}

function stopVoiceRecordingAndTranscribe() {
  const recorder = mediaRecorder;
  if (!recorder) return;
  try {
    recorder.stop();
  } catch (error: any) {
    voiceListening.value = false;
    store.state.notice = `结束录音失败: ${error?.message || "未知错误"}`;
  }
}

async function startVoiceRecognition() {
  if (!browserSpeechSupported.value) {
    inputMode.value = "text";
    store.state.notice = "当前浏览器暂不支持语音输入，已切换文字输入";
    nextTick(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".play-textarea");
      textarea?.focus();
    });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStream = stream;
    mediaChunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorder = recorder;
    recorder.onstart = () => {
      voiceListening.value = true;
    };
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        mediaChunks.push(event.data);
      }
    };
    recorder.onerror = () => {
      voiceListening.value = false;
      store.state.notice = "语音识别失败";
    };
    recorder.onstop = async () => {
      const chunks = mediaChunks.slice();
      mediaChunks = [];
      voiceListening.value = false;
      mediaRecorder = null;
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }
      if (discardNextRecording) {
        discardNextRecording = false;
        return;
      }
      if (!chunks.length) {
        store.state.notice = "录音内容为空";
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      await transcribeVoiceBlob(blob);
    };
    recorder.start();
  } catch (error: any) {
    inputMode.value = "text";
    voiceListening.value = false;
    store.state.notice = `无法开始录音: ${error?.message || "未知错误"}`;
  }
}

function handleVoicePrimary() {
  if (!canPlayerSpeak.value) {
    store.state.notice = playTurnHint.value || "当前还没轮到用户发言";
    return;
  }
  if (inputMode.value === "text") {
    void submit();
    return;
  }
  if (voiceTranscribing.value) return;
  if (voiceListening.value) {
    stopVoiceRecordingAndTranscribe();
    return;
  }
  startVoiceRecognition();
}

function onMiniAction(kind: "share" | "comment") {
  if (kind === "share") {
    store.copyMessageText(`${playTitle.value} ${playSubtitle.value}`.trim());
    store.state.notice = "已复制故事标题";
    return;
  }
  store.state.notice = "评论功能待接入";
}

function toggleFavorite() {
  store.state.notice = "收藏功能待接入";
}

function pickTip(option: string) {
  if (!canPlayerSpeak.value) {
    store.state.notice = playTurnHint.value || "当前还没轮到用户发言";
    return;
  }
  store.state.sendText = option;
  void submit();
}

onBeforeUnmount(() => {
  clearPressTimer();
  stopVoiceRecognition();
  stopRuntimeVoicePlayback();
  clearRuntimeVoiceIndicator();
});
</script>

<template>
  <section class="play-page">
    <div class="play-stage" :style="playStageStyle">
      <div class="play-stage__mask"></div>
      <div class="play-stage__shade"></div>

      <header class="play-head">
        <div class="play-head__lead">
          <button
            type="button"
            class="play-circle-btn play-circle-btn--back"
            :aria-label="store.state.debugMode ? '返回编辑' : '返回故事大厅'"
            @click="handleTopBackAction"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 18l-6-6 6-6"></path>
            </svg>
          </button>
          <div class="play-head__meta">
            <div class="play-head__eyebrow">{{ playTitle }}</div>
            <div class="play-head__sub">{{ playSubtitle }}</div>
          </div>
        </div>
        <div class="play-head__actions">
          <button type="button" class="play-circle-btn" :aria-label="autoVoice ? '静音' : '开启语音'" @click="autoVoice = !autoVoice">
            <svg v-if="autoVoice" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 10v4h4l5 4V6l-5 4H5z"></path>
              <path d="M18 9a4 4 0 010 6"></path>
              <path d="M20 7a7 7 0 010 10"></path>
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 10v4h4l5 4V6l-5 4H5z"></path>
              <path d="M18 9l-6 6"></path>
              <path d="M12 9l6 6"></path>
            </svg>
          </button>
        </div>
      </header>

      <div class="play-ai-mark">内容由 AI 生成</div>
      <div v-if="!autoVoice" class="play-entry-toast">静音进入</div>
      <div v-if="playMode === 'history'" class="play-mode-badge">历史模式</div>
      <div
        v-if="playMode !== 'history' && currentLiveFigurePath"
        class="play-figure-stage"
      >
        <div class="play-figure-stage__glow"></div>
        <div
          class="play-figure"
          :style="{ backgroundImage: `url(${currentLiveFigurePath})` }"
        ></div>
        <div class="play-figure-stage__fade"></div>
      </div>
      <div
        ref="messageViewport"
        class="play-thread"
        :class="{ 'play-thread--history': playMode === 'history', 'play-thread--single-mode': playMode !== 'history' }"
      >
        <div v-if="!displayMessages.length" class="play-empty">当前会话暂无消息，发送一句话开始。</div>
        <div v-else-if="playMode === 'history'" class="play-thread__history">
          <template v-for="message in displayMessages" :key="message.id">
            <article
              v-if="isRuntimeRetryMessage(message)"
              class="play-runtime-retry play-runtime-retry--history"
            >
              <div class="play-runtime-retry__title">{{ messageTitle(message) }}</div>
              <div class="play-runtime-retry__content">{{ message.content || "模型调用失败" }}</div>
              <button type="button" class="play-runtime-retry__button" @click="retryRuntimeMessage">
                {{ runtimeRetryLabel(message) }}
              </button>
            </article>
            <article
              v-else
              class="play-bubble-item"
              :class="{ 'play-bubble-item--player': message.roleType === 'player' }"
              @dblclick.stop="openMenu(message, $event)"
              @contextmenu.prevent.stop="openMenu(message, $event)"
              @pointerdown="handlePressStart(message, $event)"
              @pointerup="handlePressEnd"
              @pointerleave="handlePressEnd"
              @pointercancel="handlePressEnd"
            >
              <div v-if="message.roleType !== 'player'" class="play-bubble-avatar">
                <img v-if="messageAvatarPath(message)" :src="messageAvatarPath(message)" :alt="messageTitle(message)" />
                <span v-else>{{ messageTitle(message).slice(0, 1) }}</span>
              </div>

              <div class="play-bubble-wrap">
                <div class="play-bubble-title">{{ messageTitle(message) }}</div>
                <div class="play-bubble" :class="{ 'play-bubble--player': message.roleType === 'player' }">
                  <span>{{ message.content || "（空消息）" }}</span>
                  <span
                    v-if="messageVoiceTail(message)"
                    class="play-bubble-voice-tail"
                    :class="{ 'is-playing': runtimeVoicePhase === 'playing' }"
                  >
                    {{ messageVoiceTail(message) }}
                  </span>
                </div>
                <div v-if="messageReactionText(message)" class="play-bubble-reaction">{{ messageReactionText(message) }}</div>
              </div>

              <div v-if="message.roleType === 'player'" class="play-bubble-avatar">
                <img v-if="messageAvatarPath(message)" :src="messageAvatarPath(message)" :alt="messageTitle(message)" />
                <span v-else>{{ messageTitle(message).slice(0, 1) }}</span>
              </div>
            </article>
          </template>
        </div>
        <div v-else class="play-thread__single">
          <div class="play-thread__single-stage">
            <div class="play-live-stack">
              <article
                v-if="currentLiveMessage && isRuntimeRetryMessage(currentLiveMessage)"
                class="play-live-card play-live-card--runtime-retry"
              >
                <div class="play-live-card__title">{{ messageTitle(currentLiveMessage) }}</div>
                <div class="play-runtime-retry__content">{{ currentLiveMessage.content || "模型调用失败" }}</div>
                <button type="button" class="play-runtime-retry__button" @click="retryRuntimeMessage">
                  {{ runtimeRetryLabel(currentLiveMessage) }}
                </button>
              </article>
              <article
                v-else-if="currentLiveMessage"
                class="play-live-card"
                :class="{ 'play-live-card--player': currentLiveMessage.roleType === 'player' }"
                @dblclick.stop="openMenu(currentLiveMessage, $event)"
                @contextmenu.prevent.stop="openMenu(currentLiveMessage, $event)"
                @pointerdown="handlePressStart(currentLiveMessage, $event)"
                @pointerup="handlePressEnd"
                @pointerleave="handlePressEnd"
                @pointercancel="handlePressEnd"
              >
                <div class="play-live-card__title">{{ messageTitle(currentLiveMessage) }}</div>
                <div class="play-live-card__body">
                  <span>{{ currentLiveMessage.content || "（空消息）" }}</span>
                  <span
                    v-if="messageVoiceTail(currentLiveMessage)"
                    class="play-bubble-voice-tail"
                    :class="{ 'is-playing': runtimeVoicePhase === 'playing' }"
                  >
                    {{ messageVoiceTail(currentLiveMessage) }}
                  </span>
                </div>
                <div v-if="messageReactionText(currentLiveMessage)" class="play-bubble-reaction play-bubble-reaction--live">
                  {{ messageReactionText(currentLiveMessage) }}
                </div>
              </article>
              <button
                v-if="playMode !== 'history' && playMode !== 'setting' && playMode !== 'tips' && tipOptions.length"
                type="button"
                class="play-tip-fab"
                @click="toggleTipsMode"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div v-if="debugLoading" class="play-loading-mask">
          <div class="play-loading-card">
            <div class="play-loading-spinner"></div>
            <div class="play-loading-title">进入调试中</div>
            <div class="play-loading-sub">{{ debugLoadingStage }}</div>
          </div>
        </div>
      </div>

      <section v-if="playMode === 'setting'" class="play-sheet play-sheet--setting">
        <div class="play-sheet__head play-sheet__head--center">
          <div>
            <div class="play-sheet__title">{{ playTitle }}</div>
            <div class="play-sheet__sub">故事简介：{{ currentWorld?.intro || store.state.worldIntro || "暂无简介" }}</div>
          </div>
          <button type="button" class="play-sheet__close" @click="openSettingMode">关闭</button>
        </div>

        <div class="play-sheet__label">角色列表</div>
        <div class="play-role-strip">
          <button
            v-for="role in roleCards"
            :key="role.id"
            type="button"
            class="play-role-pill"
            :class="{ 'play-role-pill--active': settingSelectedRole?.id === role.id }"
            @click="settingRoleId = role.id"
          >
            <div class="play-role-pill__avatar">
              <img v-if="role.avatarPath" :src="store.resolveMediaPath(role.avatarPath)" :alt="role.name" />
              <span v-else>{{ role.name.slice(0, 1) }}</span>
            </div>
            <span class="play-role-pill__name">{{ role.name }}</span>
          </button>
        </div>

        <div v-if="!allowRoleView" class="play-inline-card">
          创作者未开放“他人可查看角色设定”，当前仅展示基础信息。
        </div>
        <div v-else-if="settingSelectedRole" class="play-inline-card">
          <div class="play-inline-card__title">{{ settingSelectedRole.name }}</div>
          <div class="play-inline-card__text">角色类型：{{ roleTypeLabel(settingSelectedRole) }}</div>
          <div class="play-inline-card__text">角色设定：{{ settingSelectedRole.description || "暂无角色设定" }}</div>
          <div class="play-inline-card__text">角色音色：{{ settingSelectedRole.voice || "未绑定音色" }}</div>
          <div v-if="settingSelectedRole.sample" class="play-inline-card__text">台词示例：{{ settingSelectedRole.sample }}</div>
          <button type="button" class="play-link-text" @click="openRoleDetail(settingSelectedRole)">查看角色详情</button>
        </div>

        <button type="button" class="play-link-row" @click="toggleChapterDetail">
          <span>故事设定</span>
          <span>{{ chapterDetailOpen ? "收起 >" : ">" }}</span>
        </button>
        <div v-if="chapterDetailOpen" class="play-inline-card">
          <div class="play-inline-card__text">故事背景：{{ currentWorld?.settings?.globalBackground || store.state.globalBackground || "暂无世界背景" }}</div>
          <div class="play-inline-card__text">章节：{{ currentChapter?.title || "当前章节" }}</div>
          <div class="play-inline-card__text">开场白：{{ chapterOpeningDisplay }}</div>
          <div class="play-inline-card__text">章节编排：仅供编排师内部使用，游玩时不直接展示。</div>
          <div class="play-inline-card__text">章节进入条件：{{ chapterEntryText || "无" }}</div>
          <div class="play-inline-card__text">章节完成条件：{{ chapterCompletionText }}</div>
          <pre class="play-state-pre">{{ statePreviewText }}</pre>
        </div>

        <button type="button" class="play-link-row" @click="settingModePickerOpen = !settingModePickerOpen">
          <span>对话模式</span>
          <span>基础模式 &gt;</span>
        </button>
        <div v-if="settingModePickerOpen" class="play-inline-card">
          <div class="play-inline-card__title">✓ 基础模式（当前唯一）</div>
          <div class="play-inline-card__text">当前仅支持基础模式，后续可扩展其他对话模式。</div>
        </div>
      </section>

      <section v-if="playMode === 'tips'" class="play-sheet play-sheet--tips">
        <div class="play-sheet__title">AI 提示</div>
        <button v-for="option in tipOptions" :key="option" type="button" class="play-tip-option" @click="pickTip(option)">{{ option }}</button>
        <button type="button" class="play-tip-back" @click="toggleTipsMode">返回</button>
      </section>

      <section v-if="activeMiniGame && playMode !== 'setting' && playMode !== 'tips'" class="play-mini-game-panel">
        <div class="play-mini-game-panel__head">
          <div>
            <div class="play-mini-game-panel__title">{{ activeMiniGame.displayName }}</div>
            <div class="play-mini-game-panel__meta">第 {{ activeMiniGame.round || 1 }} 轮 · {{ activeMiniGame.phase || "进行中" }}</div>
          </div>
          <div class="play-mini-game-panel__status">{{ activeMiniGame.status || "active" }}</div>
        </div>
        <div v-if="activeMiniGame.ruleSummary" class="play-mini-game-panel__hint">{{ activeMiniGame.ruleSummary }}</div>
        <div v-if="miniGameSummaryItems.length" class="play-mini-game-panel__state">
          <div
            v-for="item in miniGameSummaryItems"
            :key="item.key"
            class="play-mini-game-panel__state-item"
          >
            <span class="play-mini-game-panel__state-key">{{ item.key }}</span>
            <span class="play-mini-game-panel__state-value">{{ item.value }}</span>
          </div>
        </div>
        <div class="play-mini-game-panel__actions">
          <button
            v-for="option in activeMiniGame.playerOptions"
            :key="String(option.action_id || option.label || option.desc || '')"
            type="button"
            class="play-mini-game-panel__action"
            @click="submitMiniGameAction(String(option.label || option.action_id || ''))"
          >
            {{ option.label || option.action_id }}
          </button>
        </div>
        <div class="play-mini-game-panel__controls">
          <button
            v-for="action in miniGameControlOptions"
            :key="action"
            type="button"
            class="play-mini-game-panel__control"
            @click="submitMiniGameAction(action)"
          >
            {{ action }}
          </button>
        </div>
      </section>

      <div class="play-story-footer">
        <div class="play-story-main">
          <button
            v-if="chapterObjectivePreview && playMode !== 'history' && playMode !== 'setting' && playMode !== 'tips'"
            type="button"
            class="play-objective-chip play-story-objective"
            :title="chapterConditionHint"
            @click="openChapterObjective"
          >
            当前目标：{{ chapterObjectivePreview }}
          </button>
          <button type="button" class="play-story-entry" @click="openSettingMode">
            <span class="play-story-entry__label">{{ playTitle }}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6"></path>
            </svg>
          </button>
          <div class="play-story-sub">{{ playHandle }}</div>
        </div>
        <div class="play-story-actions">
          <button type="button" class="play-story-action" @click="toggleFavorite">
            <span class="play-story-action__icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 20s-6.7-4.4-9-8.2C1.3 8.9 2.5 5.5 5.8 4.5c2-.6 4 .1 5.2 1.7 1.2-1.6 3.2-2.3 5.2-1.7 3.3 1 4.5 4.4 2.8 7.3C18.7 15.6 12 20 12 20z"></path>
              </svg>
            </span>
            <span>{{ playLikeCount }}</span>
          </button>
          <button type="button" class="play-story-action" @click="onMiniAction('share')">
            <span class="play-story-action__icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 5h5v5"></path>
                <path d="M10 14L19 5"></path>
                <path d="M19 14v5H5V5h5"></path>
              </svg>
            </span>
            <span>分享</span>
          </button>
          <button type="button" class="play-story-action" @click="onMiniAction('comment')">
            <span class="play-story-action__icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 6h14a2 2 0 012 2v7a2 2 0 01-2 2H9l-4 3v-3H5a2 2 0 01-2-2V8a2 2 0 012-2z"></path>
              </svg>
            </span>
            <span>评论</span>
          </button>
          <button type="button" class="play-story-action" @click="toggleHistoryMode">
            <span class="play-story-action__icon">
              <svg v-if="playMode === 'history'" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 7l-5 5 5 5"></path>
                <path d="M19 12H6"></path>
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8"></circle>
                <path d="M12 8v5l3 2"></path>
              </svg>
            </span>
            <span>{{ playMode === "history" ? "返回" : "历史" }}</span>
          </button>
        </div>
      </div>

      <div class="play-input-shell" :class="{ 'play-input-shell--text': inputMode === 'text' }">
        <div v-if="playTurnHint" class="play-turn-hint">{{ playTurnHint }}</div>
        <template v-if="inputMode === 'text'">
          <div class="play-text-bar">
            <textarea v-model="store.state.sendText" class="play-textarea" rows="1" :placeholder="playInputPlaceholder" :disabled="!canPlayerSpeak"></textarea>
            <button type="button" class="play-mini-round" @click="toggleInputMode">声</button>
            <button type="button" class="play-mini-round" @click="onMiniAction('comment')">＋</button>
            <button type="button" class="play-send-btn" :disabled="!canPlayerSpeak" @click="submit">发送</button>
          </div>
        </template>
        <template v-else>
          <div class="play-voice-bar">
            <button type="button" class="play-voice-btn" :disabled="!canPlayerSpeak" @click="handleVoicePrimary">
              {{ voiceTranscribing ? "识别处理中..." : voiceListening ? "录音中，点击结束" : playInputPlaceholder }}
            </button>
            <button type="button" class="play-mini-round" @click="toggleInputMode">键</button>
            <button type="button" class="play-mini-round" @click="onMiniAction('share')">＋</button>
          </div>
        </template>
      </div>
    </div>

    <div v-if="menuOpen" class="message-menu-backdrop" @click.self="closeMenu">
      <div class="message-menu play-message-menu" :style="{ left: `${menuX}px`, top: `${menuY}px` }">
        <div class="message-menu-title">{{ menuMessage?.role || "消息操作" }}</div>
        <div class="tiny" style="margin-bottom:8px; color:#c0cee3;">{{ menuVisibleHint || "请选择操作" }}</div>
        <button class="button block" type="button" @click="menuCopy">复制</button>
        <button class="button block" type="button" @click="menuReplay">重听</button>
        <button class="button block" type="button" @click="menuLike">点赞</button>
        <button class="button block" type="button" @click="menuDislike">点踩</button>
        <button class="button block" type="button" @click="menuReset">取消评价</button>
        <button class="button accent block" type="button" @click="menuRewrite">改写</button>
      </div>
    </div>

    <div v-if="store.state.debugEndDialog" class="modal-backdrop" @click.self="closeDebugDialog">
      <div class="modal-panel" style="width:min(100%,420px);">
        <div class="modal-header">
          <button class="button small" type="button" @click="closeDebugDialog">继续查看</button>
          <div style="font-weight:900;">章节调试结束</div>
          <span class="tiny">{{ store.state.debugEndDialog }}</span>
        </div>
        <div class="modal-body">
          <div class="surface section-block surface-soft">
            <div style="font-weight:900; font-size:18px;">{{ store.state.debugEndDialog }}</div>
            <div class="subtle" style="margin-top:8px;">
              {{ store.state.debugEndDialog === '已完结' ? '已没有下一个章节。可返回编辑继续补章节。' : store.state.debugEndDialog === '进入自由剧情' ? '当前章节已完成。继续查看后将进入自由剧情，编排师会继续推进故事。' : '当前调试已结束。' }}
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="button" type="button" @click="closeDebugDialog">继续查看</button>
          <button class="button primary" type="button" @click="exitDebugMode">返回编辑</button>
        </div>
      </div>
    </div>

    <div v-if="roleDetail" class="modal-backdrop" @click.self="closeRoleDetail">
      <div class="modal-panel" style="width:min(100%,560px);">
        <div class="modal-header">
          <button class="button small" type="button" @click="closeRoleDetail">关闭</button>
          <div style="font-weight:900;">角色详情</div>
          <span class="tiny">{{ roleDetail ? roleTypeLabel(roleDetail) : "" }}</span>
        </div>
        <div class="modal-body" v-if="roleDetail">
          <div class="detail-card">
            <div class="detail-avatar">
              <img v-if="roleDetail.avatarPath" :src="store.resolveMediaPath(roleDetail.avatarPath)" :alt="roleDetail.name" />
              <span v-else>{{ roleDetail.name?.slice(0, 1) || "角" }}</span>
            </div>
            <div class="detail-meta">
              <div class="row" style="gap:8px; align-items:center;">
                <strong style="font-size:20px;">{{ roleDetail.name }}</strong>
                <span class="chip">{{ roleTypeLabel(roleDetail) }}</span>
              </div>
              <div class="subtle">{{ roleDetail.voice || "未绑定音色" }}</div>
              <div class="tiny" v-if="roleDetail.voiceMode">绑定模式：{{ voiceModeLabel(roleDetail.voiceMode) }}</div>
            </div>
          </div>

          <div class="dialog-stack" style="margin-top:14px;">
            <div class="surface section-block surface-soft">
              <div class="tiny">角色设定</div>
              <div style="white-space:pre-wrap; margin-top:6px;">{{ roleDetail.description || "暂无角色设定" }}</div>
            </div>
            <div class="surface section-block surface-soft">
              <div class="tiny">台词示例</div>
              <div style="white-space:pre-wrap; margin-top:6px;">{{ roleDetail.sample || "暂无台词示例" }}</div>
            </div>
            <div class="surface section-block surface-soft">
              <div class="tiny">参数卡</div>
              <div v-if="roleDetail.parameterCardJson" class="dialog-stack" style="margin-top:8px;">
                <div class="row-between">
                  <div class="tiny">已结构化展开，可切回原文核对</div>
                  <button class="button small" type="button" @click="roleParameterRawOpen = !roleParameterRawOpen">
                    {{ roleParameterRawOpen ? "收起原文" : "查看原文" }}
                  </button>
                </div>
                <div class="param-grid">
                  <div
                    v-for="item in parameterCardEntries(roleDetail.parameterCardJson)"
                    :key="item.label"
                    class="param-item"
                  >
                    <div class="tiny">{{ item.label }}</div>
                    <div class="param-value">{{ item.value }}</div>
                  </div>
                </div>
                <pre v-if="roleParameterRawOpen" class="detail-pre">{{ JSON.stringify(roleDetail.parameterCardJson, null, 2) }}</pre>
              </div>
              <pre v-else class="detail-pre">无参数卡</pre>
            </div>
            <div class="surface section-block surface-soft">
              <div class="tiny">音色信息</div>
              <div class="dialog-stack" style="margin-top:6px;">
                <div class="tiny">预设：{{ roleDetail.voicePresetId || "无" }}</div>
                <div class="tiny">参考音频：{{ roleDetail.voiceReferenceAudioName || roleDetail.voiceReferenceAudioPath || "无" }}</div>
                <div class="tiny">参考文本：{{ roleDetail.voiceReferenceText || "无" }}</div>
                <div class="tiny">提示词：{{ roleDetail.voicePromptText || "无" }}</div>
                <div class="tiny">
                  混合音色：
                  {{ roleDetail.voiceMixVoices?.length ? roleDetail.voiceMixVoices.map((item) => `${item.voiceId}(${item.weight.toFixed(1)})`).join("、") : "无" }}
                </div>
              </div>
            </div>
          </div>
          <div v-if="roleCopyHint" class="tiny" style="margin-top:10px;">{{ roleCopyHint }}</div>
        </div>
        <div class="modal-actions">
          <button class="button" type="button" @click="copyRoleProfile">复制角色资料</button>
          <button class="button" type="button" @click="editCurrentWorld">编辑当前故事</button>
          <button class="button primary" type="button" @click="closeRoleDetail">知道了</button>
        </div>
      </div>
    </div>
  </section>
</template>
