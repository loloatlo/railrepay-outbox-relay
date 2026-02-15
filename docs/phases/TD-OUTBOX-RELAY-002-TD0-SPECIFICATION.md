# TD-OUTBOX-RELAY-002: SCHEMA_TABLE_MAP Missing delay_tracker Entry

## Phase TD-0: Specification

**Date**: 2026-02-10
**Backlog Item**: BL (page ID: `303815ba-72ee-81ec-b475-dff07e301514`)
**Type**: Tech Debt
**Severity**: BLOCKING
**Service**: outbox-relay
**Domain**: Platform Infrastructure

---

## Problem Description

The outbox-relay service has a hardcoded `SCHEMA_TABLE_MAP` in `src/index.ts` (lines 430-435) that maps schema names to their outbox table names and timestamp columns:

```typescript
const SCHEMA_TABLE_MAP: Record<string, { table: string; timestampColumn: 'published_at' | 'processed_at' }> = {
  whatsapp_handler: { table: 'outbox_events', timestampColumn: 'published_at' },
  darwin_ingestor: { table: 'outbox_events', timestampColumn: 'published_at' },
  journey_matcher: { table: 'outbox', timestampColumn: 'processed_at' },
  data_retention: { table: 'outbox', timestampColumn: 'published_at' },
};
```

The `delay_tracker` schema is **missing** from this map.

## Root Cause

When `delay_tracker` was added to the `OUTBOX_SCHEMAS` environment variable (as part of TD-DELAY-TRACKER-003 Kafka consumer wiring work), the corresponding entry was not added to `SCHEMA_TABLE_MAP`. The fallback code at lines 460-470 defaults to `table: 'outbox_events'` with `timestampColumn: 'published_at'`.

However, delay-tracker's outbox table is:
- Named `outbox` (not `outbox_events`)
- Uses `processed_at` as its timestamp column (not `published_at`)

## Impact

- outbox-relay attempts to poll `delay_tracker.outbox_events` which **does not exist**
- delay-tracker events (`delay.detected`, `delay.not-detected`, `journey.monitoring-registered`) are **never relayed to Kafka**
- The delay detection pipeline is broken at the outbox relay step (E2E pipeline Step 15)

## Fix

Add one line to `SCHEMA_TABLE_MAP` in `src/index.ts`:

```typescript
delay_tracker: { table: 'outbox', timestampColumn: 'processed_at' },
```

## Acceptance Criteria

- [ ] **AC-1**: `SCHEMA_TABLE_MAP` includes `delay_tracker` entry with `table: 'outbox'` and `timestampColumn: 'processed_at'`
- [ ] **AC-2**: outbox-relay polls `delay_tracker.outbox` (not `delay_tracker.outbox_events`)
- [ ] **AC-3**: delay-tracker outbox events (`delay.detected`, `delay.not-detected`, `journey.monitoring-registered`) are relayed to Kafka
- [ ] **AC-4**: No regression in existing outbox-relay tests

## Verification Method

| AC | Method |
|----|--------|
| AC-1 | Unit test asserting `parseSchemaConfigs()` returns correct config when `OUTBOX_SCHEMAS` includes `delay_tracker` |
| AC-2 | Unit test verifying the poller receives `{ schema: 'delay_tracker', table: 'outbox', timestampColumn: 'processed_at' }` |
| AC-3 | Post-deployment log verification showing successful poll of `delay_tracker.outbox` |
| AC-4 | Full test suite passes with zero regressions |

## Technical Context

### delay_tracker.outbox Table Schema

```
id              SERIAL PRIMARY KEY
aggregate_id    VARCHAR(255)
aggregate_type  VARCHAR(255)
event_type      VARCHAR(255)
payload         JSONB
correlation_id  VARCHAR(255)
status          VARCHAR(50) DEFAULT 'pending'
retry_count     INTEGER DEFAULT 0
error_message   TEXT
created_at      TIMESTAMPTZ DEFAULT NOW()
processed_at    TIMESTAMPTZ (NULL = unprocessed)
published_at    TIMESTAMPTZ
```

### parseSchemaConfigs Function (lines 442-475)

The function reads `OUTBOX_SCHEMAS` env var, splits by comma, and for each schema:
1. Looks up `SCHEMA_TABLE_MAP[schemaName]`
2. If found: uses the mapped table and timestamp column
3. If NOT found: logs a warning and falls back to `{ table: 'outbox_events', timestampColumn: 'published_at' }`

The fix is to add the mapping so delay_tracker hits the correct code path (step 2 instead of step 3).

### Existing Test Coverage

Current test file (`src/__tests__/unit/index.test.ts`) covers:
- Express app creation
- Health/metrics route mounting
- Export verification for `createApp`, `initializeDatabase`, `initializeKafka`, `gracefulShutdown`

It does NOT test `parseSchemaConfigs` or `SCHEMA_TABLE_MAP`. Jessie will add tests for this.

## Scope Assessment

- **Files changed**: 1 (`src/index.ts`)
- **Lines changed**: 1 (add entry to SCHEMA_TABLE_MAP)
- **Schema changes**: None (delay_tracker.outbox already exists)
- **Hoops needed**: No (no data layer changes)
- **ADR needed**: No (follows existing SCHEMA_TABLE_MAP pattern)
- **Risk**: Very low -- adding a map entry following existing convention

## Related Items

- TD-OUTBOX-001: Outbox Table Schema Inconsistency (explains why different schemas use different table/column names)
- TD-DELAY-TRACKER-003: Kafka Consumer Wiring (added delay_tracker to OUTBOX_SCHEMAS)
- TD-OUTBOX-RELAY-001: Migration Tracking Isolation (ADR-018)

## Workflow Plan

| Phase | Agent | Deliverables |
|-------|-------|-------------|
| TD-0 | Quinn | This specification, BL item created |
| TD-1 | Jessie | Failing tests for SCHEMA_TABLE_MAP delay_tracker entry |
| TD-2 | Blake | Add delay_tracker entry to SCHEMA_TABLE_MAP |
| TD-3 | Jessie | QA sign-off, coverage verification |
| TD-4 | Moykle | Deploy to Railway |
| TD-5 | Quinn | Post-deployment verification, close BL item |
