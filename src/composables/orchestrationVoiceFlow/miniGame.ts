/**
 * 小游戏模块
 *
 * 职责：
 * - 小游戏相关业务代码
 * - 管理小游戏模式下的特殊行为
 *
 * ## 小游戏模式特点
 *
 * - 不使用预取机制，严格串行：语音播完 → 等待 → 编排 → 台词 → 语音
 * - 旁白/敌方回合后需要额外等待一段时间，确保语音完全播放完
 * - 每条消息串行处理，避免链式中断语音
 *
 * ## 状态机
 *
 * - miniGameVoiceWaitEnd: 默认 3 秒最小等待
 * - auto_advancing → continueSessionNarrative() → /orchestration/minigame
 */
import { computed } from "vue";
import { useToonflowStore } from "../useToonflowStore";
import { WebDebugLogUtil } from "../../utils/WebDebugLogUtil";
import { sleep } from "./textUtils";

// ============== Store 延迟获取 ==============
function getStore() {
  return useToonflowStore();
}

// ============== 常量 ==============
/** 小游戏模式下语音播放完后的额外等待时间 */
const MINI_GAME_VOICE_EXTRA_WAIT_MS = 260;

// ============== 计算属性 ==============
/** 当前是否有活跃的小游戏 */
export const hasActiveMiniGame = computed(() => getStore().hasActiveMiniGameInCurrentSession());

/** 小游戏最小等待时间 */
export const miniGameVoiceWaitEnd = computed(() => getStore().state.miniGameVoiceWaitEnd ?? 3000);

// ============== 辅助函数 ==============
/**
 * 判断消息是否是小游戏相关事件
 */
export function isMiniGameMessage(eventType: string | undefined | null): boolean {
  if (!eventType) return false;
  return String(eventType).includes("on_mini_game") && String(eventType) !== "on_mini_game_finish";
}

/**
 * 判断小游戏模式下是否需要继续编排
 *
 * 只有旁白/敌方回合才需要继续自动编排
 */
export function shouldMiniGameContinue(eventType: string | undefined | null): boolean {
  if (!hasActiveMiniGame.value) return false;
  return isMiniGameMessage(eventType);
}

/**
 * 获取小游戏模式下的等待时间
 *
 * 规则：开语音-》上一个语音播放完（包括失败）-》获取当前台词
 */
export async function waitMiniGameExtraTime(played: boolean, messageContent: string): Promise<void> {
  if (!hasActiveMiniGame.value) return;

  // 播放成功时使用固定的额外等待时间
  // 播放失败时使用按字数估算的等待时间
  const waitTime = played
    ? MINI_GAME_VOICE_EXTRA_WAIT_MS
    : Math.min(3000, Math.max(1000, messageContent.length * 20));

  WebDebugLogUtil.log("[miniGame] 额外等待", {
    played,
    messageContentLength: messageContent.length,
    waitTime,
  });

  await sleep(waitTime);
}

/**
 * 判断小游戏模式下当前消息是否应该保持 waiting_next
 *
 * 旁白/敌方回合的消息不应被 canPlayerSpeak 强制覆盖为 waiting_player
 */
export function getMiniGameNextStatus(
  eventType: string | undefined | null,
  canSpeak: boolean
): "waiting_next" | "waiting_player" {
  const isMiniGameMsg = isMiniGameMessage(eventType);

  // 旁白/敌方回合始终等待下一位（waiting_next）
  if (hasActiveMiniGame.value && isMiniGameMsg) {
    return "waiting_next";
  }

  // 其他情况按正常逻辑
  return canSpeak ? "waiting_player" : "waiting_next";
}

/**
 * 获取小游戏模式下的语音播放配置
 */
export function getMiniGameVoiceConfig(): {
  /** 是否启用自动语音 */
  enabled: boolean;
  /** 最小等待时间 */
  minWaitTime: number;
  /** 额外等待时间 */
  extraWaitTime: number;
} {
  return {
    enabled: getStore().state.autoVoice,
    minWaitTime: miniGameVoiceWaitEnd.value,
    extraWaitTime: MINI_GAME_VOICE_EXTRA_WAIT_MS,
  };
}

// ============== 导出 composable ==============
export function useMiniGame() {
  return {
    // 计算属性
    hasActiveMiniGame,
    miniGameVoiceWaitEnd,
    // 辅助函数
    isMiniGameMessage,
    shouldMiniGameContinue,
    waitMiniGameExtraTime,
    getMiniGameNextStatus,
    getMiniGameVoiceConfig,
  };
}