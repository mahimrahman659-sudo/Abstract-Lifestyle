/**
 * Client-side mirror of the server Zod rules (server stays the authority).
 * Kept in sync with server/src/schemas/user.schema.ts.
 */

export interface LoginFormValues {
  email: string;
  password: string;
}

export interface RegisterFormValues extends LoginFormValues {
  name: string;
}

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateLogin = (values: LoginFormValues): FieldErrors<LoginFormValues> => {
  const errors: FieldErrors<LoginFormValues> = {};
  const email = values.email.trim();
  if (email.length === 0) {
    errors.email = 'Email is required';
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = 'Enter a valid email address';
  }
  if (values.password.length === 0) {
    errors.password = 'Password is required';
  }
  return errors;
};

export const validateRegister = (values: RegisterFormValues): FieldErrors<RegisterFormValues> => {
  const errors: FieldErrors<RegisterFormValues> = {};
  const name = values.name.trim();
  if (name.length === 0) {
    errors.name = 'Name is required';
  } else if (name.length > 100) {
    errors.name = 'Name must be at most 100 characters';
  }
  const email = values.email.trim();
  if (email.length === 0) {
    errors.email = 'Email is required';
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = 'Enter a valid email address';
  }
  if (values.password.length < 8) {
    errors.password = 'Password must be at least 8 characters';
  } else if (values.password.length > 72) {
    errors.password = 'Password must be at most 72 characters';
  }
  return errors;
};
