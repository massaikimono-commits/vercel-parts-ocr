# ICB 保留修正台帳

この台帳は、保留中の修正と、保留から実装済みへ移行した履歴を「削除・忘却」せず管理するためのものです。
**状態=保留** の項目だけが将来対応対象です。実装済み項目は再実装せず、現在仕様の参照履歴として残します。

## 保留修正 #001 — 法定3ヶ月点検対応

- **項目名:** 法定3ヶ月点検対応
- **状態:** 保留
- **保留理由:** `legal_3m` の追加には本体 Supabase DB の `inspection_schedule_type` CHECK 制約変更が必要。現在 Netlify 本番を再デプロイできないため、稼働中の Netlify コードと新DB仕様の不整合を避ける。
- **解除条件:** Netlify 本番が再デプロイ可能になること。
- **解除後に実施する内容:**
  1. 本体 Supabase DB で `legal_3m` を許可
  2. 予定登録画面へ「法定3ヶ月点検」を追加
  3. 必要な編集画面等にも同じ点検区分を追加
  4. 日報の入庫要因「（ ）」欄へ黒文字で `3` を印字
  5. main / Netlify 本番コードとDB仕様を整合
  6. 既存データへの影響確認
  7. 本番テスト
- **関連するDB変更:** `work_orders.inspection_schedule_type` 等の CHECK 制約に `legal_3m` を追加。関連テーブル/関数にも同制約があれば同時確認。
- **関連する画面・機能:** 予定登録、必要な予定編集、日報印刷、点検区分を参照する関連機能。
- **本番反映時の確認事項:** 稼働中コードとの互換性、既存データ、登録/編集/日報表示、main と Netlify の同時整合、回帰テスト。
- **最終仕様:** DB値=`legal_3m` / 表示名=「法定3ヶ月点検」 / 日報コード=`3`


## 実装済み #002 — 来社「作業待ち」対応

- **項目名:** 来社「作業待ち」
- **状態:** 実装済み（ICB-SPEC v1.2 / shared Supabase反映済み）
- **正式フィールド:** `public.work_orders.is_waiting_service boolean NOT NULL DEFAULT false`
- **適用migration:** `add_waiting_service_visit_rules_v12`
- **対象条件:** `reason=点検` AND `entry_type=customer_visit` のみ。車検の作業待ちは通常仕様として扱わず、ごく稀な例外運用は別途判断する。
- **保存ルール:** 備考 / status / work state / delivery_completed / checked_in_at / stay_reason を流用しない。既存データからの推測backfillも行わない。
- **動作:** 作業待ちONでは納車予定を持たず、関連deliveryを残さず、滞留車両から除外し、日報は「来社待ち」と表示する。
- **通常来社:** `is_waiting_service=false` の点検来社は従来の業務ルールどおり扱う。
- **再対応禁止:** 専用booleanを別フィールドへ置換したり、車検へ通常拡張したりしない。


## 実装済み #003 — 作業待ち来社の exact-time 重複警告

- **項目名:** 点検 × 来社 × 作業待ち × exact × 同一開始時刻の重複警告
- **状態:** 実装済み（ICB-SPEC v1.2 / shared Supabase反映済み）
- **正式条件:** 双方がすべて `reason=点検` / `entry_type=customer_visit` / `is_waiting_service=true` / `print_time_mode=exact` を満たし、`starts_at` が完全一致する場合だけ警告する。
- **警告しない例:** 点検作業待ち × 車検来社、点検作業待ち × 点検通常来社、車検来社 × 車検来社、引取、納車、出張、A中 / 中 / 午前中 / 午後中などのbroad-time。
- **旧仕様の扱い:** 以前の「同じentry_typeのexact重複」および途中段階の「exact来社×来社」案はv1.2で廃止。現在の作業待ち専用条件を正とする。
- **来社集計との分離:** トップ/週間/月間の来社件数・時間は `reason=点検 AND entry_type=customer_visit` を集計し、作業待ちtrue/falseは集計条件にしない。重複警告条件とは別仕様。

### 2026-09-08 — Waiting-service v1.3 formal override
- This section supersedes the v1.2 reason-limited waiting-service rule.
- `is_waiting_service=true` is valid for every `customer_visit` regardless of reason: 点検 / 車検 / 一般整備 / 板金塗装.
- Pickup, onsite repair, and delivery cannot use waiting-service. Leaving customer_visit clears the UI flag.
- Waiting-service has no delivery plan/entry, is excluded from staying vehicles, body-shop vehicles, and planned deliveries, and remains labeled `来社待ち` in the daily report.
- Exact-time duplicate warning is reason-independent: both entries must be customer_visit + waiting-service + exact + identical start time. Warning text: `来社・作業待ちが同じ時刻に重複しています`.
- No new column and no backfill. Migration source: `database/waiting-service-customer-visit-v13.sql`.
