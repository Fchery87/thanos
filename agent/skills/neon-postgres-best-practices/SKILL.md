---
name: neon-postgres-best-practices
description: Neon Postgres best practices and optimization. Use when working with Neon databases, connection pooling, branching workflows, serverless Postgres patterns, or managing Neon projects.
license: MIT
metadata:
  author: Neon
  version: "1.0.0"
  organization: Neon
  date: March 2026
  abstract: Comprehensive guide for Neon Postgres including serverless patterns, connection pooling with Neon Serverless Driver, branching workflows for schema changes, and Postgres performance optimization.
---

# Neon Postgres Best Practices

Guide for working with Neon Postgres databases, including serverless patterns, connection pooling, branching workflows, and Postgres optimization.

## When to Apply

Reference these guidelines when:
- Setting up Neon database connections
- Implementing serverless database patterns
- Using Neon branching for migrations and testing
- Configuring connection pooling (Neon Serverless Driver)
- Writing async Postgres queries with asyncpg or SQLAlchemy
- Managing Neon projects and branches
- Working with the Neon MCP Server tools

## Neon-Specific Patterns

### Connection Pooling

Neon uses a proxy layer for connection pooling. For serverless environments, use the Neon Serverless Driver:

```python
from neon_serverless import neon

async with neon.connect(DATABASE_URL) as conn:
    row = await conn.query("SELECT * FROM users WHERE id = %s", user_id)
```

For SQLAlchemy async with Neon:
```python
DATABASE_URL = "postgresql+asyncpg://user:password@ep-xxx.neon.tech/dbname?sslmode=require"
```

**Always use `sslmode=require`** in connection strings for Neon.

### Branching Workflows

Neon branches are instant, zero-copy copies of your database. Use them for:
- **Development branches**: Create a branch per feature
- **Preview environments**: Branch per PR/deployment
- **Migration testing**: Test migrations on a branch before applying to main

```bash
# Create a branch via neonctl
neonctl branches create --name feature-auth

# Get connection string for branch
neonctl connection-string --branch feature-auth
```

### MCP Server Migration Workflow

The Neon MCP Server provides branch-based migration tools:

1. `prepare_database_migration` — Creates a temporary branch and runs your migration
2. `complete_database_migration` — Applies the migration to the main branch after testing

This pattern is ideal for LLM-driven schema changes:
- AI prepares migration on a isolated branch
- You test the branch
- AI commits the migration to main

## Postgres Performance Rules

### Index Strategy

Always create indexes on foreign keys and frequently filtered columns:

```sql
-- Good: Index foreign keys
CREATE INDEX idx_findings_project_id ON findings(project_id);

-- Good: Index frequently filtered columns
CREATE INDEX idx_scans_status ON scans(status) WHERE status != 'completed';

-- Good: Composite index for common query patterns
CREATE INDEX idx_findings_project_severity ON findings(project_id, severity);
```

### Query Optimization

```sql
-- Use EXPLAIN ANALYZE to check query plans
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM findings WHERE project_id = %s;

-- Avoid SELECT * — always specify columns
SELECT id, title, severity, status FROM findings WHERE project_id = %s;

-- Use LIMIT for pagination
SELECT * FROM findings ORDER BY created_at DESC LIMIT 100 OFFSET 0;
```

### Connection Management

With Neon, connection limits are per branch. Use connection pooling:

```python
# SQLAlchemy async engine with pool settings
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

engine = create_async_engine(
    DATABASE_URL,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=3600,
)
```

## Neon MCP Server Tools

When the Neon MCP server is configured, these tools are available:

- `list_projects` — List all Neon projects
- `list_branches` — List branches for a project
- `create_branch` — Create a new database branch
- `delete_branch` — Delete a branch
- `get_connection_string` — Get a connection string for a branch
- `execute_sql` — Run SQL on a branch
- `prepare_database_migration` — Run migration on temporary branch
- `complete_database_migration` — Commit migration to main
- `get_doc_resource` — Fetch Neon documentation

## Environment Variables

For ScanForge project, set in `.env`:

```env
# Async Postgres connection (asyncpg)
DATABASE_URL=postgresql+asyncpg://user:password@ep-xxx.neon.tech/dbname?sslmode=require

# Sync Postgres (psycopg2 fallback)
DATABASE_URL_SYNC=postgresql://user:password@ep-xxx.neon.tech/dbname?sslmode=require
```

## Common Patterns for ScanForge

### Finding Queries

```sql
-- Get findings summary per project
SELECT 
    project_id,
    severity,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE status = 'open') as open_count
FROM findings
WHERE project_id = %s
GROUP BY project_id, severity;

-- Recent scans with findings
SELECT s.id, s.status, s.created_at, s.summary_json,
       COUNT(f.id) as finding_count
FROM scans s
LEFT JOIN findings f ON f.scan_id = s.id
WHERE s.project_id = %s
GROUP BY s.id
ORDER BY s.created_at DESC
LIMIT 20;
```

### Upsert Pattern for Findings

```sql
INSERT INTO findings (id, scan_id, repository_id, project_id, ...)
VALUES (%s, %s, %s, %s, ...)
ON CONFLICT (scan_id, finding_id) DO UPDATE SET
    status = EXCLUDED.status,
    updated_at = NOW();
```

## References

- [Neon Docs](https://neon.tech/docs)
- [Neon MCP Server](https://neon.tech/docs/ai/neon-mcp-server)
- [Neon Serverless Driver](https://neon.tech/docs/serverless/serverless-driver)
- [Neon Connection Pooling](https://neon.tech/docs/connection-pooling)
- [PostgreSQL Docs](https://www.postgresql.org/docs/current/)
