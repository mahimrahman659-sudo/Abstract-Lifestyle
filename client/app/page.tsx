import { Suspense } from 'react';
import { ContactStrip } from '@/components/home/ContactStrip';
import { Hero } from '@/components/home/Hero';
import {
  NewArrivals,
  NewArrivalsSkeleton,
} from '@/components/home/NewArrivals';
import { PromoBanner } from '@/components/home/PromoBanner';
import {
  ShopByCategory,
  ShopByCategorySkeleton,
} from '@/components/home/ShopByCategory';
import { TrustStrip } from '@/components/home/TrustStrip';

/**
 * Home page. Static sections (hero, promo, trust, contact) render immediately;
 * data sections stream behind Suspense with matching skeletons and handle
 * error/empty states themselves, so an empty catalog still yields a full page.
 */
export default function HomePage() {
  return (
    <div>
      <Hero />
      <div className="mx-auto flex max-w-[1280px] flex-col gap-10 px-4 py-10 sm:px-10 lg:gap-16 lg:py-16">
        <Suspense fallback={<ShopByCategorySkeleton />}>
          <ShopByCategory />
        </Suspense>
        <PromoBanner />
        <Suspense fallback={<NewArrivalsSkeleton />}>
          <NewArrivals />
        </Suspense>
        <TrustStrip />
        <ContactStrip />
      </div>
    </div>
  );
}
