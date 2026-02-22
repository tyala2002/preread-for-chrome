/**
 * content_scripts/amazon.js — Amazonページ書籍タイトル取得スクリプト
 *
 * このスクリプトは Amazon.co.jp / Amazon.com の商品ページに自動注入される。
 *
 * 責務:
 *   - DOMから書籍タイトルを取得する関数を window.__preread_getBookTitle として公開する
 *   - popup.js が executeScript 経由でこの関数を呼び出す
 *
 * ⚠️ 注意:
 *   Amazonのページ構造は予告なく変更される場合があります。
 *   タイトル取得のためのCSSセレクタが変わった場合は、SELECTORS定数を更新してください。
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// タイトル取得用セレクタ（変更時はここを更新する）
//
// ⚠️ DOMセレクタ変更注意ポイント:
//   Amazonのページ構成変更時、以下のセレクタが無効になる可能性があります。
//   変更を検知した場合は SELECTORS 配列に新しいセレクタを追加してください。
// ═══════════════════════════════════════════════════════════════════════════
const SELECTORS = [
  // --- Amazon.co.jp / Amazon.com 共通パターン ---

  // 商品ページのメインタイトル（Kindle・書籍共通）
  '#productTitle',

  // eBook（Kindle）ページのタイトル
  '#ebooksProductTitle',

  // 書籍詳細ページ（一部レイアウト）
  '.product-title-word-break',

  // Kindle Unlimitedなどのタイトル
  'span[id$="Title"]',

  // Open Graph タグ（フォールバック）
  // ← DOM操作ではなく <meta> タグから取得するため、セレクタではなく別ロジックで処理
];

/**
 * ページのDOMから書籍タイトルを取得する
 *
 * 複数のセレクタを順番に試し、最初に見つかったテキストを返す。
 * どれも見つからない場合は null を返す。
 *
 * @returns {string|null} 書籍タイトル文字列、または null
 */
function getBookTitle() {
  // 1. CSSセレクタを順に試す
  for (const selector of SELECTORS) {
    const el = document.querySelector(selector);
    if (el) {
      const text = el.textContent?.trim();
      if (text) {
        console.debug(`[Preread] タイトル取得成功 (セレクタ: ${selector}):`, text);
        return sanitizeTitle(text);
      }
    }
  }

  // 2. フォールバック: Open Graph <meta name="title"> タグ
  const ogTitle = document.querySelector('meta[name="title"]')?.getAttribute('content')
               || document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  if (ogTitle) {
    console.debug('[Preread] タイトル取得成功 (OG meta tag):', ogTitle);
    return sanitizeTitle(ogTitle);
  }

  // 3. フォールバック: <title> タグ（Amazon形式: "書籍タイトル | Amazon.co.jp..."）
  const pageTitle = document.title;
  if (pageTitle) {
    const extracted = extractTitleFromPageTitle(pageTitle);
    if (extracted) {
      console.debug('[Preread] タイトル取得成功 (<title> タグ):', extracted);
      return sanitizeTitle(extracted);
    }
  }

  console.warn('[Preread] 書籍タイトルを取得できませんでした');
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ヘルパー関数
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ページタイトル（<title>タグ）から書籍タイトル部分を抽出する
 *
 * Amazonのページタイトル形式:
 *   "書籍タイトル: Amazon.co.jp: 著者名"
 *   "Amazon.co.jp: 書籍タイトル"
 *   "書籍タイトル (Amazon著者名)"
 *
 * @param {string} pageTitle
 * @returns {string|null}
 */
function extractTitleFromPageTitle(pageTitle) {
  // パターン1: "TITLE: Amazon..."
  let match = pageTitle.match(/^(.+?)\s*[：:]\s*Amazon/);
  if (match) return match[1].trim();

  // パターン2: "Amazon.co.jp: TITLE"
  match = pageTitle.match(/Amazon[^\s]*:\s*(.+?)(?:\s*[：:]|$)/);
  if (match) return match[1].trim();

  return null;
}

/**
 * タイトル文字列のサニタイズ
 * - 余分な空白・改行を除去
 * - 先頭・末尾の記号（[ ] ( ) など）を除去
 * - 200文字に切り詰める
 *
 * @param {string} title
 * @returns {string}
 */
function sanitizeTitle(title) {
  return title
    .replace(/\s+/g, ' ')            // 連続空白を1つに
    .replace(/^\s*[\[\(（【「『]\s*/, '') // 先頭の開き括弧を除去
    .trim()
    .slice(0, 200);
}

// ═══════════════════════════════════════════════════════════════════════════
// グローバルに公開（popup.js から executeScript 経由で呼び出す）
// ═══════════════════════════════════════════════════════════════════════════
window.__preread_getBookTitle = getBookTitle;

// スクリプト注入完了ログ
console.debug('[Preread] amazon.js が注入されました。URL:', location.href);
