#!/usr/bin/env bash
set -euo pipefail
umask 077

required_env=(SUPABASE_DB_URL R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ACCOUNT_ID R2_BUCKET_NAME)
for name in "${required_env[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "Missing required configuration: $name" >&2; exit 2; }
done

command -v docker >/dev/null 2>&1 || { echo "Docker is required." >&2; exit 2; }
command -v aws >/dev/null 2>&1 || { echo "AWS CLI is required." >&2; exit 2; }

STAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
DAY="$(date -u +'%Y/%m/%d')"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
DBDIR="$WORKDIR/database"
mkdir -p "$DBDIR"

echo "Creating Supabase logical database dump..."
npx --yes supabase db dump --db-url "$SUPABASE_DB_URL" -f "$DBDIR/roles.sql" --role-only
npx --yes supabase db dump --db-url "$SUPABASE_DB_URL" -f "$DBDIR/schema.sql"
npx --yes supabase db dump --db-url "$SUPABASE_DB_URL" -f "$DBDIR/data.sql" --use-copy --data-only

for file in roles.sql schema.sql data.sql; do
  [[ -s "$DBDIR/$file" ]] || { echo "Backup dump is empty: $file" >&2; exit 3; }
done
(
  cd "$DBDIR"
  sha256sum roles.sql schema.sql data.sql > SHA256SUMS
  sha256sum -c SHA256SUMS
)

ARCHIVE="$WORKDIR/icb-supabase-$STAMP.tar.gz"
tar -C "$DBDIR" -czf "$ARCHIVE" roles.sql schema.sql data.sql SHA256SUMS
tar -tzf "$ARCHIVE" >/dev/null
ARCHIVE_SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
printf '%s  %s\n' "$ARCHIVE_SHA" "$(basename "$ARCHIVE")" > "$ARCHIVE.sha256"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
KEY="database/${DAY}/$(basename "$ARCHIVE")"
SHA_KEY="${KEY}.sha256"

aws --endpoint-url "$ENDPOINT" s3 cp "$ARCHIVE" "s3://${R2_BUCKET_NAME}/${KEY}" --only-show-errors
aws --endpoint-url "$ENDPOINT" s3 cp "$ARCHIVE.sha256" "s3://${R2_BUCKET_NAME}/${SHA_KEY}" --only-show-errors

LOCAL_SIZE="$(stat -c%s "$ARCHIVE")"
REMOTE_SIZE="$(aws --endpoint-url "$ENDPOINT" s3api head-object --bucket "$R2_BUCKET_NAME" --key "$KEY" --query ContentLength --output text)"
[[ "$LOCAL_SIZE" == "$REMOTE_SIZE" ]] || { echo "R2 size verification failed." >&2; exit 4; }

# Download the uploaded objects back from R2 and verify integrity independently.
VERIFY="$WORKDIR/verify"
mkdir -p "$VERIFY"
aws --endpoint-url "$ENDPOINT" s3 cp "s3://${R2_BUCKET_NAME}/${KEY}" "$VERIFY/$(basename "$ARCHIVE")" --only-show-errors
aws --endpoint-url "$ENDPOINT" s3 cp "s3://${R2_BUCKET_NAME}/${SHA_KEY}" "$VERIFY/$(basename "$ARCHIVE").sha256" --only-show-errors
(
  cd "$VERIFY"
  sha256sum -c "$(basename "$ARCHIVE").sha256"
  tar -tzf "$(basename "$ARCHIVE")" >/dev/null
)

echo "R2 database backup verified successfully: $KEY"
