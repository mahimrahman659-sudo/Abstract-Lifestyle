import bcrypt from 'bcryptjs';
import { AppError } from '../middleware/error-handler.js';
import { UserModel, type UserDocument } from '../models/user.model.js';
import type { LoginInput, RegisterInput } from '../schemas/user.schema.js';
import { verifyGoogleCredential } from './google-auth.service.js';

const BCRYPT_COST = 12;

// Compared against when the email does not exist, so login timing looks the same.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-placeholder', BCRYPT_COST);

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 11000;

export const registerUser = async (input: RegisterInput): Promise<UserDocument> => {
  const existing = await UserModel.findOne({ email: input.email }).select('_id').lean().exec();
  if (existing) {
    throw new AppError(409, 'CONFLICT', 'Email already registered');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  try {
    // Only whitelisted fields — role can never be set from user input.
    return await UserModel.create({
      email: input.email,
      passwordHash,
      name: input.name,
      role: 'customer',
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError(409, 'CONFLICT', 'Email already registered');
    }
    throw error;
  }
};

export const loginUser = async (input: LoginInput): Promise<UserDocument> => {
  const user = await UserModel.findOne({ email: input.email });

  if (!user) {
    // Constant-ish time: burn one bcrypt compare before failing.
    await bcrypt.compare(input.password, DUMMY_HASH);
    throw new AppError(401, 'UNAUTHORIZED', INVALID_CREDENTIALS_MESSAGE);
  }

  // Google-only accounts have no password: burn the dummy compare for equal
  // timing, then fail with the same generic error (no account enumeration).
  const passwordMatches = user.passwordHash
    ? await bcrypt.compare(input.password, user.passwordHash)
    : (await bcrypt.compare(input.password, DUMMY_HASH), false);

  if (!passwordMatches) {
    throw new AppError(401, 'UNAUTHORIZED', INVALID_CREDENTIALS_MESSAGE);
  }

  return user;
};

/**
 * Signs a user in with a verified Google ID token.
 *
 * Order: googleId match → normalized-email match (link, safe because the token
 * email is verified) → create a customer. Role is always "customer" for new
 * users and is never taken from the token or the request.
 */
export const loginWithGoogle = async (credential: string): Promise<UserDocument> => {
  // Throws a generic 401 on any verification failure. Never logged.
  const profile = await verifyGoogleCredential(credential);

  const byGoogleId = await UserModel.findOne({ googleId: profile.sub });
  if (byGoogleId) {
    return byGoogleId;
  }

  const byEmail = await UserModel.findOne({ email: profile.email });
  if (byEmail) {
    // Link the Google account to the existing user — only reached because
    // Google attests the email is verified. Keeps password/role untouched.
    byEmail.googleId = profile.sub;
    await byEmail.save();
    return byEmail;
  }

  const name = profile.name ?? profile.email.split('@')[0] ?? 'Customer';

  try {
    // Only whitelisted fields — role can never be set from user input.
    return await UserModel.create({
      email: profile.email,
      googleId: profile.sub,
      name,
      role: 'customer',
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      // Concurrent request created/linked the same account first — reuse it.
      const raced =
        (await UserModel.findOne({ googleId: profile.sub })) ??
        (await UserModel.findOne({ email: profile.email }));
      if (raced) {
        return raced;
      }
    }
    throw error;
  }
};
