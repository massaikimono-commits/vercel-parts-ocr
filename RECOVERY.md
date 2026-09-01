# Recovery

## Current layers

- Critical business rows are snapshotted before UPDATE or DELETE into `private.recovery_row_snapshots`.
- Row snapshots are retained for 180 days.
- Application users cannot directly read or modify the recovery snapshot table.
- Code rollback points are kept in Git history and the security snapshot branch.

## Platform backup

As checked on 2026-09-01, the Supabase project is on the Free plan.

The row-snapshot layer protects against accidental row changes, but it does not protect against loss of the entire Supabase project. A separate off-site logical database backup is therefore required until the backup plan changes.

Supabase database backups and logical dumps do not restore Storage object bytes. Vehicle-document images and PDFs need a separate Storage backup.

## Incident recovery order

1. Stop additional writes if they could make the incident worse.
2. Record the approximate incident time and affected customer/vehicle/work item.
3. For an accidental row update or deletion, inspect the private recovery snapshot and restore only the required data.
4. For database-wide loss, restore from the latest trusted off-site database backup or supported Supabase platform backup.
5. Restore Storage objects separately when needed.
6. Re-check authentication, RLS, API grants, Storage policies, and security headers.
7. Run the full regression suite and production build before reopening normal operation.

## Tables protected by row snapshots

- customers
- vehicles
- vehicle_documents
- work_orders
- schedule_entries
- parts
- part_receipts
- inspection_records
- completed_forms
- customer_booking_requests
- loaner_reservations

## Still to decide

Choose an approved off-site backup destination and frequency. If the project moves to a paid Supabase plan, evaluate daily backup retention and Point-in-Time Recovery separately.
