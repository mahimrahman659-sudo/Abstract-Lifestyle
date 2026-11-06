import mongoose from 'mongoose';
import { env } from './env.js';

export const connectDB = async (): Promise<void> => {
  await mongoose.connect(env.MONGODB_URI);
  const { name } = mongoose.connection;
  console.log(`MongoDB connected${name ? ` (db: ${name})` : ''}`);
};

export const disconnectDB = async (): Promise<void> => {
  await mongoose.disconnect();
};
