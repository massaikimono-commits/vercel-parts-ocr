# 部品伝票OCR・印刷 完成版

## 実装済み
1. 車体番号・型式・EV/ガソリン/HV・重量の保存/検索
2. iPhoneカメラで部品伝票を撮影
3. 1回の撮影から複数部品を候補抽出
4. 部品名称・個数・定価・仕入れを画面で修正
5. ブラウザ保存
6. Excelへ貼り付けるタブ区切りコピー
7. CSV保存
8. 添付された「部品出庫伝票」の写真をガイドにして印刷位置を設定
9. 印刷時は背景写真を印刷せず、4項目だけをA4用紙へ重ね刷り
10. Vercelへデプロイ可能

## Vercel
GitHubリポジトリのルートにこの一式を置き、VercelでImportしてください。
Build Command: `npm run build`
Install Command: `npm install`
Framework: Next.js

## 印刷位置
⑤印刷位置設定で実物の用紙写真を読み込みます。
X/Y/W/Hはmmです。最初はコピー用紙でテストし、実物用紙に重ねて微調整してください。

今回の添付写真は実物を撮影した写真なので、初期値は仮位置です。
用紙の既存文字と自動照合して該当行へ配置する機能は、次の段階で追加できます。

## OCR注意
Tesseract.jsの日本語OCRをブラウザで使用します。初回は日本語データの読み込みで時間がかかる場合があります。
OCRは必ず人が確認してから印刷してください。表形式の伝票では数字列の修正が必要になる場合があります。

## 次に追加すると完成度が上がる機能
- 伝票の表の列を認識して4項目を自動分類
- 用紙に印刷されている部品名を自動認識し、同じ部品名の行へ自動配置
- 左右2段の記録簿レイアウトを自動判定
- Supabaseで複数端末から共有


## Supabase
Set these Vercel environment variables:
- NEXT_PUBLIC_SUPABASE_URL=https://adrsyflidfjqeqcndeqd.supabase.co
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
