import axios from "axios";
import type {
  ApiEnvelope,
  AiModelListMap,
  AiModelMapItem,
  AiTokenUsageLogItem,
  AiTokenUsageStatsItem,
  ChapterItem,
  DebugInitResult,
  DebugRevisitResult,
  DebugNarrativePlan,
  DebugOrchestrationResult,
  DebugStepResult,
  GeneratedImageResult,
  ImportableRoleListResult,
  ImportWorldRoleResult,
  InitChapterResult,
  LocalAvatarMattingStatus,
  MessageItem,
  ModelConfigItem,
  ModelConfigPayload,
  ProjectItem,
  PromptItem,
  RoleAvatarTaskResult,
  SeparatedRoleImageResult,
  SessionDetail,
  SessionNarrativeResult,
  SessionOrchestrationResult,
  StoryRuntimeConfig,
  StoryInitResult,
  StoryInfoResult,
  SessionItem,
  StoryRole,
  UploadedVoiceAudioResult,
  StreamLinesEvent,
  VoiceBindingDraft,
  VoiceModelConfig,
  VoicePresetItem,
  WorldItem,
} from "../types/toonflow";

type RequestConfig = {
  baseUrl: string;
  token: string;
};

function normalizeBaseUrl(input: string): string {
  return String(input || "").trim().replace(/\/+$/, "");
}

