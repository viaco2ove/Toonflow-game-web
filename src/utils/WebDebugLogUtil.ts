/**
 * Web 调试日志工具。
 *
 * 用途：
 * - 统一管理浏览器端调试日志开关，避免业务代码散落 `console.log`；
 * - 为故事游玩、调试编排、小游戏状态流转、webp 播放等提供统一 tag 入口。
 *
 * 打印条件（双门控，缺一不可）：
 * 1. 调试开关打开：见 `isEnabled()`（URL `?debug=true` 或 localStorage `debug=true` / `toonflow.debug=true`）。
 * 2. tag 通过名单约束：见 `shouldLogTag(tag)`，按 `webDebugLogConfig.debugLogMode` 判定：
 *    - whitelist 模式：tag 命中白名单前缀才打印；
 *    - blacklist 模式：tag 命中黑名单前缀则屏蔽，其余打印。
 *
 * 模式与名单在 `WebDebugLogConfig` 中配置；所有 logtag 记录在 `logTagList.ts`（仅文档，不参与判断）。
 */
import { shouldLogTag } from "./WebDebugLogConfig";

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
   * 只有同时满足「调试开关打开」且「tag 通过名单约束」时才会真正写入控制台。
   * 约束规则（whitelist/blacklist）与名单配置见 `WebDebugLogConfig`。
   */
  static log(tag: string, ...args: unknown[]): void {
    if (!this.isEnabled()) {
      return;
    }
    if (!shouldLogTag(tag)) {
      return;
    }
    console.log(tag, ...args);
  }
}