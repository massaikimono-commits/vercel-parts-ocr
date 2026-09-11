# ICB-SPEC Next Revision Addendum — Deployment Governance / 共通インフラ運用

Status: REQUIRED FOR NEXT FORMAL ICB-SPEC REVISION
Date: 2026-09-11

## Deployment Governance / 共通インフラ運用

1. 通常のGitHub pushでVercel Deployment recordを生成してはならない。
2. Vercel Previewは総合管理GO時のみ、対象branch/HEADを確定して1回だけ明示的に作成する。
3. 小変更単位のPreview作成は禁止する。実機確認価値のあるまとまりでのみ作成する。
4. Preview GO前に直近24時間のVercel Deployment状況を監査する。
5. READYだけでなくCANCELED / ERROR / その他のDeployment recordも監査対象とする。
6. `vercel.json`、Git Integration、`git.deploymentEnabled`、`ignoreCommand`、Deploy Hook、Git auto deployment、Production Branch、Project Settings、Vercel CLI/API deployment方式の変更は総合管理承認を必須とする。
7. Deployment制御方式変更時は、旧方式確認 → 新方式確認 → 競合確認 → 旧方式撤去 → 実測確認の順序を必須とする。
8. 設定ファイルの確認だけではDeployment Safety PASSにしない。通常Git push後に新規Vercel Deployment recordが0件であることを実測して初めてPASSとする。
9. GitHub Integrationは原則維持する。連携維持のまま通常push→Deployment 0件を達成できないことが実証された場合のみDisconnectを検討する。
10. `git.deploymentEnabled=false` をVercel Git自動Deployment停止の単一制御とし、旧`ignoreCommand` / `[deploy]` markerによる二重制御は使用しない。
11. 意図しないDeployment recordを検知した場合、該当laneの追加pushを停止し、原因確定を優先する。
12. Vercel Production、Netlify Production、main merge、shared Supabase変更はそれぞれ明示的な総合管理GOがない限り実施しない。

## Management audit contract

総合管理開始時、およびPreview GO前に、ツールで確認可能な範囲で以下を確認する。

- Vercel Project状態
- 直近24時間Deployment件数
- READY / CANCELED / ERROR / その他の内訳
- Deployment発生branch / commit SHA
- Production target変更有無
- 現在の`vercel.json`
- Git Integration / Project Settings
- 通常push後の新規Deployment record 0件実測

このAddendumは次回正式ICB-SPEC改版時に本文へ統合する。
