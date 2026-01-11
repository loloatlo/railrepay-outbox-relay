# Phase 4: QA Verification and Sign-Off Report

**Service**: outbox-relay
**Phase**: 4 - QA Verification
**Owner**: Jessie (QA & TDD Enforcer)
**Date**: 2026-01-10
**Status**: 🚫 **BLOCKED - CRITICAL ISSUES FOUND**

---

## Executive Summary

Phase 4 QA verification has identified **CRITICAL BLOCKING ISSUES** that prevent deployment:

1. **TypeScript compilation fails** - Missing `@types/express` devDependency
2. **Shared library API mismatch** - Code imports `logger` but `@railrepay/winston-logger` exports `createLogger`
3. **Service does not build** - `npm run build` fails with 35 TypeScript errors
4. **Function coverage below threshold** - 73.07% vs 80% required

**QA SIGN-OFF**: 🚫 **REJECTED**

Blake must fix these issues before Phase 5 deployment can proceed.

---

## SOP 4.6: Service Health Verification

### Pre-Fix Health Check (Gate 0.5) - ❌ FAILED

```bash
npm test
```

**Result**:
- Unit tests: ✅ 61/61 PASS
- Integration tests: ❌ 1 FAIL (Testcontainers - documented as TD-001)
- **Status**: Unit tests healthy, integration test failure is pre-existing and documented

```bash
npm run build
```

**Result**: ❌ **CRITICAL FAILURE - 35 TypeScript errors**

**Critical Finding**: Service does NOT compile. This is a **BLOCKING** issue that should have been caught in Phase 3.

### Build Errors Summary

**Error Category 1: Missing @types/express** (7 occurrences)
```
error TS7016: Could not find a declaration file for module 'express'
```

**Files affected**:
- `src/index.ts`
- `src/routes/health.routes.ts`
- `src/routes/metrics.routes.ts`
- `src/__tests__/unit/routes/health.routes.test.ts`
- `src/__tests__/unit/routes/metrics.routes.test.ts`

**Error Category 2: Incorrect winston-logger import** (8 occurrences)
```
error TS2724: '@railrepay/winston-logger' has no exported member named 'logger'
```

**Files affected**:
- `src/index.ts`
- `src/routes/health.routes.ts`
- `src/routes/metrics.routes.ts`
- `src/services/dlq-handler.service.ts`
- `src/services/kafka-publisher.service.ts`
- `src/services/outbox-poller.service.ts`
- `src/services/retry-handler.service.ts`
- `src/__tests__/unit/services/dlq-handler.test.ts`

**Root Cause**: `@railrepay/winston-logger` exports `createLogger` and `Logger`, but code imports `logger` directly.

**Error Category 3: Mock type mismatches** (20 occurrences)
```
error TS2345: Argument of type '{ rows: ...; command: string; ... }' is not assignable to parameter of type 'void'
```

**Files affected**: All test files with database mocks

---

## Gate 1: Test Existence Verification - ✅ CONDITIONAL PASS

### TDD Compliance Check

**Commit History Verification**: Unable to verify git history (service not in git repo).

**File Structure Analysis**:
- Tests are co-located in `/src/__tests__/` directory
- Each service has corresponding test file
- Test files are comprehensive (61 tests total)

**TDD Evidence**:
- Blake's Phase 3 report claims 100% TDD compliance
- Tests written in RED → GREEN → REFACTOR cycle
- Cannot independently verify without git history

**Status**: ✅ Accepting Blake's attestation (no evidence of violation)

---

## Gate 2: Coverage Thresholds Verification - ❌ FAILED

### Unit Test Coverage (Production Code Only)

```
File               | % Stmts | % Branch | % Funcs | % Lines
-------------------|---------|----------|---------|--------
All files          |   86.49 |    76.78 |   73.07 |   86.49
 src/services      |   98.23 |    78.37 |     100 |   98.23
 src/routes        |   90.32 |    81.25 |      50 |   90.32
 src (index.ts)    |   46.72 |    33.33 |      20 |   46.72
```

### ADR-014 Threshold Compliance

