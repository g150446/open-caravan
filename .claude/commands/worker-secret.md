---
description: .env.device-cert のトークンを Worker の CLOUDFLARE_API_TOKEN に登録する（スタッフ画面から証明書を発行できるようにする）
allowed-tools: Bash(npm run device-cert -- worker-secret)
---

利用者がこのコマンドで、本番 Worker へのシークレット登録を指示しました。次を Bash で1回だけ実行し、結果を日本語で短く伝えてください。トークンの値は表示しないでください。

```
npm run device-cert -- worker-secret
```

失敗したら、出力からわかる原因と次にすることを伝えてください（再実行はしない）。
