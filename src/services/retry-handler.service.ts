/**
 * RetryHandler Service
 *
 * Implements exponential backoff retry logic for failed Kafka publish attempts.
 *
 * Key Features:
 * - Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 300s (capped at 5min)
 * - Max retries: 10 attempts (per AC-9)
 * - Returns shouldRetry flag and nextRetryDelay in milliseconds
 * - Configurable max retries and max delay
 *
 * @see /services/outbox-relay/docs/phases/PHASE-1-SPECIFICATION.md § 4.5
 */

import { createLogger } from '@railrepay/winston-logger';

/**
 * Create logger instance
 */
const logger = createLogger({
  serviceName: process.env.SERVICE_NAME || 'outbox-relay',
  level: process.env.LOG_LEVEL || 'info',
});

/**
 * RetryHandler configuration
 */
export interface RetryHandlerConfig {
  maxRetries?: number;  // Default: 10 (per AC-9)
  maxDelay?: number;    // Default: 300000ms (5 minutes per AC-7)
  initialDelay?: number; // Default: 1000ms (1 second)
}

/**
 * RetryHandler result
 */
export interface RetryResult {
  shouldRetry: boolean;
  nextRetryDelay: number; // In milliseconds
  message?: string;
}

/**
 * RetryHandler Service
 *
 * Determines whether to retry a failed publish attempt and calculates delay.
 */
export class RetryHandler {
  private maxRetries: number;
  private maxDelay: number;
  private initialDelay: number;

  constructor(config: RetryHandlerConfig = {}) {
    this.maxRetries = config.maxRetries || 10;
    this.maxDelay = config.maxDelay || 300000; // 5 minutes
    this.initialDelay = config.initialDelay || 1000; // 1 second

    logger.info('RetryHandler initialized', {
      maxRetries: this.maxRetries,
      maxDelay: this.maxDelay,
      initialDelay: this.initialDelay,
    });
  }

  /**
   * Determine whether to retry and calculate next retry delay
   *
   * Exponential backoff formula:
   * delay = initialDelay * 2^(attempt - 1)
   * delay = min(delay, maxDelay)
   *
   * Examples:
   * - Attempt 1: 1s * 2^0 = 1s
   * - Attempt 2: 1s * 2^1 = 2s
   * - Attempt 3: 1s * 2^2 = 4s
   * - Attempt 4: 1s * 2^3 = 8s
   * - Attempt 5: 1s * 2^4 = 16s
   * - Attempt 6: 1s * 2^5 = 32s
   * - Attempt 7: 1s * 2^6 = 64s
   * - Attempt 8: 1s * 2^7 = 128s
   * - Attempt 9: 1s * 2^8 = 256s
   * - Attempt 10: 1s * 2^9 = 512s → capped at 300s (5min)
   *
   * @param attemptCount - Number of retry attempts so far (1-indexed)
   * @returns RetryResult with shouldRetry flag and nextRetryDelay in milliseconds
   */
  shouldRetry(attemptCount: number): RetryResult {
    // Check if max retries exceeded
    if (attemptCount > this.maxRetries) {
      logger.warn('Max retries exceeded', {
        attemptCount,
        maxRetries: this.maxRetries,
      });

      return {
        shouldRetry: false,
        nextRetryDelay: 0,
        message: `Max retries exceeded (${this.maxRetries} attempts)`,
      };
    }

    // Calculate exponential backoff delay
    const delay = this.calculateDelay(attemptCount);

    logger.debug('Retry delay calculated', {
      attemptCount,
      delay,
      maxRetries: this.maxRetries,
    });

    return {
      shouldRetry: true,
      nextRetryDelay: delay,
    };
  }

  /**
   * Calculate exponential backoff delay
   *
   * Formula: delay = min(initialDelay * 2^(attempt - 1), maxDelay)
   *
   * @param attemptCount - Number of retry attempts (1-indexed)
   * @returns Delay in milliseconds
   */
  private calculateDelay(attemptCount: number): number {
    // Calculate exponential delay: 1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 512s
    const exponentialDelay = this.initialDelay * Math.pow(2, attemptCount - 1);

    // Cap at max delay (5 minutes by default)
    const cappedDelay = Math.min(exponentialDelay, this.maxDelay);

    return cappedDelay;
  }
}
