# Client requirements: Abstract Lifestyle

## Client goals (their words)
- "The product landing page must be very good."
- "The cart and checkout process must be smooth."

## Users
- Shoppers across Bangladesh, mostly on phones, some on desktop and tablets.
- Admin staff who confirm Cash on Delivery orders by phone.

## Decisions
- Account is required to place an order. No guest checkout. Google sign-in is available.
- Checkout collects only: name, phone number, address. Payment is Cash on Delivery.
- The phone number is the key identifier: admin confirms each order by calling it. Accept Bangladeshi mobile numbers (01XXXXXXXXX, also +880 format), normalize before saving.
- Each product has about 5 photos.
- Discounts and sales are planned, so the data model must support a compare-at (original) price.
- Delivery fee is currently one flat fee from SHIPPING_FEE. Zone-based fees are undecided.

## Must have
1. Product page: gallery (up to 5 photos, zoom), color swatches, size buttons, stock labels, tabs, related products.
2. Add to cart gives immediate feedback (mini-cart) with real server prices.
3. Cart page and one-page checkout that are fast and clear on a phone.
4. Admin sees the customer's name, phone (tap to call) and address on every order.
5. Prices, stock and totals always come from the server.

## Should have
- Compare-at price with a computed discount badge.
- Sticky Add to Cart bar on mobile.

## Not now
- Reviews and ratings, wishlist, coupons, newsletter, guest checkout, online payment, zone-based delivery fees.

## Never invent
- Fake ratings, review counts, customer counts, countdowns, urgency messages, sale claims.

## Do not break
- Stock integrity, order snapshots, checkoutId idempotency, httpOnly cookie auth, open-redirect guard.
