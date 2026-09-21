<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import { ToonflowApi } from "../api/toonflow";
import type { PluginListItem } from "../types/toonflow";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: "update:modelValue", value: boolean): void; (e: "changed"): void }>();

const store = useToonflowStore();

const plugins = ref<PluginListItem[]>([]);
const loading = ref(false);
const installBusy = ref(false);
const installingName = ref("");
const installMessage = ref("");
const actionError = ref("");
const confirmUninstallId = ref("");

const fileInput = ref<HTMLInputElement | null>(null);

function api(): ToonflowApi {
  return new ToonflowApi(() => ({ baseUrl: store.state.baseUrl, token: store.state.token }));
}

function close() {
  emit("update:modelValue", false);
}

async function reload() {
  loading.value = true;
  actionError.value = "";
  try {
    const result = await api().listPlugins();
    plugins.value = result.plugins || [];
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : "加载插件列表失败";
  } finally {
    loading.value = false;
  }
}

// 弹窗打开时立即加载，关闭时不清理（保留数据，下次打开更快）
watch(() => props.modelValue, (open) => {
  if (open) reload();
});

async function pickInstallFile() {
  actionError.value = "";
  installMessage.value = "";
  fileInput.value?.click();
}

async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await installFile(file);
  input.value = "";
}

async function installFile(file: File) {
  installBusy.value = true;
  installingName.value = file.name;
  installMessage.value = "";
  actionError.value = "";
  try {
    const base64Data = await readFileAsBase64(file);
    const result = await api().installPlugin({ fileName: file.name, base64Data });
    installMessage.value = result.upgraded
      ? `已升级 ${result.pluginId} 到 v${result.version}`
      : `已安装 ${result.pluginId} v${result.version}`;
    await reload();
    emit("changed");
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : "安装失败";
  } finally {
    installBusy.value = false;
    installingName.value = "";
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const match = result.match(/base64,(.+)$/s);
      resolve(match ? match[1] : result);
    };
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

async function toggleEnabled(plugin: PluginListItem) {
  actionError.value = "";
  try {
    await api().setPluginEnabled(plugin.pluginId, !plugin.enabled);
    await reload();
    emit("changed");
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : "操作失败";
  }
}

function askUninstall(plugin: PluginListItem) {
  confirmUninstallId.value = plugin.pluginId;
}

function cancelUninstall() {
  confirmUninstallId.value = "";
}

async function doUninstall(plugin: PluginListItem) {
  actionError.value = "";
  try {
    await api().uninstallPlugin(plugin.pluginId);
    confirmUninstallId.value = "";
    await reload();
    emit("changed");
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : "卸载失败";
  }
}

const sortedPlugins = computed(() =>
  [...plugins.value].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.pluginId.localeCompare(b.pluginId)),
);

const enabledCount = computed(() => plugins.value.filter((p) => p.enabled).length);
</script>

