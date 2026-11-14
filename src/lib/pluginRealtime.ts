/**
 * pluginRealtime —— 插件实时全双工通道客户端（2026-11-14，网络通信机制 v3.1）
 *
 * 对接后端 WS /plugin/realtime（设计文档 §4/§5）：
 *   up:   {type:"tickParams", params}  帧 tick 参数整包 latest-wins（替代 10Hz HTTP tick）
 *         {type:"action", actionId, action, params}   玩家动作即时上行
 *         {type:"ping", ts}            保活 + RTT 测量
 *   down: {type:"sync"/"push", state, actions, response}  状态重同步 / 变化推送
 *         {type:"ack", actionId, ok, response, serverTick}    动作回执
 *
 * 韧性（v3.1 §5.4）：
 *   - 断线自动回退：isOpen=false 期间调用方走原有 HTTP /plugin/tick 路径（零改动）
 *   - 指数退避重连（500ms 起，上限 5s）；重连成功重新 sync
 *   - WS 永久不可用（握手失败 ≥3 次）→ 停止重连，保持 HTTP 模式
 *
 * 延迟可观测（v3.1 §5.2 / G5）：每次动作记录 click→sent→ack 时间线（环形缓冲，最近 32 条），
 * 供调试 HUD 与验收采样。
 */
export type RealtimeChannelState = "off" | "connecting" | "open" | "fallback";

export interface RealtimeAckEntry {
  actionId: string;
  action: string;
  tClick: number;
  tSent: number;
  tAck: number;
  ok: boolean;
  response: string;
  serverTick: number | null;
}

export interface RealtimeEvents {
  /** 收到 sync/push 的完整状态（与 HTTP res.state 同构，直接喂 pluginLiveState） */
  onState: (state: any, actions: any[] | undefined, response: string | undefined) => void;
  /** 通道状态变化（off/connecting/open/fallback） */
  onChannelChange?: (s: RealtimeChannelState) => void;
  /** 动作 ack（调试 HUD / toast 用） */
  onAck?: (ack: RealtimeAckEntry) => void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;
const RECONNECT_GIVE_UP = 6; // 连续失败 N 次 → 停止重连（保持 HTTP 模式）
const HEARTBEAT_MS = 1000;
const ACK_HISTORY_MAX = 32;

export class PluginRealtimeChannel {
  private ws: WebSocket | null = null;
  private st: RealtimeChannelState = "off";
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private destroyed = false;
  private actionSeq = 0;
  private ackHistory: RealtimeAckEntry[] = [];
  /** 最近 RTT（ping-pong），调试 HUD 用 */
  lastRttMs = 0;

  constructor(
    private opts: {
      /** 后端 http(s) origin（自动转 ws://），每次连接时取（baseUrl 可变） */
      baseUrl: () => string;
      token: () => string;
      /** 会话与插件 id 每次连接时取（进游戏后才有值；空值 → 暂不连接） */
      getSessionId: () => string;
      getPluginId: () => string;
      events: RealtimeEvents;
    },
  ) {}

  get isOpen(): boolean {
    return this.st === "open" && !!this.ws && this.ws.readyState === 1;
  }
  get state(): RealtimeChannelState {
    return this.st;
  }
  get acks(): readonly RealtimeAckEntry[] {
    return this.ackHistory;
  }

  private setState(s: RealtimeChannelState): void {
    if (this.st === s) return;
    this.st = s;
    try { this.opts.events.onChannelChange?.(s); } catch { /* 回调异常不阻断 */ }
  }

  private wsUrl(): string {
    const base = String(this.opts.baseUrl() || "").trim().replace(/\/+$/, "");
    const wsBase = base.replace(/^http/i, "ws");
    return (
      `${wsBase}/plugin/realtime?token=${encodeURIComponent(this.opts.token())}` +
      `&sessionId=${encodeURIComponent(this.opts.getSessionId())}` +
      `&pluginId=${encodeURIComponent(this.opts.getPluginId())}`
    );
  }

