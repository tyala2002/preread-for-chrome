# 記事検索ゼロ設定化 設計案（活性化摩擦の除去）

作成日: 2026-06-01
目的: **記事検索を APIキー入力なしで動く既定状態にする** ことで、
install → activation の脱落（現在 58 install / 11 active ≒ 19%）を改善する。

> ## 🟢 採用方針（2026-06-01 決定）
> **C案: DuckDuckGo HTML版を各ユーザーのブラウザ内で叩く（→ §9）** を採用。
> 理由: Tavily ToS の再配布禁止条項（§7）により Worker中継案（A案）は断念。
>
> - **§1〜6 は破棄した A案（Tavily中継）の記録**。実装しない。歴史的参照のみ残す。
> - **§7 = ToS確認の結論 / §9 = 採用するC案の実装仕様**。
>
> ### ✅ 実機スパイク結果（2026-06-01 実Chromeで検証）
> `html.duckduckgo.com/html/?q=...&kl=jp-jp|us-en` を実ブラウザで3クエリ実行:
> - 「7つの習慣 要約 レビュー まとめ」→ サラリーマン投資ブログ・読書メーター(bookmeter)等の書評/要約が上位ヒット
> - 「サピエンス全史 要約 レビュー まとめ」→ BOOKSTAND・studyhacker 等の要約/書評がヒット
> - 「Atomic Habits review summary」→ grahammann.net・aidenreed.net 等の英語サマリーがヒット
>
> **結論: 3件とも bot 判定なし・200・品質良好（日英とも狙い通りの書評/要約サイト）。**
> → DuckDuckGo HTML版は記事検索ソースとして実用に耐える。**C案 採用確定**。
>
> ### ⚠️ 1点だけ残る技術論点（実装時に確定）
> 上記スパイクは**実ブラウザ＝Cookieあり文脈**での成功。
> service worker 直fetch（Cookieなし）でも通るかは未確認。
> 安全策は **content_script 文脈での fetch**。SW直で 202/bot判定が出たら content_script へ切替。
> → `scripts/ddg-spike.mjs` をローカルNode（Cookieなし相当）で実行すれば SW直の可否を確認可能。

---

## 1. アーキテクチャ

```
拡張機能 (service_worker.js)
   │  POST /search { query, lang, max_results, clientId }
   ▼
Cloudflare Worker  "preread-relay"
   │  ① Origin/拡張ID 検証
   │  ② レート制限（clientId 単位 + グローバル日次キャップ）
   │  ③ あなたの Tavily APIキー（Worker secret）で呼び出し
   ▼
Tavily API (api.tavily.com)
```

---

## 2. 検索ソース解決の優先順位（service_worker.js を改修）

```
1. ユーザーが自前 Tavily キー(braveApiKey)を設定済み
        → 直接 Tavily を叩く（上級者・無制限・現状維持）
2. 未設定（＝大多数の新規ユーザー）
        → Worker 中継を叩く（ゼロ設定の既定。レート制限つき）
3. 中継がクォータ超過 / エラー
        → YouTube のみで継続（既にキー不要なので体験が途切れない）
```

既存の「自前キー」動作を壊さず、**既定をゼロ設定にする**のがポイント。

---

## 3. 不正利用・コスト防御（= あなたの財布を守る最重要部）

Tavily 無料枠 = **1,000 検索/月**。Pro最適化で 1 ユーザー検索 = 1 クエリなので、
枠は素直に「月1000回まで無料」。これを超えると課金が始まるため二重で蓋をする。

| 防御層 | 内容 | 実装 |
|---|---|---|
| clientId 単位 | 例: 無料 10 検索/日/人 | install 時に UUID を `chrome.storage.local` 生成 → KV カウンタ |
| グローバル日次キャップ | 例: 30 検索/日（≒900/月、無料枠内） | Worker の KV/Durable Object でグローバルカウント |
| サーキットブレーカ | 超過時はソフトエラー返却 → YouTubeのみへ縮退 | 「本日の無料検索枠が上限に達しました」 |
| Origin 検証 | `Origin: chrome-extension://<拡張ID>` を照合 | Worker 側ヘッダチェック（完全ではないが+レート制限で十分） |

