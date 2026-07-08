from __future__ import annotations

import pytest

from app import main


class _AsyncConnection:
    async def execute(self, *_args, **_kwargs):
        return None


class _AsyncConnectionContext:
    def __init__(self, should_fail: bool = False):
        self.should_fail = should_fail

    async def __aenter__(self):
        if self.should_fail:
            raise RuntimeError("db unavailable")
        return _AsyncConnection()

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeEngine:
    def __init__(self, outcomes: list[bool] | None = None, events: list[str] | None = None):
        self._outcomes = outcomes or [False]
        self._idx = 0
        self._events = events

    def connect(self):
        should_fail = self._outcomes[min(self._idx, len(self._outcomes) - 1)]
        self._idx += 1
        return _AsyncConnectionContext(should_fail=should_fail)

    async def dispose(self):
        if self._events is not None:
            self._events.append("dispose")


class _FakeMinioClient:
    def __init__(self, should_fail: bool = False):
        self.should_fail = should_fail

    def list_buckets(self):
        if self.should_fail:
            raise RuntimeError("minio unavailable")
        return []


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health_kafka_disabled_reports_disabled(self, client, monkeypatch):
        monkeypatch.setattr(main.settings, "ENABLE_KAFKA_CONSUMER", False)
        monkeypatch.setattr(main, "engine", _FakeEngine([False]))
        monkeypatch.setattr("app.storage.minio_client.get_minio_client", lambda: _FakeMinioClient(should_fail=False))

        response = await client.get("/health")
        assert response.status_code == 200

        payload = response.json()
        assert payload["status"] == "ok"
        assert payload["kafka_enabled"] is False
        assert payload["kafka"] == "disabled"
        assert payload["postgres"] == "ok"
        assert payload["minio"] == "ok"

    @pytest.mark.asyncio
    async def test_health_kafka_enabled_uses_consumer_health(self, client, monkeypatch):
        monkeypatch.setattr(main.settings, "ENABLE_KAFKA_CONSUMER", True)
        monkeypatch.setattr(main, "engine", _FakeEngine([False]))
        monkeypatch.setattr("app.storage.minio_client.get_minio_client", lambda: _FakeMinioClient(should_fail=False))
        expected_health = {
            "task_running": True,
            "last_consumed_at": None,
            "consumer_lag_seconds": None,
            "has_messages_in_buffer": False,
        }
        monkeypatch.setattr(main, "get_consumer_health", lambda: expected_health)

        response = await client.get("/health")
        assert response.status_code == 200

        payload = response.json()
        assert payload["status"] == "ok"
        assert payload["kafka_enabled"] is True
        assert payload["kafka"] == expected_health

    @pytest.mark.asyncio
    async def test_health_degraded_when_postgres_fails(self, client, monkeypatch):
        monkeypatch.setattr(main.settings, "ENABLE_KAFKA_CONSUMER", False)
        monkeypatch.setattr(main, "engine", _FakeEngine([True]))
        monkeypatch.setattr("app.storage.minio_client.get_minio_client", lambda: _FakeMinioClient(should_fail=False))

        response = await client.get("/health")
        assert response.status_code == 200

        payload = response.json()
        assert payload["status"] == "degraded"
        assert str(payload["postgres"]).startswith("error:")
        assert payload["kafka"] == "disabled"

    @pytest.mark.asyncio
    async def test_health_degraded_when_minio_fails(self, client, monkeypatch):
        monkeypatch.setattr(main.settings, "ENABLE_KAFKA_CONSUMER", False)
        monkeypatch.setattr(main, "engine", _FakeEngine([False]))
        monkeypatch.setattr("app.storage.minio_client.get_minio_client", lambda: _FakeMinioClient(should_fail=True))

        response = await client.get("/health")
        assert response.status_code == 200

        payload = response.json()
        assert payload["status"] == "degraded"
        assert str(payload["minio"]).startswith("error:")


