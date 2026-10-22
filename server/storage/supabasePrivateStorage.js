function cleanBaseUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function safeStorageError(code = 'STORAGE_UNAVAILABLE') {
  const error = new Error('Private image storage is unavailable.');
  error.code = code;
  return error;
}

export class SupabasePrivateStorage {
  constructor({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = cleanBaseUrl(env.SUPABASE_URL);
    this.serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    this.bucket = String(env.SUPABASE_STORAGE_BUCKET || '').trim();
    this.fetchImpl = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.serviceKey && this.bucket && !/[\s/]/.test(this.bucket) && typeof this.fetchImpl === 'function');
  }

  isBucket(bucket) {
    return this.isConfigured() && bucket === this.bucket;
  }

  objectUrl(bucket, key) {
    if (!this.isBucket(bucket)) throw safeStorageError('STORAGE_UNAVAILABLE');
    if (typeof key !== 'string' || !/^(branding|incidents)\/[A-Za-z0-9._/-]{1,180}$/.test(key)
      || key.split('/').some((part) => !part || part === '.' || part === '..')) throw safeStorageError('INVALID_STORAGE_KEY');
    return `${this.baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  headers(extra = {}) {
    return { apikey: this.serviceKey, authorization: `Bearer ${this.serviceKey}`, ...extra };
  }

  async upload(bucket, key, bytes, contentType) {
    const response = await this.fetchImpl(this.objectUrl(bucket, key), {
      method: 'POST',
      headers: this.headers({ 'content-type': contentType, 'cache-control': '0', 'x-upsert': 'false' }),
      body: bytes,
    });
    if (!response.ok) throw safeStorageError(`STORAGE_WRITE_${response.status}`);
    return true;
  }

  async download(bucket, key) {
    const response = await this.fetchImpl(this.objectUrl(bucket, key), { headers: this.headers() });
    if (response.status === 404) return null;
    if (!response.ok) throw safeStorageError(`STORAGE_READ_${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes;
  }

  async remove(bucket, key) {
    this.objectUrl(bucket, key);
    const bucketUrl = `${this.baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`;
    const response = await this.fetchImpl(bucketUrl, {
      method: 'DELETE',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefixes: [key] }),
    });
    if (response.ok) return true;
    throw safeStorageError(`STORAGE_DELETE_${response.status}`);
  }
}

export function privateStorageFromEnvironment(options) {
  return new SupabasePrivateStorage(options);
}
