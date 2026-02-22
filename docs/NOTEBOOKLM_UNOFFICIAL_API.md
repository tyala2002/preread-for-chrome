# NotebookLM 非公式API (`batchexecute`) 調査レポート

## 概要
Googleの多くの最新ウェブサービス（NotebookLM、Google Gemini、Google Translateなど）は、フロントエンドとバックエンドの通信に従来のREST APIではなく、`batchexecute`と呼ばれる独自のRPC（Remote Procedure Call）システムを使用しています。
本プロジェクト（Preread for Chrome）において、DOM操作による自動化が不安定であったため、ブラウザの通信をリバースエンジニアリングして抽出したこの非公式API（Tier 1）を採用しました。

今後の拡張機能開発や、他のGoogleプロダクトのハッキング/自動化においても有用な知識となるため、その仕様と構造を記録します。

## `batchexecute` の基本構造

### 1. エンドポイントとリクエスト方式
* **URLプレフィックス**: `https://[service-domain]/_/LabsTailwindUi/data/batchexecute`
* **メソッド**: `POST`
* **Content-Type**: `application/x-www-form-urlencoded;charset=UTF-8`
* **必須ヘッダー**: `X-Same-Domain: 1` （CSRF対策として必須）

### 2. 認証とセッション管理
外部からこのAPIを叩くには、ブラウザが保持している「ユーザーのログインセッション（Cookie）」と「CSRF防御用のトークン」の両方が必要です。
拡張機能（Service WorkerやContent Script）からリクエストを送る場合、同じドメイン（`notebooklm.google.com`）上で実行すれば、Cookieは自動的に付与されます。

**Action Token (CSRFトークン)**
リクエストのボディに `at`（Action Token）というパラメータを含める必要があります。この値は、ページのDOM内、具体的には `window.WIZ_global_data` というグローバル変数の中に動的に格納されています。

```javascript
// ページ内からトークンを抽出する方法
const actionToken = window.WIZ_global_data?.SNlM0e;
const fSid = window.WIZ_global_data?.FdrFJe || '';
```

### 3. ペイロード構造 (`f.req`)
これが最も特異で複雑な部分です。データはただのJSONオブジェクト（`{ "key": "value" }`）ではなく、**「多重にネストされた配列の文字列化データ」**という形をとります。

パラメータ名: `f.req`

**最上位の構造:**
```json
[[[
  "RPC_ID",
  "INNER_PAYLOAD_STRING",
  null,
  "generic"
]]]
```
*   **`RPC_ID`**: 実行したい操作の種類を示す固有の文字列（例：`izAoDd`、`CCqFvf`など）。
*   **`INNER_PAYLOAD_STRING`**: 実際のデータを渡すための「配列をJSON文字列化したもの（Stringified JSON Array）」。

---

## NotebookLM 固有のRPCとペイロード仕様

調査の過程で判明した、NotebookLMを操作するための主要な3つのRPCについて解説します。

### A. ノートブックの新規作成 (`CCqFvf`)
空のノートブックを新しく作成し、その「プロジェクトID（UUID）」を取得するためのAPI。

*   **RPC ID**: `CCqFvf`
*   **Inner Payload**:
    ```json
    ["", null, null, [2], [1, null, null, null, null, null, null, null, null, null, [1]]]
    ```
*   **レスポンス**: 長大な配列テキストとして返ってきます。正規表現 `/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/` を使って、テキスト全体から新たに発行されたノートブックIDを抽出します。

### B. ノートブックのタイトル変更 (`s0tc2d`)
無題のノートブックのタイトルを任意のものに変更するためのAPI。

*   **RPC ID**: `s0tc2d`
*   **Inner Payload**:
    ```json
    [
      "TARGET_NOTEBOOK_ID",
      [
        [null, null, null, [null, "新しいタイトル"]]
      ]
    ]
    ```

### C. Web / YouTubeソースの追加 (`izAoDd`)
作成済みのノートブックに対して、URLソースを追加するAPI。
**注意点:** URLを渡す際の「配列のインデックス位置」によって、それが「単なるWebページ」なのか「YouTube動画」なのかをシステムが判別しています。

*   **RPC ID**: `izAoDd`
*   **Inner Payload**:
    ```json
    [
      [ <ソースデータ配列のリスト> ],
      "TARGET_NOTEBOOK_ID",
      [2],
      [1, null, null, null, null, null, null, null, null, null, [1]]
    ]
    ```

**ソースデータ配列のフォーマット:**
1件のソースにつき、11個の要素を持つ配列を作成し、適切なインデックスに `[URL]` を配置します。末尾は必ず `1` になります。

*   **通常のWebURLの場合 (Index 2)**:
    `[null, null, ["https://example.com"], null, null, null, null, null, null, null, 1]`
*   **YouTube動画の場合 (Index 7)**:
    `[null, null, null, null, null, null, null, ["https://youtube.com/..."], null, null, 1]`

これらの配列をリスト化したものが `<ソースデータ配列のリスト>` となります（一括追加が可能）。

---

## 実装時のベストプラクティスと注意点

1.  **純粋なBackground処理 (Pure API)**
    バックグラウンドのService Workerから直接 `fetch()` を使って処理を完結させるのが最も安定します。その際、事前に `fetch('https://notebooklm.google.com/')` を実行してHTMLを取得し、正規表現で `action_token` (`SNlM0e`) と `f.sid` (`FdrFJe`) をパース・抽出することで、画面（タブ）を開くことなく完全な裏側での自動化が実現できます。
2.  **型崩れ（フォーマット変更）のリスク**
    これは非公式APIであるため、Google側のアップデートによって「RPC IDが変わる」「配列のインデックス番号がずれる」といった仕様変更が予告なく発生するリスクがあります。拡張機能が突然動かなくなった場合は、再度ブラウザのNetworkタブを開いて、新しい `f.req` の構造を観察・比較する必要があります。
3.  **エラーハンドリング**
    APIがHTTP `400` や異常なステータスを返した場合は、トークンの有効期限切れ、またはペイロードの構造ミスの可能性が高いです。そのような場合に備え、旧来のDOM操作（UIを直接クリックするボット）へのフォールバック機構を残しておく設計が推奨されます。

*(※本レポートは2026年2月時点の調査に基づいています)*
