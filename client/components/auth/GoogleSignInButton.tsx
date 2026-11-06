'use client';

import Script from 'next/script';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Notice } from '@/components/ui/Notice';
import { ApiError } from '@/lib/api/client';
import { sanitizeNextPath } from '@/lib/utils/next-path';

/**
 * Minimal typings for the Google Identity Services global (`accounts.id`).
 * Only the surface this component uses — no `any`.
 */
interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
}

interface GoogleButtonOptions {
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  type?: 'standard' | 'icon';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  width?: number;
}

interface GoogleAccountsId {
  initialize(config: GoogleIdConfiguration): void;
  renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
}

interface GoogleGsiGlobal {
  accounts: { id: GoogleAccountsId };
}

declare global {
  interface Window {
    google?: GoogleGsiGlobal;
  }
}

const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const GSI_SCRIPT_ID = 'google-gsi-client';

/**
 * Official Google sign-in button (Google Identity Services).
 *
 * Loads the GIS script via `next/script`, renders the hosted button and posts
 * the returned credential to `POST /auth/google`. On success it reuses the
 * normal login flow: the AuthProvider state updates (which triggers the
 * CartProvider guest-cart merge + clear) and the visitor is redirected through
 * the sanitized `?next=` path.
 *
 * Renders an "or" divider above the button. The button area keeps a fixed
 * height while the script loads, so the layout never shifts. When
 * `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is unset a neutral message is shown instead.
 */
export function GoogleSignInButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = sanitizeNextPath(searchParams.get('next'));
  const { loginWithGoogle } = useAuth();

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const handleCredential = useCallback(
    (response: GoogleCredentialResponse) => {
      setError(null);
      void (async () => {
        try {
          await loginWithGoogle(response.credential);
          router.replace(nextPath);
        } catch (caught) {
          setError(
            caught instanceof ApiError && caught.status === 429
              ? caught.message
              : 'Google sign-in failed. Please try again.',
          );
        }
      })();
    },
    [loginWithGoogle, nextPath, router],
  );

  const renderButton = useCallback(() => {
    const gsi = window.google;
    const container = containerRef.current;
    if (!gsi?.accounts?.id || !container || renderedRef.current) {
      return;
    }
    renderedRef.current = true;
    gsi.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredential,
    });
    gsi.accounts.id.renderButton(container, {
      theme: 'outline',
      size: 'large',
      type: 'standard',
      text: 'signin_with',
      width: Math.min(Math.max(container.clientWidth, 200), 400),
    });
  }, [clientId, handleCredential]);

  useEffect(() => {
    // The script may already be loaded (e.g. remount) — render right away;
    // `renderButton` is idempotent via renderedRef. Otherwise the Script
    // onLoad callback renders it.
    if (window.google?.accounts?.id) {
      renderButton();
    }
  }, [renderButton]);

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs uppercase tracking-wide text-muted">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="mt-4">
        {clientId.length === 0 ? (
          <p role="status" className="text-sm text-muted">
            Google sign-in isn&apos;t available right now. Use the form above instead.
          </p>
        ) : (
          <div
            ref={containerRef}
            role="group"
            aria-label="Sign in with Google"
            className="flex h-11 w-full items-center justify-center"
          />
        )}
      </div>

      {error ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}

      {clientId.length > 0 ? (
        <Script
          id={GSI_SCRIPT_ID}
          src={GSI_SCRIPT_SRC}
          strategy="afterInteractive"
          onLoad={renderButton}
          onError={() => {
            setError("Google sign-in couldn't be loaded. Please use the form instead.");
          }}
        />
      ) : null}
    </div>
  );
}