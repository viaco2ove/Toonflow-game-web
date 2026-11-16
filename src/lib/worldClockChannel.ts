/**
 * worldClockChannel —— 世界时钟 WS 推送客户端（2026-11-16，用户需求「getWorldClock 改 WS，不要高频请求」）
 *
 * 对接后端 WS /game/realtimeClock：
 *   down: {type:"clock", timeMode, weatherMode, worldClock, serverTime, isFreeMode, ts}
 *         连接建立立即推一次；此后仅值变化时推（服务端 Hub 做变化检测）
 *   up:   {type:"ping", ts}  保活
 *
 * 韧性：指数退避重连（1s 起，上限 30s）；连续失败 N 次 → 停止（onState("fallback")
 *   通知调用方回退 HTTP /game/getWorldClock 轮询），调用方可 destroy 后重建恢复。
 */
export type ClockChannelState = "off" | "connecting" | "open" | "fallback";

export interface ClockPushPayload {
  timeMode: string;
  weatherMode: string;
  worldClock: { timeOfDay: string; weather: string };
  serverTime: number;
  isFreeMode: boolean;
  ts: number;
}

export interface ClockChannelEvents {
  onClock: (data: ClockPushPayload) => void;
  /** open/fallback 状态变化：fallback = 应回退 HTTP 轮询 */
  onStateChange?: (s: ClockChannelState) => void;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_GIVE_UP = 5;
const HEARTBEAT_MS = 30_000;

export class WorldClockChannel {
  private ws: WebSocket | null = null;
  private st: ClockChannelState = "off";
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private destroyed = false;

  constructor(
    private opts: {
      baseUrl: () => string;
      token: () => string;
      getSessionId: () => string;
      events: ClockChannelEvents;
    },
  ) {}

  get isOpen(): boolean {
    return this.st === "open" && !!this.ws && this.ws.readyState === 1;
  }
  get state(): ClockChannelState {
    return this.st;
  }

  private setState(s: ClockChannelState): void {
    if (this.st === s) return;
    this.st = s;
    try { this.opts.events.onStateChange?.(s); } catch { /* 回调异常不阻断 */ }
  }

  private wsUrl(): string {
    const base = String(this.opts.baseUrl() || "").trim().replace(/\/+$/, "");
    const wsBase = base.replace(/^http/i, "ws");
    return (
      `${wsBase}/game/realtimeClock?token=${encodeURIComponent(this.opts.token())}` +
      `&sessionId=${encodeURIComponent(this.opts.getSessionId())}`
    );
  }

  connect(): void {
    if (this.destroyed || this.ws) return;
    const sessionId = this.opts.getSessionId();
    if (!sessionId) return;
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
      if (m?.type === "clock") {
        this.opts.events.onClock(m as ClockPushPayload);
      } // pong 静默
    };
    ws.onclose = () => this.onDown();
    ws.onerror = () => {
      try { ws.close(); } catch { /* ignore */ }
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      try { this.ws?.send(JSON.stringify({ type: "ping", ts: Date.now() })); } catch { /* ignore */ }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** 掉线：退避重连；连续失败超限 → fallback（调用方回退轮询） */
  private onDown(): void {
    this.stopHeartbeat();
    this.ws = null;
    if (this.destroyed) return;
    this.attempt += 1;
    if (this.attempt > RECONNECT_GIVE_UP) {
      this.setState("fallback");
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.attempt - 1), RECONNECT_MAX_MS);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** 从 fallback 恢复（调用方机会性调用，例如页面重新可见时） */
  revive(): void {
    if (this.destroyed || this.ws) return;
    if (this.attempt > RECONNECT_GIVE_UP) {
      this.attempt = 0;
      this.setState("connecting");
    }
    this.connect();
  }

  destroy(): void {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.setState("off");
  }
}
