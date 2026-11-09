'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { SizeGuideContent } from '@/components/catalog/SizeGuideContent';
import { cn } from '@/lib/utils/cn';

interface ProductTabsProps {
  /** Product description — the "Details" panel. */
  description: string;
  /** The "Size & Fit" tab only appears when the server resolved a size guide. */
  sizeGuideKey: 'clothing' | null;
  /** Shipping & returns copy from config/site.ts. */
  shippingText: string;
}

/**
 * Accessible product tabs (Details / Size & Fit / Shipping & Returns):
 * tablist with roving tabindex, ArrowLeft/ArrowRight/Home/End navigation and
 * automatic activation; panels are labelled tabpanels. Unstyled beyond the
 * existing design tokens — the redesign restyles it later.
 */
export function ProductTabs({ description, sizeGuideKey, shippingText }: ProductTabsProps) {
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
      <div role="tablist" aria-label="Product information" className="flex flex-wrap gap-1 border-b border-line">
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
              'border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              active === tab.key
                ? 'border-accent text-ink'
                : 'border-transparent text-muted hover:text-ink',
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
          className="pt-3 text-sm leading-relaxed text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {tab.key === 'details' ? <p>{description}</p> : null}
          {tab.key === 'size-fit' ? <SizeGuideContent /> : null}
          {tab.key === 'shipping' ? <p>{shippingText}</p> : null}
        </div>
      ))}
    </div>
  );
}