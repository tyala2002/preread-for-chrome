/**
 * content_scripts/notebooklm.js
 * Tier 2: DOM操作によるNotebookLMへのソース追加（フォールバック戦略）
 *
 * ⚠️ このファイルは manifest.json の content_scripts と
 *    scripting.executeScript の両方から注入される可能性がある。
 *    IIFEと window.__preread_injected フラグで二重注入を防ぐ。
 */

(function () {
  'use strict';

  // ── 重複注入ガード（IIFEの最初に確認） ──────────────────────────────────
  // const を IIFE スコープ内に置くことで、二回目の注入時も SyntaxError が発生しない。
  // 二回目の注入は return で即座に抜ける。
  if (window.__preread_injected) {
    console.debug('[Preread] notebooklm.js は既に注入済みのためスキップしました');
    return;
  }
  window.__preread_injected = true;

  // ═══════════════════════════════════════════════════════════════════════
  // セレクタ定義
  //
  // ⚠️ NotebookLMのDOM構造は予告なく変更される可能性がある。
  //   変更時は DevTools で要素を確認してここを更新すること。
  // ═══════════════════════════════════════════════════════════════════════
  const SELECTORS = {

    // ── URL入力 textarea ──────────────────────────────────────────────
    // ユーザー確認済み (2025-02):
    //   <textarea aria-label="URL を入力" placeholder="リンクを貼り付ける"
    //             formcontrolname="urls" rows="7">
    // ⚠️ placeholder="ウェブで新しいソースを検索" の textarea は「検索ボックス」なので対象外
    urlTextarea: [
      'textarea[aria-label="URL を入力"]',
      'textarea[placeholder="リンクを貼り付ける"]',
      'textarea[formcontrolname="urls"]',
      'textarea[aria-label*="URL"][aria-label*="入力"]',
      'textarea[placeholder*="リンク"]',
    ],

    // ── URLパネルを開くボタン ──────────────────────────────────────────
    // ソースパネル内にある「リンク」「URL」「ウェブサイト」等のチップ・ボタン。
    // これをクリックすると URL textarea が表示される。
    openUrlPanelButton: [
      '[aria-label="リンク"]',
      '[aria-label="Link"]',
      '[aria-label="ウェブサイト"]',
      '[aria-label="Website"]',
      '[aria-label="ウェブのURL"]',
      '[aria-label="Web URL"]',
      'button.drop-zone-icon-button', // クラス指定を追加
      'button:has-text("ウェブ")',      // 部分一致的な指定
    ],

    // ── ソースを追加するトップレベルボタン ───────────────────────────
    // ノートブックページのサイドバーにある「ソース追加」ボタン。
    // ソースパネルが閉じている場合はここをクリックして開く。
    addSourceButton: [
      '[aria-label="ソース アップロードのダイアログを開く"]',
      '[aria-label="ソースをアップロード"]',
      '[aria-label="Add source"]',
      '[aria-label="Add sources"]',
      '[aria-label="ソースを追加"]',
      '[aria-label="ソースの追加"]',
      'button.add-source-button',       // クラス指定を追加
    ],

    // ── URL確定ボタン（「挿入」） ────────────────────────────────────
    // URL textareaの下にある「挿入」ボタン。
    confirmButton: [
      'button[type="submit"]',
      'button[aria-label="挿入"]',
      'button[aria-label="Insert"]',
      'button[aria-label="追加"]',
      'button[aria-label="Add"]',
    ],

    // ── 完了通知 ─────────────────────────────────────────────────────
    successToast: [
      'mat-snack-bar-container',
      'snack-bar-container',
    ],
  };

  // ═══════════════════════════════════════════════════════════════════════
  // タイムアウト設定（ミリ秒）
  // ═══════════════════════════════════════════════════════════════════════
  const TIMEOUT = {
    urlTextarea: 10_000,  // URL textarea が表示されるまでの最大待機
    inputReady: 5_000,  // 入力後のバリデーション完了待機
    afterInsert: 30_000,  // 「挿入」後の完了確認最大待機
  };

  // ═══════════════════════════════════════════════════════════════════════
  // メイン処理: 全URLをバッチでNotebookLMに追加する
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * URLリストをNotebookLMにバッチ追加する（一度のUI操作で全て追加）
   *
   * NotebookLMのURL入力 textarea は複数URLを改行区切りで受け付けるため、
   * 1回の操作で全URLを追加できる。
   *
   * フロー:
   *   1. URL textarea が見えていればそのまま使用
   *   2. なければ「リンク」ボタンをクリックして表示
   *   3. なければ「ソースを追加」→「リンク」の順にクリック
   *   4. 全URLを改行区切りで textarea に入力
   *   5. 「挿入」ボタンをクリック
   *   6. 完了を確認
   *
   * @param {string[]} urls
   * @returns {Promise<void>}
   */
  async function addAllUrlsBatch(urls) {
    console.log(`[Preread] バッチURL追加開始: ${urls.length}件`);

    // ── ステップ1: URL textarea を探す ────────────────────────────────
    let urlTextarea = findUrlTextarea();

    if (!urlTextarea) {
      console.log('[Preread] URL textarea が見えない。ボタンをクリックして表示します');

      // ── ステップ2: 「リンク/URL」ボタンをクリック ─────────────────
      const opened = await tryClickOpenUrlPanelButton();

      if (!opened) {
        // ── ステップ3: まず「ソースを追加」ボタンをクリック ──────────
        console.log('[Preread] URLパネルボタンが見つからない。「ソースを追加」ボタンを試みます');
        await tryClickAddSourceButton();
        await sleep(1000);

        // その後「リンク/URL」ボタンをクリック
        await tryClickOpenUrlPanelButton();
      }

      // URL textarea が表示されるまで待機
      urlTextarea = await waitForUrlTextarea(TIMEOUT.urlTextarea);
    }

    console.log('[Preread] URL textarea 発見:', urlTextarea.getAttribute('aria-label'), '/', urlTextarea.placeholder);

    // ── ステップ4: 全URLを改行区切りで textarea に入力 ────────────────
    const urlText = urls.join('\n');
    setTextareaValueNative(urlTextarea, urlText);
    await sleep(1000); // Angular バリデーション完了待ち

    const enteredValue = urlTextarea.value;
    console.log(`[Preread] textarea 入力後の値 (先頭100字): ${enteredValue.slice(0, 100)}`);
    if (!enteredValue.trim()) {
      throw new Error('URL の入力に失敗しました（textarea の値が空です）');
    }

    // ── ステップ5: 「挿入」ボタンをクリック ───────────────────────────
    console.log('[Preread] 「挿入」ボタンを検索');
    const insertBtn = await findInsertButton(TIMEOUT.inputReady);
    console.log('[Preread] 「挿入」ボタン発見:', insertBtn.textContent?.trim(), '/ disabled=', insertBtn.disabled);

    await waitUntilEnabled(insertBtn, TIMEOUT.inputReady);
    console.log('[Preread] 「挿入」ボタンをクリック（確実な実行のために複数戦略を使用）');

    // UIの反応を促すため、少し待ってから実行
    await sleep(500);
    insertBtn.scrollIntoView({ block: 'center' });
    insertBtn.click();

    // 反応がない場合へのバックアップ処理
    await sleep(500);
    if (insertBtn.isConnected && isVisible(insertBtn)) {
      console.debug('[Preread] ボタンがまだ存在するため、イベントを直接発行します');
      const pageWindow = insertBtn.ownerDocument.defaultView;
      insertBtn.dispatchEvent(new pageWindow.MouseEvent('mousedown', { bubbles: true }));
      insertBtn.dispatchEvent(new pageWindow.MouseEvent('mouseup', { bubbles: true }));
      insertBtn.click();
    }

    // ── ステップ6: 完了確認 ───────────────────────────────────────────
    console.log('[Preread] 完了待機中...');
    await waitForAddCompletion(urlTextarea, TIMEOUT.afterInsert);
    console.log('[Preread] バッチURL追加完了 ✅');
  }

  /**
   * 1件のURLをNotebookLMに追加する（バッチ関数へのラッパー）
   * @param {string} url
   */
  async function addSingleUrl(url) {
    await addAllUrlsBatch([url]);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UI操作ヘルパー
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * URL textarea を同期的に検索する（タイムアウトなし）
   * @returns {HTMLTextAreaElement|null}
   */
  function findUrlTextarea() {
    for (const selector of SELECTORS.urlTextarea) {
      try {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          console.debug('[Preread] findUrlTextarea: 発見', selector);
          return el;
        }
      } catch { /* 無効なセレクタはスキップ */ }
    }

    // フォールバック: 可視のtextareaのうちURLっぽいプレースホルダーを持つもの
    for (const ta of document.querySelectorAll('textarea')) {
      if (!isVisible(ta)) continue;
      const ph = ta.placeholder || '';
      const al = ta.getAttribute('aria-label') || '';
      // 検索ボックス ("ウェブで新しいソースを検索") は除外する
      if (ph.includes('検索') || ph.includes('search')) continue;
      if (ph.includes('リンク') || ph.includes('URL') || al.includes('URL') || al.includes('リンク')) {
        console.debug('[Preread] findUrlTextarea: フォールバック発見 placeholder=', ph, 'aria-label=', al);
        return ta;
      }
    }

    return null;
  }

  /**
   * URL textarea が表示されるまで待機する
   * @param {number} timeout
   * @returns {Promise<HTMLTextAreaElement>}
   */
  async function waitForUrlTextarea(timeout) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const ta = findUrlTextarea();
      if (ta) return ta;
      await sleep(200);
    }

    // デバッグ情報を出力
    const allTextareas = [...document.querySelectorAll('textarea')]
      .map(ta => `placeholder="${ta.placeholder}" aria-label="${ta.getAttribute('aria-label') ?? ''}" visible=${isVisible(ta)}`);
    console.error('[Preread] URL textarea が見つかりません。全 textarea:', allTextareas);

    throw new Error('URL入力 textarea が見つかりませんでした');
  }

  /**
   * URLパネルを開くボタン（「リンク」等）をクリックする
   * @returns {Promise<boolean>} クリックできた場合 true
   */
  async function tryClickOpenUrlPanelButton() {
    // aria-label で検索
    for (const selector of SELECTORS.openUrlPanelButton) {
      try {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          console.debug('[Preread] URLパネルボタン発見 (aria):', selector);
          el.click();
          await sleep(600);
          return true;
        }
      } catch { /* 無効なセレクタはスキップ */ }
    }

    // テキストコンテンツで検索
    const linkTexts = ['リンク', 'Link', 'ウェブサイト', 'Website', 'URL', 'ウェブのURL', 'ウェブ', 'Web'];
    const candidates = document.querySelectorAll(
      'button, [role="button"], mat-chip, [role="option"], [role="tab"], [role="listitem"] button, .mat-mdc-chip'
    );
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const text = el.textContent?.trim() ?? '';
      const label = el.getAttribute('aria-label') ?? '';
      // 完全一致から部分一致 (includes) に変更し、アイコンテキスト混在に対応
      if (linkTexts.some(t => text.includes(t) || label.includes(t))) {
        console.debug('[Preread] URLパネルボタン発見 (text/label):', text || label);
        el.click();
        await sleep(600);
        return true;
      }
    }

    console.debug('[Preread] URLパネルボタンが見つかりませんでした');
    return false;
  }

  /**
   * 「ソースを追加」ボタンをクリックする（ソースパネルが閉じている場合）
   */
  async function tryClickAddSourceButton() {
    for (const selector of SELECTORS.addSourceButton) {
      try {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          console.debug('[Preread] 「ソースを追加」ボタン発見 (aria):', selector);
          el.click();
          await sleep(800);
          return;
        }
      } catch { /* 無効なセレクタはスキップ */ }
    }

    // テキストで検索
    const addSourceTexts = [
      'ソース アップロードのダイアログを開く', 'ソースをアップロード',
      'ソースを追加', 'ソースの追加', 'Add source', 'Add sources',
    ];
    const btn = findButtonByTexts(addSourceTexts);
    if (btn) {
      console.debug('[Preread] 「ソースを追加」ボタン発見 (text):', btn.textContent?.trim());
      btn.click();
      await sleep(800);
      return;
    }

    console.warn('[Preread] 「ソースを追加」ボタンが見つかりませんでした');
  }

  /**
   * 「挿入」ボタンを検索する
   * URL textarea 付近のボタンのみを対象にする
   * @param {number} timeout
   * @returns {Promise<HTMLButtonElement>}
   */
  async function findInsertButton(timeout) {
    const startTime = Date.now();
    const insertTexts = ['挿入', 'Insert', '追加', 'Add', 'Confirm', 'Submit'];

    while (Date.now() - startTime < timeout) {
      // CSSセレクタで検索
      for (const selector of SELECTORS.confirmButton) {
        try {
          const el = document.querySelector(selector);
          if (el && isVisible(el)) return el;
        } catch { /* スキップ */ }
      }

      // テキストで検索
      for (const btn of document.querySelectorAll('button, [role="button"]')) {
        if (!isVisible(btn)) continue;
        const text = btn.textContent?.trim() ?? '';
        const label = btn.getAttribute('aria-label') ?? '';
        if (insertTexts.some(t => text.includes(t) || label.includes(t))) {
          // 「ソースを追加」ボタン等の別のボタンをクリックしないよう、
          // URL textareaが表示されている時のみ有効なボタンを狙う
          return btn;
        }
      }

      await sleep(200);
    }

    // デバッグ情報
    const allBtns = [...document.querySelectorAll('button, [role="button"]')]
      .filter(isVisible)
      .map(b => b.textContent?.trim().slice(0, 30) || b.getAttribute('aria-label'));
    console.error('[Preread] 「挿入」ボタンが見つかりません。可視ボタン:', allBtns);

    throw new Error('「挿入」ボタンが見つかりませんでした');
  }

  /**
   * URL追加の完了を待機する
   * - URL textarea が非表示になる
   * - または成功トーストが表示される
   * @param {HTMLTextAreaElement} urlTextarea - 入力に使ったtextarea
   * @param {number} timeout
   */
  async function waitForAddCompletion(urlTextarea, timeout) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // textarea が非表示・消滅したら完了
      if (!urlTextarea || !isVisible(urlTextarea)) {
        console.debug('[Preread] URL textarea が非表示になりました → 完了');
        return;
      }

      // 成功トーストが表示されたら完了
      for (const sel of SELECTORS.successToast) {
        const toast = document.querySelector(sel);
        if (toast && isVisible(toast)) {
          console.debug('[Preread] 成功トースト検出 →', sel);
          return;
        }
      }

      await sleep(200);
    }

    // タイムアウト → 成功しているかもしれないが確認できない
    console.warn('[Preread] 追加完了の確認がタイムアウトしました（追加は成功している可能性あり）');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ノートブック作成
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * ホームページで「ノートブックを新規作成」ボタンをクリックする
   */
  async function createNewNotebook() {
    const btn = await findElementByTextsWithTimeout(
      [], // CSSセレクタは使わない
      ['ノートブックを新規作成', 'New notebook', 'Create notebook', '新規作成'],
      8000,
      '「ノートブックを新規作成」ボタン',
    );
    btn.click();
    console.debug('[Preread] 「ノートブックを新規作成」をクリックしました');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DOM操作ユーティリティ
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Angular/Reactフレームワーク対応の textarea 値セット
   *
   * ⚠️ isolated world の window.HTMLTextAreaElement.prototype は
   *    ページの prototype と別オブジェクト。
   *    input.ownerDocument.defaultView でページの window を取得し、
   *    zone.js が検知できるネイティブ setter と Event コンストラクタを使う。
   *
   * @param {HTMLTextAreaElement} textarea
   * @param {string} value
   */
  function setTextareaValueNative(textarea, value) {
    const pageWindow = textarea.ownerDocument.defaultView;
    const doc = textarea.ownerDocument;

    // ── 方法0: execCommand (paste) ──
    try {
      textarea.focus();
      if (doc.execCommand('insertText', false, value)) {
        console.debug('[Preread] setTextareaValueNative: insertText 成功');
      }
    } catch (e) {
      console.debug('[Preread] setTextareaValueNative: insertText 失敗', e.message);
    }

    // 値がセットされていなければ直接代入
    if (textarea.value !== value) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        pageWindow.HTMLTextAreaElement.prototype, 'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(textarea, value);
      } else {
        textarea.value = value;
      }
    }

    // ── Angular等のフォームを騙すための強力なイベントチェーン ──
    // 1. フォーカス
    textarea.dispatchEvent(new pageWindow.Event('focus', { bubbles: true, cancelable: true }));

    // 2. キーダウン/プレス
    textarea.dispatchEvent(new pageWindow.KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, metaKey: true, bubbles: true }));
    textarea.dispatchEvent(new pageWindow.KeyboardEvent('keypress', { key: 'v', code: 'KeyV', ctrlKey: true, metaKey: true, bubbles: true }));

    // 3. 入力変更イベント（ここでAngularのformGroupが反応するはず）
    textarea.dispatchEvent(new pageWindow.Event('input', { bubbles: true, cancelable: true, composed: true }));
    textarea.dispatchEvent(new pageWindow.Event('change', { bubbles: true, cancelable: true, composed: true }));

    // 4. キーアップ
    textarea.dispatchEvent(new pageWindow.KeyboardEvent('keyup', { key: 'v', code: 'KeyV', ctrlKey: true, metaKey: true, bubbles: true }));

    // 5. フォーカス外れ
    textarea.dispatchEvent(new pageWindow.Event('blur', { bubbles: true, cancelable: true }));

    console.debug('[Preread] setTextareaValueNative: 強力なイベントエミュレーション完了');
  }

  /**
   * CSSセレクタまたはテキストコンテンツで要素を検索する（タイムアウト付き）
   * @param {string[]} cssSelectors
   * @param {string[]} texts
   * @param {number} timeout
   * @param {string} label
   * @returns {Promise<HTMLElement>}
   */
  async function findElementByTextsWithTimeout(cssSelectors, texts, timeout, label) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      for (const selector of cssSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && isVisible(el)) return el;
        } catch { /* 無効なセレクタはスキップ */ }
      }

      const el = findButtonByTexts(texts);
      if (el) return el;

      await sleep(200);
    }

    throw new Error(`${label}が見つかりませんでした (URL: ${location.pathname})`);
  }

  /**
   * テキストコンテンツ・aria-label でボタン/要素を検索する（同期）
   * @param {string[]} texts
   * @returns {HTMLElement|null}
   */
  function findButtonByTexts(texts) {
    const candidates = document.querySelectorAll(
      'button, [role="button"], [role="tab"], [role="menuitem"], mat-chip, .mat-mdc-chip'
    );
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const text = el.textContent?.trim() ?? '';
      const label = el.getAttribute('aria-label') ?? '';
      if (texts.some(t => text.includes(t) || label.includes(t))) {
        return el;
      }
    }
    return null;
  }

  /**
   * ボタンが有効（disabled でない）になるまで待機する
   * @param {HTMLElement} button
   * @param {number} timeout
   */
  async function waitUntilEnabled(button, timeout) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (!button.disabled && !button.hasAttribute('disabled')) return;
      await sleep(100);
    }
    // タイムアウトしてもそのまま続行
    console.warn('[Preread] ボタンが有効になりませんでした（タイムアウト）。そのままクリックします');
  }

  /**
   * 要素が画面上で可視状態かを確認する
   *
   * ⚠️ position:fixed / position:sticky の要素は offsetParent が仕様上 null になるが可視。
   *    バックグラウンドタブではレイアウト未計算で null になることもある。
   *
   * @param {Element} el
   * @returns {boolean}
   */
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    return (
      el.offsetParent !== null ||
      style.position === 'fixed' ||
      style.position === 'sticky' ||
      // 背景タブ等で offsetParent が null になる場合への対応
      (el.getClientRects().length > 0)
    );
  }

  /**
   * 指定ミリ秒待機する
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // グローバル公開
  //
  // service_worker.js から scripting.executeScript 経由で呼び出せるよう公開する。
  // ═══════════════════════════════════════════════════════════════════════
  window.__preread_createNewNotebook = createNewNotebook;
  window.__preread_addAllUrlsBatch = addAllUrlsBatch;
  window.__preread_addSingleUrl = addSingleUrl; // 後方互換

  console.debug('[Preread] notebooklm.js (Tier 2 DOM操作) が注入されました');

})(); // IIFE 終わり
