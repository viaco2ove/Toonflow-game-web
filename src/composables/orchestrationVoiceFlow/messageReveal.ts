/**
 * 消息揭示流程模块
 *
 * 职责：
 * - 等待消息揭示完成（包括流式逐句播放）
 * - 流式台词处理
 * - 静音模式处理
 */
import { computed } from "vue";
import { useToonflowStore } from "../useToonflowStore";
import { WebDebugLogUtil } from "../../utils/WebDebugLogUtil";
import {
  sleep,
  latestMessageByKey,
  messageDisplayContent,
  isStreamingRuntimeMessage,
  isRuntimeRetryMessage,
  runtimeStreamSentences,
  estimateRevealDelayMs,
  canPlayerSpeak,
} from "./textUtils";
import { playMessageAudio } from "./voiceGenPlay";

// ============== Store 延迟获取 ==============
function getStore() {
  return useToonflowStore();
}

// ============== 类型定义 ==============
export type MessageRevealContext = {
  autoVoice?: () => boolean;
  canPlayerSpeak?: () => boolean;
  latestMessageByKey?: (messageKey: string) => any | null;
  messageDisplayContent?: (message: any) => string;
  isStreamingRuntimeMessage?: (message: any) => boolean;
  isRuntimeRetryMessage?: (message: any) => boolean;
  runtimeStreamSentences?: (message: any) => string[];
};

function resolveAutoVoice(context?: MessageRevealContext): boolean {
  const value = context?.autoVoice?.();
  if (typeof value === "boolean") return value;
  return Boolean((getStore().state as any).autoVoice);
}

function resolveCanPlayerSpeak(context?: MessageRevealContext): boolean {
  const value = context?.canPlayerSpeak?.();
  if (typeof value === "boolean") return value;
  return canSpeak();
}

// ============== 消息揭示流程 ==============
/**
 * 等待消息揭示完成（包括流式逐句播放）
 */
