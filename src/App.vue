<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useToonflowStore } from "./composables/useToonflowStore";
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

onMounted(async () => {
  if (!store.state.selectedProjectId && store.state.projects.length) {
    store.selectProject(store.state.projects[0].id);
  }
  await store.reloadAll();
  window.scrollTo({ top: 0, behavior: "auto" });
});

watch(
  () => store.state.activeTab,
  () => {
    window.scrollTo({ top: 0, behavior: "auto" });
  },
);

function changeTab(tab: "home" | "create" | "history" | "my") {
  store.setTab(tab);
}
</script>

<template>
  <div class="app-shell">
    <main class="main-view">
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
