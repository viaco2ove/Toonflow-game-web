<script setup lang="ts">
import { computed } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import StoryCover from "./StoryCover.vue";

const store = useToonflowStore();
const list = computed(() => store.filteredHallWorlds());
</script>

<template>
  <section class="surface section-block">
    <div class="row-between">
      <div>
        <h2 class="section-title">故事大厅</h2>
        <div class="subtle">只展示已发布的故事。</div>
      </div>
      <button class="button small" type="button" @click="store.reloadAll">刷新</button>
    </div>

    <div class="stack-gap">
      <input v-model="store.state.hallKeyword" class="input" type="text" placeholder="搜索故事名 / 简介 / 背景" />
      <div class="tag-row">
        <button class="chip" :class="{ active: store.state.hallCategory === 'all' }" type="button" @click="store.state.hallCategory='all'">全部</button>
        <button class="chip" :class="{ active: store.state.hallCategory === 'hasChapter' }" type="button" @click="store.state.hallCategory='hasChapter'">可游玩</button>
        <button class="chip" :class="{ active: store.state.hallCategory === 'noChapter' }" type="button" @click="store.state.hallCategory='noChapter'">无章节</button>
      </div>
    </div>
  </section>

  <section class="stack-gap">
    <div v-if="!list.length" class="empty-surface">暂无匹配故事</div>
    <div v-else class="story-grid">
      <article v-for="world in list" :key="world.id" class="surface story-card">
        <StoryCover :title="world.name" :cover-path="store.worldCoverPath(world)" height="130px" />
        <div class="meta">
          <h3>{{ world.name }}</h3>
          <p>{{ world.intro || "暂无简介" }}</p>
          <p>章节 {{ world.chapterCount || 0 }} · 会话 {{ world.sessionCount || 0 }}</p>
          <div class="row" style="margin-top:10px;">
            <button class="button primary small" type="button" @click="store.startFromWorld(world)">游玩</button>
            <button class="button small" type="button" @click="store.openWorldForEdit(world)">编辑</button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
