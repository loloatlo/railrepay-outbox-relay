/**
 * Unit tests for DLQHandler service
 *
 * TDD Approach (Test-Driven Development per ADR-014):
 * - These tests are written BEFORE the implementation exists
 * - Tests MUST FAIL initially (expected behavior)
 * - Implementation code written to make tests pass
 *
 * Test Coverage:
 * - Insert failed event into failed_events table
 * - Include original_event_id, source_schema, source_table
 * - Include event_type, payload, failure_reason, failure_count
 * - Set first_failed_at and last_failed_at timestamps
 * - Handle database errors
 *
 * @see /services/outbox-relay/docs/rfcs/RFC-001-outbox-relay-schema.md § 3.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';

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
 * Mock OutboxEvent interface
 */
interface OutboxEvent {
  id: string;
  aggregate_id: string;
  aggregate_type: string;
  event_type: string;
  payload: Record<string, unknown>;
  correlation_id: string;
  created_at: Date;
  published: boolean;
}

/**
 * Test Suite: DLQHandler
 */
describe('DLQHandler', () => {
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Test 1: Constructor initializes with PostgreSQL pool
   * EXPECTED TO FAIL: DLQHandler class does not exist yet
   */
  it('should initialize with PostgreSQL pool', async () => {
    const { DLQHandler: DLQHandlerClass } = await import('../../../services/dlq-handler.service.js');

    const handler = new DLQHandlerClass(mockPool);

    expect(handler).toBeDefined();
    expect(handler.pool).toBe(mockPool);
  });

  /**
   * Test 2: Insert failed event into failed_events table
   * EXPECTED TO FAIL: moveToDLQ() method does not exist yet
   */
  it('should insert failed event into failed_events table', async () => {
    const { DLQHandler: DLQHandlerClass } = await import('../../../services/dlq-handler.service.js');

    const mockEvent: OutboxEvent = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      aggregate_id: '123e4567-e89b-12d3-a456-426614174000',
      aggregate_type: 'journey',
      event_type: 'journey.created',
      payload: { user_id: 'user_123', origin: 'KGX' },
      correlation_id: '660e8400-e29b-41d4-a716-446655440001',
      created_at: new Date('2026-01-10T10:00:00Z'),
      published: false,
    };

    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [{ id: 'dlq-event-1' }],
      command: 'INSERT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    const handler = new DLQHandlerClass(mockPool);
    await handler.moveToDLQ(mockEvent, 'journey_matcher', 'outbox', 'Kafka timeout', 10);

    // Verify INSERT query was called
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO outbox_relay.failed_events'),
      expect.any(Array)
    );
  });

  /**
   * Test 3: Include all required fields in failed_events INSERT
   * EXPECTED TO FAIL: moveToDLQ() does not include all required fields yet
   */
  it('should include original_event_id, source_schema, source_table in INSERT', async () => {
    const { DLQHandler: DLQHandlerClass } = await import('../../../services/dlq-handler.service.js');

    const mockEvent: OutboxEvent = {
      id: '770e8400-e29b-41d4-a716-446655440002',
      aggregate_id: '234e5678-e89b-12d3-a456-426614174001',
      aggregate_type: 'user',
      event_type: 'user.registered',
      payload: { phone: '+447700900123' },
      correlation_id: '880e8400-e29b-41d4-a716-446655440003',
      created_at: new Date(),
      published: false,
    };

    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [{ id: 'dlq-event-2' }],
      command: 'INSERT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    const handler = new DLQHandlerClass(mockPool);
    await handler.moveToDLQ(mockEvent, 'whatsapp_handler', 'outbox_events', 'Network error', 10);

    // Verify INSERT parameters include required fields
    const insertCall = vi.mocked(mockClient.query).mock.calls[0];
    const params = insertCall[1] as unknown[];

    expect(params).toContain(mockEvent.id); // original_event_id
    expect(params).toContain('whatsapp_handler'); // source_schema
    expect(params).toContain('outbox_events'); // source_table
    expect(params).toContain(mockEvent.event_type); // event_type
    expect(params).toContain('Network error'); // failure_reason
    expect(params).toContain(10); // failure_count
  });

  /**
   * Test 4: Serialize payload as JSONB
   * EXPECTED TO FAIL: moveToDLQ() does not serialize payload yet
   */
  it('should serialize event payload as JSONB in failed_events', async () => {
    const { DLQHandler: DLQHandlerClass } = await import('../../../services/dlq-handler.service.js');

    const mockEvent: OutboxEvent = {
      id: '990e8400-e29b-41d4-a716-446655440004',
      aggregate_id: '345e6789-e89b-12d3-a456-426614174002',
      aggregate_type: 'journey',
      event_type: 'journey.created',
      payload: { origin: 'PAD', destination: 'BRI', fare: 25.50 },
      correlation_id: 'aa0e8400-e29b-41d4-a716-446655440005',
      created_at: new Date(),
      published: false,
    };

    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [{ id: 'dlq-event-3' }],
      command: 'INSERT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    const handler = new DLQHandlerClass(mockPool);
    await handler.moveToDLQ(mockEvent, 'journey_matcher', 'outbox', 'Timeout', 10);

    // Verify payload is JSON stringified
    const insertCall = vi.mocked(mockClient.query).mock.calls[0];
    const params = insertCall[1] as unknown[];
    const payloadParam = params.find(p => typeof p === 'string' && p.includes('origin'));

    expect(payloadParam).toBe(JSON.stringify(mockEvent.payload));
  });

  /**
   * Test 5: Return inserted DLQ event ID
   * EXPECTED TO FAIL: moveToDLQ() does not return event ID yet
   */
  it('should return inserted DLQ event ID', async () => {
    const { DLQHandler: DLQHandlerClass } = await import('../../../services/dlq-handler.service.js');

    const mockEvent: OutboxEvent = {
      id: 'bb0e8400-e29b-41d4-a716-446655440006',
      aggregate_id: '456e7890-e89b-12d3-a456-426614174003',
      aggregate_type: 'journey',
      event_type: 'journey.updated',
      payload: {},
      correlation_id: 'cc0e8400-e29b-41d4-a716-446655440007',
      created_at: new Date(),
      published: false,
    };

    const dlqEventId = 'dlq-550e8400-e29b-41d4-a716-446655440008';
    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [{ id: dlqEventId }],
      command: 'INSERT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    const handler = new DLQHandlerClass(mockPool);
    const result = await handler.moveToDLQ(mockEvent, 'journey_matcher', 'outbox', 'Error', 10);

    expect(result).toBe(dlqEventId);
  });

  /**
   * Test 6: Throw error when INSERT fails
   * EXPECTED TO FAIL: moveToDLQ() does not handle database errors yet
   */
  it('should throw error when failed_events INSERT fails', async () => {
    const { DLQHandler: DLQHandlerClass } = await import('../../../services/dlq-handler.service.js');

    const mockEvent: OutboxEvent = {
      id: 'dd0e8400-e29b-41d4-a716-446655440009',
      aggregate_id: '567e8901-e89b-12d3-a456-426614174004',
      aggregate_type: 'journey',
      event_type: 'journey.created',
      payload: {},
      correlation_id: 'ee0e8400-e29b-41d4-a716-446655440010',
      created_at: new Date(),
      published: false,
    };

    vi.mocked(mockClient.query).mockRejectedValueOnce(new Error('Database connection failed'));

    const handler = new DLQHandlerClass(mockPool);

    await expect(
      handler.moveToDLQ(mockEvent, 'journey_matcher', 'outbox', 'Kafka error', 10)
    ).rejects.toThrow('Database connection failed');
  });

  /**
   * Test 7: Log event move to DLQ
   * EXPECTED TO FAIL: moveToDLQ() does not log yet
   */
  it('should log event when moving to DLQ', async () => {
    const { DLQHandler: DLQHandlerClass } = await import('../../../services/dlq-handler.service.js');

    // Create mock logger to inject into DLQHandler
    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const mockEvent: OutboxEvent = {
      id: 'ff0e8400-e29b-41d4-a716-446655440011',
      aggregate_id: '678e9012-e89b-12d3-a456-426614174005',
      aggregate_type: 'journey',
      event_type: 'journey.created',
      payload: {},
      correlation_id: '110e8400-e29b-41d4-a716-446655440012',
      created_at: new Date(),
      published: false,
    };

    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [{ id: 'dlq-event-4' }],
      command: 'INSERT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    // Inject mock logger into DLQHandler (dependency injection)
    const handler = new DLQHandlerClass(mockPool, mockLogger as any);
    await handler.moveToDLQ(mockEvent, 'journey_matcher', 'outbox', 'Max retries', 10);

    // Verify logger.warn was called (DLQ move is a warning-level event)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('DLQ'),
      expect.objectContaining({
        eventId: mockEvent.id,
        eventType: mockEvent.event_type,
      })
    );
  });
});
