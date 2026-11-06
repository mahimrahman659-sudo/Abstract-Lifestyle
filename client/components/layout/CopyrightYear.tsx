'use client';

import { useEffect, useState } from 'react';

/**
 * Renders the current year, computed after mount so prerendering never sees a
 * dynamic `new Date()` (keeps the route static).
 */
export function CopyrightYear() {
  const [year, setYear] = useState('');

  useEffect(() => {
    // Deferred into an async task (react-hooks/set-state-in-effect).
    void (async () => {
      await Promise.resolve();
      setYear(String(new Date().getFullYear()));
    })();
  }, []);

  return <span>{year}</span>;
}

