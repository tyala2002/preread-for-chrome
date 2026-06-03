# Reddit 初投稿までのフロー

---

## Step 1 — v0.1.3 審査提出（完了したらチェック）

- [ ] Chrome Developer Dashboard でパッケージをアップロード
- [ ] 変更内容の説明を入力（審査官向け）：
  ```
  - YouTube search now works without an API key
  - Improved onboarding for new users with setup guide in settings
  - Fixed incorrect error message when no API key is set
  ```
- [ ] 審査提出

---

## Step 2 — Reddit アカウント作成（審査待ちの間に）

- [ ] `reddit.com` でアカウント作成
- [ ] ユーザー名候補：`preread_dev` / `hamt_dev` / `preread_app`
- [ ] Display name：`Preread Dev`
- [ ] Bio：
  ```
  Solo developer building tools for NotebookLM and book lovers.
  Made Preread — a Chrome extension that auto-adds Amazon book
  sources to NotebookLM.
  ```
- [ ] アバター画像を設定

---

## Step 3 — ウォームアップ（投稿の3〜5日前から）

新規アカウントのスパム判定を避けるため、先にコメントを残す。

- [ ] `r/notebooklm` の投稿に1〜2件コメント
- [ ] `r/productivity` の投稿に1〜2件コメント
- [ ] `r/Kindle` の投稿に1〜2件コメント

---

## Step 4 — 投稿（v0.1.3 審査通過後）

### 投稿先
`r/notebooklm`

### タイトル
```
I built a free Chrome extension that automatically adds Amazon book sources to NotebookLM
```

### 本文
```
Hey r/notebooklm!

I've been manually hunting for book summaries and YouTube videos
to add to NotebookLM every time I buy a book — and it was taking
forever. So I spent a few weekends building a small Chrome extension
to automate it.

Wanted to share it here since this community would probably get the
most out of it. Would love honest feedback!

Here's how it works:

1. Open any book page on Amazon
2. Click the Preread icon → it auto-detects the book title
3. Hit "Search Sources" — it finds reviews, summaries, and YouTube videos
4. Click "Add to NotebookLM" → your notebook is ready in seconds

**What you get for free:**
- Web articles (summaries, reviews) — requires a free Tavily API key
- YouTube videos — works immediately, no API key needed
- One-click add to NotebookLM

I tested it with Atomic Habits and it pulled in sources from
James Clear's own site, Reddit, Medium, and YouTube automatically.

I'm a solo developer and just shipped the English version.
Would genuinely love feedback from this community!

👉 https://chromewebstore.google.com/detail/bcddhhfaemlacbmpjdaemlbojejpbiae?utm_source=item-share-cb
```

### 添付スクリーンショット（この順番で）
1. `extension/SS/english/1.png` — Amazon ページでポップアップを開いた画面
2. `extension/SS/english/2.png` — 検索結果一覧
3. `extension/SS/english/3.png` — NotebookLM にソースが追加された画面
4. `extension/SS/english/4.png` — 設定画面

### フレア
`Tool` または `Resource`

---

## Step 5 — 投稿後の対応

- 投稿後 1〜2 時間はブラウザを開けておく
- コメントには必ず返信する（他の人が見ている）
- 否定的なコメントにも丁寧に返す

### 返信テンプレート（感謝）
```
Thanks for trying it out! Let me know if you run into any issues 🙏
```

### 返信テンプレート（フィードバックへの反応）
```
Really appreciate the feedback! I'll look into that.
This is a solo project so every suggestion helps a lot.
```

### 返信テンプレート（APIキーの質問が来た場合）
```
YouTube search works right away with no setup.
For web articles, you'll need a free Tavily API key —
it takes about 1 minute to get at app.tavily.com (no credit card needed).
```

---

## 次のチャネル（反応を見てから）

| チャネル | タイミング |
|---|---|
| `r/productivity` | r/notebooklm 投稿の1週間後 |
| `r/Kindle` | 同上 |
| Product Hunt | 準備が整ったら（別途計画） |
| Zenn（開発記） | 日本語圏向け |
