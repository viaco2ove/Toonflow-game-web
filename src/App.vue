<template>
  <div class="v3-root">
    <div class="phone-shell">
      <div class="phone-screen">
        <div class="android-status">
          <span>{{ statusTime }}</span>
          <span>5G • 100%</span>
        </div>

        <div v-if="notice.text" :class="['notice', notice.type]">{{ notice.text }}</div>

        <section v-if="activeTab === 'home'" class="view home-view">
          <div class="hero-bg"></div>
          <div class="home-corner-actions">
            <button class="corner-btn" @click="activeTab = 'hall'">大厅</button>
            <button class="corner-btn" @click="reloadAll">刷新</button>
          </div>
          <div class="home-content">
            <article v-if="randomWorld" class="glass-card">
              <h2>{{ randomWorld.name }}</h2>
              <p>{{ randomWorld.intro || "随机推荐故事，点击可直接进入游玩。" }}</p>
              <div class="meta">
                <span>章节 {{ randomWorld.chapterCount || 0 }}</span>
                <span>会话 {{ randomWorld.sessionCount || 0 }}</span>
                <span>项目 {{ projectNameMap.get(randomWorld.projectId) || "-" }}</span>
              </div>
            </article>
            <article v-else class="glass-card">
              <h2>暂无推荐</h2>
              <p>当前账号还没有可游玩的故事。</p>
            </article>

            <textarea
              v-model.trim="quickInput"
              class="voice-input"
              rows="3"
              placeholder="输入一句开场白，发送后会进入“聊过”记录" />
            <button class="voice-btn" :disabled="busy.startSession || !randomWorld" @click="quickStartPlay">
              开始游玩
            </button>

            <article class="panel-card">
              <div class="section-title">最近聊过</div>
              <div v-if="recentSessions.length" class="list">
                <button
                  v-for="item in recentSessions"
                  :key="item.sessionId"
                  class="list-item"
                  @click="openSession(item.sessionId)">
                  <div class="list-head">
                    <strong>{{ item.title || item.worldName }}</strong>
                    <span>{{ formatTime(item.updateTime) }}</span>
                  </div>
                  <p>{{ item.latestMessage?.content || "暂无内容" }}</p>
                </button>
              </div>
              <p v-else class="empty">暂无会话记录</p>
            </article>
          </div>
        </section>

        <section v-else-if="activeTab === 'hall'" class="view scroll-view">
          <div class="sub-head">
            <button class="mini-btn" @click="activeTab = 'home'">返回</button>
            <h2>故事大厅</h2>
            <span></span>
          </div>
          <div class="panel-card">
            <input v-model.trim="hallKeyword" class="input" placeholder="搜索故事名 / 项目名" />
            <select v-model="hallCategory" class="input">
              <option value="all">全部</option>
              <option value="hasChapter">有章节</option>
              <option value="noChapter">未配置章节</option>
            </select>
          </div>
          <div v-if="filteredWorlds.length" class="world-grid">
            <article v-for="item in filteredWorlds" :key="item.id" class="world-card">
              <h3>{{ item.name }}</h3>
              <p>{{ item.intro || "暂无简介" }}</p>
              <div class="meta">
                <span>章节 {{ item.chapterCount || 0 }}</span>
                <span>会话 {{ item.sessionCount || 0 }}</span>
              </div>
              <div class="row-end">
                <button class="mini-btn primary" @click="playFromWorld(item)">游玩</button>
                <button class="mini-btn" @click="jumpToCreate(item.projectId)">编辑</button>
              </div>
            </article>
          </div>
          <p v-else class="empty">无匹配故事</p>
        </section>

        <section v-else-if="activeTab === 'create'" class="view scroll-view">
          <div class="sub-head">
            <h2>创建故事</h2>
            <button class="mini-btn" @click="reloadAll">刷新</button>
          </div>

          <article class="panel-card">
            <div class="section-title">项目</div>
            <select v-model.number="selectedProjectId" class="input">
              <option :value="-1">请选择项目</option>
              <option v-for="item in projects" :key="item.id" :value="Number(item.id)">{{ item.name }}</option>
            </select>
          </article>

          <article class="panel-card">
            <div class="section-title">世界观</div>
            <label class="label">世界名称</label>
            <input v-model.trim="worldForm.name" class="input" />
            <label class="label">世界简介</label>
            <textarea v-model.trim="worldForm.intro" class="input textarea" rows="3"></textarea>

            <label class="label">用户名（固定角色）</label>
            <input v-model.trim="worldForm.playerRole.name" class="input" />
            <label class="label">用户音色</label>
            <input v-model.trim="worldForm.playerRole.voice" class="input" />
            <label class="label">用户角色设定</label>
            <textarea v-model.trim="worldForm.playerRole.description" class="input textarea" rows="3"></textarea>

            <label class="label">旁白名称</label>
            <input v-model.trim="worldForm.narratorRole.name" class="input" />
            <label class="label">旁白音色</label>
            <input v-model.trim="worldForm.narratorVoice" class="input" />

            <label class="label">全局背景</label>
            <textarea v-model.trim="worldForm.globalBackground" class="input textarea" rows="4"></textarea>
            <div class="chips">
              <button
                v-for="role in mentionRoleNames"
                :key="`global_${role}`"
                class="chip"
                type="button"
                @click="appendGlobalMention(role)">
                {{ role }}
              </button>
            </div>

            <div class="switches">
              <label class="switch-row">
                <span>他人可查看角色设定</span>
                <input v-model="worldForm.allowRoleView" type="checkbox" />
              </label>
              <label class="switch-row">
                <span>他人可分享对话剧情</span>
                <input v-model="worldForm.allowChatShare" type="checkbox" />
              </label>
            </div>

            <div class="row-end">
              <button class="mini-btn primary" :disabled="busy.saveWorld" @click="saveWorldConfig">保存世界观</button>
            </div>
          </article>

          <article class="panel-card">
            <div class="section-title">角色（用户固定，旁白单独）</div>
            <div v-for="(role, index) in worldForm.npcRoles" :key="role.id" class="role-card">
              <div class="list-head">
                <strong>角色 {{ index + 1 }}</strong>
                <button class="mini-btn danger" @click="removeNpcRole(index)">删除</button>
              </div>
              <label class="label">角色名</label>
              <input v-model.trim="role.name" class="input" />
              <label class="label">角色设定</label>
              <textarea v-model.trim="role.description" class="input textarea" rows="3"></textarea>
              <label class="label">角色音色</label>
              <input v-model.trim="role.voice" class="input" />
              <label class="label">台词示例</label>
              <input v-model.trim="role.sample" class="input" />
            </div>
            <button class="mini-btn" @click="addNpcRole">新增角色</button>
          </article>

          <article class="panel-card">
            <div class="section-title">章节</div>
            <label class="label">章节标题</label>
            <input v-model.trim="chapterForm.title" class="input" />
            <label class="label">章节内容</label>
            <textarea v-model.trim="chapterForm.content" class="input textarea" rows="4"></textarea>
            <div class="chips">
              <button
                v-for="role in mentionRoleNames"
                :key="`chapter_${role}`"
                class="chip"
                type="button"
                @click="appendChapterMention(role)">
                {{ role }}
              </button>
            </div>
            <label class="label">章节结局条件（JSON）</label>
            <textarea v-model.trim="chapterForm.completionConditionText" class="input textarea" rows="3"></textarea>
            <div class="row-end">
              <button class="mini-btn primary" :disabled="busy.saveChapter" @click="addChapter">新增章节</button>
            </div>

            <div v-if="chapters.length" class="list">
              <button
                v-for="item in chapters"
                :key="item.id"
                :class="['list-item', { active: selectedChapterId === item.id }]"
                @click="selectedChapterId = item.id">
                <div class="list-head">
                  <strong>#{{ item.sort || 0 }} {{ item.title }}</strong>
                  <span>{{ item.status || "draft" }}</span>
                </div>
              </button>
            </div>
            <p v-else class="empty">暂无章节</p>
          </article>

          <article class="panel-card">
            <div class="section-title">小游戏状态缓存</div>
            <label class="label">游戏类型</label>
            <input v-model.trim="worldForm.miniGame.gameType" class="input" />
            <label class="label">状态</label>
            <select v-model="worldForm.miniGame.status" class="input">
              <option value="idle">idle</option>
              <option value="running">running</option>
              <option value="finished">finished</option>
            </select>
            <label class="label">轮次</label>
            <input v-model.number="worldForm.miniGame.round" class="input" type="number" min="0" />
            <label class="label">阶段</label>
            <input v-model.trim="worldForm.miniGame.stage" class="input" />
            <label class="label">胜利者</label>
            <input v-model.trim="worldForm.miniGame.winner" class="input" />
            <label class="label">奖励（逗号分隔）</label>
            <input :value="worldForm.miniGame.rewards.join(',')" class="input" @input="updateRewards($event)" />
            <label class="label">备注</label>
            <textarea v-model.trim="worldForm.miniGame.notes" class="input textarea" rows="3"></textarea>
            <div class="row-end">
              <button class="mini-btn primary" :disabled="busy.startSession" @click="createAndPlay">开始会话</button>
            </div>
          </article>
        </section>

        <section v-else-if="activeTab === 'history'" class="view scroll-view">
          <div class="sub-head">
            <h2>聊过</h2>
            <button class="mini-btn" @click="loadSessions">刷新</button>
          </div>
          <div v-if="sessions.length" class="list">
            <button v-for="item in sessions" :key="item.sessionId" class="list-item" @click="openSession(item.sessionId)">
              <div class="list-head">
                <strong>{{ item.title || item.worldName }}</strong>
                <span>{{ formatTime(item.updateTime) }}</span>
              </div>
              <div class="meta">
                <span>{{ item.worldName }}</span>
                <span>{{ item.chapterTitle || "未指定章节" }}</span>
              </div>
              <p>{{ item.latestMessage?.content || "暂无消息" }}</p>
            </button>
          </div>
          <p v-else class="empty">暂无会话记录</p>
        </section>

        <section v-else-if="activeTab === 'play'" class="view play-view">
          <div class="sub-head">
            <button class="mini-btn" @click="activeTab = 'history'">返回</button>
            <h2>游玩故事</h2>
            <button class="mini-btn" @click="refreshCurrentSession">刷新</button>
          </div>
          <article class="panel-card play-setting">
            <p>世界：{{ sessionDetail?.world?.name || "-" }}</p>
            <p>章节：{{ sessionDetail?.chapter?.title || "-" }}</p>
            <p>状态：{{ sessionDetail?.status || "-" }}</p>
          </article>

          <div class="chips">
            <button v-for="tag in miniGameTags" :key="tag" class="chip" @click="sendMiniGameCommand(tag)">{{ tag }}</button>
            <button class="chip" @click="syncMiniGameStateToSession">同步小游戏状态</button>
          </div>

          <div class="message-list">
            <article v-for="msg in messages" :key="msg.id" class="message-item">
              <div class="list-head">
                <strong>{{ msg.role || msg.roleType }}</strong>
                <span>{{ msg.eventType }}</span>
              </div>
              <p>{{ msg.content }}</p>
            </article>
          </div>

          <div class="play-input">
            <textarea v-model.trim="sendText" rows="2" class="input textarea" placeholder="输入消息"></textarea>
            <button class="voice-btn" :disabled="busy.sendMessage || !sendText" @click="sendPlayerMessage">发送</button>
          </div>
        </section>

        <section v-else class="view scroll-view">
          <div class="sub-head">
            <h2>我的</h2>
            <button class="mini-btn" @click="loadUser">刷新</button>
          </div>

          <article class="panel-card">
            <div class="section-title">账号信息</div>
            <p>用户名：{{ userInfo?.name || "-" }}</p>
            <p>用户ID：{{ userInfo?.id || "-" }}</p>
            <p>登录状态：{{ tokenInput ? "已登录" : "未登录" }}</p>
            <p>当前项目：{{ selectedProjectId > 0 ? projectNameMap.get(selectedProjectId) : "-" }}</p>
            <div class="row-end">
              <button class="mini-btn danger" @click="clearToken">退出登录</button>
            </div>
          </article>

          <article class="panel-card">
            <div class="section-title">连接设置</div>
            <label class="label">API</label>
            <input v-model.trim="baseUrlInput" class="input" placeholder="http://127.0.0.1:60000" />
            <label class="label">账号</label>
            <input v-model.trim="loginUsername" class="input" placeholder="用户名（默认 admin）" />
            <label class="label">密码</label>
            <input v-model="loginPassword" class="input" type="password" placeholder="密码（默认 admin123）" />
            <p class="empty">token 由登录接口自动获取，不需要手动填写。</p>
            <div class="row-end">
              <button class="mini-btn primary" @click="loginAndSaveToken">账号登录</button>
              <button class="mini-btn primary" @click="saveConnection">保存连接</button>
            </div>
          </article>

          <article class="panel-card">
            <div class="section-title">当前账号故事资源</div>
            <div v-if="accountWorlds.length" class="list">
              <button v-for="item in accountWorlds" :key="`mine_${item.id}`" class="list-item">
                <div class="list-head">
                  <strong>{{ item.name }}</strong>
                  <span>章节 {{ item.chapterCount || 0 }}</span>
                </div>
                <p>{{ item.intro || "暂无简介" }}</p>
                <div class="row-end">
                  <button class="mini-btn primary" @click.stop="playFromWorld(item)">游玩</button>
                  <button class="mini-btn" @click.stop="jumpToCreate(item.projectId)">编辑</button>
                </div>
              </button>
            </div>
            <p v-else class="empty">当前账号暂无故事资源</p>
          </article>
        </section>

        <div class="bottom-nav">
          <button :class="{ active: bottomActiveTab === 'home' }" @click="goMainTab('home')">主页</button>
          <button :class="{ active: bottomActiveTab === 'create' }" @click="goMainTab('create')">创建故事</button>
          <button :class="{ active: bottomActiveTab === 'history' }" @click="goMainTab('history')">聊过</button>
          <button :class="{ active: bottomActiveTab === 'profile' }" @click="goMainTab('profile')">我的</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  addMessage,
  createDefaultMiniGameState,
  createDefaultWorldSettings,
  getChapters,
  getCurrentUser,
  getMessages,
  getProjects,
  loginByPassword,
  getSession,
  getWorldByProject,
  listSessions,
  saveChapter,
  saveWorld,
  startSession,
} from "./api/game";
import { getBaseUrl, getToken, setBaseUrl, setToken } from "./api/http";
import type {
  ChapterItem,
  MiniGameState,
  ProjectItem,
  RoleParameterCard,
  SessionDetail,
  SessionItem,
  StoryRole,
  WorldItem,
} from "./types/game";

