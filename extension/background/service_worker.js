/**
 * background/service_worker.js — Preread バックグラウンドサービスワーカー
 *
 * 責務:
 *   1. popup.js からのメッセージ受信・ルーティング
 *   2. YouTube Data API v3 で動画URL検索
 *   3. Google Custom Search API / SerpAPI で Web記事URL検索
 *   4. NotebookLMへのURL追加（Tier 1 → Tier 2 の順で試みる）
 *   5. 進捗メッセージを popup.js に転送する
 *
 * メッセージプロトコル:
 *   - SEARCH_SOURCES: 書籍タイトルでWeb記事・YouTube動画を検索する
 *   - ADD_TO_NOTEBOOKLM: URLリストをNotebookLMに追加する
 *   - PROGRESS_UPDATE: 進捗状況をpopupに通知する（content scriptから受信して転送）
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// 定数
// ═══════════════════════════════════════════════════════════════════════════

/** YouTube Data API v3 のエンドポイント */
const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3/search';

/** Google Custom Search API のエンドポイント */
const CUSTOM_SEARCH_API_URL = 'https://www.googleapis.com/customsearch/v1';

/** SerpAPI のエンドポイント */
const SERP_API_URL = 'https://serpapi.com/search.json';

/** Tavily Search API のエンドポイント */
const TAVILY_SEARCH_API_URL = 'https://api.tavily.com/search';

/** NotebookLM の URL */
const NOTEBOOKLM_URL = 'https://notebooklm.google.com/';

/**
 * 低品質なドメインのフィルタリングリスト
 *
 * 検索結果にスパムサイトが混入しないよう除外するドメインのリスト。
 * 必要に応じて追加・削除すること。
 */
const BLOCKED_DOMAINS = [
  'pinterest.com',
  'pinterest.jp',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'amazon.co.jp',  // Amazonは自分自身を検索結果に含めない
  'amazon.com',
  'youtube.com',   // YouTube動画は別セクションで取得するため記事から除外
  'youtu.be',
];

/** 検索するWeb記事の最大件数 */
const MAX_ARTICLE_RESULTS = 5;

/** 検索するYouTube動画の最大件数 */
const MAX_VIDEO_RESULTS = 3;