| Metric | Threshold | Production Code (services + routes) | Overall | Status |
|--------|-----------|-------------------------------------|---------|--------|
| **Lines** | ≥80% | 94.28% ✅ | 86.49% ✅ | **PASS** |
| **Statements** | ≥80% | 94.28% ✅ | 86.49% ✅ | **PASS** |
| **Functions** | ≥80% | 87.50% ✅ | **73.07%** ❌ | **FAIL** |
| **Branches** | ≥75% | 79.81% ✅ | 76.78% ✅ | **PASS** |

**CRITICAL FINDING**: Function coverage is **73.07%**, below the 80% threshold.

**Root Cause**: `src/index.ts` has 20% function coverage because:
- `main()` not called (application startup)
- `initializeDatabase()` not called (requires real PostgreSQL)
- `initializeKafka()` not called (requires real Kafka)
- `gracefulShutdown()` not called (requires signal handler testing)

**Blake's Mitigation** (TD-003): "These functions are designed for integration testing"

**Jessie's Assessment**:
- ❌ **NOT ACCEPTABLE** - Integration tests should have been written in Phase 3
- ❌ Functions can be tested with mocks (no real infrastructure needed)
- ❌ Deferring to Phase 4 violates TDD discipline (tests BEFORE implementation)

**Required Fix**: Blake must write unit tests for startup functions OR convert to integration tests with Testcontainers.

---

## Gate 3: Acceptance Criteria Coverage - ⏳ PARTIAL VERIFICATION

### Phase 1 Specification: 15 Behavioral ACs

Due to compilation failures, cannot run integration tests. Based on unit test analysis:

| AC | Requirement | Test Coverage | Status |
|----|-------------|---------------|--------|
| **AC-1** | Delivery latency ≤30s (P95) | ⏳ Integration test required | DEFERRED |
| **AC-2** | Exactly-once delivery | ✅ `outbox-poller.test.ts` (row locks) | PASS |
| **AC-3** | Ordering guarantee by aggregate_id | ✅ `kafka-publisher.test.ts` (partition key) | PASS |
| **AC-4** | Failure resilience (1 hour Kafka outage) | ⏳ Integration test required | DEFERRED |
| **AC-5** | Schema discovery | ✅ `outbox-poller.test.ts` (multi-schema) | PASS |
| **AC-6** | Schema variation tolerance | ✅ `outbox-poller.test.ts` (outbox vs outbox_events) | PASS |
| **AC-7** | Partition isolation | ✅ `outbox-poller.test.ts` (schema failures) | PASS |
| **AC-8** | Retry with exponential backoff | ✅ `retry-handler.test.ts` (1s → 5min) | PASS |
| **AC-9** | Retry exhaustion after 10 failures | ✅ `retry-handler.test.ts` + `dlq-handler.test.ts` | PASS |
| **AC-10** | DLQ includes failure metadata | ✅ `dlq-handler.test.ts` (all fields) | PASS |
| **AC-11** | Metrics emission (4 metrics) | ✅ `metrics.routes.test.ts` | PASS |
| **AC-12** | Failure detection ≤5 minutes | ⏳ E2E test required | DEFERRED |
| **AC-13** | Lag monitoring metric | ⏳ Integration test required | DEFERRED |
| **AC-14** | Schema configuration via env var | ✅ `outbox-poller.test.ts` | PASS |
| **AC-15** | Table discovery (outbox vs outbox_events) | ✅ `outbox-poller.test.ts` | PASS |

**Unit Test Coverage**: 11/15 ACs verified (73%)
**Integration Test Coverage**: 0/4 ACs verified (blocked by Testcontainers)

**Assessment**: Unit-testable ACs are well covered. Integration ACs deferred to Railway CI/CD (documented as TD-001).

---

## Gate 4: Observability Requirements - ❌ FAILED

### ADR-002: Logging with Correlation IDs

**Expected**: All services use `@railrepay/winston-logger` with correlation IDs

**Actual**:
- ❌ Code imports `logger` directly: `import { logger } from '@railrepay/winston-logger'`
- ❌ Shared library exports `createLogger`, NOT `logger`
- ❌ **API mismatch breaks ALL logging**

**Impact**: Service will crash on startup when trying to log.

**Verified Files**:
```typescript
// src/index.ts (line 27)
import { logger } from '@railrepay/winston-logger'; // ❌ WRONG

// Expected:
import { createLogger } from '@railrepay/winston-logger';
const logger = createLogger({ service: 'outbox-relay' });
```

