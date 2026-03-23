<script setup lang="ts">
import { computed, ref } from "vue";
import ImageGenerateDialog from "./ImageGenerateDialog.vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import StoryCover from "./StoryCover.vue";
import { imageStyleForKey } from "../utils/imageStyles";

const store = useToonflowStore();
const drafts = computed(() => store.draftWorldsForSelectedProject());
const published = computed(() => store.publishedWorldsForSelectedProject());
const avatarInput = ref<HTMLInputElement | null>(null);
const accountImageDialogOpen = ref(false);

const accountDialogTitle = computed(() => "账号头像");
const accountDialogPrompt = computed(() => store.state.userName ? `${store.state.userName} 的账号头像` : "账号头像");

function onAvatarFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    void store.updateAvatarFromFile("account", file);
  }
  input.value = "";
}

function openAccountImageDialog() {
  accountImageDialogOpen.value = true;
}

function closeAccountImageDialog() {
  accountImageDialogOpen.value = false;
}

async function handleAccountImageConfirm(payload: { prompt: string; styleKey: string; references: string[] }) {
  const style = imageStyleForKey(payload.styleKey);
  const mergedPrompt = [`风格：${style.title}`, payload.prompt].filter(Boolean).join("，");
  try {
    await store.applyImageToTarget("account", mergedPrompt, payload.references, store.state.userName || "账号");
    store.state.notice = "账号头像已更新";
  } catch (err) {
    store.state.notice = `AI 生图失败: ${(err as Error).message}`;
  } finally {
    closeAccountImageDialog();
  }
}
</script>

<template>
  <section class="card section">
    <div class="row-between">
      <div>
        <h2 class="section-title">我的</h2>
        <div class="subtle">账号头像与故事角色头像分离。</div>
      </div>
      <button class="button small" type="button" @click="store.setTab('settings')">设置</button>
    </div>

    <div class="row" style="margin-top:12px; align-items:flex-start;">
      <div class="avatar" style="width:68px; height:68px;" @click="avatarInput?.click()">
        <img v-if="store.state.accountAvatarPath" :src="store.state.accountAvatarPath" alt="账号头像" />
        <div v-else class="placeholder">{{ (store.state.userName || 'A').slice(0,1).toUpperCase() }}</div>
        <div class="badge">+</div>
      </div>
      <input ref="avatarInput" type="file" accept="image/*" hidden @change="onAvatarFile" />
      <div class="dialog-stack">
        <div>
          <div style="font-size:20px; font-weight:900;">{{ store.state.userName || '未登录' }}</div>
          <div class="subtle">用户ID：{{ store.state.userId || 0 }}</div>
        </div>
        <div class="row">
          <button class="button small" type="button" @click="avatarInput?.click()">上传头像</button>
          <button class="button small" type="button" @click="openAccountImageDialog">AI 生图</button>
        </div>
      </div>
    </div>
  </section>

  <section class="card section stack-gap">
    <div class="section-title" style="font-size:16px;">我的故事</div>
    <div class="row">
      <button class="button primary" type="button" @click="store.startNewStoryDraft">新建故事</button>
      <button class="button" type="button" @click="store.setTab('create')">编辑资料</button>
    </div>
  </section>

  <section class="stack-gap">
    <div class="card section">
      <div class="section-title" style="font-size:16px;">草稿箱（{{ drafts.length }}）</div>
      <div v-if="!drafts.length" class="empty">暂无草稿</div>
      <div v-else class="story-grid">
        <article v-for="world in drafts" :key="world.id" class="card story-card">
          <StoryCover :title="world.name" :cover-path="store.worldCoverPath(world)" height="126px" />
          <div class="meta">
            <h3>{{ world.name }}</h3>
            <p>{{ world.intro || '保存草稿后会显示在这里' }}</p>
            <div class="row" style="margin-top:10px;">
              <button class="button small" type="button" @click="store.openWorldForEdit(world)">编辑</button>
              <button class="button primary small" type="button" @click="store.startFromWorld(world)">进入游戏</button>
            </div>
          </div>
        </article>
      </div>
    </div>

    <div class="card section">
      <div class="section-title" style="font-size:16px;">已发布（{{ published.length }}）</div>
      <div v-if="!published.length" class="empty">暂无已发布故事</div>
      <div v-else class="story-grid">
        <article v-for="world in published" :key="world.id" class="card story-card">
          <StoryCover :title="world.name" :cover-path="store.worldCoverPath(world)" height="126px" />
          <div class="meta">
            <h3>{{ world.name }}</h3>
            <p>{{ world.intro || '发布后会在这里展示' }}</p>
            <div class="row" style="margin-top:10px;">
              <button class="button primary small" type="button" @click="store.startFromWorld(world)">进入游戏</button>
              <button class="button small" type="button" @click="store.reopenPublishedWorldAsDraft(world)">编辑</button>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>

  <ImageGenerateDialog
    :open="accountImageDialogOpen"
    :title="accountDialogTitle"
    :initial-prompt="accountDialogPrompt"
    initial-style-key="general_3"
    :loading="store.state.aiGenerating"
    @close="closeAccountImageDialog"
    @confirm="handleAccountImageConfirm"
  />
</template>
