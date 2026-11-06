import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export type UserRole = 'customer' | 'admin';

export interface Address {
  _id?: Types.ObjectId;
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
  isDefault: boolean;
}

export interface User {
  email: string;
  /** bcryptjs hash — absent for Google-created accounts (no password). */
  passwordHash?: string;
  /** Google Identity Services subject id — set on Google sign-in/link. */
  googleId?: string;
  name: string;
  role: UserRole;
  addresses: Address[];
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;

const addressSchema = new Schema<Address>(
  {
    label: { type: String, trim: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const userSchema = new Schema<User>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String },
    googleId: { type: String },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
    addresses: { type: [addressSchema], default: [] },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
// One Google account maps to at most one user; sparse so password-only users
// (and legacy rows) are unaffected.
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });

// Safety net: never serialize credentials or the Google subject id.
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    (ret as { passwordHash?: string }).passwordHash = undefined;
    (ret as { googleId?: string }).googleId = undefined;
    return ret;
  },
});

export const UserModel = model<User>('User', userSchema);
