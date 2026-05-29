<template>
  <div class="voice-input-panel" :class="panelClass">
    <!-- 录音中提示文字 -->
    <div v-if="isRecording && !isCancelled" class="voice-hints">
      <span class="hint-cancel">上移取消</span>
      <span class="hint-mode">{{ voiceMode === 'action' ? '(动作)' : '侧移输入(动作、场景)' }}</span>
    </div>

    <!-- 实时识别文字 -->
    <div v-if="isRecording && partialText && !isCancelled" class="voice-partial-text">
      {{ partialText }}
    </div>

    <!-- 语音按钮 -->
    <button
      ref="voiceBtn"
      class="voice-btn"
      :class="buttonClass"
      :disabled="disabled"
      @click="!isAndroidApp ? onClickStart() : undefined"
      @touchstart.prevent="isAndroidApp ? onTouchStart($event) : undefined"
      @touchmove.prevent="isAndroidApp ? onTouchMove($event) : undefined"
      @touchend.prevent="isAndroidApp ? onTouchEnd() : undefined"
    >
      <template v-if="isCancelled">
        <svg viewBox="0 0 24 24" class="voice-icon">
          <path d="M7 7l10 10"></path>
          <path d="M17 7 7 17"></path>
        </svg>
        <span>松开取消</span>
      </template>
      <template v-else-if="isRecording">
        <span class="recording-dot"></span>
        <span>{{ voiceMode === 'action' ? '(动作)' : '录音中...' }}</span>
      </template>
      <template v-else>
        <svg viewBox="0 0 24 24" class="voice-icon">
          <path d="M12 5a2.8 2.8 0 0 1 2.8 2.8v4.4a2.8 2.8 0 1 1-5.6 0V7.8A2.8 2.8 0 0 1 12 5z"></path>
          <path d="M7.8 11.8a4.2 4.2 0 0 0 8.4 0"></path>
          <path d="M12 16v3"></path>
          <path d="M9.5 19h5"></path>
        </svg>
        <span>{{ isAndroidApp ? '按住说话' : (isRecording ? '结束并发送' : '点击说话') }}</span>
      </template>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";

const props = defineProps<{
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "send", text: string, mode: "dialogue" | "action"): void;
  (e: "start"): void;
  (e: "cancel"): void;
  (e: "modeChange", mode: "dialogue" | "action"): void;
}>();

const isRecording = ref(false);
const isCancelled = ref(false);
const voiceMode = ref<"dialogue" | "action">("dialogue");
const partialText = ref("");

const startX = ref(0);
const startY = ref(0);

// 检测是否为 Android App WebView（通过 AndroidBridge 判断）
const isAndroidApp = computed(() => {
  if (typeof window === "undefined") return false;
  return !!(window as any).AndroidBridge;
});

// 检测是否支持原生语音
const hasNativeVoice = computed(() => {
  if (typeof window === "undefined") return false;
  return !!(window as any).AndroidBridge?.isVoiceRecognitionAvailable?.();
});

// 面板样式
const panelClass = computed(() => ({
  "panel-recording": isRecording.value && !isCancelled.value,
  "panel-cancelled": isCancelled.value,
}));

// 按钮样式
const buttonClass = computed(() => ({
  "btn-dialogue": isRecording.value && voiceMode.value === "dialogue" && !isCancelled.value,
  "btn-action": isRecording.value && voiceMode.value === "action" && !isCancelled.value,
  "btn-cancelled": isCancelled.value,
}));

// 原生语音识别事件处理
function setupNativeVoiceListeners() {
  if (typeof window === "undefined") return;

  window.addEventListener("speechresult", handleSpeechResult as EventListener);
  window.addEventListener("speechpartial", handleSpeechPartial as EventListener);
  window.addEventListener("speechstart", handleSpeechStart as EventListener);
  window.addEventListener("speechend", handleSpeechEnd as EventListener);
  window.addEventListener("speecherror", handleSpeechError as EventListener);
}

function teardownNativeVoiceListeners() {
  if (typeof window === "undefined") return;

  window.removeEventListener("speechresult", handleSpeechResult as EventListener);
  window.removeEventListener("speechpartial", handleSpeechPartial as EventListener);
  window.removeEventListener("speechstart", handleSpeechStart as EventListener);
  window.removeEventListener("speechend", handleSpeechEnd as EventListener);
  window.removeEventListener("speecherror", handleSpeechError as EventListener);
}

