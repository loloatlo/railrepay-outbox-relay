/**
 * @railrepay/metrics-pusher
 *
 * Prometheus metrics collection and push-based observability for RailRepay microservices
 */

export { MetricsPusher, MetricsConfig, Logger } from './pusher';
export { getRegistry, resetRegistry } from './registry';
export { createMetricsRouter } from './routes';

// Re-export prom-client for convenience
export {
  Counter,
  Histogram,
  Gauge,
  Summary,
  Registry,
} from 'prom-client';
