<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import StoryCover from "./StoryCover.vue";
import type { MessageItem, RoleParameterCard, StoryRole } from "../types/toonflow";

const store = useToonflowStore();
const messages = computed(() => store.state.messages);
const session = computed(() => store.state.sessionDetail);
const currentWorld = computed(() => session.value?.world || null);
const currentChapter = computed(() => session.value?.chapter || store.state.chapters.find((item) => item.id === debugChapterIndex.value) || null);
const debugChapterIndex = computed(() => store.getDebugChapterIndex());
const debugChapter = computed(() => store.state.chapters[debugChapterIndex.value] || null);
const chapterBackgroundPath = computed(() => currentChapter.value?.backgroundPath || store.state.chapterBackground || currentWorld.value?.settings?.coverBgPath || currentWorld.value?.settings?.coverPath || "");
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
const roleDetail = ref<StoryRole | null>(null);
const roleParameterRawOpen = ref(false);
const chapterDetailOpen = ref(true);
const menuOpen = ref(false);
const menuMessage = ref<MessageItem | null>(null);
const menuX = ref(0);
const menuY = ref(0);
const pressTimer = ref<number | null>(null);
const menuVisibleHint = ref("");

function closeMenu() {
  menuOpen.value = false;
  menuMessage.value = null;
  menuVisibleHint.value = "";
}

function openMenu(message: MessageItem, event: MouseEvent | PointerEvent) {
  menuMessage.value = message;
  menuX.value = event.clientX;
  menuY.value = event.clientY;
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
}

