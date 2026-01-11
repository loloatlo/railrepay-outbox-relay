/**
 * Unit tests for OutboxPoller service
 *
 * TDD Approach (Test-Driven Development per ADR-014):
 * - These tests are written BEFORE the implementation exists
 * - Tests MUST FAIL initially (expected behavior)
 * - Implementation code written to make tests pass
 *
 * Test Coverage:
 * - Poll unpublished events from outbox table
 * - Handle table name variations (outbox vs outbox_events)
 * - Handle column name variations (published_at vs processed_at)
 * - Row-level locks (FOR UPDATE SKIP LOCKED)
 * - Update relay_state after poll
 * - Error handling
 *
 * @see /services/outbox-relay/docs/rfcs/RFC-001-outbox-relay-schema.md § 6.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';

// Mock @railrepay/winston-logger before any imports
vi.mock('@railrepay/winston-logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Mock types for testing
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
  published_at?: Date | null;
  processed_at?: Date | null;
}

interface RelayState {
  schema_name: string;
  table_name: string;
  last_poll_time: Date;
  last_published_event_id: string | null;
  total_events_published: number;
}

/**
 * Test Suite: OutboxPoller
 */
describe('OutboxPoller', () => {
  let mockPool: Pool;
  let mockClient: PoolClient;
  let OutboxPoller: any; // Will be imported after implementation exists

  beforeEach(() => {
    // Mock PostgreSQL pool and client
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
   * Test 1: Constructor initializes with pool
   * EXPECTED TO FAIL: OutboxPoller class does not exist yet
   */
  it('should initialize with PostgreSQL pool', async () => {
    // This test will fail until we create the OutboxPoller class
    const { OutboxPoller: OutboxPollerClass } = await import('../../../services/outbox-poller.service.js');

    const poller = new OutboxPollerClass(mockPool, {
      schemas: [
        { schema: 'journey_matcher', table: 'outbox' },
        { schema: 'whatsapp_handler', table: 'outbox_events' },
      ],
    });

    expect(poller).toBeDefined();
    expect(poller.pool).toBe(mockPool);
  });

  /**
   * Test 2: Poll unpublished events from standard outbox table
   * EXPECTED TO FAIL: poll() method does not exist yet
   */
  it('should poll unpublished events from outbox table using FOR UPDATE SKIP LOCKED', async () => {
    const { OutboxPoller: OutboxPollerClass } = await import('../../../services/outbox-poller.service.js');

    const mockEvents: OutboxEvent[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        aggregate_id: '123e4567-e89b-12d3-a456-426614174000',
        aggregate_type: 'journey',
        event_type: 'journey.created',
        payload: { user_id: 'user_123', origin: 'KGX', destination: 'EDI' },
        correlation_id: '660e8400-e29b-41d4-a716-446655440001',
        created_at: new Date('2026-01-10T10:00:00Z'),
        published: false,
        published_at: null,
      },
    ];

    // Mock query to return unpublished events
    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: mockEvents,
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    const poller = new OutboxPollerClass(mockPool, {
      schemas: [{ schema: 'journey_matcher', table: 'outbox' }],
    });

    const events = await poller.poll('journey_matcher', 'outbox');

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(events[0].event_type).toBe('journey.created');

    // Verify query includes FOR UPDATE SKIP LOCKED
    const queryCall = vi.mocked(mockClient.query).mock.calls[0];
    const querySql = queryCall[0] as string;
    expect(querySql).toContain('FOR UPDATE SKIP LOCKED');

    // Verify query filters by published = false
    expect(querySql).toContain('WHERE published = false');
  });

  /**
   * Test 3: Handle table name variation (outbox_events)
   * EXPECTED TO FAIL: poll() method does not handle table name variations yet
   */
  it('should handle outbox_events table name variation', async () => {
    const { OutboxPoller: OutboxPollerClass } = await import('../../../services/outbox-poller.service.js');

    const mockEvents: OutboxEvent[] = [
      {
        id: '770e8400-e29b-41d4-a716-446655440002',
        aggregate_id: '234e5678-e89b-12d3-a456-426614174001',
        aggregate_type: 'user',
        event_type: 'user.registered',
        payload: { user_id: 'user_456', phone: '+447700900123' },
        correlation_id: '880e8400-e29b-41d4-a716-446655440003',
        created_at: new Date('2026-01-10T11:00:00Z'),
        published: false,
        published_at: null,
      },
    ];

    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: mockEvents,
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    const poller = new OutboxPollerClass(mockPool, {
      schemas: [{ schema: 'whatsapp_handler', table: 'outbox_events' }],
    });

    const events = await poller.poll('whatsapp_handler', 'outbox_events');

    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('user.registered');

    // Verify query uses correct table name
    const queryCall = vi.mocked(mockClient.query).mock.calls[0];
    const querySql = queryCall[0] as string;
    expect(querySql).toContain('whatsapp_handler.outbox_events');
  });

  /**
   * Test 4: Handle column name variation (processed_at instead of published_at)
   * EXPECTED TO FAIL: poll() method does not detect column variation yet
   */
  it('should handle processed_at column variation instead of published_at', async () => {
    const { OutboxPoller: OutboxPollerClass } = await import('../../../services/outbox-poller.service.js');

    const mockEvents: OutboxEvent[] = [
      {
        id: '990e8400-e29b-41d4-a716-446655440004',
        aggregate_id: '345e6789-e89b-12d3-a456-426614174002',
        aggregate_type: 'message',
        event_type: 'message.sent',
        payload: { message_id: 'msg_789' },
        correlation_id: 'aa0e8400-e29b-41d4-a716-446655440005',
        created_at: new Date('2026-01-10T12:00:00Z'),
        published: false,
        processed_at: null, // Variation: processed_at instead of published_at
      },
    ];

    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: mockEvents,
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    const poller = new OutboxPollerClass(mockPool, {
      schemas: [{ schema: 'whatsapp_handler', table: 'outbox_events', timestampColumn: 'processed_at' }],
    });

    const events = await poller.poll('whatsapp_handler', 'outbox_events', 'processed_at');

    expect(events).toHaveLength(1);
    expect(events[0]).toHaveProperty('processed_at');
  });

  /**
   * Test 5: Limit batch size to 100 events per poll
   * EXPECTED TO FAIL: poll() method does not implement LIMIT yet
   */
  it('should limit poll batch size to 100 events', async () => {
    const { OutboxPoller: OutboxPollerClass } = await import('../../../services/outbox-poller.service.js');

    const mockEvents: OutboxEvent[] = Array.from({ length: 100 }, (_, i) => ({
      id: `event-${i}`,
      aggregate_id: `aggregate-${i}`,
      aggregate_type: 'test',
      event_type: 'test.event',
      payload: {},
      correlation_id: `correlation-${i}`,
      created_at: new Date(),
      published: false,
      published_at: null,
    }));

    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: mockEvents,
      command: 'SELECT',
      rowCount: 100,
      oid: 0,
      fields: [],
    } as any);

    const poller = new OutboxPollerClass(mockPool, {
      schemas: [{ schema: 'journey_matcher', table: 'outbox' }],
    });

    await poller.poll('journey_matcher', 'outbox');

    // Verify query includes LIMIT with parameter $1 = 100
    const queryCall = vi.mocked(mockClient.query).mock.calls[0];
    const querySql = queryCall[0] as string;
    const queryParams = queryCall[1] as unknown[];
    expect(querySql).toContain('LIMIT $1');
    expect(queryParams[0]).toBe(100);
  });

  /**
   * Test 6: Update relay_state after successful poll
   * EXPECTED TO FAIL: updateRelayState() method does not exist yet
   */
  it('should update relay_state after successful poll', async () => {
    const { OutboxPoller: OutboxPollerClass } = await import('../../../services/outbox-poller.service.js');

    const mockEvents: OutboxEvent[] = [
      {
        id: 'bb0e8400-e29b-41d4-a716-446655440006',
        aggregate_id: '456e7890-e89b-12d3-a456-426614174003',
        aggregate_type: 'journey',
        event_type: 'journey.updated',
        payload: {},
        correlation_id: 'cc0e8400-e29b-41d4-a716-446655440007',
        created_at: new Date(),
        published: false,
        published_at: null,
      },
    ];

    // Mock poll query
    vi.mocked(mockClient.query)
      .mockResolvedValueOnce({
        rows: mockEvents,
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      } as any)
      // Mock relay_state update query
      .mockResolvedValueOnce({
        rows: [],
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
      } as any);

    const poller = new OutboxPollerClass(mockPool, {
      schemas: [{ schema: 'journey_matcher', table: 'outbox' }],
    } as any);

    await poller.poll('journey_matcher', 'outbox');

    // Verify relay_state UPDATE query was called
    const updateCall = vi.mocked(mockClient.query).mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('UPDATE outbox_relay.relay_state')
    );
    expect(updateCall).toBeDefined();
  });

  /**
   * Test 7: Handle empty result set (no unpublished events)
   * EXPECTED TO FAIL: poll() method does not handle empty results yet
   */
  it('should return empty array when no unpublished events', async () => {
    const { OutboxPoller: OutboxPollerClass } = await import('../../../services/outbox-poller.service.js');

    // Mock empty result
    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [],
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
    } as any);

    const poller = new OutboxPollerClass(mockPool, {
      schemas: [{ schema: 'journey_matcher', table: 'outbox' }],
    });

    const events = await poller.poll('journey_matcher', 'outbox');

    expect(events).toEqual([]);
    expect(events).toHaveLength(0);
  });

  /**
   * Test 8: Error handling - database connection failure
   * EXPECTED TO FAIL: poll() method does not handle errors yet
   */
  it('should throw error when database connection fails', async () => {
    const { OutboxPoller: OutboxPollerClass } = await import('../../../services/outbox-poller.service.js');

    // Mock connection failure
    vi.mocked(mockClient.query).mockRejectedValueOnce(
      new Error('Connection timeout')
    );

    const poller = new OutboxPollerClass(mockPool, {
      schemas: [{ schema: 'journey_matcher', table: 'outbox' }],
    });

    await expect(poller.poll('journey_matcher', 'outbox')).rejects.toThrow('Connection timeout');
  });

  /**
   * Test 9: Order events by created_at for consistent processing
   * EXPECTED TO FAIL: poll() method does not order by created_at yet
   */
  it('should order events by created_at ASC for consistent processing', async () => {
    const { OutboxPoller: OutboxPollerClass } = await import('../../../services/outbox-poller.service.js');

    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [],
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
    } as any);

    const poller = new OutboxPollerClass(mockPool, {
      schemas: [{ schema: 'journey_matcher', table: 'outbox' }],
    });

    await poller.poll('journey_matcher', 'outbox');

    // Verify query includes ORDER BY created_at
    const queryCall = vi.mocked(mockClient.query).mock.calls[0];
    const querySql = queryCall[0] as string;
    expect(querySql).toContain('ORDER BY created_at');
  });

  /**
   * Test 10: Initialize relay_state for new schema if not exists
   * EXPECTED TO FAIL: ensureRelayState() method does not exist yet
   */
  it('should initialize relay_state if not exists for new schema', async () => {
    const { OutboxPoller: OutboxPollerClass } = await import('../../../services/outbox-poller.service.js');

    // Mock relay_state INSERT ON CONFLICT query
    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [{
        schema_name: 'journey_matcher',
        table_name: 'outbox',
        last_poll_time: new Date(),
        total_events_published: 0,
      }],
      command: 'INSERT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    const poller = new OutboxPollerClass(mockPool, {
      schemas: [{ schema: 'journey_matcher', table: 'outbox' }],
    });

    await poller.ensureRelayState('journey_matcher', 'outbox');

    // Verify INSERT ON CONFLICT query was called
    const queryCall = vi.mocked(mockClient.query).mock.calls[0];
    const querySql = queryCall[0] as string;
    expect(querySql).toContain('INSERT INTO outbox_relay.relay_state');
    expect(querySql).toContain('ON CONFLICT (schema_name)');
  });
});
