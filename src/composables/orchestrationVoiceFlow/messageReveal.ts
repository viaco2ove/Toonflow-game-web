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
  messageUiKey,
  messageDisplayContent,
  isStreamingRuntimeMessage,
  isRuntimeRetryMessage,
  runtimeStreamSentences,
  estimateRevealDelayMs,
  canPlayerSpeak,
} from "./textUtils";
import { playMessageAudio } from "./voiceGenPlay";
import { setRuntimeVoiceIndicator, clearRuntimeVoiceIndicator } from "./state";
import {
  startMessagePlayback,
  startSentencePlayback,
  finishSentencePlayback,
  handleStreamSentence,
  isAllSentencesPlayed,
  isLastSentencePlayed,
  getMessagePlaybackState,
  endMessagePlayback,
} from "./streamlinesSteamGen";

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

/**
 * 输出消息（开场白/台词）当前的完整文本 + 拆分句子数组 + 每个句子状态
 */
function logMessageSnapshot(tag: string, currentMessage: any, sentences: string[], messageKey: string) {
  const playbackState = getMessagePlaybackState(messageKey);
  // 播放状态表里的 sentences（来自 handleStreamSentence 注册的）
  const recordedSentences = playbackState?.sentences ?? [];
  const sentenceStates = sentences.map((s, idx) => ({
    序号: idx + 1,
    内容: s,
    状态: recordedSentences[idx]?.status ?? "pending",
    已注册播放: !!recordedSentences[idx],
  }));
  WebDebugLogUtil.log(`[snapshot:${tag}]`, {
    消息id: currentMessage?.id,
    消息角色: currentMessage?.role,
    完整文本: currentMessage?.content || "",
    完整文本长度: (currentMessage?.content || "").length,
    拆分句总数: sentences.length,
    已注册播放数: recordedSentences.length,
    已播完: playbackState?.playedCount ?? 0,
    最后一句已播完: playbackState?.lastSentencePlayed ?? false,
    全部已播完: isAllSentencesPlayed(messageKey),
    拆分句列表: sentenceStates,
    timestamp: Date.now(),
  });
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

  WebDebugLogUtil.log("[messageReveal] waitForMessageReveal entry", {
    messageKey,
    autoVoice: isAutoVoiceEnabled(),
    canSpeak: canSpeak(),
  });

  let currentMessage = getLatest(messageKey);
  if (!currentMessage) {
    WebDebugLogUtil.log("[messageReveal] waitForMessageReveal early return: no message", { messageKey });
    return;
  }
  WebDebugLogUtil.log("[messageReveal] waitForMessageReveal got message", {
    messageKey,
    messageId: currentMessage.id,
    role: currentMessage.role,
    roleType: currentMessage.roleType,
    contentLength: (currentMessage.content || "").length,
    contentPreview: (currentMessage.content || "").slice(0, 60),
  });
  if (isRetryMsg(currentMessage)) {
    await sleep(120);
    return;
  }
  getStore().setRuntimeMessageStatus(currentMessage.id, "revealing");
  // 注册一次播放状态（用于追踪每句的 pending/playing/played/failed）
  startMessagePlayback(messageKey);
  // 显示出"加载中"指示器（按字数 / 圆点切换）
  if (isStreamingMsg(currentMessage)) {
    setRuntimeVoiceIndicator(currentMessage, "streaming", messageUiKey(currentMessage));
  }
  WebDebugLogUtil.log("[voice时序] waitForMessageReveal revealing", {
    消息id: currentMessage.id,
    消息角色: currentMessage.role,
    消息内容: getContent(currentMessage)?.slice(0, 40),
    是否流式: isStreamingMsg(currentMessage),
    autoVoice: isAutoVoiceEnabled(),
  });
  // 初始 snapshot
  logMessageSnapshot("revealing", currentMessage, getSentences(currentMessage), messageKey);
  let streamedSentenceCount = 0;
  let streamedVoicePlayed = false;
  if (isStreamingMsg(currentMessage)) {
    while (!isCancelled()) {
      currentMessage = getLatest(messageKey);
      if (!currentMessage) {
        WebDebugLogUtil.log("[voice时序] 流式外层 while break - getLatest 返回 null", { messageKey });
        break;
      }
      if (!isStreamingMsg(currentMessage)) {
        WebDebugLogUtil.log("[voice时序] 流式外层 while break - 消息不再是 streaming 状态", {
          messageKey,
          messageId: currentMessage.id,
          status: (currentMessage as any).meta?.status,
          streaming: (currentMessage as any).meta?.streaming,
          contentLength: (currentMessage.content || "").length,
        });
        break;
      }
      // 流式生成中：每轮 tick 打印一次 snapshot，看到 content / sentences 增量
      logMessageSnapshot("streaming-tick", currentMessage, getSentences(currentMessage), messageKey);
      const sentences = getSentences(currentMessage);
      WebDebugLogUtil.log("[messageReveal] streaming loop", {
        messageId: currentMessage.id,
        isStreaming: isStreamingMsg(currentMessage),
        isCancelled: isCancelled(),
        autoVoice: isAutoVoiceEnabled(),
        sentenceCount: sentences.length,
        streamedSentenceCount,
        sentences: sentences.map(s => s.slice(0, 30)),
      });
      while (!isCancelled() && isAutoVoiceEnabled() && streamedSentenceCount < sentences.length) {
        const sentence = sentences[streamedSentenceCount];
        const sentenceIndex = streamedSentenceCount; // 0-based
        streamedSentenceCount += 1;
        if (!sentence) continue;
        // 把这个 sentence 写入播放状态追踪表（pending）
        handleStreamSentence(sentence, messageKey);
        getStore().setRuntimeMessageStatus(currentMessage.id, "voicing");
        WebDebugLogUtil.log("[voice时序] 流式逐句播放", {
          消息id: currentMessage.id,
          句序号: streamedSentenceCount,
          句内容: sentence?.slice(0, 30),
        });
        startSentencePlayback(messageKey, sentenceIndex);
        WebDebugLogUtil.log("[messageReveal] playMessageAudio start", {
          messageId: currentMessage.id,
          sentenceIndex,
          sentence: sentence?.slice(0, 60),
        });
        const played = await playMessageAudio(currentMessage, false, true, sentence);
        WebDebugLogUtil.log("[messageReveal] playMessageAudio result", {
          messageId: currentMessage.id,
          sentenceIndex,
          played,
        });
        finishSentencePlayback(messageKey, sentenceIndex, played);
        streamedVoicePlayed = streamedVoicePlayed || played;
        logMessageSnapshot(`after-sentence-${sentenceIndex + 1}`, currentMessage, sentences, messageKey);
      }
      await sleep(120);
    }
    if (isCancelled()) {
      // cancel 时仍需推进状态，否则消息会卡在 voicing 导致后续编排永远不触发
      currentMessage = getLatest(messageKey) || currentMessage;
      WebDebugLogUtil.log("[voice打断] waitForMessageReveal cancelled", {
        messageKey,
        消息id: currentMessage?.id,
        位置: "流式分句循环中被取消",
        调用栈: new Error().stack || "no stack",
      });
      if (currentMessage.roleType !== "player") {
        getStore().setRuntimeMessageStatus(currentMessage.id, "waiting_next");
      }
      logMessageSnapshot("cancelled", currentMessage, getSentences(currentMessage), messageKey);
      clearRuntimeVoiceIndicator();
      endMessagePlayback(messageKey);
      return;
    }
    currentMessage = getLatest(messageKey) || currentMessage;
    const sentences = getSentences(currentMessage);
    while (!isCancelled() && isAutoVoiceEnabled() && streamedSentenceCount < sentences.length) {
      const sentence = sentences[streamedSentenceCount];
      const sentenceIndex = streamedSentenceCount;
      streamedSentenceCount += 1;
      if (!sentence) continue;
      handleStreamSentence(sentence, messageKey);
      getStore().setRuntimeMessageStatus(currentMessage.id, "voicing");
      WebDebugLogUtil.log("[voice时序] 流式尾句播放", {
        消息id: currentMessage.id,
        句序号: streamedSentenceCount,
        句内容: sentence?.slice(0, 30),
      });
      startSentencePlayback(messageKey, sentenceIndex);
      const played = await playMessageAudio(currentMessage, false, true, sentence);
      finishSentencePlayback(messageKey, sentenceIndex, played);
      streamedVoicePlayed = streamedVoicePlayed || played;
      logMessageSnapshot(`after-tail-sentence-${sentenceIndex + 1}`, currentMessage, sentences, messageKey);
    }
  }
  currentMessage = getLatest(messageKey) || currentMessage;
  // 如果当前 messageKey 在 store 里已经找不到（比如消息被 commit 替换 id 后），
  // 不要 fallback 到其他 message——那会把这一轮 reveal 的状态错误地写到下一条新消息上，
  // 导致 Watch 立刻触发下一轮编排，造成"上一条语音还没播完就生成下一条"的连锁问题。
  // 这里直接清理并退出，新的消息会由 Watch1 触发新的 reveal 循环来处理。
  if (!currentMessage) {
    WebDebugLogUtil.log("[voice时序] waitForMessageReveal 找不到消息，直接退出", { messageKey });
    clearRuntimeVoiceIndicator();
    endMessagePlayback(messageKey);
    return;
  }
  if (currentMessage.roleType === "player") {
    WebDebugLogUtil.log("[messageReveal] roleType=player, return", {
      messageId: currentMessage.id,
      autoVoice: isAutoVoiceEnabled(),
    });
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
    var delayMs = estimateRevealDelayMs(getContent(currentMessage));
    getStore().setRuntimeMessageStatus(currentMessage.id, nextStatusAfterVoice);
    WebDebugLogUtil.log("[voice时序] 静音模式等待开始", {
      消息id: currentMessage.id,
      设为状态: nextStatusAfterVoice,
      等待ms: delayMs,
    });
    await sleep(delayMs);
     WebDebugLogUtil.log("[voice时序] 静音模式等待结束", {
      消息id: currentMessage.id,
      设为状态: nextStatusAfterVoice,
      等待ms: delayMs,
    });
    // 静音模式也要清理指示器，否则尾部圆点会一直闪
    clearRuntimeVoiceIndicator();
    endMessagePlayback(messageKey);
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
    logMessageSnapshot("stream-done", currentMessage, getSentences(currentMessage), messageKey);
    clearRuntimeVoiceIndicator();
    endMessagePlayback(messageKey);
    await sleep(260);
    return;
  }
  if (isCancelled()) {
    // cancel 时仍需推进状态
    getStore().setRuntimeMessageStatus(currentMessage.id, nextStatusAfterVoice);
    clearRuntimeVoiceIndicator();
    endMessagePlayback(messageKey);
    return;
  }
  getStore().setRuntimeMessageStatus(currentMessage.id, "voicing");
  WebDebugLogUtil.log("[messageReveal] non-streaming voicing", {
    messageId: currentMessage.id,
    role: currentMessage.role,
    roleType: currentMessage.roleType,
    autoVoice: isAutoVoiceEnabled(),
    content: getContent(currentMessage)?.slice(0, 60),
  });
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
  // 全部完成：清掉指示器（金黄色脉冲点停止）
  logMessageSnapshot("non-stream-done", currentMessage, getSentences(currentMessage), messageKey);
  clearRuntimeVoiceIndicator();
  endMessagePlayback(messageKey);
}