> 設計思想: **最悪ケースでも「無料枠が尽きて YouTube のみに縮退」止まり**で、
> 想定外の請求が来ない状態を最初から作る。キャップは保守的に始めて運用で上げる。

---

## 4. 改修の具体ポイント

### 拡張機能側
- `service_worker.js`
  - 新定数 `RELAY_ENDPOINT = 'https://preread-relay.<subdomain>.workers.dev'`
  - `searchViaRelay(query, lang)` 関数を追加
  - プロバイダ選択ロジックを「キー無し → 中継」に変更
- `chrome.runtime.onInstalled` で `clientId`(UUID) を `chrome.storage.local` に生成・永続化
- `options/options.*`: Tavily キー欄を **「上級者向け（任意）」** に降格。
  「無料で今すぐ使えます。自前キーは無制限化したい人向け」と明記
- オンボーディング文言から「キーが必要」を削除

### Worker 側（新規ディレクトリ or 別リポ）
- `wrangler.toml` / `src/index.js`
- Secret: `TAVILY_API_KEY`
- KV namespace（レートカウンタ）— `clientId:YYYYMMDD` と `global:YYYYMMDD`
- エンドポイント: `POST /search`
  - 入力: `{ query, lang, max_results, clientId }`
  - 出力: Tavily レスポンスを整形して返す（拡張側の既存パース流用）

---

## 5. クォータ初期値（保守的スタート）

| 項目 | 初期値 | 根拠 |
|---|---|---|
| 無料/人/日 | 10 検索 | 通常利用で困らない |
| グローバル/日 | 30 検索 | ≒900/月 で Tavily 無料枠(1000)内 |
| 超過時 | YouTubeのみ縮退 | 体験を途切れさせない |

→ 上限に当たり始めたら「良い問題」。Tavily 有料化 or Pro 誘導の判断材料になる。

---

## 6. ロールアウト手順

1. Worker 作成・デプロイ・`curl` + 拡張IDオリジンで疎通確認
2. 拡張 v0.2.0 を中継既定でリリース
3. **activation 率（active/install）の変化を計測**（成功指標）

---

## 7. Tavily ToS 確認（着手ステップ①）

> 2026-06-01 確認済み（出典: tavily.com/terms, /acceptable-use-policy,
> docs.tavily.com/documentation/api-credits, help.tavily.com）

### 結論サマリ
- **コスト面はクリア**: 無料枠 1,000クレジット/月・クレカ不要。
  現状コードは `search_depth: 'basic'`（=1クレジット/検索）なので
  保守的クォータ（グローバル30検索/日 ≒ 900/月）は無料枠内 ✅。
  超過しても従量課金 **$0.008/クレジット**（例: +1000検索でも $8）と安価。
- **法務面に赤信号**: ToS が
  「license, sublicense, **resell**, distribute, lease, rent, lend, transfer,
  assign or otherwise dispose of the Services」を明示禁止。
  匿名エンドユーザーへの 1キー・プール中継は **この再配布禁止条項に抵触し得る**。
- AUP: 「第三者に Services を使わせる場合、AUP と同等以上に厳格な
  利用規約を課すこと」→ 中継するなら**拡張機能側に利用規約を用意して
  ユーザーを拘束する義務**が生じる。
- レート制限: Development=100req/分、Production=1000req/分。
  本番中継は Production 扱い → **有料プラン($30/月〜)が必要な可能性**。

### 判断（3つの道）
| 案 | 内容 | リスク/コスト |
|---|---|---|
| A 中継を強行 | Worker中継 + 拡張に利用規約追加 | 再配布条項の解釈リスクが残る |
| B 事前許諾 | support@tavily.com に用途を説明し書面許諾を得る | 最も安全・時間がかかる |
| C 脱Tavily | 記事検索を**キー不要プロバイダ**に置換しゼロ設定化 | 規約リスク回避・品質要検証 |

→ 推奨は **B（許諾取得）を先に試し、並行してC（キー不要代替）を技術検証**。
　Aは規約解釈リスクを個人開発で背負うことになり非推奨。

---

## 7b. その他の要確認リスク

