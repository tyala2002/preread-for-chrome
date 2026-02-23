/**
 * popup.js — Preread Chrome拡張機能 ポップアップメインスクリプト
 *
 * 責務:
 *   1. Amazonページからの書籍タイトル取得
 *   2. background service worker経由でのWeb記事・YouTube動画検索
 *   3. 検索結果の一覧表示（チェックボックス付き）
 *   4. 選択URLのクリップボードコピー
 *   5. NotebookLMへの自動追加（Tier 1 / Tier 2）の進捗管理
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// DOM要素の取得（起動時に一括キャッシュ）
// ═══════════════════════════════════════════════════════════════════════════
const el = {
  // 書籍タイトル関連
  bookTitleDisplay: document.getElementById('book-title-display'),
  bookTitleInput: document.getElementById('book-title-input'),
  btnEditTitle: document.getElementById('btn-edit-title'),
  msgNotAmazon: document.getElementById('msg-not-amazon'),

  // 検索ボタン
  btnSearch: document.getElementById('btn-search'),

  // ローディング
  loading: document.getElementById('loading'),
  loadingText: document.getElementById('loading-text'),

  // APIキー未設定警告
  msgNoApiKey: document.getElementById('msg-no-api-key'),
  btnGoOptions: document.getElementById('btn-go-options'),

  // 検索結果エリア
  resultsSection: document.getElementById('results-section'),
  btnSelectAll: document.getElementById('btn-select-all'),
  btnDeselectAll: document.getElementById('btn-deselect-all'),
  listArticles: document.getElementById('list-articles'),
  listVideos: document.getElementById('list-videos'),

  // アクションボタン
  actionButtonsContainer: document.getElementById('action-buttons-container'),
  btnCopyUrls: document.getElementById('btn-copy-urls'),
  btnAddToNotebooklm: document.getElementById('btn-add-to-notebooklm'),

  // 進捗バー
  progressArea: document.getElementById('progress-area'),
  progressBarFill: document.getElementById('progress-bar-fill'),
  progressText: document.getElementById('progress-text'),

  // 完了・エラーメッセージ
  msgSuccess: document.getElementById('msg-success'),
  successCount: document.getElementById('success-count'),
  errorArea: document.getElementById('error-area'),
  listErrors: document.getElementById('list-errors'),
  btnRetryFailed: document.getElementById('btn-retry-failed'),

  // ヘッダー設定リンク
  btnOpenOptions: document.getElementById('btn-open-options'),
};

// ═══════════════════════════════════════════════════════════════════════════
// アプリケーション状態
// ═══════════════════════════════════════════════════════════════════════════
/** @type {{ title: string, url: string, checked: boolean, status: string }[]} */
let articleResults = [];

/** @type {{ title: string, url: string, checked: boolean, status: string }[]} */
let videoResults = [];

/** タイトル編集モード中かどうか */
let isEditingTitle = false;

/** 失敗したURLのリスト（再試行用） */
let failedUrls = [];

// ═══════════════════════════════════════════════════════════════════════════
// 初期化
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  await init();
  bindEvents();
});

/**
 * 初期化処理
 * - 現在のタブを確認してAmazonページかどうか判定
 * - 書籍タイトルを自動取得
 * - APIキー設定状況を確認
 */
