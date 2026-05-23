/*
 * Copyright 2024 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Prevent from running more than once (due to worker threads)
if (!require('node:worker_threads').isMainThread) {
  return;
}

const { NodeSDK } = require('@opentelemetry/sdk-node');
const {
  getNodeAutoInstrumentations,
} = require('@opentelemetry/auto-instrumentations-node');
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');

// Expose opentelemetry metrics using a Prometheus exporter on
// http://127.0.0.1:9464/metrics. See packages/backend/prometheus.yml for
// more information on how to scrape it.
//
// The exporter is bound to `127.0.0.1` by default so the endpoint is
// reachable only from the local host. This is a defense-in-depth measure
// against information disclosure: the `target_info` metric and HTTP
// auto-instrumentation labels carry host identifiers, process ownership,
// runtime version, and a full endpoint inventory that should not be
// readable by arbitrary network neighbors. To run the scraper on a
// different host (containerized Prometheus, host-network scraper, etc.),
// set the `PROMETHEUS_BIND_HOST` environment variable on the backend
// process — common values are `0.0.0.0` (bind to all interfaces; only
// safe behind a firewall) or a specific private interface IP. The port
// is fixed at `9464` to match `packages/backend/prometheus.yml`. See
// `docs/observability/dashboards.md` §4.1 and
// `docs/refactor/onboarding-addendum.md` §9.3 for operator guidance, and
// `docs/refactor/decision-log.md` Section 2 (entry 15) for the security
// rationale, the previous 0.0.0.0 bind that this default replaces, and
// the alternatives considered.
const prometheus = new PrometheusExporter({
  host: process.env.PROMETHEUS_BIND_HOST ?? '127.0.0.1',
  port: 9464,
});

const sdk = new NodeSDK({
  // traceExporter: ...,
  metricReader: prometheus,
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
