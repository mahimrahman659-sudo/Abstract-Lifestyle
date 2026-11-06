'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { ApiError } from '@/lib/api/client';
import { validateLogin, type FieldErrors, type LoginFormValues } from '@/lib/validation/auth';
import { fieldErrorsFromApi } from '@/lib/validation/server-errors';
import { sanitizeNextPath } from '@/lib/utils/next-path';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = sanitizeNextPath(searchParams.get('next'));
  const { login } = useAuth();

  const [values, setValues] = useState<LoginFormValues>({ email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors<LoginFormValues>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const validation = validateLogin(values);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      return;
    }

    setSubmitting(true);
    try {
      await login({ email: values.email.trim(), password: values.password });
      router.replace(nextPath);
    } catch (error) {
      // Generic error on failed login — never reveal whether the account exists.
      setFormError(
        error instanceof ApiError && error.status === 429
          ? error.message
          : 'Invalid email or password.',
      );
      setErrors(fieldErrorsFromApi(error));
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Welcome back. Sign in to continue.</p>

      {formError ? (
        <Notice tone="error" className="mt-4">
          {formError}
        </Notice>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={values.email}
          error={errors.email}
          onChange={(event) => setValues((previous) => ({ ...previous, email: event.target.value }))}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={values.password}
          error={errors.password}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, password: event.target.value }))
          }
        />
        <Button type="submit" className="w-full" loading={submitting} disabled={submitting}>
          Sign in
        </Button>
      </form>

      <GoogleSignInButton />

      <p className="mt-6 text-sm text-muted">
        New here?{' '}
        <Link
          href={`/register?next=${encodeURIComponent(nextPath)}`}
          className="font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
