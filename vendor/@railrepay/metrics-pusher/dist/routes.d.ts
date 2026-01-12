/**
 * Prometheus Metrics Routes
 *
 * Express router for exposing metrics in Prometheus format
 */
import { Router } from 'express';
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
 * Create Express router with /metrics endpoint
 *
 * @param logger - Optional logger instance
 * @returns Express Router
 */
export declare function createMetricsRouter(logger?: Logger): Router;
//# sourceMappingURL=routes.d.ts.map