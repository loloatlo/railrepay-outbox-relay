/**
 * Metrics Routes
 *
 * Exposes Prometheus metrics for monitoring outbox-relay service performance.
 *
 * Key Metrics:
 * - events_polled_total - Counter of events polled from outbox tables
 * - events_published_total - Counter of events successfully published to Kafka
 * - events_failed_total - Counter of events that failed to publish (moved to DLQ)
 * - poll_latency_seconds - Histogram of polling operation duration
 *
 * Labels:
 * - schema: Source schema name (e.g., 'journey_matcher', 'whatsapp_handler')
 * - table: Source table name (e.g., 'outbox', 'outbox_events')
 * - event_type: Event type (e.g., 'journey.created', 'user.registered')
 *
 * @see /services/outbox-relay/docs/phases/PHASE-1-SPECIFICATION.md § 5.4
 * @see Architecture › Observability
 */

import { Router, type Request, type Response } from 'express';
import { getRegistry, Counter, Histogram } from '@railrepay/metrics-pusher';
import { createLogger } from '@railrepay/winston-logger';

/**
 * Get shared Prometheus registry for metrics collection
 * This registry is used by MetricsPusher to push metrics to Alloy
 */
const registry = getRegistry();

/**
 * Create logger instance
 */
const logger = createLogger({
  serviceName: process.env.SERVICE_NAME || 'outbox-relay',
  level: process.env.LOG_LEVEL || 'info',
});

/**
 * Prometheus Metrics
 */

// Counter: Events polled from outbox tables
const eventsPolledCounter = new Counter({
  name: 'events_polled_total',
  help: 'Total number of events polled from outbox tables',
  labelNames: ['schema', 'table'],
  registers: [registry],
});

// Counter: Events published to Kafka
const eventsPublishedCounter = new Counter({
  name: 'events_published_total',
  help: 'Total number of events successfully published to Kafka',
  labelNames: ['schema', 'table', 'event_type'],
  registers: [registry],
});

// Counter: Events failed to publish (moved to DLQ)
const eventsFailedCounter = new Counter({
  name: 'events_failed_total',
  help: 'Total number of events that failed to publish (moved to DLQ)',
  labelNames: ['schema', 'table', 'event_type'],
  registers: [registry],
});

// Histogram: Polling operation latency
const pollLatencyHistogram = new Histogram({
  name: 'poll_latency_seconds',
  help: 'Histogram of polling operation duration in seconds',
  labelNames: ['schema', 'table'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10], // 10ms to 10s
  registers: [registry],
});

/**
 * Increment events_polled_total counter
 *
 * @param schema - Source schema name
 * @param table - Source table name
 */
export function incrementEventsPolled(schema: string, table: string): void {
  eventsPolledCounter.inc({ schema, table });
  logger.debug('Incremented events_polled_total', { schema, table });
}

/**
 * Increment events_published_total counter
 *
 * @param schema - Source schema name
 * @param table - Source table name
 * @param eventType - Event type
 */
export function incrementEventsPublished(schema: string, table: string, eventType: string): void {
  eventsPublishedCounter.inc({ schema, table, event_type: eventType });
  logger.debug('Incremented events_published_total', { schema, table, eventType });
}

/**
 * Increment events_failed_total counter
 *
 * @param schema - Source schema name
 * @param table - Source table name
 * @param eventType - Event type
 */
export function incrementEventsFailed(schema: string, table: string, eventType: string): void {
  eventsFailedCounter.inc({ schema, table, event_type: eventType });
  logger.warn('Incremented events_failed_total', { schema, table, eventType });
}

/**
 * Record poll_latency_seconds histogram
 *
 * @param schema - Source schema name
 * @param table - Source table name
 * @param durationSeconds - Polling operation duration in seconds
 */
export function recordPollLatency(schema: string, table: string, durationSeconds: number): void {
  pollLatencyHistogram.observe({ schema, table }, durationSeconds);
  logger.debug('Recorded poll_latency_seconds', { schema, table, durationSeconds });
}

/**
 * Create metrics routes
 *
 * @returns Express Router with /metrics endpoint
 */
export function createMetricsRoutes(): Router {
  const router = Router();

  /**
   * GET /metrics - Prometheus metrics endpoint
   *
   * Returns metrics in Prometheus text format (version 0.0.4).
   * This endpoint is scraped by Prometheus or pushed to Grafana Cloud.
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      // Set Content-Type header for Prometheus format
      res.set('Content-Type', registry.contentType);

      // Get metrics from shared Prometheus registry
      const metrics = await registry.metrics();

      logger.debug('Metrics endpoint called', {
        metricsLength: metrics.length,
      });

      res.status(200).send(metrics);
    } catch (error) {
      logger.error('Failed to generate metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).send('Failed to generate metrics');
    }
  });

  return router;
}
