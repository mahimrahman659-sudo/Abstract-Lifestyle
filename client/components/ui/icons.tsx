import type { SVGProps } from 'react';

/** Small outline icons (stroke = currentColor) used across the global shell. */

type IconProps = SVGProps<SVGSVGElement>;

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function BagIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M6 8h12l-1.2 12H7.2L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
    </svg>
  );
}

export function CartIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M6 7h15l-1.5 8.5a2 2 0 0 1-2 1.5H8a2 2 0 0 1-2-1.6L4 4H2" />
      <circle cx="9.5" cy="20" r="1.25" />
      <circle cx="17.5" cy="20" r="1.25" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function TruckIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M2 6h11v10H2zM13 9h4l3 3v4h-7" />
      <circle cx="6" cy="18.5" r="1.5" />
      <circle cx="16" cy="18.5" r="1.5" />
    </svg>
  );
}

export function BanknoteIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v4M18 10v4" />
    </svg>
  );
}

export function ExchangeIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}

export function FacebookIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M14 8h2.5V4.5H14A4 4 0 0 0 10 8.5V11H7.5v3.5H10V21h3.5v-6.5H16l.5-3.5h-3V9a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

export function InstagramIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="m4.5 4.5 15 15M19.5 4.5l-15 15" />
    </svg>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="m12 3.5 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 3.5Z" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M4 12h16m-6-6 6 6-6 6" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M12 3.5 5.5 6v5c0 4.2 2.7 7.6 6.5 9 3.8-1.4 6.5-4.8 6.5-9V6L12 3.5Z" />
      <path d="m9 11.5 2 2 4-4" />
    </svg>
  );
}

export function SupportIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M4 13a8 8 0 0 1 16 0" />
      <path d="M4 13v3a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2ZM20 13v3a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2Z" />
      <path d="M17 18v1.5a2.5 2.5 0 0 1-2.5 2.5H12" />
    </svg>
  );
}

export function ShirtIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M8.5 4 4 6.5 6 10l2-1v11h8V9l2 1 2-3.5L15.5 4a3.5 3.5 0 0 1-7 0Z" />
    </svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <svg {...svgProps} {...props}>
      <path d="M3.5 11.5v-8h8l9 9-8 8-9-9Z" />
      <circle cx="8" cy="8" r="1.25" />
    </svg>
  );
}