- Origin 偽装はブラウザ外から可能 → レート制限＋グローバルキャップで実害を限定
- Cloudflare Worker 無料枠 = 10万req/日で余裕

---

## 8. 未決定（運用で決める）

- 自前キー方式を将来も残すか（残す方針＝上級者向けオプション）
- clientId をどこまで匿名に保つか（UUIDのみ・個人情報なし）
- Pro 移行時のライセンス検証方法（Polar webhook → KV にライセンス記録）

---

## 9. DuckDuckGo 実装仕様（C案）

作成日: 2026-06-01
背景: Tavily ToS の再配布禁止条項（§7 参照）により Worker 中継案（A案）を断念。
C案として、各ユーザーのブラウザ内で直接 DuckDuckGo HTML版を叩く方式を採用する。
規約リスク回避・APIキー不要・無料・拡張機能として自然なリクエスト形態。

---

### 9-1. プロバイダ選択ロジックの変更（`handleSearchSources` / `searchWebArticles`）

#### 現在の分岐（`service_worker.js` L119〜L127）

```js
// service_worker.js L119
const hasWebSearchKey = !!braveApiKey; // Tavily のみ対応

// service_worker.js L125〜L127
const articlePromise = hasWebSearchKey
  ? searchWebArticles(bookTitle, { braveApiKey, ... })
  : Promise.resolve({ results: [], errors: [] }); // ← キー無しで記事検索が完全スキップ
```

#### 変更後の分岐（擬似コード）

```js
// L119: 変更後
const hasWebSearchKey = !!braveApiKey; // 自前 Tavilyキー（上級者向け）

// L125〜L127: 変更後
// キー未設定でも DuckDuckGo を使うため、常に searchWebArticles を実行する
const articlePromise = searchWebArticles(
  bookTitle,
  { braveApiKey, searchApiKey, searchEngineId, searchProvider, locale }
);
```

`searchWebArticles` 内のプロバイダ選択ロジック（L176〜L182）を以下のように変更する：

```js
// searchWebArticles の for ループ内（L174〜L182 を置換）
let results;
if (braveApiKey) {
  // 自前 Tavily キーあり → 直接 Tavily（上級者・現状維持）
  results = await searchWithTavily(query, braveApiKey);
} else if (searchProvider === 'serpapi' && searchApiKey) {
  // SerpAPI キーあり
  results = await searchWithSerpApi(query, searchApiKey, locale);
} else if (searchProvider === 'google' && searchApiKey && searchEngineId) {
  // Google Custom Search キーあり
  results = await searchWithGoogleCustomSearch(query, searchApiKey, searchEngineId, locale);
} else {
  // キー未設定（大多数の新規ユーザー）→ DuckDuckGo HTML版（既定）
  results = await searchWithDuckDuckGo(query, locale);
}
```

既存の「自前キーがある場合の動作」はすべて維持される。

---

### 9-2. `searchWithDuckDuckGo(query, locale)` 実装方針

#### エンドポイント

```
GET https://html.duckduckgo.com/html/?q={encodeURIComponent(query)}&kl={region}
```

`kl` パラメータ:
- `locale === 'ja'` → `kl=jp-jp`
- `locale === 'en'` → `kl=us-en`（または省略で English 結果）

#### リクエスト実装

```js
const DUCKDUCKGO_HTML_URL = 'https://html.duckduckgo.com/html/';

async function searchWithDuckDuckGo(query, locale = 'ja') {
  const kl = locale === 'en' ? 'us-en' : 'jp-jp';
  const url = `${DUCKDUCKGO_HTML_URL}?q=${encodeURIComponent(query)}&kl=${kl}`;

  const response = await fetch(url, {
    credentials: 'omit', // YouTube スクレイパー（searchYouTubeViaScraping L340）と同じ方針
    headers: {
      'Accept-Language': locale === 'en' ? 'en,ja;q=0.9' : 'ja,en;q=0.9',
      // User-Agent を省略すると CF Worker のデフォルトになる。
      // bot 判定回避のため必要に応じて追加するが、まず省略で試す。
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo HTML 検索エラー: ${response.status}`);
  }

  const html = await response.text();
  return parseDuckDuckGoHtml(html);
}
```

#### HTML パース方針

service worker は `DOMParser` を持たないため、
YouTube スクレイパーの `parseYtInitialData` / `extractJsonObject`（L398〜L456）と同じく
**正規表現 + 文字列操作でパース**する。

DuckDuckGo HTML版の結果 DOM 構造（2026年時点）:

```html
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=<エンコード実URL>&rut=...">タイトルテキスト</a>
  </h2>
  <a class="result__snippet">スニペットテキスト</a>
