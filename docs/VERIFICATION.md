# 検証記録

最終確認日: 2026-09-08

## 実Supabase環境での確認（担当C・2026-09-08）

開発用Supabaseプロジェクトを作成し、`supabase/migrations/001_initial.sql` を適用しました。`.env.local` に `APP_URL` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` を設定し、`npm run dev` で実接続を確認しました。

| 確認 | 結果 |
| --- | --- |
| SQLマイグレーション適用 | エラーなく適用（`links`/`rate_limits`テーブル、`increment_link_click`/`consume_rate_limit`関数、RLS・権限設定を含む） |
| `POST /api/links`（通常URL） | 201、実DBへの書き込みを確認 |
| `GET /{short_code}` | 302、Locationヘッダーが元URLと一致 |
| click_count加算 | Supabase Table Editorで実際に+1されることを確認（ユーザー確認） |
| 任意コード重複 | 409 CONFLICT（UNIQUE制約経由） |
| `npm run typecheck` | 実環境変数下でも成功 |
| `npm run build` | 実環境変数下でも成功 |
| テスト用データ | `MKo8EnJJ` / `c-setup-dup` を作成後、削除して後始末済み |


`npm test`（31件）は引き続きPGlite（インメモリのローカルPostgreSQL互換環境）上で実行されるロジック検証であり、今回のSupabase実接続確認とは別物です。誤解のないよう記載を残します。


### 今回未確認（次の担当・次回セッションへの引き継ぎ）

- 匿名（anon）キーでのDB/RPC拒否の実環境確認（`.env.local`にはanonキーを保持していないため未実施。pglite上のテストでは同一SQLに基づき拒否を確認済み）
- 過去期限指定400・期限切れ後410・保護リンクの認証フロー（401/302）・HEADでの非加算・外部プレビュー取得失敗時の挙動の実DB上での個別確認
- 同一リンクへの並行アクセス、Vercelが付与する転送元IPヘッダーを前提としたレート制限の実環境確認

## Vercelデプロイ確認（担当C・2026-09-08）

GitHub連携（`lpm8139/team3_practice`、`main`ブランチ）でVercelにインポートし、開発用Supabaseと同じ環境変数（`APP_URL`/`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`）をProduction環境に設定して公開デプロイしました。公開URL: `https://team3-practice.vercel.app`

| 確認 | 結果 |
| --- | --- |
| トップページ | 200 |
| `POST /api/links` | 201、`short_url`が`APP_URL`と一致した形で生成 |
| `GET /{short_code}` | 302、Locationヘッダーが元URLと一致 |

初回インポート時に環境変数の入力を忘れたまま最初のデプロイを実行してしまい503になったが、環境変数を追加（Secret→Configタイプに変更して再設定）した上でRedeployして解消。以後A・Bはローカル環境構築なしでこの公開URLから動作確認できる。

テスト用に作成したリンク（`OvvaL9LI`ほか）は後始末が必要（未実施の場合は次の担当が削除）。

n
## 実施済み（ローカルPostgreSQL互換環境・以前の確認分）

| 確認 | 結果 |
| --- | --- |
| `npm test` | 31件成功。ローカルPostgreSQL互換環境でマイグレーション、20並列の原子的加算、期限切れ、レート制限、anon/authenticated権限拒否を確認。入力・パスワード・API契約も確認 |
| `npm run typecheck` | 成功 |
| `npm run build` | Next.js 16の本番ビルド成功。トップ、`/{short_code}`、`/api/links`を生成 |
| `npm start` | 本番サーバー起動、トップ200とブランド表示を確認。環境変数未設定時の作成APIは503・統一JSON・no-storeを確認 |
| ローカル画面 | トップ画面、空欄エラー、詳細設定、レスポンシブ構造をブラウザーで確認 |
| Cloudflare不使用 | 依存・設定・実装にCloudflareなし。説明書内の禁止事項としてのみ記載 |
| `npm audit --omit=dev --audit-level=high` | 本番依存で既知の脆弱性0件 |

## 実環境で必要な確認（残項目）

開発用SupabaseへのSQL適用と基本動作（作成・リダイレクト・click_count・重複409）は2026-09-08に確認済みです（上記セクション参照）。残るのは`TEAM_WORKFLOW.md`の統合表のうち未確認項目（匿名キー拒否の実環境確認、Vercelが付与する転送元IPヘッダーを前提とするレート制限、期限切れ・パスワード系フローの実DB個別確認、同時リダイレクト）です。


## セキュリティ確認範囲

公開入力、外部ネットワーク取得、サーバー専用キー、パスワード、リダイレクト、DB権限をコードとテストで確認しました。プレビュー取得はHTTP(S)のみ、全DNS応答が公開IPであること、接続先固定、各リダイレクト再検証、5秒・1MiB・3回の上限を適用します。パスワードはscryptのソルト付きハッシュです。テーブルと特権RPCはanon/authenticatedから拒否します。

この最小試作には悪用通報・削除、フィッシング検知、観測基盤、ユーザー別の管理・統計がありません。一般公開前の運用設計として追加が必要です。
