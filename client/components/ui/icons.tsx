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
