<script setup lang="ts">
import { computed } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import StoryCover from "./StoryCover.vue";

const store = useToonflowStore();
const rec = computed(() => store.recommendedWorld());
</script>

<template>
  <section class="card section">
    <div class="row-between">
      <div>
        <h2 class="section-title">主页</h2>
        <div class="subtle">项目：{{ store.selectedProjectName() }}</div>
      </div>
      <div class="row">
        <button class="button soft small" type="button" @click="store.setTab('hall')">进入故事大厅</button>
      </div>
    </div>
  </section>

  <section class="card section stack-gap">
    <div class="row-between">
      <div>
        <h3 class="section-title" style="font-size:16px;margin-bottom:4px;">随机推荐</h3>
        <div class="subtle">没有故事就显示空状态，有故事就直接进入。</div>
      </div>
      <button class="button small" type="button" @click="store.quickStart">按住说话</button>
    </div>

    <div v-if="rec" class="story-card">
      <StoryCover :title="rec.name" :cover-path="store.worldCoverPath(rec)" height="180px" />
      <div class="meta">
        <h3>{{ rec.name }}</h3>
        <p>{{ rec.intro || "点击进入故事" }}</p>
        <div class="row" style="margin-top:10px;">
          <span class="chip">章节 {{ rec.chapterCount || 0 }}</span>
          <span class="chip">会话 {{ rec.sessionCount || 0 }}</span>
          <button class="button primary small" type="button" @click="store.startFromWorld(rec, store.quickInput.trim())">进入故事</button>
        </div>
      </div>
    </div>

    <div v-else class="empty">
      当前项目还没有“已发布且有章节”的故事。
    </div>
  </section>

  <section class="card section stack-gap">
    <div class="section-title" style="font-size:16px;">一句话开始故事</div>
    <textarea v-model="store.state.quickInput" class="textarea" rows="3" placeholder="输入一句话，按按钮从推荐故事开始"></textarea>
    <div class="row-between" style="margin-top:10px;">
      <span class="tiny">会优先使用当前项目里已发布的故事。</span>
      <button class="button accent" type="button" :disabled="!rec" @click="store.quickStart">按住说话</button>
    </div>
  </section>
</template>
