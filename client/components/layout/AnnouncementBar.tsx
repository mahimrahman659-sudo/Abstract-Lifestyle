import { BanknoteIcon, ExchangeIcon, TruckIcon } from '@/components/ui/icons';
import { site } from '@/config/site';

const announceIcons = [BanknoteIcon, TruckIcon, ExchangeIcon] as const;

/**
 * Slim announcement strip above the header: three items across on desktop,
 * only the first (centered) on mobile. Text comes from `config/site.ts`.
 */
export function AnnouncementBar() {
  const FirstIcon = announceIcons[0];

  return (
    <div className="bg-announce text-white">
      <div className="mx-auto flex h-[38px] max-w-[1280px] items-center px-4 sm:px-10">
        {/* Mobile: first line only, centered. */}
        <p className="flex w-full items-center justify-center gap-2 text-[12px] sm:hidden">
          <FirstIcon className="size-3.5 shrink-0" />
          <span className="truncate">{site.announcement[0]}</span>
        </p>

        {/* Desktop: three lines spread across the container. */}
        <ul className="hidden w-full items-center justify-between sm:flex">
          {site.announcement.map((line, index) => {
            const Icon = announceIcons[index % announceIcons.length];
            return (
              <li key={line} className="flex items-center gap-2 text-[13px]">
                <Icon className="size-3.5 shrink-0" />
                <span>{line}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
