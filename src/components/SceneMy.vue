<script setup lang="ts">
import { computed, ref } from "vue";
import ImageGenerateDialog from "./ImageGenerateDialog.vue";
import LayeredAvatar from "./LayeredAvatar.vue";
import StoryCover from "./StoryCover.vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import type { WorldItem } from "../types/toonflow";
import { imageStyleForKey } from "../utils/imageStyles";

const store = useToonflowStore();

const drafts = computed(() => store.draftWorldsForSelectedProject());
const published = computed(() => store.publishedWorldsForSelectedProject());
const projectNameSet = computed(() => {
  const names = store.state.projects.map((item) => String(item.name || "").trim()).filter(Boolean);
  const cached = String(store.state.selectedProjectNameCache || "").trim();
  if (cached) names.push(cached);
  return new Set(names);
});
const visibleDrafts = computed(() => drafts.value.filter((world) => !projectNameSet.value.has(String(world.name || "").trim())));
const visiblePublished = computed(() => published.value.filter((world) => !projectNameSet.value.has(String(world.name || "").trim())));
const latestDraft = computed(() => visibleDrafts.value[0] || null);
const worksCount = computed(() => visiblePublished.value.length);
const likeCount = computed(() => visiblePublished.value.reduce((sum, world) => sum + Number(world.sessionCount || 0), 0));
const followCount = computed(() => (visiblePublished.value.length ? 1 : 0));
const fanCount = computed(() => visiblePublished.value.reduce((sum, world) => sum + Number(world.chapterCount || 0), 0));
const avatarInput = ref<HTMLInputElement | null>(null);
const avatarVideoInput = ref<HTMLInputElement | null>(null);
const showAvatarActionDialog = ref(false);
const accountImageDialogOpen = ref(false);
const showDraftListPage = ref(false);
const deletingDraft = ref<WorldItem | null>(null);
const draftMenuWorld = ref<WorldItem | null>(null);

const accountDialogTitle = computed(() => "创建角色");
const accountDialogPrompt = computed(() => (store.state.userName ? `${store.state.userName} 的账号头像` : "账号头像"));
const accountAvatarProcessing = computed(() => store.isAvatarProcessing("account"));

async function onAvatarFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    try {
      await store.updateAvatarFromFile("account", file);
    } catch (err) {
      store.state.notice = `头像分离失败: ${err instanceof Error ? err.message : "未知错误"}`;
    }
  }
  input.value = "";
}

async function onAvatarVideoFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    try {
      await store.updateAvatarFromMp4("account", file);
    } catch (err) {
      store.state.notice = `头像动图转换失败: ${err instanceof Error ? err.message : "未知错误"}`;
    }
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

function triggerAvatarVideoUpload() {
  closeAvatarActionDialog();
  avatarVideoInput.value?.click();
}

function openAccountImageDialog() {
  showAvatarActionDialog.value = false;
  accountImageDialogOpen.value = true;
}

function closeAccountImageDialog() {
  accountImageDialogOpen.value = false;
}

function openDraftListDialog() {
  showDraftListPage.value = true;
}

function closeDraftListDialog() {
  showDraftListPage.value = false;
  draftMenuWorld.value = null;
}

function askDeleteDraft(world: WorldItem) {
  deletingDraft.value = world;
  draftMenuWorld.value = null;
}

function cancelDeleteDraft() {
  deletingDraft.value = null;
}

async function confirmDeleteDraft() {
  const world = deletingDraft.value;
  if (!world) return;
  await store.deleteWorld(world);
  deletingDraft.value = null;
  if (!visibleDrafts.value.length) {
    showDraftListPage.value = false;
  }
}

async function editDraft(world: WorldItem) {
  draftMenuWorld.value = null;
  closeDraftListDialog();
  await store.openWorldForEdit(world);
}

function openDraftMenu(world: WorldItem) {
  draftMenuWorld.value = world;
}

function closeDraftMenu() {
  draftMenuWorld.value = null;
}