class TestStartupPreflight:
    @pytest.mark.asyncio
    async def test_preflight_retries_postgres_then_succeeds(self, monkeypatch):
        monkeypatch.setattr(main.settings, "STARTUP_MAX_RETRIES", 3)
        monkeypatch.setattr(main.settings, "STARTUP_RETRY_DELAY_SECONDS", 0.01)

        attempts = {"init_minio": 0, "list_buckets": 0}

        fake_engine = _FakeEngine([True, False])

        def fake_init_minio():
            attempts["init_minio"] += 1

        class HealthyMinio:
            def list_buckets(self):
                attempts["list_buckets"] += 1
                return []

        async def fake_sleep(_seconds: float):
            return None

        monkeypatch.setattr(main, "engine", fake_engine)
        monkeypatch.setattr(main, "init_minio", fake_init_minio)
        monkeypatch.setattr(main, "get_minio_client", lambda: HealthyMinio())
        monkeypatch.setattr(main.asyncio, "sleep", fake_sleep)

        await main._preflight_check()

        assert fake_engine._idx == 2
        assert attempts["init_minio"] >= 1
        assert attempts["list_buckets"] >= 1

    @pytest.mark.asyncio
    async def test_preflight_raises_after_postgres_retries_exhausted(self, monkeypatch):
        monkeypatch.setattr(main.settings, "STARTUP_MAX_RETRIES", 2)
        monkeypatch.setattr(main.settings, "STARTUP_RETRY_DELAY_SECONDS", 0.01)

        fake_engine = _FakeEngine([True, True])

        async def fake_sleep(_seconds: float):
            return None

        monkeypatch.setattr(main, "engine", fake_engine)
        monkeypatch.setattr(main.asyncio, "sleep", fake_sleep)

        with pytest.raises(RuntimeError, match="PostgreSQL preflight failed"):
            await main._preflight_check()

        assert fake_engine._idx == 2


class TestLifespanOrdering:
    @pytest.mark.asyncio
    async def test_lifespan_orders_preflight_before_init_db_and_skips_kafka_when_disabled(self, monkeypatch):
        events: list[str] = []
        fake_engine = _FakeEngine(events=events)

        async def fake_preflight_check():
            events.append("preflight")

        async def fake_init_db():
            events.append("init_db")

        def fake_start_scheduler():
            events.append("start_scheduler")

        def fake_stop_scheduler():
            events.append("stop_scheduler")

        async def fake_start_consumer():
            events.append("start_consumer")

        async def fake_stop_consumer():
            events.append("stop_consumer")

        monkeypatch.setattr(main, "engine", fake_engine)
        monkeypatch.setattr(main, "_preflight_check", fake_preflight_check)
        monkeypatch.setattr(main, "init_db", fake_init_db)
        monkeypatch.setattr(main, "_start_scheduler", fake_start_scheduler)
        monkeypatch.setattr(main, "_stop_scheduler", fake_stop_scheduler)
        monkeypatch.setattr(main, "start_consumer", fake_start_consumer)
        monkeypatch.setattr(main, "stop_consumer", fake_stop_consumer)
        monkeypatch.setattr(main.settings, "ENABLE_KAFKA_CONSUMER", False)

        async with main.lifespan(main.app):
            events.append("running")

        assert events == [
            "preflight",
            "init_db",
            "start_scheduler",
            "running",
            "stop_scheduler",
            "dispose",
        ]

    @pytest.mark.asyncio
    async def test_lifespan_orders_preflight_before_init_db_and_before_kafka_start(self, monkeypatch):
        events: list[str] = []
        fake_engine = _FakeEngine(events=events)

        async def fake_preflight_check():
            events.append("preflight")

        async def fake_init_db():
            events.append("init_db")

        def fake_start_scheduler():
            events.append("start_scheduler")

        def fake_stop_scheduler():
            events.append("stop_scheduler")

        async def fake_start_consumer():
            events.append("start_consumer")

        async def fake_stop_consumer():
            events.append("stop_consumer")

        async def fake_init_producer():
            events.append("init_producer")

        async def fake_close_producer():
            events.append("close_producer")

        monkeypatch.setattr(main, "engine", fake_engine)
        monkeypatch.setattr(main, "_preflight_check", fake_preflight_check)
        monkeypatch.setattr(main, "init_db", fake_init_db)
        monkeypatch.setattr(main, "_start_scheduler", fake_start_scheduler)
        monkeypatch.setattr(main, "_stop_scheduler", fake_stop_scheduler)
        monkeypatch.setattr(main, "start_consumer", fake_start_consumer)
        monkeypatch.setattr(main, "stop_consumer", fake_stop_consumer)
        monkeypatch.setattr("app.events.event_producer.init_producer", fake_init_producer)
        monkeypatch.setattr("app.events.event_producer.close_producer", fake_close_producer)
        monkeypatch.setattr(main.settings, "ENABLE_KAFKA_CONSUMER", True)
        monkeypatch.setattr(main.settings, "KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")

        async with main.lifespan(main.app):
            events.append("running")

        assert events == [
            "preflight",
            "init_db",
            "start_consumer",
            "init_producer",
            "start_scheduler",
            "running",
            "stop_scheduler",
            "stop_consumer",
            "close_producer",
            "dispose",
        ]
