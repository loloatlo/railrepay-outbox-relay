/**
 * Prometheus Metrics Routes
 *
 * Express router for exposing metrics in Prometheus format
 */

import { Router, Request, Response } from 'express';
import { getRegistry } from './registry';

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
 * Console-based fallback logger
 */
const consoleLogger: Logger = {
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
export function createMetricsRouter(logger?: Logger): Router {
  const log = logger || consoleLogger;
  const router = Router();

  /**
   * GET /metrics
   * Prometheus metrics endpoint
   */
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const registry = getRegistry();
      res.set('Content-Type', registry.contentType);
      const metrics = await registry.metrics();
      res.end(metrics);
    } catch (error) {
      log.error('Error generating metrics', {
        component: 'MetricsRoutes',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).end('Error generating metrics');
    }
  });

  return router;
}
