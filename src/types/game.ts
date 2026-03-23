export interface ApiEnvelope<T> {
  code: number;
  data: T;
  message: string;
}

export interface ProjectItem {
  id: number | string;
  name: string;
  intro?: string;
  type?: string;
}

export interface RoleParameterCard {
  name: string;
  raw_setting: string;
  gender: string;
  age: number | null;
  personality: string;
  appearance: string;
  voice: string;
  skills: string[];
  items: string[];
  equipment: string[];
  hp: number;
  mp: number;
  money: number;
  other: string[];
}

export interface StoryRole {
  id: string;
  roleType: "player" | "narrator" | "npc";
  name: string;
  description: string;
  voice: string;
  avatar?: string;
  sample?: string;
  parameterCardJson?: RoleParameterCard;
}

export interface WorldSettings {
  roles: StoryRole[];
  narratorVoice: string;
  globalBackground: string;
  chapterExt: Record<string, unknown>;
  allowRoleView: boolean;
  allowChatShare: boolean;
  miniGameState: MiniGameState;
}

export interface WorldItem {
  id: number;
  projectId: number;
  name: string;
  intro: string;
  settings: WorldSettings;
  playerRole: StoryRole;
  narratorRole: StoryRole;
  chapterCount?: number;
  sessionCount?: number;
}

export interface ChapterItem {
  id: number;
  worldId: number;
  title: string;
  content: string;
  sort: number;
  status: string;
  completionCondition: unknown;
}

export interface MessageItem {
  id: number;
  role: string;
  roleType: string;
  eventType: string;
  content: string;
  meta: Record<string, unknown>;
  createTime: number;
}

export interface SessionItem {
  sessionId: string;
  worldId: number;
  worldName: string;
  chapterId: number | null;
  chapterTitle: string;
  projectId: number | null;
  title: string;
  status: string;
  updateTime: number;
  state: Record<string, unknown>;
  latestMessage: MessageItem | null;
}

export interface SessionDetail {
  sessionId: string;
  worldId: number;
  chapterId: number | null;
  status: string;
  state: Record<string, unknown>;
  world: WorldItem | null;
  chapter: ChapterItem | null;
  messages: MessageItem[];
}

export interface MiniGameState {
  gameType: string;
  status: "idle" | "running" | "finished";
  round: number;
  stage: string;
  winner: string;
  rewards: string[];
  notes: string;
}
