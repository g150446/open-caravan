# Open Caravan

訪問診療の予定を院内で共有するアプリケーションです。React/Vite、Cloudflare Worker、D1で動作します。証明書認証（mTLS）は後続実装です。

## 機能

- 日・週・月カレンダー、担当者での絞り込み、検索、施設ごとの表示
- 単発、毎週、隔週、第n曜日の繰り返し予定。この回のみ／この回以降の編集・削除
- 予定ごとに独立したメモと、患者共通の申し送り。前回／次回への手動コピー
- 患者名から詳細パネル、登録したモバカル患者URL、住所のGoogle Maps
- 患者一覧と予定カードに訪問回数（例：月1回）・住居区分（居宅／施設）を表示。訪問回数は患者情報で編集し、施設の選択から住居区分を判定
- 患者・施設・スタッフ管理、個別ID／パスワード、管理者権限
- UTF-8 CSVによる患者と単発予定の取込。テンプレート、50行単位のプレビュー、最大1000行、エラー時は登録しない
- バージョンと共有リビジョンで競合を検出し、上書きを防止。30秒ごとの変更確認
- 操作履歴、HttpOnlyセッション、CSRF／Origin検証、DBでのログイン試行制限

モバカルとのAPI連携は行いません。患者管理で対応患者のHTTPS URL（movacal.netまたはそのサブドメイン）を登録します。住所が空欄の場合は施設住所を地図に使用します。

## 開発

Node.js 24以上を使用します（ローカルDBとテストにNode SQLiteを使用）。

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

ローカル初期設定は `http://127.0.0.1:3000/#setup=local-setup`。ローカルDBは `data/dev.db` です。ローカル用の固定秘密値を本番には使用しないでください。

## Cloudflare

Worker名: `open-caravan`。D1名: `open-caravan-db`。`wrangler.jsonc` の `database_id` と `APP_ORIGIN` を自分の環境に合わせて設定してください。既存環境専用の設定はGit対象外の `wrangler.local.jsonc` に保存できます（CLIに `--config wrangler.local.jsonc` を指定）。

ブラウザのコードエディターから配置できるように、`npm run build` は画面のHTML/CSS/JavaScriptも含む単一の `build/worker.js` を生成します。静的画面のリクエストもWorkers無料枠に計上されます。将来通常のCLI配信へ移行する場合は静的アセット用バインディングも利用できます。

再配置には、CloudflareダッシュボードのWorker「コードを編集する」で `build/worker.js` に置き換えてデプロイします。D1は `DB` という変数名でバインドします。

CLIを使う場合はWrangler 4をインストールし、Cloudflareへ認証した環境で実行します。

```sh
npm exec --package=wrangler@4 -- wrangler login
npm exec --package=wrangler@4 -- wrangler d1 create open-caravan-db
# 発行されたdatabase_idをwrangler.jsoncに設定
npm exec --package=wrangler@4 -- wrangler d1 migrations apply open-caravan-db --remote
npm run build
npm exec --package=wrangler@4 -- wrangler deploy
```

本番設定:

| 名前 | 種類 | 内容 |
| --- | --- | --- |
| `APP_ORIGIN` | テキスト | 公開URLのOrigin（末尾スラッシュなし） |
| `AUTH_PEPPER` | シークレット | 暗号学的乱数32バイト以上。パスワードのハッシュに使用 |
| `SETUP_TOKEN` | シークレット | 初期管理者登録専用の乱数トークン |
| `SETUP_EXPIRES` | テキスト | 初期リンク期限のUnix時刻、ミリ秒 |

秘密値はリポジトリに保存しません。`AUTH_PEPPER` を変更すると既存パスワードの認証ができなくなるため、バックアップと管理をしてください。初期リンクは `/#setup=<SETUP_TOKEN>`。トークンはURLフラグメントに置き、画面表示後URLから取り除きます。期限または最初の管理者登録によって利用不可になります。初期登録後は管理者がスタッフを作成します。プレビューURLと永続的なリクエストログは無効にします。

## 運用

無料枠の使用量をCloudflareダッシュボードで確認してください。上限超過時にはリクエスト／DB操作が停止するため、利用人数とデータ量に応じて判断が必要です。手動コピーしたメモも、コピー先の予定で独立して保存されます。

D1のTime Travel／エクスポートでバックアップを取得し、更新前にもバックアップします。データ削除／復元は稼働中のスタッフを止めてから実施してください。実患者データを利用する前には、後続の証明書認証、院内の運用条件、バックアップ復元手順を確認してください。

## 検証

`npm test` はNode SQLiteのD1互換アダプターで、認証・初期登録の期限／再利用、CSRF、メモの独立保存、競合の原子性、CSV取込、日付／繰り返し／URL検証を確認します。本番D1やWorkersの実行上限は、配置後の実行でも確認します。

検証用の画面は `npm run build && npm run preview:fixture` で生成した `build/preview.html` をブラウザで開けます。架空データのローカル専用モックです。本番には含まれません。APIの永続保存の検証は上記の統合テストで別に実施します。

## ログインと初期管理者登録

共通の初期ID・パスワードはありません。初期設定リンク `/#setup=<SETUP_TOKEN>` を開き、管理者のログインIDとパスワードを登録します。登録後はそのIDとパスワードでログインし、管理画面からスタッフのアカウントを追加できます。初期設定リンクや秘密値をREADME・Issueなどに公開しないでください。

稼働URL: https://open-caravan.g150446.workers.dev/

このURLは管理者登録後にログインが必要です。証明書認証は後続実装です。

## ライセンス

[MIT License](LICENSE)。商用利用・改変・再配布が可能です。依存ライブラリにはそれぞれのライセンスが適用されます。