type TabKey = "home" | "hall" | "create" | "history" | "play" | "profile";
type NoticeType = "ok" | "err";

const activeTab = ref<TabKey>("home");
const notice = reactive<{ type: NoticeType; text: string }>({ type: "ok", text: "" });

const statusTime = computed(() => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
});

const bottomActiveTab = computed(() => {
  if (activeTab.value === "hall") return "home";
  if (activeTab.value === "play") return "history";
  return activeTab.value;
});

const baseUrlInput = ref(getBaseUrl());
const tokenInput = ref(getToken());
const loginUsername = ref("admin");
const loginPassword = ref("admin123");

const projects = ref<ProjectItem[]>([]);
const selectedProjectId = ref(-1);
const projectNameMap = computed(() => new Map(projects.value.map((item) => [Number(item.id), item.name])));

const worlds = ref<WorldItem[]>([]);
const hallKeyword = ref("");
const hallCategory = ref<"all" | "hasChapter" | "noChapter">("all");
const quickInput = ref("");
const randomWorld = computed(() => {
  const base = accountWorlds.value;
  if (!base.length) return null;
  return base[Math.floor(Math.random() * base.length)] || base[0];
});
const filteredWorlds = computed(() => {
  const key = hallKeyword.value.trim().toLowerCase();
  return accountWorlds.value.filter((item) => {
    const projectName = projectNameMap.value.get(item.projectId) || "";
    const matchedKeyword = !key || item.name.toLowerCase().includes(key) || projectName.toLowerCase().includes(key);
    if (!matchedKeyword) return false;
    if (hallCategory.value === "hasChapter") return Number(item.chapterCount || 0) > 0;
    if (hallCategory.value === "noChapter") return Number(item.chapterCount || 0) <= 0;
    return true;
  });
});
const accountWorlds = computed(() => {
  if (selectedProjectId.value <= 0) return worlds.value;
  return worlds.value.filter((item) => item.projectId === selectedProjectId.value);
});

