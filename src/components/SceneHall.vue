<script setup lang="ts">
import { computed } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import StoryCover from "./StoryCover.vue";

const store = useToonflowStore();
const list = computed(() => store.filteredHallWorlds());
</script>

<template>
  <section class="hall-page">
    <div class="hall-header">
      <h2 class="hall-title">故事大厅</h2>
      <button class="hall-back-btn" type="button" @click="store.setTab('home')">返回</button>
    </div>

    <input v-model="store.state.hallKeyword" class="hall-search-input" type="text" placeholder="搜索感兴趣内容" />

    <div class="hall-chip-row">
      <button class="hall-filter-chip" :class="{ active: store.state.hallCategory === 'all' }" type="button" @click="store.state.hallCategory='all'">全部</button>
      <button class="hall-filter-chip" :class="{ active: store.state.hallCategory === 'hasChapter' }" type="button" @click="store.state.hallCategory='hasChapter'">可游玩</button>
      <button class="hall-filter-chip" type="button">热门</button>
    </div>

    <div v-if="!list.length" class="hall-empty">暂无匹配故事</div>

    <div v-else class="hall-list">
      <article v-for="world in list" :key="world.id" class="hall-card">
        <button class="hall-card-cover" type="button" @click="store.startFromWorld(world)">
          <StoryCover :title="world.name" :cover-path="store.worldCoverPath(world)" height="150px" variant="plain" />
        </button>
        <div class="hall-card-body">
          <h3 class="hall-card-title">{{ world.name }}</h3>
          <p class="hall-card-intro">{{ world.intro || "暂无简介" }}</p>
          <div class="hall-card-meta">章节 {{ world.chapterCount || 0 }} · 会话 {{ world.sessionCount || 0 }}</div>
          <div class="hall-card-actions">
            <button class="hall-action-btn hall-action-btn--primary" type="button" @click="store.startFromWorld(world)">游玩</button>
            <button v-if="store.canEditWorld(world)" class="hall-action-btn" type="button" @click="store.openWorldForEdit(world)">编辑</button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
