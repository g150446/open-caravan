# Open Caravan

訪問診療の予定を院内で共有するアプリケーションです。React/Vite、Cloudflare Worker、D1で動作します。本番ではクライアント証明書認証（mTLS）を必須にします。

## 機能

- 日・週・月カレンダー、担当者での絞り込み、検索、施設ごとの表示
- 予定ごとに担当スタッフ1名と同行スタッフ（任意・複数）。週表示は担当スタッフ（＋同行の組み合わせ）ごとの列を日ごとに横に並べる。CSVの担当者IDは先頭が担当、2人目以降が同行
- 単発、毎週、隔週、第n曜日の繰り返し予定。この回のみ／この回以降の編集・削除
- 予定ごとに独立したメモと、患者共通の申し送り。前回／次回への手動コピー
- 患者名から詳細パネル、登録したモバカル患者URL、住所のGoogle Maps
- 患者一覧と予定カードに訪問回数（例：月1回）・住居区分（居宅／施設）を表示。予定カードの時刻の横に住所の町名（郡部は町村名、区のある市は区名、5条西のような条の住所はその部分）を表示。訪問回数は患者情報で編集し、施設の選択から住居区分を判定
- 患者・施設・スタッフ管理、個別ID／パスワード、管理者権限
- UTF-8 CSVによる患者と単発予定の取込。テンプレート、50行単位のプレビュー、最大1000行、エラー時は登録しない
- バージョンと共有リビジョンで競合を検出し、上書きを防止。30秒ごとの変更確認
- 許可したクライアント証明書による全画面・全APIのアクセス制限。管理者はスタッフ画面から端末証明書を発行・失効（デプロイ不要）
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

ローカル初期設定は `http://127.0.0.1:3000/#setup=local-setup`。ローカルDBは `data/dev.db` です。ローカルサーバーだけが `MTLS_MODE=local` を設定して証明書検証を省略します。この例外はCloudflare上では動作しません。ローカル用の固定秘密値を本番には使用しないでください。

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
| `MTLS_MODE` | テキスト | 本番では `required`。未指定でも証明書必須 |
| `MTLS_HOST` | テキスト | 証明書認証を有効にしたホスト名 |
| `MTLS_ALLOWED_SHA256` | テキスト | 常に許可する証明書のSHA-256フィンガープリント。複数はカンマ区切り。管理者端末の非常用（スタッフ画面で発行した証明書はD1で管理） |
| `CLOUDFLARE_API_TOKEN` | シークレット | スタッフ画面から証明書を発行・失効するためのトークン。権限は対象ゾーンの「SSL および証明書: 編集」と「ゾーン: 読み取り」だけ |
| `CLOUDFLARE_ZONE_ID` | テキスト | 任意。未設定なら `MTLS_HOST` からゾーンを検索 |
| `CERT_VALIDITY_DAYS` | テキスト | 任意。スタッフ画面で発行する証明書の有効日数（既定365） |
| `AUTH_PEPPER` | シークレット | 暗号学的乱数32バイト以上。パスワードのハッシュに使用 |
| `SETUP_TOKEN` | シークレット | 初期管理者登録専用の乱数トークン |
| `SETUP_EXPIRES` | テキスト | 初期リンク期限のUnix時刻、ミリ秒 |

秘密値はリポジトリに保存しません。`AUTH_PEPPER` を変更すると既存パスワードの認証ができなくなるため、バックアップと管理をしてください。初期リンクは `/#setup=<SETUP_TOKEN>`。トークンはURLフラグメントに置き、画面表示後URLから取り除きます。期限または最初の管理者登録によって利用不可になります。初期登録後は管理者がスタッフを作成します。プレビューURLと永続的なリクエストログは無効にします。

## クライアント証明書認証（mTLS）

独自ドメインのCloudflare管理CAで発行したクライアント証明書を使います。CloudflareのSSL/TLS → クライアント証明書でアプリのホストだけにmTLSを有効化します。Freeプランで利用できるCloudflare管理CAを使い、Cloudflare AccessのmTLSや独自CAを前提にしません。

