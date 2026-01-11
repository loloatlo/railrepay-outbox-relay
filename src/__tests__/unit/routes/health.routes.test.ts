/**
 * Unit tests for Health Check Routes
 *
 * TDD Approach (Test-Driven Development per ADR-014):
 * - These tests are written BEFORE the implementation exists
 * - Tests MUST FAIL initially (expected behavior)
 * - Implementation code written to make tests pass
 *
 * Test Coverage:
 * - GET /health/live - Liveness probe (200 OK if running)
 * - GET /health/ready - Readiness probe (check DB + last_poll < 30s)
 * - Response format includes status and timestamp
 * - Handle DB connection failures
 * - Handle stale polling state (last_poll > 30s)
 *
 * @see /services/outbox-relay/docs/phases/PHASE-1-SPECIFICATION.md § 5.3
 * @see Architecture › ADR-008 (Health Check Endpoint)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import express, { type Express } from 'express';
import request from 'supertest';

// Mock @railrepay/winston-logger
vi.mock('@railrepay/winston-logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Test Suite: Health Check Routes
 */
describe('Health Check Routes', () => {
  let app: Express;
  let mockPool: Pool;
  let mockClient: PoolClient;

  beforeEach(() => {
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    } as unknown as PoolClient;

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn(),
      end: vi.fn(),
    } as unknown as Pool;

    app = express();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Test 1: GET /health/live returns 200 OK (liveness probe)
   * EXPECTED TO FAIL: Health routes do not exist yet
   */
  it('should return 200 OK for GET /health/live (liveness probe)', async () => {
    const { createHealthRoutes } = await import('../../../routes/health.routes.js');

    app.use('/health', createHealthRoutes(mockPool));

    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('timestamp');
  });

  /**
   * Test 2: GET /health/ready returns 200 OK when DB connected and last_poll recent
   * EXPECTED TO FAIL: Readiness check does not exist yet
   */
  it('should return 200 OK for GET /health/ready when DB healthy and last_poll < 30s', async () => {
    const { createHealthRoutes } = await import('../../../routes/health.routes.js');

    app.use('/health', createHealthRoutes(mockPool));

    // Mock relay_state query - last_poll was 10 seconds ago
    const tenSecondsAgo = new Date(Date.now() - 10000);
    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [{ last_poll_time: tenSecondsAgo }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ready');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('checks');
    expect(response.body.checks).toHaveProperty('database', 'ok');
    expect(response.body.checks).toHaveProperty('polling', 'ok');
  });

  /**
   * Test 3: GET /health/ready returns 503 when DB disconnected
   * EXPECTED TO FAIL: DB connection check does not exist yet
   */
  it('should return 503 Service Unavailable when database is disconnected', async () => {
    const { createHealthRoutes } = await import('../../../routes/health.routes.js');

    app.use('/health', createHealthRoutes(mockPool));

    // Mock DB connection failure
    vi.mocked(mockPool.connect).mockRejectedValueOnce(new Error('Connection refused'));

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toHaveProperty('status', 'unavailable');
    expect(response.body.checks).toHaveProperty('database', 'error');
  });

  /**
   * Test 4: GET /health/ready returns 503 when last_poll > 30s (stale polling)
   * EXPECTED TO FAIL: Polling staleness check does not exist yet
   */
  it('should return 503 Service Unavailable when last_poll > 30 seconds (stale)', async () => {
    const { createHealthRoutes } = await import('../../../routes/health.routes.js');

    app.use('/health', createHealthRoutes(mockPool));

    // Mock relay_state query - last_poll was 60 seconds ago (stale)
    const sixtySecondsAgo = new Date(Date.now() - 60000);
    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [{ last_poll_time: sixtySecondsAgo }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toHaveProperty('status', 'unavailable');
    expect(response.body.checks).toHaveProperty('database', 'ok');
    expect(response.body.checks).toHaveProperty('polling', 'stale');
  });

  /**
   * Test 5: Response format includes status, timestamp, and checks
   * EXPECTED TO FAIL: Response shape does not match expected format yet
   */
  it('should return response with status, timestamp, and checks properties', async () => {
    const { createHealthRoutes } = await import('../../../routes/health.routes.js');

    app.use('/health', createHealthRoutes(mockPool));

    // Mock healthy state
    const recentTime = new Date(Date.now() - 5000);
    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [{ last_poll_time: recentTime }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    const response = await request(app).get('/health/ready');

    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('checks');
    expect(typeof response.body.status).toBe('string');
    expect(typeof response.body.timestamp).toBe('string');
    expect(typeof response.body.checks).toBe('object');
  });

  /**
   * Test 6: Liveness probe does NOT check database (should be fast)
   * EXPECTED TO FAIL: Liveness probe implementation does not exist yet
   */
  it('should NOT query database for liveness probe (fast check)', async () => {
    const { createHealthRoutes } = await import('../../../routes/health.routes.js');

    app.use('/health', createHealthRoutes(mockPool));

    await request(app).get('/health/live');

    // Liveness probe should NOT connect to DB
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  /**
   * Test 7: Readiness probe queries relay_state for last_poll_time
   * EXPECTED TO FAIL: Readiness probe does not query relay_state yet
   */
  it('should query relay_state table for last_poll_time in readiness probe', async () => {
    const { createHealthRoutes } = await import('../../../routes/health.routes.js');

    app.use('/health', createHealthRoutes(mockPool));

    const recentTime = new Date(Date.now() - 10000);
    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [{ last_poll_time: recentTime }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    await request(app).get('/health/ready');

    // Verify relay_state was queried
    const queryCall = vi.mocked(mockClient.query).mock.calls[0];
    const querySql = queryCall[0] as string;
    expect(querySql).toContain('outbox_relay.relay_state');
    expect(querySql).toContain('last_poll_time');
  });
});
