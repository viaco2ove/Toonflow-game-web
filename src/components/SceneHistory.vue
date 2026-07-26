<script setup lang="ts">
import { computed, ref } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import type { ProgressAlignReport, SessionItem } from "../types/toonflow";
import StoryCover from "./StoryCover.vue";
import WorldBookViewerDialog from "./WorldBookViewerDialog.vue";

const store = useToonflowStore();
const sessions = computed(() => store.state.sessions);
const sessionListError = computed(() => store.state.sessionListError || "");

// ★ 世界书只读查看弹窗
const worldBookViewerOpen = ref(false);
const worldBookViewerWorldId = ref<number | null>(null);
const worldBookViewerWorldName = ref<string>("");
function openWorldBookViewer(item: SessionItem) {
  worldBookViewerWorldId.value = item.worldId || null;
  worldBookViewerWorldName.value = item.worldName || item.title || "";
  worldBookViewerOpen.value = true;
}

function historyCoverPath(sessionId: string) {
  const item = sessions.value.find((row) => row.sessionId === sessionId);
  if (!item) return "";
  const world = store.state.worlds.find((row) => row.id === item.worldId);
  return store.resolveMediaPath(item.worldCoverPath || "") || store.worldCoverPath(world) || "";
}

async function removeSession(sessionId: string, title: string) {
  const confirmed = window.confirm(`确认删除会话「${title || "未命名会话"}」吗？删除后将无法恢复。`);
  if (!confirmed) return;
  try {
    await store.deleteSession(sessionId);
    store.state.notice = "会话已删除";
  } catch (error) {
    store.state.notice = `删除会话失败: ${error instanceof Error ? error.message : "未知错误"}`;
  }
}

// ===== 方向2：故事已更新提示 + 进度对齐弹框 =====
const updateDialogVisible = ref(false);
const updateDialogSession = ref<SessionItem | null>(null);
const updateDialogBusy = ref(false);

function openStoryUpdateDialog(item: SessionItem) {
  updateDialogSession.value = item;
  updateDialogVisible.value = true;
}

function closeStoryUpdateDialog() {
  if (updateDialogBusy.value) return;
  updateDialogVisible.value = false;
  updateDialogSession.value = null;
}

/** 对齐报告预览文案 */
function alignReportSummary(report: ProgressAlignReport | null | undefined): string {
  if (!report) return "未检测到结构变动，可直接继续。";
  const lines: string[] = [];
  const namedMapped = (report.mapped || []).filter((m) => m.reason !== "exact");
  if (namedMapped.length) {
    lines.push(...namedMapped.map((m) => `阶段「${m.from}」→「${m.to}」`));
  }
  if (report.fallback?.length) {
    lines.push(...report.fallback.map((f) => `阶段「${f.from}」已移除（回退到「${f.to}」）`));
  }
  if (report.dropped?.length) {
    lines.push(`已清理 ${report.dropped.length} 处失效引用`);
  }
  if (!lines.length) return "结构未变，可直接继续。";
  return lines.join("；");
}

/** 继续游玩：后端编排入口会自动执行确定性对齐 */
async function continueWithAlign() {
  const item = updateDialogSession.value;
  if (!item) return;
  updateDialogBusy.value = true;
  try {
    await store.continueSessionForWorld(item.worldId, item.sessionId);
    updateDialogVisible.value = false;
    updateDialogSession.value = null;
  } catch (error) {
    store.state.notice = `继续游玩失败: ${error instanceof Error ? error.message : "未知错误"}`;
  } finally {
    updateDialogBusy.value = false;
  }
}

