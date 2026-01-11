/**
 * DLQHandler Service (Dead-Letter Queue)
 *
 * Moves failed events to the failed_events table after max retries exhausted.
 *
 * Key Features:
 * - Insert into outbox_relay.failed_events table
 * - Include original_event_id, source_schema, source_table, event_type
 * - Serialize payload as JSONB
 * - Track failure_reason and failure_count
 * - Set first_failed_at and last_failed_at timestamps
 *
 * @see /services/outbox-relay/docs/rfcs/RFC-001-outbox-relay-schema.md § 3.2
 */

import type { Pool } from 'pg';
import { createLogger, type Logger } from '@railrepay/winston-logger';

/**
 * Create default logger instance
 * (Can be overridden via constructor for testing)
 */
const defaultLogger = createLogger({
  serviceName: process.env.SERVICE_NAME || 'outbox-relay',
  level: process.env.LOG_LEVEL || 'info',
});

/**
 * Outbox event interface
 */
export interface OutboxEvent {
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
 * DLQHandler Service
 *
 * Moves events to Dead-Letter Queue (failed_events table) after max retries.
 */
export class DLQHandler {
  public pool: Pool;
  private logger: Logger;

  constructor(pool: Pool, logger?: Logger) {
    this.pool = pool;
    this.logger = logger ?? defaultLogger;

    this.logger.info('DLQHandler initialized');
  }

  /**
   * Move failed event to Dead-Letter Queue (failed_events table)
   *
   * Inserts event into outbox_relay.failed_events with:
   * - original_event_id: Original event UUID from outbox table
   * - source_schema: Schema where event originated (e.g., 'journey_matcher')
   * - source_table: Table where event originated (e.g., 'outbox')
   * - event_type: Event type for filtering/alerting (e.g., 'journey.created')
   * - payload: Full event payload as JSONB
   * - failure_reason: Exception message or error description
   * - failure_count: Number of failed attempts (should be 10 per AC-9)
   * - first_failed_at: NOW() (when moved to DLQ)
   * - last_failed_at: NOW() (same as first_failed_at on initial insert)
   *
   * @param event - Failed outbox event
   * @param sourceSchema - Source schema name
   * @param sourceTable - Source table name
   * @param failureReason - Error message or exception description
   * @param failureCount - Number of failed retry attempts
   * @returns Inserted DLQ event ID
   */
  async moveToDLQ(
    event: OutboxEvent,
    sourceSchema: string,
    sourceTable: string,
    failureReason: string,
    failureCount: number
  ): Promise<string> {
    const client = await this.pool.connect();

    try {
      this.logger.warn('Moving event to DLQ (Dead-Letter Queue)', {
        eventId: event.id,
        eventType: event.event_type,
        sourceSchema,
        sourceTable,
        failureReason,
        failureCount,
      });

      const query = `
        INSERT INTO outbox_relay.failed_events (
          original_event_id,
          source_schema,
          source_table,
          event_type,
          payload,
          failure_reason,
          failure_count,
          first_failed_at,
          last_failed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
        RETURNING id
      `;

      const params = [
        event.id,                      // original_event_id
        sourceSchema,                  // source_schema
        sourceTable,                   // source_table
        event.event_type,              // event_type
        JSON.stringify(event.payload), // payload (JSONB)
        failureReason,                 // failure_reason
        failureCount,                  // failure_count
      ];

      const result = await client.query(query, params);

      const dlqEventId = result.rows[0].id;

      this.logger.info('Event moved to DLQ successfully', {
        dlqEventId,
        originalEventId: event.id,
        eventType: event.event_type,
      });

      return dlqEventId;
    } catch (error) {
      this.logger.error('Failed to move event to DLQ', {
        eventId: event.id,
        eventType: event.event_type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    } finally {
      client.release();
    }
  }
}