</div>
```

```js
function parseDuckDuckGoHtml(html) {
  const results = [];

  // result__a のhrefとテキストを正規表現で抽出
  const titleRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  // スニペットの抽出
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const titles = [];
  let m;
  while ((m = titleRegex.exec(html)) !== null) {
    const rawHref = m[1];
    const rawTitle = m[2].replace(/<[^>]+>/g, '').trim(); // タグ除去
    const url = decodeDuckDuckGoRedirect(rawHref);
    if (url && rawTitle) {
      titles.push({ title: rawTitle, url });
    }
  }

  const snippets = [];
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
  }

  for (let i = 0; i < titles.length; i++) {
    results.push({
      title: titles[i].title,
      url:   titles[i].url,
      snippet: snippets[i] ?? '',
    });
  }

  return results;
}
```

#### `uddg` 復号処理

DuckDuckGo HTML版の href は直接 URL を持たず、
`//duckduckgo.com/l/?uddg=<encodeURIComponent(実URL)>&rut=...` という中間リダイレクト形式。
`uddg` パラメータを `decodeURIComponent` するだけで実 URL が取れる。

```js
function decodeDuckDuckGoRedirect(href) {
  // href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F..."
  try {
    // 先頭の // を https: に補完してから URL パース
    const fullUrl = href.startsWith('//') ? 'https:' + href : href;
    const uddg = new URL(fullUrl).searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : null;
  } catch {
    return null;
  }
}
```

#### 返り値の形式

既存 `searchWithTavily`（L228〜L232）と完全に同一:

```js
// { title: string, url: string, snippet: string }[]
```

`searchWebArticles` L192 の `deduplicateAndFilter(allResults, locale)` にそのまま流せる。

---

### 9-3. `manifest.json` の変更（差分）

`host_permissions` に DuckDuckGo HTML版のオリジンを追加する。

```diff
   "host_permissions": [
     "https://www.amazon.co.jp/*",
     "https://www.amazon.com/*",
     "https://notebooklm.google.com/*",
     "https://www.googleapis.com/*",
     "https://serpapi.com/*",
     "https://api.tavily.com/*",
-    "https://www.youtube.com/*"
+    "https://www.youtube.com/*",
+    "https://html.duckduckgo.com/*"
   ],
```

変更は1行追加のみ。既存パーミッションへの影響なし。

---

### 9-4. エラー時フォールバック

DDG が失敗・0件の場合は、既存の `errors` 配列の扱い（`searchWebArticles` L184〜L188）に
そのまま乗る。

```js
// searchWebArticles L184〜L188（変更なし）
} catch (err) {
  console.warn(`[Preread SW] Web記事検索エラー (${query}):`, err.message);
  if (errors.length === 0) errors.push(err.message);
}
```

結果として `allResults` が空になり、`deduplicateAndFilter` → `slice(0, MAX_ARTICLE_RESULTS)` で
記事は 0 件となる。`handleSearchSources`（L141〜L148）は
`articles: []` のまま `videos` を返すため、YouTube のみの体験に縮退する。
これは「キー未設定時は YouTube のみ」という現状より悪化せず、むしろ DDG が成功すれば上位互換。

---

### 9-5. 想定リスクと緩和策

