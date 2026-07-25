from __future__ import annotations

import json
import socket
import subprocess
import tempfile
import time
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[2]
COMPOSE_FILE = ROOT_DIR / "docker-compose.standalone.yml"
PROJECT_NAME = "blobstore-int"


def _is_port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex(("127.0.0.1", port)) != 0


@pytest.fixture(scope="session")
def standalone_stack():
    required_ports = [4010, 5433, 9000, 9001]
    busy_ports = [port for port in required_ports if not _is_port_available(port)]
    if busy_ports:
        pytest.skip(
            "integration smoke skipped because required host ports are in use: "
            + ", ".join(str(p) for p in busy_ports)
        )

    override_content = """
services:
    blobstore:
        ports: []
    postgres:
        ports: []
    minio:
        ports: []
""".strip()

    with tempfile.NamedTemporaryFile(mode="w", suffix=".yml", delete=False, encoding="utf-8") as temp_override:
        temp_override.write(override_content)
        override_path = Path(temp_override.name)

    compose_cmd = [
        "docker",
        "compose",
        "-p",
        PROJECT_NAME,
        "-f",
        str(COMPOSE_FILE),
        "-f",
        str(override_path),
    ]

    def _run(cmd: list[str]):
        result = subprocess.run(
            cmd,
            cwd=ROOT_DIR,
            capture_output=True,
            text=False,
            check=False,
        )
        if result.returncode != 0:
            stdout_text = result.stdout.decode("utf-8", errors="replace")
            stderr_text = result.stderr.decode("utf-8", errors="replace")
            raise RuntimeError(
                f"Command failed: {' '.join(cmd)}\nSTDOUT:\n{stdout_text}\nSTDERR:\n{stderr_text}"
            )

    subprocess.run(
        [*compose_cmd, "down", "-v", "--remove-orphans"],
        cwd=ROOT_DIR,
        capture_output=True,
        text=False,
        check=False,
    )

    for container_name in ("blobstore", "blobstore-minio", "blobstore-postgres"):
        subprocess.run(
            ["docker", "rm", "-f", container_name],
            cwd=ROOT_DIR,
            capture_output=True,
            text=False,
            check=False,
        )

    try:
        _run([*compose_cmd, "up", "-d", "--build"])
    except RuntimeError as exc:
        message = str(exc)
        if "port is already allocated" in message.lower() or "bind for" in message.lower():
            pytest.skip("integration smoke skipped because required Docker host ports are already allocated")
        raise

    timeout_seconds = 180
    deadline = time.time() + timeout_seconds
    last_error = None

    while time.time() < deadline:
        try:
            result = subprocess.run(
                [
                    *compose_cmd,
                    "exec",
                    "-T",
                    "blobstore",
                    "curl",
                    "-sf",
                    "http://localhost:4010/health",
                ],
                cwd=ROOT_DIR,
                capture_output=True,
                text=False,
                check=False,
            )
            if result.returncode == 0:
                payload = json.loads(result.stdout.decode("utf-8", errors="replace"))
                if payload.get("status") == "ok":
                    break
                last_error = f"health not ready yet: {payload}"
            else:
                stderr_text = result.stderr.decode("utf-8", errors="replace")
                last_error = stderr_text or f"curl exit code {result.returncode}"
        except (TimeoutError, OSError, ValueError) as exc:
            last_error = str(exc)
        time.sleep(3)
    else:
        raise RuntimeError(
            f"Standalone stack did not become healthy within {timeout_seconds}s. Last error: {last_error}"
        )

    try:
        yield compose_cmd
    finally:
        subprocess.run(
            [*compose_cmd, "down", "-v", "--remove-orphans"],
            cwd=ROOT_DIR,
            capture_output=True,
            text=False,
            check=False,
        )
        try:
            override_path.unlink(missing_ok=True)
        except Exception:
            pass


@pytest.mark.integration
def test_standalone_health_endpoint(standalone_stack):
    compose_cmd = standalone_stack
    result = subprocess.run(
        [*compose_cmd, "exec", "-T", "blobstore", "curl", "-sf", "http://localhost:4010/health"],
        cwd=ROOT_DIR,
        capture_output=True,
        text=False,
        check=False,
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")
    payload = json.loads(result.stdout.decode("utf-8", errors="replace"))

    assert payload["status"] == "ok"
    assert payload["postgres"] == "ok"
    assert payload["minio"] == "ok"
    assert payload["kafka_enabled"] is False
    assert payload["kafka"] == "disabled"
