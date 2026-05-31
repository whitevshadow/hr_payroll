#!/bin/bash
# Creates the blobstore_test database used by the pytest suite.
# Runs automatically on first container startup via docker-entrypoint-initdb.d.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE blobstore_test'
    WHERE NOT EXISTS (
        SELECT FROM pg_database WHERE datname = 'blobstore_test'
    )\gexec
    GRANT ALL PRIVILEGES ON DATABASE blobstore_test TO $POSTGRES_USER;
EOSQL
echo "[init-test-db] blobstore_test database ready."
