# RFC-001: outbox-relay Schema Design

**Status**: Draft
**Author**: Hoops (Data Architect)
**Date**: 2026-01-10
**Phase**: Phase 2 - Data Layer
**Service**: outbox-relay

---

## Table of Contents

1. [Overview](#overview)
2. [Business Context](#business-context)
3. [Schema Design](#schema-design)
4. [Migration Strategy](#migration-strategy)
5. [Cross-Schema Permissions](#cross-schema-permissions)
6. [Query Patterns & Performance](#query-patterns--performance)
7. [Integration Test Specifications](#integration-test-specifications)
8. [Fixture Data Samples for Jessie](#fixture-data-samples-for-jessie)
9. [Operational Considerations](#operational-considerations)
10. [ADR Compliance](#adr-compliance)
11. [Quality Gate Checklist](#quality-gate-checklist)

---

## 1. Overview

This RFC defines the database schema design for the **outbox-relay** service, which implements the Transactional Outbox Pattern for exactly-once event delivery from all RailRepay microservices to Kafka.

### 1.1 Purpose

**outbox-relay** solves the dual-write problem by:
- Polling transactional outbox tables in each service schema (cross-schema read operations)
- Publishing events to Kafka with exactly-once delivery guarantee
- Handling failures with retry logic and dead-letter queue (DLQ) pattern
- Tracking relay state and monitoring lag for operational alerting

### 1.2 Schema Ownership

Per **ADR-001** (Schema-Per-Service Database Isolation Pattern):
- **Schema Name**: `outbox_relay`
- **Owner**: outbox-relay service
- **Isolation**: No foreign keys to other schemas (cross-schema queries via SELECT only)

### 1.3 Source Documents

- **Specification**: `/services/outbox-relay/docs/phases/PHASE-1-SPECIFICATION.md`
- **Notion**: Architecture › Data Layer § Transactional Outbox Pattern
- **Notion**: Architecture › Service Layer § 14 (outbox-relay specification)
- **ADRs**: ADR-001 (schema-per-service), ADR-003 (node-pg-migrate), ADR-017 (fixture data)

---

## 2. Business Context

### 2.1 The Dual-Write Problem

**Without outbox-relay**:
```typescript
// ANTI-PATTERN: Dual write (not atomic)
await db.insert('journeys', journey);  // ✅ Succeeds
await kafka.publish(event);            // ❌ Crashes - event lost!
```

**With transactional outbox**:
```typescript
// CORRECT: Single atomic transaction
await db.tx(async (t) => {
  await t.insert('journeys', journey);         // ✅ Succeeds
  await t.insert('outbox', event);             // ✅ Succeeds atomically
});
// outbox-relay polls outbox table and publishes event later
```

### 2.2 Why Cross-Schema Access is Required

**outbox-relay is an infrastructure service** that needs READ + UPDATE access to ALL service outbox tables:
- `whatsapp_handler.outbox_events` (variation: `outbox_events` instead of `outbox`)
- `journey_matcher.outbox`
- `darwin_ingestor.outbox`
- `timetable_loader.outbox`
- `data_retention.outbox`
- (Future service schemas as they are added)

**Pattern precedent**: `data-retention-service` already deployed with similar cross-schema access.

### 2.3 Business Impact of Schema Design Decisions

| Design Decision | Business Impact |
|-----------------|-----------------|
| **relay_state table** | Enables monitoring lag per schema; operators can detect relay failures within 5 minutes (AC-12) |
| **failed_events DLQ** | Prevents poison messages from blocking the queue; operators can investigate and replay failed events |
| **Row-level locks (FOR UPDATE SKIP LOCKED)** | Enables future horizontal scaling without event duplication |
| **Cursor tracking (last_published_event_id)** | Ensures ordered event delivery for same aggregate_id (AC-3) |

---

## 3. Schema Design

### 3.1 relay_state Table

**Purpose**: Track polling state and cursor position for each service schema.

**Design Decisions**:
1. **schema_name + table_name**: Handle both `outbox` and `outbox_events` variations (per Specification § 4.3)
2. **last_poll_time**: Enables lag calculation (current time - last_poll_time)
3. **last_published_event_id**: Cursor for ordered delivery (optional optimization for future)
4. **total_events_published**: Cumulative counter for observability metrics
5. **UNIQUE constraint on schema_name**: Only one relay state per schema (enforced at DB level)

**Schema**:
```sql
CREATE TABLE outbox_relay.relay_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_name VARCHAR(100) NOT NULL UNIQUE,
  table_name VARCHAR(100) NOT NULL,  -- Supports 'outbox' or 'outbox_events'
  last_poll_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_published_event_id UUID,      -- Cursor for ordered delivery
  total_events_published BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for monitoring queries
CREATE INDEX idx_relay_state_last_poll ON outbox_relay.relay_state (last_poll_time);

-- Index for schema lookups
CREATE INDEX idx_relay_state_schema ON outbox_relay.relay_state (schema_name);
```

**Justification for Indexes**:
- `idx_relay_state_last_poll`: Serves health check query `SELECT MAX(last_poll_time) FROM relay_state` (P95 < 10ms)
- `idx_relay_state_schema`: Serves polling loop `SELECT * FROM relay_state WHERE schema_name = $1` (P95 < 5ms)

**Data Retention**: Indefinite (low-volume table, ~15 rows at steady state)

### 3.2 failed_events Table (Dead-Letter Queue)

**Purpose**: Store events that fail after max retries (10 attempts per AC-9) for operator investigation and manual replay.

**Design Decisions**:
1. **original_event_id**: Preserve original UUID from source outbox table (enables deduplication on replay)
2. **source_schema + source_table**: Track which service's outbox table the event came from
3. **event_type**: Denormalized for filtering/alerting (e.g., "alert only on payment.failed events")
4. **payload JSONB**: Store full event payload for replay capability
5. **failure_reason TEXT**: Store exception message for debugging
6. **failure_count INT**: Track retry attempts before DLQ (should always be 10 per AC-9)
7. **first_failed_at + last_failed_at**: Track failure duration for SLA monitoring

**Schema**:
```sql
CREATE TABLE outbox_relay.failed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_event_id UUID NOT NULL,
  source_schema VARCHAR(100) NOT NULL,
  source_table VARCHAR(100) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  failure_reason TEXT NOT NULL,
  failure_count INT NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for operator queries (which schema is failing?)
CREATE INDEX idx_failed_events_source
  ON outbox_relay.failed_events (source_schema, source_table);

-- Index for event type filtering (alert on payment failures)
CREATE INDEX idx_failed_events_type
  ON outbox_relay.failed_events (event_type);

-- Index for time-based queries (failures in last 24h)
CREATE INDEX idx_failed_events_first_failed
  ON outbox_relay.failed_events (first_failed_at);

-- GIN index for JSONB payload queries (search by correlation_id)
CREATE INDEX idx_failed_events_payload
  ON outbox_relay.failed_events USING GIN (payload);
```

**Justification for Indexes**:
- `idx_failed_events_source`: Serves operator query "Which service has failed events?" (P95 < 20ms)
- `idx_failed_events_type`: Serves alert query `SELECT COUNT(*) WHERE event_type LIKE 'payment.%'` (P95 < 15ms)
- `idx_failed_events_first_failed`: Serves dashboard query "Failed events in last 24h" (P95 < 25ms)
- `idx_failed_events_payload`: Serves operator query "Find failed event by correlation_id" (P95 < 50ms with GIN index)

**Data Retention**: 90 days (manual cleanup via data-retention-service or operator intervention)

### 3.3 Outbox Table Variations (External Schemas)

**Standard outbox table** (owned by other services, NOT outbox-relay):
```sql
-- Example: journey_matcher.outbox
CREATE TABLE {schema_name}.outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id UUID NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,        -- OR processed_at (variation)
  published BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_{schema_name}_outbox_unpublished
  ON {schema_name}.outbox (created_at)
  WHERE published = false;
```

**Variations outbox-relay MUST handle** (per Specification § 4.3):
1. **Table name**: `outbox` OR `outbox_events` (whatsapp_handler uses `outbox_events`)
2. **Published column**: `published_at` OR `processed_at` (both TIMESTAMPTZ, NULL = unpublished)

**Discovery strategy**:
```sql
-- Check if table exists with either name
SELECT table_name
FROM information_schema.tables
WHERE table_schema = $1
  AND table_name IN ('outbox', 'outbox_events');
```

---

## 4. Migration Strategy

### 4.1 Zero-Downtime Migration Plan (Expand-Migrate-Contract)

**Phase 1: Expand** (Deploy migrations, no app code changes)
- ✅ Create `outbox_relay` schema
- ✅ Create `relay_state` table
- ✅ Create `failed_events` table
- ✅ No data writes yet (safe rollback)

**Phase 2: Migrate** (Deploy app code, dual-read/write)
- ✅ Application starts polling outbox tables
- ✅ Application writes to `relay_state` on each poll
- ✅ Application writes to `failed_events` on retry exhaustion
- ✅ Old code (if any) continues working (no breaking changes)

**Phase 3: Contract** (Future - not needed for MVP)
- No schema contraction needed for initial deployment
- If schema changes required later, follow expand-migrate-contract pattern

### 4.2 Migration Files (node-pg-migrate)

**Migration 1: Create schema and relay_state table**
- File: `migrations/1736524800000-create-outbox-relay-schema.ts`
- Forward: Create schema + relay_state table + indexes
- Rollback: Drop relay_state table + drop schema

**Migration 2: Create failed_events table**
- File: `migrations/1736524801000-create-failed-events-table.ts`
- Forward: Create failed_events table + indexes
- Rollback: Drop failed_events table

**Migration 3: Grant cross-schema permissions**
- File: `migrations/1736524802000-grant-cross-schema-permissions.ts`
- Forward: GRANT SELECT, UPDATE on all service outbox tables
- Rollback: REVOKE SELECT, UPDATE on all service outbox tables

**Rationale for 3 separate migrations**:
1. **Incremental rollback**: If permissions fail, can rollback without losing tables
2. **Testability**: Each migration tests one concern (schema creation, DLQ, permissions)
3. **Observability**: Migration logs show exactly which step failed

### 4.3 Rollback Safety

**Rollback scenario 1**: Migration 1 fails (schema creation)
- Impact: No schema created, no app changes
- Rollback: Automatic (node-pg-migrate rollback)
- Risk: **LOW** (schema creation is atomic)

**Rollback scenario 2**: Migration 2 fails (failed_events table)
- Impact: relay_state exists, but no DLQ table
- Rollback: Drop relay_state, drop schema
- Risk: **LOW** (no data written yet)

**Rollback scenario 3**: Migration 3 fails (permissions)
- Impact: Tables exist, but cross-schema access denied
- Rollback: Drop tables, drop schema
- Risk: **LOW** (no app deployment yet)

**Rollback scenario 4**: App deployment fails
- Impact: Migrations applied, but app not running
- Rollback: Redeploy previous app version (migrations remain, no-op)
- Risk: **LOW** (unused tables don't impact other services)

### 4.4 Migration Test Strategy (Testcontainers)

**Test 1**: Forward migration (UP) succeeds
```typescript
it('should create outbox_relay schema and tables', async () => {
  await migrate({ direction: 'up', ... });

  // Verify schema exists
  const schema = await pgPool.query(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'outbox_relay'"
  );
  expect(schema.rows).toHaveLength(1);

  // Verify relay_state table exists
  const relayState = await pgPool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'outbox_relay' AND table_name = 'relay_state'"
  );
  expect(relayState.rows).toHaveLength(1);

  // Verify failed_events table exists
  const failedEvents = await pgPool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'outbox_relay' AND table_name = 'failed_events'"
  );
  expect(failedEvents.rows).toHaveLength(1);
});
```

**Test 2**: Rollback migration (DOWN) succeeds
```typescript
it('should rollback all migrations and remove schema', async () => {
  await migrate({ direction: 'up', ... });
  await migrate({ direction: 'down', count: 999, ... });

  // Verify schema removed
  const schema = await pgPool.query(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'outbox_relay'"
  );
  expect(schema.rows).toHaveLength(0);
});
```

**Test 3**: Constraints enforced
```typescript
it('should enforce UNIQUE constraint on relay_state.schema_name', async () => {
  await migrate({ direction: 'up', ... });

  // Insert first row
  await pgPool.query(
    "INSERT INTO outbox_relay.relay_state (schema_name, table_name) VALUES ('journey_matcher', 'outbox')"
  );

  // Attempt duplicate insert (should fail)
  await expect(
    pgPool.query(
      "INSERT INTO outbox_relay.relay_state (schema_name, table_name) VALUES ('journey_matcher', 'outbox')"
    )
  ).rejects.toThrow(/duplicate key value violates unique constraint/);
});
```

**Test 4**: Cross-schema permissions granted
```typescript
it('should grant SELECT and UPDATE permissions on outbox tables', async () => {
  await migrate({ direction: 'up', ... });

  // Create mock outbox table in test schema
  await pgPool.query(
    "CREATE SCHEMA IF NOT EXISTS journey_matcher"
  );
  await pgPool.query(`
    CREATE TABLE journey_matcher.outbox (
      id UUID PRIMARY KEY,
      published BOOLEAN DEFAULT false,
      published_at TIMESTAMPTZ
    )
  `);

  // Verify SELECT permission (as outbox-relay role)
  const selectResult = await pgPool.query(
    "SELECT * FROM journey_matcher.outbox"
  );
  expect(selectResult.rows).toBeDefined();

  // Verify UPDATE permission
  await pgPool.query(
    "INSERT INTO journey_matcher.outbox (id) VALUES (gen_random_uuid())"
  );
  await expect(
    pgPool.query(
      "UPDATE journey_matcher.outbox SET published = true WHERE published = false"
    )
  ).resolves.toBeDefined();
});
```

**Test 5**: Indexes created
```typescript
it('should create all indexes', async () => {
  await migrate({ direction: 'up', ... });

  const indexes = await pgPool.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'outbox_relay'
    ORDER BY indexname
  `);

  const indexNames = indexes.rows.map(r => r.indexname);
  expect(indexNames).toContain('idx_relay_state_last_poll');
  expect(indexNames).toContain('idx_relay_state_schema');
  expect(indexNames).toContain('idx_failed_events_source');
  expect(indexNames).toContain('idx_failed_events_type');
  expect(indexNames).toContain('idx_failed_events_first_failed');
  expect(indexNames).toContain('idx_failed_events_payload');
});
```

---

## 5. Cross-Schema Permissions

### 5.1 Permission Requirements

**outbox-relay needs READ + UPDATE on ALL service outbox tables**:

```sql
-- Grant SELECT (read unpublished events)
GRANT SELECT ON whatsapp_handler.outbox_events TO outbox_relay;
GRANT SELECT ON journey_matcher.outbox TO outbox_relay;
GRANT SELECT ON darwin_ingestor.outbox TO outbox_relay;
GRANT SELECT ON timetable_loader.outbox TO outbox_relay;
GRANT SELECT ON data_retention.outbox TO outbox_relay;

-- Grant UPDATE (mark events as published)
GRANT UPDATE ON whatsapp_handler.outbox_events TO outbox_relay;
GRANT UPDATE ON journey_matcher.outbox TO outbox_relay;
GRANT UPDATE ON darwin_ingestor.outbox TO outbox_relay;
GRANT UPDATE ON timetable_loader.outbox TO outbox_relay;
GRANT UPDATE ON data_retention.outbox TO outbox_relay;
```

**Future services**: When new services are added, their migrations MUST include:
```sql
-- In new-service migration
GRANT SELECT, UPDATE ON new_service.outbox TO outbox_relay;
```

### 5.2 Security Justification

**Why cross-schema access is safe**:
1. ✅ **Read-only on business data**: outbox-relay only reads/updates `published` and `published_at` columns (no business data modification)
2. ✅ **No DELETE permission**: Cannot remove events (audit trail preserved)
3. ✅ **No INSERT permission**: Cannot create fake events (only services can)
4. ✅ **No GRANT permission**: Cannot escalate privileges
5. ✅ **Scoped to outbox tables**: Cannot access service business tables (tickets, journeys, claims)

**Precedent**: `data-retention-service` already has cross-schema SELECT/DELETE permissions (ADR-001 compliance verified).

### 5.3 Permission Validation Tests

**Test 1**: outbox-relay can SELECT unpublished events
```typescript
it('should SELECT unpublished events from journey_matcher.outbox', async () => {
  // Insert test event
  await pgPool.query(`
    INSERT INTO journey_matcher.outbox (aggregate_id, event_type, payload, correlation_id, published)
    VALUES (gen_random_uuid(), 'journey.created', '{}'::jsonb, gen_random_uuid(), false)
  `);

  // Query as outbox-relay role
  const result = await pgPool.query(`
    SELECT * FROM journey_matcher.outbox WHERE published = false
  `);

  expect(result.rows.length).toBeGreaterThan(0);
});
```

**Test 2**: outbox-relay can UPDATE published flag
```typescript
it('should UPDATE published flag on journey_matcher.outbox', async () => {
  // Insert test event
  const insertResult = await pgPool.query(`
    INSERT INTO journey_matcher.outbox (aggregate_id, event_type, payload, correlation_id, published)
    VALUES (gen_random_uuid(), 'journey.created', '{}'::jsonb, gen_random_uuid(), false)
    RETURNING id
  `);
  const eventId = insertResult.rows[0].id;

  // Update as outbox-relay role
  await pgPool.query(`
    UPDATE journey_matcher.outbox
    SET published = true, published_at = now()
    WHERE id = $1
  `, [eventId]);

  // Verify update
  const result = await pgPool.query(`
    SELECT published FROM journey_matcher.outbox WHERE id = $1
  `, [eventId]);

  expect(result.rows[0].published).toBe(true);
});
```

**Test 3**: outbox-relay CANNOT INSERT events (negative test)
```typescript
it('should DENY INSERT on journey_matcher.outbox', async () => {
  await expect(
    pgPool.query(`
      INSERT INTO journey_matcher.outbox (aggregate_id, event_type, payload, correlation_id)
      VALUES (gen_random_uuid(), 'fake.event', '{}'::jsonb, gen_random_uuid())
    `)
  ).rejects.toThrow(/permission denied/);
});
```

**Test 4**: outbox-relay CANNOT DELETE events (negative test)
```typescript
it('should DENY DELETE on journey_matcher.outbox', async () => {
  await expect(
    pgPool.query(`
      DELETE FROM journey_matcher.outbox WHERE published = true
    `)
  ).rejects.toThrow(/permission denied/);
});
```

---

## 6. Query Patterns & Performance

### 6.1 Critical Query: Poll Unpublished Events

**Query**:
```sql
SELECT *
FROM {schema_name}.outbox
WHERE published = false
ORDER BY created_at
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

**Execution Plan** (with partial index on `published = false`):
```
Limit (cost=0.29..8.31 rows=100 width=...)
  -> LockRows (cost=0.29..800.00 rows=10000 width=...)
    -> Index Scan using idx_outbox_unpublished on outbox (cost=0.29..700.00 rows=10000 width=...)
      Index Cond: (published = false)
      Order By: created_at
```

**Performance targets** (per Specification § 6.1):
- **P95 latency**: ≤ 50ms (index scan on 10k unpublished events)
- **P99 latency**: ≤ 100ms (worst case with locks)
- **Throughput**: 1000 events/minute (100 events per poll, 10s interval)

**Index justification**:
- **Partial index WHERE published = false**: Reduces index size by 99% (only indexes unpublished events)
- **BRIN index on created_at**: Not used (B-tree better for small result sets)
- **GIN index on payload**: Not used for this query (only for operator searches)

### 6.2 Query: Update Published Flag

**Query**:
```sql
UPDATE {schema_name}.outbox
SET published = true, published_at = now()
WHERE id = $1;
```

**Execution Plan** (primary key lookup):
```
Update on outbox (cost=0.15..8.17 rows=1 width=...)
  -> Index Scan using outbox_pkey on outbox (cost=0.15..8.17 rows=1 width=...)
    Index Cond: (id = $1)
```

**Performance targets**:
- **P95 latency**: ≤ 5ms (primary key lookup)
- **Write amplification**: Minimal (no index updates, partial index excludes published = true rows)

### 6.3 Query: Monitor Relay Lag

**Query**:
```sql
SELECT
  schema_name,
  EXTRACT(EPOCH FROM (now() - last_poll_time)) AS lag_seconds
FROM outbox_relay.relay_state
WHERE last_poll_time < now() - INTERVAL '60 seconds';
```

**Execution Plan** (index scan on last_poll_time):
```
Index Scan using idx_relay_state_last_poll on relay_state (cost=0.15..8.17 rows=1 width=...)
  Index Cond: (last_poll_time < (now() - '60 seconds'::interval))
```

**Performance targets**:
- **P95 latency**: ≤ 10ms (index scan on ~15 rows)
- **Query frequency**: Every 15 seconds (Prometheus metrics scrape)

### 6.4 Query: DLQ Operator Investigation

**Query**:
```sql
SELECT
  source_schema,
  event_type,
  COUNT(*) AS failed_count,
  MIN(first_failed_at) AS oldest_failure
FROM outbox_relay.failed_events
WHERE first_failed_at > now() - INTERVAL '24 hours'
GROUP BY source_schema, event_type
ORDER BY failed_count DESC;
```

**Execution Plan** (index scan on first_failed_at + hash aggregate):
```
Sort (cost=50.00..55.00 rows=10 width=...)
  -> HashAggregate (cost=40.00..45.00 rows=10 width=...)
    -> Index Scan using idx_failed_events_first_failed on failed_events (cost=0.29..30.00 rows=100 width=...)
      Index Cond: (first_failed_at > (now() - '24 hours'::interval))
```

**Performance targets**:
- **P95 latency**: ≤ 50ms (aggregate on 100 failed events in 24h)
- **Query frequency**: Ad-hoc (operator dashboard)

### 6.5 Connection Pooling

**outbox-relay connection pool configuration**:
```typescript
{
  max: 10,  // Max connections (low because single-threaded poller)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
}
```

**Justification**:
- Single-threaded poller needs 1 active connection at a time
- Health check needs 1 connection
- Metrics push needs 1 connection
- Total: ~3 active connections (10 max for safety margin)

---

## 7. Integration Test Specifications

### 7.1 Test Strategy

**TDD approach** (tests written BEFORE implementation):
1. ✅ Write failing tests that express intended behavior
2. ❌ Tests fail with clear error messages
3. ✅ Blake implements code to pass tests (Phase 3)

**Testcontainers usage**:
- Spin up ephemeral PostgreSQL 16 container
- Run migrations against container
- Verify schema, constraints, indexes
- Verify cross-schema permissions
- Tear down container after tests

### 7.2 Failing Integration Tests (to be written in Phase 2)

**Test file**: `/services/outbox-relay/src/__tests__/integration/database-migrations.test.ts`

**Test 1: Schema creation**
```typescript
describe('Migration 1: Create outbox_relay schema', () => {
  it('should create outbox_relay schema', async () => {
    // EXPECTED TO FAIL: Schema does not exist yet
    const result = await pgPool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'outbox_relay'"
    );
    expect(result.rows).toHaveLength(1);
  });

  it('should create relay_state table with correct columns', async () => {
    // EXPECTED TO FAIL: Table does not exist yet
    const result = await pgPool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'outbox_relay' AND table_name = 'relay_state'
      ORDER BY ordinal_position
    `);

    expect(result.rows).toContainEqual({
      column_name: 'id',
      data_type: 'uuid',
      is_nullable: 'NO',
    });
    expect(result.rows).toContainEqual({
      column_name: 'schema_name',
      data_type: 'character varying',
      is_nullable: 'NO',
    });
    expect(result.rows).toContainEqual({
      column_name: 'table_name',
      data_type: 'character varying',
      is_nullable: 'NO',
    });
  });

  it('should enforce UNIQUE constraint on schema_name', async () => {
    // EXPECTED TO FAIL: Constraint does not exist yet
    await pgPool.query(`
      INSERT INTO outbox_relay.relay_state (schema_name, table_name)
      VALUES ('journey_matcher', 'outbox')
    `);

    await expect(
      pgPool.query(`
        INSERT INTO outbox_relay.relay_state (schema_name, table_name)
        VALUES ('journey_matcher', 'outbox')
      `)
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });
});
```

**Test 2: DLQ table creation**
```typescript
describe('Migration 2: Create failed_events table', () => {
  it('should create failed_events table with correct columns', async () => {
    // EXPECTED TO FAIL: Table does not exist yet
    const result = await pgPool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'outbox_relay' AND table_name = 'failed_events'
      ORDER BY ordinal_position
    `);

    expect(result.rows).toContainEqual({
      column_name: 'original_event_id',
      data_type: 'uuid',
    });
    expect(result.rows).toContainEqual({
      column_name: 'payload',
      data_type: 'jsonb',
    });
  });

  it('should allow inserting failed events', async () => {
    // EXPECTED TO FAIL: Table does not exist yet
    const result = await pgPool.query(`
      INSERT INTO outbox_relay.failed_events (
        original_event_id, source_schema, source_table, event_type,
        payload, failure_reason, failure_count
      ) VALUES (
        gen_random_uuid(), 'journey_matcher', 'outbox', 'journey.created',
        '{"test": "data"}'::jsonb, 'Kafka timeout', 10
      ) RETURNING id
    `);

    expect(result.rows).toHaveLength(1);
  });
});
```

**Test 3: Cross-schema permissions**
```typescript
describe('Migration 3: Grant cross-schema permissions', () => {
  beforeEach(async () => {
    // Create mock service schema with outbox table
    await pgPool.query('CREATE SCHEMA IF NOT EXISTS journey_matcher');
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS journey_matcher.outbox (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        aggregate_id UUID NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        correlation_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_at TIMESTAMPTZ,
        published BOOLEAN NOT NULL DEFAULT false
      )
    `);
  });

  it('should allow SELECT on journey_matcher.outbox', async () => {
    // EXPECTED TO FAIL: Permissions not granted yet
    const result = await pgPool.query(
      'SELECT * FROM journey_matcher.outbox WHERE published = false'
    );
    expect(result.rows).toBeDefined();
  });

  it('should allow UPDATE on journey_matcher.outbox', async () => {
    // EXPECTED TO FAIL: Permissions not granted yet
    const insertResult = await pgPool.query(`
      INSERT INTO journey_matcher.outbox (aggregate_id, event_type, payload, correlation_id)
      VALUES (gen_random_uuid(), 'test.event', '{}'::jsonb, gen_random_uuid())
      RETURNING id
    `);

    await expect(
      pgPool.query(`
        UPDATE journey_matcher.outbox
        SET published = true, published_at = now()
        WHERE id = $1
      `, [insertResult.rows[0].id])
    ).resolves.toBeDefined();
  });

  it('should DENY INSERT on journey_matcher.outbox', async () => {
    // EXPECTED TO PASS (negative test): Should not have INSERT permission
    await expect(
      pgPool.query(`
        INSERT INTO journey_matcher.outbox (aggregate_id, event_type, payload, correlation_id)
        VALUES (gen_random_uuid(), 'fake.event', '{}'::jsonb, gen_random_uuid())
      `)
    ).rejects.toThrow(/permission denied/);
  });

  it('should DENY DELETE on journey_matcher.outbox', async () => {
    // EXPECTED TO PASS (negative test): Should not have DELETE permission
    await expect(
      pgPool.query('DELETE FROM journey_matcher.outbox WHERE published = true')
    ).rejects.toThrow(/permission denied/);
  });
});
```

**Test 4: Indexes created**
```typescript
describe('Indexes', () => {
  it('should create all required indexes on relay_state', async () => {
    // EXPECTED TO FAIL: Indexes do not exist yet
    const result = await pgPool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'outbox_relay' AND tablename = 'relay_state'
      ORDER BY indexname
    `);

    const indexNames = result.rows.map(r => r.indexname);
    expect(indexNames).toContain('idx_relay_state_last_poll');
    expect(indexNames).toContain('idx_relay_state_schema');
  });

  it('should create all required indexes on failed_events', async () => {
    // EXPECTED TO FAIL: Indexes do not exist yet
    const result = await pgPool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'outbox_relay' AND tablename = 'failed_events'
      ORDER BY indexname
    `);

    const indexNames = result.rows.map(r => r.indexname);
    expect(indexNames).toContain('idx_failed_events_source');
    expect(indexNames).toContain('idx_failed_events_type');
    expect(indexNames).toContain('idx_failed_events_first_failed');
    expect(indexNames).toContain('idx_failed_events_payload');
  });
});
```

**Test 5: Rollback migrations**
```typescript
describe('Rollback migrations', () => {
  it('should rollback all migrations and remove schema', async () => {
    // EXPECTED TO FAIL: Rollback not implemented yet
    await migrate({ direction: 'up', ... });
    await migrate({ direction: 'down', count: 999, ... });

    const result = await pgPool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'outbox_relay'"
    );
    expect(result.rows).toHaveLength(0);
  });
});
```

### 7.3 Why Tests Must Fail First (TDD Compliance)

Per **ADR-014** (TDD Mandate):
1. ✅ **Failing tests express intended behavior**: Each test describes what the schema SHOULD do
2. ✅ **Implementation driven by tests**: Blake writes migrations to make tests pass
3. ✅ **Prevents over-implementation**: Only write code necessary to pass tests
4. ✅ **Refactoring safety**: After tests pass, can refactor migrations with confidence

**Anti-pattern to avoid**:
```typescript
// ❌ WRONG: Test written after migration (not TDD)
it('should create schema', async () => {
  // Migration already exists, test always passes
  const result = await pgPool.query("SELECT ...");
  expect(result.rows).toHaveLength(1);  // Always true
});
```

**Correct TDD approach**:
```typescript
// ✅ CORRECT: Test written before migration (TDD)
it('should create schema', async () => {
  // Migration does not exist yet, test FAILS
  const result = await pgPool.query("SELECT ...");
  expect(result.rows).toHaveLength(1);  // FAILS with "schema does not exist"
});
```

---

## 8. Fixture Data Samples for Jessie

Per **ADR-017** (Fixture Data Extraction from Real Data), Hoops MUST provide sample extraction queries for Jessie to populate test fixtures.

### 8.1 Sample Extraction Queries

**Query 1: Extract relay_state sample data**
```sql
-- Happy path: Normal relay state for active schema
SELECT
  schema_name,
  table_name,
  last_poll_time,
  total_events_published
FROM outbox_relay.relay_state
WHERE total_events_published > 0
ORDER BY last_poll_time DESC
LIMIT 3;

-- Edge case: Stale relay state (not polled recently)
SELECT
  schema_name,
  table_name,
  last_poll_time,
  EXTRACT(EPOCH FROM (now() - last_poll_time)) AS lag_seconds
FROM outbox_relay.relay_state
WHERE last_poll_time < now() - INTERVAL '60 seconds'
LIMIT 2;

-- Edge case: Zero events published (new schema)
SELECT
  schema_name,
  table_name,
  total_events_published
FROM outbox_relay.relay_state
WHERE total_events_published = 0
LIMIT 1;
```

**Query 2: Extract failed_events sample data**
```sql
-- Happy path: Failed events with retry exhaustion
SELECT
  original_event_id,
  source_schema,
  source_table,
  event_type,
  payload,
  failure_reason,
  failure_count
FROM outbox_relay.failed_events
WHERE failure_count = 10  -- Max retries reached
ORDER BY first_failed_at DESC
LIMIT 5;

-- Edge case: Kafka timeout failures
SELECT
  original_event_id,
  source_schema,
  event_type,
  failure_reason
FROM outbox_relay.failed_events
WHERE failure_reason LIKE '%timeout%'
LIMIT 2;

-- Edge case: Payment event failures (critical for alerting)
SELECT
  original_event_id,
  source_schema,
  event_type,
  payload
FROM outbox_relay.failed_events
WHERE event_type LIKE 'payment.%'
LIMIT 2;

-- Edge case: Failed events with large payloads (test JSONB handling)
SELECT
  original_event_id,
  event_type,
  LENGTH(payload::text) AS payload_size_bytes
FROM outbox_relay.failed_events
ORDER BY LENGTH(payload::text) DESC
LIMIT 2;
```

**Query 3: Extract outbox table variations (for multi-schema tests)**
```sql
-- Variation 1: Standard outbox table (journey_matcher)
SELECT
  id,
  aggregate_id,
  event_type,
  published,
  published_at,
  created_at
FROM journey_matcher.outbox
WHERE published = false
LIMIT 3;

-- Variation 2: outbox_events table (whatsapp_handler)
SELECT
  id,
  aggregate_id,
  event_type,
  published,
  processed_at  -- NOTE: Different column name
FROM whatsapp_handler.outbox_events
WHERE published = false
LIMIT 3;
```

### 8.2 Representative Sample Data

**relay_state sample rows** (for Jessie's fixtures):
```json
[
  {
    "schema_name": "journey_matcher",
    "table_name": "outbox",
    "last_poll_time": "2026-01-10T12:00:00Z",
    "total_events_published": 15234
  },
  {
    "schema_name": "whatsapp_handler",
    "table_name": "outbox_events",
    "last_poll_time": "2026-01-10T11:59:50Z",
    "total_events_published": 8901
  },
  {
    "schema_name": "darwin_ingestor",
    "table_name": "outbox",
    "last_poll_time": "2026-01-10T11:58:00Z",
    "total_events_published": 0
  }
]
```

**failed_events sample rows** (for Jessie's fixtures):
```json
[
  {
    "original_event_id": "550e8400-e29b-41d4-a716-446655440000",
    "source_schema": "journey_matcher",
    "source_table": "outbox",
    "event_type": "journey.created",
    "payload": {
      "journey_id": "123e4567-e89b-12d3-a456-426614174000",
      "user_id": "user_123",
      "origin_crs": "KGX",
      "destination_crs": "EDI"
    },
    "failure_reason": "KafkaTimeoutError: Timeout while sending message to topic journey.created",
    "failure_count": 10,
    "first_failed_at": "2026-01-10T10:30:00Z",
    "last_failed_at": "2026-01-10T11:45:00Z"
  },
  {
    "original_event_id": "660e8400-e29b-41d4-a716-446655440001",
    "source_schema": "payments_service",
    "source_table": "outbox",
    "event_type": "payment.failed",
    "payload": {
      "payment_id": "234e5678-e89b-12d3-a456-426614174001",
      "amount": 25.50,
      "currency": "GBP",
      "reason": "insufficient_funds"
    },
    "failure_reason": "KafkaError: Broker connection failed",
    "failure_count": 10,
    "first_failed_at": "2026-01-10T11:00:00Z",
    "last_failed_at": "2026-01-10T11:30:00Z"
  }
]
```

### 8.3 Edge Cases for Jessie's Tests

| Edge Case | Test Scenario | Fixture Data |
|-----------|---------------|--------------|
| **Null last_published_event_id** | New schema, no events published yet | `last_published_event_id = NULL` |
| **Zero total_events_published** | Schema just added to configuration | `total_events_published = 0` |
| **Stale last_poll_time** | Relay failure detection (AC-12) | `last_poll_time < now() - 60s` |
| **Unicode in payload** | International characters in event data | `payload = {"name": "Café Müller"}` |
| **Large JSONB payload** | Test 10KB+ event payloads | `payload` with 500+ fields |
| **Table name variation** | Test both `outbox` and `outbox_events` | Mock both table names |
| **Column name variation** | Test both `published_at` and `processed_at` | Mock both column names |

**BLOCKING RULE**: Blake MUST NOT implement Phase 3 until Jessie has these fixture samples.

---

## 9. Operational Considerations

### 9.1 Data Retention

**relay_state table**:
- **Retention**: Indefinite (low-volume table, ~15 rows at steady state)
- **Growth rate**: Zero (one row per schema, no new rows after initial setup)
- **Cleanup**: Not needed

**failed_events table**:
- **Retention**: 90 days (operator investigation window)
- **Growth rate**: Low (only events that fail after 10 retries, expected < 10 events/day)
- **Cleanup strategy**: Manual operator intervention or future data-retention-service policy
- **Estimated size**: 90 days × 10 events/day × 1KB/event = ~900KB (negligible)

### 9.2 Backup & Recovery

**Railway PostgreSQL automated backups**:
- Daily automated backups (retained 7 days)
- Point-in-time recovery (PITR) available
- Manual snapshot before migration (Moykle Phase 5)

**Disaster recovery scenarios**:

| Scenario | Recovery Procedure | RTO | RPO |
|----------|-------------------|-----|-----|
| **Migration failure** | Rollback migration via `npm run migrate:down` | 5 min | 0 (no data loss) |
| **Data corruption in relay_state** | Delete corrupted rows, allow service to reinitialize | 10 min | 1 poll cycle (10s) |
| **Data corruption in failed_events** | Restore from backup, replay failed events | 15 min | 24 hours (acceptable for DLQ) |
| **Full schema loss** | Restore from Railway snapshot, rerun migrations | 20 min | 5 min (PITR) |

### 9.3 Monitoring & Alerting

**Metrics to track** (per Specification § 5.4):
1. `outbox_relay_events_published` (counter) - Total events published per schema
2. `outbox_relay_poll_duration` (histogram) - Time to poll + publish per schema
3. `outbox_relay_failed_events` (gauge) - Current count in failed_events table
4. `outbox_relay_lag_seconds` (gauge) - Max age of oldest unpublished event per schema

**Alert rules** (per Specification § 5.4 AC-11):
```yaml
# Alert: Events stuck in failed_events DLQ
- alert: OutboxRelayFailedEvents
  expr: outbox_relay_failed_events > 0
  for: 5m
  annotations:
    summary: "outbox-relay has failed events in DLQ"
    description: "{{ $value }} events failed after max retries"

# Alert: Relay lag exceeds threshold
- alert: OutboxRelayLagHigh
  expr: outbox_relay_lag_seconds > 60
  for: 5m
  annotations:
    summary: "outbox-relay lag exceeds 60 seconds"
    description: "Oldest unpublished event is {{ $value }}s old"
```

**Dashboard queries**:
```sql
-- Failed events by schema (last 24h)
SELECT source_schema, COUNT(*) AS failed_count
FROM outbox_relay.failed_events
WHERE first_failed_at > now() - INTERVAL '24 hours'
GROUP BY source_schema;

-- Relay lag by schema
SELECT
  schema_name,
  EXTRACT(EPOCH FROM (now() - last_poll_time)) AS lag_seconds,
  total_events_published
FROM outbox_relay.relay_state
ORDER BY lag_seconds DESC;
```

### 9.4 Runbook Entries

**Incident 1: Failed events in DLQ**
```
SYMPTOM: Alert fires "OutboxRelayFailedEvents > 0"
CAUSE: Kafka unavailable or network partition
INVESTIGATION:
  1. Query failed_events: SELECT * FROM outbox_relay.failed_events ORDER BY first_failed_at DESC LIMIT 10;
  2. Check failure_reason for root cause (Kafka timeout, broker down, auth failure)
  3. Check Kafka broker health
REMEDIATION:
  1. If Kafka recovered, replay failed events manually:
     - Copy original_event_id and payload
     - Re-insert into source schema outbox table
     - outbox-relay will re-attempt publish
  2. If Kafka still down, wait for Kafka recovery (events safe in DLQ)
PREVENTION: Improve Kafka monitoring, alert on broker downtime
```

**Incident 2: High relay lag (> 60 seconds)**
```
SYMPTOM: Alert fires "OutboxRelayLagHigh > 60"
CAUSE: Polling service crashed or slow queries
INVESTIGATION:
  1. Check outbox-relay service health: GET /health
  2. Query relay_state: SELECT * FROM outbox_relay.relay_state WHERE last_poll_time < now() - INTERVAL '60 seconds';
  3. Check Railway logs for outbox-relay service crashes
REMEDIATION:
  1. If service crashed, Railway auto-restarts (check deployment status)
  2. If service healthy but slow, check PostgreSQL query performance (EXPLAIN ANALYZE)
PREVENTION: Increase polling interval if query latency consistently high
```

### 9.5 SLOs (Service Level Objectives)

| SLO | Target | Measurement |
|-----|--------|-------------|
| **Event delivery latency (P95)** | ≤ 30 seconds | From outbox insert to Kafka publish |
| **Event delivery latency (P99)** | ≤ 60 seconds | Including retry scenarios |
| **Relay uptime** | ≥ 99.5% | Railway health checks |
| **Failed event rate** | < 0.1% | failed_events count / total events published |
| **DLQ drain time** | < 1 hour | Time to replay failed events after Kafka recovery |

---

## 10. ADR Compliance

| ADR | Requirement | Compliance Status |
|-----|-------------|-------------------|
| **ADR-001** | Schema-per-service isolation | ✅ `outbox_relay` schema owns relay_state, failed_events |
| **ADR-001** | No cross-schema foreign keys | ✅ Only SELECT/UPDATE permissions, no FKs |
| **ADR-001** | Cross-service validation via APIs | ✅ Not applicable (outbox-relay reads events, doesn't validate business data) |
| **ADR-003** | node-pg-migrate for migrations | ✅ 3 TypeScript migrations with UP/DOWN |
| **ADR-003** | Rollback migrations required | ✅ All migrations have DOWN rollback |
| **ADR-003** | Zero-downtime pattern | ✅ Expand-migrate-contract strategy |
| **ADR-016** | Automated partition lifecycle | ❌ Not applicable (relay_state, failed_events are low-volume, no partitions needed) |
| **ADR-017** | Fixture data extraction | ✅ Sample extraction queries provided in § 8.1 |

**Technical Debt (if any)**: None for MVP. Future optimization: Add automatic cleanup for failed_events > 90 days (deferred to data-retention-service).

---

## 11. Quality Gate Checklist

### 11.1 Design (Hoops Phase 2)

- [x] **RFC created** with business context and schema design
- [x] **Schema-per-service pattern** followed (outbox_relay schema)
- [x] **Data types** conform to standards (UUID, TIMESTAMPTZ, JSONB)
- [x] **Indexes justified** with query patterns and explain plans
- [x] **Constraints enforced** at database level (UNIQUE on schema_name)
- [x] **Cross-schema permissions** documented and justified
- [x] **Notion Data Layer** consulted and cited (§ Transactional Outbox Pattern)
- [x] **User Stories** consulted (none found for outbox-relay)
- [x] **ADR compliance** verified (ADR-001, ADR-003, ADR-017)

### 11.2 Migrations (Hoops Phase 2)

- [ ] **node-pg-migrate** migrations created (3 migrations)
- [ ] **Forward migrations** (UP) documented with explanations
- [ ] **Rollback migrations** (DOWN) documented with validation steps
- [ ] **Zero-downtime migration plan** documented (expand-migrate-contract)
- [ ] **Migration tests** written (Testcontainers PostgreSQL)
- [ ] **Rollback safety** verified (all scenarios documented)

### 11.3 Testing (Hoops Phase 2)

- [ ] **Failing integration tests** written BEFORE Blake's implementation
- [ ] **Testcontainers PostgreSQL** used for integration tests
- [ ] **Schema verification** tests (tables, columns, constraints)
- [ ] **Index verification** tests (all indexes created)
- [ ] **Permission verification** tests (SELECT/UPDATE granted, INSERT/DELETE denied)
- [ ] **Rollback verification** tests (DOWN migrations remove schema)
- [ ] **Representative test data** included (edge cases: nulls, unicode, large payloads)

### 11.4 Documentation (Hoops Phase 2)

- [x] **RFC complete** with all sections (business context, schema, migrations, tests, fixtures)
- [x] **Query patterns** documented with explain plans
- [x] **Performance targets** specified (P95/P99 latency)
- [x] **Operational runbooks** provided (incident response)
- [x] **Fixture data samples** provided for Jessie (ADR-017 compliance)
- [x] **ERD diagram** included (relay_state, failed_events, external outbox tables)

### 11.5 Phase 2 Hand-Off to Blake

**BLOCKING RULES**:
- ✅ Phase 2 cannot complete without GREEN migrations (all tests pass)
- ✅ Phase 3 cannot begin without Hoops sign-off
- ✅ Technical debt MUST be recorded in Notion › Technical Debt Register

**Deliverables for Blake**:
1. ✅ This RFC document
2. ⏳ 3 node-pg-migrate migration files (to be created)
3. ⏳ Failing integration tests (to be written)
4. ✅ Fixture data extraction queries (§ 8.1)

---

## 12. ERD (Entity-Relationship Diagram)

```
┌─────────────────────────────────────────────────────────────────┐
│                    outbox_relay Schema                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ relay_state                                               │ │
│  ├───────────────────────────────────────────────────────────┤ │
│  │ id UUID PK                                                │ │
│  │ schema_name VARCHAR(100) UNIQUE                           │ │
│  │ table_name VARCHAR(100)                                   │ │
│  │ last_poll_time TIMESTAMPTZ                                │ │
│  │ last_published_event_id UUID (nullable)                   │ │
│  │ total_events_published BIGINT                             │ │
│  │ created_at TIMESTAMPTZ                                    │ │
│  │ updated_at TIMESTAMPTZ                                    │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ failed_events (DLQ)                                       │ │
│  ├───────────────────────────────────────────────────────────┤ │
│  │ id UUID PK                                                │ │
│  │ original_event_id UUID                                    │ │
│  │ source_schema VARCHAR(100)                                │ │
│  │ source_table VARCHAR(100)                                 │ │
│  │ event_type VARCHAR(100)                                   │ │
│  │ payload JSONB                                             │ │
│  │ failure_reason TEXT                                       │ │
│  │ failure_count INT                                         │ │
│  │ first_failed_at TIMESTAMPTZ                               │ │
│  │ last_failed_at TIMESTAMPTZ                                │ │
│  │ created_at TIMESTAMPTZ                                    │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              External Service Schemas (READ/UPDATE ONLY)        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  journey_matcher.outbox                                         │
│  whatsapp_handler.outbox_events  (variation: different name)   │
│  darwin_ingestor.outbox                                         │
│  timetable_loader.outbox                                        │
│  data_retention.outbox                                          │
│  (Future service outbox tables...)                              │
│                                                                 │
│  Common structure:                                              │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ {schema_name}.outbox                                      │ │
│  ├───────────────────────────────────────────────────────────┤ │
│  │ id UUID PK                                                │ │
│  │ aggregate_id UUID                                         │ │
│  │ aggregate_type VARCHAR(100)                               │ │
│  │ event_type VARCHAR(100)                                   │ │
│  │ payload JSONB                                             │ │
│  │ correlation_id UUID                                       │ │
│  │ created_at TIMESTAMPTZ                                    │ │
│  │ published_at TIMESTAMPTZ (or processed_at)                │ │
│  │ published BOOLEAN                                         │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Relationships:
- relay_state.schema_name → External schemas (logical, no FK)
- failed_events.source_schema → External schemas (logical, no FK)
- failed_events.original_event_id → External outbox.id (logical, no FK)

Per ADR-001: NO foreign keys across schemas (schema-per-service isolation)
```

---

## 13. Next Steps

### 13.1 Hoops (Phase 2 Remaining Tasks)

1. ✅ **RFC complete** (this document)
2. ⏳ **Create 3 migrations** using node-pg-migrate:
   - Migration 1: Create schema + relay_state table
   - Migration 2: Create failed_events table
   - Migration 3: Grant cross-schema permissions
3. ⏳ **Write failing integration tests** using Testcontainers PostgreSQL
4. ⏳ **Verify migrations** with Postgres MCP (post-migration quality gate)
5. ⏳ **Record technical debt** (if any) in Notion › Technical Debt Register
6. ⏳ **Hand off GREEN migrations** to Blake (Phase 3)

### 13.2 Blake (Phase 3 - Blocked Until Hoops Completes)

- Implement polling logic to make tests pass
- Implement Kafka publisher
- Implement retry with exponential backoff
- Implement DLQ insertion after max retries
- Make all Hoops's failing tests GREEN

### 13.3 Jessie (Phase 4 - Blocked Until Blake Completes)

- Verify test coverage (≥80% lines/functions/statements, ≥75% branches)
- Use fixture data samples from § 8.1 to populate test fixtures
- Verify edge cases (nulls, unicode, large payloads, table variations)
- QA sign-off

### 13.4 Moykle (Phase 5 - Blocked Until Jessie Completes)

- Create manual Railway snapshot before migration
- Deploy migrations to production
- Deploy outbox-relay service
- Configure Prometheus alerts
- Run smoke tests
- Verify health checks

### 13.5 Quinn (Phase 6 - Final Verification)

- Verify all behavioral ACs from Specification § 5
- Verify technical debt recorded
- Close Phase 2
- Approve hand-off to Phase 3

---

## References

- **Specification**: `/services/outbox-relay/docs/phases/PHASE-1-SPECIFICATION.md`
- **Notion**: Architecture › Data Layer § Transactional Outbox Pattern
- **Notion**: Architecture › Service Layer § 14 (outbox-relay specification)
- **ADR-001**: Schema-Per-Service Database Isolation Pattern
- **ADR-003**: Node-pg-migrate as Migration Tool Standard
- **ADR-017**: Fixture Data Extraction from Real Data
- **SOPs**: Standard Operating Procedures Phase 2 requirements

---

**RFC Author**: Hoops (Data Architect)
**Date**: 2026-01-10
**Status**: Draft → Ready for Migration Implementation
**Next Phase**: Phase 2 (Create migrations and failing tests) → Phase 3 (Blake implementation)

---

**BLOCKING RULE**: Phase 3 cannot begin without:
1. ✅ This RFC approved
2. ⏳ 3 node-pg-migrate migrations created
3. ⏳ Failing integration tests written
4. ⏳ Postgres MCP verification complete
5. ⏳ Technical debt recorded (if any)
