# Phase 1: Specification - outbox-relay Service

**Service**: outbox-relay
**Phase**: 1 - Specification
**Owner**: Quinn (Product Owner & Chief Orchestrator)
**Date**: 2026-01-10
**Status**: ✅ COMPLETE

---

## Phase 1 Overview

This specification document defines WHAT the outbox-relay service must accomplish, extracted from **Notion › Architecture › Service Layer § 14** and **Data Layer** documentation. This is the authoritative specification for Phases 2-6.

**Source of Truth**: Notion › RailRepay MVP › Architecture › Service Layer § 14

---

## 1. Service Purpose

**outbox-relay** is an infrastructure service that ensures exactly-once event delivery from all RailRepay microservices to Kafka using the Transactional Outbox Pattern.

### Core Responsibilities
1. Poll transactional outbox tables in each service schema (multi-schema operation)
2. Publish events to Kafka with exactly-once delivery guarantee
3. Handle failures with retry and dead-letter queue (DLQ) pattern
4. Monitor lag and emit observability metrics for operational alerting

### Business Context
Without outbox-relay, events would be:
- Lost during service crashes (dual-write problem)
- Duplicated if retry logic is naive
- Inconsistent with database state (eventual consistency broken)

outbox-relay solves the **dual-write problem**: changes to business data and event publishing happen in a single atomic transaction via the outbox table.

---

## 2. Technology Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| **Language** | TypeScript | 5.x | Per ADR-002 (all services) |
| **Runtime** | Node.js | 20+ | Railway standard |
| **Framework** | Express.js | 5.x | HTTP health endpoint |
| **Database Client** | @railrepay/postgres-client | Latest | Shared library (ADR-001) |
| **Messaging** | KafkaJS | 2.x | Kafka producer |
| **Logging** | @railrepay/winston-logger | Latest | Correlation IDs (ADR-002) |
| **Metrics** | @railrepay/metrics-pusher | Latest | Prometheus metrics (ADR-006) |
| **Health Check** | @railrepay/health-check | Latest | Health endpoint (ADR-008) |
| **Migrations** | node-pg-migrate | Latest | Schema migrations (ADR-003) |

---

## 3. API Design

### 3.1 REST API

#### Health Check Endpoint (Required per ADR-008)
```
GET /health
Response: 200 OK
{
  "status": "healthy",
  "service": "outbox-relay",
  "timestamp": "2026-01-10T12:00:00Z",
  "uptime": 3600,
  "lastPollTime": "2026-01-10T11:59:50Z",
  "unpublishedEventCount": 0
}
```

**Health Check Criteria**:
- PostgreSQL connection healthy
- Last poll completed within 30 seconds
- Kafka producer connected (if external Kafka configured)

#### Metrics Endpoint (Required per ADR-006)
```
GET /metrics
Response: 200 OK (Prometheus text format)
```

### 3.2 Cron/Polling Pattern

**Type**: Polling service (NOT webhook-driven)
**Polling Interval**: 10 seconds (configurable via `POLL_INTERVAL_MS`)
**Pattern**: Single-threaded poller with row-level locks

```typescript
// Pseudo-code polling loop
setInterval(async () => {
  for (const schema of configuredSchemas) {
    const events = await pollUnpublishedEvents(schema);
    for (const event of events) {
      await publishToKafka(event);
      await markAsPublished(event.id);
    }
  }
}, POLL_INTERVAL_MS);
```

---

## 4. Data Layer Requirements

### 4.1 Schema Ownership

**Schema Name**: `outbox_relay`
**Owner**: outbox-relay service
**Tables**:
1. `relay_state` - Tracks polling state per schema
2. `failed_events` - Dead-letter queue for events that fail after max retries

### 4.2 Cross-Schema Access

**CRITICAL**: outbox-relay is a **cross-schema operational service**.

**READ + UPDATE Access Required** to ALL service outbox tables:
- `whatsapp_handler.outbox_events`
- `journey_matcher.outbox`
- `darwin_ingestor.outbox`
- `timetable_loader.outbox`
- `data_retention.outbox`
- (Future service schemas as they are added)

**Pattern**: Similar to `data-retention-service` (already deployed with cross-schema access).

### 4.3 Outbox Table Standard (from Data Layer)

Each service schema MUST have an outbox table with this structure:

```sql
CREATE TABLE {schema_name}.outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id UUID NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  published BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_{schema_name}_outbox_unpublished
  ON {schema_name}.outbox (created_at)
  WHERE published = false;
```

