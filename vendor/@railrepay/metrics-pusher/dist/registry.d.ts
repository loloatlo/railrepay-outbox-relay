/**
 * Metrics Registry Management
 *
 * Provides a shared Prometheus registry for metric collection across services.
 */
import { Registry } from 'prom-client';
/**
 * Get the shared Prometheus registry
 *
 * Creates a new registry on first call, returns the same instance thereafter.
 *
 * @returns Prometheus Registry instance
 */
export declare function getRegistry(): Registry;
/**
 * Reset the shared registry (for testing)
 */
export declare function resetRegistry(): void;
//# sourceMappingURL=registry.d.ts.map