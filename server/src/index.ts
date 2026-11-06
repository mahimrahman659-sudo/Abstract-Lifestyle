import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';

const start = async (): Promise<void> => {
  try {
    await connectDB();

    const app = createApp();
    app.listen(env.PORT, () => {
      console.log(`Abstract Lifestyle API listening on http://localhost:${env.PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

void start();

