<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useToonflowStore } from "./composables/useToonflowStore";
import ProjectSwitcher from "./components/ProjectSwitcher.vue";
import BottomNav from "./components/BottomNav.vue";
import SceneHome from "./components/SceneHome.vue";
import SceneHall from "./components/SceneHall.vue";
import SceneCreate from "./components/SceneCreate.vue";
import SceneHistory from "./components/SceneHistory.vue";
import SceneMy from "./components/SceneMy.vue";
import SceneSettings from "./components/SceneSettings.vue";
import ScenePlay from "./components/ScenePlay.vue";

const store = useToonflowStore();

const bottomActive = computed(() => {
  if (store.state.activeTab === "play") return "history";
  return store.state.activeTab === "settings" ? "my" : store.state.activeTab;
});

const showProjectSwitcher = computed(() => !["play", "settings"].includes(store.state.activeTab));

onMounted(async () => {
  if (!store.state.selectedProjectId && store.state.projects.length) {
    store.selectProject(store.state.projects[0].id);
  }
  await store.reloadAll();
});

function changeTab(tab: "home" | "create" | "history" | "my") {
  store.setTab(tab);
}
</script>

<template>
  <div class="app-shell">
    <header class="app-top">
      <div class="brand-panel">
        <div>
          <h1 class="brand-title">Toonflow AI 剧场</h1>
          <p class="brand-subtitle">Android 内容迁移到 Vue 的真功能版</p>
        </div>
        <div class="brand-actions">
          <button class="button small" type="button" @click="store.setTab('settings')">设置</button>
          <button class="button small" type="button" @click="store.reloadAll()">刷新</button>
        </div>
      </div>
      <ProjectSwitcher v-if="showProjectSwitcher" />
    </header>

    <main class="main-view">
      <div v-if="store.state.notice" class="top-banner">{{ store.state.notice }}</div>

      <SceneHome v-if="store.state.activeTab === 'home'" />
      <SceneHall v-else-if="store.state.activeTab === 'hall'" />
      <SceneCreate v-else-if="store.state.activeTab === 'create'" />
      <SceneHistory v-else-if="store.state.activeTab === 'history'" />
      <SceneMy v-else-if="store.state.activeTab === 'my'" />
      <SceneSettings v-else-if="store.state.activeTab === 'settings'" />
      <ScenePlay v-else-if="store.state.activeTab === 'play'" />
      <SceneHome v-else />
    </main>

    <BottomNav :active="bottomActive" @change="changeTab" />
  </div>
</template>
