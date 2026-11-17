import type { TestContext } from 'node:test';
import mongoose from 'mongoose';

/** Unit tests substitute a connection without ever opening a socket. */
export const mockConnection = (
  context: TestContext,
  db: unknown,
  host = '127.0.0.1',
) => {
  for (const [key, value] of Object.entries({ db, host, readyState: 1 })) {
    const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, key);
    Object.defineProperty(mongoose.connection, key, { value, configurable: true, writable: true });
    context.after(() => {
      if (descriptor) Object.defineProperty(mongoose.connection, key, descriptor);
      else Reflect.deleteProperty(mongoose.connection, key);
    });
  }
  const connect = context.mock.method(mongoose, 'connect', async () => mongoose);
  context.mock.method(mongoose, 'disconnect', async () => {
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true, writable: true });
  });
  return connect;
};
