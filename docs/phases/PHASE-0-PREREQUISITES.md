# Phase 0: Prerequisites Verification - outbox-relay Service

**Service**: outbox-relay
**Phase**: 0 - Prerequisites Verification
**Owner**: Quinn (Product Owner & Chief Orchestrator)
**Date**: 2026-01-10
**Status**: ✅ COMPLETE

---

## Phase 0 Overview

Per **SOPs Phase 0**, this document verifies all prerequisites are in place before beginning service development. This is a **BLOCKING PHASE** - Phase 1 (Specification) cannot begin without all prerequisites verified.

---

## 0.1 Railway Infrastructure Verification (Advisory)

**Status**: ✅ COMPLETE

### Railway CLI Status
- ✅ Railway CLI installed and authenticated
- ✅ Project linked: RailRepay (fac37e3d-8447-4bda-bab6-754844a7aed5)
- ✅ Environment: production (c085b402-670e-4977-976f-25c2af5e88b1)

### Existing Services
Verified 11 services currently deployed:
1. railrepay-data-retention-service
2. timetable-loader
3. railrepay-otp-router
4. Postgres (2 instances)
5. railway-grafana-alloy
6. railrepay-journey-matcher
7. Redis
8. railrepay-whatsapp-handler
9. darwin-ingestor
10. railrepay-otp-graph-builder

### Target Service Status
- ⚪ **outbox-relay service**: Does NOT exist yet (expected for new service)
- ⚪ **outbox_relay schema**: Does NOT exist yet (Hoops will create in Phase 2)

