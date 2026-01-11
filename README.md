# outbox-relay Service

**Status**: 🟢 **DEPLOYED TO PRODUCTION** (Phase 6 Complete)
**Type**: Infrastructure Service
**Technology**: TypeScript (Node.js), KafkaJS
**Owner**: Blake (Maintenance)
**Deployment URL**: https://railrepay-outbox-relay-production.up.railway.app
**Deployment Date**: 2026-01-11

---

## Overview

**outbox-relay** ensures exactly-once event delivery from all RailRepay microservices to Kafka using the Transactional Outbox Pattern.

### Purpose
- Polls transactional outbox tables in each service schema
- Publishes events to Kafka with exactly-once delivery guarantee
- Handles failures with retry and dead-letter queue (DLQ) pattern
- Monitors lag and emits observability metrics

### Business Context
Solves the **dual-write problem**: ensures database changes and event publishing happen atomically. Without outbox-relay, events could be lost, duplicated, or inconsistent with database state.

---

## Architecture

```
Service Schemas (journey_matcher, whatsapp_handler, etc.)
    ↓ (writes to outbox table in same transaction as business data)
outbox_relay (polls every 10 seconds)
    ↓ (publishes to Kafka)
Kafka Topics (journey.created, user.registered, etc.)
    ↓ (consumed by downstream services)
Event Consumers
```

### Key Design Patterns
- **Transactional Outbox**: Events written to outbox table in same transaction as business data
- **Exactly-Once Delivery**: Row-level locks (`FOR UPDATE SKIP LOCKED`) + published flag
- **Multi-Schema Polling**: Cross-schema operational service (like data-retention-service)
- **Dead-Letter Queue**: Failed events after 10 retries → `failed_events` table

---

## Schema

**Schema Name**: `outbox_relay`
**Owner**: outbox-relay service

### Tables
1. `relay_state` - Tracks polling state per schema
2. `failed_events` - Dead-letter queue for events that fail after max retries

### Cross-Schema Access
**READ + UPDATE** permissions on ALL service outbox tables:
- `whatsapp_handler.outbox_events`
- `journey_matcher.outbox`
- `darwin_ingestor.outbox`
- `timetable_loader.outbox`
- `data_retention.outbox`
- (Future service schemas)

---

## API

### Health Check
```
GET /health
Response: 200 OK
{
  "status": "healthy",
  "service": "outbox-relay",
  "lastPollTime": "2026-01-10T11:59:50Z",
  "unpublishedEventCount": 0
}
```

### Metrics
```
GET /metrics
Response: Prometheus text format

# METRICS
outbox_relay_events_published{schema="journey_matcher",event_type="journey.created"} 1234
outbox_relay_poll_duration_seconds{schema="journey_matcher"} 0.05
outbox_relay_failed_events{schema="journey_matcher"} 0
outbox_relay_lag_seconds{schema="journey_matcher"} 5
```

---

## Configuration

### Environment Variables

**Required**:
```bash
DATABASE_URL=postgresql://postgres:***@postgres.railway.internal:5432/railway
DATABASE_SCHEMA=outbox_relay
SERVICE_NAME=outbox-relay
POLL_INTERVAL_MS=10000  # 10 seconds
OUTBOX_SCHEMAS=whatsapp_handler,journey_matcher,darwin_ingestor,timetable_loader,data_retention
```

**Optional (External Kafka)**:
```bash
KAFKA_BROKERS=kafka.railway.internal:9092
KAFKA_USERNAME=***
KAFKA_PASSWORD=***
```

**Observability**:
```bash
LOKI_HOST=https://logs-prod-035.grafana.net
LOKI_BASIC_AUTH=1197629:glc_***
ALLOY_PUSH_URL=http://railway-grafana-alloy.railway.internal:9091/api/v1/metrics/write
```

---

## Behavioral Acceptance Criteria

**15 ACs** defined in `docs/phases/PHASE-1-SPECIFICATION.md`:

