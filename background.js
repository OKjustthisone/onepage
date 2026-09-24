/**
 * OnePage - Background Service Worker (Manifest V3)
 */

import { DEFAULT_CONFIG, normalizeUrl, isUrlWhitelisted, getConfig, saveConfig } from './utils.js';

// 当前缓存的配置
let currentConfig = { ...DEFAULT_CONFIG };

// 允许重复打开的标签页 ID 集合 (绕过本次去重)
const bypassedTabIds = new Set();

// 记录每个 Tab 最近一次已处理的 URL，避免重复触发
const processedTabUrls = new Map();

// 正在处理中的 Tab 锁，防止并发竞争
const processingTabIds = new Set();

// 初始化加载配置
async function initConfig() {
  currentConfig = await getConfig();
  // 恢复 session 中记录的 bypassedTabIds (若支持)
  if (chrome.storage && chrome.storage.session) {
    try {
      const res = await chrome.storage.session.get('bypassedTabIds');
      if (res && Array.isArray(res.bypassedTabIds)) {
        res.bypassedTabIds.forEach(id => bypassedTabIds.add(id));
      }
    } catch (e) {
      console.warn('[OnePage] session storage not available:', e);
    }
  }
}

initConfig();

// 监听配置变更
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' || areaName === 'local') {
    if (changes.onepage_config && changes.onepage_config.newValue) {
      currentConfig = { ...DEFAULT_CONFIG, ...changes.onepage_config.newValue };
    }
  }
});

/**
 * 记录绕过去重的 Tab ID
 */
async function registerBypassedTab(tabId) {
  bypassedTabIds.add(tabId);
  if (chrome.storage && chrome.storage.session) {
    try {
      await chrome.storage.session.set({ bypassedTabIds: Array.from(bypassedTabIds) });
    } catch (e) {
      // ignore
    }
  }
}

/**
 * 清除绕过去的 Tab ID
 */
async function unregisterBypassedTab(tabId) {
  bypassedTabIds.delete(tabId);
  if (chrome.storage && chrome.storage.session) {
    try {
      await chrome.storage.session.set({ bypassedTabIds: Array.from(bypassedTabIds) });
    } catch (e) {
      // ignore
    }
  }
}

/**
 * 显示徽标提醒
 */
function showBadge(text, color = '#2563eb', duration = 2500) {
  if (!currentConfig.showNotificationBadge) return;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  if (duration > 0) {
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, duration);
  }
}

/**
 * 统计数据累加并保存
 */
async function recordStats(type, count = 1) {
  currentConfig.stats.totalDuplicates = (currentConfig.stats.totalDuplicates || 0) + count;
  if (type === 'old_closed') {
    currentConfig.stats.oldTabsClosed = (currentConfig.stats.oldTabsClosed || 0) + count;
  } else if (type === 'new_closed') {
    currentConfig.stats.newTabsClosed = (currentConfig.stats.newTabsClosed || 0) + count;
  }
  currentConfig.stats.lastDeduplicatedAt = Date.now();
  await saveConfig(currentConfig);
}

/**
 * 核心查重与处理逻辑
 * @param {number} targetTabId 当前新打开/导航的标签页 ID
 * @param {string} targetUrl 当前标签页的目标 URL
 */
async function handleTabUrlCheck(targetTabId, targetUrl) {
  if (!currentConfig.enabled || !targetUrl) return;

  // 1. 检查是否在绕过列表中 (用户主动点击了"允许打开重复页面")
  if (bypassedTabIds.has(targetTabId)) {
    console.log(`[OnePage] Tab ${targetTabId} 处于允许重复名单中，跳过去重检测。`);
    // 消费掉一次性 bypass 标记 (延迟移除，避免重定向导致的二次拦截)
    setTimeout(() => {
      unregisterBypassedTab(targetTabId);
    }, 5000);
    return;
  }

  // 2. 检查是否正在并发处理
  if (processingTabIds.has(targetTabId)) return;
  processingTabIds.add(targetTabId);

  try {
    // 3. 标准化 URL
    const normalizedTarget = normalizeUrl(targetUrl, currentConfig);
    if (!normalizedTarget) return; // 非网页协议或空白页，直接放行

    // 4. 检查是否已被处理过相同 URL
    if (processedTabUrls.get(targetTabId) === normalizedTarget) {
      return;
    }

    // 5. 白名单检测
    if (isUrlWhitelisted(targetUrl, currentConfig.whitelist)) {
      console.log(`[OnePage] URL ${targetUrl} 命中白名单，允许重复。`);
      return;
    }

    // 6. 查询现有的所有标签页
    const queryOptions = currentConfig.checkCrossWindows ? {} : { currentWindow: true };
    const allTabs = await chrome.tabs.query(queryOptions);

    // 查找具有相同标准化 URL 的已存在标签页（排除当前正在检查的标签页）
    const matchingTabs = allTabs.filter(tab => {
      if (tab.id === targetTabId) return false;
      const otherNormalized = normalizeUrl(tab.url || tab.pendingUrl, currentConfig);
      return otherNormalized === normalizedTarget;
    });

    if (matchingTabs.length === 0) {
      // 之前没有打开过相同的 URL，继续正常打开
      processedTabUrls.set(targetTabId, normalizedTarget);
      return;
    }

    console.log(`[OnePage] 检测到重复标签！新标签 ID: ${targetTabId}，匹配到 ${matchingTabs.length} 个已有标签。模式: ${currentConfig.mode}`);

    // 7. 根据用户选择的模式进行处理
    if (currentConfig.mode === 'focus_old') {
      /**
       * 模式 1 (focus_old):
       * 自动跳转到之前的页面，同时关闭新打开的页面
       */
      // 选取最适宜跳转的旧标签页（优先选取最近活动的，或匹配到的第一个）
      const targetExistingTab = matchingTabs[0];

      // 切换到已有的旧标签页所在窗口并激活它
      try {
        await chrome.windows.update(targetExistingTab.windowId, { focused: true });
        await chrome.tabs.update(targetExistingTab.id, { active: true });
      } catch (err) {
        console.warn('[OnePage] 激活已有标签失败:', err);
      }

      // 关闭新打开的重复标签页
      try {
        await chrome.tabs.remove(targetTabId);
        console.log(`[OnePage] 已关闭新标签 ${targetTabId}，跳转至已有标签 ${targetExistingTab.id}`);
        showBadge('跳转', '#10b981'); // 绿色 badge
        await recordStats('new_closed', 1);
      } catch (err) {
        console.warn('[OnePage] 关闭新标签失败:', err);
      }

    } else if (currentConfig.mode === 'keep_new') {
      /**
       * 模式 2 (keep_new):
       * 继续打开新的页面，同时后台关闭之前打开的重复页面
       */
      // 过滤要关闭的旧标签页（如果开启了保护固定标签页，则保留 pinned 标签）
      const tabsToClose = matchingTabs.filter(t => {
        if (currentConfig.protectPinnedTabs && t.pinned) {
          return false;
        }
        return true;
      });

      if (tabsToClose.length > 0) {
        const tabIdsToClose = tabsToClose.map(t => t.id);
        try {
          await chrome.tabs.remove(tabIdsToClose);
          console.log(`[OnePage] 保留新标签 ${targetTabId}，后台关闭旧标签:`, tabIdsToClose);
          showBadge(`-${tabIdsToClose.length}`, '#3b82f6'); // 蓝色 badge
          await recordStats('old_closed', tabIdsToClose.length);
        } catch (err) {
          console.warn('[OnePage] 后台关闭旧标签失败:', err);
        }
      }

      processedTabUrls.set(targetTabId, normalizedTarget);
    }

  } catch (error) {
    console.error('[OnePage] 处理标签查重异常:', error);
  } finally {
    processingTabIds.delete(targetTabId);
  }
}

