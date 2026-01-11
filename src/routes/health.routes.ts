/**
 * Health Check Routes
 *
 * Provides liveness and readiness probes for Kubernetes/Railway health checks.
 *
 * Key Features:
 * - GET /health/live - Liveness probe (200 OK if service is running)
 * - GET /health/ready - Readiness probe (check DB connection + polling state)
 * - Readiness checks: DB connection available, last_poll < 30s
 * - Returns 503 Service Unavailable if not ready
 *
 * @see Architecture › ADR-008 (Health Check Endpoint)
 * @see /services/outbox-relay/docs/phases/PHASE-1-SPECIFICATION.md § 5.3
 */

import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { createLogger } from '@railrepay/winston-logger';

/**
 * Create logger instance
 */
const logger = createLogger({
  serviceName: process.env.SERVICE_NAME || 'outbox-relay',
  level: process.env.LOG_LEVEL || 'info',
});

/**
 * Health check response interface
 */
export interface HealthCheckResponse {
  status: 'ok' | 'ready' | 'unavailable';
  timestamp: string;
  checks?: {
    database: 'ok' | 'error';
    polling: 'ok' | 'stale';
  };
}

/**
 * Create health check routes
 *
 * @param pool - PostgreSQL connection pool
 * @returns Express Router with /live and /ready endpoints
 */
export function createHealthRoutes(pool: Pool): Router {
  const router = Router();

  /**
   * GET /health/live - Liveness probe
   *
   * Returns 200 OK if the service is running.
   * Does NOT check database connection (fast check).
   *
   * Used by Kubernetes/Railway to restart container if not responding.
   */
  router.get('/live', (req: Request, res: Response) => {
    const response: HealthCheckResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };

    logger.debug('Liveness probe check', { status: 'ok' });

    res.status(200).json(response);
  });

  /**
   * GET /health/ready - Readiness probe
   *
   * Returns 200 OK if:
   * - Database connection is available
   * - Polling is active (last_poll < 30 seconds)
   *
   * Returns 503 Service Unavailable if:
   * - Database is disconnected
   * - Polling is stale (last_poll > 30 seconds)
   *
   * Used by Kubernetes/Railway to route traffic only to ready instances.
   */
  router.get('/ready', async (req: Request, res: Response) => {
    let client;

    try {
      // Check 1: Database connection
      client = await pool.connect();

      // Check 2: Polling state (last_poll < 30s)
      const query = `
        SELECT MAX(last_poll_time) as last_poll_time
        FROM outbox_relay.relay_state
      `;

      const result = await client.query(query);

      if (result.rows.length === 0 || !result.rows[0].last_poll_time) {
        // No polling state yet (service just started)
        logger.warn('Readiness probe: No polling state found');

        const response: HealthCheckResponse = {
          status: 'unavailable',
          timestamp: new Date().toISOString(),
          checks: {
            database: 'ok',
            polling: 'stale',
          },
        };

        res.status(503).json(response);
        return;
      }

      const lastPollTime = new Date(result.rows[0].last_poll_time);
      const nowTime = new Date();
      const secondsSinceLastPoll = (nowTime.getTime() - lastPollTime.getTime()) / 1000;

      // Polling is stale if > 30 seconds since last poll
      if (secondsSinceLastPoll > 30) {
        logger.warn('Readiness probe: Polling is stale', {
          secondsSinceLastPoll,
          lastPollTime: lastPollTime.toISOString(),
        });

        const response: HealthCheckResponse = {
          status: 'unavailable',
          timestamp: new Date().toISOString(),
          checks: {
            database: 'ok',
            polling: 'stale',
          },
        };

        res.status(503).json(response);
        return;
      }

      // All checks passed - service is ready
      logger.debug('Readiness probe: Service is ready', {
        secondsSinceLastPoll,
      });

      const response: HealthCheckResponse = {
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'ok',
          polling: 'ok',
        },
      };

      res.status(200).json(response);
    } catch (error) {
      // Database connection failed
      logger.error('Readiness probe: Database connection failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      const response: HealthCheckResponse = {
        status: 'unavailable',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'error',
          polling: 'stale',
        },
      };

      res.status(503).json(response);
    } finally {
      if (client) {
        client.release();
      }
    }
  });

  return router;
}
