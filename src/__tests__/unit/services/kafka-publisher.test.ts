/**
 * Unit tests for KafkaPublisher service
 *
 * TDD Approach (Test-Driven Development per ADR-014):
 * - These tests are written BEFORE the implementation exists
 * - Tests MUST FAIL initially (expected behavior)
 * - Implementation code written to make tests pass
 *
 * Test Coverage:
 * - Publish event to Kafka with correct topic (event_type)
 * - Use aggregate_id as partition key for ordering (AC-3)
 * - Include correlation_id, event_id, created_at in headers
 * - Retry logic with exponential backoff
 * - Mark event as published after success
 * - Error handling for Kafka failures
 *
 * @see /services/outbox-relay/docs/phases/PHASE-1-SPECIFICATION.md § 4.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { Producer, Message } from 'kafkajs';

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
 * Test Suite: KafkaPublisher
 */
describe('KafkaPublisher', () => {
  let mockProducer: Producer;
  let mockPool: Pool;
  let mockClient: PoolClient;

  beforeEach(() => {
    // Mock Kafka producer
    mockProducer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue([{ topicName: 'test.topic', partition: 0, errorCode: 0 }]),
    } as unknown as Producer;

    // Mock PostgreSQL client
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
   * Test 1: Constructor initializes with Kafka producer and PostgreSQL pool
   * EXPECTED TO FAIL: KafkaPublisher class does not exist yet
   */
  it('should initialize with Kafka producer and PostgreSQL pool', async () => {
    const { KafkaPublisher: KafkaPublisherClass } = await import('../../../services/kafka-publisher.service.js');

    const publisher = new KafkaPublisherClass(mockProducer, mockPool);

    expect(publisher).toBeDefined();
    expect(publisher.producer).toBe(mockProducer);
    expect(publisher.pool).toBe(mockPool);
  });

  /**
   * Test 2: Publish event to Kafka with topic = event_type
   * EXPECTED TO FAIL: publish() method does not exist yet
   */
  it('should publish event to Kafka using event_type as topic', async () => {
    const { KafkaPublisher: KafkaPublisherClass } = await import('../../../services/kafka-publisher.service.js');

    const mockEvent: OutboxEvent = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      aggregate_id: '123e4567-e89b-12d3-a456-426614174000',
      aggregate_type: 'journey',
      event_type: 'journey.created',
      payload: { user_id: 'user_123', origin: 'KGX', destination: 'EDI' },
      correlation_id: '660e8400-e29b-41d4-a716-446655440001',
      created_at: new Date('2026-01-10T10:00:00Z'),
      published: false,
    };

    const publisher = new KafkaPublisherClass(mockProducer, mockPool);
    await publisher.publish(mockEvent, 'journey_matcher', 'outbox');

    // Verify Kafka send was called with correct topic
    expect(mockProducer.send).toHaveBeenCalledWith({
      topic: 'journey.created',
      messages: expect.arrayContaining([
        expect.objectContaining({
          key: mockEvent.aggregate_id,
          value: expect.any(String),
        }),
      ]),
    });
  });

  /**
   * Test 3: Use aggregate_id as partition key for ordering guarantee (AC-3)
   * EXPECTED TO FAIL: publish() method does not use partition key yet
   */
  it('should use aggregate_id as partition key for ordering guarantee', async () => {
    const { KafkaPublisher: KafkaPublisherClass } = await import('../../../services/kafka-publisher.service.js');

    const mockEvent: OutboxEvent = {
      id: '770e8400-e29b-41d4-a716-446655440002',
      aggregate_id: '234e5678-e89b-12d3-a456-426614174001',
      aggregate_type: 'journey',
      event_type: 'journey.updated',
      payload: { status: 'confirmed' },
      correlation_id: '880e8400-e29b-41d4-a716-446655440003',
      created_at: new Date(),
      published: false,
    };

    const publisher = new KafkaPublisherClass(mockProducer, mockPool);
    await publisher.publish(mockEvent, 'journey_matcher', 'outbox');

    // Verify message key is aggregate_id (ensures same partition for same aggregate)
    const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
    const messages = sendCall[0].messages as Message[];
    expect(messages[0].key).toBe(mockEvent.aggregate_id);
  });

  /**
   * Test 4: Include correlation_id, event_id, created_at in message headers
   * EXPECTED TO FAIL: publish() method does not include headers yet
   */
  it('should include correlation_id, event_id, created_at in message headers', async () => {
    const { KafkaPublisher: KafkaPublisherClass } = await import('../../../services/kafka-publisher.service.js');

    const mockEvent: OutboxEvent = {
      id: '990e8400-e29b-41d4-a716-446655440004',
      aggregate_id: '345e6789-e89b-12d3-a456-426614174002',
      aggregate_type: 'user',
      event_type: 'user.registered',
      payload: {},
      correlation_id: 'aa0e8400-e29b-41d4-a716-446655440005',
      created_at: new Date('2026-01-10T11:00:00Z'),
      published: false,
    };

    const publisher = new KafkaPublisherClass(mockProducer, mockPool);
    await publisher.publish(mockEvent, 'whatsapp_handler', 'outbox_events');

    // Verify headers include required metadata
    const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
    const messages = sendCall[0].messages as Message[];
    const headers = messages[0].headers;

    expect(headers).toHaveProperty('correlation_id', mockEvent.correlation_id);
    expect(headers).toHaveProperty('event_id', mockEvent.id);
    expect(headers).toHaveProperty('created_at', mockEvent.created_at.toISOString());
  });

  /**
   * Test 5: Serialize payload as JSON in message value
   * EXPECTED TO FAIL: publish() method does not serialize payload yet
   */
  it('should serialize event payload as JSON string in message value', async () => {
    const { KafkaPublisher: KafkaPublisherClass } = await import('../../../services/kafka-publisher.service.js');

    const mockEvent: OutboxEvent = {
      id: 'bb0e8400-e29b-41d4-a716-446655440006',
      aggregate_id: '456e7890-e89b-12d3-a456-426614174003',
      aggregate_type: 'journey',
      event_type: 'journey.created',
      payload: { origin: 'KGX', destination: 'EDI', user_id: 'user_456' },
      correlation_id: 'cc0e8400-e29b-41d4-a716-446655440007',
      created_at: new Date(),
      published: false,
    };

    const publisher = new KafkaPublisherClass(mockProducer, mockPool);
    await publisher.publish(mockEvent, 'journey_matcher', 'outbox');

    // Verify message value is JSON string of payload
    const sendCall = vi.mocked(mockProducer.send).mock.calls[0];
    const messages = sendCall[0].messages as Message[];
    const messageValue = messages[0].value as string;
    const parsedPayload = JSON.parse(messageValue);

    expect(parsedPayload).toEqual(mockEvent.payload);
  });

  /**
   * Test 6: Mark event as published after successful Kafka send
   * EXPECTED TO FAIL: publish() method does not update database yet
   */
  it('should mark event as published in database after successful Kafka send', async () => {
    const { KafkaPublisher: KafkaPublisherClass } = await import('../../../services/kafka-publisher.service.js');

    const mockEvent: OutboxEvent = {
      id: 'dd0e8400-e29b-41d4-a716-446655440008',
      aggregate_id: '567e8901-e89b-12d3-a456-426614174004',
      aggregate_type: 'journey',
      event_type: 'journey.updated',
      payload: {},
      correlation_id: 'ee0e8400-e29b-41d4-a716-446655440009',
      created_at: new Date(),
      published: false,
    };

    // Mock successful UPDATE query
    vi.mocked(mockClient.query).mockResolvedValueOnce({
      rows: [],
      command: 'UPDATE',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    const publisher = new KafkaPublisherClass(mockProducer, mockPool);
    await publisher.publish(mockEvent, 'journey_matcher', 'outbox');

    // Verify UPDATE query was called to mark event as published
    const updateCall = vi.mocked(mockClient.query).mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('UPDATE') && call[0].includes('published = true')
    );
    expect(updateCall).toBeDefined();
  });

  /**
   * Test 7: Update relay_state total_events_published counter
   * EXPECTED TO FAIL: publish() method does not update relay_state yet
   */
  it('should increment relay_state.total_events_published after successful publish', async () => {
    const { KafkaPublisher: KafkaPublisherClass } = await import('../../../services/kafka-publisher.service.js');

    const mockEvent: OutboxEvent = {
      id: 'ff0e8400-e29b-41d4-a716-446655440010',
      aggregate_id: '678e9012-e89b-12d3-a456-426614174005',
      aggregate_type: 'journey',
      event_type: 'journey.created',
      payload: {},
      correlation_id: '110e8400-e29b-41d4-a716-446655440011',
      created_at: new Date(),
      published: false,
    };

    // Mock successful queries
    vi.mocked(mockClient.query)
      .mockResolvedValueOnce({ rows: [], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] } as any) // Mark published
      .mockResolvedValueOnce({ rows: [], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] } as any); // Update relay_state

    const publisher = new KafkaPublisherClass(mockProducer, mockPool);
    await publisher.publish(mockEvent, 'journey_matcher', 'outbox');

    // Verify relay_state UPDATE query was called
    const relayStateUpdate = vi.mocked(mockClient.query).mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('UPDATE outbox_relay.relay_state')
    );
    expect(relayStateUpdate).toBeDefined();
  });

  /**
   * Test 8: Throw error when Kafka send fails
   * EXPECTED TO FAIL: publish() method does not handle Kafka errors yet
   */
  it('should throw error when Kafka send fails', async () => {
    const { KafkaPublisher: KafkaPublisherClass } = await import('../../../services/kafka-publisher.service.js');

    const mockEvent: OutboxEvent = {
      id: '220e8400-e29b-41d4-a716-446655440012',
      aggregate_id: '789e0123-e89b-12d3-a456-426614174006',
      aggregate_type: 'journey',
      event_type: 'journey.created',
      payload: {},
      correlation_id: '330e8400-e29b-41d4-a716-446655440013',
      created_at: new Date(),
      published: false,
    };

    // Mock Kafka send failure
    vi.mocked(mockProducer.send).mockRejectedValueOnce(new Error('Kafka broker unavailable'));

    const publisher = new KafkaPublisherClass(mockProducer, mockPool);

    await expect(publisher.publish(mockEvent, 'journey_matcher', 'outbox')).rejects.toThrow('Kafka broker unavailable');
  });

  /**
   * Test 9: Do NOT mark event as published if Kafka send fails
   * EXPECTED TO FAIL: publish() method does not handle transactional rollback yet
   */
  it('should NOT mark event as published if Kafka send fails', async () => {
    const { KafkaPublisher: KafkaPublisherClass } = await import('../../../services/kafka-publisher.service.js');

    const mockEvent: OutboxEvent = {
      id: '440e8400-e29b-41d4-a716-446655440014',
      aggregate_id: '890e1234-e89b-12d3-a456-426614174007',
      aggregate_type: 'journey',
      event_type: 'journey.created',
      payload: {},
      correlation_id: '550e8400-e29b-41d4-a716-446655440015',
      created_at: new Date(),
      published: false,
    };

    // Mock Kafka send failure
    vi.mocked(mockProducer.send).mockRejectedValueOnce(new Error('Timeout'));

    const publisher = new KafkaPublisherClass(mockProducer, mockPool);

    await expect(publisher.publish(mockEvent, 'journey_matcher', 'outbox')).rejects.toThrow('Timeout');

    // Verify UPDATE query was NOT called (event remains unpublished)
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  /**
   * Test 10: Handle column variation (published_at vs processed_at)
   * EXPECTED TO FAIL: publish() method does not handle column variation yet
   */
  it('should handle processed_at column variation instead of published_at', async () => {
    const { KafkaPublisher: KafkaPublisherClass } = await import('../../../services/kafka-publisher.service.js');

    const mockEvent: OutboxEvent = {
      id: '660e8400-e29b-41d4-a716-446655440016',
      aggregate_id: '901e2345-e89b-12d3-a456-426614174008',
      aggregate_type: 'user',
      event_type: 'user.registered',
      payload: {},
      correlation_id: '770e8400-e29b-41d4-a716-446655440017',
      created_at: new Date(),
      published: false,
    };

    // Mock successful queries
    vi.mocked(mockClient.query)
      .mockResolvedValueOnce({ rows: [], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] } as any)
      .mockResolvedValueOnce({ rows: [], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] } as any);

    const publisher = new KafkaPublisherClass(mockProducer, mockPool);
    await publisher.publish(mockEvent, 'whatsapp_handler', 'outbox_events', 'processed_at');

    // Verify UPDATE query uses processed_at column
    const updateCall = vi.mocked(mockClient.query).mock.calls[0];
    const updateSql = updateCall[0] as string;
    expect(updateSql).toContain('processed_at = now()');
  });
});
