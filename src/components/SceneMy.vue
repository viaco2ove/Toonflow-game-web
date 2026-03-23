<script setup lang="ts">
import { computed, ref } from "vue";
import ImageGenerateDialog from "./ImageGenerateDialog.vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import StoryCover from "./StoryCover.vue";
import { imageStyleForKey } from "../utils/imageStyles";

const store = useToonflowStore();
const projectDrafts = computed(() => store.draftWorldsForSelectedProject());
const projectPublished = computed(() => store.publishedWorldsForSelectedProject());
const drafts = computed(() => projectDrafts.value);
const published = computed(() => projectPublished.value);
const selectedProjectName = computed(() => {
  const current = store.state.projects.find((item) => item.id === store.state.selectedProjectId);
  return String(current?.name || store.state.selectedProjectNameCache || "").trim();
});
const visibleDrafts = computed(() =>
  drafts.value.filter((world) => String(world.name || "").trim() !== selectedProjectName.value),
);
const visiblePublished = computed(() =>
  published.value.filter((world) => String(world.name || "").trim() !== selectedProjectName.value),
);
const works = computed(() => [...visibleDrafts.value, ...visiblePublished.value]);
const workCards = computed(() => {
  const cards: Array<
    | {
        key: string;
        placeholder: true;
        title: string;
        meta: string;
        caption: string;
        mode: "draft" | "published";
      }
    | {
        key: string;
        placeholder: false;
        title: string;
        meta: string;
        caption: string;
        mode: "draft" | "published";
        world: (typeof drafts.value)[number];
      }
  > = [];
  if (visibleDrafts.value.length) {
    visibleDrafts.value.forEach((world) => {
      cards.push({
        key: `draft-${world.id}`,
        placeholder: false,
        title: world.name || "未命名故事",
        meta: `${world.name || "未命名故事"} · 草稿`,
        caption: world.intro || "保存草稿后会显示在这里",
        mode: "draft",
        world,
      });
    });
  } else {
    cards.push({
      key: "draft-empty",
      placeholder: true,
      title: "暂无草稿",
      meta: "草稿箱",
      caption: "保存草稿后会显示在这里",
      mode: "draft",
    });
  }
  if (visiblePublished.value.length) {
    visiblePublished.value.forEach((world) => {
      cards.push({
        key: `published-${world.id}`,
        placeholder: false,
        title: world.name || "未命名故事",
        meta: `${world.name || "未命名故事"} · 浏览 ${world.sessionCount || 0}`,
        caption: world.intro || "发布后会在这里展示",
        mode: "published",
        world,
      });
    });
  } else {
    cards.push({
      key: "published-empty",
      placeholder: true,
      title: "暂无已发布故事",
      meta: "已发布",
      caption: "发布后会在这里展示",
      mode: "published",
    });
  }
  return cards;
});
const workTags = computed(() => visiblePublished.value.map((world) => world.name).filter(Boolean).slice(0, 3));
const profileStats = computed(() => [
  { label: "获赞", value: 0 },
  { label: "关注", value: 1 },
  { label: "粉丝", value: 0 },
]);
const avatarInput = ref<HTMLInputElement | null>(null);
const showAvatarActionDialog = ref(false);
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

function openAvatarActionDialog() {
  showAvatarActionDialog.value = true;
}

function closeAvatarActionDialog() {
  showAvatarActionDialog.value = false;
}

function triggerAvatarUpload() {
  closeAvatarActionDialog();
  avatarInput.value?.click();
}