/** 重新开始：删档后从头进入新版 */
async function restartFromBeginning() {
  const item = updateDialogSession.value;
  if (!item) return;
  const confirmed = window.confirm("重新开始将放弃当前进度，确定吗？");
  if (!confirmed) return;
  updateDialogBusy.value = true;
  try {
    await store.deleteSession(item.sessionId);
    const world = store.state.worlds.find((row) => row.id === item.worldId) || null;
    if (!world) {
      store.state.notice = "未找到故事，无法重新开始";
      return;
    }
    await store.startFromWorld(world, "");
    updateDialogVisible.value = false;
    updateDialogSession.value = null;
  } catch (error) {
    store.state.notice = `重新开始失败: ${error instanceof Error ? error.message : "未知错误"}`;
  } finally {
    updateDialogBusy.value = false;
  }
}

/** 智能对齐（AI 语义匹配 phase 改名 + 重生成 eventSummary） */
async function smartAlign() {
  const item = updateDialogSession.value;
  if (!item) return;
  updateDialogBusy.value = true;
  try {
    const res = await store.alignSessionWithAi(item.sessionId);
    if (!res) return;
    if (res.source === "ai") {
      store.state.notice = "AI 智能对齐完成";
    } else if (res.source === "deterministic") {
      store.state.notice = "AI 不可用，已执行确定性对齐";
    } else {
      store.state.notice = res.message || "已是最新版本";
    }
    // 对齐已写回后端，直接继续游玩（编排入口不会再触发对齐）
    updateDialogVisible.value = false;
    updateDialogSession.value = null;
    await store.continueSessionForWorld(item.worldId, item.sessionId);
  } catch (error) {
    store.state.notice = `智能对齐失败: ${error instanceof Error ? error.message : "未知错误"}`;
  } finally {
    updateDialogBusy.value = false;
  }
}
</script>

<template>
  <section class="history-page">
    <div class="history-header">
      <h2 class="history-title">聊过</h2>
      <button class="history-refresh-btn" type="button" @click="store.reloadAll">刷新</button>
    </div>

    <div v-if="sessionListError" class="history-empty">
      <div>会话列表加载失败：{{ sessionListError }}</div>
      <button class="history-refresh-btn" type="button" @click="store.reloadAll">重试</button>
    </div>

    <div v-else-if="!sessions.length" class="history-empty">暂无会话记录</div>

    <div v-else class="history-list">
      <article
        v-for="item in sessions"
        :key="item.sessionId"
        class="history-card"
        @click="store.continueSessionForWorld(item.worldId, item.sessionId)"
      >
        <StoryCover
          :title="item.title || item.worldName || '会话'"
          :cover-path="historyCoverPath(item.sessionId)"
          height="84px"
          variant="plain"
        />
        <div class="history-card-body">
          <h3 class="history-card-title">{{ item.title || item.worldName }}</h3>
          <div class="history-card-meta">{{ item.worldName }}<span v-if="item.chapterTitle"> · {{ item.chapterTitle }}</span></div>
          <p class="history-card-desc">{{ item.latestMessage?.content || item.worldIntro || "点击继续聊" }}</p>
          <div class="history-card-actions">
            <button
              v-if="item.storyUpdated"
              class="history-card-btn story-updated-btn"
              type="button"
              @click.stop="openStoryUpdateDialog(item)"
            >故事已更新</button>
            <button class="history-card-btn" type="button" @click.stop="store.continueSessionForWorld(item.worldId, item.sessionId)">继续</button>
            <button class="history-card-btn" type="button" @click.stop="store.continueSessionForWorld(item.worldId, item.sessionId, { playback: true, playbackIndex: 0 })">观看</button>
            <button class="history-card-btn" type="button" @click.stop="openWorldBookViewer(item)">世界书</button>
            <button class="history-card-icon-btn danger" type="button" aria-label="删除会话" @click.stop="removeSession(item.sessionId, item.title || item.worldName || '未命名会话')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 4h6l1 2h4v2H4V6h4l1-2z"></path>
                <path d="M7 9h10l-1 10a2 2 0 01-2 2H10a2 2 0 01-2-2L7 9z"></path>
              </svg>
            </button>
          </div>
        </div>
      </article>
    </div>

    <!-- 方向2：故事已更新弹框 -->
    <div v-if="updateDialogVisible" class="modal-backdrop" @click.self="closeStoryUpdateDialog">
      <div class="modal-panel story-update-panel">
        <div class="modal-header story-update-header">
          <div class="story-update-title">故事已更新</div>
          <button class="story-update-close" type="button" :disabled="updateDialogBusy" @click="closeStoryUpdateDialog">×</button>
        </div>
        <div class="modal-body story-update-body">
          <p class="story-update-desc">作者发布了新版本，你的存档将切换到新版继续。</p>
          <div class="story-update-section-label">进度对齐预览</div>
          <p class="story-update-align">{{ alignReportSummary(updateDialogSession?.alignReport) }}</p>
          <p v-if="updateDialogSession?.alignReport?.hasUnmatchedRename" class="story-update-hint">
            检测到阶段改名无法精确匹配，可使用 AI 智能对齐尝试语义匹配。
          </p>
          <p v-if="!updateDialogSession?.alignReport?.hasUnmatchedRename" class="story-update-hint">
            可使用 AI 智能对齐尝试语义匹配。
          </p>
        </div>
        <div class="story-update-actions">
          <button class="story-update-btn primary" type="button" :disabled="updateDialogBusy" @click="continueWithAlign">
            {{ updateDialogBusy ? "处理中..." : "继续游玩（发言后自动更新）" }}
          </button>
          <button
            class="story-update-btn"
            type="button"
            :disabled="updateDialogBusy"
            @click="smartAlign"
          >智能对齐*</button>
          <button class="story-update-btn danger" type="button" :disabled="updateDialogBusy" @click="restartFromBeginning">重新开始</button>
        </div>
      </div>
    </div>
    <WorldBookViewerDialog
      :open="worldBookViewerOpen"
      :world-id="worldBookViewerWorldId"
      :world-name="worldBookViewerWorldName"
      @close="worldBookViewerOpen = false"
    />
  </section>