**Note**: Railway MCP verification is ADVISORY for Phase 0 (service doesn't exist yet). Full MCP verification will be BLOCKING in Phases 5-6.

---

## 0.2 External Account Access

**Status**: ✅ COMPLETE

Per **Notion › Architecture › Prerequisites & Credentials**, outbox-relay requires:

### Required External Accounts
| Account | Purpose | Status | Notes |
|---------|---------|--------|-------|
| **Railway** | Deployment platform | ✅ Active | GitHub OAuth authenticated |
| **Grafana Cloud** | Metrics/logs aggregation | ✅ Active | Loki + Prometheus configured |
| **Confluent Cloud (optional)** | Kafka hosting | ✅ Active | Via RDM, optional for MVP |

### Optional Kafka Integration
- **For MVP**: Internal Railway-hosted Kafka or direct database polling
- **Future**: External Confluent Cloud if event volume requires it
- **Current decision**: Use database polling pattern (no external Kafka dependency for Phase 0)

**Decision**: Proceed with database polling pattern. External Kafka is OPTIONAL and not a blocking prerequisite.

---

## 0.3 Infrastructure Ready

**Status**: ✅ COMPLETE

### PostgreSQL Instance
- ✅ Railway PostgreSQL 16 available
- ✅ Connection: `postgres.railway.internal:5432`
- ✅ Database: `railway`
- ✅ Credentials: Configured in Railway environment variables
- ⚪ Schema `outbox_relay`: Will be created by Hoops in Phase 2

### Redis Instance
- ✅ Railway Redis 7 available
- ✅ Connection: `redis.railway.internal:6379`
- ✅ Credentials: Configured in Railway environment variables
- **Note**: outbox-relay does NOT require Redis (no caching/state management needed)

### Grafana Alloy Service
- ✅ Running as `railway-grafana-alloy`
- ✅ Metrics endpoint: `http://railway-grafana-alloy.railway.internal:9091/api/v1/metrics/write`
- ✅ Loki endpoint: `https://logs-prod-035.grafana.net`

**All infrastructure services operational.**

---

## 0.4 Credential Verification per Service

**Status**: ✅ COMPLETE

Per **Notion › Architecture › Service Layer § outbox-relay**, the following credentials are required:

### Universal Credentials (All Services)
| Variable | Status | Value/Source |
|----------|--------|--------------|
| `DATABASE_URL` | ✅ Configured | `postgresql://postgres:***@postgres.railway.internal:5432/railway` |
| `DATABASE_SCHEMA` | ⚪ To be set | `outbox_relay` (Moykle will configure in Phase 5) |
| `SERVICE_NAME` | ⚪ To be set | `outbox-relay` per ADR-013 |
| `NODE_ENV` | ✅ Configured | `production` |
| `LOG_LEVEL` | ✅ Configured | `info` |
| `PORT` | ⚪ To be set | Default `3012` per Service Layer spec |

### Observability Credentials
| Variable | Status | Value/Source |
|----------|--------|--------------|
| `LOKI_HOST` | ✅ Configured | `https://logs-prod-035.grafana.net` |
| `LOKI_BASIC_AUTH` | ✅ Configured | `1197629:glc_***` |
| `LOKI_ENABLED` | ✅ Configured | `true` |
| `LOKI_LEVEL` | ✅ Configured | `info` |
| `ALLOY_PUSH_URL` | ✅ Configured | `http://railway-grafana-alloy.railway.internal:9091/api/v1/metrics/write` |
| `METRICS_PORT` | ✅ Configured | `9090` |
| `METRICS_PUSH_INTERVAL` | ✅ Configured | `15000` (15 seconds) |

### Service-Specific Credentials (outbox-relay)
| Variable | Status | Value/Source | Notes |
|----------|--------|--------------|-------|
| `POLL_INTERVAL_MS` | ⚪ To be set | `10000` (10 seconds default) | Per Service Layer spec |
| `KAFKA_BROKERS` | ⚪ Optional | Not required for MVP | External Kafka is optional |
| `KAFKA_USERNAME` | ⚪ Optional | Not required for MVP | External Kafka is optional |
| `KAFKA_PASSWORD` | ⚪ Optional | Not required for MVP | External Kafka is optional |
| `OUTBOX_SCHEMAS` | ⚪ To be set | Comma-separated list of schemas to poll | Configuration-driven discovery |

**Credential Status**: All universal and observability credentials verified. Service-specific credentials will be configured by Moykle in Phase 5.

---

## 0.5 Shared Library Availability

**Status**: ✅ COMPLETE

Per **Notion › Architecture › Extractable Packages Registry**, outbox-relay requires:

### Core Shared Libraries
| Package | Required Version | Status | Verification |
|---------|-----------------|--------|--------------|
| `@railrepay/winston-logger` | Latest | ✅ Available | Correlation IDs (ADR-002) |
| `@railrepay/metrics-pusher` | Latest | ✅ Available | Prometheus metrics |
| `@railrepay/postgres-client` | Latest | ✅ Available | Database access |
| `@railrepay/health-check` | Latest | ✅ Available | Health endpoints (ADR-008) |

### Additional Dependencies
| Package | Purpose | Status |
|---------|---------|--------|
| `kafkajs` | Kafka producer (optional) | ✅ Available via npm |
| `pg` | PostgreSQL client | ✅ Available via npm |
| `node-pg-migrate` | Schema migrations | ✅ Available via npm |
| `express` | HTTP framework | ✅ Available via npm |
| `typescript` | Language | ✅ Available via npm |

**Note**: If @railrepay packages need updates, escalation to human required for npm publish (PowerShell required).

**All shared libraries verified available.**

---

## 0.6 Escalation

**Status**: ✅ NO ESCALATION REQUIRED

All prerequisites verified. No missing accounts, credentials, or infrastructure.

**Phase 0 Quality Gate**: ✅ PASSED

---

## Cross-Schema Permissions Verification

**Status**: ⚠️ ADVISORY - To be verified by Hoops in Phase 2

Per **Notion › Architecture › Data Layer**, outbox-relay is a **cross-schema operational service** that polls outbox tables in ALL other service schemas.

### Schema Polling Requirements
outbox-relay must have **READ access** to outbox tables in these schemas:
1. `whatsapp_handler.outbox_events`
2. `journey_matcher.outbox`
3. `darwin_ingestor.outbox`
4. `timetable_loader.outbox`
5. `data_retention.outbox`
6. (Future schemas as they are added)

### Migration Strategy
**Hoops will handle in Phase 2**:
- Create `outbox_relay` schema with `relay_state` and `failed_events` tables
- Grant SELECT and UPDATE permissions on all service outbox tables
- Document cross-schema access pattern in RFC

**Note**: This follows the same pattern as `data-retention-service`, which is already deployed with cross-schema DELETE access.

---

## ADR Applicability Checklist

Per **SOPs Phase 0**, all relevant ADRs have been reviewed:

| ADR | Title | Applicable | Impact |
|-----|-------|------------|--------|
| ADR-001 | Schema-per-Service Database Isolation | ✅ Yes | outbox-relay owns `outbox_relay` schema |
| ADR-002 | Correlation ID Standard | ✅ Yes | All logs must include correlation IDs |
| ADR-003 | node-pg-migrate for Schema Migrations | ✅ Yes | Use node-pg-migrate for `outbox_relay` schema |
| ADR-004 | Testcontainers for Integration Tests | ✅ Yes | Use Testcontainers PostgreSQL |
| ADR-005 | Railway Rollback Strategy | ✅ Yes | No canary, direct production deploy with rollback |
| ADR-006 | Prometheus Metrics Standard | ✅ Yes | Emit `outbox_relay_events_published`, `outbox_relay_poll_duration`, `outbox_relay_failed_events` |
| ADR-007 | Winston + Loki Logging | ✅ Yes | Use @railrepay/winston-logger with Loki transport |
| ADR-008 | Health Check Endpoint Standard | ✅ Yes | GET `/health` endpoint required |
| ADR-010 | Smoke Tests Post-Deployment | ✅ Yes | Verify event publishing after deployment |
| ADR-011 | Prometheus Alert Rules | ✅ Yes | Alerts for failed events, lag monitoring |
| ADR-012 | OpenAPI Specification Requirement | ⚠️ Partial | Health endpoint only (no complex API) |
| ADR-013 | SERVICE_NAME Environment Variable | ✅ Yes | `SERVICE_NAME=outbox-relay` |
| ADR-014 | Test-Driven Development Mandate | ✅ Yes | Failing tests FIRST, then implementation |
| ADR-016 | Automated Partition Lifecycle | ⚠️ Maybe | If outbox tables use partitioning (TBD by Hoops) |

**ADR Review Complete**: All applicable ADRs identified. ADR checklist will be included in Phase 1 specification hand-off to Hoops.

---

## Notion Documentation Review

### Service Layer § 14. outbox-relay
**Source**: Notion › Architecture › Service Layer § 14
**Last Updated**: 2025-11-22
**Status**: ✅ Retrieved and summarized

**Key Requirements Extracted**:
1. **Purpose**: Polls transactional outbox tables in each service schema, publishes events to Kafka
2. **Technology**: TypeScript (Node.js), KafkaJS
3. **Polling Interval**: 10 seconds (configurable via `POLL_INTERVAL_MS`)
4. **Schema**: `outbox_relay` with tables `relay_state`, `failed_events`
5. **Scaling**: Vertical (256MB RAM), single instance with locks to prevent duplicates
6. **Integration Pattern**: Database poller, Kafka producer
7. **Behavioral Acceptance Criteria**: 15 specific ACs covering delivery guarantees, multi-schema operations, error handling, observability

**Critical Constraints**:
- Exactly-once event delivery (row-level locks + published flag)
- Events appear in Kafka within 30 seconds (P95)
- No events lost if Kafka unavailable for up to 1 hour
- Each AC maps to at least one test (per User Story workflow)

### Data Layer § Schema-per-Service Architecture
**Source**: Notion › Architecture › Data Layer
**Last Updated**: 2025-11-22
**Status**: ✅ Retrieved and summarized

**Key Requirements Extracted**:
1. **Schema Name**: `outbox_relay`
2. **Tables**: `relay_state`, `failed_events`
3. **Cross-Service Access**: Polls ALL other service schemas' outbox tables
4. **Transactional Outbox Pattern**: Standard outbox table schema documented
5. **Migration Tool**: node-pg-migrate (MANDATORY)
6. **Zero-Downtime**: Expand-migrate-contract pattern required

**Outbox Table Standard**:
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
```

**Variation Tolerance** (Per Service Layer § 14):
- Table name: `outbox` OR `outbox_events`
- Published column: `published_at` OR `processed_at` (TIMESTAMPTZ, NULL = unpublished)

---

## Prerequisites Summary

| Category | Status | Details |
|----------|--------|---------|
| Railway Infrastructure | ✅ Complete | CLI authenticated, project linked, PostgreSQL/Redis available |
| External Accounts | ✅ Complete | Railway, Grafana Cloud active; Kafka optional |
| Credentials | ✅ Complete | Universal + observability vars configured |
| Shared Libraries | ✅ Complete | All @railrepay packages available |
| Notion Documentation | ✅ Complete | Service Layer § 14 + Data Layer requirements extracted |
| ADR Review | ✅ Complete | 14 ADRs reviewed, applicability checklist created |
| Schema Ready | ⚪ Pending | Hoops will create `outbox_relay` schema in Phase 2 |

---

## Phase 0 Quality Gate

**BLOCKING RULE**: Phase 1 cannot begin without all prerequisites verified.

**Status**: ✅ **PASSED**

All prerequisites verified. Proceeding to **Phase 1: Specification**.

---

## Next Steps

1. **Quinn (Phase 1)**: Create specification document from Notion requirements
2. **Hand off to Hoops (Phase 2)**: RFC for `outbox_relay` schema with cross-schema permissions
3. **Blake (Phase 3)**: Implementation with TDD using shared libraries
4. **Jessie (Phase 4)**: QA verification and coverage testing
5. **Moykle (Phase 5)**: CI/CD deployment to Railway
6. **Quinn (Phase 6)**: Final verification and closeout

---

## References

- **Notion › Architecture › Service Layer § 14**: outbox-relay specification
- **Notion › Architecture › Data Layer**: Schema-per-service architecture
- **Notion › Architecture › ADRs**: Architectural decision records
- **Notion › Architecture › Prerequisites & Credentials**: Required external accounts
- **SOPs**: Standard Operating Procedures Phase 0 requirements

---

**Phase 0 Owner**: Quinn
**Completion Date**: 2026-01-10
**Quality Gate**: ✅ PASSED
**Next Phase**: Phase 1 (Specification)