WAFのカスタムルールをBlockに設定します。以下のホストは自分の環境に置き換えてください。

```text
(http.host eq "caravan.YOUR_DOMAIN" and (not cf.tls_client_auth.cert_verified or cf.tls_client_auth.cert_revoked))
```

Workerも `request.cf.tlsClientAuth` の `certPresented=1`、`certVerified=SUCCESS`、`certRevoked=0` と許可フィンガープリントを確認します。利用者が送った証明書ヘッダーは信頼しません。証明書がないリクエストはログイン画面やhealth APIを含め拒否されます。設定が欠けている場合は503で拒否します。

**HTTP/3は無効にしてください**（ゾーンの Speed → 設定 → プロトコルの最適化 → 「HTTP/3 (QUIC 使用)」をオフ）。HTTP/3ではクライアント証明書が送信されません。有効のままだと、ブラウザはDNSのHTTPSレコード（`alpn=h3`）を見てHTTP/3で接続し、証明書を入れた端末でもブロックされます。Chromeを再起動しても解消しません。無効化後は `dig +short caravan.YOUR_DOMAIN TYPE65` の結果に `h3`（16進表記 `026833`）が含まれないことを確認します。

`APP_ORIGIN` と `MTLS_HOST` をCustom Domainと一致させ、新URLで証明書付きの動作を確認してから `workers.dev` を無効化します。プレビューURLも無効にします。静的アセットを別の公開サービスへ配置する場合も証明書認証が必要です。Workers Static Assetsのバインディングを使う場合は `assets.run_worker_first=true` を設定し、アセットへの直接配信による検証の迂回を防いでください。

### 発行・端末追加

端末ごとに別の鍵と証明書を発行します。Mac内でCSRを作り、CloudflareにCSRだけを提出します。次はRSA 2048ビットの例です。

```sh
mkdir -p certificates
chmod 700 certificates
umask 077
openssl req -new -newkey rsa:2048 -nodes -keyout certificates/client.key -out certificates/client.csr -subj '/CN=Open Caravan Mac'
# CloudflareでCSRを使って証明書を発行し、certificates/client.pemとして保存
openssl x509 -in certificates/client.pem -noout -fingerprint -sha256
openssl pkcs12 -export -inkey certificates/client.key -in certificates/client.pem -out certificates/client.p12
```

フィンガープリントを `MTLS_ALLOWED_SHA256` に追加してから `.p12` をMacのキーチェーンに読み込みます。秘密鍵と配布ファイルは `certificates/` に保存し、Git対象外にします。保護パスワードは別に管理してください。Macではキーチェーンの証明書を利用できるブラウザがアクセスできます。

**証明書をインストールしてからURLを初めて開いてください。** 先に開いたり、証明書選択で「拒否／キャンセル」を選んだりすると、Chromeは「証明書なし」の選択をセッション中保持します。その間はCloudflareのブロック画面が表示され続けます。

Android（Chrome）向けの `.p12` は、Androidが読み込める暗号方式で作成します。

```sh
openssl pkcs12 -export -inkey certificates/android.key -in certificates/android.pem -name 'Open Caravan Android' \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -out certificates/android.p12
```

端末では「設定 → セキュリティ → 暗号化と認証情報 → 証明書のインストール → **VPN とアプリユーザー証明書**」から読み込みます。「CA証明書」として入れると利用できません。初回アクセス時の「証明書の選択」で該当証明書を選びます。

MacのChromeでは、ポリシー `AutoSelectCertificateForUrls` を設定すると証明書を自動選択するため、選択ダイアログが出ず、誤ってキャンセルすることもなくなります（設定後にChromeを一度再起動し、`chrome://policy` で反映を確認）。

```sh
defaults write com.google.Chrome AutoSelectCertificateForUrls -array -string \
  '{"pattern":"https://caravan.YOUR_DOMAIN","filter":{"ISSUER":{"CN":"Managed CA YOUR_ACCOUNT_ID"}}}'
```

