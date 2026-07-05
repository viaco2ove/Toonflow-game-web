/**
 * Web Debug Log Config —— 调试日志输出约束配置
 *
 * 约束 WebDebugLogUtil.ts 的日志输出，统一通过 `webDebugLogConfig` 配置。
 *
 * 日志模式：debugLogMode
 * - "whitelist" 白名单模式：只有 tag 命中 `debugLogWhitelist`（前缀匹配）的日志才打印。
 *   非白名单日志一律静默。适合只关注某几个模块、屏蔽其余噪音的场景。
 * - "blacklist" 黑名单模式：tag 命中 `debugLogBlacklist`（前缀匹配）的日志被屏蔽，
 *   其余全部打印。适合排除个别噪音模块、其余全开的场景。
 *
 * 匹配规则：前缀匹配。
 * - 名单条目为“前缀串”，日志 tag 以该串开头即视为命中。
 * - 例：`"[webp]"` 命中 `"[webp:play]"`、`"[webp] xxx"`、`"[webp:extract]"`。
 * - 选前缀而非精确全匹配：现有日志 tag 命名较杂（`[aiGame][xxx]`、`[voice lifecycle] ...`、
 *   `[ScenePlay Watch1] ...`、裸字符串 `getUserMedia ing` 等），精确匹配需登记数百条且每加一句
 *   日志都要同步登记，维护成本高；前缀匹配只需登记一级前缀即可放行/屏蔽整组。
 *
 * 名单维护：
 * - 在 `webDebugLogConfig.debugLogWhitelist` / `debugLogBlacklist` 数组里追加前缀串即可。
 * - 建议同时到 `logTagList.ts` 登记对应 tag 文档（logTagList 仅记录所有 logtag，不参与运行时判断）。
 */

/**
 * WebP 日志的一级前缀。
 *
 * 所有 webp 播放/提取/缓存/渲染/检测相关日志的 tag 都以 `[webp:子类]` 形式书写，
 * 统一落在 `[webp]` 前缀下。
 */
export const WEBP_LOG_TAG_PREFIX = "[webp]";

/**
 * 调试日志约束配置。
 *
 * - debugLogMode: 日志模式，"whitelist" | "blacklist"。
 * - debugLogBlacklist: 黑名单前缀数组（blacklist 模式下命中即屏蔽）。
 * - debugLogWhitelist: 白名单前缀数组（whitelist 模式下命中即放行）。
 *
 * 默认 whitelist 模式且仅放行 webp 相关日志；如需放开其他模块，追加其一级前缀即可，
 * 例如 `"[aiGame]"`、`"[voice lifecycle]"` 等。
 */
export const webDebugLogConfig = {
  /** 日志模式：whitelist（白名单，命中才打印）或 blacklist（黑名单，命中则屏蔽） */
  debugLogMode: "whitelist" as "blacklist" | "whitelist",
  /** 黑名单前缀（blacklist 模式下，tag 命中此处前缀则不打印） */
  debugLogBlacklist: [] as string[],
  /** 白名单前缀（whitelist 模式下，仅 tag 命中此处前缀才打印） */
  debugLogWhitelist: [
    WEBP_LOG_TAG_PREFIX, // [webp:play] / [webp:extract] / [webp:cache] / [webp:render] / [webp:detect]
  ] as string[],
};

/**
 * 判断 tag 是否命中给定名单（前缀匹配）。
 *
 * @param tag 日志 tag 字符串（调用方需保证为非空 string）。
 * @param list 名单前缀数组。
 * @returns 命中返回 true，否则 false。
 */
function matchesList(tag: string, list: string[]): boolean {
  if (list.length === 0) {
    return false;
  }
  return list.some((prefix) => tag.startsWith(prefix));
}

/**
 * 判断给定 tag 是否应当被打印（按当前 debugLogMode 与黑白名单）。
 *
 * - whitelist 模式：tag 命中 debugLogWhitelist 前缀 → 打印；否则静默。
 * - blacklist 模式：tag 命中 debugLogBlacklist 前缀 → 静默；否则打印。
 *
 * @param tag 日志的第一个参数。可能为字符串字面量、运行时拼接动态串、裸字符串或非字符串（如 error 对象）。
 *   非字符串/空串：whitelist 模式下不命中白名单 → 不打印；blacklist 模式下不命中黑名单 → 打印。
 * @returns 是否打印。
 */
export function shouldLogTag(tag: unknown): boolean {
  const tagStr = typeof tag === "string" ? tag : "";

  // TODO: 调试用，正式环境删除
  console.debug("[shouldLogTag]", {
    tag,
    tagStr,
    debugLogMode: webDebugLogConfig.debugLogMode,
    whitelist: webDebugLogConfig.debugLogWhitelist,
    blacklist: webDebugLogConfig.debugLogBlacklist,
    isString: typeof tag === "string",
    tagLen: tagStr.length,
  });

  switch (webDebugLogConfig.debugLogMode) {
    case "whitelist":
      // 白名单模式：仅命中白名单的打印；空串/非字符串必然不命中
      if (tagStr.length === 0) {
        return false;
      }
      return matchesList(tagStr, webDebugLogConfig.debugLogWhitelist);
    case "blacklist":
      // 黑名单模式：命中黑名单的静默，其余打印
      if (tagStr.length === 0) {
        return true;
      }
      return !matchesList(tagStr, webDebugLogConfig.debugLogBlacklist);
    default:
      // 未知模式，保守不打印
      return false;
  }
}
