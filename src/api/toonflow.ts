import axios from "axios";
import type {
  ApiEnvelope,
  AiModelMapItem,
  ChapterItem,
  GeneratedImageResult,
  MessageItem,
  ModelConfigItem,
  ModelConfigPayload,
  ProjectItem,
  PromptItem,
  SessionDetail,
  SessionItem,
  StoryRole,
  UploadedVoiceAudioResult,
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
    const response = await axios.post<ApiEnvelope<T>>(this.url(path), body ?? {}, {
      headers: this.headers(),
    });
    const envelope = response.data;
    if (typeof envelope?.code !== "number" || envelope.code !== 200) {
      throw new Error(envelope?.message || "请求失败");
    }
    return envelope.data;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await axios.get<ApiEnvelope<T>>(this.url(path), {
      headers: this.headers(),
    });
    const envelope = response.data;
    if (typeof envelope?.code !== "number" || envelope.code !== 200) {
      throw new Error(envelope?.message || "请求失败");
    }
    return envelope.data;
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

  listWorlds(projectId?: number) {
    return this.post<WorldItem[]>("/game/listWorlds", {
      projectId: projectId || undefined,
    });
  }

  saveWorld(payload: Record<string, unknown>) {
    return this.post<WorldItem>("/game/saveWorld", payload);
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

  startSession(payload: Record<string, unknown>) {
    return this.post<{ sessionId: string }>("/game/startSession", payload);
  }

  listSession(projectId?: number) {
    return this.post<SessionItem[]>("/game/listSession", {
      projectId: projectId || undefined,
      limit: 60,
    });
  }

  getSession(sessionId: string) {
    return this.post<SessionDetail>("/game/getSession", {
      sessionId,
      messageLimit: 120,
    });
  }

  getMessages(sessionId: string) {
    return this.post<MessageItem[]>("/game/getMessage", {
      sessionId,
      limit: 120,
    });
  }

  addMessage(payload: Record<string, unknown>) {
    return this.post<Record<string, unknown>>("/game/addMessage", payload);
  }

  generateImage(payload: Record<string, unknown>) {
    return this.post<GeneratedImageResult>("/game/generateImage", payload);
  }

  uploadImage(payload: Record<string, unknown>) {
    return this.post<GeneratedImageResult>("/game/uploadImage", payload);
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

  bindModelConfig(id: number, configId: number) {
    return this.post<string>("/setting/configurationModel", { id, configId });
  }

  getPrompts() {
    return this.get<PromptItem[]>("/prompt/getPrompts");
  }

  updatePrompt(id: number, code: string, customValue: string) {
    return this.post<{ message: string }>("/prompt/updatePrompt", { id, code, customValue });
  }

  getVoicePresets(configId?: number) {
    return this.post<VoicePresetItem[]>("/voice/getVoices", {
      configId: configId || undefined,
    });
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

  polishPrompt(prompt: string) {
    return this.post<{ prompt: string; text: string }>("/assets/polishPrompt", { prompt });
  }

  testTextModel(payload: { modelName: string; apiKey: string; baseURL?: string; manufacturer: string }) {
    return this.post<string>("/other/testAI", payload);
  }

  testImageModel(payload: { modelName?: string; apiKey: string; baseURL?: string; manufacturer: string }) {
    return this.post<string>("/other/testImage", payload);
  }
}