**Variation Tolerance** (Service Layer § 14):
- Table name: `outbox` OR `outbox_events`
- Published column: `published_at` OR `processed_at` (TIMESTAMPTZ, NULL = unpublished)

### 4.4 outbox_relay Schema Tables

#### relay_state Table
```sql
CREATE TABLE outbox_relay.relay_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_name VARCHAR(100) NOT NULL UNIQUE,
  table_name VARCHAR(100) NOT NULL,
  last_poll_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_published_event_id UUID,
  total_events_published BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### failed_events Table (Dead-Letter Queue)
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

CREATE INDEX idx_failed_events_source
  ON outbox_relay.failed_events (source_schema, source_table);
```

---

## 5. Behavioral Acceptance Criteria

**Source**: Notion › Architecture › Service Layer § 14 (Refined Behavioral ACs)

These are **outcome-oriented, testable requirements** that Jessie will verify in Phase 4.

### 5.1 Core Delivery Guarantees

| # | Behavioral AC | Verification Method | Test Type |
|---|---------------|---------------------|-----------|
| AC-1 | **Delivery Latency**: Events appear in Kafka within 30 seconds of outbox insert (P95) | Timestamp comparison test | Integration |
| AC-2 | **Exactly-Once Delivery**: Each event appears exactly once in Kafka, verified by event `id` (UUID) | Duplicate detection test | Integration |
| AC-3 | **Ordering Guarantee**: Events for same `aggregate_id` published in `created_at` order | Sequence verification test | Integration |
| AC-4 | **Failure Resilience**: No events lost if Kafka unavailable for up to 1 hour | Kafka outage simulation | Integration |

### 5.2 Multi-Schema Operations

| # | Behavioral AC | Verification Method | Test Type |
|---|---------------|---------------------|-----------|
| AC-5 | **Schema Discovery**: Service polls all schemas listed in configuration | Config-driven test | Integration |
| AC-6 | **Schema Variation Tolerance**: Handles both `outbox` and `outbox_events` table names, `published_at` or `processed_at` columns | Multi-schema integration test | Integration |
| AC-7 | **Partition Isolation**: Failure to poll one schema does not block polling of other schemas | Failure isolation test | Integration |

### 5.3 Error Handling & Recovery

| # | Behavioral AC | Verification Method | Test Type |
|---|---------------|---------------------|-----------|
| AC-8 | **Retry with Backoff**: Failed publish attempts retried with exponential backoff (initial: 1s, max: 5 minutes) | Retry timing test | Integration |
| AC-9 | **Retry Exhaustion**: After 10 consecutive failures, moves to `failed_events` table and alert fires | Failure injection test | Integration |
| AC-10 | **Dead Letter Queue**: Failed events include original data, failure reason, count, timestamps | DLQ inspection test | Integration |

### 5.4 Observability

| # | Behavioral AC | Verification Method | Test Type |
|---|---------------|---------------------|-----------|
| AC-11 | **Metrics Emission**: Emits `outbox_relay_events_published` (counter), `outbox_relay_poll_duration` (histogram), `outbox_relay_failed_events` (gauge) | Metrics endpoint test | Integration |
| AC-12 | **Failure Detection**: Operator can detect relay failure within 5 minutes via dashboard/alerts | Alert threshold test | E2E |
| AC-13 | **Lag Monitoring**: Metric `outbox_relay_lag_seconds` shows max age of oldest unpublished event per schema | Lag detection test | Integration |

### 5.5 Configuration Requirements

| # | Behavioral AC | Verification Method | Test Type |
|---|---------------|---------------------|-----------|
| AC-14 | **Schema Configuration**: Service reads schema list from `OUTBOX_SCHEMAS` environment variable | Config test | Unit |
| AC-15 | **Table Discovery**: Automatically detects `outbox` or `outbox_events` table name per schema | Discovery test | Integration |

---

## 6. Non-Functional Requirements

### 6.1 Performance

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Polling Frequency** | Every 10 seconds | Configurable via `POLL_INTERVAL_MS` |
| **Event Latency (P95)** | ≤ 30 seconds | From outbox insert to Kafka publish |
| **Event Latency (P99)** | ≤ 60 seconds | Including retry scenarios |
| **Throughput** | 1000 events/minute | MVP baseline |
| **Memory Footprint** | ≤ 256MB RAM | Railway vertical scaling |

### 6.2 Reliability

| Requirement | Implementation |
|-------------|----------------|
| **Exactly-Once Delivery** | Row-level locks (`FOR UPDATE SKIP LOCKED`) + published flag |
| **Zero Data Loss** | Events remain in outbox until successfully published |
| **Failure Recovery** | Automatic retry with exponential backoff |
| **DLQ for Poison Messages** | After 10 retries → `failed_events` table |

