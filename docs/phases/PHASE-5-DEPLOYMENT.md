# Phase 5: Deployment - outbox-relay Service

## Deployment Summary

**Date**: 2026-01-11
**Status**: DEPLOYED
**Environment**: Railway Production

## Service Information

| Property | Value |
|----------|-------|
| Service Name | railrepay-outbox-relay |
| Railway Project | RailRepay |
| Environment | production |
| Public URL | https://railrepay-outbox-relay-production.up.railway.app |
| Internal URL | outbox-relay.railway.internal |

## Deployment Configuration

### Dockerfile Strategy
- Multi-stage build for optimized image size
- Stage 1: Build dependencies
- Stage 2: TypeScript type checking
- Stage 3: Production runtime with ts-node

### Key Configuration
```dockerfile
FROM node:20-alpine
# Multi-stage build with typecheck
# CMD ["npm", "start"]
```

### Start Command
```bash
node --loader ts-node/esm src/index.ts
```

## Environment Variables Configured

| Variable | Description | Status |
|----------|-------------|--------|
| SERVICE_NAME | Service identifier | Set |
| PGHOST | PostgreSQL host (Railway internal) | Set |
| PGPORT | PostgreSQL port | Set |
| PGDATABASE | Database name | Set |
| PGUSER | Database user | Set |
| PGPASSWORD | Database password | Set (Secret) |
| KAFKA_BROKERS | Confluent Cloud brokers | Set |
| KAFKA_USERNAME | SASL username | Set |
| KAFKA_PASSWORD | SASL password | Set (Secret) |
| KAFKA_SSL | Enable SSL | true |
| KAFKA_SASL_MECHANISM | Authentication mechanism | plain |
| ALLOY_PUSH_URL | Grafana Alloy metrics endpoint | Set |
| LOKI_HOST | Loki logging endpoint | Set |

## Health Endpoints Verification

| Endpoint | Status | Response |
|----------|--------|----------|
| /health/live | PASSING | `{"status":"ok","timestamp":"..."}` |
| /health/ready | PENDING | Database schema not yet created |
| /metrics | PASSING | Prometheus format metrics |

## Deployment Logs

```
Starting Container
08:07:45 [info]: Starting outbox-relay service
08:07:45 [info]: Initializing PostgreSQL connection pool
08:07:45 [info]: Kafka SSL enabled
08:07:45 [info]: Kafka SASL authentication enabled
08:07:45 [info]: PostgreSQL connection pool initialized
08:07:45 [info]: Initializing Kafka producer
08:07:45 [info]: Kafka producer connected
08:07:45 [info]: Creating Express application
08:07:45 [info]: Express routes mounted
08:07:45 [info]: Outbox-relay service started successfully
08:07:45 [info]: HTTP server listening { port: 8080 }
```

## Integration Status

### PostgreSQL
- Connection pool initialized successfully
- Connected to Railway PostgreSQL instance
- Schema: outbox_relay (to be created via migrations)

### Kafka (Confluent Cloud)
- SSL/TLS enabled
- SASL PLAIN authentication configured
- Producer connected to pkc-z3p1v0.europe-west2.gcp.confluent.cloud:9092

## Technical Debt Recorded

### TD-OUTBOX-001: Database Migrations
- **Priority**: High
- **Description**: Database migrations need to be run separately due to conflicting migration timestamps
- **Resolution**: Run migrations manually or update migration timestamps
- **Impact**: /health/ready returns unavailable until schema is created

### TD-OUTBOX-002: Kafka Partitioner Warning
- **Priority**: Low
- **Description**: KafkaJS v2.0.0 default partitioner warning displayed
- **Resolution**: Set KAFKAJS_NO_PARTITIONER_WARNING=1 or configure legacy partitioner
- **Impact**: Cosmetic warning only

### TD-OUTBOX-003: ESM Loader Deprecation
- **Priority**: Low
- **Description**: --experimental-loader warning about future removal
- **Resolution**: Migrate to register() API when convenient
- **Impact**: Warning only, functionality not affected

## Post-Deployment Checklist

- [x] Service deployed to Railway
- [x] Public domain generated
- [x] PostgreSQL connection verified
- [x] Kafka connection verified with SSL/SASL
- [x] /health/live endpoint responding
- [x] /metrics endpoint returning Prometheus format
- [ ] Database migrations applied (pending - TD-OUTBOX-001)
- [ ] /health/ready returning healthy (pending - requires migrations)
- [ ] Logs appearing in Grafana (pending verification)

## Next Steps

1. **Apply Database Migrations**: Run migrations to create outbox_relay schema
2. **Verify Grafana Integration**: Check logs appearing in Grafana Cloud
3. **Test Event Publishing**: Verify Kafka producer works with real events
4. **Load Testing**: Verify service handles expected event throughput

## Files Modified During Deployment

| File | Changes |
|------|---------|
| Dockerfile | Created multi-stage build configuration |
| src/index.ts | Added Kafka SSL/SASL configuration |
| tsconfig.json | Fixed module resolution for ESM compatibility |
| docker-entrypoint.sh | Removed (inline CMD used instead) |
| migrations/*.cjs | Renamed from .js to .cjs for CommonJS compatibility |

## Sign-off

- **DevOps Engineer**: Moykle (Agent)
- **Deployment Date**: 2026-01-11
- **Phase Status**: COMPLETE (with pending migrations)

---

*Report generated as part of Phase 5 Deployment for outbox-relay service*