export async function waitForMessageReveal(messageKey: string, isCancelled: () => boolean, context?: MessageRevealContext): Promise<void> {
  const getLatest = context?.latestMessageByKey || latestMessageByKey;
  const getContent = context?.messageDisplayContent || messageDisplayContent;
  const isStreamingMsg = context?.isStreamingRuntimeMessage || isStreamingRuntimeMessage;
  const isRetryMsg = context?.isRuntimeRetryMessage || isRuntimeRetryMessage;
  const getSentences = context?.runtimeStreamSentences || runtimeStreamSentences;
  const isAutoVoiceEnabled = () => resolveAutoVoice(context);
  const canSpeak = () => resolveCanPlayerSpeak(context);

  let currentMessage = getLatest(messageKey);
  if (!currentMessage) return;
  if (isRetryMsg(currentMessage)) {
    await sleep(120);
    return;
  }
  getStore().setRuntimeMessageStatus(currentMessage.id, "revealing");
  WebDebugLogUtil.log("[voice时序] waitForMessageReveal revealing", {
    消息id: currentMessage.id,
    消息角色: currentMessage.role,
    消息内容: getContent(currentMessage)?.slice(0, 40),
    是否流式: isStreamingMsg(currentMessage),
    autoVoice: isAutoVoiceEnabled(),
  });
  let streamedSentenceCount = 0;
  let streamedVoicePlayed = false;
  if (isStreamingMsg(currentMessage)) {
    while (!isCancelled()) {
      currentMessage = getLatest(messageKey);
      if (!currentMessage || !isStreamingMsg(currentMessage)) break;
      const sentences = getSentences(currentMessage);
      while (!isCancelled() && isAutoVoiceEnabled() && streamedSentenceCount < sentences.length) {
        const sentence = sentences[streamedSentenceCount];
        streamedSentenceCount += 1;
        if (!sentence) continue;
        getStore().setRuntimeMessageStatus(currentMessage.id, "voicing");
        WebDebugLogUtil.log("[voice时序] 流式逐句播放", {
          消息id: currentMessage.id,
          句序号: streamedSentenceCount,
          句内容: sentence?.slice(0, 30),
        });
        const played = await playMessageAudio(currentMessage, false, true, sentence);
        streamedVoicePlayed = streamedVoicePlayed || played;
      }
      await sleep(120);
    }
    if (isCancelled()) {
      // cancel 时仍需推进状态，否则消息会卡在 voicing 导致后续编排永远不触发
      currentMessage = getLatest(messageKey) || currentMessage;
      if (currentMessage.roleType !== "player") {
        getStore().setRuntimeMessageStatus(currentMessage.id, "waiting_next");
      }
      return;
    }
    currentMessage = getLatest(messageKey) || currentMessage;
    const sentences = getSentences(currentMessage);
    while (!isCancelled() && isAutoVoiceEnabled() && streamedSentenceCount < sentences.length) {
      const sentence = sentences[streamedSentenceCount];
      streamedSentenceCount += 1;
      if (!sentence) continue;
      getStore().setRuntimeMessageStatus(currentMessage.id, "voicing");
      WebDebugLogUtil.log("[voice时序] 流式尾句播放", {
        消息id: currentMessage.id,
        句序号: streamedSentenceCount,
        句内容: sentence?.slice(0, 30),
      });
      const played = await playMessageAudio(currentMessage, false, true, sentence);
      streamedVoicePlayed = streamedVoicePlayed || played;
    }
  }
  currentMessage = getLatest(messageKey) || currentMessage;
  if (currentMessage.roleType === "player") {
    getStore().setRuntimeMessageStatus(currentMessage.id, "waiting_player");
    await sleep(180);
    return;
  }
  // 小游戏模式下，旁白/敌方回合应保持 waiting_next 以触发自动推进
  const isMiniGameActive = getStore().hasActiveMiniGameInCurrentSession();
  const isMiniGameMsg = String(currentMessage.eventType || "").includes("on_mini_game") && String(currentMessage.eventType || "") !== "on_mini_game_finish";
  const miniGameContinue = isMiniGameActive && isMiniGameMsg;
  const nextStatusAfterVoice = (canSpeak() && !miniGameContinue) ? "waiting_player" : "waiting_next";
  if (!isAutoVoiceEnabled()) {
    getStore().setRuntimeMessageStatus(currentMessage.id, nextStatusAfterVoice);
    WebDebugLogUtil.log("[voice时序] 静音模式等待", {
      消息id: currentMessage.id,
      设为状态: nextStatusAfterVoice,
      等待ms: estimateRevealDelayMs(getContent(currentMessage)),
    });
    await sleep(estimateRevealDelayMs(getContent(currentMessage)));
    return;
  }
  if (streamedVoicePlayed || streamedSentenceCount > 0) {
    getStore().setRuntimeMessageStatus(currentMessage.id, nextStatusAfterVoice);
    WebDebugLogUtil.log("[voice时序] 流式播放完成", {
      消息id: currentMessage.id,
      设为状态: nextStatusAfterVoice,
      streamedVoicePlayed,
      streamedSentenceCount,
    });
    await sleep(260);
    return;
  }
  if (isCancelled()) {
    // cancel 时仍需推进状态
    getStore().setRuntimeMessageStatus(currentMessage.id, nextStatusAfterVoice);
    return;
  }
  getStore().setRuntimeMessageStatus(currentMessage.id, "voicing");
  WebDebugLogUtil.log("[voice时序] waitForMessageReveal voicing (非流式)", {
    消息id: currentMessage.id,
    消息角色: currentMessage.role,
    消息内容: getContent(currentMessage)?.slice(0, 40),
  });
  const played = await playMessageAudio(currentMessage, false, true);
  // 即使 cancel 也推进状态，避免消息卡在 voicing
  const nextStatusAfterVoiceFinal = (canSpeak() && !miniGameContinue) ? "waiting_player" : "waiting_next";
  getStore().setRuntimeMessageStatus(currentMessage.id, nextStatusAfterVoiceFinal);
  WebDebugLogUtil.log("[voice时序] waitForMessageReveal 播放完成", {
    消息id: currentMessage.id,
    消息角色: currentMessage.role,
    played,
    设为状态: nextStatusAfterVoiceFinal,
  });
  // 小游戏模式下，旁白语音播放完后需要额外等待一段时间，
  // 确保语音完全播放完后再触发下一轮编排，避免旁白和陪练回合打架。
  // 规则：开语音-》上一个语音播放完（包括失败）-》获取当前台词
  const miniGameExtraWait = 260;
  await sleep(played ? miniGameExtraWait : estimateRevealDelayMs(getContent(currentMessage)));
}