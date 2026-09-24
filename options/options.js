/**
 * OnePage - Options 设置页逻辑
 */

import { getConfig, saveConfig } from '../utils.js';

let currentConfig = null;
let saveToastTimeout = null;

// DOM 元素引用
const optEnabled = document.getElementById('optEnabled');
const optModeFocusOld = document.getElementById('optModeFocusOld');
const optModeKeepNew = document.getElementById('optModeKeepNew');
const optCrossWindows = document.getElementById('optCrossWindows');
const optProtectPinned = document.getElementById('optProtectPinned');
const optShowBadge = document.getElementById('optShowBadge');

const optIgnoreTrailingSlash = document.getElementById('optIgnoreTrailingSlash');
const optIgnoreHash = document.getElementById('optIgnoreHash');
const optIgnoreTracking = document.getElementById('optIgnoreTracking');
const optIgnoreQuery = document.getElementById('optIgnoreQuery');

const whitelistInput = document.getElementById('whitelistInput');
const btnAddWhitelist = document.getElementById('btnAddWhitelist');
const whitelistUl = document.getElementById('whitelistUl');

const statTotal = document.getElementById('statTotal');
const statNewClosed = document.getElementById('statNewClosed');
const statOldClosed = document.getElementById('statOldClosed');
const btnResetStats = document.getElementById('btnResetStats');
const saveNotification = document.getElementById('saveNotification');

/**
 * 提示保存成功
 */
function showSaveToast() {
  saveNotification.classList.remove('hidden');
  if (saveToastTimeout) clearTimeout(saveToastTimeout);
  saveToastTimeout = setTimeout(() => {
    saveNotification.classList.add('hidden');
  }, 2000);
}

/**
 * 更新并保存设置
 */
async function updateSettings(changes) {
  currentConfig = { ...currentConfig, ...changes };
  await saveConfig(currentConfig);
  chrome.runtime.sendMessage({ action: 'update_config', config: currentConfig });
  showSaveToast();
}

/**
 * 渲染白名单列表
 */
function renderWhitelist() {
  whitelistUl.innerHTML = '';
  const list = currentConfig.whitelist || [];

  if (list.length === 0) {
    whitelistUl.innerHTML = '<li style="padding: 12px; color: #94a3b8; text-align: center;">暂无白名单域名</li>';
    return;
  }

  list.forEach((domain, index) => {
    const li = document.createElement('li');
    li.className = 'whitelist-item';
    li.innerHTML = `
      <span><code>${domain}</code></span>
      <button class="btn-delete-item" data-index="${index}">移除</button>
    `;
    whitelistUl.appendChild(li);
  });

  // 绑定删除事件
  whitelistUl.querySelectorAll('.btn-delete-item').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'), 10);
      list.splice(idx, 1);
      await updateSettings({ whitelist: list });
      renderWhitelist();
    });
  });
}

/**
 * 初始化设置页面
 */
async function initOptions() {
  currentConfig = await getConfig();

  // 1. 同步常规设置
  optEnabled.checked = currentConfig.enabled;
  if (currentConfig.mode === 'keep_new') {
    optModeKeepNew.checked = true;
  } else {
    optModeFocusOld.checked = true;
  }
  optCrossWindows.checked = !!currentConfig.checkCrossWindows;
  optProtectPinned.checked = !!currentConfig.protectPinnedTabs;
  optShowBadge.checked = !!currentConfig.showNotificationBadge;

  // 2. 同步匹配规则
  optIgnoreTrailingSlash.checked = !!currentConfig.ignoreTrailingSlash;
  optIgnoreHash.checked = !!currentConfig.ignoreHash;
  optIgnoreTracking.checked = !!currentConfig.ignoreTrackingParams;
  optIgnoreQuery.checked = !!currentConfig.ignoreQuery;

  // 3. 统计数据
  const stats = currentConfig.stats || {};
  statTotal.textContent = stats.totalDuplicates || 0;
  statNewClosed.textContent = stats.newTabsClosed || 0;
  statOldClosed.textContent = stats.oldTabsClosed || 0;

  // 4. 白名单
  renderWhitelist();
}

// 绑定常规设置变更
optEnabled.addEventListener('change', () => updateSettings({ enabled: optEnabled.checked }));
optModeFocusOld.addEventListener('change', () => {
  if (optModeFocusOld.checked) updateSettings({ mode: 'focus_old' });
});
optModeKeepNew.addEventListener('change', () => {
  if (optModeKeepNew.checked) updateSettings({ mode: 'keep_new' });
});
optCrossWindows.addEventListener('change', () => updateSettings({ checkCrossWindows: optCrossWindows.checked }));
optProtectPinned.addEventListener('change', () => updateSettings({ protectPinnedTabs: optProtectPinned.checked }));
optShowBadge.addEventListener('change', () => updateSettings({ showNotificationBadge: optShowBadge.checked }));

// 绑定匹配规则变更
optIgnoreTrailingSlash.addEventListener('change', () => updateSettings({ ignoreTrailingSlash: optIgnoreTrailingSlash.checked }));
optIgnoreHash.addEventListener('change', () => updateSettings({ ignoreHash: optIgnoreHash.checked }));
optIgnoreTracking.addEventListener('change', () => updateSettings({ ignoreTrackingParams: optIgnoreTracking.checked }));
optIgnoreQuery.addEventListener('change', () => updateSettings({ ignoreQuery: optIgnoreQuery.checked }));

// 添加白名单
function addWhitelistItem() {
  let val = whitelistInput.value.trim().toLowerCase();
  if (!val) return;

  // 提取域名 (防止用户粘贴完整 URL)
  try {
    if (val.includes('://')) {
      val = new URL(val).hostname;
    } else if (val.includes('/')) {
      val = val.split('/')[0];
    }
  } catch (e) {
    // ignore
  }

  const list = currentConfig.whitelist || [];
  if (!list.includes(val)) {
    list.push(val);
    updateSettings({ whitelist: list });
    renderWhitelist();
  }
  whitelistInput.value = '';
}

btnAddWhitelist.addEventListener('click', addWhitelistItem);
whitelistInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addWhitelistItem();
});

// 重置统计数据
btnResetStats.addEventListener('click', async () => {
  if (confirm('确定要清零所有去重统计数据吗？')) {
    const emptyStats = {
      totalDuplicates: 0,
      oldTabsClosed: 0,
      newTabsClosed: 0,
      lastDeduplicatedAt: null
    };
    await updateSettings({ stats: emptyStats });
    statTotal.textContent = '0';
    statNewClosed.textContent = '0';
    statOldClosed.textContent = '0';
  }
});

// 侧边栏导航平滑滚动
document.querySelectorAll('.nav-item').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const targetId = link.getAttribute('href').substring(1);
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth' });
      document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
      link.classList.add('active');
    }
  });
});

document.addEventListener('DOMContentLoaded', initOptions);