function handleSpeechResult(e: Event) {
  const customEvent = e as CustomEvent;
  const text = customEvent.detail || "";
  partialText.value = "";
  if (text && !isCancelled.value) {
    const finalText = voiceMode.value === "action" ? `(${text})` : text;
    emit("send", finalText, voiceMode.value);
  }
}

function handleSpeechPartial(e: Event) {
  const customEvent = e as CustomEvent;
  partialText.value = customEvent.detail || "";
}

function handleSpeechStart() {
  isRecording.value = true;
  emit("start");
}

function handleSpeechEnd() {
  isRecording.value = false;
}

function handleSpeechError(e: Event) {
  const customEvent = e as CustomEvent;
  console.error("语音识别错误:", customEvent.detail);
  isRecording.value = false;
  partialText.value = "";
}

// 触摸事件处理
function onTouchStart(e: TouchEvent) {
  if (props.disabled) return;
  const touch = e.touches[0];
  startX.value = touch.clientX;
  startY.value = touch.clientY;
  startRecording();
}

function onTouchMove(e: TouchEvent) {
  if (!isRecording.value) return;
  const touch = e.touches[0];
  const dx = touch.clientX - startX.value;
  const dy = touch.clientY - startY.value;
  updateSlideDirection(dx, dy);
}

function onTouchEnd() {
  stopRecording();
}

function updateSlideDirection(dx: number, dy: number) {
  const threshold = 60;

  // 上滑检测（取消）
  if (dy < -threshold) {
    isCancelled.value = true;
    return;
  }

  // 左右滑动检测（切换模式）
  if (Math.abs(dx) > threshold && dy > -threshold / 2) {
    const newMode = dx > 0 ? "dialogue" : "action";
    if (newMode !== voiceMode.value) {
      voiceMode.value = newMode;
      emit("modeChange", newMode);
    }
  }

  isCancelled.value = false;
}

function startRecording() {
  isRecording.value = true;
  isCancelled.value = false;
  voiceMode.value = "dialogue"; // 默认台词模式
  partialText.value = "";

  if (hasNativeVoice.value) {
    try {
      (window as any).AndroidBridge.startVoiceRecognition();
    } catch (e) {
      console.error("启动原生语音识别失败:", e);
      emit("start");
    }
  } else {
    emit("start");
  }
}

function stopRecording() {
  if (isCancelled.value) {
    emit("cancel");
    if (hasNativeVoice.value) {
      try {
        (window as any).AndroidBridge.stopVoiceRecognition();
      } catch {}
    }
  } else if (isRecording.value) {
    if (hasNativeVoice.value) {
      try {
        (window as any).AndroidBridge.stopVoiceRecognition();
      } catch {}
    }
  }

  isRecording.value = false;
  isCancelled.value = false;
  partialText.value = "";
}

// 非Android App 点击开始/结束录音
function onClickStart() {
  if (props.disabled) return;

  if (isRecording.value) {
    emit("send", partialText.value, voiceMode.value);
    isRecording.value = false;
    partialText.value = "";
  } else {
    startRecording();
  }
}

defineExpose({
  stop: stopRecording,
  isRecording: () => isRecording.value,
});

onMounted(() => {
  setupNativeVoiceListeners();
});

onUnmounted(() => {
  teardownNativeVoiceListeners();
});
</script>

<style scoped>
.voice-input-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  min-height: 80px;
  background: var(--card, #fff);
  border-radius: 16px;
  transition: background 0.2s ease;
  touch-action: none;
  user-select: none;
}

.voice-input-panel.panel-recording {
  background: var(--card, #fff);
}

.voice-input-panel.panel-cancelled {
  background: var(--danger, #cb4d4d);
}

.voice-hints {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--text-soft, #5f6f86);
}

.hint-cancel {
  opacity: 0.7;
}

.hint-mode {
  opacity: 0.5;
}

.voice-partial-text {
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 12px;
  text-align: center;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text, #1b2434);
}

.voice-btn {
  width: 100%;
  max-width: 300px;
  height: 52px;
  border: none;
  border-radius: 26px;
  background: #1b2434; /* 台词模式：黑色 */
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  touch-action: none;
}

.voice-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 台词模式：黑色背景 */
.voice-btn.btn-dialogue {
  background: #1b2434;
  color: #fff;
}

/* 动作模式：白色背景 */
.voice-btn.btn-action {
  background: #fff;
  color: #1b2434;
  border: 2px solid var(--primary, #2458d8);
}

.voice-btn.btn-cancelled {
  background: rgba(255, 255, 255, 0.2);
}

.voice-icon {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.recording-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.5; }
}
</style>