ブロック画面から抜けられない場合: まずHTTP/3が無効になっているかを確認します（CloudflareのセキュリティイベントでHTTPバージョンが `HTTP/3` なら、これが原因）。そのうえで、AndroidはChromeを「設定 → アプリ → Chrome → **強制停止**」してから開き直し、証明書を選択します。MacはChromeを⌘Qで完全に終了してから開き直します。Cloudflare Freeプランではブロック画面の文言を変更できません（Custom ErrorsはPro以上）。

利用者向けのインストール手順（Mac・Windows・Android・iPhone）: https://g150446.github.io/open-caravan/ （`docs/index.html`、GitHub Pagesで公開）

### スタッフ画面から発行・失効

管理者はスタッフ情報の「端末証明書」欄で、端末名（例: `tanaka-iphone`）を入れて「証明書を発行」を押します。新規登録した直後もそのまま発行へ進めます。

- 秘密鍵とCSRはブラウザの中で作ります。サーバーにはCSRだけを送り、WorkerがCloudflare APIで署名します。
- `open-caravan-<端末名>.p12` がダウンロードされ、読み込み用パスワードが画面に1回だけ表示されます。`.p12` とパスワードは別々の経路で渡してください。
- フィンガープリントはD1の `device_certificates` に入り、**デプロイなしで**すぐ使えます。
- 「失効」を押すと、D1で直ちにアクセスを止め、Cloudflareでも失効します。スタッフを無効にすると、その人の証明書はすべて失効します。
- 発行・失効は変更履歴に残ります。

準備（初回のみ）:

```sh
npm exec --package=wrangler@4 -- wrangler d1 migrations apply open-caravan-db --remote --config wrangler.local.jsonc
npm exec --package=wrangler@4 -- wrangler secret put CLOUDFLARE_API_TOKEN --config wrangler.local.jsonc
```

`MTLS_ALLOWED_SHA256` には管理者の端末を最低1台残してください。D1やAPIに問題があっても、管理者が締め出されないようにするためです。

### スクリプトでまとめて発行・失効（非常用）

スタッフ画面が使えないときや、管理者端末を `MTLS_ALLOWED_SHA256` に登録するときに使います。

`scripts/device-cert.mjs` は、鍵とCSRの作成、Cloudflareでの発行、Android/macOS/iOS/Windows共通の `.p12` とパスワードの作成、`wrangler.local.jsonc` の `MTLS_ALLOWED_SHA256` への追加をまとめて行います。証明書は人ではなく端末ごとに発行します（スタッフの識別はログインで行います）。

```sh
# .env.device-cert（Git対象外）に CLOUDFLARE_API_TOKEN=... を書くと自動で読み込みます。
# .env.local には書かないでください（wranglerが読み込み、deployがこのトークンで失敗します）。
# 権限: 対象ゾーンの「SSL および証明書: 編集」と「ゾーン: 読み取り」。未設定ならCSRを表示し、PEMの貼り付けを待ちます。
npm run device-cert -- issue tanaka-iphone tanaka-pc sato-android sato-pc
npm run device-cert -- list             # 有効／失効／未反映を表示
npm run device-cert -- revoke sato-android   # 紛失時。Cloudflareで失効し許可リストから削除
NODE_OPTIONS=--dns-result-order=ipv4first npx --yes wrangler@4 deploy --config wrangler.local.jsonc
```

発行物は `certificates/devices/<端末名>/`、台帳は `certificates/devices.json` に保存されます（Git対象外）。`.p12` と `password.txt` は別々の経路で端末に渡し、インストール後に端末から削除してもらいます。有効期間は `CERT_VALIDITY_DAYS`（既定365日）で変更できます。

### 更新・失効

有効期間は1年を基本とし、期限の30日前を目安に新しい鍵と証明書を発行します。許可リストに新証明書を追加し、動作確認後に旧証明書を失効して許可リストから削除します。紛失した端末の証明書は、スタッフ画面で「失効」を押します（スクリプトで発行したものはCloudflareで失効し、許可リストからも削除します）。既存セッションがあっても、以降のリクエストは証明書検証を通過する必要があります。

