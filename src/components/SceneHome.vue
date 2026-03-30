<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import StoryCover from "./StoryCover.vue";

const store = useToonflowStore();
const PLAY_AUTO_VOICE_STORAGE_KEY = "toonflow.playAutoVoice";

function readPlayAutoVoicePreference(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(PLAY_AUTO_VOICE_STORAGE_KEY) !== "0";
}

const autoVoice = ref(readPlayAutoVoicePreference());
const rec = computed(() => store.recommendedWorld());
const hasRec = computed(() => !!rec.value);
const projectName = computed(() => store.selectedProjectName());
const recommendationHint = computed(() => {
  if (!rec.value) return "当前还没有可游玩的已发布故事。";
  return rec.value.intro || "随机推荐一个已发布故事，点任意主视觉区域即可进入。";
});
const recommendationMeta = computed(() => {
  if (!rec.value) return [];
  return [
    `章节 ${rec.value.chapterCount || 0}`,
    `会话 ${rec.value.sessionCount || 0}`,
    "全站已发布",
  ];
});

watch(autoVoice, (enabled) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLAY_AUTO_VOICE_STORAGE_KEY, enabled ? "1" : "0");
});
</script>

<template>
  <section class="home-stage" :class="{ 'home-stage--empty': !hasRec }">
    <div class="row home-global-actions">
      <button class="circle-ghost-btn circle-ghost-btn--home" type="button" aria-label="进入故事大厅" title="进入故事大厅" @click="store.setTab('hall')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8" />
          <path d="M16.2 16.2 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>
      <button class="circle-ghost-btn circle-ghost-btn--home" type="button" :aria-label="autoVoice ? '关闭语音' : '开启语音'" :title="autoVoice ? '关闭语音' : '开启语音'" @click="autoVoice = !autoVoice">
        <svg v-if="autoVoice" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 14h3.3l4-4v8l-4-4H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
          <path d="M16.2 8.6a5.2 5.2 0 0 1 0 6.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <path d="M18.9 6.4a8.4 8.4 0 0 1 0 11.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 14h3.3l4-4v8l-4-4H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
          <path d="M17.8 9.2 21 12.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <path d="M21 9.2 17.8 12.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <article v-if="hasRec" class="home-hero-card">
      <button class="home-hero-hitbox" type="button" aria-label="进入推荐故事" @click="store.quickStart"></button>
      <StoryCover :title="rec!.name" :cover-path="store.worldCoverPath(rec!)" height="100%" variant="plain" />
      <div class="home-hero-scrim"></div>

      <div class="home-header">
        <div class="home-headline">
          <div class="home-title">主页</div>
          <div v-if="projectName" class="home-subtitle">项目：{{ projectName }}</div>
        </div>
      </div>

      <div class="home-hero-body">
        <div class="home-hero-chip">随机推荐故事</div>
        <h2 class="home-hero-title">{{ rec!.name }}</h2>
        <p class="home-hero-desc">{{ recommendationHint }}</p>
        <div class="home-hero-meta">
          <span v-for="item in recommendationMeta" :key="item" class="home-hero-meta-pill">{{ item }}</span>
        </div>
      </div>
    </article>

    <section v-else class="home-empty-card">
      <div class="home-header">
        <div class="home-headline">
          <div class="home-title">主页</div>
          <div v-if="projectName" class="home-subtitle">项目：{{ projectName }}</div>
        </div>
      </div>
      <div class="home-empty-title">暂无可游玩故事</div>
      <div class="home-empty-subtitle">当前还没有“已发布且有章节”的故事，可以先去故事大厅看看，或创建并发布自己的故事。</div>
    </section>

    <section class="home-entry-card">
      <div class="home-entry-head">
        <div class="home-entry-title">输入一句话开始故事</div>
        <div class="home-entry-subtitle">
          {{ hasRec ? "会从当前随机推荐的已发布故事开始。" : "暂无推荐故事，可先去故事大厅挑选。" }}
        </div>
      </div>
      <div class="home-entry-shell">
        <textarea
          v-model="store.state.quickInput"
          class="home-entry-input"
          rows="3"
          placeholder="输入一句话，点击右侧按钮进入故事"
        ></textarea>
        <button class="home-entry-btn" type="button" :disabled="!hasRec" @click="store.quickStart">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h10.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
            <path d="m12.5 7.6 4.5 4.4-4.5 4.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>进入故事</span>
        </button>
      </div>
    </section>
  </section>
</template>