<template>
  <div v-if="modelValue" class="modal-backdrop" @click.self="close">
    <section class="modal-panel settings-plugin-modal">
      <div class="modal-header settings-modal-header">
        <div class="modal-title">插件管理</div>
        <button class="icon-btn settings-close-x" type="button" aria-label="关闭" @click="close">×</button>
      </div>

      <div class="modal-body settings-plugin-body">
        <div class="settings-plugin-toolbar">
          <div class="settings-plugin-summary">已安装 {{ plugins.length }} 个 · 启用 {{ enabledCount }} 个</div>
          <div class="settings-plugin-actions">
            <input
              ref="fileInput"
              type="file"
              accept=".tpg,.zip"
              style="display: none"
              @change="onFileChosen"
            />
            <button
              class="button primary settings-solid-btn"
              type="button"
              :disabled="installBusy"
              @click="pickInstallFile"
            >
              {{ installBusy ? `安装中${installingName ? `：${installingName}` : ""}` : "安装插件（.tpg / .zip）" }}
            </button>
            <button class="button settings-outline-btn" type="button" :disabled="loading" @click="reload">
              {{ loading ? "刷新中" : "刷新" }}
            </button>
          </div>
        </div>

        <div v-if="installMessage" class="settings-plugin-tip settings-plugin-tip--ok">{{ installMessage }}</div>
        <div v-if="actionError" class="settings-plugin-tip settings-plugin-tip--err">{{ actionError }}</div>

        <div v-if="!loading && plugins.length === 0" class="settings-plugin-empty">
          还没有安装插件。点击上方按钮上传 .tpg 或 .zip 插件包开始安装。
        </div>

        <div v-else class="settings-plugin-list">
          <div v-for="plugin in sortedPlugins" :key="plugin.pluginId" class="settings-plugin-card" :class="{ 'is-disabled': !plugin.enabled }">
            <div class="settings-plugin-card-main">
              <div class="settings-plugin-name-line">
                <span class="settings-plugin-name">{{ plugin.name }}</span>
                <span class="settings-plugin-version">v{{ plugin.version || "0.0.0" }}</span>
                <span class="settings-plugin-badge" :class="plugin.enabled ? 'is-on' : 'is-off'">
                  {{ plugin.enabled ? "已启用" : "已禁用" }}
                </span>
              </div>
              <div class="settings-plugin-id">{{ plugin.pluginId }}</div>
              <div v-if="plugin.description" class="settings-plugin-desc">{{ plugin.description }}</div>
              <div class="settings-plugin-meta">
                <span v-if="plugin.author">作者：{{ plugin.author }}</span>
                <span v-if="plugin.manifest?.contributes?.minigame">小游戏：{{ plugin.manifest.contributes.minigame.type }}</span>
              </div>
            </div>
            <div class="settings-plugin-card-actions">
              <button
                class="button settings-outline-btn settings-plugin-btn"
                type="button"
                :disabled="installBusy"
                @click="toggleEnabled(plugin)"
              >
                {{ plugin.enabled ? "禁用" : "启用" }}
              </button>
              <button
                v-if="confirmUninstallId !== plugin.pluginId"
                class="button settings-outline-btn settings-plugin-btn settings-plugin-btn--danger"
                type="button"
                :disabled="installBusy"
                @click="askUninstall(plugin)"
              >
                卸载
              </button>
              <template v-else>
                <button
                  class="button settings-solid-btn settings-plugin-btn settings-plugin-btn--danger-solid"
                  type="button"
                  :disabled="installBusy"
                  @click="doUninstall(plugin)"
                >
                  确认卸载
                </button>
                <button
                  class="button settings-outline-btn settings-plugin-btn"
                  type="button"
                  @click="cancelUninstall"
                >
                  取消
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button class="button primary settings-solid-btn" type="button" @click="close">完成</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-plugin-modal {
  width: min(680px, calc(100vw - 32px));
  max-height: min(78vh, 720px);
  display: flex;
  flex-direction: column;
}

.settings-plugin-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.settings-plugin-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.settings-plugin-summary {
  font-size: 13px;
  opacity: 0.75;
}

.settings-plugin-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-plugin-tip {
  font-size: 13px;
  border-radius: 8px;
  padding: 8px 12px;
}

.settings-plugin-tip--ok {
  background: rgba(46, 164, 79, 0.12);
  color: #2ea44f;
}

.settings-plugin-tip--err {
  background: rgba(214, 69, 65, 0.12);
  color: #d64541;
}

.settings-plugin-empty {
  padding: 28px 12px;
  text-align: center;
  font-size: 13px;
  opacity: 0.65;
}

.settings-plugin-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-plugin-card {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(125, 125, 125, 0.25);
  border-radius: 10px;
  padding: 12px 14px;
}

.settings-plugin-card.is-disabled {
  opacity: 0.62;
}

.settings-plugin-card-main {
  min-width: 0;
  flex: 1;
}

.settings-plugin-name-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-plugin-name {
  font-weight: 600;
  font-size: 14px;
}

.settings-plugin-version {
  font-size: 12px;
  opacity: 0.7;
}

.settings-plugin-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
}

.settings-plugin-badge.is-on {
  background: rgba(46, 164, 79, 0.14);
  color: #2ea44f;
  border-color: rgba(46, 164, 79, 0.35);
}

.settings-plugin-badge.is-off {
  background: rgba(125, 125, 125, 0.14);
  color: inherit;
  opacity: 0.8;
  border-color: rgba(125, 125, 125, 0.35);
}

.settings-plugin-id {
  font-size: 11px;
  opacity: 0.55;
  margin-top: 2px;
  word-break: break-all;
}

.settings-plugin-desc {
  font-size: 12px;
  opacity: 0.8;
  margin-top: 6px;
}

.settings-plugin-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 11px;
  opacity: 0.6;
  margin-top: 6px;
}

.settings-plugin-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.settings-plugin-btn {
  min-width: 64px;
}

.settings-plugin-btn--danger {
  color: #d64541;
  border-color: rgba(214, 69, 65, 0.5);
}

.settings-plugin-btn--danger-solid {
  background: #d64541;
  border-color: #d64541;
  color: #fff;
}
</style>
