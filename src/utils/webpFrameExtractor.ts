/**
 * WebP 动画第一帧提取工具
 *
 * 核心原理：
 * 1. 使用 Image + Canvas 加载 WebP，浏览器会自动停在第一帧
 * 2. 通过 canvas.toDataURL() 捕获第一帧为静态图片
 * 3. 基于 URL 作为 key 进行缓存，避免重复解码
 */

import { WebDebugLogUtil } from "./WebDebugLogUtil";
import { WEBP_LOG_TAGS } from "./logTagList";

// ============== 类型定义 ==============

export interface WebpFrameCacheEntry {
  /** 第一帧的 DataURL */
  firstFrameDataUrl: string;
  /** 是否为动画 WebP */
  isAnimated: boolean;
  /** 提取时间戳 */
  extractedAt: number;
  /** 原始 URL */
  sourceUrl: string;
}

export interface ExtractWebpFrameResult {
  /** 成功与否 */
  success: boolean;
  /** 第一帧 DataURL（失败时为空） */
  dataUrl: string;
  /** 是否为动画 WebP */
  isAnimated: boolean;
  /** 错误信息（如果有） */
  error?: string;
}

// ============== 缓存配置 ==============

const MEMORY_CACHE_LIMIT = 50; // 内存缓存最大条目数
const MEMORY_CACHE_TTL = 30 * 60 * 1000; // 内存缓存 TTL: 30分钟

// 内存缓存 Map
const memoryCache = new Map<string, WebpFrameCacheEntry>();

// 访问顺序记录（用于 LRU 淘汰）
const cacheAccessOrder: string[] = [];

/**
 * 清理过期缓存条目
 */
function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [url, entry] of memoryCache.entries()) {
    if (now - entry.extractedAt > MEMORY_CACHE_TTL) {
      memoryCache.delete(url);
      const index = cacheAccessOrder.indexOf(url);
      if (index > -1) cacheAccessOrder.splice(index, 1);
    }
  }
}

/**
 * 更新缓存访问顺序（LRU）
 */
function touchCacheEntry(url: string): void {
  const index = cacheAccessOrder.indexOf(url);
  if (index > -1) cacheAccessOrder.splice(index, 1);
  cacheAccessOrder.push(url);
}

/**
 * 获取缓存条目
 */
function getCacheEntry(url: string): WebpFrameCacheEntry | null {
  const entry = memoryCache.get(url);
  if (!entry) return null;

  // 检查是否过期
  if (Date.now() - entry.extractedAt > MEMORY_CACHE_TTL) {
    memoryCache.delete(url);
    const index = cacheAccessOrder.indexOf(url);
    if (index > -1) cacheAccessOrder.splice(index, 1);
    return null;
  }

  touchCacheEntry(url);
  return entry;
}

/**
 * 写入缓存
 */
function setCacheEntry(url: string, entry: WebpFrameCacheEntry): void {
  // 清理过期缓存
  cleanExpiredCache();

  // 如果缓存已满，执行 LRU 淘汰
  if (memoryCache.size >= MEMORY_CACHE_LIMIT) {
    const lruUrl = cacheAccessOrder.shift();
    if (lruUrl) {
      memoryCache.delete(lruUrl);
    }
  }

  memoryCache.set(url, entry);
  touchCacheEntry(url);
}

/**
 * 检查 URL 是否为 WebP 文件
 */
export function isWebpUrl(url: string): boolean {
  if (!url) return false;
  const normalizedUrl = url.split("?")[0].toLowerCase();
  return normalizedUrl.endsWith(".webp") || normalizedUrl.includes(".webp?");
}

/**
 * 检测 WebP 是否为动画格式
 *
 * 实现原理：
 * WebP 动画的 RIFF chunk 中包含 ANIM 标记或 VP8X 标志位
 */
export async function detectWebpAnimation(url: string): Promise<boolean> {
  try {
    // 使用 Range 请求只获取前 1000 字节
    const rangeResponse = await fetch(url, {
      headers: { Range: "bytes=0-1000" },
    });

    if (!rangeResponse.ok) {
      WebDebugLogUtil.log(WEBP_LOG_TAGS.detect, "Range 请求失败，保守返回 true(动画)", { url, status: rangeResponse.status });
      return true; // 无法检测时保守返回 true
    }

    const buffer = await rangeResponse.arrayBuffer();
    const isAnimated = checkWebpAnimated(new Uint8Array(buffer));
    WebDebugLogUtil.log(WEBP_LOG_TAGS.detect, "检测完成", { url, isAnimated });
    return isAnimated;
  } catch (err) {
    WebDebugLogUtil.log(WEBP_LOG_TAGS.detect, "检测异常，保守返回 true(动画)", { url, error: err instanceof Error ? err.message : String(err) });
    return true; // 检测失败时保守返回 true
  }
}

