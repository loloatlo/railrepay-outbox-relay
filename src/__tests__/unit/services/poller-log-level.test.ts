/**
 * Unit tests for TD-OUTBOX-RELAY-003: Idle Log Level Fix
 *
 * TDD Approach (ADR-014): Tests written BEFORE implementation.
 * These tests MUST FAIL against current code.
 *
 * Acceptance Criteria:
 * - AC-2: Zero-event polls log at `debug` level (not `info`);
 *         polls with events > 0 log at `info`
 *
 * @see BL TD-OUTBOX-RELAY-003 (305815ba-72ee-8196-9b2e-c8a900d06d28)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';

// Shared mock logger with spies we can inspect
const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('@railrepay/winston-logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

describe('TD-OUTBOX-RELAY-003: OutboxPoller Log Level', () => {
  let mockPool: Pool;
  let mockClient: PoolClient;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    } as unknown as PoolClient;

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn(),
      end: vi.fn(),
    } as unknown as Pool;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * AC-2: Zero-event polls should log at debug level, not info
   *
   * When poll returns 0 events, the log message "Polled events from outbox"
   * should be at debug level to reduce idle log volume.
   *
   * EXPECTED TO FAIL: Current code always logs at info level (line 126)
   */
  it('should log at debug level when zero events are polled', async () => {
    const { OutboxPoller } = await import('../../../services/outbox-poller.service.js');

    // Mock query returning zero events
    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [],
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
    } as any);

    const poller = new OutboxPoller(mockPool, {
      schemas: [{ schema: 'whatsapp_handler', table: 'outbox_events' }],
    });

    // Clear mocks after constructor (which also logs)
    mockLogger.info.mockClear();
    mockLogger.debug.mockClear();

    await poller.poll('whatsapp_handler', 'outbox_events');

    // AC-2: When eventCount === 0, the "Polled events" log should be at DEBUG
    const debugCalls = mockLogger.debug.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('Polled events')
    );
    const infoCalls = mockLogger.info.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('Polled events')
    );

    // debug should have the "Polled events" message
    expect(debugCalls.length).toBeGreaterThanOrEqual(1);
    // info should NOT have the "Polled events" message when 0 events
    expect(infoCalls.length).toBe(0);
  });

  /**
   * AC-2: Non-zero event polls should still log at info level
   *
   * When poll returns events > 0, the log message should remain at info
   * level for visibility.
   *
   * This test verifies no regression: info logging is preserved when
   * there are actual events to process.
   */
  it('should log at info level when events are polled', async () => {
    const { OutboxPoller } = await import('../../../services/outbox-poller.service.js');

    const mockEvents = [
      {
        id: 'event-001',
        aggregate_id: 'agg-001',
        aggregate_type: 'journey',
        event_type: 'journey.created',
        payload: { origin: 'KGX' },
        created_at: new Date(),
        published_at: null,
      },
    ];

    // Mock query returning events
    vi.mocked(mockClient.query)
      .mockResolvedValueOnce({
        rows: mockEvents,
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      } as any)
      // Mock relay_state update
      .mockResolvedValueOnce({
        rows: [],
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
      } as any);

    const poller = new OutboxPoller(mockPool, {
      schemas: [{ schema: 'whatsapp_handler', table: 'outbox_events' }],
    });

    // Clear mocks after constructor
    mockLogger.info.mockClear();
    mockLogger.debug.mockClear();

    await poller.poll('whatsapp_handler', 'outbox_events');

    // AC-2: When eventCount > 0, the "Polled events" log should be at INFO
    const infoCalls = mockLogger.info.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('Polled events')
    );

    expect(infoCalls.length).toBeGreaterThanOrEqual(1);
    // Verify the log includes eventCount
    expect(infoCalls[0][1]).toEqual(
      expect.objectContaining({ eventCount: 1 })
    );
  });

  /**
   * AC-2: Verify the debug log includes schema context when zero events
   *
   * The debug log for zero-event polls should still include schema and
   * table name for debugging purposes.
   */
  it('should include schema context in debug log for zero-event polls', async () => {
    const { OutboxPoller } = await import('../../../services/outbox-poller.service.js');

    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [],
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
    } as any);

    const poller = new OutboxPoller(mockPool, {
      schemas: [{ schema: 'journey_matcher', table: 'outbox' }],
    });

    mockLogger.debug.mockClear();

    await poller.poll('journey_matcher', 'outbox');

    // Verify debug log includes context
    const debugCalls = mockLogger.debug.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('Polled events')
    );

    expect(debugCalls.length).toBeGreaterThanOrEqual(1);
    expect(debugCalls[0][1]).toEqual(
      expect.objectContaining({
        schema: 'journey_matcher',
        table: 'outbox',
        eventCount: 0,
      })
    );
  });
});
