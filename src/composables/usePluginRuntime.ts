/**
 * 插件运行时 composable
 *
 * 职责：
 * - 拉取当前用户已启用的插件清单
 * - 解码 manifest，产出可被 UI 直接消费的派生数据：
 *   - sidebarCommands: #命令面板里的「插件」分组项
 *   - minigameContributes: 所有插件贡献的 minigame（type → PluginListItem）
 *   - resolveIframeUrl(pluginId, relPath): 通过后端 /plugin/getAsset 拼出 iframe URL
 * - 暴露 reload() 给 UI 主动刷新（安装/卸载后调用）
 *
 * 设计取舍：
 * - 不在此处执行 entry.js 注入。entry.js 由插件 UI 自行通过 iframe 加载，
 *   主进程通过 window.postMessage 与插件交互（见 pluginBridge.ts）。
 * - 插件列表短（一般 < 20 个），不缓存到 localStorage，每次进入会话时拉一次即可。
 */
import { computed, ref, shallowRef } from "vue";
import { useToonflowStore } from "./useToonflowStore";
import { ToonflowApi } from "../api/toonflow";
import type {
  PluginListItem,
  PluginManifest,
  PluginMinigameContribute,
  PluginSidebarItem,
} from "../types/toonflow";

// ====== 类型：UI 直接消费 ======
export interface PluginSidebarCommand {
  /** 命令面板 id，与现有 CommandOption.id 同空间，加 plugin_ 前缀避免冲突 */
  id: string;
  label: string;
  desc: string;
  icon: string;
  /** 用户选中时拼到输入框的文本（已含前缀空格），如 "#野外生存 " */
  insertText: string;
  /** 来源插件 pluginId（plugin:<id>），便于点击时定位到哪个插件 */
  pluginId: string;
  /** 来源 sidebar 项 id，便于插件内处理 */
  sourceId: string;
}

export interface ResolvedPluginMinigame {
  pluginId: string;
  type: string;
  title: string;
  entry: string;
  width: number;
  height: number;
  fullscreen: boolean;
  item: PluginListItem;
}

// ====== 模块级单例状态 ======
const items = shallowRef<PluginListItem[]>([]);
const loading = ref(false);
const lastLoadedAt = ref<number>(0);
const error = ref<string | null>(null);

// ====== 工具 ======
function decodeName(v: unknown, fallback: string): string {
  if (!v) return fallback;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as { fallback?: string; $t?: string };
    return o.fallback || o.$t || fallback;
  }
  return fallback;
}

function getIcon(icon: string | undefined): string {
  // 简单的 emoji 兜底。Orson 字体图标由调用方自己解析。
  const map: Record<string, string> = {
    gamepad: "🎮",
    sword: "⚔️",
    fishing: "🎣",
    cultivation: "🧘",
    mining: "⛏️",
    shop: "🏪",
    backpack: "🎒",
    map: "🗺️",
    quest: "📜",
  };
  if (!icon) return "🧩";
  return map[icon] || "🧩";
}

function api(): ToonflowApi {
  const store = useToonflowStore();
  return new ToonflowApi(() => ({ baseUrl: store.state.baseUrl, token: store.state.token }));
}

// ====== API ======
async function reload(force = false): Promise<void> {
  const now = Date.now();
  // 30 秒内不重复拉，除非强制
  if (!force && items.value.length > 0 && now - lastLoadedAt.value < 30_000) return;
  loading.value = true;
  error.value = null;
  try {
    const result = await api().listPlugins();
    items.value = (result.plugins || []).filter((p) => p.enabled && p.manifest);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    items.value = [];
  } finally {
    loading.value = false;
    lastLoadedAt.value = now;
  }
}

function clear(): void {
  items.value = [];
  lastLoadedAt.value = 0;
  error.value = null;
}

// ====== 派生数据 ======
const enabledPlugins = computed<PluginListItem[]>(() => items.value);

const sidebarCommands = computed<PluginSidebarCommand[]>(() => {
  const out: PluginSidebarCommand[] = [];
  for (const p of items.value) {
    const sidebar = p.manifest?.contributes?.sidebar;
    if (!Array.isArray(sidebar)) continue;
    for (const s of sidebar) {
      if (!s || !s.id || !s.label) continue;
      // 默认行为：把 label 当作命令插入（与现有小游戏/战斗等同构）
      const cmdText = s.command && s.command.trim().length > 0
        ? s.command.replace(/^#/, "") // 去掉自带前缀，由 selectCommand 统一加
        : s.label;
      out.push({
        id: `plugin_${p.pluginId.replace(/\W+/g, "_")}_${s.id}`,
        label: s.label,
        desc: `来自插件：${decodeName(p.manifest?.name, p.name)}`,
        icon: getIcon(s.icon),
        insertText: `#${cmdText} `,
        pluginId: p.pluginId,
        sourceId: s.id,
      });
    }
  }
  return out;
});

const minigameContributes = computed<ResolvedPluginMinigame[]>(() => {
  const out: ResolvedPluginMinigame[] = [];
  for (const p of items.value) {
    const m = p.manifest?.contributes?.minigame;
    if (!m || !m.type || !m.entry) continue;
    out.push({
      pluginId: p.pluginId,
      type: m.type,
      title: decodeName(m.title ?? p.manifest?.name, p.name),
      entry: m.entry,
      width: Number(m.width) || 960,
      height: Number(m.height) || 640,
      fullscreen: Boolean(m.fullscreen),
      item: p,
    });
  }
  return out;
});

/** 通过 type 反查 minigame（前端 MiniGameController 调度时使用） */
function findMinigameByType(type: string): ResolvedPluginMinigame | undefined {
  return minigameContributes.value.find((m) => m.type === type);
}

/** 拼 iframe URL：带 token 的 GET 资源 */
function resolveIframeUrl(pluginId: string, relPath: string): string {
  return api().pluginAssetUrl(pluginId, relPath);
}

// ====== Composable 入口 ======
export function usePluginRuntime() {
  return {
    // 状态
    items: enabledPlugins,
    sidebarCommands,
    minigameContributes,
    loading,
    error,
    lastLoadedAt,
    // 操作
    reload,
    clear,
    // 工具
    findMinigameByType,
    resolveIframeUrl,
    decodeName,
  };
}

// ====== 单例 store hook（外部组件直接使用，避免每个组件都 new 一份） ======
export const pluginRuntime = {
  items: enabledPlugins,
  sidebarCommands,
  minigameContributes,
  loading,
  error,
  reload,
  clear,
  findMinigameByType,
  resolveIframeUrl,
  decodeName,
};
