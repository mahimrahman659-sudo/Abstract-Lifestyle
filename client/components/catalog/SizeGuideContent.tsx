const SIZE_CHART = [
  { size: 'S', chest: '34–36', length: '27' },
  { size: 'M', chest: '38–40', length: '28' },
  { size: 'L', chest: '42–44', length: '29' },
  { size: 'XL', chest: '46–48', length: '30' },
];

/**
 * Clothing size chart — the single source of the size guide data, shared by the
 * size guide dialog and the "Size & Fit" tab (no duplicated data).
 */
export function SizeGuideContent() {
  return (
    <>
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
    </>
  );
}