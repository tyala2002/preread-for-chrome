/**
 * i18n.js — Preread 国際化モジュール
 *
 * 使い方:
 *   import { initI18n, t } from '../i18n.js';
 *   await initI18n();          // DOMContentLoaded 前に必ず呼ぶ
 *   const label = t('btn_search');
 *   const msg   = t('msg_success_n', { n: 5 });
 */

'use strict';

const STRINGS = {
  ja: {
    // ── popup ────────────────────────────────────────────────────────
    book_title_label:          '書籍タイトル',
    book_title_edit_title:     'タイトルを編集',
    book_title_placeholder:    '書籍タイトルを入力してください',
    msg_not_amazon:            'Amazonの書籍ページで開いてください',
    btn_search:                'ソースを検索',
    recent_books_heading:      '追加済みの書籍',
    loading_searching:         '検索中...',
    loading_processing:        '処理中...',
    msg_no_api_key:            'Web記事検索のAPIキーが設定されていません。YouTubeはAPIキー不要で動作します。',
    btn_go_options:            '設定画面を開く',
    btn_select_all:            '全選択',
    btn_deselect_all:          '全解除',
    section_articles:          'Web記事',
    section_videos:            'YouTube動画',
    no_results:                '結果が見つかりませんでした',
    no_title:                  '（タイトルなし）',
    btn_copy_urls:             'URLをコピー',
    btn_add_to_notebooklm:     'NotebookLMに追加',
    btn_open_notebooklm:       'NotebookLMで開く',
    error_failed_urls_title:   '以下のURLの追加に失敗しました：',
    btn_retry_failed:          '失敗分を再試行',
    alert_no_urls_selected:    'URLが選択されていません',
    alert_no_urls_to_retry:    '再試行するURLがありません',
    btn_copied:                '✅ コピーしました',
    alert_clipboard_error:     'クリップボードへのコピーに失敗しました',
    status_creating_notebook:  'NotebookLMを開いて新しいノートブックを自動作成中...',
    alert_search_error:        '検索中にエラーが発生しました:',
    error_add_notebooklm_label:'❌ NotebookLM追加エラー:',
    warning_search_partial:    '⚠️ 一部の検索でエラーが発生しました:',
    warning_check_api_key:     'APIキーのクォータ上限に達しているか、設定画面でAPIキーを確認してください。',
    recent_book_open:          '開く',
    msg_success_n:             '{n} 件のソースを追加しました',
    progress_text:             '{current} / {total} 件追加中...',
    // ── options ──────────────────────────────────────────────────────
    options_page_title:        'Preread 設定',
    options_subtitle:          'APIキーと履歴を管理してください',
    tab_api_keys:              '設定',
    tab_history:               '追加済み書籍',
    card_search_api_title:     'Web記事検索 APIキー',
    card_search_api_desc:      '書籍の要約・レビュー記事を検索するためのAPIキーです。',
    tavily_free_note:          'Tavily Search API は無料で1,000クエリ/月使えます。クレジットカード不要。',
    label_tavily_key:          'Tavily APIキー',
    field_help_tavily:         '取得方法: app.tavily.com でアカウント作成 → APIキーをコピーして貼り付けてください。',
    card_language_title:       '表示言語',
    card_language_desc:        '拡張機能のUIに使用する言語を設定します',
    btn_save:                  '設定を保存',
    msg_saved_text:            '設定を保存しました',
    card_history_title:        '追加済みの書籍',
    card_history_desc:         'NotebookLMにソースを追加した書籍の履歴です。各ノートブックに直接アクセスできます。',
    btn_clear_all:             'すべて削除',
    history_empty:             'まだ書籍が追加されていません',
    btn_open_notebook:         'NotebookLMで開く',
    btn_delete_item_title:     '削除',
    confirm_clear_all:         '追加済み書籍の履歴をすべて削除しますか？',
    history_count:             '{n} 件',
    history_date_added:        '{date} に追加',
    alert_save_error:          '設定の保存に失敗しました:',
  },

  en: {
    // ── popup ────────────────────────────────────────────────────────
    book_title_label:          'Book Title',
    book_title_edit_title:     'Edit title',
    book_title_placeholder:    'Enter book title',
    msg_not_amazon:            'Please open an Amazon book page',
    btn_search:                'Search Sources',
    recent_books_heading:      'Added Books',
    loading_searching:         'Searching...',
    loading_processing:        'Processing...',
    msg_no_api_key:            'API key for web article search is not set. YouTube works without an API key.',
    btn_go_options:            'Open Settings',
    btn_select_all:            'Select All',
    btn_deselect_all:          'Deselect All',
    section_articles:          'Web Articles',
    section_videos:            'YouTube Videos',
    no_results:                'No results found',
    no_title:                  '(No title)',
    btn_copy_urls:             'Copy URLs',
    btn_add_to_notebooklm:     'Add to NotebookLM',
    btn_open_notebooklm:       'Open in NotebookLM',
    error_failed_urls_title:   'Failed to add the following URLs:',
    btn_retry_failed:          'Retry Failed',
    alert_no_urls_selected:    'No URLs selected',
    alert_no_urls_to_retry:    'No URLs to retry',
    btn_copied:                '✅ Copied',
    alert_clipboard_error:     'Failed to copy to clipboard',
    status_creating_notebook:  'Opening NotebookLM and creating a new notebook...',
    alert_search_error:        'An error occurred during search:',
    error_add_notebooklm_label:'❌ Failed to add to NotebookLM:',
    warning_search_partial:    '⚠️ Some searches encountered errors:',
    warning_check_api_key:     'You may have reached your API quota. Please check your API key in settings.',
    recent_book_open:          'Open',
    msg_success_n:             'Added {n} sources',
    progress_text:             'Adding {current} / {total}...',
    // ── options ──────────────────────────────────────────────────────
    options_page_title:        'Preread Settings',
    options_subtitle:          'Manage your API keys and history',
    tab_api_keys:              'Settings',
    tab_history:               'Added Books',
    card_search_api_title:     'Web Article Search API Key',
    card_search_api_desc:      'This API key is used to search for book summaries and reviews.',
    tavily_free_note:          'Tavily Search API is free for 1,000 queries/month. No credit card required.',
    label_tavily_key:          'Tavily API Key',
    field_help_tavily:         'How to get it: Create an account at app.tavily.com → Copy and paste your API key.',
    card_language_title:       'Display Language',
    card_language_desc:        'Set the language used for the extension UI',
    btn_save:                  'Save Settings',
    msg_saved_text:            'Settings saved',
    card_history_title:        'Added Books',
    card_history_desc:         'History of books whose sources were added to NotebookLM. You can access each notebook directly.',
    btn_clear_all:             'Delete All',
    history_empty:             'No books added yet',
    btn_open_notebook:         'Open in NotebookLM',
    btn_delete_item_title:     'Delete',
    confirm_clear_all:         'Delete all book history?',
    history_count:             '{n} items',
    history_date_added:        'Added on {date}',
    alert_save_error:          'Failed to save settings:',
  },
};

/** 現在の解決済み言語（'auto' ではなく 'ja' or 'en'） */
let _lang = 'ja';

/**
 * ストレージから言語設定を読み込み、内部状態を初期化する。
 * popup/options の DOMContentLoaded 前に必ず呼び出すこと。
 */
export async function initI18n() {
  const { language = 'auto' } = await chrome.storage.sync.get('language');
  if (language === 'auto') {
    _lang = navigator.language.startsWith('ja') ? 'ja' : 'en';
  } else {
    _lang = STRINGS[language] ? language : 'en';
  }
}

/**
 * 現在の言語で文字列を返す。
 * @param {string} key
 * @param {Object} [vars] - プレースホルダー置換 e.g. { n: 5 }
 * @returns {string}
 */
export function t(key, vars) {
  let str = STRINGS[_lang]?.[key] ?? STRINGS['en']?.[key] ?? key;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      str = str.replace(`{${k}}`, String(v));
    });
  }
  return str;
}

/**
 * 現在の解決済み言語コードを返す。
 * @returns {'ja'|'en'}
 */
export function getLang() {
  return _lang;
}
