'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/Button';

const SIZE_CHART = [
  { size: 'S', chest: '34–36', length: '27' },
  { size: 'M', chest: '38–40', length: '28' },
  { size: 'L', chest: '42–44', length: '29' },
  { size: 'XL', chest: '46–48', length: '30' },
];

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
        <p className="mt-1 text-sm text-muted">Measurements in inches.</p>
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-2">
                Size
              </th>
              <th scope="col" className="py-2 pr-2">
                Chest
              </th>
              <th scope="col" className="py-2">
                Length
              </th>
            </tr>
          </thead>
          <tbody>
            {SIZE_CHART.map((row) => (
              <tr key={row.size} className="border-b border-line/60 last:border-0">
                <th scope="row" className="py-2 pr-2 font-medium text-ink">
                  {row.size}
                </th>
                <td className="py-2 pr-2 text-muted">{row.chest}</td>
                <td className="py-2 text-muted">{row.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form method="dialog" className="mt-6 flex justify-end">
          <Button type="submit" variant="secondary" size="sm">
            Close
          </Button>
        </form>
      </dialog>
    </>
  );
}
