'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { ApiError } from '@/lib/api/client';
import { sanitizeNextPath } from '@/lib/utils/next-path';
import {
  validateRegister,
  type FieldErrors,
  type RegisterFormValues,
} from '@/lib/validation/auth';
import { fieldErrorsFromApi } from '@/lib/validation/server-errors';

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = sanitizeNextPath(searchParams.get('next'));
  const { register } = useAuth();

  const [values, setValues] = useState<RegisterFormValues>({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors<RegisterFormValues>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const validation = validateRegister(values);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      return;
    }

    setSubmitting(true);
    try {
      await register({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
      });
      router.replace(nextPath);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setErrors({ email: 'An account with this email already exists.' });
      } else if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
        setErrors(fieldErrorsFromApi(error));
      } else if (error instanceof ApiError && error.status === 429) {
        setFormError(error.message);
      } else {
        setFormError('Could not create your account. Please try again.');
      }
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Create account</h1>
      <p className="mt-1 text-sm text-muted">Join Abstract Lifestyle to shop and check out.</p>

      {formError ? (
        <Notice tone="error" className="mt-4">
          {formError}
        </Notice>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <Input
          label="Name"
          autoComplete="name"
          required
          value={values.name}
          error={errors.name}
          onChange={(event) => setValues((previous) => ({ ...previous, name: event.target.value }))}
        />
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
          autoComplete="new-password"
          required
          hint="At least 8 characters."
          value={values.password}
          error={errors.password}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, password: event.target.value }))
          }
        />
        <Button type="submit" className="w-full" loading={submitting} disabled={submitting}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted">
        Already have an account?{' '}
        <Link
          href={`/login?next=${encodeURIComponent(nextPath)}`}
          className="font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
