// CommonJS entry point for hosts that load the application with require().
// Exact allowlists only: never print provider messages, stacks, URLs, or paths.
const startupMessages = new Map([
  ['Production requires DATABASE_URL.', 'DATABASE_NOT_CONFIGURED'],
  ['Production requires verified PostgreSQL TLS.', 'DATABASE_TLS_CONFIGURATION'],
  ['Production DATABASE_URL must omit SSL query parameters; configure verified TLS with DB_SSL and DB_SSL_CA_FILE.', 'DATABASE_TLS_CONFIGURATION'],
  ['Production requires configured Resend because email verification is mandatory.', 'EMAIL_NOT_CONFIGURED'],
  ['Production requires certificate-verified email HTTPS.', 'EMAIL_TLS_CONFIGURATION'],
  ['Production database contains development-only seed data.', 'DEVELOPMENT_SEED_DATA_PRESENT'],
  ['TRUST_PROXY_HOPS must be an integer from 0 to 5.', 'INVALID_TRUST_PROXY_HOPS'],
  ['timeout exceeded when trying to connect', 'DATABASE_CONNECTION_TIMEOUT'],
  ['Connection terminated due to connection timeout', 'DATABASE_CONNECTION_TIMEOUT'],
  ['The server does not support SSL connections', 'DATABASE_TLS_UNSUPPORTED'],
]);
const startupCodes = new Map([
  ['DATABASE_NOT_CONFIGURED', 'DATABASE_NOT_CONFIGURED'],
  ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'],
  ['MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'],
  ['ERR_UNKNOWN_FILE_EXTENSION', 'MODULE_LOAD_FAILED'],
  ['ERR_REQUIRE_ASYNC_MODULE', 'MODULE_LOAD_FAILED'],
  ['ERR_INVALID_URL', 'INVALID_CONFIGURATION_URL'],
  ['ENOENT', 'REQUIRED_FILE_NOT_FOUND'],
  ['EACCES', 'FILE_OR_SOCKET_ACCESS_DENIED'],
  ['ENOTFOUND', 'NETWORK_DNS_FAILED'],
  ['EAI_AGAIN', 'NETWORK_DNS_FAILED'],
  ['ECONNREFUSED', 'NETWORK_CONNECTION_REFUSED'],
  ['ETIMEDOUT', 'NETWORK_CONNECTION_TIMEOUT'],
  ['ECONNRESET', 'NETWORK_CONNECTION_RESET'],
  ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS_CERTIFICATE_REJECTED'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', 'TLS_CERTIFICATE_REJECTED'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'TLS_CERTIFICATE_REJECTED'],
  ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'TLS_CERTIFICATE_REJECTED'],
  ['CERT_HAS_EXPIRED', 'TLS_CERTIFICATE_REJECTED'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'TLS_CERTIFICATE_REJECTED'],
  ['28P01', 'DATABASE_AUTHENTICATION_FAILED'],
  ['28000', 'DATABASE_AUTHORIZATION_FAILED'],
  ['3D000', 'DATABASE_NOT_FOUND'],
  ['42P01', 'DATABASE_REQUIRED_TABLE_MISSING'],
  ['42501', 'DATABASE_PERMISSION_DENIED'],
  ['53300', 'DATABASE_CONNECTION_LIMIT'],
]);

// Dynamic import preserves the ESM server's top-level production checks.
import('./server.js').catch((error) => {
  const code = startupMessages.get(error?.message)
    || startupCodes.get(error?.code)
    || 'UNCLASSIFIED_STARTUP_FAILURE';
  console.error(`HealthMate+ startup failed [${code}]. Check the server configuration.`);
  process.exit(1);
});
