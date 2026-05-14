<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import SettingsModelManagerDialog from "./SettingsModelManagerDialog.vue";
import { storyPromptMeta } from "../utils/storyPromptCatalog";

const store = useToonflowStore();

type AccountDialogMode = "login" | "register" | "changePassword";

const showAccountDialog = ref(false);
const accountDialogMode = ref<AccountDialogMode>("login");
const revealLoginPassword = ref(false);
const revealRegisterPassword = ref(false);
const revealRegisterConfirm = ref(false);
const revealOldPassword = ref(false);
const revealNewPassword = ref(false);
const dialogUsername = ref(store.state.loginUsername);
const dialogPassword = ref(store.state.loginPassword);
const registerUsername = ref("");
const registerPassword = ref("");
const registerConfirmPassword = ref("");
const oldPassword = ref("");
const newPassword = ref("");
const confirmNewPassword = ref("");
const promptDrafts = reactive<Record<string, string>>({});
const showModelManager = ref(false);
const activeModelKey = ref<string>("");
const showMiniGamePrompts = ref(false);
const showTokenUsageDialog = ref(false);
const tokenUsageStartTime = ref("");
const tokenUsageEndTime = ref("");
const tokenUsageType = ref("");
const tokenUsageGranularity = ref<"hour" | "day" | "month">("day");

const modelRows = computed(() =>
  store.GAME_MODEL_SLOTS.map((slot) => {
    const binding = store.settingsModelBinding(slot.key);
    const recommendation = store.settingsRecommendedModel(slot.key);
    const advisory = store.settingsModelAdvisory(slot.key);
    return {
      ...slot,
      binding,
      recommendation,
      advisory,
      payloadMode: slot.key === "storyOrchestratorModel" ? store.storyOrchestratorPayloadMode() : null,
      options: store.settingsConfigOptions(slot.configType),
    };
  }),
);

const storyPrompts = computed(() => store.state.storyPrompts);
const activeOrchestratorPromptCode = computed(() => (
  store.storyOrchestratorPayloadMode() === "advanced"
    ? "story-orchestrator-advanced"
    : "story-orchestrator-compact"
));
const storyPromptRows = computed(() =>
  store.state.storyPrompts.map((prompt) => {
    const meta = storyPromptMeta(prompt.code);
    const isCustom = String(prompt.customValue || "").trim().length > 0;
    const isCurrentOrchestratorPrompt = prompt.code === activeOrchestratorPromptCode.value;
    const inactiveOrchestratorPrompt = (
      prompt.code === "story-orchestrator-compact" || prompt.code === "story-orchestrator-advanced"
    ) && !isCurrentOrchestratorPrompt;
    return {
      ...prompt,
      meta,
      isCustom,
      isCurrentOrchestratorPrompt,
      inactiveOrchestratorPrompt,
      statusLabel: isCustom ? "自定义" : "默认值",
      tipText: inactiveOrchestratorPrompt
        ? "*当前未生效；切换编排师运行模式后才会使用这条提示词"
        : isCustom
          ? "*当前使用自定义提示词，点击重置将恢复默认值"
          : "*当前使用默认值，编辑后将保存为自定义值",
    };
  }),
);
const miniGamePromptCodes = new Set([
  "story-mini-game",
  "story-mini-game-battle",
  "story-mini-game-fishing",
  "story-mini-game-werewolf",
  "story-mini-game-cultivation",
  "story-mini-game-mining",
  "story-mini-game-research-skill",
  "story-mini-game-alchemy",
  "story-mini-game-upgrade-equipment",
]);
const baseStoryPromptRows = computed(() => storyPromptRows.value.filter((prompt) => !miniGamePromptCodes.has(prompt.code)));
const miniGameStoryPromptRows = computed(() => storyPromptRows.value.filter((prompt) => miniGamePromptCodes.has(prompt.code)));
const isAdmin = computed(() => store.isAdminAccount());

function syncPromptDrafts() {
  for (const item of store.state.storyPrompts) {
    promptDrafts[item.code] = store.currentStoryPromptValue(item.code);
  }
}

function openAccountDialog(mode: AccountDialogMode) {
  accountDialogMode.value = mode;
  dialogUsername.value = store.state.loginUsername;
  dialogPassword.value = "";
  registerUsername.value = "";
  registerPassword.value = "";
  registerConfirmPassword.value = "";
  oldPassword.value = "";
  newPassword.value = "";
  confirmNewPassword.value = "";
  showAccountDialog.value = true;
}

