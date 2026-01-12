"use strict";
/**
 * @railrepay/metrics-pusher
 *
 * Prometheus metrics collection and push-based observability for RailRepay microservices
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Registry = exports.Summary = exports.Gauge = exports.Histogram = exports.Counter = exports.createMetricsRouter = exports.resetRegistry = exports.getRegistry = exports.MetricsPusher = void 0;
var pusher_1 = require("./pusher");
Object.defineProperty(exports, "MetricsPusher", { enumerable: true, get: function () { return pusher_1.MetricsPusher; } });
var registry_1 = require("./registry");
Object.defineProperty(exports, "getRegistry", { enumerable: true, get: function () { return registry_1.getRegistry; } });
Object.defineProperty(exports, "resetRegistry", { enumerable: true, get: function () { return registry_1.resetRegistry; } });
var routes_1 = require("./routes");
Object.defineProperty(exports, "createMetricsRouter", { enumerable: true, get: function () { return routes_1.createMetricsRouter; } });
// Re-export prom-client for convenience
var prom_client_1 = require("prom-client");
Object.defineProperty(exports, "Counter", { enumerable: true, get: function () { return prom_client_1.Counter; } });
Object.defineProperty(exports, "Histogram", { enumerable: true, get: function () { return prom_client_1.Histogram; } });
Object.defineProperty(exports, "Gauge", { enumerable: true, get: function () { return prom_client_1.Gauge; } });
Object.defineProperty(exports, "Summary", { enumerable: true, get: function () { return prom_client_1.Summary; } });
Object.defineProperty(exports, "Registry", { enumerable: true, get: function () { return prom_client_1.Registry; } });
//# sourceMappingURL=index.js.map