const worldForm = reactive({
  worldId: 0,
  name: "",
  intro: "",
  playerRole: createRole("player"),
  narratorRole: createRole("narrator"),
  narratorVoice: "默认旁白",
  globalBackground: "",
  allowRoleView: true,
  allowChatShare: true,
  npcRoles: [] as StoryRole[],
  miniGame: createDefaultMiniGameState(),
});

const chapterForm = reactive({
  title: "",
  content: "",
  completionConditionText: "",
});

const chapters = ref<ChapterItem[]>([]);
const selectedChapterId = ref<number | null>(null);

const sessions = ref<SessionItem[]>([]);
const recentSessions = computed(() => sessions.value.slice(0, 5));
const currentSessionId = ref("");
const sessionDetail = ref<SessionDetail | null>(null);
const messages = ref<Array<{ id: number; role: string; roleType: string; eventType: string; content: string }>>([]);
const sendText = ref("");
const userInfo = ref<Record<string, unknown> | null>(null);

const mentionRoleNames = computed(() => {
  const names = [worldForm.playerRole.name, worldForm.narratorRole.name, ...worldForm.npcRoles.map((item) => item.name)]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return Array.from(new Set(names));
});

const miniGameTags = ["#狼人杀", "#钓鱼", "#修炼", "#研发技能", "#炼药", "#挖矿", "#升级装备"];

