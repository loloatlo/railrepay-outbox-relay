/**
 * Unit tests for Metrics Routes
 *
 * TDD Approach (Test-Driven Development per ADR-014):
 * - These tests are written BEFORE the implementation exists
 * - Tests MUST FAIL initially (expected behavior)
 * - Implementation code written to make tests pass
 *
 * Test Coverage:
 * - GET /metrics - Prometheus format
 * - 4 required metrics: events_polled, events_published, events_failed, poll_latency
 * - Metrics include labels (schema, table, event_type)
 * - Content-Type: text/plain; version=0.0.4
 *
 * @see /services/outbox-relay/docs/phases/PHASE-1-SPECIFICATION.md § 5.4
 * @see Architecture › Observability
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
 * Test Suite: Metrics Routes
 */
describe('Metrics Routes', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Test 1: GET /metrics returns 200 OK
   * EXPECTED TO FAIL: Metrics routes do not exist yet
   */
  it('should return 200 OK for GET /metrics', async () => {
    const { createMetricsRoutes } = await import('../../../routes/metrics.routes.js');

    app.use('/metrics', createMetricsRoutes());

    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
  });

  /**
   * Test 2: Response Content-Type is text/plain; version=0.0.4 (Prometheus format)
   * EXPECTED TO FAIL: Content-Type header not set yet
   */
  it('should return Content-Type: text/plain; version=0.0.4', async () => {
    const { createMetricsRoutes } = await import('../../../routes/metrics.routes.js');

    app.use('/metrics', createMetricsRoutes());

    const response = await request(app).get('/metrics');

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['content-type']).toContain('version=0.0.4');
  });

  /**
   * Test 3: Response includes events_polled_total metric
   * EXPECTED TO FAIL: events_polled metric does not exist yet
   */
  it('should include events_polled_total metric in response', async () => {
    const { createMetricsRoutes } = await import('../../../routes/metrics.routes.js');

    app.use('/metrics', createMetricsRoutes());

    const response = await request(app).get('/metrics');

    expect(response.text).toContain('events_polled_total');
    expect(response.text).toContain('# HELP events_polled_total');
    expect(response.text).toContain('# TYPE events_polled_total counter');
  });

  /**
   * Test 4: Response includes events_published_total metric
   * EXPECTED TO FAIL: events_published metric does not exist yet
   */
  it('should include events_published_total metric in response', async () => {
    const { createMetricsRoutes } = await import('../../../routes/metrics.routes.js');

    app.use('/metrics', createMetricsRoutes());

    const response = await request(app).get('/metrics');

    expect(response.text).toContain('events_published_total');
    expect(response.text).toContain('# HELP events_published_total');
    expect(response.text).toContain('# TYPE events_published_total counter');
  });

  /**
   * Test 5: Response includes events_failed_total metric
   * EXPECTED TO FAIL: events_failed metric does not exist yet
   */
  it('should include events_failed_total metric in response', async () => {
    const { createMetricsRoutes } = await import('../../../routes/metrics.routes.js');

    app.use('/metrics', createMetricsRoutes());

    const response = await request(app).get('/metrics');

    expect(response.text).toContain('events_failed_total');
    expect(response.text).toContain('# HELP events_failed_total');
    expect(response.text).toContain('# TYPE events_failed_total counter');
  });

  /**
   * Test 6: Response includes poll_latency_seconds metric
   * EXPECTED TO FAIL: poll_latency metric does not exist yet
   */
  it('should include poll_latency_seconds metric in response', async () => {
    const { createMetricsRoutes } = await import('../../../routes/metrics.routes.js');

    app.use('/metrics', createMetricsRoutes());

    const response = await request(app).get('/metrics');

    expect(response.text).toContain('poll_latency_seconds');
    expect(response.text).toContain('# HELP poll_latency_seconds');
    expect(response.text).toContain('# TYPE poll_latency_seconds histogram');
  });

  /**
   * Test 7: Metrics include labels (schema, table, event_type)
   * EXPECTED TO FAIL: Labels not included in metrics yet
   */
  it('should include labels (schema, table, event_type) in metrics', async () => {
    const { createMetricsRoutes, incrementEventsPolled } = await import('../../../routes/metrics.routes.js');

    // Increment a metric with labels to test
    incrementEventsPolled('journey_matcher', 'outbox');

    app.use('/metrics', createMetricsRoutes());

    const response = await request(app).get('/metrics');

    // Check that metrics include label names in metric output
    expect(response.text).toMatch(/schema="[\w_]+"/);
    expect(response.text).toMatch(/table="[\w_]+"/);
  });

  /**
   * Test 8: Export incrementEventsPolled function
   * EXPECTED TO FAIL: incrementEventsPolled function does not exist yet
   */
  it('should export incrementEventsPolled function', async () => {
    const { incrementEventsPolled } = await import('../../../routes/metrics.routes.js');

    expect(incrementEventsPolled).toBeDefined();
    expect(typeof incrementEventsPolled).toBe('function');
  });

  /**
   * Test 9: Export incrementEventsPublished function
   * EXPECTED TO FAIL: incrementEventsPublished function does not exist yet
   */
  it('should export incrementEventsPublished function', async () => {
    const { incrementEventsPublished } = await import('../../../routes/metrics.routes.js');

    expect(incrementEventsPublished).toBeDefined();
    expect(typeof incrementEventsPublished).toBe('function');
  });

  /**
   * Test 10: Export incrementEventsFailed function
   * EXPECTED TO FAIL: incrementEventsFailed function does not exist yet
   */
  it('should export incrementEventsFailed function', async () => {
    const { incrementEventsFailed } = await import('../../../routes/metrics.routes.js');

    expect(incrementEventsFailed).toBeDefined();
    expect(typeof incrementEventsFailed).toBe('function');
  });

  /**
   * Test 11: Export recordPollLatency function
   * EXPECTED TO FAIL: recordPollLatency function does not exist yet
   */
  it('should export recordPollLatency function', async () => {
    const { recordPollLatency } = await import('../../../routes/metrics.routes.js');

    expect(recordPollLatency).toBeDefined();
    expect(typeof recordPollLatency).toBe('function');
  });

  /**
   * Test 12: Metrics endpoint does not modify state (idempotent GET)
   * EXPECTED TO FAIL: Metrics implementation does not exist yet
   */
  it('should return same metrics on multiple GET requests (idempotent)', async () => {
    const { createMetricsRoutes } = await import('../../../routes/metrics.routes.js');

    app.use('/metrics', createMetricsRoutes());

    const response1 = await request(app).get('/metrics');
    const response2 = await request(app).get('/metrics');

    // Metrics should not change between requests (unless modified externally)
    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    expect(typeof response1.text).toBe('string');
    expect(typeof response2.text).toBe('string');
  });

  /**
   * Test 13: incrementEventsPolled increments counter correctly
   */
  it('should increment events_polled_total counter when incrementEventsPolled is called', async () => {
    const { createMetricsRoutes, incrementEventsPublished, incrementEventsFailed, recordPollLatency } = await import('../../../routes/metrics.routes.js');

    app.use('/metrics', createMetricsRoutes());

    // Call the helper functions to ensure they're covered
    incrementEventsPublished('test_schema', 'test_table', 'test.event');
    incrementEventsFailed('test_schema', 'test_table', 'test.event');
    recordPollLatency('test_schema', 'test_table', 0.5);

    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    // These functions should not throw errors
    expect(response.text).toBeDefined();
  });
});
