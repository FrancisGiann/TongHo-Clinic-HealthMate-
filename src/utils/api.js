export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', fields = null, details = {} } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    Object.assign(this, details);
  }
}

const baseUrl = String(import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
export const CLINIC_DATA_REQUEST_TIMEOUT_MS = 60_000;
export const CLINIC_DATA_SLOW_NOTICE_MS = 8_000;

export async function apiRequest(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const clinicDataGet = path === '/api/data' && method === 'GET';
  const timeoutMs = clinicDataGet ? (options.timeoutMs ?? CLINIC_DATA_REQUEST_TIMEOUT_MS) : 0;
  const { timeoutMs: _timeoutOverride, ...requestOptions } = options;
  const callerSignal = requestOptions.signal;
  const controller = timeoutMs > 0 ? new AbortController() : null;
  let timedOut = false;
  let timeoutId;
  let callerAbortListener;
  const timeoutError = () => new ApiError('Clinic records are taking too long to load. Check your connection and try again.', {
    code: 'REQUEST_TIMEOUT',
  });
  const cancelledError = () => new ApiError('The clinic data request was cancelled.', { code: 'REQUEST_ABORTED' });
  if (controller) {
    if (callerSignal?.aborted) controller.abort();
    else if (callerSignal) {
      callerAbortListener = () => controller.abort();
      callerSignal.addEventListener('abort', callerAbortListener, { once: true });
    }
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  try {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        ...requestOptions,
        ...(controller ? { signal: controller.signal } : {}),
        headers: {
          ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
          ...(requestOptions.headers || {}),
        },
      });
    } catch {
      if (timedOut) throw timeoutError();
      if (callerSignal?.aborted) throw cancelledError();
      throw new ApiError('Unable to connect to HealthMate+. Check your internet connection and try again.');
    }

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      if (timedOut) throw timeoutError();
      if (callerSignal?.aborted) throw cancelledError();
    }
    if (!response.ok) {
      throw new ApiError(payload.error?.message || 'The request could not be completed.', {
        status: response.status,
        code: payload.error?.code || 'REQUEST_FAILED',
        fields: payload.error?.fields,
        details: payload.error || {},
      });
    }
    return payload.data;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (callerSignal && callerAbortListener) callerSignal.removeEventListener('abort', callerAbortListener);
  }
}

export const api = {
  get: (path, options = {}) => apiRequest(path, options),
  post: (path, body) => apiRequest(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: (path, body) => apiRequest(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: (path, body) => apiRequest(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: (path) => apiRequest(path, { method: 'DELETE' }),
};
