"""
MinIO credential hygiene tests.

Verifies that:
1. The startup guard rejects empty credentials.
2. The startup guard rejects every known-bad default value (minioadmin etc.).
3. The startup guard rejects secrets shorter than MinIO's 8-char minimum.
4. Valid service account credentials pass the guard.
5. config.py has no hardcoded "minioadmin" default — the default must be "".
6. docker-compose.yml references no literal "minioadmin" string.
7. .env.example references no literal "minioadmin" string.

Tests 6 and 7 are static file checks — they catch regressions where someone
adds a hardcoded default back to a config file.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from unittest.mock import patch

import pytest

# ---------------------------------------------------------------------------
# Locate repo root relative to this test file
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parents[3]  # services/blobstore-service/tests/../../../
_COMPOSE_FILE = _REPO_ROOT / "docker-compose.yml"
_ROOT_ENV_EXAMPLE = _REPO_ROOT / ".env.example"
_BLOBSTORE_ENV_EXAMPLE = (
    _REPO_ROOT / "services" / "blobstore-service" / ".env.example"
)
_CONFIG_PY = (
    _REPO_ROOT / "services" / "blobstore-service" / "app" / "config.py"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _patch_creds(access_key: str, secret_key: str):
    """Return a context manager that overrides MINIO credentials in settings."""
    return patch.multiple(
        "app.storage.minio_client.settings",
        MINIO_ACCESS_KEY=access_key,
        MINIO_SECRET_KEY=secret_key,
    )


# ---------------------------------------------------------------------------
# Startup guard — _assert_service_credentials
# ---------------------------------------------------------------------------

from app.storage.minio_client import _assert_service_credentials  # noqa: E402


@pytest.mark.parametrize("key,secret,match", [
    ("", "validpassword123", "must be set"),
    ("blobstore-svc", "", "must be set"),
    ("minioadmin", "validpassword123", "Forbidden"),
    ("blobstore-svc", "minioadmin", "Forbidden"),
    ("minioadmin", "minioadmin", "Forbidden"),
    ("minioadmin123", "validpassword123", "Forbidden"),
    ("admin", "validpassword123", "Forbidden"),
    ("blobstore-svc", "short", "at least 8 characters"),
])
def test_guard_rejects_bad_credentials(key: str, secret: str, match: str):
    """Every known-bad credential combination must be rejected at startup."""
    with _patch_creds(key, secret):
        with pytest.raises(RuntimeError, match=match):
            _assert_service_credentials()


def test_guard_accepts_valid_service_credentials():
    """A proper service account with a strong secret must pass the guard."""
    with _patch_creds("blobstore-svc", "correct-horse-battery-staple-99"):
        _assert_service_credentials()  # must not raise


def test_guard_accepts_uuid_style_credentials():
    """UUIDs are a common pattern for auto-generated access keys."""
    import uuid
    key = f"svc-{uuid.uuid4().hex[:12]}"
    secret = uuid.uuid4().hex  # 32 hex chars
    with _patch_creds(key, secret):
        _assert_service_credentials()


# ---------------------------------------------------------------------------
# config.py static check — no hardcoded "minioadmin" default
# ---------------------------------------------------------------------------

def test_config_py_has_no_minioadmin_default():
    """
    config.py must not contain 'minioadmin' as a literal string.
    The default for MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be empty string.
    """
    content = _CONFIG_PY.read_text(encoding="utf-8")
    assert "minioadmin" not in content, (
        f"{_CONFIG_PY} still contains the literal string 'minioadmin'. "
        "Remove it — defaults must be empty so the startup guard fires."
    )


def test_config_py_defaults_are_empty_string():
    """MINIO_ACCESS_KEY and MINIO_SECRET_KEY defaults must be '' not 'minioadmin'."""
    content = _CONFIG_PY.read_text(encoding="utf-8")
    # Match lines like: MINIO_ACCESS_KEY: str = "minioadmin"
    bad = re.findall(r'MINIO_(ACCESS|SECRET)_KEY\s*:\s*str\s*=\s*"[^"]+"', content)
    assert not bad, (
        f"Found non-empty defaults for MINIO credentials in config.py: {bad}"
    )


# ---------------------------------------------------------------------------
# docker-compose.yml static check — no literal minioadmin
# ---------------------------------------------------------------------------

def test_compose_has_no_literal_minioadmin():
    """
    docker-compose.yml must not contain the literal string 'minioadmin'.
    Root credentials must be env-var references (${MINIO_ROOT_USER:?...}).
    """
    content = _COMPOSE_FILE.read_text(encoding="utf-8")
    assert "minioadmin" not in content, (
        "docker-compose.yml still contains the literal string 'minioadmin'. "
        "Replace with ${MINIO_ROOT_USER:?...} / ${MINIO_ROOT_PASSWORD:?...}."
    )


def test_compose_root_creds_use_env_var_substitution():
    """
    MINIO_ROOT_USER and MINIO_ROOT_PASSWORD must use ${VAR:?err} substitution,
    which causes docker compose to fail fast if the variable is unset.
    """
    content = _COMPOSE_FILE.read_text(encoding="utf-8")
    assert "${MINIO_ROOT_USER:?" in content, (
        "MINIO_ROOT_USER must use required-variable syntax: ${MINIO_ROOT_USER:?err}"
    )
    assert "${MINIO_ROOT_PASSWORD:?" in content, (
        "MINIO_ROOT_PASSWORD must use required-variable syntax: ${MINIO_ROOT_PASSWORD:?err}"
    )


def test_compose_blobstore_does_not_receive_root_creds():
    """
    The blobstore-service environment block must not reference MINIO_ROOT_USER
    or MINIO_ROOT_PASSWORD — only the minio and minio-init services may use them.
    """
    content = _COMPOSE_FILE.read_text(encoding="utf-8")
    # Find the blobstore-service block (between 'blobstore-service:' and the next top-level key)
    blobstore_match = re.search(
        r"blobstore-service:(.*?)(?=\n  \w)", content, re.DOTALL
    )
    assert blobstore_match, "Could not locate blobstore-service block in docker-compose.yml"
    blobstore_block = blobstore_match.group(1)
    assert "MINIO_ROOT_USER" not in blobstore_block, (
        "blobstore-service block must not reference MINIO_ROOT_USER"
    )
    assert "MINIO_ROOT_PASSWORD" not in blobstore_block, (
        "blobstore-service block must not reference MINIO_ROOT_PASSWORD"
    )


def test_compose_has_minio_init_service():
    """minio-init provisioner service must exist in docker-compose.yml."""
    content = _COMPOSE_FILE.read_text(encoding="utf-8")
    assert "minio-init:" in content, (
        "minio-init service is missing from docker-compose.yml. "
        "It provisions the least-privilege service account before blobstore starts."
    )


def test_compose_blobstore_depends_on_minio_init():
    """blobstore-service must wait for minio-init to complete successfully."""
    content = _COMPOSE_FILE.read_text(encoding="utf-8")
    assert "service_completed_successfully" in content, (
        "blobstore-service depends_on minio-init must use "
        "condition: service_completed_successfully"
    )


# ---------------------------------------------------------------------------
# .env.example static checks — no literal minioadmin
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("env_file", [_ROOT_ENV_EXAMPLE, _BLOBSTORE_ENV_EXAMPLE])
def test_env_example_has_no_minioadmin(env_file: Path):
    """
    Example env files must not suggest 'minioadmin' as a credential value.
    They are committed to git and serve as documentation; bad examples become bad defaults.
    """
    content = env_file.read_text(encoding="utf-8")
    assert "minioadmin" not in content, (
        f"{env_file.name} still contains 'minioadmin'. "
        "Replace with CHANGE_ME placeholder values."
    )


def test_root_env_example_documents_all_minio_vars():
    """Root .env.example must document all four MinIO-related variables."""
    content = _ROOT_ENV_EXAMPLE.read_text(encoding="utf-8")
    required_vars = [
        "MINIO_ROOT_USER",
        "MINIO_ROOT_PASSWORD",
        "MINIO_SERVICE_ACCESS_KEY",
        "MINIO_SERVICE_SECRET_KEY",
    ]
    missing = [v for v in required_vars if v not in content]
    assert not missing, (
        f".env.example is missing documentation for: {missing}"
    )


# ---------------------------------------------------------------------------
# IAM policy content check (init-minio.sh)
# ---------------------------------------------------------------------------

def test_init_script_has_no_delete_bucket_permission():
    """
    The least-privilege policy in init-minio.sh must not grant s3:DeleteBucket.
    Bucket archival uses tagging; permanent deletion is a separate, guarded operation.
    """
    script = (_REPO_ROOT / "scripts" / "init-minio.sh").read_text(encoding="utf-8")
    assert "s3:DeleteBucket" not in script, (
        "init-minio.sh grants s3:DeleteBucket — remove it. "
        "Bucket archival should use tagging (s3:PutBucketTagging), not deletion."
    )


def test_init_script_has_no_wildcard_action():
    """The IAM policy must not use s3:* — every action must be explicitly listed."""
    script = (_REPO_ROOT / "scripts" / "init-minio.sh").read_text(encoding="utf-8")
    assert '"s3:*"' not in script, (
        "init-minio.sh grants s3:* wildcard — replace with explicit action list."
    )


def test_init_script_has_no_admin_actions():
    """No admin-level actions (mc admin user/policy/group) must appear in the policy JSON."""
    script = (_REPO_ROOT / "scripts" / "init-minio.sh").read_text(encoding="utf-8")
    # The policy JSON block is between the heredoc markers.
    policy_match = re.search(r"<<\s*'EOF'\s*(.*?)\s*EOF", script, re.DOTALL)
    assert policy_match, "Could not locate policy JSON heredoc in init-minio.sh"
    policy_json = policy_match.group(1)
    assert "admin" not in policy_json.lower(), (
        "Policy JSON in init-minio.sh contains admin-level actions"
    )