### 6.3 Scalability

| Constraint | MVP Strategy | Future Strategy |
|------------|-------------|-----------------|
| **Concurrency** | Single instance (locks prevent duplicates) | Partitioned polling (shard by schema) |
| **Schema Growth** | Configuration-driven (add to `OUTBOX_SCHEMAS`) | Auto-discovery via information_schema |
| **Event Volume** | 1000 events/min (sufficient for MVP) | Horizontal scaling with partition keys |

### 6.4 Security

| Requirement | Implementation |
|-------------|----------------|
| **Database Access** | Cross-schema READ + UPDATE permissions via PostgreSQL roles |
| **Kafka Authentication** | SASL/SSL (if external Kafka configured) |
| **Secrets Management** | Railway environment variables (never committed to git) |
| **Audit Trail** | All events logged with correlation IDs (ADR-002) |

### 6.5 Observability

Per **ADR-002, ADR-006, ADR-007**:

| Requirement | Implementation |
|-------------|----------------|
| **Structured Logging** | Winston with Loki transport (JSON format) |
| **Correlation IDs** | All logs include correlation_id from event payload |
| **Metrics** | Prometheus metrics pushed to Grafana Alloy |
| **Health Checks** | GET `/health` endpoint with DB + Kafka status |
| **Alerts** | `outbox_relay_failed_events > 0`, `outbox_relay_lag_seconds > 60` |

---

## 7. Environment Variables

Per **Prerequisites & Credentials** and **Service Layer § 14**:

### Universal (All Services)
```bash
# PostgreSQL
DATABASE_URL=postgresql://postgres:***@postgres.railway.internal:5432/railway
DATABASE_SCHEMA=outbox_relay
PGHOST=postgres.railway.internal
PGPORT=5432
PGDATABASE=railway
PGUSER=postgres
PGPASSWORD=***
PGSSLMODE=require

# Service Configuration
SERVICE_NAME=outbox-relay  # Per ADR-013
NODE_ENV=production
LOG_LEVEL=info
PORT=3012

# Redis (NOT required for outbox-relay)
# REDIS_URL=redis://default:***@redis.railway.internal:6379
```

### Observability
```bash
# Loki (Logging)
LOKI_HOST=https://logs-prod-035.grafana.net
LOKI_BASIC_AUTH=1197629:glc_***
LOKI_ENABLED=true
LOKI_LEVEL=info

# Metrics (Prometheus via Alloy)
ALLOY_PUSH_URL=http://railway-grafana-alloy.railway.internal:9091/api/v1/metrics/write
METRICS_PORT=9090
METRICS_PUSH_INTERVAL=15000  # 15 seconds
```

### Service-Specific (outbox-relay)
```bash
# Polling Configuration
POLL_INTERVAL_MS=10000  # 10 seconds
MAX_RETRIES=10
RETRY_INITIAL_DELAY_MS=1000
RETRY_MAX_DELAY_MS=300000  # 5 minutes

# Schema Configuration (comma-separated list)
OUTBOX_SCHEMAS=whatsapp_handler,journey_matcher,darwin_ingestor,timetable_loader,data_retention

# Kafka Configuration (OPTIONAL for MVP)
KAFKA_BROKERS=kafka.railway.internal:9092  # Or external Confluent Cloud
KAFKA_SASL_MECHANISM=PLAIN
KAFKA_USERNAME=***  # If external Kafka
KAFKA_PASSWORD=***  # If external Kafka
KAFKA_SSL=true      # If external Kafka
```

---

## 8. Integration Patterns

### 8.1 Database Polling Pattern