async function init() {
  try {
    const tab = await getCurrentTab();

    if (!isAmazonBookPage(tab.url)) {
      // Amazonの書籍ページ以外では警告を表示
      el.msgNotAmazon.classList.remove('hidden');
      el.bookTitleDisplay.textContent = '—';
      el.btnSearch.disabled = true;
      return;
    }

    // Amazonページのコンテンツスクリプトからタイトルを取得
    const title = await fetchBookTitle(tab.id);
    if (title) {
      setBookTitle(title);
    } else {
      // タイトル自動取得失敗 → 手入力モードに切り替え
      enterEditMode();
    }

    // APIキーの設定確認
    await checkApiKeys();

  } catch (err) {
    console.error('[Preread] init error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// イベントバインド
// ═══════════════════════════════════════════════════════════════════════════
function bindEvents() {
  // タイトル編集ボタン
  el.btnEditTitle.addEventListener('click', toggleEditMode);

  // タイトル入力確定（Enterキー）
  el.bookTitleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmEditTitle();
  });

  // 検索ボタン
  el.btnSearch.addEventListener('click', onSearchClick);

  // 全選択 / 全解除
  el.btnSelectAll.addEventListener('click', () => setAllChecked(true));
  el.btnDeselectAll.addEventListener('click', () => setAllChecked(false));

  // URLコピーボタン
  el.btnCopyUrls.addEventListener('click', onCopyUrls);

  // NotebookLMへ追加ボタン
  // ⚠️ 直接 onAddToNotebooklm を渡すと MouseEvent が retryFailed に入ってしまうため
  //    アロー関数でラップして引数なしで呼び出す
  el.btnAddToNotebooklm.addEventListener('click', () => onAddToNotebooklm());

  // 失敗分再試行ボタン
  el.btnRetryFailed.addEventListener('click', () => onAddToNotebooklm(true));

  // 設定画面を開く（ヘッダー歯車アイコン）
  el.btnOpenOptions.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // 設定画面へ誘導ボタン（APIキー未設定時）
  el.btnGoOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
}

// ═══════════════════════════════════════════════════════════════════════════
// 書籍タイトル関連
// ═══════════════════════════════════════════════════════════════════════════

/**
 * タイトルを表示エリアにセットし、検索ボタンを有効化する
 * @param {string} title
 */
function setBookTitle(title) {
  el.bookTitleDisplay.textContent = title;
  el.btnSearch.disabled = !title.trim();
}

/**
 * タイトル編集モードのトグル
 */
function toggleEditMode() {
  if (isEditingTitle) {
    confirmEditTitle();
  } else {
    enterEditMode();
  }
}

/**
 * 編集モードに入る（inputを表示してフォーカス）
 */
function enterEditMode() {
  isEditingTitle = true;
  const currentTitle = el.bookTitleDisplay.textContent === '—'
    ? ''
    : el.bookTitleDisplay.textContent;
  el.bookTitleInput.value = currentTitle;
  el.bookTitleDisplay.classList.add('hidden');
  el.bookTitleInput.classList.remove('hidden');
  el.btnEditTitle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><path d="M20 6 9 17l-5-5"/></svg>';
  el.bookTitleInput.focus();
}

/**
 * 編集確定（表示に戻す）
 */
function confirmEditTitle() {
  isEditingTitle = false;
  const newTitle = el.bookTitleInput.value.trim();
  el.bookTitleInput.classList.add('hidden');
  el.bookTitleDisplay.classList.remove('hidden');
  el.btnEditTitle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';
  if (newTitle) setBookTitle(newTitle);
}

// ═══════════════════════════════════════════════════════════════════════════
// 検索処理
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 検索ボタンクリック時の処理
 */
async function onSearchClick() {
  const title = el.bookTitleDisplay.textContent.trim();
  if (!title || title === '—') return;

  // UI：ローディング開始
  showLoading('検索中...');
  el.resultsSection.classList.add('hidden');
  clearResultLists();

  try {
    // background service workerにメッセージを送って検索実行
    const response = await sendMessage({
      type: 'SEARCH_SOURCES',
      payload: { bookTitle: title },
    });

    if (response.error) {
      throw new Error(response.error);
    }

    // 結果をステート・UIに反映
    articleResults = (response.articles || []).map(item => ({ ...item, checked: true, status: '' }));
    videoResults = (response.videos || []).map(item => ({ ...item, checked: true, status: '' }));

    // Web記事検索でAPIエラーが発生していた場合は警告表示
    if (response.searchErrors?.length) {
      console.warn('[Preread] 検索APIエラー:', response.searchErrors);
      showSearchWarning(response.searchErrors);
    }

    renderResults();
    el.resultsSection.classList.remove('hidden');

  } catch (err) {
    console.error('[Preread] search error:', err);
    if (err.message === 'NO_API_KEY') {
      el.msgNoApiKey.classList.remove('hidden');
    } else {
      alert(`検索中にエラーが発生しました:\n${err.message}`);
    }
  } finally {
    hideLoading();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 結果リスト描画
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 検索結果を全てレンダリングする
 */
function renderResults() {
  renderList(el.listArticles, articleResults, 'article');
  renderList(el.listVideos, videoResults, 'video');
}

/**
 * 指定リストに検索結果アイテムを描画する
 * @param {HTMLUListElement} listEl
 * @param {{ title: string, url: string, checked: boolean, status: string }[]} items
 * @param {'article'|'video'} type
 */
function renderList(listEl, items, type) {
  listEl.innerHTML = '';

  if (items.length === 0) {
    const li = document.createElement('li');
    li.textContent = '結果が見つかりませんでした';
    li.style.color = 'var(--color-text-sub)';
    li.style.fontSize = '12px';
    li.style.padding = '6px 0';
    listEl.appendChild(li);
    return;
  }

  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = `source-item ${item.checked ? 'checked' : ''}`;
    li.dataset.index = index;
    li.dataset.type = type;

    // チェックボックス
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.checked;
    checkbox.addEventListener('change', () => {
      item.checked = checkbox.checked;
      li.classList.toggle('checked', item.checked);
    });

    // タイトルとURL
    const info = document.createElement('div');
    info.className = 'source-item-info';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'source-item-title';
    titleSpan.textContent = item.title || '（タイトルなし）';
    titleSpan.title = item.title;

    const urlSpan = document.createElement('span');
    urlSpan.className = 'source-item-url';
    urlSpan.textContent = item.url;
    urlSpan.title = item.url;

    info.appendChild(titleSpan);
    info.appendChild(urlSpan);

    // ステータスバッジ（追加中・完了・エラー等）
    const statusSpan = document.createElement('span');
    statusSpan.className = 'source-item-status';
    statusSpan.innerHTML = item.status;

    li.appendChild(checkbox);
    li.appendChild(info);
    li.appendChild(statusSpan);

    // アイテム行をクリックしてもチェックをトグル
    li.addEventListener('click', (e) => {
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
        item.checked = checkbox.checked;
        li.classList.toggle('checked', item.checked);
      }
    });

    listEl.appendChild(li);
  });
}