function openAccountImageDialog() {
  showAvatarActionDialog.value = false;
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
  <section class="card section my-profile-card">
    <div class="row-between my-profile-top">
      <div class="section-title" style="font-size:16px; margin:0;">我的</div>
      <button class="circle-ghost-btn my-settings-btn" type="button" aria-label="设置" @click="store.setTab('settings')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 15.3a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
          />
          <path
            d="M19.2 13.1v-2.2l-1.8-.6a5.6 5.6 0 0 0-.6-1.4l.9-1.7-1.6-1.6-1.7.9c-.4-.2-.9-.5-1.4-.6L12.9 2.8h-2.2L10.1 4.9c-.5.1-1 .3-1.4.6L7 4.6 5.4 6.2l.9 1.7c-.3.4-.5.9-.6 1.4l-1.9.6v2.2l1.9.6c.1.5.3 1 .6 1.4l-.9 1.7 1.6 1.6 1.7-.9c.4.3.9.5 1.4.6l.6 1.9h2.2l.6-1.9c.5-.1 1-.3 1.4-.6l1.7.9 1.6-1.6-.9-1.7c.3-.4.5-.9.6-1.4l1.8-.6Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.1"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>

    <div class="my-profile-main">
      <div class="avatar my-profile-avatar" @click="openAvatarActionDialog">
        <img v-if="store.state.accountAvatarPath" :src="store.state.accountAvatarPath" alt="账号头像" />
        <div v-else class="placeholder">{{ (store.state.userName || 'A').slice(0,1).toUpperCase() }}</div>
        <div class="badge">+</div>
      </div>
      <input ref="avatarInput" type="file" accept="image/*" hidden @change="onAvatarFile" />
      <div class="my-profile-meta">
        <div class="my-profile-name">{{ store.state.userName || '未登录' }}</div>
        <div class="subtle">用户ID：{{ store.state.userId || 0 }}</div>
        <div class="my-profile-stats">
          <div v-for="item in profileStats" :key="item.label" class="my-stat">
            <strong>{{ item.value }}</strong>
            <span>{{ item.label }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="my-profile-actions">
      <button class="button my-profile-btn" type="button" @click="store.startNewStoryDraft">新建故事</button>
      <button class="button my-profile-btn" type="button" @click="store.setTab('settings')">编辑资料</button>
    </div>
  </section>

  <section class="card section my-works-card">
    <div class="row-between my-work-head">
      <div class="section-title" style="font-size:16px; margin:0;">{{ works.length }}作品</div>
    </div>
    <div v-if="workTags.length" class="tag-row my-work-tags">
      <button v-for="world in workTags" :key="world.id" class="chip active" type="button">
        {{ world.name }}
      </button>
    </div>
    <div class="my-work-grid">
          <article
        v-for="card in workCards"
        :key="card.key"
        class="card my-work-card"
        :class="{ placeholder: card.placeholder }"
      >
        <button
          v-if="!card.placeholder && card.mode === 'draft'"
          class="my-work-cover-btn"
          type="button"
          @click="store.openWorldForEdit(card.world)"
        >
          <StoryCover :title="card.title" :cover-path="store.worldCoverPath(card.world)" height="128px" />
        </button>
        <button
          v-else-if="!card.placeholder && card.mode === 'published'"
          class="my-work-cover-btn"
          type="button"
          @click="store.startFromWorld(card.world)"
        >
          <StoryCover :title="card.title" :cover-path="store.worldCoverPath(card.world)" height="128px" />
        </button>
        <div v-else class="my-empty-card">{{ card.title }}</div>

        <div class="my-work-body">
          <div class="my-work-row">
            <h3>{{ card.title }}</h3>
            <span class="my-work-status" :class="{ published: card.mode === 'published' && !card.placeholder }">
              {{ card.placeholder ? (card.mode === 'draft' ? '草稿' : '已发布') : (card.mode === 'draft' ? '草稿' : '已发布') }}
            </span>
          </div>
          <p>{{ card.caption }}</p>
          <div class="my-work-actions" v-if="!card.placeholder">
            <template v-if="card.mode === 'draft'">
              <button class="button primary small" type="button" @click="store.openWorldForEdit(card.world)">编辑</button>
              <button class="button small" type="button" @click="store.startNewStoryDraft()">新开</button>
            </template>
            <template v-else>
              <button class="button small" type="button" @click="store.reopenPublishedWorldAsDraft(card.world)">编辑</button>
            </template>
          </div>
          <div v-else class="my-empty-caption">
            {{ card.caption }}
          </div>
        </div>
      </article>
    </div>
  </section>

  <div v-if="showAvatarActionDialog" class="modal-backdrop" @click.self="closeAvatarActionDialog">
    <div class="modal-panel" style="width:min(100%,360px);">
      <div class="modal-header">
        <div style="font-weight:900;">更换头像</div>
      </div>
      <div class="modal-body">
        <div class="dialog-stack">
          <button class="button block" type="button" @click="triggerAvatarUpload">上传头像</button>
          <button class="button primary block" type="button" @click="openAccountImageDialog">AI 生图</button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="button" type="button" @click="closeAvatarActionDialog">取消</button>
      </div>
    </div>
  </div>

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
