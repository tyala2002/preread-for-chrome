/**
 * content_scripts/notebooklm-interceptor.js
 * Tier 1: フェッチインターセプト戦略
 *
 * NotebookLMが内部で使用するAPIリクエストをインターセプトし、
 * 同じエンドポイントに追加URLでリクエストを再送することでソースを追加する。
 *
 * ⚠️ 重要な注意事項:
 *   - NotebookLMはGoogleの内部APIを使用しており、その仕様は公開されていない
 *   - APIのエンドポイント・リクエスト形式は予告なく変更される可能性がある
 *   - この実装はリバースエンジニアリングに基づいており、動作保証はない
 *   - 変更が検知された場合はTier 2（DOM操作）にフォールバックする
 *
 * 動作原理:
 *   1. window.fetch をラップして全リクエストを監視する
 *   2. ソース追加に関連するAPIリクエストを検出する
 *   3. 検出したリクエストの形式をテンプレートとして保存する
 *   4. background service workerからの指示で同じ形式のリクエストを再送する
 *
 * 実行コンテキスト:
 *   このスクリプトは ISOLATED world で動作するため、
 *   ページのfetchをインターセプトするには MAIN world への注入が必要。
 *   service_worker.js から scripting.executeScript を使って MAIN world に注入する。
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// ソース追加APIのエンドポイントパターン
//
// ⚠️ API変更注意ポイント:
//   NotebookLMのAPIエンドポイントが変更された場合、
//   SOURCE_API_PATTERN を更新してください。
// ═══════════════════════════════════════════════════════════════════════════
const SOURCE_API_PATTERNS = [
  // グーグルのNotebookLM内部API（推測パターン）
  /notebooklm\.googleapis\.com.*source/i,
  /notebooklm\.google\.com\/api.*source/i,
  // 将来のパターンもここに追加可能
];

/**
 * インターセプトした最後のソース追加リクエスト情報
 * @type {{ url: string, init: RequestInit, notebookId: string } | null}
 */
let capturedSourceRequest = null;

/**
 * フェッチインターセプターをページのMAIN worldに注入する関数
 *
 * この関数は service_worker.js から scripting.executeScript で呼び出す。
 * MAIN world で実行されるため、window.fetch を直接ラップできる。
 */
function installFetchInterceptor() {
  // 既に注入済みの場合はスキップ
  if (window.__preread_interceptorInstalled) return;
  window.__preread_interceptorInstalled = true;

  const originalFetch = window.fetch;

  /**
   * fetchをラップしてAPIリクエストを監視する
   */
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url;

    // ソース追加APIかどうかを確認
    const isSourceApi = SOURCE_API_PATTERNS.some(pattern => pattern.test(url));

    if (isSourceApi) {
      console.debug('[Preread Interceptor] ソース追加APIリクエストを検出:', url);

      // リクエスト情報をキャプチャ
      try {
        const bodyText = init?.body ? await readBody(init.body) : null;
        window.__preread_capturedRequest = {
          url,
          method: init?.method || 'POST',
          headers: serializeHeaders(init?.headers),
          bodyTemplate: bodyText,
          capturedAt: Date.now(),
        };
        console.debug('[Preread Interceptor] リクエストをキャプチャしました');
      } catch (e) {
        console.warn('[Preread Interceptor] リクエストキャプチャ失敗:', e);
      }
    }

    // 元のfetchを呼び出す（リクエストはそのまま通す）
    return originalFetch.call(this, input, init);
  };

  console.debug('[Preread Interceptor] フェッチインターセプターを設置しました');
}

/**
 * キャプチャしたリクエストテンプレートを使って新しいURLでリクエストを送る
 *
 * @param {string} targetUrl - 追加するURL
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function addSourceViaInterceptedApi(targetUrl) {
  const captured = window.__preread_capturedRequest;

  if (!captured) {
    return {
      success: false,
      error: 'インターセプトされたAPIリクエストが見つかりません。手動でソースを追加してからお試しください。',
    };
  }

  // キャプチャから30分以上経過していたら無効とみなす
  const AGE_LIMIT_MS = 30 * 60 * 1000;
  if (Date.now() - captured.capturedAt > AGE_LIMIT_MS) {
    return {
      success: false,
      error: 'キャプチャされたAPIリクエストが古すぎます。ページをリロードしてください。',
    };
  }

  try {
    // ⚠️ APIのリクエストボディ形式は推測値であり、変更される可能性がある
    // 実際の形式は Network DevToolsで確認して更新が必要な場合がある
    const body = buildRequestBody(captured.bodyTemplate, targetUrl);

    const response = await fetch(captured.url, {
      method: captured.method,
      headers: {
        ...captured.headers,
        // CSRF対策ヘッダーは元のリクエストから引き継ぐ
      },
      body: JSON.stringify(body),
      credentials: 'include',
    });

    if (response.ok) {
      return { success: true };
    } else {
      const errorText = await response.text().catch(() => '');
      return {
        success: false,
        error: `APIエラー: ${response.status} ${response.statusText}. ${errorText}`,
      };
    }
  } catch (err) {
    return { success: false, error: `フェッチエラー: ${err.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ヘルパー関数
// ═══════════════════════════════════════════════════════════════════════════

/**
 * リクエストボディを読み取る
 * @param {BodyInit} body
 * @returns {Promise<string|null>}
 */