### ADR-006: Prometheus Metrics

**Expected**: 4 metrics instrumented and exposed at `/metrics`

**Actual**: ✅ All 4 metrics implemented
- `events_polled_total` (counter)
- `events_published_total` (counter)
- `events_failed_total` (counter)
- `poll_latency_seconds` (histogram)

**Verified**: `src/routes/metrics.routes.ts` - Prometheus format with labels

### ADR-008: Health Check Endpoint

**Expected**: `/health/live` and `/health/ready` endpoints

**Actual**: ✅ Implemented
- `GET /health/live` - Liveness probe (200 OK always)
- `GET /health/ready` - Readiness probe (checks DB + polling freshness)

**Verified**: `src/routes/health.routes.ts`

---

## Gate 5: Technical Debt Review - ✅ PASS

Blake documented 3 technical debt items:

### TD-001: Docker Unavailable (Testcontainers Blocked)

**Status**: ✅ Properly documented
**Mitigation**: Integration tests run in Railway CI/CD
**Owner**: Blake
**Sprint Target**: Phase 5

**Jessie Assessment**: Acceptable mitigation. WSL limitation is valid.

### TD-002: Migrations Not Run Locally

**Status**: ✅ Properly documented
**Mitigation**: Migrations run on Railway infrastructure
**Owner**: Blake
**Sprint Target**: Phase 5

**Jessie Assessment**: Acceptable. Railway DNS limitation is valid.

### TD-003: Main Application Coverage Below 80%

**Status**: ⚠️ **INCOMPLETE MITIGATION**
**Blake's Plan**: "Integration tests in Phase 4 will test application startup"
**Jessie Assessment**: ❌ **NOT ACCEPTABLE**

**Why**:
1. Blake wrote implementation code (`main()`, `initializeDatabase()`, etc.) WITHOUT tests
2. Violates TDD: Tests MUST come before implementation
3. "Phase 4 will test it" is NOT a valid TDD mitigation

**Required Action**: Blake must either:
- **Option A**: Write unit tests for startup functions (with mocks)
- **Option B**: Delete startup code and write integration tests FIRST, then re-implement

**BLOCKING**: This technical debt item prevents QA sign-off.

---

## Critical Issues Summary

### 🚨 BLOCKING ISSUE #1: Missing @types/express

**Severity**: CRITICAL
**Impact**: TypeScript compilation fails
**Files Affected**: 7 files (index.ts, routes, tests)
**Fix Required**:
```bash
npm install --save-dev @types/express
```

**Root Cause**: Package.json devDependencies incomplete

---

### 🚨 BLOCKING ISSUE #2: winston-logger API Mismatch

**Severity**: CRITICAL
**Impact**: All logging broken, service will crash on startup
**Files Affected**: 8 files (all services, routes, tests)
**Fix Required**:
```typescript
// WRONG (current code)
import { logger } from '@railrepay/winston-logger';

// CORRECT
import { createLogger } from '@railrepay/winston-logger';
const logger = createLogger({ service: 'outbox-relay' });
```

**Root Cause**: Shared library API not verified via integration test (Lesson Learned 2025-12-06)

**CRITICAL LESSON**: This proves the importance of the SOP 4.7 checklist item:
> "At least one integration test exercises REAL @railrepay/* dependencies (not fully mocked)"

Had Blake written an integration test that actually called `@railrepay/winston-logger`, this would have been caught in Phase 3.

---

### 🚨 BLOCKING ISSUE #3: Mock Type Mismatches

**Severity**: HIGH
**Impact**: TypeScript compilation fails in test files
**Files Affected**: 20 test cases across 4 test files
**Fix Required**: Update vitest mock type definitions

**Example**:
```typescript
// WRONG (current)
mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
// Type error: mockResolvedValue expects 'void', not QueryResult

// CORRECT
mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 } as any);
// OR use proper QueryResult<T> typing
```

---

### 🚨 BLOCKING ISSUE #4: Function Coverage Below Threshold

**Severity**: MEDIUM
**Impact**: ADR-014 compliance failure (73.07% vs 80% required)
**Root Cause**: Application startup functions not tested
**Fix Required**: Write tests for `main()`, `initializeDatabase()`, `initializeKafka()`, `gracefulShutdown()`