/**
 * 結果リストの内容をクリアする
 */
function clearResultLists() {
  el.listArticles.innerHTML = '';
  el.listVideos.innerHTML = '';
  el.msgSuccess.classList.add('hidden');
  el.errorArea.classList.add('hidden');
  el.progressArea.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════
// チェックボックス一括操作
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 全チェックボックスの状態を一括変更する
 * @param {boolean} checked
 */
function setAllChecked(checked) {
  [...articleResults, ...videoResults].forEach(item => {
    item.checked = checked;
  });
  // 再描画
  renderResults();
}

/**
 * 選択されているURLの配列を返す
 * @returns {string[]}
 */
function getSelectedUrls() {
  return [
    ...articleResults.filter(i => i.checked).map(i => i.url),
    ...videoResults.filter(i => i.checked).map(i => i.url),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// クリップボードコピー
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 選択されたURLをクリップボードにコピーする
 */
async function onCopyUrls() {
  const urls = getSelectedUrls();

  if (urls.length === 0) {
    alert('URLが選択されていません');
    return;
  }

  try {
    await navigator.clipboard.writeText(urls.join('\n'));

    // コピー成功フィードバック: ボタンラベルを一時的に変更
    const originalText = el.btnCopyUrls.textContent;
    el.btnCopyUrls.textContent = '✅ コピーしました';
    el.btnCopyUrls.disabled = true;

    setTimeout(() => {
      el.btnCopyUrls.textContent = originalText;
      el.btnCopyUrls.disabled = false;
    }, 2000);

  } catch (err) {
    console.error('[Preread] clipboard error:', err);
    alert('クリップボードへのコピーに失敗しました');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NotebookLMへの自動追加
// ═══════════════════════════════════════════════════════════════════════════

/**
 * NotebookLMへのURL自動追加を開始する
 * @param {boolean} [retryFailed=false] - 失敗分の再試行かどうか
 */
async function onAddToNotebooklm(retryFailed = false) {
  const urls = retryFailed ? failedUrls : getSelectedUrls();

  if (urls.length === 0) {
    alert(retryFailed ? '再試行するURLがありません' : 'URLが選択されていません');
    return;
  }

  // UIリセット
  el.msgSuccess.classList.add('hidden');
  el.errorArea.classList.add('hidden');
  document.getElementById('add-error')?.remove();
  failedUrls = [];
  el.btnAddToNotebooklm.disabled = true;
  el.actionButtonsContainer.classList.add('hidden'); // ボタン群を隠して進捗のみを見せる

  // ── NotebookLMタブの状態を事前確認し、適切なメッセージを即座に表示 ──
  // service_worker からのメッセージを待つと、その頃にはポップアップが
  // 閉じている可能性があるため、ポップアップ側で先に表示する
  {
    const nlmTabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
    const alreadyOnNotebook = nlmTabs.some(t => {
      try { return new URL(t.url).pathname.startsWith('/notebook/'); } catch { return false; }
    });

    if (alreadyOnNotebook) {
      // すでにノートブックを開いているなら追加中を表示
      showProgress(0, urls.length);
    } else {
      // NotebookLMが未開 or 一覧ページ → 自動作成する旨を先出し
      showStatusMessage('NotebookLMを開いて新しいノートブックを自動作成中...');
    }
  }

  try {
    // background service workerにメッセージを送って追加開始
    // 進捗はメッセージリスナーで受け取る
    const response = await sendMessage({
      type: 'ADD_TO_NOTEBOOKLM',
      payload: {
        urls,
        title: el.bookTitleDisplay.textContent
      },
    });

    // service workerからのエラーをチェック（DOM操作失敗など）
    if (response?.error) {
      el.progressArea.classList.add('hidden');
      el.actionButtonsContainer.classList.remove('hidden');
      showAddError(response.error);
    }

  } catch (err) {
    console.error('[Preread] add to notebooklm error:', err);
    el.progressArea.classList.add('hidden');
    el.actionButtonsContainer.classList.remove('hidden');
    showAddError(err.message);
  } finally {
    el.btnAddToNotebooklm.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 進捗メッセージリスナー（service workerから受信）
// ═══════════════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PROGRESS_UPDATE') {
    const { current, total, url, success } = message.payload;

    // ノートブック選択待ち表示をクリア
    hideStatusMessage();

    // 進捗バーを更新
    showProgress(current, total);

    // 各アイテムのステータスを更新
    const iconSuccess = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-circle-2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>';
    const iconError = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-circle"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>';
    updateItemStatus(url, success ? iconSuccess : iconError);

    if (!success) {
      failedUrls.push(url);
    }

    // 全件処理完了
    if (current === total) {
      onAllDone(total - failedUrls.length, failedUrls);
    }
  }

  if (message.type === 'STATUS_UPDATE') {
    const { message: msg } = message.payload;
    // エラーメッセージ（⚠️ で始まる）は progress テキストに直接表示
    if (msg) {
      el.progressArea.classList.remove('hidden');
      el.progressText.textContent = msg;
    }
  }

  if (message.type === 'NOTEBOOK_READY') {
    const { notebookUrl } = message.payload;
    showNotebookLink(notebookUrl);
  }
});

/**
 * 全追加完了時の処理
 * @param {number} successCount
 * @param {string[]} errors
 */
function onAllDone(successCount, errors) {
  el.progressArea.classList.add('hidden');

  if (successCount > 0) {
    el.successCount.textContent = successCount;
    el.msgSuccess.classList.remove('hidden');
  }

  if (errors.length > 0) {
    renderErrorList(errors);
    el.errorArea.classList.remove('hidden');
    el.actionButtonsContainer.classList.remove('hidden');
  }

  // 自動的に最下部までスクロールして完了領域を見せる
  setTimeout(() => {
    const area = document.getElementById('notebook-link-area');
    (area || document.body).scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, 150);
}

/**
 * エラーURLリストを描画する
 * @param {string[]} urls
 */
function renderErrorList(urls) {
  el.listErrors.innerHTML = '';
  urls.forEach(url => {
    const li = document.createElement('li');
    li.textContent = url;
    el.listErrors.appendChild(li);
  });
}

/**
 * ソースアイテムのステータスを更新する
 * @param {string} url
 * @param {string} statusText
 */
function updateItemStatus(url, statusHtml) {
  const allItems = [...articleResults, ...videoResults];
  const item = allItems.find(i => i.url === url);
  if (item) {
    item.status = statusHtml;
    // DOM上のステータスも更新
    const li = document.querySelector(`.source-item[data-url="${CSS.escape(url)}"]`);
    if (li) {
      const statusSpan = li.querySelector('.source-item-status');
      if (statusSpan) statusSpan.innerHTML = statusHtml;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UI ヘルパー
// ═══════════════════════════════════════════════════════════════════════════

/**
 * NotebookLM追加処理のエラーをポップアップ内に表示する
 * @param {string} message
 */
function showAddError(message) {
  document.getElementById('add-error')?.remove();

  const div = document.createElement('div');
  div.id = 'add-error';
  div.style.cssText = `
    margin: 6px 14px;
    padding: 10px 12px;
    background: #fce8e6;
    border: 1px solid #f5c6c2;
    border-radius: 6px;
    font-size: 12px;
    color: #d93025;
    line-height: 1.5;
    word-break: break-all;
  `;
  div.innerHTML = `❌ NotebookLM追加エラー:<br>
    <code style="font-size:11px;">${message}</code>`;

  el.resultsSection.querySelector('.action-buttons').after(div);
}

/**
 * Web記事検索APIのエラー警告をポップアップ内に表示する
 * @param {string[]} errors
 */
function showSearchWarning(errors) {
  // 既存の警告を削除
  document.getElementById('search-warning')?.remove();

  const div = document.createElement('div');
  div.id = 'search-warning';
  div.style.cssText = `
    margin: 6px 14px;
    padding: 8px 12px;
    background: #fff8e1;
    border: 1px solid #ffe082;
    border-radius: 6px;
    font-size: 11px;
    color: #5f4c00;
    line-height: 1.5;
  `;
  div.innerHTML = `⚠️ 一部の検索でエラーが発生しました:<br>
    <code style="font-size:10px; word-break:break-all;">${errors.join('<br>')}</code><br>
    APIキーのクォータ上限に達しているか、設定画面でAPIキーを確認してください。`;

  // resultsSection の直前に挿入
  el.resultsSection.before(div);
}

/**
 * ノートブック選択待ちなどのステータスメッセージを進捗エリアに表示する
 * @param {string} msg
 */
function showStatusMessage(msg) {
  el.progressArea.classList.remove('hidden');
  el.progressBarFill.style.width = '0%';
  el.progressText.textContent = msg;
}

function hideStatusMessage() {
  // 進捗バーがまだ待機メッセージ（%表示でない）のままなら非表示に戻す
  if (el.progressText.textContent.includes('自動作成中')) {
    el.progressArea.classList.add('hidden');
  }
}

/**
 * 完成したノートブックへのリンクを表示する
 * @param {string} url - NotebookLMのノートブックURL
 */
function showNotebookLink(url) {
  if (!url) return;
  const area = document.getElementById('notebook-link-area');
  const link = document.getElementById('notebook-link');
  if (area && link) {
    link.href = url;
    area.classList.remove('hidden');

    // 最下部までスクロール
    setTimeout(() => {
      area.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 150);
  }
}

function showLoading(text = '処理中...') {
  el.loadingText.textContent = text;
  el.loading.classList.remove('hidden');
  el.btnSearch.disabled = true;
}

function hideLoading() {
  el.loading.classList.add('hidden');
  el.btnSearch.disabled = false;
}

/**
 * 進捗バーを更新する
 * @param {number} current
 * @param {number} total
 */
function showProgress(current, total) {
  el.progressArea.classList.remove('hidden');
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  el.progressBarFill.style.width = `${pct}%`;
  el.progressText.textContent = `${current} / ${total} 件追加中...`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Chrome API ヘルパー
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 現在アクティブなタブを取得する
 * @returns {Promise<chrome.tabs.Tab>}
 */
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * URLがAmazonの書籍ページかどうか判定する
 * Amazon.co.jp / Amazon.com の両方に対応
 * @param {string} url
 * @returns {boolean}
 */
function isAmazonBookPage(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const isAmazon = u.hostname === 'www.amazon.co.jp' || u.hostname === 'www.amazon.com';
    // 書籍商品ページのパターン: /dp/XXXXXX または /gp/product/XXXXXX
    const isProductPage = /\/(dp|gp\/product)\/[A-Z0-9]+/.test(u.pathname);
    return isAmazon && isProductPage;
  } catch {
    return false;
  }
}

/**
 * コンテンツスクリプト（amazon.js）から書籍タイトルを取得する
 * @param {number} tabId
 * @returns {Promise<string|null>}
 */
async function fetchBookTitle(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // amazon.js の getBookTitle 関数を呼び出す
        return window.__preread_getBookTitle?.() ?? null;
      },
    });
    return result?.result ?? null;
  } catch (err) {
    console.warn('[Preread] fetchBookTitle error:', err);
    return null;
  }
}

/**
 * APIキーが設定されているかを確認し、未設定の場合は警告を表示する
 */
async function checkApiKeys() {
  const keys = await chrome.storage.sync.get(['youtubeApiKey', 'searchApiKey', 'braveApiKey']);
  const hasWebKey = keys.braveApiKey || keys.searchApiKey;
  if (!keys.youtubeApiKey && !hasWebKey) {
    el.msgNoApiKey.classList.remove('hidden');
    el.btnSearch.disabled = true;
  } else {
    el.msgNoApiKey.classList.add('hidden');
    el.btnSearch.disabled = false;
  }
}

/**
 * background service worker にメッセージを送り、レスポンスを返す
 * @param {object} message
 * @returns {Promise<any>}
 */
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}