| リスク | 内容 | 緩和策 |
|---|---|---|
| HTML構造変更 | DDGがクラス名を変更すると `parseDuckDuckGoHtml` が 0件を返す | `amazon.js`の SELECTORS定数と同様にコード内に変更リスクコメントを明記。0件は無音でフォールバックするため機能停止にはならない |
| bot 判定・202 返却 | DDGが自動化アクセスと判断し検索結果でなくCAPTCHAページ等を返す | `response.ok` チェック後、`html.includes('result__a')` で内容を簡易検証し、なければ `throw` して `errors` に追記。ユーザー画面には「記事検索が一時的に利用できません」等を表示 |
| 品質が Tavily 未満 | DDG の関連度・鮮度は Tavily より劣る可能性 | `BLOCKED_DOMAINS` フィルタ + `deduplicateAndFilter` の locale フィルタが既に機能。追加で「要約 レビュー まとめ」クエリに絞ることで無関係ページを減らす。品質が問題になれば自前 Tavily キー設定を促す UI 文言を options に追加する |
| Rate limiting | 短時間に多数のリクエストで IP 制限される | service_worker は 1クエリ/検索 実行（現在は `queries` 配列 1件のみ、L164〜L168）なので通常利用では問題ない。将来クエリ数を増やす際は `sleep()` を挟む（`sleep` 関数は L1116 に既存） |
| `credentials: 'omit'` での cookie 欠如 | DDG がユーザー設定 cookie を期待する場合に影響 | HTML版（`html.duckduckgo.com`）は cookie 不要で動作する設計。`credentials: 'omit'` は YouTube スクレイパー（L340）と同じ方針で問題ない |

---

### 9-6. 定数・関数の追加一覧（変更サマリ）

| ファイル | 変更 | 内容 |
|---|---|---|
| `manifest.json` | `host_permissions` に1行追加 | `https://html.duckduckgo.com/*` |
| `service_worker.js` | 定数追加 | `const DUCKDUCKGO_HTML_URL = 'https://html.duckduckgo.com/html/';` |
| `service_worker.js` | 関数追加 | `async function searchWithDuckDuckGo(query, locale)` |
| `service_worker.js` | 関数追加（内部） | `function parseDuckDuckGoHtml(html)` |
| `service_worker.js` | 関数追加（内部） | `function decodeDuckDuckGoRedirect(href)` |
| `service_worker.js` | `searchWebArticles` L176〜L182 変更 | キー未設定時に DDG を呼ぶ分岐を追加 |
| `service_worker.js` | `handleSearchSources` L125〜L127 変更 | `articlePromise` を常に実行するよう変更 |

既存の `searchWithTavily`、`searchWithGoogleCustomSearch`、`searchWithSerpApi`、
`deduplicateAndFilter`、`BLOCKED_DOMAINS` は**無変更**。

---

## 9-6. 実機検証で判明したUA問題と対策（2026-06-01）

### 検証結果

| User-Agent | HTTPステータス | 結果件数 |
|---|---|---|
| `Mozilla/5.0`（簡略UA） | 200 | 10件（正常） |
| Chrome フルUA（SW標準） | 202 | 0件（JSチャレンジ） |
| UAなし / 空 / `Preread/1.0` | 200 | 結果あり（環境依存） |

### 原因

DuckDuckGo HTML版は「Chrome フルUAを名乗るがJSを実行しないクライアント」を bot と判定し、
HTTP 202 + JSチャレンジページを返す。Chrome 拡張の service worker が送る fetch リクエストは
ブラウザが自動的に Chrome フルUA（例: `Mozilla/5.0 (Macintosh; ...) Chrome/131.0.0.0 ...`）を
付与するため、そのままでは 202 になり検索結果が 0 件となる。

### 対策

`fetch()` の `headers` オプションでは `User-Agent` は禁止ヘッダのため変更不可。
`declarativeNetRequest` API を使い、`html.duckduckgo.com` 宛リクエストの UA を
`"Mozilla/5.0"` に書き換えることで 200 正常レスポンスを得られることを実測確認。

あわせて `credentials: 'include'` → `'omit'` に変更（Cookie不要・簡略UA+Cookieなしで200確認済み）。

### 関連ファイル

| ファイル | 変更内容 |
|---|---|
| `extension/rules/ddg_ua.json` | 新規作成。DNR ルール（UA → `Mozilla/5.0` に書換） |
| `extension/manifest.json` | `permissions` に `declarativeNetRequest` 追加、`declarative_net_request.rule_resources` を追加 |
| `extension/background/service_worker.js` | `searchWithDuckDuckGo` 内の `credentials: 'omit'` 変更・コメント修正 |