async function submitAccountDialog() {
  if (accountDialogMode.value === "login") {
    store.state.loginUsername = dialogUsername.value.trim();
    store.state.loginPassword = dialogPassword.value;
    await store.loginAndSaveToken();
    if (store.state.token) {
      await store.ensureSettingsPanelData(true);
      syncPromptDrafts();
      showAccountDialog.value = false;
    }
    return;
  }

  if (accountDialogMode.value === "register") {
    if (registerPassword.value !== registerConfirmPassword.value) {
      store.state.notice = "两次输入的密码不一致";
      return;
    }
    await store.registerAndLogin(registerUsername.value.trim(), registerPassword.value);
    if (store.state.token) {
      await store.ensureSettingsPanelData(true);
      syncPromptDrafts();
      showAccountDialog.value = false;
    }
    return;
  }

  if (newPassword.value !== confirmNewPassword.value) {
    store.state.notice = "两次输入的新密码不一致";
    return;
  }
  await store.changePassword(oldPassword.value, newPassword.value);
  showAccountDialog.value = false;
}

async function openModelManager(key: string) {
  await store.ensureSettingsPanelData(true);
  activeModelKey.value = key;
  showModelManager.value = true;
}

async function applyRecommendedModel(key: string) {
  await store.bindRecommendedGameModel(key);
}

async function changeStoryOrchestratorPayloadMode(value: string) {
  await store.saveStoryOrchestratorPayloadMode(value === "advanced" ? "advanced" : "compact");
}

function onModelManagerConfirmed() {
  activeModelKey.value = "";
}

async function savePrompt(code: string) {
  await store.saveStoryPrompt(code, String(promptDrafts[code] || ""));
}

async function resetPrompt(code: string) {
  await store.resetStoryPrompt(code);
  syncPromptDrafts();
}

function checkUpdate() {
  store.state.notice = "当前为开发版，暂未接入在线更新";
}

function formatTokenUsageTime(input: number | string | undefined) {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    return new Date(input).toLocaleString();
  }
  return String(input || "").trim() || "-";
}

function formatTokenUsageAmount(amount: number | undefined, currency?: string) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value <= 0) return `${currency || "CNY"} 0`;
  return `${currency || "CNY"} ${value.toFixed(6).replace(/\.?0+$/, "")}`;
}

function stringifyTokenUsageMeta(input: unknown) {
  if (!input || typeof input !== "object") return "";
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input || "");
  }
}

