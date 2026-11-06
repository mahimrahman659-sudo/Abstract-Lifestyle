import bcrypt from 'bcryptjs';
import { AppError } from '../middleware/error-handler.js';
import { UserModel, type UserDocument } from '../models/user.model.js';
import type { LoginInput, RegisterInput } from '../schemas/user.schema.js';

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

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new AppError(401, 'UNAUTHORIZED', INVALID_CREDENTIALS_MESSAGE);
  }

  return user;
};
