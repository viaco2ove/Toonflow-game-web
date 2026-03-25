<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import type { MessageItem, RoleParameterCard, StoryRole } from "../types/toonflow";

const store = useToonflowStore();
const messages = computed(() => store.state.messages);
const session = computed(() => store.state.sessionDetail);
const currentWorld = computed(() => session.value?.world || null);
const debugChapterIndex = computed(() => store.getDebugChapterIndex());
const currentChapter = computed(() => session.value?.chapter || store.state.chapters[debugChapterIndex.value] || null);
const debugChapter = computed(() => store.state.chapters[debugChapterIndex.value] || null);
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
  const world = currentWorld.value;
  const seen = new Set<string>();
  const list: StoryRole[] = [];
  const pushRole = (role?: StoryRole | null) => {
    if (!role || !role.name) return;
    const key = role.id || `${role.roleType}:${role.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(role);
  };
  pushRole(world?.playerRole || null);
  pushRole(world?.narratorRole || null);
  (world?.settings?.roles || []).forEach((role) => pushRole(role));
  return list;
});

const playMode = ref<"live" | "history" | "tips" | "setting">("live");
const inputMode = ref<"voice" | "text">("voice");
const autoVoice = ref(true);
const voiceListening = ref(false);
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
const messageViewport = ref<HTMLElement | null>(null);
let speechRecognition: any = null;

const displayMessages = computed(() => (playMode.value === "history" ? messages.value : messages.value.slice(-1)));
const latestSpeakableMessage = computed(() =>
  [...messages.value].reverse().find((message) => message.roleType !== "player" && message.content.trim()) || null,
);
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
  const chapterTitle = currentChapter.value?.title || store.state.debugChapterTitle || "当前章节";
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
  return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
});
const lastAutoReadKey = ref("");

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
    lastAutoReadKey.value = "";
  },
);

watch(autoVoice, (enabled) => {
  if (!enabled && typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
});

watch(
  () => [
    store.state.currentSessionId,
    autoVoice.value,
    latestSpeakableMessage.value?.id,
    latestSpeakableMessage.value?.createTime,
    latestSpeakableMessage.value?.content,
  ],
  () => {
    if (!autoVoice.value || playMode.value === "setting" || playMode.value === "tips") return;
    const message = latestSpeakableMessage.value;
    if (!message) return;
    const key = `${store.state.currentSessionId}_${message.id}_${message.createTime}`;
    if (lastAutoReadKey.value === key) return;
    lastAutoReadKey.value = key;
    replay(message.content);
  },
  { flush: "post" },
);

watch(playMode, (mode) => {
  if (mode !== "setting") {
    settingModePickerOpen.value = false;
  }
  if (mode === "tips" || mode === "setting") {
    closeMenu();
  }
});

function closeMenu() {
  menuOpen.value = false;
  menuMessage.value = null;
  menuVisibleHint.value = "";
}

function openMenu(message: MessageItem, event: MouseEvent | PointerEvent) {
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
  await store.sendMessage();
  playMode.value = "live";
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
  if (typeof input === "string") return input.trim();
  if (typeof input === "boolean") return input ? "true" : "false";
  if (Array.isArray(input)) return input.map((item) => formatConditionText(item)).filter(Boolean).join(" 且 ");
  if (typeof input === "object") {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }
  return String(input);
}

function replay(content: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    menuVisibleHint.value = "当前浏览器不支持朗读";
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(content);
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

function menuCopy() {
  if (!menuMessage.value) return;
  copy(menuMessage.value.content);
  closeMenu();
}

function menuReplay() {
  if (!menuMessage.value) return;
  replay(menuMessage.value.content);
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

function openSettingMode() {
  playMode.value = playMode.value === "setting" ? "live" : "setting";
}

function handleStatusAction() {
  if (store.state.debugMode) {
    playMode.value = playMode.value === "setting" ? "live" : "setting";
    return;
  }
  void store.refreshCurrentSession();
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

function stopVoiceRecognition() {
  if (speechRecognition) {
    try {
      speechRecognition.stop();
    } catch {
      // noop
    }
    speechRecognition = null;
  }
  voiceListening.value = false;
}

function startVoiceRecognition() {
  if (!browserSpeechSupported.value) {
    inputMode.value = "text";
    store.state.notice = "当前浏览器暂不支持语音输入，已切换文字输入";
    nextTick(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".play-textarea");
      textarea?.focus();
    });
    return;
  }
  const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) return;
  const recognition = new SpeechRecognitionCtor();
  speechRecognition = recognition;
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.onstart = () => {
    voiceListening.value = true;
  };
  recognition.onresult = async (event: any) => {
    const text = Array.from(event.results || [])
      .map((result: any) => result?.[0]?.transcript || "")
      .join("")
      .trim();
    if (!text) return;
    store.state.sendText = text;
    await submit();
  };
  recognition.onerror = () => {
    voiceListening.value = false;
    store.state.notice = "语音识别失败";
  };
  recognition.onend = () => {
    voiceListening.value = false;
    speechRecognition = null;
  };
  recognition.start();
}

function handleVoicePrimary() {
  if (inputMode.value === "text") {
    void submit();
    return;
  }
  if (voiceListening.value) {
    stopVoiceRecognition();
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
  store.state.sendText = option;
  void submit();
}

onBeforeUnmount(() => {
  clearPressTimer();
  stopVoiceRecognition();
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
});
</script>

<template>
  <section class="play-page">
    <div class="play-stage" :style="playStageStyle">
      <div class="play-stage__mask"></div>
      <div class="play-stage__shade"></div>

      <header class="play-head">
        <div class="play-head__meta">
          <button type="button" class="play-title-btn" @click="openSettingMode">{{ playTitle }} &gt;</button>
          <div class="play-head__sub">{{ playSubtitle }}</div>
        </div>
        <div class="play-head__actions">
          <button type="button" class="play-circle-btn" aria-label="进入故事大厅" @click="openHall">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6"></circle>
              <path d="M20 20l-4-4"></path>
            </svg>
          </button>
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
      <button type="button" class="play-fav-btn" @click="toggleFavorite">❤</button>
      <div v-if="!autoVoice" class="play-entry-toast">静音进入</div>
      <div v-if="playMode === 'history'" class="play-mode-badge">历史模式</div>
      <div ref="messageViewport" class="play-thread" :class="{ 'play-thread--history': playMode === 'history' }">
        <div v-if="!displayMessages.length" class="play-empty">当前会话暂无消息，发送一句话开始。</div>
        <div v-else class="play-thread__inner" :class="{ 'play-thread__inner--history': playMode === 'history' }">
          <article
            v-for="message in displayMessages"
            :key="message.id"
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
                {{ message.content || "（空消息）" }}
              </div>
              <div v-if="messageReactionText(message)" class="play-bubble-reaction">{{ messageReactionText(message) }}</div>
            </div>

            <div v-if="message.roleType === 'player'" class="play-bubble-avatar">
              <img v-if="messageAvatarPath(message)" :src="messageAvatarPath(message)" :alt="messageTitle(message)" />
              <span v-else>{{ messageTitle(message).slice(0, 1) }}</span>
            </div>
          </article>
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
          <div class="play-inline-card__text">章节内容：{{ chapterContentText }}</div>
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

      <div class="play-story-footer">
        <div class="play-story-main">
          <button type="button" class="play-story-entry" @click="store.state.debugMode ? exitDebugMode() : openSettingMode()">
            {{ store.state.debugMode ? "返回编辑" : `${playTitle} >` }}
          </button>
          <div class="play-story-sub">{{ playHandle }}</div>
        </div>
        <div class="play-story-actions">
          <button type="button" class="play-story-action" @click="toggleFavorite">
            <span class="play-story-action__icon">❤</span>
            <span>{{ playLikeCount }}</span>
          </button>
          <button type="button" class="play-story-action" @click="onMiniAction('share')">
            <span class="play-story-action__icon">↗</span>
            <span>分享</span>
          </button>
          <button type="button" class="play-story-action" @click="onMiniAction('comment')">
            <span class="play-story-action__icon">💬</span>
            <span>评论</span>
          </button>
          <button type="button" class="play-story-action" @click="toggleHistoryMode">
            <span class="play-story-action__icon">{{ playMode === "history" ? "↩" : "◷" }}</span>
            <span>{{ playMode === "history" ? "返回" : "历史" }}</span>
          </button>
        </div>
      </div>

      <div class="play-input-shell" :class="{ 'play-input-shell--text': inputMode === 'text' }">
        <div class="play-footer-switches">
          <button type="button" class="play-mini-btn" @click="toggleTipsMode">提示</button>
          <button type="button" class="play-mini-btn" @click="handleStatusAction">{{ store.state.debugMode ? "状态" : "刷新" }}</button>
        </div>
        <template v-if="inputMode === 'text'">
          <div class="play-text-bar">
            <textarea v-model="store.state.sendText" class="play-textarea" rows="1" placeholder="输入一句话开始故事"></textarea>
            <button type="button" class="play-mini-round" @click="toggleInputMode">声</button>
            <button type="button" class="play-mini-round" @click="onMiniAction('comment')">＋</button>
            <button type="button" class="play-send-btn" @click="submit">发送</button>
          </div>
        </template>
        <template v-else>
          <div class="play-voice-bar">
            <button type="button" class="play-voice-btn" @click="handleVoicePrimary">
              {{ voiceListening ? "识别中，点击结束" : "按住说话" }}
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
              {{ store.state.debugEndDialog === '已完结' ? '已没有下一个章节。可返回编辑继续补章节。' : '当前调试已结束。' }}
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
                <div class="tiny">模型配置：{{ roleDetail.voiceConfigId ?? "无" }}</div>
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