### Core Delivery Guarantees
1. Events appear in Kafka within 30 seconds (P95)
2. Exactly-once delivery (no duplicates)
3. Events for same aggregate ordered by `created_at`
4. No data loss if Kafka unavailable for 1 hour

### Multi-Schema Operations
5. Polls all schemas from configuration
6. Handles both `outbox` and `outbox_events` table names
7. Schema failure isolation (one schema failure doesn't block others)

### Error Handling
8. Retry with exponential backoff (1s → 5min max)
9. Dead-letter queue after 10 retries
10. Failed events include failure reason, count, timestamps

### Observability
11. Emits 4 Prometheus metrics (events_published, poll_duration, failed_events, lag_seconds)
12. Operator can detect failure within 5 minutes
13. Lag monitoring shows oldest unpublished event age

### Configuration
14. Schema list from `OUTBOX_SCHEMAS` env var
15. Auto-detects `outbox` or `outbox_events` table name

---

## Development Status

### Phase 0: Prerequisites Verification ✅
- **Owner**: Quinn
- **Status**: Complete
- **Deliverable**: `docs/phases/PHASE-0-PREREQUISITES.md`
- **Quality Gate**: PASSED (all prerequisites verified)

### Phase 1: Specification ✅
- **Owner**: Quinn
- **Status**: Complete
- **Deliverable**: `docs/phases/PHASE-1-SPECIFICATION.md`
- **Quality Gate**: PASSED (15 behavioral ACs defined)

### Phase 2: Data Layer ⏳
- **Owner**: Hoops (Data Architect)
- **Status**: Pending
- **Deliverables**:
  - RFC for `outbox_relay` schema
  - Migrations (forward + rollback) using node-pg-migrate
  - Cross-schema permission grants
  - Failing integration tests (Testcontainers PostgreSQL)
- **BLOCKING**: Phase 3 cannot begin without GREEN migrations

### Phase 3: Implementation ⏳
- **Owner**: Blake (Backend Engineer)
- **Status**: Pending

### Phase 4: QA ⏳
- **Owner**: Jessie (QA & TDD Enforcer)
- **Status**: Pending

### Phase 5: Deployment ⏳
- **Owner**: Moykle (DevOps Engineer)
- **Status**: Pending

### Phase 6: Verification ⏳
- **Owner**: Quinn
- **Status**: Pending

---

## ADR Compliance

| ADR | Title | Compliance |
|-----|-------|------------|
| ADR-001 | Schema-per-Service | ✅ `outbox_relay` schema with cross-schema READ/UPDATE |
| ADR-002 | Correlation IDs | ✅ All logs include correlation_id |
| ADR-003 | node-pg-migrate | ✅ Hoops will use in Phase 2 |
| ADR-006 | Prometheus Metrics | ✅ 4 metrics defined |
| ADR-007 | Winston + Loki | ✅ @railrepay/winston-logger |
| ADR-008 | Health Checks | ✅ GET `/health` endpoint |
| ADR-013 | SERVICE_NAME | ✅ `outbox-relay` |
| ADR-014 | TDD Mandate | ✅ Failing tests FIRST |

---

## References

- **Service Layer Spec**: Notion › Architecture › Service Layer § 14
- **Data Layer Spec**: Notion › Architecture › Data Layer
- **Phase 0 Doc**: `docs/phases/PHASE-0-PREREQUISITES.md`
- **Phase 1 Doc**: `docs/phases/PHASE-1-SPECIFICATION.md`

---

## Next Steps

**Current Phase**: Ready for Phase 2 hand-off to Hoops

**Hoops Tasks**:
1. Create RFC for `outbox_relay` schema design
2. Write migrations for `relay_state` and `failed_events` tables
3. Grant cross-schema permissions (READ + UPDATE on all outbox tables)
4. Write failing integration tests using Testcontainers
5. Verify zero-downtime migration plan

---

**Last Updated**: 2026-01-10
**Documentation Owner**: Quinn
