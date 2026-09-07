# 各AIに渡す全体説明書

このファイルを最初に読み、担当範囲を `TEAM_WORKFLOW.md` と実装ファイルで確認してください。仕様変更は他の担当へ共有してから行います。

## 目的と制約

3人が並行して開発できるURL短縮サービスの基盤です。Vercel + Next.js App Router + Supabaseを使用します。Cloudflareは一切使用しません。管理画面、ユーザー登録、編集・削除APIはスコープ外です。

## 共通API契約

命名はJSON・DBともにsnake_caseです。

| Method | Path | 成功時 |
| --- | --- | --- |
| POST | `/api/links` | 201 JSONで短縮結果 |
| GET | `/{short_code}` | 302、またはパスワード入力HTML |
| POST | `/{short_code}` | パスワード検証後302 |

HEADは閲覧数に含めません。リダイレクトはキャッシュしません。Next.jsの標準リダイレクト関数の既定ステータスに頼らず302を明示します。

### 作成リクエスト

```json
{
  "original_url": "https://example.com/page",
  "custom_code": "sample-link",
  "expires_at": "2027-10-01T00:00:00Z",
  "password": "example-password"
}
```

`original_url` だけが必須です。任意項目は未設定なら省略してください。`expires_at` はタイムゾーンを含む未来の日時です。画面ではローカル日時をUTCへ変換します。任意コードは4〜32文字の英数字・ハイフン・アンダースコアです。予約済みパスは使用できません。コードの大文字小文字は区別します。パスワードは8〜128文字です。

### 作成レスポンス

```json
{
  "short_code": "sample-link",
  "short_url": "https://your-app.vercel.app/sample-link",
  "original_url": "https://example.com/page",
  "expires_at": "2027-10-01T00:00:00Z",
  "click_count": "0",
  "preview": {
    "title": "Example",
    "description": null,
    "image_url": null,
    "site_name": null,
    "favicon_url": null
  }
}
```

`preview` の各値は取得不可ならnullです。`click_count` はDBのbigintを扱うため文字列です。プレビューの取得失敗は短縮作成の失敗にしません。パスワードやハッシュを返却しません。

認証POSTはJSONの `{"password":"..."}` またはHTMLフォームの `password` を受け付けます。成功はJSONではなく302です。プログラムから検証する場合は自動リダイレクトを無効にしてください。

### エラー形式

```json
{"error":{"code":"INVALID_REQUEST","message":"入力内容を確認してください。"}}
```

HTTPステータスと安定した `code` を処理の判断に使い、`message` は表示用に使います。検証400、認証401、未発見404、重複409、期限切れ410、本文過大413、形式不正415、制限429、内部障害500、未設定・利用不能503が基本です。具体的なコード文字列は実装とテストを正とし、変更時はこの契約も更新してください。

## DB契約

テーブル名は `links`。

| カラム | 型・意味 |
| --- | --- |
| id | uuid主キー |
| short_code | text、UNIQUE、NOT NULL |
| original_url | text、NOT NULL |
| is_custom_code | boolean、NOT NULL |
| created_at | timestamptz、now() |
| expires_at | timestamptz、null可 |
| password_hash | text、null可 |
| click_count | bigint、初期値0 |
| title | text、null可 |
| description | text、null可 |
| preview_image_url | text、null可、APIではpreview.image_url |
| site_name | text、null可 |
| favicon_url | text、null可 |

RLSと権限設定により匿名クライアントから読み書きできないようにします。サーバー専用キーはAPIの内部だけで使用します。アクセス数はSQL関数で原子的に増やします。認証失敗、入力画面表示、期限切れでは加算しません。

## 安全性の維持

- URLはhttp/httpsだけを許可し、認証情報入りURLや内部宛先を拒否します。
- 外部プレビュー取得はDNS検証・接続先固定・リダイレクト再検証・容量と時間制限を維持します。
- プレビュー由来の文字列をHTMLとして挿入しません。
- パスワードはソルト付きハッシュを保存します。
- サーバーエラーでDB詳細や秘密を返しません。
- `APP_URL` を正規の公開URLとして使い、利用者が送信するHost値から短縮URLを組み立てません。
- ランダムコード衝突はUNIQUE制約で検出し再試行します。任意コード重複は409です。

## 完了条件

`npm test`、`npm run typecheck`、`npm run build`を実施し、担当の変更点と実施結果を報告してください。DBモックでの成功とSupabase実接続での成功は区別してください。Vercel環境でのDB権限、同時加算、レート制限の確認は統合担当が行います。