  connect(): void {
    if (this.destroyed || this.ws) return;
    const sessionId = this.opts.getSessionId();
    const pluginId = this.opts.getPluginId();
    if (!sessionId || !pluginId) return; // 面板未就绪：等调用方再触发
    this.setState(this.attempt === 0 ? "connecting" : this.st);
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl());
    } catch {
      this.onDown();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setState("open");
      this.startHeartbeat();
    };
    ws.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.type === "sync" || m.type === "push") {
        if (m.state) this.opts.events.onState(m.state, m.actions, m.response);
      } else if (m.type === "ack") {
        const entry = this.ackHistory.find((a) => a.actionId === String(m.actionId || ""));
        if (entry) {
          entry.tAck = Date.now();
          entry.ok = m.ok === true;
          entry.response = String(m.response || "");
          entry.serverTick = m.serverTick ?? null;
          this.opts.events.onAck?.(entry);
        }
      } else if (m.type === "pong") {
        const dt = Date.now() - Number(m.ts || 0);
        if (dt > 0 && dt < 60000) this.lastRttMs = dt;
      }
    };
    ws.onclose = () => this.onDown();
    ws.onerror = () => { /* close 会跟随 */ };
  }

  private onDown(): void {
    this.stopHeartbeat();
    this.ws = null;
    const wasOpen = this.st === "open";
    if (this.destroyed) { this.setState("off"); return; }
    // 曾成功连过 → 计数清零；连续失败达上限 → 进入慢速重试（30s/次，机会性恢复）
    if (wasOpen) this.attempt = 0;
    this.attempt += 1;
    this.setState("fallback");
    const delay = this.attempt > RECONNECT_GIVE_UP
      ? 30000
      : Math.min(RECONNECT_BASE_MS * Math.pow(2, this.attempt - 1), RECONNECT_MAX_MS);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      }
    }, HEARTBEAT_MS);
  }
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { window.clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  /**
   * 帧 tick 参数整包上报（latest-wins；连接未开时静默丢弃——调用方此时应走 HTTP）。
   * ★ 2026-11-14 战斗断链修复：iframe 帧 tick params 是五件套
   *   {input, player, localEnemies?, walkGrid?, levelName}，缺一不可——
   *   entry 侧敌怪表唯一重建入口是 params.localEnemies（fix⑤ 前端权威清单），
   *   点击寻路靠 params.input.moveTo，地图权威靠 params.levelName。
   *   只上报 player 会导致「野怪不刷新不打架、技能目标对不上不扣血」。
   */
  sendTickParams(params: Record<string, unknown> | null | undefined): void {
    if (!this.isOpen) return;
    try {
      this.ws!.send(JSON.stringify({ type: "tickParams", params: params || {} }));
    } catch { /* 发送失败静默（下一帧覆盖） */ }
  }

  /**
   * 动作即时上行（技能/普攻/物品/sys_*）。返回 actionId（ack 对账用）；
   * 连接未开返回 null（调用方应走 HTTP 回退）。
   */
  sendAction(action: string, params: Record<string, unknown> = {}): string | null {
    if (!this.isOpen) return null;
    const actionId = `a_${Date.now().toString(36)}_${(++this.actionSeq).toString(36)}`;
    const entry: RealtimeAckEntry = {
      actionId,
      action,
      tClick: Date.now(),
      tSent: Date.now(),
      tAck: 0,
      ok: false,
      response: "",
      serverTick: null,
    };
    this.ackHistory.push(entry);
    if (this.ackHistory.length > ACK_HISTORY_MAX) this.ackHistory.shift();
    try {
      this.ws!.send(JSON.stringify({ type: "action", actionId, action, params }));
      return actionId;
    } catch {
      this.ackHistory.pop();
      return null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) { window.clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.setState("off");
  }
}