function normalizeToken(input: string): string {
  const token = String(input || "").trim();
  if (!token) return "";
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

export class ToonflowApi {
  constructor(private getConfig: () => RequestConfig) {}

  private requestErrorMessage(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const responseData = err.response?.data as Record<string, any> | undefined;
      const message = String(responseData?.message || responseData?.error || "").trim();
      if (message) return message;
    }
    return err instanceof Error ? err.message : "请求失败";
  }

  private headers() {
    const { token } = this.getConfig();
    const auth = normalizeToken(token);
    return auth ? { Authorization: auth } : {};
  }

  private url(path: string): string {
    const { baseUrl } = this.getConfig();
    return `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    try {
      const response = await axios.post<ApiEnvelope<T>>(this.url(path), body ?? {}, {
        headers: this.headers(),
      });
      const envelope = response.data;
      if (typeof envelope?.code !== "number" || envelope.code !== 200) {
        throw new Error(envelope?.message || "请求失败");
      }
      return envelope.data;
    } catch (err) {
      throw new Error(this.requestErrorMessage(err));
    }
  }

  /**
   * 兼容旧接口直接返回裸对象的 POST 请求。
   * 当前主要给章节调试回溯使用，避免后端仍返回 `{ state, messages }`
   * 这种旧格式时，被统一信封校验误判为“请求失败”。
   */
  private async postAcceptEnvelopeOrRaw<T>(path: string, body?: unknown): Promise<T> {
    try {
      const response = await axios.post<ApiEnvelope<T> | T>(this.url(path), body ?? {}, {
        headers: this.headers(),
      });
      const payload = response.data as ApiEnvelope<T> | T;
      if (typeof (payload as ApiEnvelope<T>)?.code === "number") {
        const envelope = payload as ApiEnvelope<T>;
        if (envelope.code !== 200) {
          throw new Error(envelope.message || "请求失败");
        }
        return envelope.data;
      }
      return payload as T;
    } catch (err) {
      throw new Error(this.requestErrorMessage(err));
    }
  }

  private async get<T>(path: string): Promise<T> {
    try {
      const response = await axios.get<ApiEnvelope<T>>(this.url(path), {
        headers: this.headers(),
      });
      const envelope = response.data;
      if (typeof envelope?.code !== "number" || envelope.code !== 200) {
        throw new Error(envelope?.message || "请求失败");
      }
      return envelope.data;
    } catch (err) {
      throw new Error(this.requestErrorMessage(err));
    }
  }

  login(username: string, password: string) {
    return this.post<{ token: string; name: string; id: number }>("/other/login", { username, password });
  }

  register(username: string, password: string) {
    return this.post<{ token: string; name: string; id: number }>("/other/register", { username, password });
  }

  getUser() {
    return this.get<Record<string, unknown>>("/user/getUser");
  }

  saveUser(payload: Record<string, unknown>) {
    return this.post<string>("/user/saveUser", payload);
  }

  changePassword(oldPassword: string, newPassword: string) {
    return this.post<{ message: string }>("/user/changePassword", { oldPassword, newPassword });
  }

  getProjects() {
    return this.post<ProjectItem[]>("/project/getProject", {});
  }

  getWorld(projectId?: number) {
    return this.post<WorldItem | null>("/game/getWorld", {
      projectId: projectId || undefined,
      autoCreate: false,
    });
  }

  getWorldById(worldId: number) {
    return this.post<WorldItem | null>("/game/getWorld", { worldId });
  }

  listWorlds(projectId?: number, includePublicPublished = false) {
    return this.post<WorldItem[]>("/game/listWorlds", {
      projectId: projectId || undefined,
      includePublicPublished: includePublicPublished || undefined,
    });
  }

  saveWorld(payload: Record<string, unknown>) {
    return this.post<WorldItem>("/game/saveWorld", payload);
  }

  /**
   * 复制一个现有故事为全新的草稿副本。
   * 后端会连同封面、章节资源一起复制，返回的新世界与原故事完全独立。
   */
  copyWorld(worldId: number) {
    return this.post<WorldItem>("/game/copyWorld", { worldId });
  }

  /**
   * 查询“其他故事角色”分页列表。
   * 创建页导入角色时只需要服务端过滤和排序好的 NPC 列表。
   */
  listImportableRoles(payload: {
    excludeWorldId?: number;
    worldName?: string;
    roleName?: string;
    page?: number;
    pageSize?: number;
  }) {
    return this.post<ImportableRoleListResult>("/game/listImportableRoles", payload);
  }

  /**
   * 从其他故事导入一个独立角色副本。
   * 后端会复制角色资源文件并返回新的角色对象。
   */
  importWorldRole(sourceWorldId: number, roleId: string) {
    return this.post<ImportWorldRoleResult>("/game/importWorldRole", { sourceWorldId, roleId });
  }

  deleteWorld(worldId: number) {
    return this.post<boolean>("/game/deleteWorld", { worldId });
  }

  getChapter(worldId: number) {
    return this.post<ChapterItem[]>("/game/getChapter", { worldId });
  }

  saveChapter(payload: Record<string, unknown>) {
    return this.post<ChapterItem>("/game/saveChapter", payload);
  }

  previewRuntimeOutline(payload: Record<string, unknown>) {
    return this.post<Record<string, unknown>>("/game/previewRuntimeOutline", payload);
  }

  startSession(payload: Record<string, unknown>) {
    return this.post<{ sessionId: string }>("/game/startSession", payload);
  }

  listSession(projectId?: number, worldId?: number) {
    return this.post<SessionItem[]>("/game/listSession", {
      projectId: projectId || undefined,
      worldId: worldId || undefined,
      limit: 60,
    });
  }

  getSession(sessionId: string) {
    return this.post<SessionDetail>("/game/getSession", {
      sessionId,
      messageLimit: 120,
    });
  }

  deleteSession(sessionId: string) {
    return this.post<boolean>("/game/deleteSession", {
      sessionId,
    });
  }

  deleteMessage(sessionId: string, messageId: number) {
    return this.post<boolean>("/game/deleteMessage", {
      sessionId,
      messageId,
    });
  }

  revisitMessage(sessionId: string, messageId: number) {
    return this.post<boolean>("/game/revisitMessage", {
      sessionId,
      messageId,
    });
  }

  getMessages(sessionId: string) {
    return this.post<MessageItem[]>("/game/getMessage", {
      sessionId,
      limit: 120,
    });
  }

  addMessage(payload: Record<string, unknown>) {
    return this.post<SessionNarrativeResult>("/game/addMessage", payload);
  }

  orchestrateSession(sessionId: string) {
    return this.post<SessionOrchestrationResult>("/game/orchestration", { sessionId });
  }

  /**
   * 显式初始化正式会话的下一章节运行态。
   */
  initChapter(sessionId: string, chapterId?: number | null) {
    return this.post<InitChapterResult>("/game/initchapter", {
      sessionId,
      chapterId: chapterId || undefined,
    });
  }

  commitNarrativeTurn(payload: Record<string, unknown>) {
    return this.post<SessionNarrativeResult>("/game/commitNarrativeTurn", payload);
  }

  continueSession(sessionId: string) {
    return this.post<SessionNarrativeResult>("/game/continueSession", { sessionId });
  }

  debugStep(payload: Record<string, unknown>) {
    return this.post<DebugStepResult>("/game/debugStep", payload);
  }

  introduceDebug(payload: Record<string, unknown>) {
    return this.post<DebugOrchestrationResult>("/game/introduction", payload);
  }

  orchestrateDebug(payload: Record<string, unknown>) {
    return this.post<DebugOrchestrationResult>("/game/orchestration", payload);
  }

  initDebug(payload: Record<string, unknown>) {
    return this.post<DebugInitResult>("/game/initDebug", payload);
  }

  debugRevisitMessage(debugRuntimeKey: string, messageCount: number) {
    return this.postAcceptEnvelopeOrRaw<DebugRevisitResult>("/game/debugRuntimeShared/revisit", {
      debugRuntimeKey,
      messageCount,
    });
  }

  /**
   * 统一的游玩模式初始化接口
   * 合并了 startSession + orchestration 两个接口，减少前端请求次数
   */
  initStory(payload: Record<string, unknown>) {
    return this.post<StoryInitResult>("/game/initStory", payload);
  }

  /**
   * 正式游玩开场白独立请求，避免把开场白计划继续塞回 initStory。
   */
  introduceStory(sessionId: string) {
    return this.post<SessionOrchestrationResult>("/game/introduction", { sessionId });
  }

  /**
   * 统一读取故事运行信息。
   *
   * 用途：
   * - 正式会话和章节调试都通过它拿故事设定、当前章节事件和调试锚点；
   * - 避免继续从 orchestration/streamlines 里读取大杂烩状态。
   */
  storyInfo(payload: Record<string, unknown>) {
    return this.post<StoryInfoResult>("/game/storyInfo", payload);
  }

  async streamDebugLines(
    payload: Record<string, unknown>,
    onEvent: (event: StreamLinesEvent) => void | Promise<void>,
  ): Promise<void> {
    const controller = new AbortController();
    let idleTimer = 0;
    let timedOut = false;
    const resetIdleTimer = () => {
      if (idleTimer) {
        window.clearTimeout(idleTimer);
      }
      idleTimer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 15000);
    };
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const authHeaders = this.headers();
    if (authHeaders.Authorization) {
      headers.Authorization = authHeaders.Authorization;
    }
    try {
      const response = await fetch(this.url("/game/streamlines"), {
        method: "POST",
        headers,
        body: JSON.stringify(payload || {}),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        let message = `HTTP ${response.status}`;
        try {
          message = (await response.text()) || message;
        } catch {
          // noop
        }
        throw new Error(message);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      resetIdleTimer();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        resetIdleTimer();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const text = line.trim();
          if (!text) continue;
          const event = JSON.parse(text) as StreamLinesEvent;
          await onEvent(event);
        }
      }
      const tail = buffer.trim();
      if (tail) {
        const event = JSON.parse(tail) as StreamLinesEvent;
        await onEvent(event);
      }
    } catch (error) {
      if (timedOut) {
        throw new Error("调试台词流空闲超时");
      }
      throw error;
    } finally {
      if (idleTimer) {
        window.clearTimeout(idleTimer);
      }
    }
  }

  generateImage(payload: Record<string, unknown>) {
    return this.post<GeneratedImageResult>("/game/generateImage", payload);
  }

  uploadImage(payload: Record<string, unknown>) {
    return this.post<GeneratedImageResult>("/game/uploadImage", payload);
  }

  convertAvatarVideoToGif(payload: Record<string, unknown>) {
    return this.post<RoleAvatarTaskResult>("/game/convertAvatarVideoToGif", payload);
  }

  getAvatarVideoToGifTask(taskId: number) {
    return this.post<RoleAvatarTaskResult>("/game/convertAvatarVideoToGif/status", { taskId });
  }

  separateRoleAvatar(payload: Record<string, unknown>) {
    return this.post<SeparatedRoleImageResult>("/game/separateRoleAvatar", payload);
  }

  startSeparateRoleAvatarTask(payload: Record<string, unknown>) {
    return this.post<RoleAvatarTaskResult>("/game/separateRoleAvatar", payload);
  }

  getSeparateRoleAvatarTask(taskId: number) {
    return this.post<RoleAvatarTaskResult>("/game/separateRoleAvatar/status", { taskId });
  }

  getLocalAvatarMattingStatus(payload: {
    manufacturer?: string;
    model?: string;
  }) {
    return this.post<LocalAvatarMattingStatus>("/setting/localAvatarMatting/status", payload);
  }

  installLocalAvatarMatting(payload: {
    manufacturer?: string;
    model?: string;
  }) {
    return this.post<LocalAvatarMattingStatus>("/setting/localAvatarMatting/install", payload);
  }

  getVoiceModels() {
    return this.post<VoiceModelConfig[]>("/setting/getVoiceModelList", {});
  }

  getModelConfigs() {
    return this.post<ModelConfigItem[]>("/setting/getSetting", {});
  }

  addModelConfig(payload: ModelConfigPayload) {
    return this.post<string>("/setting/addModel", payload);
  }

  updateModelConfig(payload: ModelConfigPayload) {
    return this.post<string>("/setting/updateModel", payload);
  }

  deleteModelConfig(id: number) {
    return this.post<string>("/setting/delModel", { id });
  }

  getAiModelMap() {
    return this.post<AiModelMapItem[]>("/setting/getAiModelMap", {});
  }

  getAiModelList(type: "text" | "image" | "video" | "voice") {
    return this.post<AiModelListMap>("/setting/getAiModelList", { type });
  }

  getAiTokenUsageLog(payload: Record<string, unknown>) {
    return this.post<AiTokenUsageLogItem[]>("/setting/getAiTokenUsageLog", payload);
  }

  getAiTokenUsageStats(payload: Record<string, unknown>) {
    return this.post<AiTokenUsageStatsItem[]>("/setting/getAiTokenUsageStats", payload);
  }

  bindModelConfig(id: number, configId: number) {
    return this.post<string>("/setting/configurationModel", { id, configId });
  }

  saveStoryRuntimeConfig(payload: StoryRuntimeConfig) {
    return this.post<StoryRuntimeConfig>("/setting/saveStoryRuntimeConfig", payload);
  }

  getPrompts() {
    return this.get<PromptItem[]>("/prompt/getPrompts");
  }

  updatePrompt(id: number, code: string, customValue: string) {
    return this.post<{ message: string }>("/prompt/updatePrompt", { id, code, customValue });
  }

  async getVoicePresets(configId?: number): Promise<VoicePresetItem[]> {
    const data = await this.post<any>("/voice/getVoices", {
      configId: configId || undefined,
    });
    const rawList = Array.isArray(data) ? data : Array.isArray(data?.voices) ? data.voices : [];
    return rawList
      .map((item: any) => {
        if (!item) return null;
        if (typeof item === "string") {
          const voiceId = item.trim();
          return voiceId ? { voiceId, name: voiceId } satisfies VoicePresetItem : null;
        }
        const voiceId = String(item.voice_id || item.voiceId || item.id || item.key || "").trim();
        if (!voiceId) return null;
        const name = String(item.name || item.label || item.voice_name || voiceId).trim() || voiceId;
        const provider = String(item.provider || item.provider_id || "").trim();
        const modes = Array.isArray(item.modes) ? item.modes.map((mode: any) => String(mode || "").trim()).filter(Boolean) : [];
        const description = String(item.description || item.desc || "").trim();
        return { voiceId, name, provider, modes, description } satisfies VoicePresetItem;
      })
      .filter((item: VoicePresetItem | null): item is VoicePresetItem => !!item);
  }

  uploadVoiceAudio(projectId: number | undefined, base64Data: string, fileName: string) {
    return this.post<UploadedVoiceAudioResult>("/voice/uploadAudio", {
      projectId: projectId || undefined,
      base64Data,
      fileName,
    });
  }

  previewVoice(payload: Record<string, unknown>) {
    return this.post<{ audioUrl: string; data: unknown }>("/voice/preview", payload);
  }

  generateVoiceBinding(payload: Record<string, unknown>) {
    return this.post<{
      audioPath: string;
      audioName: string;
      audioUrl: string;
      referenceText: string;
      customVoiceId?: string;
      customVoiceMode?: string;
      requestModel?: string;
      targetModel?: string;
    }>("/voice/generateBindingVoice", payload);
  }

  streamVoice(payload: Record<string, unknown>) {
    return this.post<{ audioUrl: string; data: unknown }>("/game/streamvoice", payload);
  }

  transcribeVoice(payload: Record<string, unknown>) {
    return this.post<{ text: string; segments?: unknown[]; confidence?: number | null }>("/voice/transcribe", payload);
  }

  polishVoicePrompt(payload: {
    text: string;
    configId?: number | null;
    mode?: string;
    provider?: string;
  }) {
    return this.post<{ prompt: string }>("/voice/polishPrompt", {
      text: payload.text,
      configId: payload.configId || undefined,
      mode: payload.mode || undefined,
      provider: payload.provider || undefined,
    });
  }

  polishPrompt(prompt: string) {
    return this.post<{ prompt: string; text: string }>("/assets/polishPrompt", { prompt });
  }

  testTextModel(payload: { modelName: string; apiKey: string; baseURL?: string; manufacturer: string; reasoningEffort?: "minimal" | "low" | "medium" | "high" }) {
    return this.post<string>("/other/testAI", payload);
  }

  testImageModel(payload: { modelName?: string; apiKey: string; baseURL?: string; manufacturer: string }) {
    return this.post<string>("/other/testImage", payload);
  }

  testVoiceDesignModel(payload: { modelName: string; apiKey: string; baseURL?: string; manufacturer: string }) {
    return this.post<string>("/other/testVoiceDesign", payload);
  }
}
