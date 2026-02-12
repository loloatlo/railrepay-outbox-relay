/**
 * Unit tests for TD-OUTBOX-RELAY-003: Polling Loop Fix
 *
 * TDD Approach (ADR-014): Tests written BEFORE implementation.
 * These tests MUST FAIL against current code.
 *
 * Acceptance Criteria:
 * - AC-1: Polling loop uses recursive setTimeout (not setInterval)
 *         so next poll starts only AFTER current poll completes
 * - AC-3: Graceful shutdown clears the setTimeout handle correctly
 * - AC-4: No regression in existing polling behavior
 *
 * Testing Strategy:
 * Since startPollingLoop is not exported, these tests verify the behavior
 * through main() which calls startPollingLoop internally. The main()
 * function already supports dependency injection for initDb, initKafka,
 * and createApp.
 *
 * @see BL TD-OUTBOX-RELAY-003 (305815ba-72ee-8196-9b2e-c8a900d06d28)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock metrics-pusher with all exports used by the service
vi.mock('@railrepay/metrics-pusher', () => {
  const mockRegister = {
    metrics: vi.fn().mockResolvedValue(''),
    contentType: 'text/plain',
  };
  return {
    MetricsPusher: vi.fn().mockImplementation(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    })),
    getRegistry: vi.fn().mockReturnValue(mockRegister),
    Counter: vi.fn().mockImplementation(() => ({
      inc: vi.fn(),
      labels: vi.fn().mockReturnThis(),
    })),
    Histogram: vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      labels: vi.fn().mockReturnThis(),
    })),
  };
});

// Mock net module so broker connectivity test completes instantly
vi.mock('net', () => ({
  Socket: vi.fn().mockImplementation(() => {
    const self = {
      setTimeout: vi.fn(),
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'connect') {
          // Immediately signal connect to avoid hanging
          Promise.resolve().then(() => cb());
        }
        return self;
      }),
      connect: vi.fn(),
      destroy: vi.fn(),
    };
    return self;
  }),
}));

describe('TD-OUTBOX-RELAY-003: Polling Loop Fix', () => {
  let originalOutboxSchemas: string | undefined;
  let originalPollingInterval: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    // Save and set env vars
    originalOutboxSchemas = process.env.OUTBOX_SCHEMAS;
    originalPollingInterval = process.env.POLLING_INTERVAL_MS;
    process.env.OUTBOX_SCHEMAS = 'whatsapp_handler';
    process.env.POLLING_INTERVAL_MS = '1000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore env vars
    if (originalOutboxSchemas !== undefined) {
      process.env.OUTBOX_SCHEMAS = originalOutboxSchemas;
    } else {
      delete process.env.OUTBOX_SCHEMAS;
    }
    if (originalPollingInterval !== undefined) {
      process.env.POLLING_INTERVAL_MS = originalPollingInterval;
    } else {
      delete process.env.POLLING_INTERVAL_MS;
    }
  });

  /**
   * AC-3: Graceful shutdown clears setTimeout handle (not clearInterval)
   *
   * After the fix, gracefulShutdown must call clearTimeout instead of
   * clearInterval to stop the polling loop.
   *
   * EXPECTED TO FAIL: Current code uses clearInterval (line 392 of index.ts)
   */
  it('should call clearTimeout (not clearInterval) during graceful shutdown', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const mockPool = {
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      }),
      end: vi.fn().mockResolvedValue(undefined),
    };

    const mockProducer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
    };

    const mockApp = {
      listen: vi.fn((_port: number, cb: () => void) => {
        cb();
        return {} as any;
      }),
      use: vi.fn(),
    };

    const { main, gracefulShutdown } = await import('../../index.js');

    await main({
      initDb: vi.fn().mockResolvedValue(mockPool),
      initKafka: vi.fn().mockResolvedValue(mockProducer),
      createApp: vi.fn().mockReturnValue(mockApp),
      exitFn: vi.fn(),
      port: 0,
    });

    // Reset spy counts before shutdown
    clearIntervalSpy.mockClear();

    // Trigger graceful shutdown
    await gracefulShutdown(
      { producer: mockProducer as any, pool: mockPool as any },
      vi.fn()
    );

    // AC-3: clearInterval should NOT be called during shutdown
    // (after the fix, it should use clearTimeout instead)
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
  }, 15000);

  /**
   * AC-4: Polling loop still executes pollOnce on startup
   *
   * This test verifies that after the fix, pollOnce() is still called
   * immediately on startup (no regression). The current code calls
   * pollOnce() immediately, and the fix should preserve this behavior.
   *
   * This test SHOULD PASS on both old and new code.
   */
  it('should execute pollOnce immediately on startup', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      end: vi.fn().mockResolvedValue(undefined),
    };

    const mockProducer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
    };

    const mockApp = {
      listen: vi.fn((_port: number, cb: () => void) => {
        cb();
        return {} as any;
      }),
      use: vi.fn(),
    };

    const { main } = await import('../../index.js');

    await main({
      initDb: vi.fn().mockResolvedValue(mockPool),
      initKafka: vi.fn().mockResolvedValue(mockProducer),
      createApp: vi.fn().mockReturnValue(mockApp),
      exitFn: vi.fn(),
      port: 0,
    });

    // Wait for the initial pollOnce() to execute
    await new Promise(resolve => process.nextTick(resolve));
    await new Promise(resolve => process.nextTick(resolve));

    // AC-4: Pool.connect should have been called at least once for polling
    expect(mockPool.connect).toHaveBeenCalled();
  }, 15000);

  /**
   * AC-1: The startPollingLoop function should export or expose a way
   * to verify that recursive setTimeout is used.
   *
   * Since startPollingLoop is not exported and testing through main()
   * with setInterval interception is complex, this test takes a different
   * approach: it verifies the source code directly does NOT contain
   * setInterval for the polling loop.
   *
   * This is a structural test that Blake's implementation must satisfy.
   * After Blake's fix:
   * - The polling loop in startPollingLoop must use setTimeout
   * - gracefulShutdown must use clearTimeout
   *
   * EXPECTED TO FAIL: Current code has setInterval at line 546
   */
  it('should not contain setInterval in startPollingLoop function', async () => {
    const fs = await import('fs');
    const path = await import('path');

    // Read the actual source file
    const indexPath = path.resolve(
      import.meta.dirname,
      '../../..',
      'src',
      'index.ts'
    );
    const sourceCode = fs.readFileSync(indexPath, 'utf-8');

    // Extract the startPollingLoop function body
    const startPollingMatch = sourceCode.match(
      /function startPollingLoop[\s\S]*?^}/m
    );

    expect(startPollingMatch).not.toBeNull();

    const startPollingBody = startPollingMatch![0];

    // AC-1: startPollingLoop must NOT use setInterval
    expect(startPollingBody).not.toContain('setInterval');

    // AC-1: startPollingLoop MUST use setTimeout for scheduling
    expect(startPollingBody).toContain('setTimeout');
  });

  /**
   * AC-3: gracefulShutdown must use clearTimeout, not clearInterval
   *
   * Structural test to verify the source code uses the correct
   * timer cleanup method.
   *
   * EXPECTED TO FAIL: Current code has clearInterval at line 392
   */
  it('should not contain clearInterval in gracefulShutdown function', async () => {
    const fs = await import('fs');
    const path = await import('path');

    // Read the actual source file
    const indexPath = path.resolve(
      import.meta.dirname,
      '../../..',
      'src',
      'index.ts'
    );
    const sourceCode = fs.readFileSync(indexPath, 'utf-8');

    // Extract the gracefulShutdown function body
    const shutdownMatch = sourceCode.match(
      /async function gracefulShutdown[\s\S]*?^}/m
    );

    // The function is exported, so look for it with export
    const exportedShutdownMatch = sourceCode.match(
      /export async function gracefulShutdown[\s\S]*?^}/m
    );

    const shutdownBody = (shutdownMatch || exportedShutdownMatch)?.[0];
    expect(shutdownBody).not.toBeNull();

    // AC-3: gracefulShutdown must NOT use clearInterval
    expect(shutdownBody!).not.toContain('clearInterval');

    // AC-3: gracefulShutdown MUST use clearTimeout
    expect(shutdownBody!).toContain('clearTimeout');
  });
});
