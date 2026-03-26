<script setup lang="ts">
import { computed } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import StoryCover from "./StoryCover.vue";

const store = useToonflowStore();
const sessions = computed(() => store.state.sessions);
</script>

<template>
  <section class="history-page">
    <div class="history-header">
      <h2 class="history-title">聊过</h2>
      <button class="history-refresh-btn" type="button" @click="store.reloadAll">刷新</button>
    </div>

    <div v-if="!sessions.length" class="history-empty">暂无会话记录</div>

    <div v-else class="history-list">
      <article v-for="item in sessions" :key="item.sessionId" class="history-card" @click="store.openSession(item.sessionId)">
        <StoryCover
          :title="item.title || item.worldName || '会话'"
          :cover-path="item.worldCoverPath"
          height="84px"
          variant="plain"
        />
        <div class="history-card-body">
          <h3 class="history-card-title">{{ item.title || item.worldName }}</h3>
          <div class="history-card-meta">{{ item.worldName }}<span v-if="item.chapterTitle"> · {{ item.chapterTitle }}</span></div>
          <p class="history-card-desc">{{ item.latestMessage?.content || item.worldIntro || "点击继续聊" }}</p>
        </div>
      </article>
    </div>
  </section>
</template>
