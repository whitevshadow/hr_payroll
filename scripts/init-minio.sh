#!/bin/sh
# MinIO service-account provisioning script.
# Runs once via the minio-init container (minio/mc image) before blobstore-service starts.
#
# What it does:
#   1. Waits for MinIO to be reachable using root credentials.
#   2. Creates the blobstore-svc IAM user (idempotent).
#   3. Writes and attaches a least-privilege S3 policy (no DeleteBucket, no IAM ops).
#
# Required env vars (injected by docker-compose from .env):
#   MINIO_ROOT_USER          MinIO root username  — used only here, never in application code
#   MINIO_ROOT_PASSWORD      MinIO root password  — same
#   MINIO_SERVICE_ACCESS_KEY blobstore-svc access key (= IAM username)
#   MINIO_SERVICE_SECRET_KEY blobstore-svc secret key (= IAM password), min 8 chars
#
# Production note: replace this script with your secrets-manager bootstrap
# (e.g. AWS Secrets Manager → ECS task IAM role, or Vault Agent sidecar).

set -eu

MINIO_INTERNAL_ENDPOINT="${MINIO_INTERNAL_ENDPOINT:-minio:9000}"
ALIAS="platform"
POLICY_NAME="blobstore-policy-v2"
POLICY_FILE="/tmp/blobstore-policy-v2.json"

# ── Wait for MinIO ────────────────────────────────────────────────────────────

echo "[init-minio] Waiting for MinIO at ${MINIO_INTERNAL_ENDPOINT}…"
until mc alias set "${ALIAS}" \
        "http://${MINIO_INTERNAL_ENDPOINT}" \
        "${MINIO_ROOT_USER}" \
        "${MINIO_ROOT_PASSWORD}" > /dev/null 2>&1; do
  echo "[init-minio] MinIO not ready — retrying in 3s…"
  sleep 3
done
echo "[init-minio] Connected to MinIO."

# ── Least-privilege policy ────────────────────────────────────────────────────
# Explicitly permits only the S3 operations the blobstore service uses.
# Notably absent: s3:DeleteBucket (archival uses tagging), s3:* wildcard,
# and all MinIO admin actions (mc admin user/policy/group).

cat > "${POLICY_FILE}" << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BucketLevelOps",
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:CreateBucket",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:ListBucketVersions",
        "s3:GetBucketVersioning",
        "s3:PutBucketVersioning",
        "s3:GetEncryptionConfiguration",
        "s3:PutEncryptionConfiguration",
        "s3:GetLifecycleConfiguration",
        "s3:PutLifecycleConfiguration",
        "s3:GetBucketTagging",
        "s3:PutBucketTagging"
      ],
      "Resource": ["arn:aws:s3:::*"]
    },
    {
      "Sid": "ObjectLevelOps",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:GetObjectVersion",
        "s3:DeleteObjectVersion"
      ],
      "Resource": ["arn:aws:s3:::*/*"]
    }
  ]
}
EOF

# Create or update the policy (mc admin policy create fails if it already exists).
mc admin policy create "${ALIAS}" "${POLICY_NAME}" "${POLICY_FILE}" 2>/dev/null \
  || mc admin policy info "${ALIAS}" "${POLICY_NAME}" > /dev/null 2>&1

# ── Create service account (idempotent) ───────────────────────────────────────

if mc admin user info "${ALIAS}" "${MINIO_SERVICE_ACCESS_KEY}" > /dev/null 2>&1; then
  echo "[init-minio] User '${MINIO_SERVICE_ACCESS_KEY}' already exists — skipping creation."
else
  mc admin user add "${ALIAS}" \
      "${MINIO_SERVICE_ACCESS_KEY}" \
      "${MINIO_SERVICE_SECRET_KEY}"
  echo "[init-minio] Created MinIO user '${MINIO_SERVICE_ACCESS_KEY}'."
fi

# ── Attach policy ─────────────────────────────────────────────────────────────

mc admin policy attach "${ALIAS}" "${POLICY_NAME}" \
    --user "${MINIO_SERVICE_ACCESS_KEY}" 2>/dev/null || true

echo "[init-minio] Policy '${POLICY_NAME}' attached to '${MINIO_SERVICE_ACCESS_KEY}'."
echo "[init-minio] Provisioning complete."