/**
 * 监听标签页创建事件
 */
chrome.tabs.onCreated.addListener((tab) => {
  const urlToCheck = tab.pendingUrl || tab.url;
  if (urlToCheck) {
    handleTabUrlCheck(tab.id, urlToCheck);
  }
});

/**
 * 监听标签页更新事件 (如在地址栏输入新 URL，或由 about:blank 导航到目标网页)
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 当 URL 变更或处于 loading 状态且有具体 URL 时触发
  const targetUrl = changeInfo.url || (changeInfo.status === 'loading' ? tab.url : null);
  if (targetUrl) {
    handleTabUrlCheck(tabId, targetUrl);
  }
});

/**
 * 监听标签页关闭事件，释放内存缓存
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  bypassedTabIds.delete(tabId);
  processedTabUrls.delete(tabId);
  processingTabIds.delete(tabId);
});

/**
 * 执行"允许打开重复页面"操作：
 * 复制当前活动标签的 URL 打开新标签，并将其注册为免去重白名单
 */
export async function duplicateCurrentTabBypass() {
  try {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!currentTab || !currentTab.url) return;

    // 创建新标签页
    const newTab = await chrome.tabs.create({
      url: currentTab.url,
      index: currentTab.index + 1,
      active: true
    });

    // 记录 bypass 标记，防止被拦截
    await registerBypassedTab(newTab.id);
    showBadge('+1', '#f59e0b', 2000);
    console.log(`[OnePage] 已为当前页面创建允许的重复标签: ID ${newTab.id}, URL: ${currentTab.url}`);
    return newTab;
  } catch (err) {
    console.error('[OnePage] 复制重复标签失败:', err);
  }
}

// 监听来自 Popup 或 Option 页面的通信指令
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'duplicate_current_tab') {
    duplicateCurrentTabBypass().then(newTab => {
      sendResponse({ success: true, tabId: newTab ? newTab.id : null });
    });
    return true; // 异步响应
  } else if (request.action === 'get_current_status') {
    sendResponse({ config: currentConfig, bypassedCount: bypassedTabIds.size });
  } else if (request.action === 'update_config') {
    currentConfig = { ...currentConfig, ...request.config };
    saveConfig(currentConfig).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// 监听快捷键命令
chrome.commands.onCommand.addListener((command) => {
  if (command === 'duplicate-bypass') {
    duplicateCurrentTabBypass();
  }
});

// 初始化右键上下文菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'onepage_duplicate_bypass',
    title: 'OnePage: 允许打开当前页面的重复标签',
    contexts: ['page', 'action']
  });

  chrome.contextMenus.create({
    id: 'onepage_whitelist_site',
    title: 'OnePage: 将当前网站加入免去重白名单',
    contexts: ['page', 'action']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'onepage_duplicate_bypass') {
    await duplicateCurrentTabBypass();
  } else if (info.menuItemId === 'onepage_whitelist_site') {
    if (tab && tab.url) {
      try {
        const url = new URL(tab.url);
        const host = url.hostname;
        if (host && !currentConfig.whitelist.includes(host)) {
          currentConfig.whitelist.push(host);
          await saveConfig(currentConfig);
          showBadge('已加', '#10b981', 2000);
        }
      } catch (e) {
        // ignore
      }
    }
  }
});
