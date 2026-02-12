/**
 * OutboxPoller Service
 *
 * Polls unpublished events from service outbox tables and returns them for publishing.
 *
 * Key Features:
 * - Row-level locks (FOR UPDATE SKIP LOCKED) for horizontal scaling
 * - Handles table name variations (outbox vs outbox_events)
 * - Handles column name variations (published_at vs processed_at)
 * - Updates relay_state after each poll
 * - Batch size limit (100 events per poll)
 *
 * @see /services/outbox-relay/docs/rfcs/RFC-001-outbox-relay-schema.md § 6.1
 */

import type { Pool, QueryResult } from 'pg';
import { createLogger } from '@railrepay/winston-logger';

/**
 * Create logger instance
 */
const logger = createLogger({
  serviceName: process.env.SERVICE_NAME || 'outbox-relay',
  level: process.env.LOG_LEVEL || 'info',
});

/**
 * Outbox event interface (read from service outbox tables)
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
 * Schema configuration for polling
 */
export interface SchemaConfig {
  schema: string;
  table: string;
  timestampColumn?: 'published_at' | 'processed_at'; // Default: 'published_at'
}

/**
 * OutboxPoller configuration
 */
export interface OutboxPollerConfig {
  schemas: SchemaConfig[];
  batchSize?: number; // Default: 100
}

/**
 * OutboxPoller Service
 *
 * Polls unpublished events from configured service schemas.
 */
export class OutboxPoller {
  public pool: Pool;
  private schemas: SchemaConfig[];
  private batchSize: number;

  constructor(pool: Pool, config: OutboxPollerConfig) {
    this.pool = pool;
    this.schemas = config.schemas;
    this.batchSize = config.batchSize || 100;

    logger.info('OutboxPoller initialized', {
      schemas: this.schemas.map(s => `${s.schema}.${s.table}`),
      batchSize: this.batchSize,
    });
  }

  /**
   * Poll unpublished events from a specific schema's outbox table
   *
   * Query pattern (RFC § 6.1):
   * ```sql
   * SELECT *
   * FROM {schema_name}.{table_name}
   * WHERE published = false
   * ORDER BY created_at
   * LIMIT {batchSize}
   * FOR UPDATE SKIP LOCKED;
   * ```
   *
   * @param schemaName - Schema name (e.g., 'journey_matcher')
   * @param tableName - Table name (e.g., 'outbox' or 'outbox_events')
   * @param timestampColumn - Timestamp column name (default: 'published_at')
   * @returns Array of unpublished outbox events
   */
  async poll(
    schemaName: string,
    tableName: string,
    timestampColumn: 'published_at' | 'processed_at' = 'published_at'
  ): Promise<OutboxEvent[]> {
    const client = await this.pool.connect();

    try {
      logger.debug('Polling outbox table', {
        schema: schemaName,
        table: tableName,
        batchSize: this.batchSize,
      });

      // Poll unpublished events with row-level locks
      // Note: Tables use timestamp columns (NULL = unpublished) instead of boolean
      const query = `
        SELECT *
        FROM ${schemaName}.${tableName}
        WHERE ${timestampColumn} IS NULL
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `;

      const result: QueryResult<OutboxEvent> = await client.query(query, [this.batchSize]);

      // Log at debug when idle (0 events) to reduce log volume;
      // log at info when events are found for visibility.
      const logLevel = result.rows.length > 0 ? 'info' : 'debug';
      logger[logLevel]('Polled events from outbox', {
        schema: schemaName,
        table: tableName,
        eventCount: result.rows.length,
      });

      // Update relay_state after successful poll
      if (result.rows.length > 0) {
        await this.updateRelayState(client, schemaName, tableName, result.rows[result.rows.length - 1].id);
      }

      return result.rows;
    } catch (error) {
      logger.error('Failed to poll outbox table', {
        schema: schemaName,
        table: tableName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update relay_state after successful poll
   *
   * Updates last_poll_time and optionally last_published_event_id.
   *
   * @param client - PostgreSQL client (for transactional update)
   * @param schemaName - Schema name
   * @param tableName - Table name
   * @param lastEventId - ID of last polled event (optional cursor)
   */
  private async updateRelayState(
    client: any,
    schemaName: string,
    tableName: string,
    lastEventId?: string
  ): Promise<void> {
    const query = `
      UPDATE outbox_relay.relay_state
      SET
        last_poll_time = now(),
        last_published_event_id = COALESCE($3, last_published_event_id),
        updated_at = now()
      WHERE schema_name = $1 AND table_name = $2
    `;

    await client.query(query, [schemaName, tableName, lastEventId || null]);

    logger.debug('Updated relay_state', {
      schema: schemaName,
      table: tableName,
      lastEventId,
    });
  }

  /**
   * Ensure relay_state exists for a schema
   *
   * Inserts relay_state row if not exists (ON CONFLICT DO NOTHING).
   *
   * @param schemaName - Schema name
   * @param tableName - Table name
   */
  async ensureRelayState(schemaName: string, tableName: string): Promise<void> {
    const client = await this.pool.connect();

    try {
      const query = `
        INSERT INTO outbox_relay.relay_state (schema_name, table_name, last_poll_time, total_events_published)
        VALUES ($1, $2, now(), 0)
        ON CONFLICT (schema_name) DO NOTHING
        RETURNING schema_name, table_name
      `;

      const result = await client.query(query, [schemaName, tableName]);

      if (result.rows.length > 0) {
        logger.info('Initialized relay_state for new schema', {
          schema: schemaName,
          table: tableName,
        });
      } else {
        logger.debug('Relay_state already exists', {
          schema: schemaName,
          table: tableName,
        });
      }
    } catch (error) {
      logger.error('Failed to ensure relay_state', {
        schema: schemaName,
        table: tableName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      client.release();
    }
  }
}