**SQL Query** (for each schema):
```sql
SELECT *
FROM {schema_name}.outbox
WHERE published = false
ORDER BY created_at
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

**Row-Level Locks**: `FOR UPDATE SKIP LOCKED` ensures exactly-once processing even with multiple poller instances (future scaling).

### 8.2 Kafka Publishing Pattern

**Topic Naming**: Use `event_type` from outbox table as Kafka topic
**Message Key**: Use `aggregate_id` for partition ordering
**Message Value**: `payload` JSONB as-is

```typescript
await kafka.send({
  topic: event.event_type,
  messages: [{
    key: event.aggregate_id,
    value: JSON.stringify(event.payload),
    headers: {
      'correlation-id': event.correlation_id,
      'event-id': event.id,
      'created-at': event.created_at.toISOString()
    }
  }]
});
```

### 8.3 Failure Handling Pattern

**Retry with Exponential Backoff**:
```typescript
const delays = [1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 300s (max)];
for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    await publishToKafka(event);
    await markAsPublished(event.id);
    return;
  } catch (error) {
    await sleep(delays[attempt]);
  }
}
// After MAX_RETRIES, move to DLQ
await moveToFailedEvents(event, error);
```

---

## 9. Definition of Done

Per **SOPs Template**, outbox-relay is complete when:

### 9.1 Design
- [x] Notion requirements referenced (Service Layer § 14, Data Layer)
- [x] All 15 behavioral ACs documented
- [x] Non-functional requirements specified (performance, reliability, security)

### 9.2 TDD (Test-Driven Development)
- [ ] Failing tests authored FIRST (unit + integration + E2E)
- [ ] Implementation written to pass tests
- [ ] Refactoring completed while tests stay green
- [ ] All tests passing in CI

### 9.3 Data (Database Requirements)
- [ ] RFC written with business context and schema design (Hoops Phase 2)
- [ ] Forward and rollback migrations created (node-pg-migrate)
- [ ] Zero-downtime migration plan documented
- [ ] Migration tests pass with Testcontainers
- [ ] Cross-schema permissions granted (READ + UPDATE on all outbox tables)

### 9.4 Code Quality
- [ ] TypeScript types precise (no `any`)
- [ ] ESLint and Prettier clean
- [ ] No TODO comments
- [ ] Security scan clean
- [ ] Code reviewed by Jessie (QA)

### 9.5 Observability
- [ ] Winston logs with correlation IDs
- [ ] Prometheus metrics: `outbox_relay_events_published`, `outbox_relay_poll_duration`, `outbox_relay_failed_events`, `outbox_relay_lag_seconds`
- [ ] Loki log fields validated by tests
- [ ] Error cases log appropriate severity
- [ ] Dashboard panels created

### 9.6 Documentation
- [ ] README updated with service overview
- [ ] RFC created for `outbox_relay` schema (Hoops)
- [ ] API documentation (health endpoint OpenAPI spec)
- [ ] Runbook created (Moykle)

### 9.7 Release (per ADR-005)
- [ ] Smoke tests passed (verify event publishing end-to-end)
- [ ] Railway deployment successful
- [ ] Runbook updated
- [ ] Dashboards and alerts configured
- [ ] Database backup completed before migrations
- [ ] SLO monitors configured
- [ ] Rollback plan verified

### 9.8 Technical Debt
- [ ] All shortcuts documented in Notion › Technical Debt Register
- [ ] Coverage gaps recorded
- [ ] Deferred work itemized

### 9.9 Sign-Offs
- [ ] Hoops approved (data layer)
- [ ] Blake approved (implementation)
- [ ] Jessie approved (QA + coverage ≥80% lines/functions/statements, ≥75% branches)
- [ ] Moykle approved (deployment)
- [ ] Quinn final approval (quality gate)

---

## 10. ADR Compliance Checklist

| ADR | Requirement | Implementation | Status |
|-----|-------------|----------------|--------|
| ADR-001 | Schema-per-service isolation | `outbox_relay` schema, cross-schema READ/UPDATE only | ✅ Specified |
| ADR-002 | Correlation IDs in logs | Use @railrepay/winston-logger with correlation_id | ✅ Specified |
| ADR-003 | node-pg-migrate for migrations | Hoops will use in Phase 2 | ⏳ Pending |
| ADR-004 | Testcontainers for integration tests | Jessie will use in Phase 4 | ⏳ Pending |
| ADR-005 | Railway rollback (no canary) | Direct production deploy with rollback plan | ✅ Specified |
| ADR-006 | Prometheus metrics | 4 metrics defined (events_published, poll_duration, failed_events, lag_seconds) | ✅ Specified |
| ADR-007 | Winston + Loki logging | Use @railrepay/winston-logger | ✅ Specified |
| ADR-008 | Health check endpoint | GET `/health` with DB + Kafka status | ✅ Specified |
| ADR-010 | Smoke tests | Verify event publishing after deployment | ✅ Specified |
| ADR-011 | Prometheus alert rules | Alerts for failed_events > 0, lag > 60s | ✅ Specified |
| ADR-012 | OpenAPI specification | Health endpoint only (minimal API) | ✅ Specified |
| ADR-013 | SERVICE_NAME env var | `SERVICE_NAME=outbox-relay` | ✅ Specified |
| ADR-014 | TDD mandate | Failing tests FIRST, coverage ≥80%/75% | ✅ Specified |
| ADR-016 | Automated partition lifecycle | Not applicable (relay_state/failed_events are low-volume) | N/A |

---

## 11. Risks and Assumptions

### Risks
| Risk | Mitigation |
|------|------------|
| **Cross-schema permissions complexity** | Hoops will document in RFC, follow data-retention-service pattern |
| **Kafka unavailability** | Events remain in outbox, retry with backoff |
| **Poison messages blocking queue** | DLQ pattern after max retries |
| **Schema variation breaks discovery** | Test with both `outbox` and `outbox_events` table names |

### Assumptions
| Assumption | Validation |
|-----------|------------|
| All service schemas have outbox tables | Verified by Hoops in Phase 2 (or services add them) |
| Polling every 10 seconds is sufficient | MVP baseline, can tune based on metrics |
| 256MB RAM is sufficient | Vertical scaling available if needed |
| External Kafka is optional for MVP | Can use internal Kafka or direct DB polling |

---

## 12. Out of Scope (Future Iterations)

| Feature | Rationale |
|---------|-----------|
| **Auto-discovery of schemas** | MVP uses configuration-driven approach |
| **Horizontal scaling with partitioning** | Single instance sufficient for MVP |
| **Event replay/reprocessing UI** | Manual SQL queries for MVP |
| **Schema version migration** | Not needed unless outbox table schema changes |
| **Kafka compaction** | Not needed for transient event data |

---

## 13. Hand-Off to Hoops (Phase 2)

**Next Agent**: Hoops (Data Architect)

**Hoops Deliverables**:
1. RFC for `outbox_relay` schema design
2. Migrations for `relay_state` and `failed_events` tables
3. Cross-schema permission grants (READ + UPDATE on all service outbox tables)
4. Failing integration tests using Testcontainers PostgreSQL
5. Zero-downtime migration plan

**Hand-Off Artifacts**:
- This specification document (PHASE-1-SPECIFICATION.md)
- ADR compliance checklist (included above)
- Behavioral AC table (15 ACs defined)

**BLOCKING RULE**: Phase 3 cannot begin without GREEN migrations from Hoops.

---

## References

- **Notion › Architecture › Service Layer § 14**: outbox-relay specification
- **Notion › Architecture › Data Layer**: Schema-per-service architecture + outbox pattern
- **Notion › Architecture › ADRs**: Architectural decision records (ADR-001 through ADR-016)
- **Notion › Architecture › Prerequisites & Credentials**: Environment variables
- **SOPs**: Standard Operating Procedures Phase 1 requirements

---

**Phase 1 Owner**: Quinn
**Completion Date**: 2026-01-10
**Quality Gate**: ✅ PASSED
**Next Phase**: Phase 2 (Data Layer - Hoops)

---

## Appendix A: Event Flow Diagram

```
┌─────────────────┐
│ Service A       │
│ (journey-matcher)│
└────────┬────────┘
         │ 1. Business transaction
         ▼
