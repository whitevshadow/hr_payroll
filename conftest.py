"""Repo-root pytest configuration.

Loaded by pytest for every service test run (rootdir is this directory, which
holds ``pytest.ini``). It provides safe, non-secret defaults for the required
environment variables so unit tests can import each service's ``Settings()``
without a real deployment secret.

``setdefault`` never overrides a value a test (or CI) sets explicitly — e.g.
the blobstore and attendance suites still supply their own ``JWT_SECRET``.
"""

import os

# ``jwt_secret`` is now a required setting with no insecure fallback (see
# shared/hr_shared/config.py). Give the unit tests a throwaway value so the
# ``Settings()`` instances they build at import time validate successfully.
# "test-secret" is the value the service test suites sign their tokens with
# (see e.g. services/attendance-service/tests and blobstore-service/tests).
# The context dependency captures the secret at import time, so it must match.
os.environ.setdefault("JWT_SECRET", "test-secret")