// ═══════════════════════════════════════════════════════════════════════════
// メッセージリスナー（メインルーター）
// ═══════════════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.debug('[Preread SW] メッセージ受信:', message.type);

  switch (message.type) {
    case 'SEARCH_SOURCES':
      // 書籍タイトルでWeb記事・YouTube動画を検索する
      handleSearchSources(message.payload)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true; // 非同期レスポンス

    case 'ADD_TO_NOTEBOOKLM':
      // URLリストをNotebookLMに追加する
      handleAddToNotebookLM(message.payload, sender)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
      return true; // 非同期レスポンス

    case 'PROGRESS_UPDATE':
      // content scriptからの進捗通知をpopupに転送する
      forwardProgressToPopup(message.payload);
      sendResponse({ ok: true });
      return false;

    default:
      console.warn('[Preread SW] 未知のメッセージタイプ:', message.type);
      sendResponse({ error: `未知のメッセージタイプ: ${message.type}` });
      return false;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 検索処理
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 書籍タイトルでソースを検索する
 *
 * @param {{ bookTitle: string }} payload
 * @returns {Promise<{ articles: SearchResult[], videos: SearchResult[] }>}
 */
async function handleSearchSources({ bookTitle, locale = 'ja' }) {
  // APIキーを取得
  const { youtubeApiKey, searchApiKey, searchEngineId, searchProvider, braveApiKey } =
    await chrome.storage.sync.get([
      'youtubeApiKey',
      'searchApiKey',
      'searchEngineId',
      'searchProvider',
      'braveApiKey',
    ]);

  const hasWebSearchKey = braveApiKey || searchApiKey;
  if (!hasWebSearchKey) {
    throw new Error('NO_API_KEY');
  }

  console.log(`[Preread SW] 検索開始: "${bookTitle}"`);

  // Web記事とYouTube動画を並行して検索する
  const [articles, videos] = await Promise.allSettled([
    searchWebArticles(bookTitle, { braveApiKey, searchApiKey, searchEngineId, searchProvider, locale }),
    searchYouTubeVideos(bookTitle, youtubeApiKey || null, locale),
  ]);

  const articleData = articles.status === 'fulfilled'
    ? articles.value
    : { results: [], errors: [`Web記事検索: ${articles.reason}`] };
  const videoData = videos.status === 'fulfilled'
    ? videos.value
    : { results: [], errors: [`YouTube検索: ${videos.reason}`] };

  return {
    articles: articleData.results,
    videos: videoData.results,
    searchErrors: [
      ...(articleData.errors ?? []),
      ...(videoData.errors ?? []),
    ],
  };
}

/**
 * Web記事を検索する（Tavily / Google Custom Search / SerpAPI に対応）
 *
 * 優先順位: Tavily → Google Custom Search → SerpAPI
 *
 * 検索クエリ:
 *   - "{タイトル} 要約 レビュー まとめ"（1回の呼び出しで複合検索）
 *
 * @param {string} bookTitle
 * @param {{ braveApiKey?: string, searchApiKey?: string, searchEngineId?: string, searchProvider?: string }} keys
 * @returns {Promise<{ results: SearchResult[], errors: string[] }>}
 */
async function searchWebArticles(bookTitle, { braveApiKey, searchApiKey, searchEngineId, searchProvider = 'google', locale = 'ja' }) {
  const queries = [
    locale === 'en'
      ? `${bookTitle} review summary`
      : `${bookTitle} 要約 レビュー まとめ`,
  ];

  const allResults = [];
  const errors = [];

  for (const query of queries) {
    try {
      let results;
      if (braveApiKey) {
        results = await searchWithTavily(query, braveApiKey);
      } else if (searchProvider === 'serpapi') {
        results = await searchWithSerpApi(query, searchApiKey, locale);
      } else {
        results = await searchWithGoogleCustomSearch(query, searchApiKey, searchEngineId, locale);
      }
      allResults.push(...results);
    } catch (err) {
      console.warn(`[Preread SW] Web記事検索エラー (${query}):`, err.message);
      // 最初のクエリのエラーだけ収集（同じ原因が多いので代表1件）
      if (errors.length === 0) errors.push(err.message);
    }
  }

  return {
    results: deduplicateAndFilter(allResults).slice(0, MAX_ARTICLE_RESULTS),
    errors,
  };
}

/**
 * Tavily Search API でWeb記事を検索する
 *
 * ⚠️ API変更注意ポイント:
 *   エンドポイントやレスポンス形式が変わった場合はここを更新する。
 *
 * @param {string} query
 * @param {string} apiKey
 * @returns {Promise<SearchResult[]>}
 */
async function searchWithTavily(query, apiKey) {
  const response = await fetch(TAVILY_SEARCH_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: 10,
      include_answer: false,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Tavily APIエラー: ${response.status} - ${err.message || ''}`);
  }

  const data = await response.json();
  return (data.results || []).map(item => ({
    title: item.title,
    url: item.url,
    snippet: item.content,
  }));
}

/**
 * Google Custom Search API で検索する
 * @param {string} query
 * @param {string} apiKey
 * @param {string} engineId
 * @returns {Promise<SearchResult[]>}
 */
async function searchWithGoogleCustomSearch(query, apiKey, engineId, locale = 'ja') {
  if (!engineId) {
    throw new Error('Google Custom Search: 検索エンジンID が設定されていません');
  }

  const params = new URLSearchParams({
    key: apiKey,
    cx: engineId,
    q: query,
    num: '5',
    lr: locale === 'en' ? 'lang_en' : 'lang_ja',
  });

  const response = await fetch(`${CUSTOM_SEARCH_API_URL}?${params}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Google Custom Search APIエラー: ${response.status} - ${err.error?.message || ''}`);
  }

  const data = await response.json();
  return (data.items || []).map(item => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet,
  }));
}

/**
 * SerpAPI で検索する
 * @param {string} query
 * @param {string} apiKey
 * @returns {Promise<SearchResult[]>}
 */
async function searchWithSerpApi(query, apiKey, locale = 'ja') {
  const params = new URLSearchParams({
    api_key: apiKey,
    q: query,
    hl: locale === 'en' ? 'en' : 'ja',
    num: '5',
  });

  const response = await fetch(`${SERP_API_URL}?${params}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`SerpAPIエラー: ${response.status} - ${err.error || ''}`);
  }

  const data = await response.json();
  return (data.organic_results || []).map(item => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet,
  }));
}

