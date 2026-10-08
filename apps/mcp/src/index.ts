import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = buildApp({ apiUrl: config.API_URL, logger: { level: config.LOG_LEVEL } });

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void app.close());

await app.listen({ port: config.MCP_PORT, host: '0.0.0.0' });
