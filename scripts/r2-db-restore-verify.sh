#!/usr/bin/env bash
set -euo pipefail
umask 077

required_env=(R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ACCOUNT_ID R2_BUCKET_NAME)
for name in "${required_env[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "Missing required configuration: $name" >&2; exit 2; }
done
command -v docker >/dev/null 2>&1 || { echo "Docker is required." >&2; exit 2; }
command -v aws >/dev/null 2>&1 || { echo "AWS CLI is required." >&2; exit 2; }

WORKDIR="$(mktemp -d)"
CID=""
cleanup() { [[ -z "$CID" ]] || docker rm -f "$CID" >/dev/null 2>&1 || true; rm -rf "$WORKDIR"; }
trap cleanup EXIT
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

KEY="$(aws --endpoint-url "$ENDPOINT" s3api list-objects-v2 --bucket "$R2_BUCKET_NAME" --prefix database/ --query 'reverse(sort_by(Contents[?ends_with(Key, `.tar.gz`)], &LastModified))[0].Key' --output text)"
[[ -n "$KEY" && "$KEY" != "None" ]] || { echo "No R2 database backup found." >&2; exit 3; }
ARCHIVE="$WORKDIR/backup.tar.gz"
aws --endpoint-url "$ENDPOINT" s3 cp "s3://${R2_BUCKET_NAME}/${KEY}" "$ARCHIVE" --only-show-errors
aws --endpoint-url "$ENDPOINT" s3 cp "s3://${R2_BUCKET_NAME}/${KEY}.sha256" "$WORKDIR/backup.sha256" --only-show-errors
EXPECTED="$(awk '{print $1}' "$WORKDIR/backup.sha256")"
ACTUAL="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
[[ "$EXPECTED" == "$ACTUAL" ]] || { echo "Archive checksum mismatch." >&2; exit 4; }
mkdir "$WORKDIR/db"
tar -C "$WORKDIR/db" -xzf "$ARCHIVE"
(cd "$WORKDIR/db" && sha256sum -c SHA256SUMS)

# Supabase CLI intentionally excludes managed schemas (auth/storage/etc.) from schema.sql
# while data.sql can contain their rows. A pinned local Supabase image may therefore have
# a different managed-schema revision than the hosted project. Keep the complete data.sql
# in the backup, but isolate public-schema COPY blocks for deterministic app-data restore testing.
PUBLIC_DATA="$WORKDIR/db/public-data.sql"
awk '
  /^COPY public\./ { keep=1 }
  /^COPY / && $0 !~ /^COPY public\./ { keep=0 }
  keep { print }
  keep && /^\\\.$/ { keep=0 }
' "$WORKDIR/db/data.sql" > "$PUBLIC_DATA"
PUBLIC_COPY_COUNT="$(grep -c '^COPY public\.' "$PUBLIC_DATA" || true)"
[[ "$PUBLIC_COPY_COUNT" =~ ^[0-9]+$ && "$PUBLIC_COPY_COUNT" -gt 0 ]] || { echo "No public COPY blocks found in backup data." >&2; exit 5; }
MANAGED_COPY_COUNT="$(grep '^COPY ' "$WORKDIR/db/data.sql" | grep -vc '^COPY public\.' || true)"
echo "Backup data coverage: public COPY blocks=$PUBLIC_COPY_COUNT; managed-schema COPY blocks retained=$MANAGED_COPY_COUNT"

CID="$(docker run -d -e POSTGRES_PASSWORD=restoretest -e POSTGRES_DB=postgres public.ecr.aws/supabase/postgres:17.6.1.167)"
for _ in $(seq 1 90); do
  docker exec "$CID" pg_isready -U postgres -d postgres >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$CID" pg_isready -U postgres -d postgres >/dev/null

docker cp "$WORKDIR/db/schema.sql" "$CID:/tmp/schema.sql"
docker cp "$PUBLIC_DATA" "$CID:/tmp/public-data.sql"
SCHEMA_LOG="$WORKDIR/schema-restore.log"
if ! docker exec "$CID" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/schema.sql >"$SCHEMA_LOG" 2>&1; then
  echo "Schema restore failed. First PostgreSQL error context:" >&2
  grep -n -m1 -B4 -A8 -E '(^|[[:space:]])(ERROR|FATAL):|psql:.*ERROR:' "$SCHEMA_LOG" >&2 || tail -n 80 "$SCHEMA_LOG" >&2
  exit 6
fi

DATA_WRAPPER="$WORKDIR/public-data-restore-wrapper.sql"
printf '%s\n' 'SET session_replication_role = replica;' '\i /tmp/public-data.sql' 'SET session_replication_role = origin;' > "$DATA_WRAPPER"
docker cp "$DATA_WRAPPER" "$CID:/tmp/public-data-restore-wrapper.sql"
DATA_LOG="$WORKDIR/data-restore.log"
if ! docker exec "$CID" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/public-data-restore-wrapper.sql >"$DATA_LOG" 2>&1; then
  echo "Public data restore failed. First PostgreSQL error context:" >&2
  grep -n -m1 -B4 -A8 -E '(^|[[:space:]])(ERROR|FATAL):|psql:.*ERROR:' "$DATA_LOG" >&2 || tail -n 80 "$DATA_LOG" >&2
  exit 7
fi

TABLES="$(docker exec "$CID" psql -At -U postgres -d postgres -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")"
[[ "$TABLES" =~ ^[0-9]+$ && "$TABLES" -gt 0 ]] || { echo "No public tables restored." >&2; exit 8; }
INVALID="$(docker exec "$CID" psql -At -U postgres -d postgres -c "select count(*) from pg_constraint where contype='f' and not convalidated;")"
[[ "$INVALID" == "0" ]] || { echo "Unvalidated foreign keys remain: $INVALID" >&2; exit 9; }
echo "Isolated app restore verification PASS: $KEY; public tables=$TABLES; public COPY blocks=$PUBLIC_COPY_COUNT; managed-schema data preserved in archive=$MANAGED_COPY_COUNT"