const busy = reactive({
  saveWorld: false,
  saveChapter: false,
  startSession: false,
  sendMessage: false,
});

function goMainTab(tab: "home" | "create" | "history" | "profile") {
  activeTab.value = tab;
}

function createRole(roleType: StoryRole["roleType"]): StoryRole {
  if (roleType === "player") {
    return { id: "player", roleType: "player", name: "用户", description: "", voice: "", sample: "" };
  }
  if (roleType === "narrator") {
    return { id: "narrator", roleType: "narrator", name: "旁白", description: "负责叙事推进", voice: "默认旁白", sample: "" };
  }
  return {
    id: `npc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    roleType: "npc",
    name: "新角色",
    description: "",
    voice: "",
    sample: "",
  };
}

function createParameterCard(role: StoryRole): RoleParameterCard {
  return {
    name: role.name || "",
    raw_setting: role.description || "",
    gender: "",
    age: null,
    personality: "",
    appearance: "",
    voice: role.voice || "",
    skills: [],
    items: [],
    equipment: [],
    hp: 100,
    mp: 0,
    money: 0,
    other: [],
  };
}

function appendGlobalMention(roleName: string) {
  const name = String(roleName || "").trim();
  if (!name) return;
  worldForm.globalBackground = `${worldForm.globalBackground}${worldForm.globalBackground ? " " : ""}@${name}`;
}

function appendChapterMention(roleName: string) {
  const name = String(roleName || "").trim();
  if (!name) return;
  chapterForm.content = `${chapterForm.content}${chapterForm.content ? " " : ""}@${name}`;
}

function toast(type: NoticeType, text: string) {
  notice.type = type;
  notice.text = text;
  window.clearTimeout((toast as unknown as { timer?: number }).timer);
  (toast as unknown as { timer?: number }).timer = window.setTimeout(() => {
    notice.text = "";
  }, 2400);
}

function formatTime(ts: number) {
  if (!ts) return "-";
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function normalizeError(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { status?: number; data?: { message?: string } } }).response;
    const status = Number(response?.status || 0);
    if (status === 401) return "未登录或登录已过期，请先在“我的-连接设置”账号登录";
    if (status === 403) return "无权访问该资源（账号隔离生效）";
    const serverMessage = String(response?.data?.message || "").trim();
    if (serverMessage) return serverMessage;
  }
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return fallback;
}

function updateRewards(event: Event) {
  const target = event.target as HTMLInputElement;
  worldForm.miniGame.rewards = target.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clearToken() {
  tokenInput.value = "";
  setToken("");
  toast("ok", "token 已清除");
}

function saveConnection() {
  setBaseUrl(baseUrlInput.value);
  setToken(tokenInput.value);
  toast("ok", "连接已保存");
  void reloadAll();
}

async function loginAndSaveToken() {
  if (!loginUsername.value.trim() || !loginPassword.value.trim()) {
    toast("err", "请输入用户名和密码");
    return;
  }
  try {
    setBaseUrl(baseUrlInput.value);
    const result = await loginByPassword(loginUsername.value.trim(), loginPassword.value);
    tokenInput.value = String(result.token || "").trim();
    setToken(tokenInput.value);
    toast("ok", "登录成功，token 已自动保存");
    await reloadAll();
  } catch (error) {
    toast("err", normalizeError(error, "登录失败"));
  }
}

function hydrateWorldForm(world: WorldItem) {
  const settings = {
    ...createDefaultWorldSettings(),
    ...(world.settings || {}),
    miniGameState: {
      ...createDefaultMiniGameState(),
      ...(world.settings?.miniGameState || {}),
    },
  };
  const player = { ...createRole("player"), ...(world.playerRole || {}) };
  const narrator = { ...createRole("narrator"), ...(world.narratorRole || {}) };
  const roles = Array.isArray(settings.roles) ? settings.roles : [];
  const npcRoles = roles.filter((item) => item.roleType === "npc");

  worldForm.worldId = world.id;
  worldForm.name = world.name || "";
  worldForm.intro = world.intro || "";
  worldForm.playerRole = player;
  worldForm.narratorRole = narrator;
  worldForm.narratorVoice = settings.narratorVoice || narrator.voice || "默认旁白";
  worldForm.globalBackground = settings.globalBackground || "";
  worldForm.allowRoleView = Boolean(settings.allowRoleView);
  worldForm.allowChatShare = Boolean(settings.allowChatShare);
  worldForm.npcRoles = npcRoles.length ? npcRoles : [];
  worldForm.miniGame = { ...createDefaultMiniGameState(), ...settings.miniGameState };
}

function buildWorldSettings() {
  const playerRole = { ...worldForm.playerRole, parameterCardJson: createParameterCard(worldForm.playerRole) };
  const narratorRole = {
    ...worldForm.narratorRole,
    voice: worldForm.narratorVoice,
    parameterCardJson: createParameterCard(worldForm.narratorRole),
  };
  const npcRoles = worldForm.npcRoles.map((role) => ({ ...role, parameterCardJson: createParameterCard(role) }));
  return {
    settings: {
      ...createDefaultWorldSettings(),
      roles: [playerRole, ...npcRoles],
      narratorVoice: worldForm.narratorVoice,
      globalBackground: worldForm.globalBackground,
      allowRoleView: worldForm.allowRoleView,
      allowChatShare: worldForm.allowChatShare,
      miniGameState: worldForm.miniGame,
    },
    playerRole,
    narratorRole,
  };
}

function addNpcRole() {
  worldForm.npcRoles.push(createRole("npc"));
}

function removeNpcRole(index: number) {
  worldForm.npcRoles.splice(index, 1);
}

async function loadProjectsAndWorlds() {
  const projectRows = await getProjects();
  projects.value = Array.isArray(projectRows) ? projectRows : [];
  if (!projects.value.length) {
    selectedProjectId.value = -1;
    worlds.value = [];
    sessions.value = [];
    return;
  }
  if (selectedProjectId.value <= 0) {
    selectedProjectId.value = Number(projects.value[0].id);
  }
  await loadWorldCatalog();
}

async function loadWorldCatalog() {
  const rows: WorldItem[] = [];
  for (const project of projects.value) {
    try {
      const world = await getWorldByProject(Number(project.id), false);
      if (world?.id) rows.push(world);
    } catch {
      // ignore
    }
  }
  worlds.value = rows;
}

async function loadCurrentWorld(autoCreate: boolean) {
  if (selectedProjectId.value <= 0) return;
  const world = await getWorldByProject(selectedProjectId.value, autoCreate);
  if (!world?.id) return;
  hydrateWorldForm(world);
  await loadChaptersForWorld(world.id);
}

async function loadChaptersForWorld(worldId: number) {
  chapters.value = await getChapters(worldId);
  if (chapters.value.length && !selectedChapterId.value) {
    selectedChapterId.value = chapters.value[0].id;
  }
}

async function loadSessions() {
  if (selectedProjectId.value <= 0) {
    sessions.value = [];
    return;
  }
  sessions.value = await listSessions({ projectId: selectedProjectId.value, limit: 60 });
}

async function loadUser() {
  try {
    userInfo.value = await getCurrentUser();
  } catch {
    userInfo.value = null;
  }
}

async function reloadAll() {
  try {
    await loadProjectsAndWorlds();
    await loadCurrentWorld(true);
    await loadSessions();
    await loadUser();
  } catch (error) {
    toast("err", normalizeError(error, "加载失败"));
  }
}

async function saveWorldConfig() {
  if (selectedProjectId.value <= 0) {
    toast("err", "请先选择项目");
    return;
  }
  if (!worldForm.name.trim()) {
    toast("err", "世界名称不能为空");
    return;
  }
  busy.saveWorld = true;
  try {
    const built = buildWorldSettings();
    const world = await saveWorld({
      worldId: worldForm.worldId || undefined,
      projectId: selectedProjectId.value,
      name: worldForm.name.trim(),
      intro: worldForm.intro.trim(),
      settings: built.settings,
      playerRole: built.playerRole,
      narratorRole: built.narratorRole,
    });
    hydrateWorldForm(world);
    await loadWorldCatalog();
    toast("ok", "世界观保存成功");
  } catch (error) {
    toast("err", normalizeError(error, "保存世界观失败"));
  } finally {
    busy.saveWorld = false;
  }
}

async function addChapter() {
  if (!worldForm.worldId) {
    toast("err", "请先保存世界观");
    return;
  }
  if (!chapterForm.title.trim()) {
    toast("err", "章节标题不能为空");
    return;
  }
  let completionCondition: unknown = null;
  if (chapterForm.completionConditionText.trim()) {
    try {
      completionCondition = JSON.parse(chapterForm.completionConditionText);
    } catch {
      toast("err", "章节结局条件 JSON 格式错误");
      return;
    }
  }
  busy.saveChapter = true;
  try {
    await saveChapter({
      worldId: worldForm.worldId,
      title: chapterForm.title.trim(),
      content: chapterForm.content.trim(),
      completionCondition,
    });
    chapterForm.title = "";
    chapterForm.content = "";
    chapterForm.completionConditionText = "";
    await loadChaptersForWorld(worldForm.worldId);
    await loadWorldCatalog();
    toast("ok", "章节创建成功");
  } catch (error) {
    toast("err", normalizeError(error, "创建章节失败"));
  } finally {
    busy.saveChapter = false;
  }
}

async function createSession(world: WorldItem, chapterId: number | null, firstMessage?: string) {
  busy.startSession = true;
  try {
    const result = await startSession({ worldId: world.id, projectId: world.projectId, chapterId });
    const sid = String(result.sessionId || "");
    if (!sid) throw new Error("startSession 未返回 sessionId");
    currentSessionId.value = sid;
    if (firstMessage && firstMessage.trim()) {
      await addMessage({
        sessionId: sid,
        roleType: "player",
        role: worldForm.playerRole.name || "用户",
        content: firstMessage.trim(),
        eventType: "on_message",
      });
    }
    await refreshCurrentSession();
    await loadSessions();
    activeTab.value = "play";
  } finally {
    busy.startSession = false;
  }
}

async function createAndPlay() {
  if (!worldForm.worldId) {
    toast("err", "请先保存世界观");
    return;
  }
  const world = worlds.value.find((item) => item.id === worldForm.worldId);
  if (!world) {
    toast("err", "未找到当前世界，请刷新后再试");
    return;
  }
  try {
    await createSession(world, selectedChapterId.value ?? null);
    toast("ok", "会话已创建");
  } catch (error) {
    toast("err", normalizeError(error, "创建会话失败"));
  }
}

async function playFromWorld(world: WorldItem) {
  try {
    await createSession(world, null);
  } catch (error) {
    toast("err", normalizeError(error, "进入游玩失败"));
  }
}

function jumpToCreate(projectId: number) {
  selectedProjectId.value = projectId;
  activeTab.value = "create";
}

async function quickStartPlay() {
  if (!randomWorld.value) {
    toast("err", "暂无可推荐故事");
    return;
  }
  try {
    await createSession(randomWorld.value, null, quickInput.value);
    quickInput.value = "";
  } catch (error) {
    toast("err", normalizeError(error, "快速开始失败"));
  }
}

async function openSession(sessionId: string) {
  currentSessionId.value = sessionId;
  await refreshCurrentSession();
  activeTab.value = "play";
}

async function refreshCurrentSession() {
  if (!currentSessionId.value) return;
  const detail = await getSession(currentSessionId.value);
  sessionDetail.value = detail;
  if (Array.isArray(detail.messages) && detail.messages.length) {
    messages.value = detail.messages.map((item) => ({
      id: item.id,
      role: item.role,
      roleType: item.roleType,
      eventType: item.eventType,
      content: item.content,
    }));
  } else {
    const rows = await getMessages(currentSessionId.value);
    messages.value = rows.map((item) => ({
      id: item.id,
      role: item.role,
      roleType: item.roleType,
      eventType: item.eventType,
      content: item.content,
    }));
  }
}

async function sendPlayerMessage() {
  if (!currentSessionId.value || !sendText.value.trim()) return;
  busy.sendMessage = true;
  try {
    await addMessage({
      sessionId: currentSessionId.value,
      roleType: "player",
      role: worldForm.playerRole.name || "用户",
      content: sendText.value.trim(),
      eventType: "on_message",
    });
    sendText.value = "";
    await refreshCurrentSession();
    await loadSessions();
  } catch (error) {
    toast("err", normalizeError(error, "发送失败"));
  } finally {
    busy.sendMessage = false;
  }
}

async function syncMiniGameStateToSession() {
  if (!currentSessionId.value) {
    toast("err", "请先创建会话");
    return;
  }
  try {
    await addMessage({
      sessionId: currentSessionId.value,
      roleType: "system",
      role: "系统",
      content: "同步小游戏状态",
      eventType: "on_mini_game_sync",
      meta: { miniGame: worldForm.miniGame },
      attrChanges: [
        {
          entityType: "state",
          field: "state.miniGame",
          value: worldForm.miniGame,
          source: "mini_game_sync",
        },
      ],
    });
    await refreshCurrentSession();
    toast("ok", "小游戏状态已同步");
  } catch (error) {
    toast("err", normalizeError(error, "同步小游戏失败"));
  }
}

async function sendMiniGameCommand(command: string) {
  if (!currentSessionId.value) {
    toast("err", "请先进入会话");
    return;
  }
  const nextState: MiniGameState = {
    ...worldForm.miniGame,
    gameType: command.replace("#", ""),
    status: "running",
    round: (Number(worldForm.miniGame.round) || 0) + 1,
    stage: "触发",
    notes: `由指令 ${command} 触发`,
  };
  worldForm.miniGame = nextState;
  try {
    await addMessage({
      sessionId: currentSessionId.value,
      roleType: "player",
      role: worldForm.playerRole.name || "用户",
      content: command,
      eventType: "on_message",
      meta: { miniGameCommand: command },
      attrChanges: [
        {
          entityType: "state",
          field: "state.miniGame",
          value: nextState,
          source: "mini_game_command",
        },
      ],
    });
    await refreshCurrentSession();
    await loadSessions();
  } catch (error) {
    toast("err", normalizeError(error, "小游戏触发失败"));
  }
}

watch(
  () => selectedProjectId.value,
  async (nextId, prevId) => {
    if (nextId <= 0 || nextId === prevId) return;
    try {
      await loadCurrentWorld(true);
      await loadSessions();
    } catch (error) {
      toast("err", normalizeError(error, "切换项目失败"));
    }
  },
);

onMounted(async () => {
  await reloadAll();
});
</script>

<style scoped>
.v3-root {
  min-height: 100vh;
  background:
    radial-gradient(1200px 760px at -10% -12%, rgba(86, 228, 245, 0.2), transparent 58%),
    radial-gradient(1200px 760px at 110% 118%, rgba(255, 189, 92, 0.22), transparent 60%),
    linear-gradient(165deg, #030813, #081424 58%, #050b17);
  padding: 18px;
  display: grid;
  place-items: center;
}

.phone-shell {
  width: min(430px, 100%);
  border-radius: 28px;
  border: 1px solid #425f8f;
  padding: 8px;
  background: linear-gradient(165deg, #101c35, #070f1d);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
}

.phone-screen {
  height: min(820px, calc(100vh - 52px));
  border-radius: 20px;
  border: 1px solid #4d679a;
  overflow: hidden;
  background: #f3f5f8;
  color: #1a2535;
  position: relative;
}

.android-status {
  height: 22px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: #8fa2c8;
  background: rgba(255, 255, 255, 0.88);
}

.notice {
  margin: 6px 10px 0;
  padding: 6px 10px;
  border-radius: 10px;
  font-size: 12px;
}

.notice.ok {
  background: #eafaf0;
  border: 1px solid #b6e7c8;
  color: #1d7a43;
}

.notice.err {
  background: #fff0f0;
  border: 1px solid #ffc9c9;
  color: #b54a4a;
}

.view {
  position: absolute;
  inset: 22px 0 52px;
}

.scroll-view {
  overflow: auto;
  padding: 10px;
  display: grid;
  gap: 10px;
  background: #f1f3f7;
}

.home-view {
  background: #0f1f32;
}

.hero-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(90% 60% at 70% 15%, rgba(255, 192, 120, 0.35), transparent 70%),
    linear-gradient(165deg, #0f243d, #1c3e5f);
}

.home-corner-actions {
  position: absolute;
  top: 8px;
  right: 10px;
  display: flex;
  gap: 8px;
  z-index: 3;
}

.corner-btn {
  width: 36px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.44);
  background: rgba(12, 21, 35, 0.5);
  color: #edf6ff;
  font-size: 12px;
}

.home-content {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 10px;
  display: grid;
  gap: 8px;
}

.glass-card {
  backdrop-filter: blur(6px);
  background: rgba(8, 15, 28, 0.48);
  color: #eef4ff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  padding: 10px;
}

.glass-card h2 {
  margin: 0;
  font-size: 16px;
}

.glass-card p {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.4;
}

.voice-input {
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 12px;
  padding: 10px;
  background: rgba(8, 15, 28, 0.4);
  color: #edf6ff;
  width: 100%;
}

.voice-btn {
  height: 46px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-weight: 700;
  background: rgba(66, 81, 108, 0.95);
  color: #e6efff;
  border: none;
}

.sub-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sub-head h2 {
  margin: 0;
  font-size: 18px;
}

.panel-card {
  border: 1px solid #d3deef;
  border-radius: 12px;
  background: #fff;
  padding: 10px;
  display: grid;
  gap: 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 800;
  color: #232f43;
}

.label {
  font-size: 12px;
  color: #5b7192;
}

.input {
  border: 1px solid #d4dff0;
  border-radius: 9px;
  background: #f7f9fd;
  color: #2b3f5d;
  padding: 9px 10px;
  width: 100%;
  font: inherit;
}

.textarea {
  min-height: 74px;
  resize: vertical;
}

.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.chip {
  border-radius: 999px;
  height: 24px;
  padding: 0 10px;
  font-size: 11px;
  background: #eef3fc;
  color: #4f6281;
  border: 1px solid #d7e2f2;
}

.switches {
  display: grid;
  gap: 6px;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #d4deee;
  border-radius: 10px;
  background: #fff;
  padding: 8px 10px;
  font-size: 12px;
}

.role-card {
  border: 1px solid #dce6f3;
  border-radius: 10px;
  padding: 8px;
  background: #fbfdff;
  display: grid;
  gap: 6px;
}

.list {
  display: grid;
  gap: 8px;
}

.list-item {
  border: 1px solid #d7e1f0;
  border-radius: 10px;
  padding: 8px;
  background: #fff;
  text-align: left;
  color: inherit;
}

.list-item.active {
  border-color: #9db2d7;
  background: #edf6ff;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.list-head strong {
  font-size: 13px;
}

.list-head span {
  font-size: 11px;
  color: #6b7f9f;
}

.list-item p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #3f4f67;
}

.world-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.world-card {
  border-radius: 12px;
  border: 1px solid #cfdcf0;
  background: #fff;
  padding: 8px;
  display: grid;
  gap: 6px;
}

.world-card h3 {
  margin: 0;
  font-size: 13px;
}

.world-card p {
  margin: 0;
  font-size: 11px;
  color: #495c79;
}

.play-view {
  display: grid;
  grid-template-rows: auto auto auto 1fr auto;
  gap: 8px;
  padding: 10px;
  background: #f1f3f7;
}

.play-setting p {
  margin: 0;
  font-size: 12px;
}

.message-list {
  border: 1px solid #d3deef;
  border-radius: 12px;
  background: #fff;
  padding: 8px;
  overflow: auto;
  display: grid;
  gap: 8px;
}

.message-item {
  border: 1px solid #dbe3f0;
  border-radius: 8px;
  padding: 8px;
  background: #fbfdff;
}

.message-item p {
  margin: 4px 0 0;
  font-size: 12px;
}

.play-input {
  display: grid;
  gap: 8px;
}

.mini-btn {
  height: 30px;
  border-radius: 999px;
  border: 1px solid #cad8ef;
  background: #f2f7ff;
  color: #2e466a;
  padding: 0 12px;
}

.mini-btn.primary {
  background: #314f7e;
  border-color: #314f7e;
  color: #fff;
}

.mini-btn.danger {
  background: #fff2f2;
  border-color: #f4c5c5;
  color: #aa4a4a;
}

.row-end {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: #6d81a2;
}

.empty {
  margin: 0;
  font-size: 12px;
  color: #6f7d94;
}

.bottom-nav {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 52px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: rgba(255, 255, 255, 0.96);
  border-top: 1px solid #dbe5f5;
}

.bottom-nav button {
  border: none;
  background: transparent;
  font-size: 12px;
  color: #51627f;
}

.bottom-nav button.active {
  color: #ff8e2b;
  font-weight: 700;
}

button:disabled {
  opacity: 0.6;
}
</style>
