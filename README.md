# Link Pocket — URL短縮サービスの開発基盤

Next.js App Router + Supabase PostgreSQL + Vercel の最小試作です。管理画面はありません。Cloudflareのサービス・SDK・デプロイ設定は使用しません。

## 含まれる機能

- URL短縮、任意のshort code、有効期限
- パスワードによるアクセス制限
- リンクプレビュー（取得できない場合も短縮を作成）
- ブラウザー内でのQRコード生成、保存、コピーと短縮URLコピー
- リダイレクト成功時の累計click_count加算、HTTP 302リダイレクト
- Supabase用SQL、入力検証、統一エラー形式、テスト

## ローカル起動

Node.js 24 LTSを推奨します。プロジェクトフォルダーで次を実行します。

```sh
npm ci
```

`.env.example` を `.env.local` にコピーし、次を設定します。

| 変数 | 値 |
| --- | --- |
| `APP_URL` | ローカルは `http://localhost:3000`、公開時はVercelのHTTPS URL |
| `SUPABASE_URL` | SupabaseプロジェクトのURL |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバー専用service_roleキー |

Supabase SQL Editorで `supabase/migrations/` 内のSQLをファイル名順に実行してください。新しい開発用プロジェクトでの適用を前提とします。既存の同名テーブルがある場合は差分を確認してください。

キーは `NEXT_PUBLIC_` を付けず、Gitにも登録しません。ブラウザーからDBへ直接接続しない構成です。

```sh
npm run dev
```

`http://localhost:3000` を開きます。未設定でも画面は起動できますが、短縮作成・アクセスにはSupabase設定が必要です。

## 検証

```sh
npm test
npm run typecheck
npm run build
npm start
```

実施済みの結果と未検証範囲は [docs/VERIFICATION.md](docs/VERIFICATION.md) に記載しています。

## Vercelへの配置

1. このフォルダーをGitリポジトリに登録し、Vercelでインポートします。
2. Framework PresetをNext.jsにします。サブフォルダーごと登録した場合はRoot Directoryをこのフォルダーに設定します。
3. 上記3つの環境変数をVercelで設定します。`APP_URL` は利用する公開URLに固定してください。
4. 対応するSupabaseにSQLを適用してからデプロイします。
5. 公開URLで通常リンク、パスワード、期限切れ、コード重複を確認します。プレビュー環境では開発用DBを使ってください。

この納品では外部アカウントの作成、実DBへのSQL適用、公開デプロイは行っていません。

## AI・3人開発への引き継ぎ

- [全体説明書・共通契約](docs/AI_HANDOFF.md) — 各AIへ最初に渡す資料
- [3人用の役割分担・作成手順](docs/TEAM_WORKFLOW.md) — 並行開発と統合の手順
- [検証記録](docs/VERIFICATION.md) — 検証と制約

## 設計上の範囲

click_countはユーザー数ではなく、サービスが許可したリダイレクト回数です。リロードやボットのGETも含まれます。作成画面の値は作成時点の値で、集計の閲覧APIや管理画面はありません。短縮コードを知る人は通常リンクへアクセスできます。パスワード付きリンクはアクセスごとに認証します。

公開サービスとして運用する際は、悪用通報・削除運用、フィッシング対策、監視、費用上限を別途整備してください。これは開発用の最小試作です。

## 公式資料

- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
