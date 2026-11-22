# Katachi CAD

スマホのブラウザでプレート、円柱、貫通穴を組み合わせ、mm単位で立体を編集できます。GitHub Pagesが操作画面を配信し、Cloudflare WorkersのDurable Objectsが共有プロジェクトをSQLiteに保存します。

## モデルを共同編集する

1. CADを開き、サンプルの形状を選ぶか「新規モデル」で空のモデルを作成します。
2. 「編集リンクを共有」から「共有プロジェクトを作成」を押します。サーバーURLを尋ねられたら、下の手順で公開したWorkerのURLを入力します。
3. 発行された編集リンクをスマホとChatGPT Workのクラウドブラウザで開きます。リンクを知っている人は読み書きできます。モデルの内容はGitHubにコミットされません。
4. 例としてChatGPTに「この編集リンクを開き、『中心穴』の直径を10 mmに変更して『変更を適用』を押して」と指示します。作成済みの形状もツリーから編集できます。
5. 他の画面は表示中に約2.5秒間隔で更新します。寸法入力中はその入力を保持し、競合した保存は最新の版を表示して再入力を求めます。
6. 「書き出し」から3MFまたはバイナリSTLを保存し、スライサーで開きます。STLの読み込み単位はmmを指定してください。

1本指で回転、2本指でズーム・移動できます。形状はツリーの上から順に合成します。貫通穴はその時点の立体をZ方向に貫通します。作業中の寸法変更は「変更を適用」で確定します。共有前の下書きはそのブラウザに保存されます。共有後は同じ編集リンクをブックマークしてください。

## ローカルで起動

Node.js 24で `npm ci` を実行します。2つのターミナルで次を起動してください。

```sh
npm run dev:sync
```

```sh
npm run dev
```

Viteが表示するURLを開きます。開発時の共有APIは `http://localhost:8787` です。同じ編集リンクを別のブラウザで開くと同期を確認できます。

## 公開

1. Cloudflareアカウントで `npx wrangler login`、続いて `npm run deploy:sync` を実行します。Durable ObjectとSQLiteストレージはデプロイ時に作成されます。
2. GitHubリポジトリの **Settings → Secrets and variables → Actions → Variables** に `CAD_SYNC_URL` とWorkerの公開URLを登録すると、利用者によるサーバーURL入力を省けます。URLは公開設定値です。
3. **Settings → Pages → Source** で **GitHub Actions** を選択します。mainへのpushまたはActions画面から **Publish CAD to GitHub Pages** を実行すると配信されます。変数を後から設定した場合も再実行してください。

別のPagesドメインを使う場合は `wrangler.jsonc` の `APP_ORIGIN` を変更します。編集キーはURLフラグメントで引き継ぎ、APIへはAuthorizationヘッダーで送ります。共有リンクを公開リポジトリへ掲載しないでください。

## 検証

`npm test` で形状演算、印刷メッシュの閉鎖性、STL・3MF出力を、`npm run build` でPages用ビルドを検証できます。
