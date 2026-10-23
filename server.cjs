// CommonJS entry point for hosts that load the application with require().
// Dynamic import supports the existing ESM server's top-level startup checks.
import('./server.js').catch(() => {
  // Do not log the rejection: database/provider errors can contain secrets.
  console.error('HealthMate+ startup failed. Check the server configuration.');
  process.exit(1);
});
