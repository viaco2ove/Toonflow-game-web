<script setup lang="ts">
import { computed } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import StoryCover from "./StoryCover.vue";

const store = useToonflowStore();
const rec = computed(() => store.recommendedWorld());
const hasRec = computed(() => !!rec.value);
const projectName = computed(() => store.selectedProjectName());
</script>

<template>
  <section class="home-stage">
    <div class="home-header">
      <div>
        <div class="home-title">主页</div>
        <div v-if="projectName" class="home-subtitle">项目：{{ projectName }}</div>
      </div>
      <div class="row home-actions">
        <button class="circle-ghost-btn" type="button" aria-label="进入故事大厅" @click="store.setTab('hall')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path d="M16.2 16.2 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
        <button class="circle-ghost-btn" type="button" aria-label="按住说话" @click="store.quickStart">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M8 11.5a4 4 0 1 1 8 0v1.1a4 4 0 0 1-8 0v-1.1Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
            <path d="M12 16.5v2.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            <path d="M9.5 19h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>

    <div class="home-body">
      <div v-if="!hasRec" class="home-empty-card">
        <div class="home-empty-title">暂无可游玩故事</div>
        <div class="home-empty-subtitle">当前项目还没有“已发布且有章节”的故事。</div>
      </div>

      <article v-else class="home-recommend-card">
        <StoryCover :title="rec!.name" :cover-path="store.worldCoverPath(rec!)" height="100%" />
        <div class="home-recommend-mask"></div>
        <div class="home-recommend-content">
          <div class="home-recommend-title">{{ rec!.name }}</div>
          <div class="home-recommend-desc">
            随机推荐：{{ rec!.intro || "点击进入故事，或按住说话。" }}
          </div>
          <div class="home-recommend-meta">
            <span>章节 {{ rec!.chapterCount || 0 }}</span>
            <span>会话 {{ rec!.sessionCount || 0 }}</span>
          </div>
        </div>
      </article>

      <section class="home-input-card">
        <div class="home-input-label">输入一句话开始故事</div>
        <textarea
          v-model="store.state.quickInput"
          class="home-input"
          rows="3"
          placeholder="输入一句话，按按钮从推荐故事开始"
        ></textarea>
        <div class="home-input-footer">
          <span class="tiny">会优先使用当前项目里已发布的故事。</span>
          <button class="button accent home-press-btn" type="button" :disabled="!hasRec" @click="store.quickStart">按住说话</button>
        </div>
      </section>
    </div>
  </section>
</template>
