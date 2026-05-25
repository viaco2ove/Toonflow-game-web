<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
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
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

// 安卓设备模式检测
function checkAndroidDevice() {
  const urlParams = new URLSearchParams(window.location.search);
  let isAndroid = false;
  if (urlParams.get("device") === "mobile") {
    isAndroid = true;
  } else if (typeof (window as any).Android !== "undefined") {
    isAndroid = true;
  } else {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("android") && (ua.includes("mobile") || ua.includes("toonflow"))) {
      isAndroid = true;
    }
  }
  if (isAndroid) {
    document.body.classList.add("android-device");
  }
}

function updateAndroidInsets() {
  const insets = (window as any).androidInsets;
  if (insets) {
    // Android 传的是物理像素，需要转成 CSS 像素
    const dpr = window.devicePixelRatio || 1;
    const top = Math.round(insets.top / dpr);
    const bottom = Math.round(insets.bottom / dpr);
    const ime = Math.round((insets.ime || 0) / dpr);
    document.documentElement.style.setProperty("--android-inset-top", `${top}px`);
    document.documentElement.style.setProperty("--android-inset-bottom", `${bottom}px`);
    document.documentElement.style.setProperty("--android-ime-height", `${ime}px`);
  }
}

function isImportantNotice(text: string) {
  if (!text.trim()) return false;
  return [
    "失败",
    "错误",
    "失效",
    "请先",
    "不能为空",
    "不一致",
    "无法",
    "不可用",
    "未登录",
    "未选择",
  ].some((keyword) => text.includes(keyword));
}

const noticeImportant = computed(() => isImportantNotice(store.state.notice));

const bottomActive = computed(() => {
  if (store.state.activeTab === "play") return "history";
  return store.state.activeTab === "settings" ? "my" : store.state.activeTab;
});

onMounted(async () => {
  checkAndroidDevice();
  window.addEventListener("android-insets", updateAndroidInsets);
  updateAndroidInsets();
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

watch(
  () => store.state.notice,
  (notice) => {
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    if (!notice || isImportantNotice(notice)) return;
    noticeTimer = setTimeout(() => {
      if (store.state.notice === notice) {
        store.state.notice = "";
      }
    }, 1200);
  },
);

onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer);
  window.removeEventListener("android-insets", updateAndroidInsets);
});

function changeTab(tab: "home" | "create" | "history" | "my") {
  store.setTab(tab);
}
</script>

<template>
  <div class="app-shell">
    <transition name="notice-fade">
      <div v-if="store.state.notice" class="floating-notice" :class="{ 'floating-notice--important': noticeImportant }">
        <span class="floating-notice__text">{{ store.state.notice }}</span>
        <button v-if="noticeImportant" class="floating-notice__close" type="button" @click="store.state.notice = ''">关闭</button>
      </div>
    </transition>

    <main class="main-view" :class="{ 'main-view--play': store.state.activeTab === 'play' }">
      <SceneHome v-if="store.state.activeTab === 'home'" />
      <SceneHall v-else-if="store.state.activeTab === 'hall'" />
      <SceneCreate v-else-if="store.state.activeTab === 'create'" />
      <SceneHistory v-else-if="store.state.activeTab === 'history'" />
      <SceneMy v-else-if="store.state.activeTab === 'my'" />
      <SceneSettings v-else-if="store.state.activeTab === 'settings'" />
      <ScenePlay v-else-if="store.state.activeTab === 'play'" />
      <SceneHome v-else />
    </main>

    <BottomNav v-if="store.state.activeTab !== 'play'" :active="bottomActive" @change="changeTab" />
  </div>
</template>
