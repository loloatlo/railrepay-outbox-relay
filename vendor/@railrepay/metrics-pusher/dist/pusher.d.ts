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
/**
 * Logger interface for optional dependency injection
 */
export interface Logger {
    info(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    debug(message: string, meta?: Record<string, unknown>): void;
}
/**
 * Metrics pusher configuration
 */
export interface MetricsConfig {
    /** REQUIRED - Service name for labels */
    serviceName: string;
    /** Alloy remote_write endpoint URL */
    alloyUrl?: string;
    /** Push interval in seconds (default: 15) */
    pushInterval?: number;
    /** Environment name for labels (default: process.env.NODE_ENV) */
    environment?: string;
    /** Optional logger instance */
    logger?: Logger;
}
/**
 * Metrics Pusher Service
 *
 * Pushes Prometheus metrics to Grafana Alloy at configurable intervals.
 */
export declare class MetricsPusher {
    private intervalId?;
    private pushIntervalMs;
    private alloyUrl;
    private serviceName;
    private environment;
    private isRunning;
    private logger;
    constructor(config: MetricsConfig);
    /**
     * Start pushing metrics periodically
     */
    start(): Promise<void>;
    /**
     * Stop pushing metrics
     */
    stop(): void;
    /**
     * Push metrics to Alloy (one-shot)
     *
     * Can be called manually for one-shot metric pushes (e.g., from cron jobs)
     * or automatically via start() for periodic pushing.
     */
    pushMetrics(): Promise<void>;
    /**
     * Check if metrics pusher is running
     */
    isActive(): boolean;
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
    private parsePrometheusMetrics;
}
//# sourceMappingURL=pusher.d.ts.map