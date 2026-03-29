<script setup lang="ts">
import { computed } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import StoryCover from "./StoryCover.vue";

const store = useToonflowStore();
const sessions = computed(() => store.state.sessions);

function historyCoverPath(sessionId: string) {
  const item = sessions.value.find((row) => row.sessionId === sessionId);
  if (!item) return "";
  const world = store.state.worlds.find((row) => row.id === item.worldId);
  return item.worldCoverPath || store.worldCoverPath(world) || "";
}

async function removeSession(sessionId: string, title: string) {
  const confirmed = window.confirm(`确认删除会话「${title || "未命名会话"}」吗？删除后将无法恢复。`);
  if (!confirmed) return;
  try {
    await store.deleteSession(sessionId);
    store.state.notice = "会话已删除";
  } catch (error) {
    store.state.notice = `删除会话失败: ${error instanceof Error ? error.message : "未知错误"}`;
  }
}
</script>

<template>
  <section class="history-page">
    <div class="history-header">
      <h2 class="history-title">聊过</h2>
      <button class="history-refresh-btn" type="button" @click="store.reloadAll">刷新</button>
    </div>

    <div v-if="!sessions.length" class="history-empty">暂无会话记录</div>

    <div v-else class="history-list">
      <article
        v-for="item in sessions"
        :key="item.sessionId"
        class="history-card"
        @click="store.continueSessionForWorld(item.worldId, item.sessionId)"
      >
        <StoryCover
          :title="item.title || item.worldName || '会话'"
          :cover-path="historyCoverPath(item.sessionId)"
          height="84px"
          variant="plain"
        />
        <div class="history-card-body">
          <h3 class="history-card-title">{{ item.title || item.worldName }}</h3>
          <div class="history-card-meta">{{ item.worldName }}<span v-if="item.chapterTitle"> · {{ item.chapterTitle }}</span></div>
          <p class="history-card-desc">{{ item.latestMessage?.content || item.worldIntro || "点击继续聊" }}</p>
          <div class="history-card-actions">
            <button class="history-card-btn" type="button" @click.stop="store.continueSessionForWorld(item.worldId, item.sessionId)">继续</button>
            <button class="history-card-btn" type="button" @click.stop="store.continueSessionForWorld(item.worldId, item.sessionId, { playback: true, playbackIndex: 0 })">观看</button>
            <button class="history-card-icon-btn danger" type="button" aria-label="删除会话" @click.stop="removeSession(item.sessionId, item.title || item.worldName || '未命名会话')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 4h6l1 2h4v2H4V6h4l1-2z"></path>
                <path d="M7 9h10l-1 10a2 2 0 01-2 2H10a2 2 0 01-2-2L7 9z"></path>
              </svg>
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
