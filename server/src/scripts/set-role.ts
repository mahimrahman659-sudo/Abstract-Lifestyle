/**
 * CLI: set the role of an EXISTING user.
 *
 *   npm run set-role -- --email someone@example.com --role admin
 *
 * Only the `role` field is updated — the script never creates users and never
 * touches passwordHash, googleId or anything else. It refuses to demote the
 * last remaining admin and prints only the email and the resulting role.
 */
import { z } from 'zod';
import { connectDB, disconnectDB } from '../config/db.js';
import { UserModel } from '../models/user.model.js';

const USAGE = 'Usage: npm run set-role -- --email <email> --role <admin|customer>';

const argsSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('--email must be a valid email address')),
  role: z.enum(['admin', 'customer']),
});

type SetRoleArgs = z.infer<typeof argsSchema>;

/** Parses `--flag value` pairs. Unknown flags and missing values are rejected. */
const parseArgs = (argv: string[]): Record<string, string> => {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== '--email' && flag !== '--role') {
      throw new Error(`Unknown argument: ${flag ?? ''}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    values[flag.slice(2)] = value;
    index += 1;
  }
  return values;
};

const main = async (): Promise<void> => {
  let args: SetRoleArgs;
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

  const { email, role } = args;

  await connectDB();
  try {
    const user = await UserModel.findOne({ email }).select('email role').exec();
    if (!user) {
      console.error(
        `No account exists for ${email}. Sign in once first, then run this again.`,
      );
      process.exitCode = 1;
      return;
    }

    if (user.role === role) {
      console.log(`email: ${user.email}`);
      console.log(`role: ${user.role} (unchanged)`);
      return;
    }

    if (role === 'customer' && user.role === 'admin') {
      const adminCount = await UserModel.countDocuments({ role: 'admin' }).exec();
      if (adminCount <= 1) {
        console.error(`Refusing to demote ${email}: it is the last remaining admin.`);
        process.exitCode = 1;
        return;
      }
    }

    // `$set` only the role — no upsert, so a missing user is never created.
    const updated = await UserModel.findOneAndUpdate(
      { _id: user._id },
      { $set: { role } },
      { returnDocument: 'after', runValidators: true },
    )
      .select('email role')
      .exec();

    if (!updated) {
      console.error('The account disappeared before the update. Please try again.');
      process.exitCode = 1;
      return;
    }

    console.log(`email: ${updated.email}`);
    console.log(`role: ${updated.role}`);
  } finally {
    await disconnectDB();
  }
};

main().catch((error: unknown) => {
  console.error('set-role failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
