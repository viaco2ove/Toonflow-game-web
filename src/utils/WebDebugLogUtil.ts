/**
 * Web 调试日志工具。
 *
 * 用途：
 * - 统一管理浏览器端调试日志开关，避免业务代码散落 `console.log`；
 * - 仅在显式开启 `debug=true` 时输出，减少正式游玩时的控制台噪音；
 * - 为故事游玩、调试编排、小游戏状态流转提供统一 tag 入口。
 */
export class WebDebugLogUtil {
  /**
   * 判断当前页面是否开启调试日志。
   *
   * 生效来源：
   * - URL 查询参数：`?debug=true`
   * - localStorage：`debug=true` 或 `toonflow.debug=true`
   */
  static isEnabled(): boolean {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      const search = new URLSearchParams(window.location.search || "");
      const searchValue = String(search.get("debug") || "").trim().toLowerCase();
      if (searchValue === "true") {
        return true;
      }
      const localValue = String(window.localStorage.getItem("debug") || "").trim().toLowerCase();
      if (localValue === "true") {
        return true;
      }
      const toonflowDebugValue = String(window.localStorage.getItem("toonflow.debug") || "").trim().toLowerCase();
      return toonflowDebugValue === "true";
    } catch {
      return false;
    }
  }

  /**
   * 输出普通调试日志。
   *
   * 只有显式开启调试模式时才会真正写入控制台。
   */
  static log(tag: string, ...args: unknown[]): void {
    if (!this.isEnabled()) {
      return;
    }
    console.log(tag, ...args);
  }
}
