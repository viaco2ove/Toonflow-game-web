import { getApi, postApi } from "./http";
import type {
  ChapterItem,
  MessageItem,
  MiniGameState,
  ProjectItem,
  SessionDetail,
  SessionItem,
  StoryRole,
  WorldItem,
  WorldSettings,
} from "../types/game";

export function createDefaultMiniGameState(): MiniGameState {
  return {
    gameType: "",
    status: "idle",
    round: 0,
    stage: "",
    winner: "",
    rewards: [],
    notes: "",
  };
}

export function createDefaultWorldSettings(): WorldSettings {
  return {
    roles: [],
    narratorVoice: "默认旁白",
    globalBackground: "",
    chapterExt: {},
    allowRoleView: true,
    allowChatShare: true,
    miniGameState: createDefaultMiniGameState(),
  };
}

export async function getProjects() {
  return postApi<ProjectItem[]>("/project/getProject");
}

export async function loginByPassword(username: string, password: string) {
  return postApi<{ token: string; name: string; id: number }>("/other/login", {
    username,
    password,
  });
}

export async function getCurrentUser() {
  return getApi<Record<string, unknown>>("/user/getUser");
}

export async function getWorldByProject(projectId: number, autoCreate: boolean) {
  const data = await postApi<WorldItem | null>("/game/getWorld", {
    projectId,
    autoCreate,
  });
  if (!data) return null;
  return {
    ...data,
    settings: {
      ...createDefaultWorldSettings(),
      ...(data.settings || {}),
      miniGameState: {
        ...createDefaultMiniGameState(),
        ...((data.settings as WorldSettings | undefined)?.miniGameState || {}),
      },
      roles: Array.isArray((data.settings as WorldSettings | undefined)?.roles)
        ? ((data.settings as WorldSettings).roles as StoryRole[])
        : [],
    },
  };
}

export async function saveWorld(payload: {
  worldId?: number;
  projectId: number;
  name: string;
  intro: string;
  settings: WorldSettings;
  playerRole: StoryRole;
  narratorRole: StoryRole;
}) {
  return postApi<WorldItem>("/game/saveWorld", payload);
}

export async function getChapters(worldId: number) {
  return postApi<ChapterItem[]>("/game/getChapter", { worldId });
}

export async function saveChapter(payload: {
  worldId: number;
  title: string;
  content: string;
  completionCondition: unknown;
}) {
  return postApi<ChapterItem>("/game/saveChapter", payload);
}

export async function startSession(payload: {
  worldId: number;
  projectId: number;
  chapterId: number | null;
}) {
  return postApi<Record<string, unknown>>("/game/startSession", payload);
}

export async function listSessions(payload: {
  projectId?: number;
  worldId?: number;
  limit?: number;
}) {
  return postApi<SessionItem[]>("/game/listSession", payload);
}

export async function getSession(sessionId: string) {
  return postApi<SessionDetail>("/game/getSession", { sessionId, messageLimit: 120 });
}

export async function getMessages(sessionId: string) {
  return postApi<MessageItem[]>("/game/getMessage", { sessionId, limit: 120 });
}

export async function addMessage(payload: {
  sessionId: string;
  roleType: string;
  role: string;
  content: string;
  eventType?: string;
  meta?: Record<string, unknown>;
  attrChanges?: Array<{
    entityType: string;
    entityId?: string;
    field: string;
    value: unknown;
    source?: string;
  }>;
}) {
  return postApi<Record<string, unknown>>("/game/addMessage", payload);
}
