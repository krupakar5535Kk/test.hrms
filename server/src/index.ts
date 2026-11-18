import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`HRMS Server running in [${env.NODE_ENV}] mode on port ${env.PORT}`);
  logger.info(`Health check available at http://localhost:${env.PORT}${env.API_PREFIX}/health`);
});

// Graceful Shutdown Handlers
function shutdown(signal: string) {
  logger.info(`Received ${signal}. Gracefully terminating HRMS server...`);
  server.close(() => {
    logger.info('HTTP server closed successfully.');
    process.exit(0);
  });

  // Force close after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Forced shutdown timeout reached. Terminating immediately.');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});