┌─────────────────────────────────┐
│ journey_matcher.outbox          │
│ ┌─────────────────────────────┐ │
│ │ id: uuid                    │ │
│ │ event_type: "journey.created"│ │
│ │ payload: {...}              │ │
│ │ published: false            │ │
│ └─────────────────────────────┘ │
└────────┬────────────────────────┘
         │ 2. Poll every 10s
         ▼
┌─────────────────────────────────┐
│ outbox-relay                    │
│ ┌─────────────────────────────┐ │
│ │ SELECT * WHERE published=false│ │
│ │ FOR UPDATE SKIP LOCKED      │ │
│ └─────────────────────────────┘ │
└────────┬────────────────────────┘
         │ 3. Publish to Kafka
         ▼
┌─────────────────────────────────┐
│ Kafka                           │
│ Topic: journey.created          │
│ Key: aggregate_id               │
│ Value: payload                  │
└────────┬────────────────────────┘
         │ 4. Mark as published
         ▼
┌─────────────────────────────────┐
│ journey_matcher.outbox          │
│ ┌─────────────────────────────┐ │
│ │ published: true             │ │
│ │ published_at: now()         │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

**If Kafka fails after max retries**:
```
┌─────────────────────────────────┐
│ outbox_relay.failed_events      │
│ ┌─────────────────────────────┐ │
│ │ original_event_id: uuid     │ │
│ │ failure_reason: "Kafka timeout"│ │
│ │ failure_count: 10           │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Alert: outbox_relay_failed_events│
│ Operator investigates DLQ       │
└─────────────────────────────────┘
```
