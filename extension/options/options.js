/**
 * options/options.js — Preread 設定ページスクリプト
 *
 * 責務:
 *   - Tavily APIキーの読み込み・保存
 *   - 追加済み書籍履歴（bookNotebookHistory）の表示・削除
 */

'use strict';

import { initI18n, t } from '../i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// DOM要素の取得
// ═══════════════════════════════════════════════════════════════════════════
const el = {
  braveApiKey:    document.getElementById('brave-api-key'),
  languageSelect: document.getElementById('language-select'),
  btnSave:        document.getElementById('btn-save'),
  msgSaved:       document.getElementById('msg-saved'),

  // タブ
  tabBtns:   document.querySelectorAll('.tab-btn'),
  tabPanels: document.querySelectorAll('.tab-panel'),

  // 追加済み書籍管理
  historyCount: document.getElementById('history-count'),
  historyEmpty: document.getElementById('history-empty'),
  historyList:  document.getElementById('history-list'),
  btnClearAll:  document.getElementById('btn-clear-all'),
};

// ═══════════════════════════════════════════════════════════════════════════
// 初期化
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  await initI18n();
  applyI18n();
  await loadSettings();
  await renderHistory();
  bindEvents();
});

/**
 * data-i18n 属性を持つ要素に翻訳テキストを適用する
 */
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// タブ切り替え
// ═══════════════════════════════════════════════════════════════════════════
function bindTabEvents() {
  el.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      el.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === target));
      el.tabPanels.forEach(panel => panel.classList.toggle('active', panel.id === `tab-${target}`));
      if (target === 'history') renderHistory();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// APIキー設定
// ═══════════════════════════════════════════════════════════════════════════

async function loadSettings() {
  const { braveApiKey = '', language = 'auto' } = await chrome.storage.sync.get(['braveApiKey', 'language']);
  el.braveApiKey.value = braveApiKey;
  el.languageSelect.value = language;
}

async function saveSettings() {
  try {
    await chrome.storage.sync.set({
      braveApiKey:    el.braveApiKey.value.trim(),
      searchProvider: 'brave', // Tavily を使うよう固定
      language:       el.languageSelect.value,
    });

    // 言語変更を即時反映
    await initI18n();
    applyI18n();
    await renderHistory();

    el.msgSaved.classList.add('show');
    setTimeout(() => el.msgSaved.classList.remove('show'), 3000);
  } catch (err) {
    console.error('[Preread] 設定の保存に失敗しました:', err);
    alert(`${t('alert_save_error')}\n${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 追加済み書籍履歴の管理
// ═══════════════════════════════════════════════════════════════════════════

async function renderHistory() {
  const { bookNotebookHistory = [] } = await chrome.storage.local.get('bookNotebookHistory');

  el.historyCount.textContent = bookNotebookHistory.length > 0
    ? t('history_count', { n: bookNotebookHistory.length })
    : '';
  el.btnClearAll.style.display = bookNotebookHistory.length > 0 ? '' : 'none';

  if (bookNotebookHistory.length === 0) {
    el.historyEmpty.style.display = 'block';
    el.historyList.innerHTML = '';
    return;
  }

  el.historyEmpty.style.display = 'none';
  el.historyList.innerHTML = '';

  const bookOpenIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
  const trashIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;

  bookNotebookHistory.forEach(entry => {
    const li = document.createElement('li');
    li.className = 'history-item';

    const date = entry.timestamp ? new Date(entry.timestamp) : null;
    const dateStr = date
      ? `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
      : '';

    li.innerHTML = `
      <div class="history-item-info">
        <div class="history-item-title" title="${escapeHtml(entry.bookTitle || '')}">
          ${escapeHtml(entry.bookTitle || t('no_title'))}
        </div>
        ${dateStr ? `<div class="history-item-meta">${t('history_date_added', { date: dateStr })}</div>` : ''}
      </div>
      <div class="history-item-actions">
        <a class="btn-open-notebook" href="${escapeHtml(entry.notebookUrl || '#')}" target="_blank">
          ${bookOpenIcon} ${t('btn_open_notebook')}
        </a>
        <button class="btn-delete-item" title="${t('btn_delete_item_title')}" data-asin="${escapeHtml(entry.asin || '')}">
          ${trashIcon}
        </button>
      </div>
    `;

    el.historyList.appendChild(li);
  });

  el.historyList.querySelectorAll('.btn-delete-item').forEach(btn => {
    btn.addEventListener('click', () => deleteHistoryEntry(btn.dataset.asin));
  });
}

async function deleteHistoryEntry(asin) {
  if (!asin) return;
  const { bookNotebookHistory = [] } = await chrome.storage.local.get('bookNotebookHistory');
  await chrome.storage.local.set({
    bookNotebookHistory: bookNotebookHistory.filter(h => h.asin !== asin),
  });
  await renderHistory();
}

async function clearAllHistory() {
  if (!confirm(t('confirm_clear_all'))) return;
  await chrome.storage.local.set({ bookNotebookHistory: [] });
  await renderHistory();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════════════
// イベントバインド
// ═══════════════════════════════════════════════════════════════════════════
function bindEvents() {
  bindTabEvents();
  el.btnSave.addEventListener('click', saveSettings);
  el.btnClearAll.addEventListener('click', clearAllHistory);
}
