/**
 * ddg-spike.mjs — DuckDuckGo HTML版 検索の実機スパイク検証
 *
 * 目的: 記事検索を Tavily(要APIキー) から DuckDuckGo(キー不要) へ置換できるか、
 *      実際にエンドポイントを叩いて「到達性 / bot判定 / 結果品質 / uddg復号」を確認する。
 *
 * 実行: Node.js 18+ が必要（global fetch を使用）。サンドボックス外のローカルで:
 *      node scripts/ddg-spike.mjs
 *
 * 確認ポイント:
 *  - HTTP 200 が返るか（202 や bot チャレンジHTMLでないか）
 *  - result__a が正規表現で抽出できるか
 *  - uddg= から実URLを復元できるか
 *  - 日本語/英語クエリの結果品質に差があるか
 *  - User-Agent あり/なしで挙動が変わるか（bot判定の傾向把握）
 */

const ENDPOINT = 'https://html.duckduckgo.com/html/';

const QUERIES = [
  { q: '7つの習慣 要約 レビュー まとめ', kl: 'jp-jp', lang: 'ja' },
  { q: 'サピエンス全史 要約 レビュー まとめ', kl: 'jp-jp', lang: 'ja' },
  { q: 'Atomic Habits review summary', kl: 'us-en', lang: 'en' },
];

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** result__a の href とテキストを抽出し、uddg を復号して実URLにする */
function parseResults(html) {
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    const url = uddg ? decodeURIComponent(uddg[1]) : href;
    results.push({ title, url });
  }
  return results;
}

function looksLikeBotWall(html, status) {
  if (status === 202) return true;
  return /captcha|recaptcha|cf-chl|challenge-form|anomaly|unusual traffic/i.test(html);
}

async function run(withUA) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`User-Agent: ${withUA ? 'あり(Chrome相当)' : 'なし'}`);
  console.log('='.repeat(70));

  for (const { q, kl, lang } of QUERIES) {
    const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&kl=${kl}`;
    const headers = { 'Accept-Language': lang === 'en' ? 'en,ja;q=0.9' : 'ja,en;q=0.9' };
    if (withUA) headers['User-Agent'] = UA;

    try {
      const res = await fetch(url, { headers, redirect: 'follow' });
      const html = await res.text();
      const bot = looksLikeBotWall(html, res.status);
      const results = parseResults(html);

      console.log(`\n[${lang}] "${q}"`);
      console.log(`  HTTP: ${res.status}  size: ${html.length}  bot判定: ${bot ? '⚠️ あり' : 'なし'}  抽出件数: ${results.length}`);
      results.slice(0, 5).forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.title}`);
        console.log(`      ${r.url}`);
      });
      if (results.length === 0) {
        console.log('   （0件: HTML構造が想定と違う可能性。下記で生HTML冒頭を確認）');
        console.log('   ' + html.slice(0, 300).replace(/\s+/g, ' '));
      }
    } catch (err) {
      console.log(`\n[${lang}] "${q}"  ❌ fetch失敗: ${err.message}`);
    }
  }
}

await run(false);
await run(true);

console.log(`\n${'='.repeat(70)}`);
console.log('判定の目安:');
console.log('  ・両方とも 200 + 抽出件数 5件以上 + bot判定なし → SW直fetchで採用可(§9現案)');
console.log('  ・UAなしで bot判定/0件、UAありで改善 → UAヘッダ付与で対応');
console.log('  ・UAありでも 202/bot判定 → content_script経由(Cookie付き)に切替が必要');
console.log('='.repeat(70));
