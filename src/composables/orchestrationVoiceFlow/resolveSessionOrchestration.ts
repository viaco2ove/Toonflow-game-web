/**
 * 解析会话编排模块
 *
 * 职责：
 * - 正式编排角色生成台词
 * - 读取当前会话可用的编排结果，优先消费已预取结果，避免语音播完后再白等一轮
 *
 * ## 核心流程
 *
 * 编排NPC-A → 台词A生成完 → prefetch 预编排 NPC-B (后台)
 *   ↓
 * Watch检测到 waiting_next → continueSessionNarrative()
 *   ↓
 * resolveSessionOrchestration() → 复用预取结果 → 台词B生成完
 *   ↓
 * ScenePlay播放语音B → ...
 *
 * ## 预取复用逻辑
 *
 * - 只有当前最新台词对应的预取结果才允许复用
 * - 一旦用户中途发言或会话切换，就强制回退到实时请求
 * - 统一兼容后端只返回顶层 `role/motive` 的最小响应
 */
import { computed } from "vue";
import { useToonflowStore } from "../useToonflowStore";
import { WebDebugLogUtil } from "../../utils/WebDebugLogUtil";
import {
  clearPendingSessionOrchestrationPrefetch,
  canUsePrefetchedOrchestration,
  consumePrefetchedOrchestration,
} from "./prefetchOrchestration";
import type { SessionOrchestrationResult } from "../../types/toonflow";

// ============== Store 延迟获取 ==============
function getStore() {
  return useToonflowStore();
}

// ============== 辅助函数 ==============
/**
 * 把后端"最小编排返回"规范成统一的前端编排结果
 *
 * 用途：
 * - `/game/orchestration` 现在可能只返回顶层 `role/motive`
 * - 正式链和调试链后续仍然统一消费 `result.plan`，因此这里负责做一次包装
 */
export function normalizeSessionOrchestrationResult(result: SessionOrchestrationResult): SessionOrchestrationResult {
  const raw = result as unknown as Record<string, unknown>;

  // 如果有 plan，直接返回
  if (result.plan) {
    return result;
  }

  // 检查 result 本身有没有 role/roleType/motive（即使是空字符串）
  const hasTopLevelRoleMotive =
    raw.role !== undefined ||
    raw.roleType !== undefined ||
    raw.motive !== undefined;

  // 如果顶层有这些字段，包装成 plan
  if (hasTopLevelRoleMotive) {
    const role = String(raw.role || "").trim();
    const roleType = String(raw.roleType || "").trim() || "narrator";
    const motive = String(raw.motive || "").trim();
    const awaitUser = Boolean(raw.awaitUser);

    // 如果顶层字段都空，但 result.plan 不存在，看看能不能从 expectedRole 等推断
    if (!role && !motive && result.expectedRole) {
      return {
        ...result,
        plan: {
          role: result.expectedRole,
          roleType: result.expectedRoleType || "player",
          motive: "等待用户输入",
          awaitUser: true,
        },
      };
    }

    return {
      ...result,
      plan: {
        role,
        roleType,
        motive,
        awaitUser,
      },
    };
  }

  return result;
}

// ============== 核心函数 ==============
/**
 * 读取当前会话可用的编排结果
 *
 * 优先消费已预取结果，避免语音播完后再白等一轮
 */
export async function resolveSessionOrchestration(triggerMessageId: number): Promise<SessionOrchestrationResult> {
  const sessionId = String(getStore().state.currentSessionId || "").trim();

  // 尝试复用预取结果
  if (canUsePrefetchedOrchestration(triggerMessageId)) {
    const pending = await consumePrefetchedOrchestration<SessionOrchestrationResult>(triggerMessageId);
    if (pending) {
      WebDebugLogUtil.log("[resolveSessionOrchestration] 复用预取结果", pending);
      return normalizeSessionOrchestrationResult(pending);
    }
  }

  // 没有预取或预取不匹配，重新请求
  clearPendingSessionOrchestrationPrefetch();
  const result = await getStore().api.orchestrateSession(sessionId);
  WebDebugLogUtil.log("[resolveSessionOrchestration] 实时请求编排结果", result);

  return normalizeSessionOrchestrationResult(result);
}

/**
 * 解析小游戏编排
 *
 * 小游戏编排专用接口：调用 /game/orchestration/minigame 获取下一个 plan
 * 返回完整 plan（含 eventType、presetContent 等），不走 buildMinimalOrchestrationResponse 的裁剪
 */
export async function resolveMinigameOrchestration(): Promise<SessionOrchestrationResult> {
  const sessionId = String(getStore().state.currentSessionId || "").trim();
  if (!sessionId) {
    throw new Error("当前没有活跃会话");
  }

  // 清除预取（小游戏不使用预取机制）
  clearPendingSessionOrchestrationPrefetch();

  const result = await getStore().api.orchestrateMinigameSession(sessionId);
  WebDebugLogUtil.log("[resolveMinigameOrchestration] 小游戏编排结果", result);

  return normalizeSessionOrchestrationResult(result);
}

// ============== 导出 composable ==============
export function useResolveSessionOrchestration() {
  return {
    resolveSessionOrchestration,
    resolveMinigameOrchestration,
    normalizeSessionOrchestrationResult,
  };
}