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

const baseUrl = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new ApiError('Unable to connect to HealthMate+. Check your internet connection and try again.');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload.error?.message || 'The request could not be completed.', {
      status: response.status,
      code: payload.error?.code || 'REQUEST_FAILED',
      fields: payload.error?.fields,
      details: payload.error || {},
    });
  }
  return payload.data;
}

export const api = {
  get: (path) => apiRequest(path),
  post: (path, body) => apiRequest(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: (path, body) => apiRequest(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: (path, body) => apiRequest(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: (path) => apiRequest(path, { method: 'DELETE' }),
};
