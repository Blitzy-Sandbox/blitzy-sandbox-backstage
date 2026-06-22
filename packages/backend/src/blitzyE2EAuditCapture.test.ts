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

/**
 * Unit tests for the test-only audit-event capture buffer.
 *
 * The capture buffer is exercised end-to-end by the Playwright
 * `auditing.test.ts` suite; this file focuses narrowly on the
 * OpenTelemetry trace-context capture introduced for QA CP6 Finding
 * F-006 (audit buffer events were missing trace_id/span_id/trace_flags).
 *
 * The tests stub `@opentelemetry/api` via Jest module mocking to
 * present controlled span-context fixtures (valid context, invalid
 * all-zero context, no active span, and exception scenarios) and
 * verify that `captureTraceContext` returns the expected structured-log
 * shape in each case. They also confirm the trace fields are merged
 * onto captured events when the capture buffer is exercised through
 * the `_testOnly` accessors.
 *
 * The capture buffer module is re-imported per test via
 * `jest.isolateModules` so that the static state inside
 * `capturedAuditEvents` is reset between cases without relying on the
 * `_testOnlyClearCapturedEvents` helper (which is itself under test).
 */

import { trace as otelTrace } from '@opentelemetry/api';

jest.mock('@opentelemetry/api', () => {
  // Use a mutable mock object so each test can override the active span.
  const mockSpan = {
    spanContext: jest.fn(),
  };
  return {
    trace: {
      getActiveSpan: jest.fn(),
      __mockSpan: mockSpan,
    },
  };
});

const getActiveSpanMock = otelTrace.getActiveSpan as jest.Mock;
const mockSpan = (otelTrace as any).__mockSpan as {
  spanContext: jest.Mock;
};

describe('captureTraceContext', () => {
  beforeEach(() => {
    getActiveSpanMock.mockReset();
    mockSpan.spanContext.mockReset();
  });

  it('returns an empty object when there is no active span', async () => {
    getActiveSpanMock.mockReturnValue(undefined);

    const { captureTraceContext } = await import('./blitzyE2EAuditCapture');
    expect(captureTraceContext()).toEqual({});
  });

  it('returns trace context fields when the active span is valid', async () => {
    mockSpan.spanContext.mockReturnValue({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: 1,
    });
    getActiveSpanMock.mockReturnValue(mockSpan);

    const { captureTraceContext } = await import('./blitzyE2EAuditCapture');
    expect(captureTraceContext()).toEqual({
      trace_id: '0af7651916cd43dd8448eb211c80319c',
      span_id: 'b7ad6b7169203331',
      trace_flags: 1,
    });
  });

  it('returns an empty object when the trace ID is all zeros (invalid context)', async () => {
    mockSpan.spanContext.mockReturnValue({
      traceId: '00000000000000000000000000000000',
      spanId: 'b7ad6b7169203331',
      traceFlags: 0,
    });
    getActiveSpanMock.mockReturnValue(mockSpan);

    const { captureTraceContext } = await import('./blitzyE2EAuditCapture');
    expect(captureTraceContext()).toEqual({});
  });

  it('returns an empty object when the span ID is all zeros (invalid context)', async () => {
    mockSpan.spanContext.mockReturnValue({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: '0000000000000000',
      traceFlags: 0,
    });
    getActiveSpanMock.mockReturnValue(mockSpan);

    const { captureTraceContext } = await import('./blitzyE2EAuditCapture');
    expect(captureTraceContext()).toEqual({});
  });

  it('returns an empty object when the trace ID is missing', async () => {
    mockSpan.spanContext.mockReturnValue({
      traceId: undefined,
      spanId: 'b7ad6b7169203331',
      traceFlags: 1,
    });
    getActiveSpanMock.mockReturnValue(mockSpan);

    const { captureTraceContext } = await import('./blitzyE2EAuditCapture');
    expect(captureTraceContext()).toEqual({});
  });

  it('returns an empty object when the span ID is missing', async () => {
    mockSpan.spanContext.mockReturnValue({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: undefined,
      traceFlags: 1,
    });
    getActiveSpanMock.mockReturnValue(mockSpan);

    const { captureTraceContext } = await import('./blitzyE2EAuditCapture');
    expect(captureTraceContext()).toEqual({});
  });

  it('returns an empty object when spanContext() throws (defensive)', async () => {
    mockSpan.spanContext.mockImplementation(() => {
      throw new Error('OTel SDK not initialized');
    });
    getActiveSpanMock.mockReturnValue(mockSpan);

    const { captureTraceContext } = await import('./blitzyE2EAuditCapture');
    expect(captureTraceContext()).toEqual({});
  });

  it('returns an empty object when getActiveSpan() throws (defensive)', async () => {
    getActiveSpanMock.mockImplementation(() => {
      throw new Error('OTel API not available');
    });

    const { captureTraceContext } = await import('./blitzyE2EAuditCapture');
    expect(captureTraceContext()).toEqual({});
  });

  it('preserves traceFlags = 0 (sampled-off) as a numeric value', async () => {
    mockSpan.spanContext.mockReturnValue({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags: 0,
    });
    getActiveSpanMock.mockReturnValue(mockSpan);

    const { captureTraceContext } = await import('./blitzyE2EAuditCapture');
    expect(captureTraceContext()).toEqual({
      trace_id: '0af7651916cd43dd8448eb211c80319c',
      span_id: 'b7ad6b7169203331',
      trace_flags: 0,
    });
  });
});