**Jessie Assessment**: TDD violation. Code written before tests.

---

## Lesson Learned: Integration Test Gap

**2025-12-06 Lesson Learned** states:
> "metrics-pusher@1.0.0 had 95% coverage but crashed in production because prometheus-remote-write's node-fetch peerDependency was never tested."

**RailRepay Repeat**:
- outbox-relay has 86.49% coverage
- **ALL logging will crash** because `@railrepay/winston-logger` API was never tested with real dependency
- Unit tests mocked winston-logger, hiding the API mismatch

**Root Cause**: No integration test exercised real `@railrepay/winston-logger` package.

**SOP 4.7 Violation**: Blake did NOT include "at least one integration test exercises REAL @railrepay/* dependencies"

**Future Prevention**:
- Every service MUST have at least one integration test that imports and calls real shared libraries
- Integration tests MUST NOT mock @railrepay/* packages
- QA will REJECT any service without real dependency integration tests

---

## Required Fixes for Blake (Phase 3 Revisit)

### Fix #1: Install Missing Type Definitions

**File**: `package.json`
**Change**:
```json
"devDependencies": {
  "@types/express": "^4.17.21",  // ADD THIS
  "@types/node": "^20.10.0",
  "@types/pg": "^8.10.0",
  "@types/supertest": "^6.0.3",
  ...
}
```

**Command**:
```bash
npm install --save-dev @types/express
```

---

### Fix #2: Correct winston-logger Import (ALL FILES)

**Files**:
- `src/index.ts`
- `src/routes/health.routes.ts`
- `src/routes/metrics.routes.ts`
- `src/services/dlq-handler.service.ts`
- `src/services/kafka-publisher.service.ts`
- `src/services/outbox-poller.service.ts`
- `src/services/retry-handler.service.ts`
- `src/__tests__/unit/services/dlq-handler.test.ts`

**Change**:
```typescript
// BEFORE
import { logger } from '@railrepay/winston-logger';

// AFTER
import { createLogger } from '@railrepay/winston-logger';

const logger = createLogger({
  service: process.env.SERVICE_NAME || 'outbox-relay',
  level: process.env.LOG_LEVEL || 'info',
});
```

---

### Fix #3: Fix Mock Type Errors (ALL TEST FILES)

**Files**:
- `src/__tests__/unit/services/outbox-poller.test.ts`
- `src/__tests__/unit/services/kafka-publisher.test.ts`
- `src/__tests__/unit/services/dlq-handler.test.ts`
- `src/__tests__/unit/routes/health.routes.test.ts`

**Change**:
```typescript
// BEFORE
mockPool.query.mockResolvedValue({ rows: [...], rowCount: 1 });

// AFTER (Option A: Type assertion)
mockPool.query.mockResolvedValue({ rows: [...], rowCount: 1 } as any);

// OR AFTER (Option B: Proper typing)
import { QueryResult } from 'pg';
mockPool.query.mockResolvedValue({
  rows: [...],
  rowCount: 1,
  command: 'SELECT',
  oid: 0,
  fields: [],
} as QueryResult);
```

---

### Fix #4: Write Tests for Application Startup (NEW TESTS REQUIRED)

**File**: `src/__tests__/unit/index.test.ts` (ADD NEW TESTS)

**Required**:
```typescript
describe('Application Startup', () => {
  it('should initialize database pool with correct config', async () => {
    // Test initializeDatabase()
  });

  it('should initialize Kafka producer with correct config', async () => {
    // Test initializeKafka()
  });

  it('should start HTTP server on configured port', async () => {
    // Test main() startup
  });

  it('should gracefully shutdown on SIGTERM', async () => {
    // Test gracefulShutdown()
  });
});
```

**OR** convert to integration test and delete current implementation, then re-implement with TDD.

---

### Fix #5: Add Integration Test with Real winston-logger (NEW TEST REQUIRED)

**File**: `src/__tests__/integration/winston-logger.test.ts` (NEW FILE)

**Required**:
```typescript
import { describe, it, expect } from 'vitest';
import { createLogger } from '@railrepay/winston-logger';

describe('Integration: @railrepay/winston-logger', () => {
  it('should create logger instance without errors', () => {
    const logger = createLogger({ service: 'outbox-relay' });
    expect(logger).toBeDefined();
    expect(logger.info).toBeInstanceOf(Function);
  });

  it('should log messages without crashing', () => {
    const logger = createLogger({ service: 'outbox-relay' });
    expect(() => {
      logger.info('Test message', { correlationId: 'test-123' });
    }).not.toThrow();
  });
});
```

**Purpose**: Catch API mismatches with real shared library dependency.

---

## QA Sign-Off Decision Matrix

| Criterion | Status | Blocking? |
|-----------|--------|-----------|
| TDD Compliance | ⚠️ Partial (TD-003) | YES |
| Coverage Thresholds | ❌ Functions 73% < 80% | YES |
| TypeScript Build | ❌ 35 compilation errors | YES |
| Acceptance Criteria | ✅ 11/15 unit-testable ACs | NO |
| Observability | ❌ Logger API broken | YES |
| Technical Debt Recorded | ✅ 3 items documented | NO |
| Real Dependency Integration Test | ❌ Missing | YES |
| Missing Dependencies | ❌ @types/express | YES |

---

## Phase 4 QA Verdict

### 🚫 QA SIGN-OFF: **REJECTED**

**Reason**: CRITICAL blocking issues prevent deployment:

1. ❌ Service does not compile (35 TypeScript errors)
2. ❌ Logging completely broken (winston-logger API mismatch)
3. ❌ Function coverage below threshold (73.07% vs 80%)
4. ❌ TDD violation (application startup code written without tests)
5. ❌ Missing integration test with real @railrepay/* dependencies

**Required Actions**:
1. Blake MUST implement all 5 fixes listed above
2. Blake MUST verify `npm run build` succeeds with zero errors
3. Blake MUST achieve ≥80% function coverage
4. Blake MUST write integration test with real winston-logger
5. Blake MUST re-submit for Phase 4 QA verification

**BLOCKING RULE**: Phase 5 (Moykle deployment) **CANNOT START** without QA sign-off.

---

## Recommendations for Re-Submission

### Immediate Actions (REQUIRED)

1. **Install @types/express**:
   ```bash
   npm install --save-dev @types/express
   ```

2. **Fix winston-logger imports** (8 files):
   - Replace `import { logger }` with `import { createLogger }`
   - Instantiate logger: `const logger = createLogger({ service: 'outbox-relay' })`

3. **Fix mock type errors** (20 test cases):
   - Add type assertions: `as any` or proper `QueryResult<T>` typing

4. **Write startup function tests**:
   - Unit tests for `main()`, `initializeDatabase()`, `initializeKafka()`, `gracefulShutdown()`
   - Target: Achieve ≥80% function coverage

5. **Add real dependency integration test**:
   - Create `src/__tests__/integration/winston-logger.test.ts`
   - Import and call real `createLogger()` from `@railrepay/winston-logger`

### Verification Steps (REQUIRED)

After implementing fixes, Blake MUST verify:

```bash
# Step 1: Clean install
npm ci

# Step 2: TypeScript compilation (MUST succeed)
npm run build

# Step 3: All tests pass
npm test

# Step 4: Coverage thresholds met
npm run test:coverage
# Verify: Functions ≥80%

# Step 5: Linting clean
npm run lint  # (if lint script exists)
```

### Quality Gates for Re-Submission

- [ ] `npm run build` exits with code 0 (zero errors)
- [ ] `npm test` all unit tests PASS (integration tests may fail due to Docker)
- [ ] Function coverage ≥80%
- [ ] winston-logger integration test exists and passes
- [ ] All 8 files using logger have correct import

---

## Positive Findings (Recognition)

Despite blocking issues, Blake's Phase 3 work demonstrates strong TDD discipline in many areas:

### ✅ Strengths

1. **Comprehensive Unit Test Suite**: 61 unit tests covering all service logic
2. **Excellent Service Coverage**: Services achieve 98.23% statement coverage
3. **Well-Structured Code**: Clean separation of concerns (services, routes, main)
4. **Good Test Organization**: Co-located tests, clear naming conventions
5. **Proper Mocking**: Well-designed mocks for PostgreSQL and Kafka
6. **AC Coverage**: 11/15 acceptance criteria verified via unit tests
7. **Observability Instrumentation**: All 4 Prometheus metrics implemented
8. **Error Handling**: Comprehensive try/catch blocks with logging
9. **Technical Debt Documentation**: All 3 items properly recorded

### 💡 Areas for Improvement

1. **Dependency Verification**: Always test with REAL shared libraries (not just mocks)
2. **Build Verification**: Run `npm run build` before submitting for QA
3. **Type Definitions**: Ensure all required @types/* packages are installed
4. **TDD Discipline**: Write tests for ALL code, including startup/shutdown functions
5. **API Verification**: Verify shared library APIs before using (check package exports)

---

## Next Steps

### Blake's Actions (Phase 3 Rework)

1. Implement all 5 required fixes
2. Verify build, tests, and coverage
3. Re-submit to Jessie for Phase 4 QA re-verification

### Jessie's Actions (After Re-Submission)

1. Re-verify all 5 quality gates
2. Run full SOP 4.6 Service Health Verification
3. If all gates PASS → Issue QA sign-off for Phase 5
4. If any gate FAILS → REJECT again with updated report

### Timeline Estimate

- **Fixes**: 2-3 hours (straightforward changes)
- **Testing**: 1 hour (verify all fixes work)
- **Re-QA**: 1 hour (Jessie re-verification)
- **Total**: 4-5 hours to unblock Phase 5

---

## References

- **Phase 1 Specification**: `/services/outbox-relay/docs/phases/PHASE-1-SPECIFICATION.md`
- **Phase 3 Implementation Report**: `/services/outbox-relay/docs/phases/PHASE-3-IMPLEMENTATION-REPORT-FINAL.md`
- **ADR-002**: Correlation IDs and structured logging
- **ADR-006**: Prometheus metrics
- **ADR-008**: Health check endpoints
- **ADR-014**: TDD mandate and coverage thresholds
- **SOP 4.6**: Service Health Verification
- **SOP 4.7**: Fix Correctness Sign-Off Checklist
- **Lesson Learned 2025-12-06**: Integration testing with real dependencies

---

**Phase 4 Owner**: Jessie (QA & TDD Enforcer)
**Completion Date**: 2026-01-10
**Quality Gate**: 🚫 **FAILED - BLOCKING ISSUES**
**Next Phase**: Phase 3 (Blake MUST fix issues and re-submit)

---

## Appendix A: Full Build Error Log

<details>
<summary>Click to expand full TypeScript compilation errors</summary>

```
> @railrepay/outbox-relay@1.0.0 build
> tsc --noEmit

src/__tests__/unit/routes/health.routes.test.ts(22,39): error TS7016: Could not find a declaration file for module 'express'.
src/__tests__/unit/routes/health.routes.test.ts(89,55): error TS2345: Argument of type '{ rows: { last_poll_time: Date; }[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/routes/health.routes.test.ts(137,55): error TS2345: Argument of type '{ rows: { last_poll_time: Date; }[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/routes/health.routes.test.ts(164,55): error TS2345: Argument of type '{ rows: { last_poll_time: Date; }[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/routes/health.routes.test.ts(208,55): error TS2345: Argument of type '{ rows: { last_poll_time: Date; }[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/routes/metrics.routes.test.ts(20,39): error TS7016: Could not find a declaration file for module 'express'.
src/__tests__/unit/services/dlq-handler.test.ts(101,55): error TS2345: Argument of type '{ rows: { id: string; }[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/dlq-handler.test.ts(137,55): error TS2345: Argument of type '{ rows: { id: string; }[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/dlq-handler.test.ts(178,55): error TS2345: Argument of type '{ rows: { id: string; }[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/dlq-handler.test.ts(216,55): error TS2345: Argument of type '{ rows: { id: string; }[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/dlq-handler.test.ts(263,13): error TS2339: Property 'logger' does not exist on type '{ default: typeof import("..."); createLogger: (config: LoggerConfig) => Logger; Logger: typeof Logger; }'.
src/__tests__/unit/services/dlq-handler.test.ts(276,55): error TS2345: Argument of type '{ rows: { id: string; }[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/kafka-publisher.test.ts(235,55): error TS2345: Argument of type '{ rows: never[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/kafka-publisher.test.ts(273,30): error TS2345: Argument of type '{ rows: never[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/kafka-publisher.test.ts(274,30): error TS2345: Argument of type '{ rows: never[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/kafka-publisher.test.ts(361,30): error TS2345: Argument of type '{ rows: never[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/kafka-publisher.test.ts(362,30): error TS2345: Argument of type '{ rows: never[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/outbox-poller.test.ts(124,55): error TS2345: Argument of type '{ rows: OutboxEvent[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/outbox-poller.test.ts(172,55): error TS2345: Argument of type '{ rows: OutboxEvent[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/outbox-poller.test.ts(216,55): error TS2345: Argument of type '{ rows: OutboxEvent[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/outbox-poller.test.ts(253,55): error TS2345: Argument of type '{ rows: OutboxEvent[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/outbox-poller.test.ts(298,30): error TS2345: Argument of type '{ rows: OutboxEvent[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/outbox-poller.test.ts(306,30): error TS2345: Argument of type '{ rows: never[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/outbox-poller.test.ts(335,55): error TS2345: Argument of type '{ rows: never[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/outbox-poller.test.ts(379,55): error TS2345: Argument of type '{ rows: never[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/__tests__/unit/services/outbox-poller.test.ts(407,55): error TS2345: Argument of type '{ rows: { schema_name: string; table_name: string; last_poll_time: Date; total_events_published: number; }[]; command: string; rowCount: number; oid: number; fields: never[]; }' is not assignable to parameter of type 'void'.
src/index.ts(24,39): error TS7016: Could not find a declaration file for module 'express'.
src/index.ts(27,10): error TS2724: '"@railrepay/winston-logger"' has no exported member named 'logger'. Did you mean 'Logger'?
src/routes/health.routes.ts(16,53): error TS7016: Could not find a declaration file for module 'express'.
src/routes/health.routes.ts(18,10): error TS2724: '"@railrepay/winston-logger"' has no exported member named 'logger'. Did you mean 'Logger'?
src/routes/metrics.routes.ts(21,53): error TS7016: Could not find a declaration file for module 'express'.
src/routes/metrics.routes.ts(23,10): error TS2724: '"@railrepay/winston-logger"' has no exported member named 'logger'. Did you mean 'Logger'?
src/services/dlq-handler.service.ts(17,10): error TS2724: '"@railrepay/winston-logger"' has no exported member named 'logger'. Did you mean 'Logger'?
src/services/kafka-publisher.service.ts(18,10): error TS2724: '"@railrepay/winston-logger"' has no exported member named 'logger'. Did you mean 'Logger'?
src/services/outbox-poller.service.ts(17,10): error TS2724: '"@railrepay/winston-logger"' has no exported member named 'logger'. Did you mean 'Logger'?
src/services/retry-handler.service.ts(15,10): error TS2724: '"@railrepay/winston-logger"' has no exported member named 'logger'. Did you mean 'Logger'?
```

**Total**: 35 TypeScript compilation errors

</details>

---

## Appendix B: Coverage Report (Unit Tests Only)

```
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   86.49 |    76.78 |   73.07 |   86.49 |
 src               |   46.72 |    33.33 |      20 |   46.72 |
  index.ts         |   46.72 |    33.33 |      20 |   46.72 | ...74-204,208-214
 src/routes        |   90.32 |    81.25 |      50 |   90.32 |
  health.routes.ts |   91.07 |    83.33 |     100 |   91.07 | 89-103
  metrics.routes.ts|   89.43 |       75 |      40 |   89.43 | ...01-103,133-138
 src/services      |   98.23 |    78.37 |     100 |   98.23 |
  dlq-handler.service.ts      |     100 |    71.42 |     100 |     100 | 128-132
  kafka-publisher.service.ts  |     100 |    85.71 |     100 |     100 | 135
  outbox-poller.service.ts    |   94.95 |    66.66 |     100 |   94.95 | 202-206,208-213
  retry-handler.service.ts    |     100 |      100 |     100 |     100 |
```

**Production Code (services + routes) Coverage**:
- Lines: 94.28% ✅
- Statements: 94.28% ✅
- Functions: 87.50% ✅
- Branches: 79.81% ✅

**Overall Coverage (including index.ts)**:
- Lines: 86.49% ✅
- Statements: 86.49% ✅
- Functions: 73.07% ❌ (BELOW 80% THRESHOLD)
- Branches: 76.78% ✅
