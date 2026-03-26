/**
 * MCP server HTTP entry point.
 */

import log from '@apify/log';

import { createExpressApp } from './dev_server.js';

if (!process.env.APIFY_TOKEN) {
    log.error('APIFY_TOKEN is required but not set in the environment variables.');
    process.exit(1);
}

const HOST = process.env.HOST ?? 'http://localhost';
const PORT = Number(process.env.PORT ?? 3001);

const app = createExpressApp();

app.listen(PORT, () => {
    log.info('MCP server listening', { host: HOST, port: PORT });
});

// So Ctrl+C works locally
process.on('SIGINT', () => {
    log.info('Received SIGINT, shutting down gracefully...');
    process.exit(0);
});
