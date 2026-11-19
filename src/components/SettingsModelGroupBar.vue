<script setup lang="ts">
/**
 * 设置页「模型配置」卡片顶部的模型组操作条。
 * 功能：可搜索下拉快速切换模型组 + 保存（新建/覆盖）+ 重命名/备注 + 删除。
 * 数据与操作全部来自全局 store（settingsModelGroups 及对应 action）。
 */
import { computed, ref } from "vue";
import { useToonflowStore } from "../composables/useToonflowStore";
import type { ModelGroupItem } from "../types/toonflow";

const store = useToonflowStore();

// ===== 下拉（组合框）状态 =====
const dropdownOpen = ref(false);
const searchText = ref("");
const selectWrapRef = ref<HTMLDivElement | null>(null);

// 当前应用的模型组对象
const activeGroup = computed<ModelGroupItem | null>(() => {
  const id = store.state.settingsActiveModelGroupId;
  if (!id) return null;
  return store.state.settingsModelGroups.find((item) => item.id === id) || null;
});

// 搜索过滤：按名称/备注模糊匹配
const filteredGroups = computed<ModelGroupItem[]>(() => {
  const keyword = searchText.value.trim().toLowerCase();
  if (!keyword) return store.state.settingsModelGroups;
  return store.state.settingsModelGroups.filter(
    (item) =>
      String(item.name || "").toLowerCase().includes(keyword) ||
      String(item.remark || "").toLowerCase().includes(keyword),
  );
});

// 输入框显示内容：聚焦时显示搜索词，失焦显示当前组名
const selectInputValue = computed(() => (dropdownOpen.value ? searchText.value : activeGroup.value?.name || ""));

function openDropdown() {
  dropdownOpen.value = true;
  searchText.value = "";
}

function closeDropdown() {
  dropdownOpen.value = false;
  searchText.value = "";
}

// 点击外部关闭下拉
function onSelectWrapBlur(event: FocusEvent) {
  const next = event.relatedTarget as Node | null;
  if (selectWrapRef.value && next && selectWrapRef.value.contains(next)) return;
  closeDropdown();
}

// 选择模型组 → 立即应用切换
async function onSelectGroup(item: ModelGroupItem) {
  closeDropdown();
  try {
    await store.applySettingsModelGroup(item.id);
  } catch (err) {
    store.state.notice = `切换模型组失败: ${(err as Error).message}`;
  }
}

// ===== 保存 / 编辑弹窗状态 =====
// mode: create=另存为新组；overwrite=覆盖保存到已有组；rename=仅改名称/备注
const dialogOpen = ref(false);
const dialogMode = ref<"create" | "overwrite" | "rename">("create");
const dialogTargetId = ref<number | null>(null);
const formName = ref("");
const formRemark = ref("");
const submitting = ref(false);

const dialogTitle = computed(() => {
  if (dialogMode.value === "rename") return "编辑模型组信息";
  if (dialogMode.value === "overwrite") return "覆盖保存模型组";
  return "保存为新的模型组";
});

// 打开保存弹窗：已有应用中的组时默认覆盖保存，否则新建
function openSaveDialog() {
  const active = activeGroup.value;
  if (active) {
    dialogMode.value = "overwrite";
    dialogTargetId.value = active.id;
    formName.value = active.name;
    formRemark.value = String(active.remark || "");
  } else {
    dialogMode.value = "create";
    dialogTargetId.value = null;
    formName.value = "";
    formRemark.value = "";
  }
  dialogOpen.value = true;
}

// 从下拉项进入「仅改信息」模式
function openRenameDialog(item: ModelGroupItem) {
  closeDropdown();
  dialogMode.value = "rename";
  dialogTargetId.value = item.id;
  formName.value = item.name;
  formRemark.value = String(item.remark || "");
  dialogOpen.value = true;
}

function closeDialog() {
  dialogOpen.value = false;
  submitting.value = false;
}

// 提交弹窗：按模式分发到对应 action
async function submitDialog() {
  const name = formName.value.trim();
  if (!name) {
    store.state.notice = "请填写模型组名称";
    return;
  }
  submitting.value = true;
  try {
    if (dialogMode.value === "rename" && dialogTargetId.value) {
      await store.updateSettingsModelGroupInfo({ id: dialogTargetId.value, name, remark: formRemark.value.trim() });
    } else if (dialogMode.value === "overwrite" && dialogTargetId.value) {
      await store.saveSettingsModelGroup({ id: dialogTargetId.value, name, remark: formRemark.value.trim() });
    } else {
      await store.saveSettingsModelGroup({ name, remark: formRemark.value.trim() });
    }
    closeDialog();
  } catch (err) {
    store.state.notice = `保存模型组失败: ${(err as Error).message}`;
    submitting.value = false;
  }
}

// ===== 删除（下拉项内二次点击确认） =====
const pendingDeleteId = ref<number | null>(null);