/**
 * 检查 WebP 数据是否包含动画标记
 */
function checkWebpAnimated(data: Uint8Array): boolean {
  if (data.length < 16) return false;

  // 检查 RIFF 头部
  const riff = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (riff !== "RIFF") return false;

  // 检查 WEBP 标识
  const webp = String.fromCharCode(data[8], data[9], data[10], data[11]);
  if (webp !== "WEBP") return false;

  // 从第 12 字节开始查找 Chunk
  for (let i = 12; i < data.length - 4; i += 1) {
    const chunk = String.fromCharCode(data[i], data[i + 1], data[i + 2], data[i + 3]);

    // ANIM chunk 表示动画
    if (chunk === "ANIM") return true;

    // VP8X chunk 表示扩展格式，可能是动画
    if (chunk === "VP8X") {
      if (i + 4 < data.length) {
        const flags = data[i + 4];
        // bit 1 (0x02): Animation 标志位
        return (flags & 0x02) !== 0;
      }
    }
  }

  return false;
}

/**
 * 使用 Canvas 提取 WebP 第一帧（通过网络加载）
 *
 * 注意：如果服务端无 CORS 头，此方法可能失败。
 * 建议优先使用 extractFrameFromImgEl() 从已加载的 DOM img 元素提取。
 */
async function extractFrameWithFetch(url: string): Promise<ExtractWebpFrameResult> {
  WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "canvas 提取开始", { url });
  return new Promise((resolve) => {
    const img = new Image();
    // 不设置 crossOrigin，避免服务端无 CORS 头时 canvas.toDataURL() 报 Tainted canvases 错误

    let timeoutId: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      img.src = "";
    };

    const handleLoad = () => {
      cleanup();
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;

        if (canvas.width === 0 || canvas.height === 0) {
          WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "canvas 提取失败：尺寸为0", { url });
          resolve({ success: false, dataUrl: "", isAnimated: false, error: "图片尺寸为 0" });
          return;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "canvas 提取失败：无法获取2D上下文", { url });
          resolve({ success: false, dataUrl: "", isAnimated: false, error: "无法获取 Canvas 2D 上下文" });
          return;
        }

        // 绘制第一帧（浏览器会自动只绘制第一帧）
        ctx.drawImage(img, 0, 0);

        // 转换为 PNG DataURL
        const dataUrl = canvas.toDataURL("image/png");

        WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "canvas 提取成功", { url, width: canvas.width, height: canvas.height, dataUrlLength: dataUrl.length });
        resolve({ success: true, dataUrl, isAnimated: true });
      } catch (error) {
        WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "canvas 提取异常", { url, error: error instanceof Error ? error.message : "未知错误" });
        resolve({
          success: false,
          dataUrl: "",
          isAnimated: false,
          error: error instanceof Error ? error.message : "未知错误",
        });
      }
    };

    const handleError = () => {
      cleanup();
      WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "canvas 图片加载失败", { url });
      resolve({ success: false, dataUrl: "", isAnimated: false, error: "图片加载失败" });
    };

    img.addEventListener("load", handleLoad, { once: true });
    img.addEventListener("error", handleError, { once: true });

    // 设置 10 秒超时
    timeoutId = setTimeout(() => {
      img.removeEventListener("load", handleLoad);
      img.removeEventListener("error", handleError);
      WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "canvas 提取超时(10s)", { url });
      resolve({ success: false, dataUrl: "", isAnimated: false, error: "加载超时" });
    }, 10000);

    img.src = url;
  });
}

/**
 * 从已加载的 DOM img 元素提取第一帧（推荐，绕过 CORS）
 *
 * 当 LayeredAvatar 的 img 标签已加载 webp 图后，调用此函数从 DOM img 元素提取第一帧。
 * 不发新请求，直接用浏览器的缓存图片数据，100% 绕过 CORS 问题。
 *
 * @param imgEl 已加载的 DOM img 元素（需是 webp 图片）
 * @param url 图片 URL（用于日志记录）
 */
