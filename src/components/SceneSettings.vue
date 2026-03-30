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
      options: store.settingsConfigOptions(slot.configType),
    };
  }),
);

const storyPrompts = computed(() => store.state.storyPrompts);
const storyPromptRows = computed(() =>
  store.state.storyPrompts.map((prompt) => {
    const meta = storyPromptMeta(prompt.code);
    const isCustom = String(prompt.customValue || "").trim().length > 0;
    return {
      ...prompt,
      meta,
      isCustom,
      statusLabel: isCustom ? "自定义" : "默认值",
      tipText: isCustom ? "*当前使用自定义提示词，点击重置将恢复默认值" : "*当前使用默认提示词，编辑后将保存为自定义值",
    };
  }),
);
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
      <div class="settings-prompt-list">
        <div v-for="prompt in storyPromptRows" :key="prompt.code" class="settings-prompt-card">
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
    </section>

    <section v-if="store.state.token && !isAdmin" class="surface section-block settings-card settings-card--plain">
      <div class="section-title settings-section-title">提示词配置</div>
      <div class="subtle">只有 admin 账号可以编辑 AI 故事提示词。</div>
    </section>

    <section class="surface section-block settings-card settings-card--plain">
      <div class="section-title settings-section-title">其他</div>
      <div class="settings-action-row">
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
        <button class="button primary settings-solid-btn" type="button" @click="submitAccountDialog">
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
</template>
