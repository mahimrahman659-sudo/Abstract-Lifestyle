'use client';

import { useRef } from 'react';
import { SizeGuideContent } from '@/components/catalog/SizeGuideContent';
import { Button } from '@/components/ui/Button';

export function SizeGuideDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => dialogRef.current?.showModal()}>
        Size guide
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby="size-guide-title"
        className="mx-auto w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl backdrop:bg-ink/40"
      >
        <h2 id="size-guide-title" className="text-lg font-semibold text-ink">
          Clothing size guide
        </h2>
        <SizeGuideContent />
        <form method="dialog" className="mt-6 flex justify-end">
          <Button type="submit" variant="secondary" size="sm">
            Close
          </Button>
        </form>
      </dialog>
    </>
  );
}