async function readBody(body) {
  if (typeof body === 'string') return body;
  if (body instanceof FormData) return null; // FormDataは複製が複雑なためスキップ
  if (body instanceof ReadableStream) {
    // ReadableStreamは一度読むと再読不可なため、キャプチャのみで実際のリクエストには影響しない
    return null;
  }
  return null;
}

/**
 * Headersオブジェクトをプレーンオブジェクトにシリアライズする
 * @param {HeadersInit} headers
 * @returns {Record<string, string>}
 */
function serializeHeaders(headers) {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const obj = {};
    headers.forEach((value, key) => { obj[key] = value; });
    return obj;
  }
  return { ...headers };
}

/**
 * キャプチャしたリクエストボディを元に、新しいURLを追加するボディを構築する
 *
 * ⚠️ API変更注意ポイント:
 *   このボディ形式はリバースエンジニアリングによる推測です。
 *   実際のAPIが変わった場合はこの関数を修正してください。
 *
 * @param {string|null} template - キャプチャしたボディ
 * @param {string} newUrl - 追加するURL
 * @returns {object}
 */
function buildRequestBody(template, newUrl) {
  if (!template) {
    // テンプレートなし: 最低限のボディを構築（推測）
    return {
      sources: [{ web_url: newUrl }],
    };
  }

  try {
    const parsed = JSON.parse(template);
    // ボディ内のURL部分を新しいURLに置き換える（推測ロジック）
    if (Array.isArray(parsed.sources)) {
      return { ...parsed, sources: [{ web_url: newUrl }] };
    }
    // 形式が不明な場合はそのまま返す
    return { ...parsed, url: newUrl };
  } catch {
    // JSONパース失敗: 最低限のボディ
    return { sources: [{ web_url: newUrl }] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 新Tier 1: 内部API直接呼び出し (batchexecute)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * NotebookLMの内部API (batchexecute) を直接使用し、ブラウザUIを介さずにソースを一括追加する。
 * 背景タブ等、UIが操作不能な状態でも100%の確率で動作する。
 *
 * @param {string[]} urls - 追加するURLの配列
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function addUrlsDirectlyViaApiBatch(urls) {
  try {
    // 認証・セッショントークンを取得（Google特有のページ内グローバル変数）
    const actionToken = window.WIZ_global_data?.SNlM0e;
    const fSid = window.WIZ_global_data?.FdrFJe || '';

    if (!actionToken) {
      return { success: false, error: "action_token が見つかりません（NotebookLMにログインしていないか、セッションが無効です）" };
    }

    // 現在開いているノートブックのIDをURLから抽出
    const match = window.location.pathname.match(/\/notebook\/([a-zA-Z0-9-]+)/);
    const notebookId = match ? match[1] : null;

    if (!notebookId || notebookId.length < 10) {
      return { success: false, error: "アクティブなノートブックがありません。NotebookLMの画面を開いてください。" };
    }

    // ── APIのペイロード（リクエスト本体）を構築 ──
    // ウェブソース追加用の特殊な多次元配列構造
    // 通常のURLは index 2、YouTubeのURLは index 7 に入れる必要がある
    const sourceEntries = urls.map(url => {
      const isYouTube = url.includes('youtube.com/') || url.includes('youtu.be/');
      const entry = [null, null, null, null, null, null, null, null, null, null, 1];
      if (isYouTube) {
        entry[7] = [url]; // YouTube
      } else {
        entry[2] = [url]; // 通常ウェブサイト
      }
      return entry;
    });

    const reqArray = [sourceEntries, notebookId, [2], [1, null, null, null, null, null, null, null, null, null, [1]]];

    const innerJSON = JSON.stringify(reqArray);
    const freqStr = JSON.stringify([[["izAoDd", innerJSON, null, "generic"]]]);

    const bodyParams = new URLSearchParams();
    bodyParams.append('f.req', freqStr);
    bodyParams.append('at', actionToken);

    // APIエンドポイント
    const endpoint = `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute?rpcids=izAoDd&f.sid=${encodeURIComponent(fSid)}&rt=c`;

    // fetchで直接リクエストを送信
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Same-Domain': '1'
      },
      body: bodyParams.toString()
    });

    if (response.ok) {
      console.log(`[Preread API] APIによる一括追加リクエスト成功: ${urls.length}件`);
      return { success: true };
    } else {
      console.error(`[Preread API] APIエラー: HTTP ${response.status}`);
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }
  } catch (err) {
    console.error(`[Preread API] フェッチエラー:`, err);
    return { success: false, error: err.message || String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// グローバルに公開（service_worker.js から executeScript 経由で呼び出す）
// ═══════════════════════════════════════════════════════════════════════════
window.__preread_installFetchInterceptor = installFetchInterceptor;
window.__preread_addSourceViaInterceptedApi = addSourceViaInterceptedApi;
window.__preread_addUrlsDirectlyViaApiBatch = addUrlsDirectlyViaApiBatch; // 新API関数を公開

// スクリプト注入時に自動でインターセプターを設置
installFetchInterceptor();

console.debug('[Preread] notebooklm-interceptor.js が注入されました');