DNSをCloudflareへ移す場合は、既存のWeb・メール・TXT認証など全レコードを元の管理画面と照合して引き継ぎます。既存サービスは原則DNSのみとし、Webとメールの動作を確認してください。

## 運用

無料枠の使用量をCloudflareダッシュボードで確認してください。上限超過時にはリクエスト／DB操作が停止するため、利用人数とデータ量に応じて判断が必要です。手動コピーしたメモも、コピー先の予定で独立して保存されます。

D1のTime Travel／エクスポートでバックアップを取得し、更新前にもバックアップします。データ削除／復元は稼働中のスタッフを止めてから実施してください。実患者データを利用する前には、証明書認証の稼働確認、院内の運用条件、バックアップ復元手順を確認してください。

## 検証

`npm test` はNode SQLiteのD1互換アダプターで、証明書の欠落・不正・期限切れ・失効・許可対象外・設定不足・別ホストの拒否、スタッフ画面からの証明書の発行・失効（.p12の読み込み、管理者以外の拒否、スタッフ無効化での一括失効）、認証・初期登録の期限／再利用、CSRF、メモの独立保存、競合の原子性、CSV取込、日付／繰り返し／URL検証を確認します。本番D1やWorkersの実行上限は、配置後の実行でも確認します。

検証用の画面は `npm run build && npm run preview:fixture` で生成した `build/preview.html` をブラウザで開けます。架空データのローカル専用モックです。本番には含まれません。APIの永続保存の検証は上記の統合テストで別に実施します。

## ログインと初期管理者登録

共通の初期ID・パスワードはありません。初期設定リンク `/#setup=<SETUP_TOKEN>` を開き、管理者のログインIDとパスワードを登録します。登録後はそのIDとパスワードでログインし、管理画面からスタッフのアカウントを追加できます。初期設定リンクや秘密値をREADME・Issueなどに公開しないでください。

本番URL: https://caravan.asian-jasmine.com/

クライアント証明書を登録した端末だけがアクセスできます。証明書認証を通過した後もログインが必要です。旧URL（`workers.dev`）で作成したアカウントは同じD1を使うため、そのまま新URLでログインできます。

## トラブルシューティング

- **ログイン時に「アクセス元が一致しません」**: 稼働中Workerの `APP_ORIGIN` が、ブラウザで開いているURLのOriginと一致していません。ダッシュボードの「設定 → 変数とシークレット」で `APP_ORIGIN` と `MTLS_HOST` を確認し、正しい設定で再デプロイしてください。
- **`wrangler deploy` で変数が上書きされる**: `vars` は設定ファイルの内容で置き換わり、ダッシュボードだけにある変数（例: `SETUP_EXPIRES`）は削除されます。シークレットは維持されます。
- **証明書を入れたのに403になる**: CloudflareのHTTP/3が有効だと証明書が送られません。上記「クライアント証明書認証」のとおりHTTP/3を無効にしてください。それでも403になる場合: Chromeは証明書を選ばなかった結果をセッション中キャッシュします。⌘QでChromeを完全に終了して再起動し、証明書選択ダイアログで該当証明書を選んでください。サーバー側の確認は `curl --cert client.pem --key client.key https://caravan.YOUR_DOMAIN/` で行えます。
- **`wrangler login` がトークン取得でタイムアウト（ETIMEDOUT）する**: IPv6経路の問題の可能性があります。`NODE_OPTIONS=--dns-result-order=ipv4first` を付けて再実行してください。
- **追加直後のCustom Domainが名前解決できない**: macOSのDNS否定キャッシュが残っていることがあります。`sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder` を実行し、Chromeでは `chrome://net-internals/#dns` からキャッシュを消去してください。

## ライセンス

[MIT License](LICENSE)。商用利用・改変・再配布が可能です。依存ライブラリにはそれぞれのライセンスが適用されます。
