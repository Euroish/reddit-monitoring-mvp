import path from 'node:path';

const invalid = key => { throw new Error(`Managed local configuration ${key} is invalid; inspect output/local-dev/config.json. Existing files were preserved.`); };
const integer = (value, key) => { if (!Number.isInteger(value) || value < 1 || value > 65535) invalid(key); return value; };
const below = (value, base) => { const relative = path.relative(base, value); return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

export function validateManagedConfig(value, home) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('object');
  for (const key of ['pgPort', 'apiPort', 'webPort']) integer(value[key], key);
  if (new Set([value.pgPort, value.apiPort, value.webPort]).size !== 3) invalid('ports (must differ)');
  if (typeof value.setupComplete !== 'boolean') invalid('setupComplete');
  for (const key of ['pgBin', 'pgData']) {
    if (typeof value[key] !== 'string' || !path.isAbsolute(value[key]) || !below(path.resolve(value[key]), path.resolve(home))) invalid(key);
  }
  let database;
  try { database = new URL(value.databaseUrl); } catch { invalid('databaseUrl'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== '127.0.0.1' || database.username !== 'postgres' || database.password || database.pathname !== '/info_workbench_dev' || Number(database.port) !== value.pgPort || database.search || database.hash) invalid('databaseUrl (loopback managed database/port)');
  return value;
}

export function managedEnvironment(config, values, shell = process.env) {
  const error = key => { throw new Error(`.env.local ${key} differs from managed configuration or is invalid; inspect it before proceeding. Existing files were preserved.`); };
  if (values.DATABASE_URL !== config.databaseUrl) error('DATABASE_URL');
  for (const [key, expected] of [['PORT', config.apiPort], ['LOCAL_WEB_PORT', config.webPort]]) if (values[key] !== String(expected)) error(key);
  const expectedProxy = `http://127.0.0.1:${config.apiPort}`;
  if (values.VITE_API_PROXY_TARGET !== expectedProxy) error('VITE_API_PROXY_TARGET');
  if (values.API_HOST !== undefined && values.API_HOST !== '127.0.0.1') error('API_HOST');
  if (values.NODE_ENV !== 'development') error('NODE_ENV');
  if (values.SOURCE_RUN_MODE !== undefined && !['demo', 'live'].includes(values.SOURCE_RUN_MODE)) error('SOURCE_RUN_MODE');
  if (values.SOURCE_NETWORK_ENABLED !== undefined && !['true', 'false'].includes(values.SOURCE_NETWORK_ENABLED)) error('SOURCE_NETWORK_ENABLED');
  return { ...shell, ...values, API_HOST: '127.0.0.1', SOURCE_RUN_MODE: 'demo', SOURCE_NETWORK_ENABLED: 'false', REDDIT_RUN_MODE: 'mock' };
}
