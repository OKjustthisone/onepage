/**
 * OnePage - 辅助工具函数库
 */

export const DEFAULT_CONFIG = {
  enabled: true,                       // 是否开启防重复检测
  mode: 'focus_old',                  // 'focus_old': 自动跳转已有页面，关闭新页面
                                      // 'keep_new': 保留新页面，后台关闭旧页面
  checkCrossWindows: true,            // 是否跨浏览器窗口检测重复标签
  ignoreHash: true,                   // 是否忽略 URL 锚点 (#anchor)
  ignoreQuery: false,                 // 是否忽略所有 URL 查询参数 (?param=...)
  ignoreTrackingParams: true,         // 是否过滤常见的追踪参数 (utm_*, spm, from 等)
  ignoreTrailingSlash: true,          // 是否忽略末尾斜杠 (/path/ 与 /path 视为相同)
  protectPinnedTabs: true,            // 是否保护固定标签页 (不被后台关闭)
  showNotificationBadge: true,        // 是否在扩展图标上显示去重动画徽标
  whitelist: [                        // 允许重复打开的域名白名单
    'meet.google.com',
    'zoom.us',
    'teams.microsoft.com'
  ],
  stats: {
    totalDuplicates: 0,               // 累计去重处理总次数
    oldTabsClosed: 0,                 // 关闭旧标签次数 (模式2)
    newTabsClosed: 0,                 // 关闭新标签次数 (模式1)
    lastDeduplicatedAt: null          // 最近一次去重时间戳
  }
};

// 常见追踪参数与防缓存时间戳参数 (如 Google 的 zx 参数)
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'msclkid', 'spm', 'from', 'ref', 'source',
  'zx', '_', 't', 'ts', 'cb', 'nocache', 'timestamp', '_t'
]);

/**
 * 标准化 URL，用于比较两个 URL 是否实质为同一页面
 * @param {string} rawUrl 原始 URL 字符串
 * @param {object} options 配置选项
 * @returns {string|null} 标准化后的 URL 字符串，如果是非网页协议则返回 null
 */
export function normalizeUrl(rawUrl, options = DEFAULT_CONFIG) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  try {
    const url = new URL(rawUrl);

    // 排除特殊内置协议与空白页
    const ignoredProtocols = ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'devtools:', 'view-source:', 'javascript:'];
    if (ignoredProtocols.includes(url.protocol)) {
      return null;
    }

    // 协议与域名转小写
    const protocol = url.protocol.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    const port = url.port ? `:${url.port}` : '';

    // 路径处理 (忽略末尾斜杠)
    let pathname = url.pathname;
    if (options.ignoreTrailingSlash && pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    // 查询参数处理
    let search = '';
    if (!options.ignoreQuery && url.search) {
      const searchParams = new URLSearchParams(url.search);

      // 若启用了过滤追踪参数
      if (options.ignoreTrackingParams) {
        for (const key of Array.from(searchParams.keys())) {
          if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
            searchParams.delete(key);
          }
        }
      }

      // 参数按字母排序，消除参数顺序不同导致的不匹配
      searchParams.sort();
      const queryString = searchParams.toString();
      if (queryString) {
        search = `?${queryString}`;
      }
    }

    // Hash 锚点处理
    let hash = '';
    if (!options.ignoreHash && url.hash) {
      hash = url.hash;
    }

    return `${protocol}//${hostname}${port}${pathname}${search}${hash}`;
  } catch (e) {
    // 无法解析为标准 URL (如无效地址)
    return null;
  }
}

/**
 * 提取主机名 (域名)
 */
export function getHostname(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 判断某个 URL 是否在白名单中
 */
export function isUrlWhitelisted(rawUrl, whitelist = []) {
  if (!rawUrl || !Array.isArray(whitelist) || whitelist.length === 0) {
    return false;
  }
  const hostname = getHostname(rawUrl);
  if (!hostname) return false;

  return whitelist.some(item => {
    const trimmed = item.trim().toLowerCase();
    if (!trimmed) return false;
    return hostname === trimmed || hostname.endsWith(`.${trimmed}`);
  });
}

/**
 * 读取本地配置，合并默认值
 */
export async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('onepage_config', (result) => {
      if (chrome.runtime.lastError || !result || !result.onepage_config) {
        // Fallback to local storage
        chrome.storage.local.get('onepage_config', (localRes) => {
          if (localRes && localRes.onepage_config) {
            resolve({ ...DEFAULT_CONFIG, ...localRes.onepage_config });
          } else {
            resolve({ ...DEFAULT_CONFIG });
          }
        });
      } else {
        resolve({ ...DEFAULT_CONFIG, ...result.onepage_config });
      }
    });
  });
}

/**
 * 保存配置
 */
export async function saveConfig(newConfig) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ onepage_config: newConfig }, () => {
      // 同时写入 local 作备用
      chrome.storage.local.set({ onepage_config: newConfig }, () => {
        resolve(newConfig);
      });
    });
  });
}
