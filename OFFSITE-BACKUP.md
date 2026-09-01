# Off-site backup

This backup layer protects against loss of the entire Supabase project. It is separate from the in-database recovery snapshots documented in `RECOVERY.md`.

Supabase recommends that Free-plan projects regularly export their database and keep an off-site copy. Supabase database backups contain Storage metadata but not the Storage object bytes, so Storage files must be copied separately.

## Design

The workflow in `.github/workflows/offsite-backup.yml` is dormant until it is enabled.

When enabled it runs daily at 04:30 JST and:

1. Uses the Supabase CLI `db dump` flow to export roles, schema, and data.
2. Creates SHA-256 checksums and a compressed database archive.
3. Reads all Supabase Storage buckets through the server-side S3-compatible endpoint.
4. Writes both database and Storage backups to a separate S3-compatible provider.
5. Uses an rclone crypt layer so object contents and filenames are encrypted before they leave the GitHub runner.
6. Keeps a restore-ready `storage/current` mirror.
7. Moves overwritten/deleted Storage objects into timestamped `storage/versions` paths before syncing.
8. Runs a size-based verification of each Storage mirror.
9. Uploads a small encrypted manifest for every successful backup.

The workflow never uploads customer data to GitHub Actions artifacts.

## Required repository variable

Set this only after the destination and secrets are configured:

- `OFFSITE_BACKUP_ENABLED=true`

Until then the scheduled job is skipped.

## Required repository variables

- `SUPABASE_S3_ENDPOINT`
  - Managed Supabase format: `https://<project-ref>.storage.supabase.co/storage/v1/s3`
- `SUPABASE_S3_REGION`
  - Current project region: `ap-northeast-1`
- `OFFSITE_S3_ENDPOINT`
  - The private destination S3-compatible endpoint.
- `OFFSITE_S3_REGION`
- `OFFSITE_S3_BUCKET`
  - A bucket dedicated to encrypted ICB backups.

AWS S3, Cloudflare R2, Backblaze B2, and other compatible S3 services can be used as the destination as long as the endpoint supports normal object listing/upload operations.

## Required GitHub Actions secrets

- `SUPABASE_DB_URL`
  - Use the database connection string supplied by Supabase Connect. Prefer a supported session-pooler/direct connection that works from GitHub Actions.
- `SUPABASE_S3_ACCESS_KEY_ID`
- `SUPABASE_S3_SECRET_ACCESS_KEY`
  - Supabase-generated S3 keys are server-side credentials with full Storage access and bypass Storage RLS. Never put them in browser code, repository files, or ordinary environment files.
- `OFFSITE_S3_ACCESS_KEY_ID`
- `OFFSITE_S3_SECRET_ACCESS_KEY`
  - The destination credential should be restricted to the dedicated backup bucket only.
- `OFFSITE_CRYPT_PASSWORD`
- `OFFSITE_CRYPT_SALT`
  - Long independent random values used by the client-side encryption layer.

## Destination security requirements

The off-site bucket should:

- be private;
- deny public access;
- use an account separate from the Supabase project where practical;
- use a credential restricted to this backup bucket;
- enable provider-side versioning or object protection if available;
- use MFA for the provider account;
- have billing/usage alerts so an unexpected backup-size spike is noticed.

The rclone crypt layer means the provider stores encrypted filenames and encrypted object content.

## Restore order

For a full Supabase loss:

1. Create or choose the replacement Supabase project.
2. Restore the database dump using Supabase's documented restore procedure.
3. Recreate any non-database platform settings that are not in a logical dump.
4. Generate temporary S3 credentials for the replacement Storage service.
5. Copy the required encrypted backup through rclone's crypt remote into the replacement Storage buckets.
6. Re-check bucket privacy and Storage RLS.
7. Run `supabase/security-posture.sql` against the restored database.
8. Run the full application regression/build suite.
9. Test login, customer/vehicle search, OCR, record creation, printing, and schedule workflows before normal use resumes.

Do not perform an untested full restore directly over the active production project. Restore drills should use a separate test project first.

## Retention

The database-side recovery snapshots and login-security events are already capped at 180 days.

Off-site retention is intentionally not hard-coded in the workflow because destination providers differ and Storage version history should not be deleted accidentally. Configure destination retention only after the chosen provider is finalized and a restore drill has succeeded.