</template>

<style scoped>
.story-updated-btn {
  background: #ff8a3d;
  color: #fff;
  border: none;
  font-weight: 600;
}
.story-updated-btn:hover {
  background: #f4721a;
}

.story-update-panel {
  width: min(100%, 460px);
  border-radius: 20px;
}
.story-update-header {
  padding: 18px 20px 8px;
  position: relative;
  justify-content: center;
}
.story-update-title {
  font-size: 17px;
  font-weight: 700;
  color: #1f2a44;
}
.story-update-close {
  position: absolute;
  right: 14px;
  top: 12px;
  background: transparent;
  border: none;
  font-size: 22px;
  line-height: 1;
  color: #8a93a6;
  cursor: pointer;
}
.story-update-close:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.story-update-body {
  padding: 8px 20px 16px;
}
.story-update-desc {
  margin: 0 0 12px;
  font-size: 14px;
  color: #4a5468;
  line-height: 1.5;
}
.story-update-section-label {
  font-size: 12px;
  color: #8a93a6;
  margin-bottom: 4px;
}
.story-update-align {
  margin: 0 0 8px;
  font-size: 13px;
  color: #2f3a55;
  line-height: 1.6;
  background: #eef2f8;
  border-radius: 10px;
  padding: 10px 12px;
}
.story-update-hint {
  margin: 0;
  font-size: 12px;
  color: #ff8a3d;
}
.story-update-actions {
  display: flex;
  gap: 8px;
  padding: 12px 20px 20px;
  flex-wrap: wrap;
}
.story-update-btn {
  flex: 1 1 auto;
  min-width: 96px;
  padding: 10px 14px;
  border-radius: 12px;
  border: none;
  font-size: 14px;
  font-weight: 600;
  background: #e7ecf5;
  color: #2f3a55;
  cursor: pointer;
}
.story-update-btn.primary {
  background: #4a6cf7;
  color: #fff;
}
.story-update-btn.danger {
  background: #fdecec;
  color: #d64545;
}
.story-update-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