function onDeleteClick(item: ModelGroupItem) {
  // 第一次点击进入确认态，再次点击才真正删除，防误触
  if (pendingDeleteId.value !== item.id) {
    pendingDeleteId.value = item.id;
    return;
  }
  pendingDeleteId.value = null;
  void confirmDelete(item);
}

async function confirmDelete(item: ModelGroupItem) {
  try {
    await store.deleteSettingsModelGroup(item.id);
  } catch (err) {
    store.state.notice = `删除模型组失败: ${(err as Error).message}`;
  }
}
</script>

<template>
  <div class="settings-model-group-bar">
    <!-- 可搜索下拉：快速切换模型组 -->
    <div
      ref="selectWrapRef"
      class="settings-model-group-select"
      tabindex="-1"
      @focusout="onSelectWrapBlur"
    >
      <input
        class="input settings-model-group-input"
        type="text"
        :value="selectInputValue"
        :placeholder="store.state.settingsModelGroups.length ? '搜索/选择模型组…' : '暂无模型组，可保存当前配置'"
        @focus="openDropdown"
        @input="searchText = String(($event.target as HTMLInputElement | null)?.value || '')"
      >
      <div v-if="dropdownOpen" class="settings-model-group-menu">
        <div
          v-for="item in filteredGroups"
          :key="item.id"
          class="settings-model-group-option"
          :class="{ 'is-active': item.id === store.state.settingsActiveModelGroupId }"
          @mousedown.prevent="onSelectGroup(item)"
        >
          <div class="settings-model-group-copy">
            <div class="settings-model-group-name">{{ item.name }}</div>
            <div v-if="item.remark" class="settings-model-group-remark">{{ item.remark }}</div>
          </div>
          <div class="settings-model-group-ops">
            <button
              class="icon-btn settings-model-group-op"
              type="button"
              title="编辑名称/备注"
              @mousedown.prevent.stop="openRenameDialog(item)"
            >
              ✎
            </button>
            <button
              class="icon-btn settings-model-group-op settings-model-group-op--danger"
              :class="{ 'is-confirm': pendingDeleteId === item.id }"
              type="button"
              :title="pendingDeleteId === item.id ? '再次点击确认删除' : '删除模型组'"
              @mousedown.prevent.stop="onDeleteClick(item)"
            >
              {{ pendingDeleteId === item.id ? "确认" : "×" }}
            </button>
          </div>
        </div>
        <div v-if="!filteredGroups.length" class="settings-model-group-empty">没有匹配的模型组</div>
      </div>
    </div>

    <!-- 保存按钮：新建 / 覆盖保存当前全部模型配置 -->
    <button class="button primary settings-picker-btn settings-solid-btn" type="button" @click="openSaveDialog">
      保存模型组
    </button>

    <!-- 保存/编辑弹窗 -->
    <div v-if="dialogOpen" class="modal-backdrop" @click.self="closeDialog">
      <section class="modal-panel settings-account-modal settings-model-group-modal">
        <div class="modal-header settings-modal-header">
          <div class="modal-title">{{ dialogTitle }}</div>
          <button class="icon-btn settings-close-x" type="button" aria-label="关闭" @click="closeDialog">×</button>
        </div>
        <div class="modal-body settings-account-body">
          <!-- 覆盖保存模式下可切换为另存新组 -->
          <div v-if="activeGroup && dialogMode !== 'rename'" class="field">
            <label>保存方式</label>
            <div class="settings-model-group-mode">
              <label class="settings-model-group-mode-item">
                <input
                  v-model="dialogMode"
                  type="radio"
                  value="overwrite"
                >
                <span>覆盖保存到「{{ activeGroup.name }}」</span>
              </label>
              <label class="settings-model-group-mode-item">
                <input
                  v-model="dialogMode"
                  type="radio"
                  value="create"
                >
                <span>另存为新模型组</span>
              </label>
            </div>
            <div class="settings-field-hint">覆盖保存会把当前全部模型配置写入该组；另存会保留原组并新建一组。</div>
          </div>
          <div class="field">
            <label>名称</label>
            <input
              v-model="formName"
              class="input"
              type="text"
              placeholder="必填，例如：高性价比配置"
              @keyup.enter="submitDialog"
            >
          </div>
          <div class="field">
            <label>备注</label>
            <input
              v-model="formRemark"
              class="input"
              type="text"
              placeholder="可选，填写该模型组的备注信息"
            >
          </div>
          <div v-if="dialogMode !== 'rename'" class="settings-field-hint">
            将保存当前全部模型槽位配置与编排师/记忆管理运行模式。
          </div>
        </div>
        <div class="modal-actions">
          <button class="button settings-outline-btn" type="button" @click="closeDialog">取消</button>
          <button
            class="button primary settings-solid-btn"
            type="button"
            :disabled="submitting"
            @click="submitDialog"
          >
            {{ submitting ? "保存中…" : "保存" }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