export async function extractFrameFromImgEl(imgEl: HTMLImageElement, url: string): Promise<ExtractWebpFrameResult> {
  WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "DOM img 元素提取开始", { url });

  const width = imgEl.naturalWidth || imgEl.width;
  const height = imgEl.naturalHeight || imgEl.height;

  if (width === 0 || height === 0) {
    WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "DOM img 提取失败：尺寸为0", { url, naturalWidth: imgEl.naturalWidth, naturalHeight: imgEl.naturalHeight, width: imgEl.width, height: imgEl.height });
    return { success: false, dataUrl: "", isAnimated: false, error: "DOM img 尺寸为 0" };
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "DOM img 提取失败：无法获取2D上下文", { url });
      return { success: false, dataUrl: "", isAnimated: false, error: "无法获取 Canvas 2D 上下文" };
    }

    // 浏览器加载 webp 时自动停在第一帧，这里只绘制第一帧
    ctx.drawImage(imgEl, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/png");

    WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "DOM img 提取成功", { url, width, height, dataUrlLength: dataUrl.length });
    return { success: true, dataUrl, isAnimated: true };
  } catch (error) {
    WebDebugLogUtil.log(WEBP_LOG_TAGS.extract, "DOM img 提取异常", { url, error: error instanceof Error ? error.message : "未知错误" });
    return { success: false, dataUrl: "", isAnimated: false, error: error instanceof Error ? error.message : "未知错误" };
  }
}

/**
 * 提取 WebP 动画的第一帧
 *
 * @param url WebP 文件 URL
 * @param forceRefresh 是否强制重新提取（忽略缓存）
 * @returns 提取结果
 */
export async function extractWebpFirstFrame(
  url: string,
  forceRefresh = false
): Promise<ExtractWebpFrameResult> {
  // 非 WebP 文件直接返回原 URL
  if (!isWebpUrl(url)) {
    return { success: true, dataUrl: url, isAnimated: false };
  }

  // 检查缓存
  if (!forceRefresh) {
    const cached = getCacheEntry(url);
    if (cached) {
      WebDebugLogUtil.log(WEBP_LOG_TAGS.cache, "命中", { url, isAnimated: cached.isAnimated });
      return {
        success: true,
        dataUrl: cached.firstFrameDataUrl,
        isAnimated: cached.isAnimated,
      };
    }
  }

  WebDebugLogUtil.log(WEBP_LOG_TAGS.cache, "未命中，开始提取", { url, forceRefresh });

  // 提取第一帧
  const result = await extractFrameWithFetch(url);

  // 缓存结果
  if (result.success) {
    WebDebugLogUtil.log(WEBP_LOG_TAGS.cache, "写入缓存", { url, isAnimated: result.isAnimated });
    setCacheEntry(url, {
      firstFrameDataUrl: result.dataUrl,
      isAnimated: result.isAnimated,
      extractedAt: Date.now(),
      sourceUrl: url,
    });
  }

  return result;
}

/**
 * 批量预提取多个 WebP 的第一帧
 *
 * @param urls WebP URL 数组
 * @param onProgress 进度回调
 */
export async function prefetchWebpFrames(
  urls: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, ExtractWebpFrameResult>> {
  const results = new Map<string, ExtractWebpFrameResult>();
  const webpUrls = urls.filter(isWebpUrl);

  // 并发控制：最多同时处理 3 个
  const CONCURRENCY = 3;

  for (let i = 0; i < webpUrls.length; i += CONCURRENCY) {
    const batch = webpUrls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((url) => extractWebpFirstFrame(url)));

    batch.forEach((url, index) => {
      results.set(url, batchResults[index]);
    });

    onProgress?.(Math.min(i + CONCURRENCY, webpUrls.length), webpUrls.length);
  }

  return results;
}

/**
 * 清理指定 URL 的缓存
 */
export function clearWebpFrameCache(url?: string): void {
  if (url) {
    memoryCache.delete(url);
    const index = cacheAccessOrder.indexOf(url);
    if (index > -1) cacheAccessOrder.splice(index, 1);
  } else {
    memoryCache.clear();
    cacheAccessOrder.length = 0;
  }
}

/**
 * 获取缓存统计信息
 */
export function getWebpFrameCacheStats(): {
  size: number;
  limit: number;
  oldestEntry: number | null;
} {
  let oldestEntry: number | null = null;

  for (const entry of memoryCache.values()) {
    if (oldestEntry === null || entry.extractedAt < oldestEntry) {
      oldestEntry = entry.extractedAt;
    }
  }

  return {
    size: memoryCache.size,
    limit: MEMORY_CACHE_LIMIT,
    oldestEntry,
  };
}