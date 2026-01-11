/**
 * KafkaPublisher Service
 *
 * Publishes outbox events to Kafka topics with exactly-once delivery guarantee.
 *
 * Key Features:
 * - Topic routing: event_type → topic name (journey.created → journey.created topic)
 * - Partition key: aggregate_id (ensures ordering for same aggregate per AC-3)
 * - Message headers: correlation_id, event_id, created_at (for distributed tracing)
 * - Transactional publish: Mark as published ONLY after Kafka confirms
 * - Column variation support: published_at vs processed_at
 *
 * @see /services/outbox-relay/docs/phases/PHASE-1-SPECIFICATION.md § 4.2
 */

import type { Pool } from 'pg';
import type { Producer, Message } from 'kafkajs';
import { createLogger } from '@railrepay/winston-logger';

/**
 * Create logger instance
 */
const logger = createLogger({
  serviceName: process.env.SERVICE_NAME || 'outbox-relay',
  level: process.env.LOG_LEVEL || 'info',
});

/**
 * Outbox event interface (from OutboxPoller)
 * Note: Some fields may be optional depending on the source schema
 */
export interface OutboxEvent {
  id: string;
  aggregate_id: string;
  aggregate_type: string;
  event_type: string;
  payload: Record<string, unknown>;
  correlation_id?: string;  // Optional - not all schemas have this
  created_at: Date;
  published_at?: Date | null;
  processed_at?: Date | null;
}

/**
 * KafkaPublisher Service
 *
 * Publishes events to Kafka and marks them as published in the database.
 */
export class KafkaPublisher {
  public producer: Producer;
  public pool: Pool;

  constructor(producer: Producer, pool: Pool) {
    this.producer = producer;
    this.pool = pool;

    logger.info('KafkaPublisher initialized', {
      producerConnected: false, // Will connect on first publish
    });
  }

  /**
   * Publish event to Kafka and mark as published
   *
   * Flow:
   * 1. Send message to Kafka (topic = event_type)
   * 2. If successful, UPDATE outbox SET published = true, published_at = now()
   * 3. If successful, UPDATE relay_state SET total_events_published = total_events_published + 1
   * 4. If Kafka fails, throw error (event remains unpublished, will be retried)
   *
   * @param event - Outbox event to publish
   * @param schemaName - Source schema name (for logging and relay_state)
   * @param tableName - Source table name (for UPDATE query)
   * @param timestampColumn - Timestamp column name (default: 'published_at')
   */
  async publish(
    event: OutboxEvent,
    schemaName: string,
    tableName: string,
    timestampColumn: 'published_at' | 'processed_at' = 'published_at'
  ): Promise<void> {
    const client = await this.pool.connect();

    try {
      logger.debug('Publishing event to Kafka', {
        eventId: event.id,
        eventType: event.event_type,
        aggregateId: event.aggregate_id,
        correlationId: event.correlation_id,
      });

      // Step 1: Send to Kafka
      const headers: Record<string, string> = {
        event_id: event.id,
        created_at: event.created_at instanceof Date
          ? event.created_at.toISOString()
          : String(event.created_at),
      };

      // Add correlation_id if present
      if (event.correlation_id) {
        headers.correlation_id = event.correlation_id;
      }

      const kafkaMessage: Message = {
        key: event.aggregate_id, // Partition key for ordering (AC-3)
        value: JSON.stringify(event.payload),
        headers,
      };

      await this.producer.send({
        topic: event.event_type, // Topic = event_type (journey.created → journey.created topic)
        messages: [kafkaMessage],
      });

      logger.info('Event published to Kafka', {
        eventId: event.id,
        topic: event.event_type,
        aggregateId: event.aggregate_id,
      });

      // Step 2: Mark as published in outbox table (only after Kafka confirms)
      // Note: Tables use timestamp columns (NULL = unpublished), no boolean column
      const updateQuery = `
        UPDATE ${schemaName}.${tableName}
        SET ${timestampColumn} = now()
        WHERE id = $1
      `;

      await client.query(updateQuery, [event.id]);

      logger.debug('Event marked as published in database', {
        eventId: event.id,
        schema: schemaName,
        table: tableName,
      });

      // Step 3: Increment relay_state counter
      const relayStateQuery = `
        UPDATE outbox_relay.relay_state
        SET total_events_published = total_events_published + 1
        WHERE schema_name = $1
      `;

      await client.query(relayStateQuery, [schemaName]);

      logger.debug('Incremented relay_state counter', {
        schema: schemaName,
      });
    } catch (error) {
      logger.error('Failed to publish event to Kafka', {
        eventId: event.id,
        eventType: event.event_type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Rethrow error - event remains unpublished, will be retried
      throw error;
    } finally {
      client.release();
    }
  }
}
