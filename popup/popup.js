/**
 * OnePage - Popup 交互逻辑
 */

import { getConfig, saveConfig, getHostname } from '../utils.js';

let currentConfig = null;
let currentTab = null;
let currentHost = '';

// DOM 元素引用
const mainToggle = document.getElementById('mainToggle');
const modeFocusOld = document.getElementById('modeFocusOld');
const modeKeepNew = document.getElementById('modeKeepNew');
const modeBadge = document.getElementById('modeBadge');
const btnDuplicateCurrent = document.getElementById('btnDuplicateCurrent');
const duplicateToast = document.getElementById('duplicateToast');
const currentDomainEl = document.getElementById('currentDomain');
const siteWhitelistToggle = document.getElementById('siteWhitelistToggle');
const totalDuplicatesEl = document.getElementById('totalDuplicates');

// 高级匹配选项
const checkCrossWindows = document.getElementById('checkCrossWindows');
const ignoreTrailingSlash = document.getElementById('ignoreTrailingSlash');
const ignoreHash = document.getElementById('ignoreHash');
const ignoreTrackingParams = document.getElementById('ignoreTrackingParams');
const protectPinnedTabs = document.getElementById('protectPinnedTabs');

/**
 * 初始化 Popup 状态
 */
async function initPopup() {
  currentConfig = await getConfig();

  // 1. 同步主开关与去重模式
  mainToggle.checked = currentConfig.enabled;
  if (currentConfig.mode === 'keep_new') {
    modeKeepNew.checked = true;
    modeBadge.textContent = '保留新页';
    modeBadge.style.backgroundColor = '#fef3c7';
    modeBadge.style.color = '#b45309';
  } else {
    modeFocusOld.checked = true;
    modeBadge.textContent = '跳转旧页';
    modeBadge.style.backgroundColor = '#dbeafe';
    modeBadge.style.color = '#2563eb';
  }

  // 2. 同步高级匹配选项
  checkCrossWindows.checked = !!currentConfig.checkCrossWindows;
  ignoreTrailingSlash.checked = !!currentConfig.ignoreTrailingSlash;
  ignoreHash.checked = !!currentConfig.ignoreHash;
  ignoreTrackingParams.checked = !!currentConfig.ignoreTrackingParams;
  protectPinnedTabs.checked = !!currentConfig.protectPinnedTabs;

  // 3. 统计数字
  if (currentConfig.stats && typeof currentConfig.stats.totalDuplicates === 'number') {
    totalDuplicatesEl.textContent = currentConfig.stats.totalDuplicates;
  }

  // 4. 获取当前活动标签页信息
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab && activeTab.url) {
    currentTab = activeTab;
    currentHost = getHostname(activeTab.url);

    if (currentHost) {
      currentDomainEl.textContent = currentHost;
      // 检查是否已在白名单中
      const isWhitelisted = currentConfig.whitelist && currentConfig.whitelist.includes(currentHost);
      siteWhitelistToggle.checked = isWhitelisted;
    } else {
      currentDomainEl.textContent = '浏览器内置页面';
      siteWhitelistToggle.disabled = true;
      btnDuplicateCurrent.disabled = true;
      btnDuplicateCurrent.style.opacity = '0.6';
    }
  } else {
    currentDomainEl.textContent = '无活跃标签页';
    siteWhitelistToggle.disabled = true;
    btnDuplicateCurrent.disabled = true;
  }
}

/**
 * 更新并保存设置
 */
async function updateSettings(changes) {
  currentConfig = { ...currentConfig, ...changes };
  await saveConfig(currentConfig);

  // 通知 background
  chrome.runtime.sendMessage({ action: 'update_config', config: currentConfig });
}

// 监听主开关
mainToggle.addEventListener('change', () => {
  updateSettings({ enabled: mainToggle.checked });
});

// 监听模式切换
modeFocusOld.addEventListener('change', () => {
  if (modeFocusOld.checked) {
    modeBadge.textContent = '跳转旧页';
    modeBadge.style.backgroundColor = '#dbeafe';
    modeBadge.style.color = '#2563eb';
    updateSettings({ mode: 'focus_old' });
  }
});

modeKeepNew.addEventListener('change', () => {
  if (modeKeepNew.checked) {
    modeBadge.textContent = '保留新页';
    modeBadge.style.backgroundColor = '#fef3c7';
    modeBadge.style.color = '#b45309';
    updateSettings({ mode: 'keep_new' });
  }
});

// 核心功能：允许打开重复页面 (复制当前 URL)
btnDuplicateCurrent.addEventListener('click', async () => {
  if (!currentTab || !currentTab.url) return;

  btnDuplicateCurrent.disabled = true;
  duplicateToast.classList.remove('hidden');

  try {
    // 向 background 发送消息执行打开允许重复标签的操作
    await chrome.runtime.sendMessage({ action: 'duplicate_current_tab' });

    setTimeout(() => {
      window.close(); // 优雅关闭 popup 弹出层
    }, 600);
  } catch (err) {
    console.error('打开重复页面失败:', err);
    btnDuplicateCurrent.disabled = false;
  }
});

// 监听本站免拦截白名单
siteWhitelistToggle.addEventListener('change', () => {
  if (!currentHost) return;
  const list = currentConfig.whitelist || [];
  if (siteWhitelistToggle.checked) {
    if (!list.includes(currentHost)) {
      list.push(currentHost);
    }
  } else {
    const idx = list.indexOf(currentHost);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  }
  updateSettings({ whitelist: list });
});

// 监听高级设置变更
checkCrossWindows.addEventListener('change', () => {
  updateSettings({ checkCrossWindows: checkCrossWindows.checked });
});

ignoreTrailingSlash.addEventListener('change', () => {
  updateSettings({ ignoreTrailingSlash: ignoreTrailingSlash.checked });
});

ignoreHash.addEventListener('change', () => {
  updateSettings({ ignoreHash: ignoreHash.checked });
});

ignoreTrackingParams.addEventListener('change', () => {
  updateSettings({ ignoreTrackingParams: ignoreTrackingParams.checked });
});

protectPinnedTabs.addEventListener('change', () => {
  updateSettings({ protectPinnedTabs: protectPinnedTabs.checked });
});

// 页面加载就绪
document.addEventListener('DOMContentLoaded', initPopup);
