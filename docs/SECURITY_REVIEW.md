# セキュリティレビュー（2026-09-09）

対象: B、基点 4f58302。中規模のバックエンドレビュー。独立レビュー1名（Luna xhighを要求、ルーティング未検証）。

## 修正

- 中・条件付き: Vercelを経由しない直接起動では、任意の転送元IPヘッダーを使って作成・認証レート制限のキーを変更できた。VERCEL=1の環境だけでx-vercel-forwarded-forを信頼し、それ以外や不正値はunknownの共通バケットにする。同じIPの異なる表記も正規化。Vercel本番での回避を再現したという意味ではない。
- 低: localhost.やinternal.local.がローカル宛てURL拒否を回避して保存できた。ホスト名の末尾ドットを正規化して拒否。プレビューのDNS検証は従来から内部接続を遮断するため、サーバーSSRFの再現とは区別する。
- 防御設定の明確化: パスワード画面のform-actionをself/http:/https:へ変更。外部302を維持する。任意HTTP(S)宛ては依然許可されるため、フォーム注入への完全な対策ではない。現在の固定フォームとHTMLエスケープも維持。

## 検証と限界

- npm test: 36件成功。転送元偽装、IP表記の同一性、ローカル末尾ドット、認証後302、CSPヘッダーを含む。
- npm run typecheck / npm run build: 成功。
- npm audit / npm audit --omit=dev: 今回の照会では既知脆弱性0件。将来の安全を保証するものではない。
- API、パスワード処理、プレビューDNS検証・接続先固定、SQL権限設定をコード確認。SQL・画面・DB関数契約は変更していない。
- 実ブラウザーでのCSP遷移、Vercel上のヘッダー偽装、実Supabase権限の再確認は今回未実施。
- Vercel以外は全クライアントが共通レート制限になる。VERCEL=1を直接公開サーバーに手動設定しない。
- 任意ドメインが閲覧者側で内部IPへ解決されるケースまでは短縮URLの入力検証で防げない。
- 分散IPからの試行、古いrate_limits行の保守は運用側の追加検討事項。

## 参照

- https://vercel.com/docs/headers/request-headers
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action
