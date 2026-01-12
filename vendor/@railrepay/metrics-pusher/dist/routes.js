"use strict";
/**
 * Prometheus Metrics Routes
 *
 * Express router for exposing metrics in Prometheus format
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMetricsRouter = createMetricsRouter;
const express_1 = require("express");
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
 * Create Express router with /metrics endpoint
 *
 * @param logger - Optional logger instance
 * @returns Express Router
 */
function createMetricsRouter(logger) {
    const log = logger || consoleLogger;
    const router = (0, express_1.Router)();
    /**
     * GET /metrics
     * Prometheus metrics endpoint
     */
    router.get('/', async (_req, res) => {
        try {
            const registry = (0, registry_1.getRegistry)();
            res.set('Content-Type', registry.contentType);
            const metrics = await registry.metrics();
            res.end(metrics);
        }
        catch (error) {
            log.error('Error generating metrics', {
                component: 'MetricsRoutes',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            res.status(500).end('Error generating metrics');
        }
    });
    return router;
}
//# sourceMappingURL=routes.js.map