/**
 * YouTube Data API v3 で動画を検索する（API直接呼び出し）
 *
 * @param {string} query
 * @param {string} apiKey
 * @returns {Promise<SearchResult[]>}
 */
async function searchYouTubeViaApi(query, apiKey, locale = 'ja') {
  const params = new URLSearchParams({
    key: apiKey,
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: '5',
    relevanceLanguage: locale === 'en' ? 'en' : 'ja',
    order: 'relevance',
  });

  const response = await fetch(`${YOUTUBE_API_URL}?${params}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`YouTube APIエラー: ${response.status} - ${err.error?.message || ''}`);
  }

  const data = await response.json();
  return (data.items || []).map(item => ({
    title: item.snippet.title,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    snippet: item.snippet.description,
    thumbnail: item.snippet.thumbnails?.default?.url,
  }));
}

/**
 * YouTubeの検索結果ページをfetchして動画を取得する（スクレイピングフォールバック）
 *
 * @param {string} query
 * @returns {Promise<SearchResult[]>}
 */
async function searchYouTubeViaScraping(query, locale = 'ja') {
  const hl = locale === 'en' ? 'en' : 'ja';
  const acceptLang = locale === 'en' ? 'en,ja;q=0.9' : 'ja,en;q=0.9';
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=${hl}`;
  const response = await fetch(url, {
    credentials: 'omit',
    headers: {
      'Accept-Language': acceptLang,
    },
  });

  if (!response.ok) {
    throw new Error(`YouTubeスクレイピングエラー: ${response.status}`);
  }

  const html = await response.text();
  const data = parseYtInitialData(html);
  if (!data) {
    throw new Error('ytInitialData のパースに失敗しました');
  }

  try {
    const contents = data?.contents
      ?.twoColumnSearchResultsRenderer
      ?.primaryContents
      ?.sectionListRenderer
      ?.contents;

    if (!Array.isArray(contents)) return [];

    const videos = [];
    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents;
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        const vr = item?.videoRenderer;
        if (!vr?.videoId) continue;

        const title = vr.title?.runs?.[0]?.text;
        if (!title) continue;

        videos.push({
          title,
          url: `https://www.youtube.com/watch?v=${vr.videoId}`,
          snippet: vr.descriptionSnippet?.runs?.[0]?.text || '',
          thumbnail: vr.thumbnail?.thumbnails?.[0]?.url,
        });
      }
    }
    return videos;
  } catch {
    return [];
  }
}

/**
 * HTML文字列から ytInitialData の JSON オブジェクトをパースする
 *
 * @param {string} html
 * @returns {object|null}
 */
function parseYtInitialData(html) {
  const marker = 'ytInitialData = ';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const startIdx = idx + marker.length;
  const jsonStr = extractJsonObject(html, startIdx);
  if (!jsonStr) return null;

  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * バランスカウント法でJSON オブジェクト文字列を抽出する
 *
 * @param {string} str
 * @param {number} startIdx - '{' の位置
 * @returns {string|null}
 */
function extractJsonObject(str, startIdx) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return str.slice(startIdx, i + 1);
      }
    }
  }

  return null;
}

/**
 * YouTube動画を検索する
 *
 * APIキーがある場合はYouTube Data API v3を使用し、
 * ない場合はスクレイピングにフォールバックする。
 *
 * 検索クエリ:
 *   - "{タイトル} 要約"
 *   - "{タイトル} 解説"
 *
 * @param {string} bookTitle
 * @param {string|null} apiKey
 * @returns {Promise<{ results: SearchResult[], errors: string[] }>}
 */
