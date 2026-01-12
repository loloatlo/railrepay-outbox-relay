"use strict";
/**
 * Metrics Registry Management
 *
 * Provides a shared Prometheus registry for metric collection across services.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRegistry = getRegistry;
exports.resetRegistry = resetRegistry;
const prom_client_1 = require("prom-client");
/**
 * Shared metrics registry
 */
let sharedRegistry = null;
/**
 * Get the shared Prometheus registry
 *
 * Creates a new registry on first call, returns the same instance thereafter.
 *
 * @returns Prometheus Registry instance
 */
function getRegistry() {
    if (!sharedRegistry) {
        sharedRegistry = new prom_client_1.Registry();
    }
    return sharedRegistry;
}
/**
 * Reset the shared registry (for testing)
 */
function resetRegistry() {
    sharedRegistry = null;
}
//# sourceMappingURL=registry.js.map