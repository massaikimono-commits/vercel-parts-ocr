#!/usr/bin/env bash
set -euo pipefail
umask 077

required_env=(
  SUPABASE_DB_URL
  SUPABASE_S3_ENDPOINT
  SUPABASE_S3_REGION
  SUPABASE_S3_ACCESS_KEY_ID
  SUPABASE_S3_SECRET_ACCESS_KEY
  OFFSITE_S3_ENDPOINT
  OFFSITE_S3_REGION
  OFFSITE_S3_BUCKET
  OFFSITE_S3_ACCESS_KEY_ID
  OFFSITE_S3_SECRET_ACCESS_KEY
  OFFSITE_CRYPT_PASSWORD
  OFFSITE_CRYPT_SALT
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required backup configuration: $name" >&2
    exit 2
  fi
done

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required because Supabase CLI db dump uses it." >&2
  exit 2
}
command -v rclone >/dev/null 2>&1 || {
  echo "rclone is required." >&2
  exit 2
}

STAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

DBDIR="$WORKDIR/database"
mkdir -p "$DBDIR"

echo "Creating Supabase logical database dump..."
npx --yes supabase db dump --db-url "$SUPABASE_DB_URL" -f "$DBDIR/roles.sql" --role-only
npx --yes supabase db dump --db-url "$SUPABASE_DB_URL" -f "$DBDIR/schema.sql"
npx --yes supabase db dump --db-url "$SUPABASE_DB_URL" -f "$DBDIR/data.sql" --use-copy --data-only

(
  cd "$DBDIR"
  sha256sum roles.sql schema.sql data.sql > SHA256SUMS
)

ARCHIVE="$WORKDIR/icb-db-$STAMP.tar.gz"
tar -C "$DBDIR" -czf "$ARCHIVE" roles.sql schema.sql data.sql SHA256SUMS
ARCHIVE_SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
printf '%s  %s\n' "$ARCHIVE_SHA" "$(basename "$ARCHIVE")" > "$WORKDIR/icb-db-$STAMP.tar.gz.sha256"

RCLONE_CONFIG="$WORKDIR/rclone.conf"
SUPABASE_SECRET_OBSCURED="$(rclone obscure "$SUPABASE_S3_SECRET_ACCESS_KEY")"
OFFSITE_SECRET_OBSCURED="$(rclone obscure "$OFFSITE_S3_SECRET_ACCESS_KEY")"
CRYPT_PASSWORD_OBSCURED="$(rclone obscure "$OFFSITE_CRYPT_PASSWORD")"
CRYPT_SALT_OBSCURED="$(rclone obscure "$OFFSITE_CRYPT_SALT")"

cat > "$RCLONE_CONFIG" <<EOF
[supabase]
type = s3
provider = Other
access_key_id = $SUPABASE_S3_ACCESS_KEY_ID
secret_access_key = $SUPABASE_SECRET_OBSCURED
endpoint = $SUPABASE_S3_ENDPOINT
region = $SUPABASE_S3_REGION
force_path_style = true

[offsite]
type = s3
provider = Other
access_key_id = $OFFSITE_S3_ACCESS_KEY_ID
secret_access_key = $OFFSITE_SECRET_OBSCURED
endpoint = $OFFSITE_S3_ENDPOINT
region = $OFFSITE_S3_REGION
force_path_style = true

[vault]
type = crypt
remote = offsite:$OFFSITE_S3_BUCKET/icb-backups
filename_encryption = standard
directory_name_encryption = true
password = $CRYPT_PASSWORD_OBSCURED
password2 = $CRYPT_SALT_OBSCURED
EOF
chmod 600 "$RCLONE_CONFIG"

RCLONE=(rclone --config "$RCLONE_CONFIG")

echo "Uploading encrypted database archive..."
"${RCLONE[@]}" copyto "$ARCHIVE" "vault:database/$(basename "$ARCHIVE")"
"${RCLONE[@]}" copyto "$WORKDIR/icb-db-$STAMP.tar.gz.sha256" "vault:database/icb-db-$STAMP.tar.gz.sha256"

echo "Discovering Supabase Storage buckets..."
mapfile -t BUCKETS < <("${RCLONE[@]}" lsf "supabase:" --dirs-only | sed 's:/$::' | sed '/^$/d')

if [[ ${#BUCKETS[@]} -eq 0 ]]; then
  echo "No Supabase Storage buckets found."
else
  for bucket in "${BUCKETS[@]}"; do
    echo "Backing up Storage bucket: $bucket"
    # The current mirror stays restore-ready. Anything overwritten or deleted
    # from Supabase is moved into a timestamped encrypted versions directory.
    "${RCLONE[@]}" sync       "supabase:$bucket"       "vault:storage/current/$bucket"       --backup-dir "vault:storage/versions/$STAMP/$bucket"       --create-empty-src-dirs

    echo "Verifying Storage mirror by file size: $bucket"
    "${RCLONE[@]}" check       "supabase:$bucket"       "vault:storage/current/$bucket"       --one-way       --size-only
  done
fi

cat > "$WORKDIR/backup-summary.txt" <<EOF
backup_timestamp_utc=$STAMP
database_archive=$(basename "$ARCHIVE")
database_archive_sha256=$ARCHIVE_SHA
storage_bucket_count=${#BUCKETS[@]}
storage_buckets=${BUCKETS[*]:-}
EOF

"${RCLONE[@]}" copyto "$WORKDIR/backup-summary.txt" "vault:manifests/backup-$STAMP.txt"

echo "Encrypted off-site backup completed: $STAMP"
