/**
 * CLI: delete activity events — consent withdrawal / retention enforcement
 * (plan §5.3). Exactly ONE selector plus `--confirm` is required.
 *
 *   npm run purge-activity -- --by-user <userId> --confirm
 *   npm run purge-activity -- --by-anon <anonymousId> --confirm
 *   npm run purge-activity -- --before 2026-01-01T00:00:00.000Z --confirm
 *
 * Without `--confirm` the script only reports how many events MATCH and
 * deletes nothing. Prints counts only — never event payloads (they may
 * contain search terms or paths).
 *
 * Uses a direct connection (not `connectDB`) on purpose: a consent-driven
 * purge must work even when ACTIVITY_EVENTS_ENABLED=true and the index
 * readiness gate would otherwise refuse startup.
 */
import { z } from 'zod';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { ActivityEventModel } from '../models/activity-event.model.js';

const USAGE = [
  'Usage: npm run purge-activity -- (--by-user <id> | --by-anon <id> | --before <ISO-date>) --confirm',
  'Without --confirm the script reports the match count and deletes nothing.',
].join('\n');

const argsSchema = z
  .object({
    byUser: z.string().regex(/^[0-9a-fA-F]{24}$/, '--by-user must be a valid ObjectId').optional(),
    byAnon: z
      .string()
      .regex(/^[A-Za-z0-9-]{8,36}$/, '--by-anon must be 8-36 [A-Za-z0-9-] characters')
      .optional(),
    before: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), '--before must be a valid ISO date')
      .refine((value) => Date.parse(value) < Date.now(), '--before must be in the past')
      .optional(),
    confirm: z.enum(['true']).optional(),
  })
  .refine(
    (value) =>
      [value.byUser, value.byAnon, value.before].filter((entry) => entry !== undefined).length === 1,
    { message: 'provide exactly one of --by-user, --by-anon or --before' },
  );

const FLAG_TO_KEY: Record<string, string> = {
  '--by-user': 'byUser',
  '--by-anon': 'byAnon',
  '--before': 'before',
  '--confirm': 'confirm',
};

const parseArgs = (argv: string[]): Record<string, string> => {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = flag === undefined ? undefined : FLAG_TO_KEY[flag];
    if (!key) {
      throw new Error(`Unknown argument: ${flag ?? ''}`);
    }
    if (flag === '--confirm') {
      values.confirm = 'true';
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    values[key] = value;
    index += 1;
  }
  return values;
};

const main = async (): Promise<void> => {
  let args: z.infer<typeof argsSchema>;
  try {
    const parsed = argsSchema.safeParse(parseArgs(process.argv.slice(2)));
    if (!parsed.success) {
      console.error(USAGE);
      for (const issue of parsed.error.issues) {
        console.error(`- ${issue.path.join('.') || 'arguments'}: ${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }
    args = parsed.data;
  } catch (error) {
    console.error(USAGE);
    console.error(`- ${error instanceof Error ? error.message : 'invalid arguments'}`);
    process.exitCode = 1;
    return;
  }

  const filter: Record<string, unknown> = args.byUser
    ? { userId: new mongoose.Types.ObjectId(args.byUser) }
    : args.byAnon
      ? { anonymousId: args.byAnon }
      : { ts: { $lt: new Date(Date.parse(args.before as string)) } };

  await mongoose.connect(env.MONGODB_URI);
  try {
    const matched = await ActivityEventModel.countDocuments(filter).exec();
    console.log(`database: ${mongoose.connection.db?.databaseName ?? 'unknown'}`);
    console.log(`matched events: ${matched}`);

    if (args.confirm !== 'true') {
      console.log('Dry run only — nothing deleted. Re-run with --confirm to delete these events.');
      return;
    }

    const deleted = await ActivityEventModel.deleteMany(filter).exec();
    console.log(`deleted events: ${deleted.deletedCount ?? 0}`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error: unknown) => {
  console.error('purge-activity failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
