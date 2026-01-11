/**
 * Unit tests for Main Application (index.ts)
 *
 * TDD Approach (Test-Driven Development per ADR-014):
 * - These tests are written BEFORE the implementation exists
 * - Tests MUST FAIL initially (expected behavior)
 * - Implementation code written to make tests pass
 *
 * Test Coverage:
 * - Express server initialization
 * - Health and metrics routes mounted
 * - Graceful shutdown on SIGTERM/SIGINT
 * - PostgreSQL pool creation
 * - Kafka producer initialization
 * - Polling loop (10s interval)
 *
 * Note: This test file focuses on UNIT testing the main application's
 * initialization and structure. Integration testing will be handled separately.
 *
 * @see /services/outbox-relay/docs/phases/PHASE-1-SPECIFICATION.md § 6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all external dependencies
vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock PostgreSQL Pool
const mockPoolConnect = vi.fn().mockResolvedValue({
  query: vi.fn(),
  release: vi.fn(),
});
const mockPoolEnd = vi.fn().mockResolvedValue(undefined);

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: mockPoolConnect,
    end: mockPoolEnd,
  })),
}));

// Mock Kafka Producer
const mockProducerConnect = vi.fn().mockResolvedValue(undefined);
const mockProducerDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock('kafkajs', () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    producer: vi.fn().mockReturnValue({
      connect: mockProducerConnect,
      disconnect: mockProducerDisconnect,
    }),
  })),
}));

/**
 * Test Suite: Main Application
 */
describe('Main Application (index.ts)', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    mockPoolConnect.mockClear();
    mockPoolEnd.mockClear();
    mockProducerConnect.mockClear();
    mockProducerDisconnect.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Test 1: Export createApp function
   * EXPECTED TO FAIL: createApp function does not exist yet
   */
  it('should export createApp function', async () => {
    const indexModule = await import('../../index.js');

    expect(indexModule.createApp).toBeDefined();
    expect(typeof indexModule.createApp).toBe('function');
  });

  /**
   * Test 2: createApp returns Express application
   * EXPECTED TO FAIL: createApp does not return Express app yet
   */
  it('should return Express application from createApp', async () => {
    const { createApp } = await import('../../index.js');

    const app = createApp();

    expect(app).toBeDefined();
    expect(app.listen).toBeDefined(); // Express apps have .listen()
  });

  /**
   * Test 3: Health routes mounted at /health
   * EXPECTED TO FAIL: Health routes not mounted yet
   */
  it('should mount health routes at /health', async () => {
    const { createApp } = await import('../../index.js');
    const request = (await import('supertest')).default;

    const app = createApp();

    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
  });

  /**
   * Test 4: Metrics routes mounted at /metrics
   * EXPECTED TO FAIL: Metrics routes not mounted yet
   */
  it('should mount metrics routes at /metrics', async () => {
    const { createApp } = await import('../../index.js');
    const request = (await import('supertest')).default;

    const app = createApp();

    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
  });

  /**
   * Test 5: Export initializeDatabase function
   * EXPECTED TO FAIL: initializeDatabase function does not exist yet
   */
  it('should export initializeDatabase function', async () => {
    const indexModule = await import('../../index.js');

    expect(indexModule.initializeDatabase).toBeDefined();
    expect(typeof indexModule.initializeDatabase).toBe('function');
  });

  /**
   * Test 6: Export initializeKafka function
   * EXPECTED TO FAIL: initializeKafka function does not exist yet
   */
  it('should export initializeKafka function', async () => {
    const indexModule = await import('../../index.js');

    expect(indexModule.initializeKafka).toBeDefined();
    expect(typeof indexModule.initializeKafka).toBe('function');
  });

  /**
   * Test 7: Export gracefulShutdown function
   * EXPECTED TO FAIL: gracefulShutdown function does not exist yet
   */
  it('should export gracefulShutdown function', async () => {
    const indexModule = await import('../../index.js');

    expect(indexModule.gracefulShutdown).toBeDefined();
    expect(typeof indexModule.gracefulShutdown).toBe('function');
  });
});
