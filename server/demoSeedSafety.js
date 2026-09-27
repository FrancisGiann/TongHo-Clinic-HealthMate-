export function assertDemoSeedAllowed(env = process.env) {
  if (env.NODE_ENV !== 'development') throw new Error('Demo data seeding requires NODE_ENV=development and is disabled in production.');
  if (env.SEED_DEMO_DATA !== 'true') throw new Error('Set SEED_DEMO_DATA=true to explicitly enable demo data seeding.');
}
