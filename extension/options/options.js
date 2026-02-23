/**
 * options/options.js — Preread 設定ページスクリプト
 *
 * 責務:
 *   - chrome.storage.sync からAPIキー・設定値を読み込み、フォームに表示する
 *   - フォームの入力内容を chrome.storage.sync に保存する
 *   - 検索プロバイダの切り替えに応じてUIを切り替える
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// DOM要素の取得
// ═══════════════════════════════════════════════════════════════════════════
const el = {
  youtubeApiKey:      document.getElementById('youtube-api-key'),
  braveApiKey:        document.getElementById('brave-api-key'),
  searchApiKey:       document.getElementById('search-api-key'),
  searchEngineId:     document.getElementById('search-engine-id'),
  serpapiKey:         document.getElementById('serpapi-key'),
  searchProviderRadios: document.querySelectorAll('input[name="search-provider"]'),
  braveSearchFields:  document.getElementById('brave-search-fields'),
  googleSearchFields: document.getElementById('google-search-fields'),
  serpapiFields:      document.getElementById('serpapi-fields'),
  btnSave:            document.getElementById('btn-save'),
  msgSaved:           document.getElementById('msg-saved'),
};

// ═══════════════════════════════════════════════════════════════════════════
// 初期化
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  bindEvents();
});

/**
 * chrome.storage.sync から設定を読み込み、フォームに反映する
 */
async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    'youtubeApiKey',
    'braveApiKey',
    'searchApiKey',
    'searchEngineId',
    'serpapiKey',
    'searchProvider',
  ]);

  // 各フィールドに設定値をセット
  el.youtubeApiKey.value  = settings.youtubeApiKey  || '';
  el.braveApiKey.value    = settings.braveApiKey    || '';
  el.searchApiKey.value   = settings.searchApiKey   || '';
  el.searchEngineId.value = settings.searchEngineId || '';
  el.serpapiKey.value     = settings.serpapiKey     || '';

  // 検索プロバイダの選択状態を復元（デフォルトはbrave）
  const provider = settings.searchProvider || 'brave';
  el.searchProviderRadios.forEach(radio => {
    radio.checked = radio.value === provider;
  });

  // プロバイダに応じてフィールドの表示を切り替え
  updateProviderFields(provider);
}

// ═══════════════════════════════════════════════════════════════════════════
// イベントバインド
// ═══════════════════════════════════════════════════════════════════════════
function bindEvents() {
  // 検索プロバイダ切り替え
  el.searchProviderRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      updateProviderFields(radio.value);
    });
  });

  // 保存ボタン
  el.btnSave.addEventListener('click', saveSettings);
}

// ═══════════════════════════════════════════════════════════════════════════
// UIの切り替え
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 選択された検索プロバイダに応じてフォームフィールドを切り替える
 * @param {'brave'|'google'|'serpapi'} provider
 */
function updateProviderFields(provider) {
  el.braveSearchFields.style.display  = provider === 'brave'   ? 'block' : 'none';
  el.googleSearchFields.style.display = provider === 'google'  ? 'block' : 'none';
  el.serpapiFields.style.display      = provider === 'serpapi' ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════════════════════════
// 設定の保存
// ═══════════════════════════════════════════════════════════════════════════

/**
 * フォームの入力内容を chrome.storage.sync に保存する
 */
async function saveSettings() {
  // 選択中の検索プロバイダを取得
  const selectedProvider = [...el.searchProviderRadios]
    .find(r => r.checked)?.value || 'google';

  const settings = {
    youtubeApiKey:  el.youtubeApiKey.value.trim(),
    braveApiKey:    el.braveApiKey.value.trim(),
    searchApiKey:   el.searchApiKey.value.trim(),
    searchEngineId: el.searchEngineId.value.trim(),
    serpapiKey:     el.serpapiKey.value.trim(),
    searchProvider: selectedProvider,
  };

  try {
    await chrome.storage.sync.set(settings);

    // 保存完了フィードバック
    el.msgSaved.classList.add('show');
    setTimeout(() => el.msgSaved.classList.remove('show'), 3000);

    console.log('[Preread] 設定を保存しました:', {
      ...settings,
      youtubeApiKey: settings.youtubeApiKey ? '***設定済み***' : '（未設定）',
      braveApiKey:   settings.braveApiKey   ? '***設定済み***' : '（未設定）',
      searchApiKey:  settings.searchApiKey  ? '***設定済み***' : '（未設定）',
      serpapiKey:    settings.serpapiKey    ? '***設定済み***' : '（未設定）',
    });

  } catch (err) {
    console.error('[Preread] 設定の保存に失敗しました:', err);
    alert(`設定の保存に失敗しました:\n${err.message}`);
  }
}
