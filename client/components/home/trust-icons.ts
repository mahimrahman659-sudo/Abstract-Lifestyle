import type { ReactElement, SVGProps } from 'react';
import {
  BanknoteIcon,
  ExchangeIcon,
  ShieldIcon,
  SupportIcon,
} from '@/components/ui/icons';
import type { TrustItem } from '@/config/site';

type IconProps = SVGProps<SVGSVGElement>;
type IconComponent = (props: IconProps) => ReactElement;

/** Shared trust-item icon map (hero features + trust strip). */
export const trustIcons: Record<TrustItem['icon'], IconComponent> = {
  cod: BanknoteIcon,
  exchange: ExchangeIcon,
  shield: ShieldIcon,
  support: SupportIcon,
};
