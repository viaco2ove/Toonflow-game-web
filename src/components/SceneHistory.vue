<script setup lang="ts">
import { computed } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import StoryCover from "./StoryCover.vue";

const store = useToonflowStore();
const sessions = computed(() => store.state.sessions);
</script>

<template>
  <section class="card section">
    <div class="row-between">
      <div>
        <h2 class="section-title">聊过</h2>
        <div class="subtle">账号级会话历史，按当前项目数据汇总。</div>
      </div>
      <button class="button small" type="button" @click="store.reloadAll">刷新</button>
    </div>
  </section>

  <section class="stack-gap">
    <div v-if="!sessions.length" class="card empty">暂无会话记录</div>
    <article v-for="item in sessions" :key="item.sessionId" class="card section">
      <div class="row" style="align-items:flex-start;">
        <StoryCover :title="item.title || item.worldName || '会话'" :cover-path="item.worldCoverPath" height="78px" style="width:78px; flex:none;" />
        <div style="flex:1;">
          <div class="row-between">
            <div>
              <div class="chip" v-if="item.projectName">{{ item.projectName }}</div>
              <h3 style="margin:8px 0 0;">{{ item.title || item.worldName }}</h3>
            </div>
            <button class="button primary small" type="button" @click="store.openSession(item.sessionId)">继续</button>
          </div>
          <div class="subtle" style="margin-top:6px;">{{ item.worldName }}<span v-if="item.chapterTitle"> · {{ item.chapterTitle }}</span></div>
          <p class="subtle" style="margin-top:8px;">{{ item.latestMessage?.content || item.worldIntro || "点击继续聊" }}</p>
        </div>
      </div>
    </article>
  </section>
</template>