function tokenUsageMetaValue(row: { meta?: Record<string, unknown> | null }, path: string[]) {
  let current: unknown = row.meta || null;
  for (const key of path) {
    if (!current || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : "";
}

async function loadTokenUsagePanel() {
  await store.loadAiTokenUsagePanel({
    startTime: tokenUsageStartTime.value,
    endTime: tokenUsageEndTime.value,
    type: tokenUsageType.value,
    granularity: tokenUsageGranularity.value,
  });
}

async function openTokenUsageDialog() {
  showTokenUsageDialog.value = true;
  await loadTokenUsagePanel();
}

onMounted(async () => {
  if (store.state.token) {
    await store.ensureSettingsPanelData();
    syncPromptDrafts();
  }
});

watch(
  () => store.state.storyPrompts,
  () => syncPromptDrafts(),
  { deep: true },
);
</script>

<template>
  <main class="settings-page">
    <section class="settings-header">
      <div class="settings-page-title">设置</div>
      <button class="settings-back-btn" type="button" @click="store.setTab('my')">返回</button>
    </section>

    <section class="surface section-block settings-card settings-card--plain">
      <div class="section-title settings-section-title">请求地址配置</div>
      <div class="field">
        <label>API 地址</label>
        <input v-model="store.state.baseUrl" class="input" type="text" placeholder="http://127.0.0.1:60002" />
      </div>
      <div class="settings-action-row">
        <button class="button primary settings-solid-btn" type="button" @click="store.saveConnection">保存连接</button>
      </div>
    </section>

    <section class="surface section-block settings-card settings-card--plain">
      <div class="section-title settings-section-title">账号设置</div>
      <div class="settings-status-row">登录状态：{{ store.state.token ? `已登录（${store.state.userName || '未知账号'}）` : '未登录' }}</div>
      <div class="subtle" v-if="store.state.token">当前账号的头像、模型配置、AI 故事提示词与 ai 漫剧资源完全隔离。</div>
      <div class="settings-action-row" v-if="!store.state.token">
        <button class="button primary settings-solid-btn" type="button" @click="openAccountDialog('login')">登录 / 注册</button>
      </div>
      <div class="settings-action-row" v-else>
        <button class="button settings-outline-btn" type="button" @click="openAccountDialog('changePassword')">修改密码</button>
        <button class="button settings-danger-btn" type="button" @click="store.clearToken">退出登录</button>
      </div>
    </section>

    <section v-if="store.state.token" class="surface section-block settings-card settings-card--plain">
      <div class="section-title settings-section-title">模型配置</div>
      <div class="settings-model-list">
        <div v-for="row in modelRows" :key="row.key" class="settings-model-row">
          <div class="settings-model-copy">
            <div class="settings-model-label">{{ row.label }}</div>
            <div class="settings-model-meta">{{ row.binding?.manufacturer || '未绑定' }} {{ row.binding?.model || '' }}</div>
            <div v-if="row.key === 'storyOrchestratorModel'" class="settings-model-inline-option">
              <span class="settings-model-inline-label">运行模式</span>
              <select
                class="input settings-model-inline-select"
                :value="row.payloadMode || 'compact'"
                @change="changeStoryOrchestratorPayloadMode(String(($event.target as HTMLSelectElement | null)?.value || 'compact'))"
              >
                <option
                  v-for="item in store.STORY_ORCHESTRATOR_PAYLOAD_OPTIONS"
                  :key="item.value"
                  :value="item.value"
                >
                  {{ item.label }}
                </option>
              </select>
            </div>
            <div
              v-if="row.recommendation"
              class="settings-model-recommend"
            >
              推荐：{{ row.recommendation.manufacturer || '未知厂商' }} {{ row.recommendation.model || '' }}
            </div>
            <div
              v-if="row.advisory"
              class="settings-model-advisory"
              :class="`settings-model-advisory--${row.advisory.tone}`"
            >
              {{ row.advisory.text }}
            </div>
          </div>
          <div class="settings-model-actions">
            <button
              v-if="row.recommendation && row.binding?.configId !== row.recommendation.id"
              class="button settings-outline-btn settings-picker-btn"
              type="button"
              @click="applyRecommendedModel(row.key)"
            >
              用推荐
            </button>
            <button class="button primary settings-picker-btn settings-solid-btn" type="button" @click="openModelManager(row.key)">
              配置接口
            </button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="store.state.token && isAdmin" class="surface section-block settings-card settings-card--plain">
      <div class="section-title settings-section-title">提示词配置</div>
      <div class="settings-action-row settings-mini-game-agent-row">
        <button class="button settings-outline-btn" type="button" @click="showMiniGamePrompts = !showMiniGamePrompts">
          小游戏Agent
        </button>
      </div>
      <div class="settings-prompt-list">
        <div v-for="prompt in baseStoryPromptRows" :key="prompt.code" class="settings-prompt-card">
          <div class="settings-prompt-head">
            <div class="settings-prompt-heading">
              <div class="settings-prompt-title">{{ prompt.name || prompt.code }}</div>
              <span class="settings-prompt-status" :class="{ custom: prompt.isCustom }">{{ prompt.statusLabel }}</span>
              <span
                v-if="prompt.code === 'story-orchestrator-compact' || prompt.code === 'story-orchestrator-advanced'"
                class="settings-prompt-status"
                :class="{ custom: prompt.isCurrentOrchestratorPrompt }"
              >
                {{ prompt.isCurrentOrchestratorPrompt ? '当前生效' : '未生效' }}
              </span>
            </div>
            <div class="settings-prompt-actions">
              <button class="button small settings-prompt-secondary-btn" type="button" @click="resetPrompt(prompt.code)">重置提示词</button>
              <button class="button small settings-solid-btn settings-prompt-save-btn" type="button" @click="savePrompt(prompt.code)">保存</button>
            </div>
          </div>
          <div class="settings-prompt-inline-meta">
            <span class="settings-prompt-pill settings-prompt-pill--label">Agent</span>
            <span class="settings-prompt-pill settings-prompt-pill--value">{{ prompt.meta.agentLabel }}</span>
            <span class="settings-prompt-pill settings-prompt-pill--label">TS</span>
            <span class="settings-prompt-pill settings-prompt-pill--value settings-prompt-pill--path">{{ prompt.meta.tsLabel }}</span>
          </div>
          <textarea
            v-model="promptDrafts[prompt.code]"
            class="input settings-prompt-textarea"
            rows="6"
            :placeholder="prompt.defaultValue || '请输入提示词'"
          />
          <div class="settings-prompt-tip">{{ prompt.tipText }}</div>
        </div>
        <div v-if="showMiniGamePrompts" class="settings-mini-game-prompt-group">
          <div class="settings-mini-game-prompt-title">小游戏Agent 提示词</div>
          <div v-for="prompt in miniGameStoryPromptRows" :key="prompt.code" class="settings-prompt-card">
            <div class="settings-prompt-head">
              <div class="settings-prompt-heading">
                <div class="settings-prompt-title">{{ prompt.name || prompt.code }}</div>
                <span class="settings-prompt-status" :class="{ custom: prompt.isCustom }">{{ prompt.statusLabel }}</span>
              </div>
              <div class="settings-prompt-actions">
                <button class="button small settings-prompt-secondary-btn" type="button" @click="resetPrompt(prompt.code)">重置提示词</button>
                <button class="button small settings-solid-btn settings-prompt-save-btn" type="button" @click="savePrompt(prompt.code)">保存</button>
              </div>
            </div>
            <div class="settings-prompt-inline-meta">
              <span class="settings-prompt-pill settings-prompt-pill--label">Agent</span>
              <span class="settings-prompt-pill settings-prompt-pill--value">{{ prompt.meta.agentLabel }}</span>
              <span class="settings-prompt-pill settings-prompt-pill--label">TS</span>
              <span class="settings-prompt-pill settings-prompt-pill--value settings-prompt-pill--path">{{ prompt.meta.tsLabel }}</span>
            </div>
            <textarea
              v-model="promptDrafts[prompt.code]"
              class="input settings-prompt-textarea"
              rows="6"
              :placeholder="prompt.defaultValue || '请输入提示词'"
            />
            <div class="settings-prompt-tip">{{ prompt.tipText }}</div>
          </div>
        </div>
      </div>
    </section>

    <section v-if="store.state.token && !isAdmin" class="surface section-block settings-card settings-card--plain">
      <div class="section-title settings-section-title">提示词配置</div>
      <div class="subtle">只有 admin 账号可以编辑 AI 故事提示词。</div>
    </section>

    <section class="surface section-block settings-card settings-card--plain">
      <div class="section-title settings-section-title">其他</div>
      <div class="settings-action-row">
        <button v-if="store.state.token" class="button settings-outline-btn" type="button" @click="openTokenUsageDialog">token消耗</button>
        <button class="button settings-outline-btn" type="button" @click="checkUpdate">检查更新</button>
      </div>
    </section>
  </main>

  <div v-if="showAccountDialog" class="modal-backdrop" @click.self="showAccountDialog = false">
    <section class="modal-panel settings-account-modal">
      <div class="modal-header settings-modal-header">
        <div class="modal-title">{{ accountDialogMode === 'changePassword' ? '修改密码' : '账号登录' }}</div>
        <button class="icon-btn settings-close-x" type="button" aria-label="关闭" @click="showAccountDialog = false">×</button>
      </div>
      <div class="modal-body settings-account-body">
        <div class="settings-auth-tabs">
          <button class="settings-auth-tab" :class="{ active: accountDialogMode === 'login' }" type="button" @click="accountDialogMode = 'login'">登录</button>
          <button class="settings-auth-tab" :class="{ active: accountDialogMode === 'register' }" type="button" @click="accountDialogMode = 'register'">注册</button>
          <button v-if="store.state.token" class="settings-auth-tab" :class="{ active: accountDialogMode === 'changePassword' }" type="button" @click="accountDialogMode = 'changePassword'">改密</button>
        </div>

        <div class="field">
          <label>API 地址</label>
          <input v-model="store.state.baseUrl" class="input" type="text" placeholder="http://127.0.0.1:60002" />
        </div>

        <template v-if="accountDialogMode === 'login'">
          <div class="field">
            <label>账号</label>
            <input v-model="dialogUsername" class="input" type="text" placeholder="请输入账号" />
          </div>
          <div class="field">
            <label>密码</label>
            <div class="settings-password-row">
              <input v-model="dialogPassword" class="input" :type="revealLoginPassword ? 'text' : 'password'" placeholder="请输入密码" />
              <button class="button settings-outline-btn" type="button" @click="revealLoginPassword = !revealLoginPassword">{{ revealLoginPassword ? '隐藏' : '显示' }}</button>
            </div>
          </div>
        </template>

        <template v-else-if="accountDialogMode === 'register'">
          <div class="field">
            <label>账号</label>
            <input v-model="registerUsername" class="input" type="text" placeholder="请输入新账号" />
          </div>
          <div class="field">
            <label>密码</label>
            <div class="settings-password-row">
              <input v-model="registerPassword" class="input" :type="revealRegisterPassword ? 'text' : 'password'" placeholder="请输入密码" />
              <button class="button settings-outline-btn" type="button" @click="revealRegisterPassword = !revealRegisterPassword">{{ revealRegisterPassword ? '隐藏' : '显示' }}</button>
            </div>
          </div>
          <div class="field">
            <label>确认密码</label>
            <div class="settings-password-row">
              <input v-model="registerConfirmPassword" class="input" :type="revealRegisterConfirm ? 'text' : 'password'" placeholder="请再次输入密码" />
              <button class="button settings-outline-btn" type="button" @click="revealRegisterConfirm = !revealRegisterConfirm">{{ revealRegisterConfirm ? '隐藏' : '显示' }}</button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="field">
            <label>原密码</label>
            <div class="settings-password-row">
              <input v-model="oldPassword" class="input" :type="revealOldPassword ? 'text' : 'password'" placeholder="请输入原密码" />
              <button class="button settings-outline-btn" type="button" @click="revealOldPassword = !revealOldPassword">{{ revealOldPassword ? '隐藏' : '显示' }}</button>
            </div>
          </div>
          <div class="field">
            <label>新密码</label>
            <div class="settings-password-row">
              <input v-model="newPassword" class="input" :type="revealNewPassword ? 'text' : 'password'" placeholder="请输入新密码" />
              <button class="button settings-outline-btn" type="button" @click="revealNewPassword = !revealNewPassword">{{ revealNewPassword ? '隐藏' : '显示' }}</button>
            </div>
          </div>
          <div class="field">
            <label>确认新密码</label>
            <input v-model="confirmNewPassword" class="input" type="password" placeholder="请再次输入新密码" />
          </div>
        </template>
      </div>
      <div class="modal-footer">
        <button class="button primary settings-solid-btn settings-solid-btn-login" type="button" @click="submitAccountDialog">
          {{ accountDialogMode === 'login' ? '登录' : accountDialogMode === 'register' ? '注册' : '确认修改' }}
        </button>
      </div>
    </section>
  </div>

  <SettingsModelManagerDialog
    v-if="store.GAME_MODEL_SLOTS.find((item) => item.key === activeModelKey)"
    v-model="showModelManager"
    :slot-key="store.GAME_MODEL_SLOTS.find((item) => item.key === activeModelKey)?.key || ''"
    :slot-label="store.GAME_MODEL_SLOTS.find((item) => item.key === activeModelKey)?.label || '模型配置'"
    :config-type="store.GAME_MODEL_SLOTS.find((item) => item.key === activeModelKey)?.configType || 'text'"
    :selected-id="store.settingsModelBinding(activeModelKey)?.configId || null"
    @confirmed="onModelManagerConfirmed"
  />

  <div v-if="showTokenUsageDialog" class="modal-backdrop" @click.self="showTokenUsageDialog = false">
    <section class="modal-panel settings-account-modal">
      <div class="modal-header settings-modal-header">
        <div class="modal-title">token消耗</div>
        <button class="icon-btn settings-close-x" type="button" aria-label="关闭" @click="showTokenUsageDialog = false">×</button>
      </div>
      <div class="modal-body settings-account-body">
        <div class="field">
          <label>开始时间</label>
          <input v-model="tokenUsageStartTime" class="input" type="datetime-local" />
        </div>
        <div class="field">
          <label>结束时间</label>
          <input v-model="tokenUsageEndTime" class="input" type="datetime-local" />
        </div>
        <div class="field">
          <label>业务类型</label>
          <input v-model="tokenUsageType" class="input" type="text" placeholder="如：编排师 / 角色发言 / 记忆管理" />
        </div>
        <div class="field">
          <label>统计类型</label>
          <select v-model="tokenUsageGranularity" class="input">
            <option value="hour">按时</option>
            <option value="day">按日</option>
            <option value="month">按月</option>
          </select>
        </div>
        <div class="settings-action-row">
          <button class="button primary settings-solid-btn" type="button" @click="loadTokenUsagePanel">
            {{ store.state.settingsTokenUsageLoading ? '加载中...' : '查询' }}
          </button>
        </div>
        <div class="section-title settings-section-title">日志明细</div>
        <div class="subtle" v-if="!store.state.settingsTokenUsageLogs.length">暂无 token 消耗日志</div>
        <div v-for="row in store.state.settingsTokenUsageLogs" :key="row.id" class="surface section-block settings-card settings-card--plain">
          <div><strong>时间：</strong>{{ formatTokenUsageTime(row.createTime) }}</div>
          <div><strong>业务类型：</strong>{{ row.type || '-' }}</div>
          <div><strong>模型：</strong>{{ row.model || '-' }}</div>
          <div><strong>渠道：</strong>{{ row.channel || row.manufacturer || '-' }}</div>
          <div><strong>输入 tokens：</strong>{{ row.inputTokens || 0 }}</div>
          <div><strong>输出 tokens：</strong>{{ row.outputTokens || 0 }}</div>
          <div><strong>推理 tokens：</strong>{{ row.reasoningTokens || 0 }}</div>
          <div><strong>缓存读取 tokens：</strong>{{ row.cacheReadTokens || 0 }}</div>
          <div><strong>总 tokens：</strong>{{ row.totalTokens || 0 }}</div>
          <div><strong>金额：</strong>{{ formatTokenUsageAmount(row.amount, row.currency) }}</div>
          <div><strong>备注：</strong>{{ row.remark || '-' }}</div>
          <div><strong>推理强度：</strong>{{ tokenUsageMetaValue(row, ['reasoningEffort']) || '-' }}</div>
          <div><strong>阶段：</strong>{{ tokenUsageMetaValue(row, ['stage']) || '-' }}</div>
          <details v-if="row.meta" class="settings-token-meta">
            <summary>查看调用审计</summary>
            <div class="subtle">这里包含请求提示词快照、返回内容快照和 usage 拆分。</div>
            <pre class="settings-token-meta-pre">{{ stringifyTokenUsageMeta(row.meta) }}</pre>
          </details>
        </div>
        <div class="section-title settings-section-title">统计</div>
        <div class="subtle" v-if="!store.state.settingsTokenUsageStats.length">暂无 token 统计数据</div>
        <div
          v-for="row in store.state.settingsTokenUsageStats"
          :key="`${row.bucketTime}-${row.type}-${row.model}-${row.channel}`"
          class="surface section-block settings-card settings-card--plain"
        >
          <div><strong>时间：</strong>{{ formatTokenUsageTime(row.bucketTime) }}</div>
          <div><strong>业务类型：</strong>{{ row.type || '-' }}</div>
          <div><strong>模型：</strong>{{ row.model || '-' }}</div>
          <div><strong>渠道：</strong>{{ row.channel || row.manufacturer || '-' }}</div>
          <div><strong>输入 tokens：</strong>{{ row.inputTokens || 0 }}</div>
          <div><strong>输出 tokens：</strong>{{ row.outputTokens || 0 }}</div>
          <div><strong>推理 tokens：</strong>{{ row.reasoningTokens || 0 }}</div>
          <div><strong>缓存读取 tokens：</strong>{{ row.cacheReadTokens || 0 }}</div>
          <div><strong>总 tokens：</strong>{{ row.totalTokens || 0 }}</div>
          <div><strong>调用次数：</strong>{{ row.callCount || 0 }}</div>
          <div><strong>金额：</strong>{{ formatTokenUsageAmount(row.amount, row.currency) }}</div>
          <div><strong>备注：</strong>{{ row.remark || '-' }}</div>
        </div>
      </div>
    </section>
  </div>
</template>
