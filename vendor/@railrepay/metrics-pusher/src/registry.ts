/**
 * Metrics Registry Management
 *
 * Provides a shared Prometheus registry for metric collection across services.
 */

import { Registry } from 'prom-client';

/**
 * Shared metrics registry
 */
let sharedRegistry: Registry | null = null;

/**
 * Get the shared Prometheus registry
 *
 * Creates a new registry on first call, returns the same instance thereafter.
 *
 * @returns Prometheus Registry instance
 */
export function getRegistry(): Registry {
  if (!sharedRegistry) {
    sharedRegistry = new Registry();
  }
  return sharedRegistry;
}

/**
 * Reset the shared registry (for testing)
 */
export function resetRegistry(): void {
  sharedRegistry = null;
}