async function searchYouTubeVideos(bookTitle, apiKey, locale = 'ja') {
  const queries = locale === 'en'
    ? [`${bookTitle} review`, `${bookTitle} book summary`]
    : [`${bookTitle} 要約`, `${bookTitle} 解説`];

  const allResults = [];
  const errors = [];

  for (const query of queries) {
    try {
      let results;
      if (apiKey) {
        results = await searchYouTubeViaApi(query, apiKey, locale);
      } else {
        results = await searchYouTubeViaScraping(query, locale);
      }
      allResults.push(...results);
    } catch (err) {
      console.warn(`[Preread SW] YouTube検索エラー (${query}):`, err.message);
      if (errors.length === 0) errors.push(err.message);
    }
  }

  return {
    results: deduplicateByUrl(allResults).slice(0, MAX_VIDEO_RESULTS),
    errors,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure API (完全バックグラウンド) 処理
// ═══════════════════════════════════════════════════════════════════════════

async function pureApiGetAuth() {
  const res = await fetch('https://notebooklm.google.com/');
  if (!res.ok) throw new Error('NotebookLMにアクセスできませんでした');
  const html = await res.text();
  const snlmMatch = html.match(/"SNlM0e":"([^"]+)"/);
  const fdrMatch = html.match(/"FdrFJe":"([^"]+)"/);
  if (!snlmMatch) throw new Error('認証トークンが見つかりません。NotebookLMにログインしていますか？');
  return {
    actionToken: snlmMatch[1],
    fSid: fdrMatch ? fdrMatch[1] : ''
  };
}

async function pureApiCreateNotebook(auth) {
  const reqArray = ["", null, null, [2], [1, null, null, null, null, null, null, null, null, null, [1]]];
  const freqStr = JSON.stringify([[["CCqFvf", JSON.stringify(reqArray), null, "generic"]]]);
  const bodyParams = new URLSearchParams({ 'f.req': freqStr, 'at': auth.actionToken });

  const endpoint = `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute?rpcids=CCqFvf&f.sid=${encodeURIComponent(auth.fSid)}&rt=c`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
    body: bodyParams.toString()
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const match = text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
  if (!match) throw new Error('ノートブックIDの解析に失敗しました');
  return match[1];
}

async function pureApiRenameNotebook(notebookId, title, auth) {
  const reqArray = [notebookId, [[null, null, null, [null, title]]]];
  const freqStr = JSON.stringify([[["s0tc2d", JSON.stringify(reqArray), null, "generic"]]]);
  const bodyParams = new URLSearchParams({ 'f.req': freqStr, 'at': auth.actionToken });
  const endpoint = `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute?rpcids=s0tc2d&f.sid=${encodeURIComponent(auth.fSid)}&rt=c`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
    body: bodyParams.toString()
  });
  if (!res.ok) throw new Error(`Rename failed HTTP ${res.status}`);
}