function formatDate(ts?: number) {
  if (!ts) return "";
  const date = new Date(ts);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${month}-${day}`;
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
  <main v-if="!showDraftListPage" class="my-page">
  <section class="my-profile-section">
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
      <button class="avatar my-profile-avatar my-profile-avatar-btn" type="button" :disabled="accountAvatarProcessing" @click="openAvatarActionDialog">
        <LayeredAvatar
          :foreground-path="store.resolveMediaPath(store.state.accountAvatarPath)"
          :background-path="store.resolveMediaPath(store.state.accountAvatarBgPath || store.state.accountAvatarPath)"
          alt="账号头像"
        >
          <div class="placeholder">{{ (store.state.userName || "A").slice(0, 1).toUpperCase() }}</div>
        </LayeredAvatar>
        <div v-if="accountAvatarProcessing" class="avatar-processing-mask">
          <span class="avatar-processing-spinner"></span>
        </div>
        <div class="badge">+</div>
      </button>
      <input ref="avatarInput" type="file" accept="image/*" hidden @change="onAvatarFile" />
      <input ref="avatarVideoInput" type="file" accept="video/mp4" hidden @change="onAvatarVideoFile" />
      <div class="my-profile-meta">
        <div class="my-profile-name">{{ store.state.userName || "未登录" }}</div>
        <div class="subtle">用户ID：{{ store.state.userId || 0 }}</div>
        <div class="my-profile-stats">
          <div class="my-stat">
            <strong>{{ likeCount }}</strong>
            <span>获赞</span>
          </div>
          <div class="my-stat">
            <strong>{{ followCount }}</strong>
            <span>关注</span>
          </div>
          <div class="my-stat">
            <strong>{{ fanCount }}</strong>
            <span>粉丝</span>
          </div>
        </div>
      </div>
    </div>

    <div class="my-profile-actions">
      <button class="button my-profile-btn" type="button" @click="store.startNewStoryDraft">新建故事</button>
      <button class="button my-profile-btn" type="button" @click="store.setTab('settings')">编辑资料</button>
    </div>
  </section>

  <section class="my-works-section">
    <div class="row-between my-work-head">
      <div class="section-title" style="font-size:16px; margin:0;">{{ worksCount }}作品</div>
    </div>

    <div class="my-work-grid">
      <article class="my-work-card my-summary-card my-draft-entry-card" @click="openDraftListDialog">
        <div v-if="latestDraft" class="my-summary-cover">
          <StoryCover
            :title="latestDraft.name || '草稿箱'"
            :cover-path="store.worldCoverPath(latestDraft)"
            empty-text="草稿"
            height="128px"
            variant="plain"
          />
        </div>
        <div v-else class="my-empty-card">暂无草稿</div>
        <div class="my-work-body my-draft-entry-body">
          <p>保存草稿后会显示在这里</p>
        </div>
      </article>

      <article
        v-for="world in visiblePublished"
        :key="world.id"
        class="my-work-card my-summary-card my-published-entry-card"
      >
        <button class="my-work-cover-btn" type="button" @click="store.startFromWorld(world)">
          <StoryCover
            :title="world.name || '故事'"
            :cover-path="store.worldCoverPath(world)"
            height="128px"
            variant="plain"
          />
        </button>
        <div class="my-work-body my-work-body--compact">
          <div class="my-work-row">
            <h3 :title="world.name || '未命名故事'">{{ world.name || "未命名故事" }}</h3>
            <span class="my-work-status published">已发布</span>
          </div>
          <div class="my-work-actions one">
            <button class="button small" type="button" @click="store.reopenPublishedWorldAsDraft(world)">编辑</button>
          </div>
        </div>
      </article>

      <article v-if="!visiblePublished.length" class="my-work-card my-summary-card my-published-entry-card placeholder">
        <div class="my-empty-card">暂无已发布故事</div>
        <div class="my-work-body my-work-body--compact">
          <div class="my-work-row">
            <h3 title="暂无已发布故事">暂无已发布故事</h3>
            <span class="my-work-status published">已发布</span>
          </div>
        </div>
      </article>
    </div>
  </section>
  </main>

  <main v-else class="my-page draft-page">
    <section class="draft-page-top">
      <button class="draft-back-btn" type="button" @click="closeDraftListDialog">
        <span aria-hidden="true">‹</span>
        <span>草稿箱</span>
      </button>
      <button class="button small" type="button" @click="store.startNewStoryDraft(); closeDraftListDialog();">新建故事</button>
    </section>

    <div class="subtle draft-page-subtitle">{{ visibleDrafts.length }} 个草稿</div>

    <section v-if="!visibleDrafts.length" class="draft-sheet-empty">
      <div class="my-empty-card">暂无草稿</div>
      <div class="my-empty-caption">保存草稿后会显示在这里</div>
    </section>

    <section v-else class="draft-tile-grid">
      <article v-for="world in visibleDrafts" :key="world.id" class="draft-tile">
        <button class="draft-tile-cover" type="button" @click="editDraft(world)">
          <StoryCover
            :title="world.name || '草稿'"
            :cover-path="store.worldCoverPath(world)"
            empty-text=""
            height="250px"
            variant="plain"
          />
          <span v-if="!store.worldCoverPath(world)" class="draft-tile-badge">未生图</span>
          <div class="draft-tile-overlay">
            <div class="draft-tile-title">{{ world.name || "未命名" }}</div>
            <div class="draft-tile-date">{{ formatDate((world as any).updateTime) || "--.--" }}</div>
          </div>
        </button>
        <button class="draft-tile-menu" type="button" @click="openDraftMenu(world)">...</button>
      </article>
    </section>
  </main>

  <div v-if="draftMenuWorld" class="modal-backdrop" @click.self="closeDraftMenu">
    <div class="modal-panel" style="width:min(100%,320px);">
      <div class="modal-header">
        <div style="font-weight:900;">{{ draftMenuWorld.name || "未命名故事" }}</div>
      </div>
      <div class="modal-body">
        <div class="dialog-stack">
          <button class="button primary block" type="button" @click="editDraft(draftMenuWorld)">编辑</button>
          <button class="button block danger-outline" type="button" @click="askDeleteDraft(draftMenuWorld)">删除</button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="button" type="button" @click="closeDraftMenu">关闭</button>
      </div>
    </div>
  </div>

  <div v-if="deletingDraft" class="modal-backdrop" @click.self="cancelDeleteDraft">
    <div class="modal-panel" style="width:min(100%,360px);">
      <div class="modal-header">
        <div style="font-weight:900;">删除草稿</div>
      </div>
      <div class="modal-body">
        确认删除《{{ deletingDraft.name || "未命名故事" }}》？此操作会删除对应章节和调试会话。
      </div>
      <div class="modal-actions">
        <button class="button" type="button" @click="cancelDeleteDraft">取消</button>
        <button class="button small danger-solid" type="button" @click="confirmDeleteDraft">删除</button>
      </div>
    </div>
  </div>

  <div v-if="showAvatarActionDialog" class="modal-backdrop image-source-dialog-backdrop" @click.self="closeAvatarActionDialog">
    <div class="modal-panel image-source-dialog-panel">
      <div class="modal-header">
        <div style="font-weight:900;">选择图片来源</div>
      </div>
      <div class="modal-body">
        <div class="dialog-stack">
          <button class="button block" type="button" @click="triggerAvatarUpload">上传图片（支持 PNG / GIF）</button>
          <button class="button block button-gif-upload" type="button" @click="triggerAvatarVideoUpload">
            <span class="button-gif-upload__glyph">GIF</span>
            <span>上传 MP4</span>
          </button>
          <button class="button primary block" type="button" @click="openAccountImageDialog">AI 生成图片</button>
          <div class="subtle">
            角色头像支持 PNG / GIF / MP4；上传 MP4 后会自动转成 GIF 主体图和静态背景图。
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="button" type="button" @click="closeAvatarActionDialog">关闭</button>
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
