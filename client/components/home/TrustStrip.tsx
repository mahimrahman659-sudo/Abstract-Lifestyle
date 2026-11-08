import { trustIcons } from '@/components/home/trust-icons';
import { site } from '@/config/site';

/** Trust strip — four true store promises, no invented numbers. */
export function TrustStrip() {
  return (
    <section aria-labelledby="trust-strip-heading" className="rounded-[10px] bg-[#f6f6f4] px-4 py-5 sm:px-5">
      <h2 id="trust-strip-heading" className="text-center text-[13px] font-bold text-ink">
        {site.trustStrip.title}
      </h2>
      <ul className="mt-4 grid grid-cols-2 gap-y-5 sm:grid-cols-4 sm:gap-y-0 sm:divide-x sm:divide-line">
        {site.trust.map((item) => {
          const Icon = trustIcons[item.icon];
          return (
            <li key={item.title} className="flex items-start gap-2.5 px-2 sm:px-4">
              <Icon className="mt-0.5 size-5 shrink-0 text-brand" />
              <div>
                <p className="text-[12px] font-semibold text-ink">{item.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{item.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
