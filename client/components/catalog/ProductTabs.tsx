'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { SizeGuideContent } from '@/components/catalog/SizeGuideContent';
import { BanknoteIcon, BagIcon, ShirtIcon, TagIcon } from '@/components/ui/icons';
import { cn } from '@/lib/utils/cn';

interface ProductTabsProps {
  /** Product description — the "Details" panel. */
  description: string;
  /** Optional true-fact bullets shown under the description. */
  highlights?: string[];
  /** The "Size & Fit" tab only appears when the server resolved a size guide. */
  sizeGuideKey: 'clothing' | null;
  /** Shipping & returns copy from config/site.ts. */
  shippingText: string;
}

/** Icons for the detail bullets, in render order. */
const highlightIcons = [ShirtIcon, TagIcon, BagIcon, BanknoteIcon];

/**
 * Accessible product tabs (Details / Size & Fit / Shipping & Returns):
 * tablist with roving tabindex, ArrowLeft/ArrowRight/Home/End navigation and
 * automatic activation; panels are labelled tabpanels.
 */
export function ProductTabs({
  description,
  highlights = [],
  sizeGuideKey,
  shippingText,
}: ProductTabsProps) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = [
    { key: 'details', label: 'Details' },
    ...(sizeGuideKey ? [{ key: 'size-fit', label: 'Size & Fit' }] : []),
    { key: 'shipping', label: 'Shipping & Returns' },
  ];
  const [active, setActive] = useState('details');

  const selectAndFocus = (index: number) => {
    setActive(tabs[index].key);
    tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectAndFocus((index + 1) % tabs.length);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectAndFocus((index - 1 + tabs.length) % tabs.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectAndFocus(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectAndFocus(tabs.length - 1);
    }
  };

  return (
    <div>
      <div role="tablist" aria-label="Product information" className="flex flex-wrap gap-6 border-b border-line">
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.key}`}
            aria-selected={active === tab.key}
            aria-controls={`${baseId}-panel-${tab.key}`}
            tabIndex={active === tab.key ? 0 : -1}
            onClick={() => setActive(tab.key)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            className={cn(
              '-mb-px border-b-2 pb-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              active === tab.key
                ? 'border-ink font-semibold text-ink'
                : 'border-transparent font-medium text-muted hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${baseId}-panel-${tab.key}`}
          aria-labelledby={`${baseId}-tab-${tab.key}`}
          hidden={active !== tab.key}
          tabIndex={0}
          className="pt-5 text-sm leading-relaxed text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {tab.key === 'details' ? (
            <>
              <p>{description}</p>
              {highlights.length > 0 ? (
                <ul className="mt-4 space-y-2">
                  {highlights.map((item, index) => {
                    const Icon = highlightIcons[index % highlightIcons.length];
                    return (
                      <li key={item} className="flex items-center gap-2.5 text-[13px] text-ink">
                        <Icon className="size-4 shrink-0 text-muted" />
                        {item}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </>
          ) : null}
          {tab.key === 'size-fit' ? <SizeGuideContent /> : null}
          {tab.key === 'shipping' ? <p>{shippingText}</p> : null}
        </div>
      ))}
    </div>
  );
}