function rewrite(content: string) {
  store.state.sendText = `请改写以下内容：\n${content}\n`;
  store.state.activeTab = "play";
  nextTick(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(".play-input textarea");
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

function openRoleDetail(role: StoryRole) {
  roleDetail.value = role;
  roleParameterRawOpen.value = false;
}

function closeRoleDetail() {
  roleDetail.value = null;
  roleParameterRawOpen.value = false;
}

function toggleChapterDetail() {
  chapterDetailOpen.value = !chapterDetailOpen.value;
}

function debugPrevChapter() {
  store.jumpDebugChapter(-1);
}

function debugNextChapter() {
  store.jumpDebugChapter(1);
}

function closeDebugDialog() {
  store.state.debugEndDialog = null;
}

function exitDebugMode() {
  store.state.debugEndDialog = null;
  store.state.debugMode = false;
  store.setTab("create");
}

onBeforeUnmount(() => {
  clearPressTimer();
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
});
</script>

<template>
  <section class="card section">
    <div class="row-between">
      <div>
        <h2 class="section-title">游玩</h2>
        <div class="subtle">
          <span v-if="store.state.debugMode">调试模式</span>
          <span v-else>{{ session?.world?.name || "会话中" }}</span>
        </div>
      </div>
      <div class="row">
        <button class="button small" type="button" @click="store.refreshCurrentSession">刷新状态</button>
        <button class="button small" type="button" @click="store.state.debugMode ? (store.state.debugMode=false, store.setTab('create')) : store.startDebugCurrentChapter()">调试</button>
      </div>
    </div>
  </section>

  <section class="card section stack-gap">
    <div class="row-between">
      <div>
        <div class="section-title" style="font-size:16px; margin-bottom:6px;">章节设定</div>
        <div class="subtle">{{ currentWorld?.name || "当前故事" }}</div>
      </div>
      <div class="row">
        <div class="chip" v-if="currentChapter">{{ currentChapter.title || "当前章节" }}</div>
        <button class="button small" type="button" @click="toggleChapterDetail">{{ chapterDetailOpen ? "收起" : "展开" }}</button>
      </div>
    </div>
    <div v-if="chapterDetailOpen" class="dialog-stack">
      <StoryCover
        :title="currentChapter?.title || '当前章节'"
        :coverPath="chapterBackgroundPath"
        emptyText="暂无章节背景"
        height="240px"
      />

      <div class="card section soft">
        <div class="tiny">章节开场白</div>
        <div class="subtle" style="margin-top:6px;">发言角色：{{ currentChapter?.openingRole || "旁白" }}</div>
        <div style="white-space:pre-wrap; margin-top:8px;">{{ currentChapter?.openingText || store.state.chapterOpeningLine || "暂无开场白" }}</div>
      </div>

      <div class="grid-2">
        <div class="card section soft">
          <div class="tiny">当前章节内容</div>
          <div style="white-space:pre-wrap; margin-top:6px;">{{ currentChapter?.content || store.state.chapterContent || "暂无章节内容" }}</div>
        </div>
        <div class="card section soft">
          <div class="tiny">章节完成条件</div>
          <div style="white-space:pre-wrap; margin-top:6px;">{{ chapterCompletionText }}</div>
        </div>
      </div>

      <div class="card section soft">
        <div class="tiny">章节进入条件</div>
        <div style="white-space:pre-wrap; margin-top:6px;">{{ chapterEntryText || "无" }}</div>
      </div>

      <div class="card section soft">
        <div class="row-between" style="margin-bottom:10px;">
          <div>
            <div class="tiny">世界设定</div>
            <div class="subtle" style="margin-top:4px;">{{ currentWorld?.intro || store.state.worldIntro || "暂无简介" }}</div>
          </div>
          <div class="row">
            <span class="chip" :class="{ active: currentWorld?.settings?.allowRoleView !== false }">角色可见</span>
            <span class="chip" :class="{ active: currentWorld?.settings?.allowChatShare !== false }">聊天可分享</span>
          </div>
        </div>
        <div style="white-space:pre-wrap;">{{ currentWorld?.settings?.globalBackground || store.state.globalBackground || "暂无世界背景" }}</div>
      </div>

      <div class="card section soft">
        <div class="row-between" style="margin-bottom:10px;">
          <div>
            <div class="tiny">章节状态</div>
            <div class="subtle" style="margin-top:4px;">调试态与正式态的区别会直接显示在这里</div>
          </div>
          <div class="row">
            <span v-for="item in chapterStatusItems" :key="item.label" class="chip">{{ item.label }}：{{ item.value }}</span>
          </div>
        </div>
        <div class="tiny">当前章节完成条件显示：{{ currentChapter?.showCompletionCondition === false ? "隐藏" : "可见" }}</div>
        <pre class="detail-pre" style="margin-top:10px;">{{ chapterConditionHint }}</pre>
      </div>

      <div class="card section soft">
        <div class="row-between" style="margin-bottom:10px;">
          <div>
            <div class="tiny">角色卡</div>
            <div class="subtle" style="margin-top:4px;">当前故事内的用户、旁白与 NPC 角色</div>
          </div>
          <div class="chip">{{ roleCards.length }} 个角色</div>
        </div>
        <div v-if="roleCards.length" class="role-grid">
          <button v-for="role in roleCards" :key="role.id" type="button" class="role-card role-card-button" @click="openRoleDetail(role)">
            <div class="role-head">
              <div class="role-avatar">
                <img v-if="role.avatarPath" :src="role.avatarPath" :alt="role.name" />
                <span v-else>{{ role.name?.slice(0, 1) || "角" }}</span>
              </div>
              <div class="role-info">
                <div class="row" style="gap:8px;">
                  <strong>{{ role.name }}</strong>
                  <span class="chip">{{ roleTypeLabel(role) }}</span>
                </div>
                <div class="tiny">{{ role.voice || "未绑定音色" }}</div>
              </div>
            </div>
            <div class="role-desc">{{ role.description || "暂无角色设定" }}</div>
          </button>
        </div>
        <div v-else class="empty" style="padding:18px 12px;">当前故事还没有角色信息</div>
      </div>
    </div>
  </section>

  <section class="card section stack-gap" v-if="store.state.debugMode">
    <div class="chip active">调试缓存，不会持久化</div>
    <div class="row-between">
      <div>
        <div class="subtle">章节：{{ store.state.debugChapterTitle || "当前章节" }}</div>
        <div class="tiny" v-if="debugChapter">进入条件 / 结束条件会按当前章节判断</div>
      </div>
      <div class="row">
        <button class="button small" type="button" @click="debugPrevChapter">上一章</button>
        <button class="button small" type="button" @click="debugNextChapter">下一章</button>
      </div>
    </div>
    <pre class="textarea" style="white-space:pre-wrap; margin:0;">{{ store.state.debugStatePreview }}</pre>
  </section>

  <section class="stack-gap">
    <div v-if="!messages.length" class="card empty">尚无消息</div>
    <article
      v-for="message in messages"
      :key="message.id"
      class="card section message-card"
      @dblclick.stop="openMenu(message, $event)"
      @contextmenu.prevent.stop="openMenu(message, $event)"
      @pointerdown="handlePressStart(message, $event)"
      @pointerup="handlePressEnd"
      @pointerleave="handlePressEnd"
      @pointercancel="handlePressEnd"
    >
      <div class="row-between">
        <div class="chip" :class="{ active: message.roleType === 'player' }">
          {{ message.role || (message.roleType === "player" ? "用户" : "旁白") }}
        </div>
        <div class="row">
          <button class="button small" type="button" @click.stop="copy(message.content)">复制</button>
          <button class="button small" type="button" @click.stop="like(message.id)">点赞</button>
          <button class="button small" type="button" @click.stop="dislike(message.id)">点踩</button>
        </div>
      </div>
      <p style="white-space:pre-wrap; margin:10px 0 0;">{{ message.content }}</p>
      <div v-if="store.state.messageReactions[String(message.id)]" class="tiny" style="margin-top:8px;">
        当前评价：{{ store.state.messageReactions[String(message.id)] === 'like' ? '点赞' : '点踩' }}
      </div>
    </article>
  </section>

  <section class="card section stack-gap play-input" style="position:sticky; bottom:72px;">
    <textarea v-model="store.state.sendText" class="textarea" rows="3" placeholder="输入一句话开始对话"></textarea>
    <div class="row-between">
      <div class="subtle">双击 / 长按消息可打开操作菜单</div>
      <button class="button primary" type="button" @click="submit">发送</button>
    </div>
  </section>

  <div v-if="menuOpen" class="message-menu-backdrop" @click.self="closeMenu">
    <div class="message-menu" :style="{ left: `${menuX}px`, top: `${menuY}px` }">
      <div class="message-menu-title">{{ menuMessage?.role || "消息操作" }}</div>
      <div class="tiny" style="margin-bottom:8px;">{{ menuVisibleHint || "请选择操作" }}</div>
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
        <button class="button small" type="button" @click="closeDebugDialog">关闭</button>
        <div style="font-weight:900;">调试结束</div>
        <span class="tiny">{{ store.state.debugEndDialog }}</span>
      </div>
      <div class="modal-body">
        <div class="card section soft">
          <div style="font-weight:900; font-size:18px;">{{ store.state.debugEndDialog }}</div>
          <div class="subtle" style="margin-top:8px;">
            {{ store.state.debugEndDialog === '已完结' ? '已没有下一个章节。可返回创作继续补章节。' : '当前调试已结束。' }}
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="button" type="button" @click="closeDebugDialog">继续看</button>
        <button class="button primary" type="button" @click="exitDebugMode">返回创作</button>
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
            <img v-if="roleDetail.avatarPath" :src="roleDetail.avatarPath" :alt="roleDetail.name" />
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
          <div class="card section soft">
            <div class="tiny">角色设定</div>
            <div style="white-space:pre-wrap; margin-top:6px;">{{ roleDetail.description || "暂无角色设定" }}</div>
          </div>
          <div class="card section soft">
            <div class="tiny">台词示例</div>
            <div style="white-space:pre-wrap; margin-top:6px;">{{ roleDetail.sample || "暂无台词示例" }}</div>
          </div>
          <div class="card section soft">
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
          <div class="card section soft">
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
      </div>
      <div class="modal-actions">
        <button class="button primary" type="button" @click="closeRoleDetail">知道了</button>
      </div>
    </div>
  </div>
</template>
