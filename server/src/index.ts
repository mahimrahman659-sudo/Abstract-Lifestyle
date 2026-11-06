import type { Server } from 'node:http';
import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';

const FORCE_EXIT_MS = 10_000;

const registerShutdown = (server: Server): void => {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal} — shutting down gracefully…`);

    const forceExit = setTimeout(() => {
      console.error('Shutdown timed out after 10s — forcing exit');
      process.exit(1);
    }, FORCE_EXIT_MS);
    forceExit.unref();

    // Stop accepting new connections, then close the database connection.
    server.close(() => {
      void (async () => {
        try {
          await disconnectDB();
        } catch (error) {
          console.error(
            'Error while disconnecting from MongoDB:',
            error instanceof Error ? error.message : error,
          );
        }
        console.log('Shutdown complete');
        process.exit(0);
      })();
    });
  };

  for (const signal of ['SIGTERM', 'SIGINT', 'SIGBREAK'] as const) {
    process.on(signal, () => shutdown(signal));
  }
};

const start = async (): Promise<void> => {
  try {
    await connectDB();

    const app = createApp();
    const server = app.listen(env.PORT, () => {
      console.log(`Abstract Lifestyle API listening on http://localhost:${env.PORT}`);
    });
    registerShutdown(server);
  } catch (error) {
    console.error('Failed to start server:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

void start();

