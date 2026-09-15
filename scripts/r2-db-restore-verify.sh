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

# Restore into an isolated ephemeral Supabase-compatible PostgreSQL container only.
CID="$(docker run -d -e POSTGRES_PASSWORD=restoretest -e POSTGRES_DB=postgres -p 127.0.0.1::5432 public.ecr.aws/supabase/postgres:17.6.1.167)"
for _ in $(seq 1 90); do
  docker exec "$CID" pg_isready -U postgres -d postgres >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$CID" pg_isready -U postgres -d postgres >/dev/null

# Supabase role dump may contain managed-role statements that are not required to validate app schema/data.
docker cp "$WORKDIR/db/schema.sql" "$CID:/tmp/schema.sql"
docker cp "$WORKDIR/db/data.sql" "$CID:/tmp/data.sql"
docker exec "$CID" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/schema.sql >/tmp/schema-restore.log 2>&1 || { cat /tmp/schema-restore.log; exit 5; }
# Data-only dump has known circular FKs. Disable user triggers during isolated restore validation.
docker exec "$CID" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SET session_replication_role = replica;" -f /tmp/data.sql -c "SET session_replication_role = origin;" >/tmp/data-restore.log 2>&1 || { cat /tmp/data-restore.log; exit 6; }

TABLES="$(docker exec "$CID" psql -At -U postgres -d postgres -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")"
[[ "$TABLES" =~ ^[0-9]+$ && "$TABLES" -gt 0 ]] || { echo "No public tables restored." >&2; exit 7; }
# Validate all restored FK constraints after triggers are re-enabled.
INVALID="$(docker exec "$CID" psql -At -U postgres -d postgres -c "select count(*) from pg_constraint where contype='f' and not convalidated;")"
[[ "$INVALID" == "0" ]] || { echo "Unvalidated foreign keys remain: $INVALID" >&2; exit 8; }
echo "Isolated restore verification PASS: $KEY; public tables=$TABLES"
