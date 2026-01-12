"use strict";
/**
 * Metrics Pusher Service
 *
 * Pushes Prometheus metrics to Grafana Alloy using remote_write protocol
 *
 * Architecture:
 * - Uses prom-client registry to collect metrics
 * - Pushes metrics periodically to Alloy gateway
 * - Alloy forwards to Grafana Cloud
 *
 * This enables a push-based observability pattern for microservices:
 * Service → Alloy Gateway → Grafana Cloud
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsPusher = void 0;
const prometheus_remote_write_1 = require("prometheus-remote-write");
const registry_1 = require("./registry");
/**
 * Console-based fallback logger
 */
const consoleLogger = {
    info: (msg, meta) => console.log(`[INFO] ${msg}`, meta || ''),
    error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta || ''),
    warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta || ''),
    debug: (msg, meta) => console.debug(`[DEBUG] ${msg}`, meta || ''),
};
/**
 * Metrics Pusher Service
 *
 * Pushes Prometheus metrics to Grafana Alloy at configurable intervals.
 */
class MetricsPusher {
    intervalId;
    pushIntervalMs;
    alloyUrl;
    serviceName;
    environment;
    isRunning = false;
    logger;
    constructor(config) {
        if (!config.serviceName) {
            throw new Error('MetricsConfig.serviceName is required');
        }
        this.serviceName = config.serviceName;
        this.alloyUrl = config.alloyUrl || process.env.ALLOY_PUSH_URL || '';
        this.pushIntervalMs = (config.pushInterval ?? 15) * 1000;
        this.environment = config.environment || process.env.NODE_ENV || 'development';
        this.logger = config.logger || consoleLogger;
    }
    /**
     * Start pushing metrics periodically
     */
    async start() {
        if (this.isRunning) {
            this.logger.warn('Metrics pusher already running', {
                component: `${this.serviceName}/MetricsPusher`,
            });
            return;
        }
        if (!this.alloyUrl) {
            this.logger.warn('Alloy URL not configured - metrics push disabled', {
                component: `${this.serviceName}/MetricsPusher`,
            });
            return;
        }
        this.logger.info('Starting metrics pusher', {
            component: `${this.serviceName}/MetricsPusher`,
            url: this.alloyUrl,
            interval: `${this.pushIntervalMs / 1000}s`,
        });
        this.isRunning = true;
        // Push immediately on start
        await this.pushMetrics();
        // Then push periodically
        this.intervalId = setInterval(() => {
            this.pushMetrics().catch((error) => {
                this.logger.error('Error pushing metrics', {
                    component: `${this.serviceName}/MetricsPusher`,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined,
                });
            });
        }, this.pushIntervalMs);
        this.logger.info('Metrics pusher started successfully', {
            component: `${this.serviceName}/MetricsPusher`,
        });
    }
    /**
     * Stop pushing metrics
     */
    stop() {
        if (!this.isRunning) {
            return;
        }
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        this.isRunning = false;
        this.logger.info('Metrics pusher stopped', {
            component: `${this.serviceName}/MetricsPusher`,
        });
    }
    /**
     * Push metrics to Alloy (one-shot)
     *
     * Can be called manually for one-shot metric pushes (e.g., from cron jobs)
     * or automatically via start() for periodic pushing.
     */
    async pushMetrics() {
        if (!this.alloyUrl) {
            return;
        }
        try {
            const registry = (0, registry_1.getRegistry)();
            const metricsString = await registry.metrics();
            // Parse Prometheus text format into simple key-value metrics
            const metrics = this.parsePrometheusMetrics(metricsString);
            if (Object.keys(metrics).length === 0) {
                this.logger.warn('No metrics to push', {
                    component: `${this.serviceName}/MetricsPusher`,
                });
                return;
            }
            // Push to Alloy using remote_write protocol
            await (0, prometheus_remote_write_1.pushMetrics)(metrics, {
                url: this.alloyUrl,
                labels: {
                    service: this.serviceName,
                    environment: this.environment,
                },
            });
            this.logger.debug('Pushed metrics successfully', {
                component: `${this.serviceName}/MetricsPusher`,
                metricsCount: Object.keys(metrics).length,
            });
        }
        catch (error) {
            this.logger.error('Failed to push metrics', {
                component: `${this.serviceName}/MetricsPusher`,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
            });
            // Don't throw - we'll retry on next interval
        }
    }
    /**
     * Check if metrics pusher is running
     */
    isActive() {
        return this.isRunning;
    }
    /**
     * Parse Prometheus text format into simple metrics object
     *
     * Converts:
     *   metric_name{labels} 42 timestamp
     * To:
     *   { "metric_name": 42 }
     *
     * Note: Labels are stripped from metric names to comply with Prometheus remote_write format.
     * Service-level labels (service, environment) are added via pushMetrics config.
     */
    parsePrometheusMetrics(metricsString) {
        const metrics = {};
        const lines = metricsString.split('\n');
        for (const line of lines) {
            // Skip comments and empty lines
            if (line.startsWith('#') || !line.trim()) {
                continue;
            }
            // Parse metric line: metric_name{labels} value timestamp
            // Extract only the metric name (before { or space) and the value
            const nameMatch = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)/);
            const valueMatch = line.match(/\s+([0-9.eE+-]+)(?:\s+\d+)?$/);
            if (nameMatch && valueMatch) {
                const metricName = nameMatch[1];
                const numericValue = parseFloat(valueMatch[1]);
                // Skip NaN values - aggregate metrics with same name (sums labeled variants)
                if (!isNaN(numericValue)) {
                    metrics[metricName] = (metrics[metricName] || 0) + numericValue;
                }
            }
        }
        return metrics;
    }
}
exports.MetricsPusher = MetricsPusher;
//# sourceMappingURL=pusher.js.map