async function pureApiAddSources(notebookId, urls, auth) {
  const sourceEntries = urls.map(url => {
    const isYouTube = url.includes('youtube.com/') || url.includes('youtu.be/');
    const entry = [null, null, null, null, null, null, null, null, null, null, 1];
    if (isYouTube) entry[7] = [url];
    else entry[2] = [url];
    return entry;
  });

  const reqArray = [sourceEntries, notebookId, [2], [1, null, null, null, null, null, null, null, null, null, [1]]];
  const freqStr = JSON.stringify([[["izAoDd", JSON.stringify(reqArray), null, "generic"]]]);
  const bodyParams = new URLSearchParams({ 'f.req': freqStr, 'at': auth.actionToken });
  const endpoint = `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute?rpcids=izAoDd&f.sid=${encodeURIComponent(auth.fSid)}&rt=c`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
    body: bodyParams.toString()
  });
  if (!res.ok) throw new Error(`Add Source HTTP ${res.status}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// NotebookLMへの追加処理 (Main Entry Point)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * URLリストをNotebookLMに追加する
 *
 * 戦略:
 *   1. 完全バックグラウンド (Pure API): HTTP fetch のみを使用（最優先）
 *   2. バックグラウンドタブを作成して Tier 1（API）
 *   3. どうしてもダメならDOM操作のTier 2へフォールバック
 *
 * @param {{ urls: string[], title?: string }} payload
 * @param {chrome.runtime.MessageSender} sender - popup のsender情報
 * @returns {Promise<{ added: number, failed: number }>}
 */
async function handleAddToNotebookLM({ urls, title }, sender) {
  console.log(`[Preread SW] NotebookLMへの追加開始: ${urls.length} 件`);

  // ── 1. Pure API による完全バックグラウンドの実行 ──
  try {
    const auth = await pureApiGetAuth();
    console.log(`[Preread SW] 完全にタブを開かない Pure API を使用します`);
    forwardStatusToPopup('ノートブックを準備中...');

    // APIでノートブックを新規作成
    const notebookId = await pureApiCreateNotebook(auth);

    // APIでタイトルを変更（書籍名など）
    if (title && title.trim() !== '' && title !== '—') {
      forwardStatusToPopup('タイトルを設定中...');
      await pureApiRenameNotebook(notebookId, title, auth).catch(e => console.warn('タイトル変更エラー:', e));
    }

    // APIでソースを一括追加
    forwardStatusToPopup('ソースを一括追加中...');
    await pureApiAddSources(notebookId, urls, auth);

    // 全て成功としてポップアップに進捗を送信（60ms 間隔でバーが段階的に埋まるようにする）
    for (let i = 0; i < urls.length; i++) {
      await new Promise(r => setTimeout(r, 60));
      forwardProgressToPopup({ current: i + 1, total: urls.length, url: urls[i], success: true });
    }

    // 完了時のリンクURLをポップアップに送る
    const notebookUrl = `${NOTEBOOKLM_URL}notebook/${notebookId}`;
    chrome.runtime.sendMessage({ type: 'NOTEBOOK_READY', payload: { notebookUrl } }).catch(() => { });

    console.log(`[Preread SW] Pure API によって全ての処理が完了しました`);
    return { added: urls.length, failed: 0 };

  } catch (err) {
    console.warn(`[Preread SW] Pure API 処理失敗、フォールバックに入ります:`, err.message);
  }

  // ── 2. フォールバック実行（タブ操作を伴う従来のルート） ──
  console.log(`[Preread SW] NotebookLMへの追加開始: ${urls.length} 件`);

  // NotebookLMのタブを取得（なければバックグラウンドで新規作成）
  const nlmTab = await getOrCreateNotebookLMTab();

  // NotebookLMがロードされるまで待つ
  await waitForTabLoad(nlmTab.id);
  await sleep(3000); // 1.5s -> 3s: content script と UI の完全な初期化待ち

  // ── ノートブックページにいなければ自動作成 ──────────────────────────
  // ユーザー操作を不要にするため、ホームページにいる場合は
  // 「ノートブックを新規作成」を自動クリックして新しいノートブックを作る
  {
    const currentTab = await chrome.tabs.get(nlmTab.id);
    const urlObj = new URL(currentTab.url);
    const isOnNotebook = urlObj.pathname.startsWith('/notebook/');

    if (!isOnNotebook) {
      console.log('[Preread SW] ノートブックが未選択。自動作成します...');
      forwardStatusToPopup('NotebookLMのノートブックを準備中...');

      // tabs.sendMessage は content script がまだリスナーを登録していない場合に
      // "Could not establish connection" エラーになる。
      // scripting.executeScript はその問題を回避できる。
      await injectNotebookLMScript(nlmTab.id);
      await chrome.scripting.executeScript({
        target: { tabId: nlmTab.id },
        world: 'ISOLATED',
        func: async () => {
          if (window.__preread_createNewNotebook) {
            await window.__preread_createNewNotebook();
          } else {
            throw new Error('初期化スクリプトが読み込まれていません');
          }
        },
      });

      // 新しいノートブックページに遷移するまで待機（タイムアウトを延長）
      await waitForNotebookPage(nlmTab.id, 60_000);
      await sleep(5000); // 新ノートブックのUIが落ち着くまでしっかり待つ

      console.log('[Preread SW] 新しいノートブックが作成されました');

      // ── 新規作成されたノートブックの初期設定（モーダルを閉じ、タイトルを変更する） ──
      try {
        await chrome.scripting.executeScript({
          target: { tabId: nlmTab.id },
          world: 'MAIN', // Angularのディスパッチ等、環境のフルアクセスが必要な場合があるため
          func: (bookTitle) => {
            // 1. 自動で開く「ソースを追加」モーダルを閉じる
            document.querySelector('.close-button')?.click();

            // 2. タイトルを変更する
            if (bookTitle) {
              const input = document.querySelector('.title-input');
              if (input) {
                const pageWindow = input.ownerDocument.defaultView || window;

                // ネイティブSetter経由で確実に値を変更
                const nativeSetter = Object.getOwnPropertyDescriptor(
                  pageWindow.HTMLInputElement.prototype, 'value'
                )?.set;
                if (nativeSetter) {
                  nativeSetter.call(input, bookTitle);
                } else {
                  input.value = bookTitle;
                }

                input.dispatchEvent(new pageWindow.Event('input', { bubbles: true, composed: true }));
                input.dispatchEvent(new pageWindow.Event('change', { bubbles: true, composed: true }));

                // Enterキーを発火して保存とblurを促す
                input.dispatchEvent(new pageWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                input.blur();

                console.debug('[Preread SW] ノートブックのタイトルを変更しました:', bookTitle);
              }
            }
          },
          args: [title],
        });
        await sleep(1000); // 変更が保存されるまで少し待機
      } catch (err) {
        console.warn('[Preread SW] ノート初期設定エラー:', err);
      }
    }
  }

  // ⚠️ activateNotebookLMTab() は呼ばない
  // タブはバックグラウンドに保ちポップアップを閉じさせない。
  // DOM操作（Tier 2）はバックグラウンドタブでも機能する。

  // Tier 1: 内部API直接呼び出しを試みる
  // MAIN world にスクリプトを注入する
  await injectInterceptorToMainWorld(nlmTab.id);

  // Tier 1 が有効かどうか確認（ノートブックを開いているか）
  const tier1Available = await checkTier1Available(nlmTab.id);

  let result = null;
  if (tier1Available) {
    console.log('[Preread SW] Tier 1（内部API直接コール）を使用します');
    result = await addUrlsViaTier1(nlmTab.id, urls, sender);

    // API呼び出しに失敗した場合はTier 2へフォールバック
    if (result.added === 0 && result.failed > 0) {
      console.warn('[Preread SW] Tier 1 APIコール失敗。Tier 2（DOM操作）にフォールバックします。');
      result = await addUrlsViaTier2(nlmTab.id, urls);
    }
  } else {
    console.log('[Preread SW] Tier 1 利用不可。Tier 2（DOM操作）を使用します');
    result = await addUrlsViaTier2(nlmTab.id, urls);
  }

  // 追加完了後のノートブックURL（タブURLから取得）
  const finalTab = await chrome.tabs.get(nlmTab.id).catch(() => null);
  const notebookUrl = finalTab?.url ?? null;

  // 完了をブラウザ通知とポップアップ両方で知らせる
  const total = urls.length;
  const failed = result.failed ?? (total - (result.added ?? total));
  const added = result.added ?? (total - failed);
  notifyCompletion(added, failed);

  // ポップアップにノートブックURLを転送（ポップアップが開いていれば受信できる）
  if (notebookUrl) {
    forwardNotebookUrlToPopup(notebookUrl);
  }

  return { ...result, notebookUrl };
}

/**
 * ブラウザ通知で追加完了を知らせる
 * @param {number} added
 * @param {number} failed
 */
function notifyCompletion(added, failed) {
  const message = failed > 0
    ? `${added}件を追加しました（${failed}件失敗）`
    : `${added}件のソースを追加しました`;

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'Preread — NotebookLM追加完了',
    message,
    priority: 1,
  });
}

/**
 * NotebookLMのタブを取得する。存在しない場合は新規作成する。
 * @returns {Promise<chrome.tabs.Tab>}
 */
async function getOrCreateNotebookLMTab() {
  // 既存のNotebookLMタブを探す
  const [existingTab] = await chrome.tabs.query({ url: `${NOTEBOOKLM_URL}*` });

  if (existingTab) {
    return existingTab; // まだアクティブにしない（ポップアップを閉じさせない）
  }

  // バックグラウンドで開く（active: false）ことでポップアップを閉じさせない
  // ユーザーがメッセージを読んだあとに切り替える
  const newTab = await chrome.tabs.create({ url: NOTEBOOKLM_URL, active: false });
  return newTab;
}

/**
 * NotebookLMタブをアクティブにする（ユーザーへの案内メッセージ表示後に呼ぶ）
 * @param {chrome.tabs.Tab} tab
 */
async function activateNotebookLMTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

/**
 * ユーザーがNotebookLMのノートブックページに遷移するまで待機する
 *
 * ユーザーが一覧ページからノートブックを選択するとURLが
 * /notebook/XXXX に変わるため、それをポーリングで検出する。
 *
 * @param {number} tabId
 * @param {number} [timeout=120000] 最大待機時間（デフォルト2分）
 * @returns {Promise<void>}
 */
async function waitForNotebookPage(tabId, timeout = 120_000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && new URL(tab.url).pathname.startsWith('/notebook/')) {
        // ノートブックページに遷移済み・ページロード完了を待つ
        await waitForTabLoad(tabId);
        return;
      }
    } catch {
      throw new Error('NotebookLMタブが閉じられました');
    }
    await sleep(800);
  }

  throw new Error('ノートブックが選択されませんでした（2分タイムアウト）');
}

/**
 * タブのページロードが完了するまで待機する
 * @param {number} tabId
 * @param {number} [timeout=15000]
 */
async function waitForTabLoad(tabId, timeout = 15000) {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          resolve();
          return;
        }
        if (Date.now() - startTime > timeout) {
          reject(new Error('タブのロードタイムアウト'));
          return;
        }
        setTimeout(check, 500);
      } catch {
        reject(new Error('タブが見つかりません'));
      }
    };
    setTimeout(check, 500);
  });
}

/**
 * Tier 1: MAIN world にフェッチインターセプタースクリプトを注入する
 *
 * ⚠️ MAIN world への注入のため、content_scripts の "world" 設定ではなく
 *    scripting.executeScript を使用する。
 *
 * @param {number} tabId
 */
async function injectInterceptorToMainWorld(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['content_scripts/notebooklm-interceptor.js'],
      world: 'MAIN',
    });
    console.debug('[Preread SW] インターセプタースクリプトを MAIN world に注入しました');
  } catch (err) {
    console.warn('[Preread SW] インターセプタースクリプト注入失敗:', err.message);
  }
}

/**
 * Tier 1 が利用可能かどうか確認する
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function checkTier1Available(tabId) {
  // 新しいAPI直接コール方式では事前のフック不要。TabがノートブックURLであればTier1を実行可能とする
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return false;
    const urlObj = new URL(tab.url);
    return urlObj.pathname.startsWith('/notebook/');
  } catch {
    return false;
  }
}

/**
 * Tier 1: 内部API直接呼び出しを使った一括追加 (完全なバックグラウンド動作)
 * @param {number} tabId
 * @param {string[]} urls
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<{ added: number, failed: number }>}
 */
async function addUrlsViaTier1(tabId, urls, sender) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN', // window.WIZ_global_data にアクセスするため MAIN が必要
      func: async (targetUrls) => {
        if (window.__preread_addUrlsDirectlyViaApiBatch) {
          return await window.__preread_addUrlsDirectlyViaApiBatch(targetUrls);
        }
        return { success: false, error: 'APIインターセプタがロードされていません' };
      },
      args: [urls],
    });

    const success = result?.result?.success === true;

    if (success) {
      console.log(`[Preread SW] Tier 1 API 一括追加成功: ${urls.length}件`);
      urls.forEach((url, i) => {
        forwardProgressToPopup({ current: i + 1, total: urls.length, url, success: true });
      });
      return { added: urls.length, failed: 0 };
    } else {
      console.warn(`[Preread SW] Tier 1 API 一括追加失敗:`, result?.result?.error);
      return { added: 0, failed: urls.length };
    }
  } catch (err) {
    console.error(`[Preread SW] Tier 1 実行エラー:`, err.message);
    return { added: 0, failed: urls.length };
  }
}

/**
 * Tier 2: DOM操作でURLを1件ずつ追加する
 *
 * tabs.sendMessage ではなく scripting.executeScript を使うことで、
 * バックグラウンドタブでの "Could not establish connection" エラーを回避する。
 *
 * 手順:
 *   1. notebooklm.js を注入（二重注入ガードにより既注入の場合はスキップされる）
 *   2. URLごとに window.__preread_addSingleUrl を executeScript で呼び出す
 *   3. 各URL追加後に進捗をpopupに転送する
 *
 * @param {number} tabId
 * @param {string[]} urls
 * @returns {Promise<{ added: number, failed: number }>}
 */
async function addUrlsViaTier2(tabId, urls) {
  // notebooklm.js を注入してグローバル関数を公開させる
  await injectNotebookLMScript(tabId);

  try {
    console.log(`[Preread SW] Tier 2 一括追加を開始します: ${urls.length} 件`);
    forwardStatusToPopup('NotebookLMにソースを一括入力中...');

    // scripting.executeScript で一括追加関数を呼び出す
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async (targetUrls) => {
        if (window.__preread_addAllUrlsBatch) {
          await window.__preread_addAllUrlsBatch(targetUrls);
        } else {
          throw new Error('一括追加スクリプトが読み込まれていません');
        }
      },
      args: [urls],
    });

    // 各URLのステータスを一括で「成功」として通知（実際の個別成否は後続のポーリング等が必要だが、
    // バッチ入力完了時点を持って現在のUIフィードバックとする）
    urls.forEach((url, i) => {
      forwardProgressToPopup({
        current: i + 1,
        total: urls.length,
        url,
        success: true,
      });
    });

    return { added: urls.length, failed: 0 };

  } catch (err) {
    const errMsg = err.message || String(err);
    console.error(`[Preread SW] Tier 2 一括追加失敗:`, errMsg);
    forwardStatusToPopup(`⚠️ 追加失敗: ${errMsg}`);

    // 全件失敗として通知
    urls.forEach((url, i) => {
      forwardProgressToPopup({ current: i + 1, total: urls.length, url, success: false });
    });

    return { added: 0, failed: urls.length };
  }
}

/**
 * notebooklm.js をタブに注入する
 *
 * window.__preread_injected フラグにより、既に注入済みの場合は
 * notebooklm.js 内のガードが二重初期化を防ぐ。
 *
 * @param {number} tabId
 */
async function injectNotebookLMScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content_scripts/notebooklm.js'],
    world: 'ISOLATED',
  });
  console.debug('[Preread SW] notebooklm.js を注入しました（または既注入）');
}

// ═══════════════════════════════════════════════════════════════════════════
// 進捗通知
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 進捗情報をpopupに転送する
 *
 * ⚠️ MV3のservice workerでは chrome.extension.getViews が使えないため、
 *    直接 chrome.runtime.sendMessage で送信する。
 *    popupが閉じている場合は "Could not establish connection" エラーになるが無視する。
 *
 * @param {{ current: number, total: number, url: string, success: boolean }} payload
 */
function forwardProgressToPopup(payload) {
  chrome.runtime.sendMessage({
    type: 'PROGRESS_UPDATE',
    payload,
  }).catch(() => {
    // popupが閉じている場合は無視
  });
}

/**
 * ステータスメッセージをpopupに転送する（エラー詳細の表示などに使用）
 * @param {string} message
 */
function forwardStatusToPopup(message) {
  chrome.runtime.sendMessage({
    type: 'STATUS_UPDATE',
    payload: { message },
  }).catch(() => { });
}

/**
 * 完成したノートブックのURLをpopupに転送する
 * @param {string} notebookUrl
 */
function forwardNotebookUrlToPopup(notebookUrl) {
  chrome.runtime.sendMessage({
    type: 'NOTEBOOK_READY',
    payload: { notebookUrl },
  }).catch(() => {
    // popupが閉じている場合は無視
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ヘルパー関数
// ═══════════════════════════════════════════════════════════════════════════

/**
 * URLの重複を除去し、ブロックドメインをフィルタリングする
 * @param {{ url: string, title: string }[]} results
 * @returns {{ url: string, title: string }[]}
 */
function deduplicateAndFilter(results) {
  const seen = new Set();
  return results.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    try {
      const domain = new URL(item.url).hostname.replace(/^www\./, '');
      return !BLOCKED_DOMAINS.some(blocked => domain.includes(blocked));
    } catch {
      return false; // 無効なURLは除外
    }
  });
}

/**
 * URLの重複のみ除去する（ドメインフィルタなし）
 * @param {{ url: string }[]} results
 * @returns {{ url: string }[]}
 */
function deduplicateByUrl(results) {
  const seen = new Set();
  return results.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

/**
 * 指定ミリ秒待機する
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @typedef {{ title: string, url: string, snippet?: string, thumbnail?: string }} SearchResult
 */

console.debug('[Preread] service_worker.js が起動しました');
