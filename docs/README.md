# Documentation

| Document | What it covers |
|----------|----------------|
| [ISSUES.md](ISSUES.md) | Codebase audit — every finding, its resolution, and known follow-ups |
| [db_schemas.md](db_schemas.md) | Per-service database schema notes |
| [system_test_guide.md](system_test_guide.md) | Manual end-to-end test walkthrough |
| [schema/](schema/) | Schema reference artifacts (see caveat below) |

The top-level [README](../README.md) covers setup, running the stack, and architecture.

## ⚠️ About `schema/`

These files are **reference only — nothing reads them at runtime**, and they are
**stale**:

- `schema/schema.sql`, `schema/current_schema.sql` — SQL dumps. The database is
  actually built by SQLAlchemy `create_all` from the models in
  `services/*/app/models.py`, which are the source of truth. `scripts/init-db.sql`
  (the only SQL the stack runs) merely creates the empty per-service schemas.
- `schema/schema_redesign.mermaid` — an ER diagram from an earlier redesign pass.

Treat the models as authoritative; regenerate these if you need an accurate dump.
