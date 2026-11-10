# ゼッタイニツモレール

## Google ログインと利用許可

画面と Firestore データは、管理者が許可した Google アカウントで利用します。Firebase Authentication が Google の確認済みメールアドレスを検証し、Firestore の `allowedEmails/{小文字のメールアドレス}` の `enabled: true` と照合します。許可は管理者の Google Cloud IAM 権限で登録し、利用者は許可リストを書き換えられません。初回ログイン前のメールアドレスも登録できます。Firebase Auth ユーザーを事前作成する必要はありません。

ログインセッションは `authSessions/{uid}/sessions/{auth_time}` に保存します。最終操作から 7 日以上経過すると、そのセッションでのデータ取得・更新・期限延長をサーバー側で拒否し、再ログインを求めます。自動 ID トークン更新やバックグラウンドタイマーでは有効期間を延長しません。セッション作成は認証から 5 分以内、活動時刻はサーバー時刻だけを許可します。異なる端末のログインはそれぞれのセッションとして扱います。

### 利用者の追加・取り消し

Node.js 20 以降、Firebase CLI、対象プロジェクトの管理者としての `firebase login` が必要です。管理スクリプトは CLI のログインを再利用し、アクセストークンや OAuth クライアントシークレットを表示しません。CLI を標準外の場所にインストールした場合は `FIREBASE_TOOLS_PATH` に `firebase-tools` パッケージのディレクトリを指定してください。

```sh
# 設定と指定アカウントの許可状態を確認
node scripts/manage-access.cjs status --email person@example.com

# 変更内容を確認（この時点では書き込まない）
node scripts/manage-access.cjs allow-email --email person@example.com

# 利用許可を登録
node scripts/manage-access.cjs allow-email --email person@example.com --apply

# 利用許可を取り消す（Auth アカウントは削除しない）
node scripts/manage-access.cjs revoke-email --email person@example.com --apply
```

プロジェクトは `.firebaserc` の default を使用します。別プロジェクトには `--project project-id` を指定します。取り消し後は次の Firestore アクセスから拒否され、開いている画面も許可ドキュメントの監視でログアウトします。変更しても他のアプリの Firebase Auth アカウントや認証方式は削除しません。

### 初回設定とデプロイ

1. Firebase Console の Authentication → Sign-in method で Google を有効にし、公開名とサポートメールを設定します。Google OAuth のクライアントシークレットはソースコードに入れません。
2. 上の管理スクリプトで、利用者の Google メールアドレスを登録します。
3. 下記テストと `npm run build` を実行します。
4. `firebase deploy --only firestore:indexes --project pachislot-analyze` でインデックスを作成し、Firebase Console で利用可能になるまで待ちます。
5. `firebase deploy --only firestore:rules,hosting --project pachislot-analyze` でルールと画面を配信します。

過去日の `slot_diff` がない場合は `site777Snapshots` の数値を閲覧専用で表示します。機種名は店舗の最新 `slot_diff` を台番号で照合して使用し、対応する台がないスナップショット行は表示しません。最新ドキュメントの取得に使う `storeId`・`date` 降順の複合インデックスは `firestore.indexes.json` に定義しています。

ルート URL から利用できます。旧 `/agtmagtm/...` は新しいルートのパスへリダイレクトします。認可ルールは `firestore.rules`、Hosting とルールの参照は `firebase.json` で管理します。移行前の設定・ユーザー・ルールのローカルバックアップは Git 対象外の `backups/auth-migration-20261105/` にあります。バックアップには認証関連の機密情報を含むため、公開・コミットしないでください。

### 検証

```sh
# 画面・セッションの単体テスト
npm test -- --watchAll=false --runInBand

# 管理スクリプトの dry-run と出力制限
node --test scripts/manage-access.test.cjs

# Java 21 と Firebase CLI が必要。ローカルの demo プロジェクトだけで実行する
firebase emulators:exec --only firestore --config firebase.emulators.json --project demo-slot-diff-auth-tests "npm run test:rules"
```

### アクセス制限の範囲

- ブラウザからの読み取りは `slot_diff`、`tooltips`、使用中の `config` 2 件、`site777Snapshots` と大当たり履歴に限定します。
- ブラウザからの書き込みは既存 `slot_diff.data` の更新のみです。店舗・日付などのルート項目や台キーの追加・削除は禁止します。現在は任意の台キーを含む大きなマップのため、許可ユーザーが変更できる台データ内の項目を flag/comment のみに厳密制限することはできません。より細かな編集権限が必要な場合は、注釈を独立ドキュメントへ分離する必要があります。
- Admin SDK・サービスアカウントによる既存収集処理は Google Cloud IAM で認可され、Firestore Security Rules の対象外です。
- Hosting の JavaScript、フロアマップなどの静的ファイルや外部サイトの画像 URL 自体を非公開にする仕組みではありません。実データの認可は Firestore 側で実施します。

---

# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can’t go back!**

If you aren’t satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you’re on your own.

You don’t have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn’t feel obligated to use this feature. However we understand that this tool wouldn’t be useful if you couldn’t customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).
