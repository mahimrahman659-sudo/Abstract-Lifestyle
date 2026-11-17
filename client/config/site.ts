/**
 * Single source of truth for editable storefront text (PROJECT_CONTEXT §5).
 * Components read from here — edit copy here, not in components.
 *
 * Claims policy: every claim must be true for this store (Cash on Delivery,
 * flat-fee delivery, easy exchange). Never invent numbers, ratings or customer
 * counts. Items the owner must confirm before launch are marked "OWNER: confirm".
 */

export interface NavLink {
  label: string;
  href: string;
}

export interface FooterColumn {
  title: string;
  links: NavLink[];
}

export interface TrustItem {
  icon: 'cod' | 'exchange' | 'shield' | 'support';
  title: string;
  text: string;
}

export interface SocialLink {
  label: 'Facebook' | 'Instagram' | 'X';
  href: string;
}

export const site = {
  name: 'Abstract Lifestyle',
  tagline: 'Clothing & everyday lifestyle',
  description:
    'Clothing and everyday lifestyle essentials with Cash on Delivery and flat-fee delivery.',

  /** Announcement bar — exactly three short lines, one per icon. */
  announcement: [
    'Cash on Delivery on every order',
    'Flat delivery fee on every order',
    'Manage your orders from your account',
  ],

  /** Hero copy (used by the home page). */
  hero: {
    pill: 'NEW COLLECTION',
    titleLine1: 'Everyday style,',
    titleLine2: 'made simple.',
    subtitle:
      'Clothing and lifestyle essentials with Cash on Delivery and flat-fee delivery.',
    primaryCta: { label: 'Shop Now', href: '/products' },
    secondaryCta: { label: 'Explore Collections', href: '/products?sort=newest' },
  },

  /** Promo banner copy (home page). */
  promo: {
    pill: 'JUST ARRIVED',
    title: 'Explore the collection',
    text: 'Browse clothing and everyday lifestyle products.',
    cta: { label: 'Shop New Arrivals', href: '/products?sort=newest' },
    badge: 'New in',
  },

  /** Trust strip + hero features — every claim here is true for this store. */
  trust: [
    { icon: 'cod', title: 'Cash on Delivery', text: 'Pay in cash when your order arrives.' },
    { icon: 'exchange', title: 'Order history', text: 'View orders from your account.' },
    { icon: 'shield', title: 'Secure Checkout', text: 'Your details stay protected.' },
    { icon: 'support', title: 'Support', text: 'We are happy to help.' },
  ] as TrustItem[],

  trustStrip: {
    title: 'Shop with confidence',
  },

  /** Contact strip (replaces any newsletter row). */
  contactStrip: {
    text: "Questions about an order? We're here to help.",
    cta: { label: 'Contact us', href: '/contact' },
  },

  checkout: {
    // OWNER: confirm — only keep this line if the store really calls every
    // customer to confirm Cash on Delivery orders.
    callConfirmation: 'We will call you on {phone} to confirm your order.',
    // OWNER: confirm — these are statements of fact about the store's process,
    // not marketing claims. Adjust or remove any that do not match reality.
    confirmationTitle: 'Thank you — your order is placed.',
    whatHappensNext: [
      'We call you on the phone number you gave us to confirm the order before dispatch.',
      'You pay cash to the delivery person when the order arrives.',
      'You can cancel this order while it is pending or processing, before shipment.',
    ],
  },

  /** Home section headings and "View all" links. */
  sections: {
    categories: {
      title: 'Shop by Category',
      linkLabel: 'View all collections',
      href: '/products',
    },
    newArrivals: {
      title: 'New Arrivals',
      linkLabel: 'View all products',
      href: '/products',
    },
  },

  /** Main navigation (header bar + mobile menu). */
  nav: [
    { label: 'Home', href: '/' },
    { label: 'Shop', href: '/products' },
    { label: 'Clothing', href: '/products?category=clothing' },
    { label: 'Lifestyle', href: '/products?category=lifestyle' },
    { label: 'New Arrivals', href: '/products?sort=newest' },
  ] as NavLink[],

  footer: {
    /** Two-line brand blurb. */
    description:
      'Clothing and everyday lifestyle products, kept simple. Cash on Delivery and flat-fee delivery.',
    columns: [
      {
        title: 'Shop',
        links: [
          { label: 'All Products', href: '/products' },
          { label: 'New Arrivals', href: '/products?sort=newest' },
          { label: 'Clothing', href: '/products?category=clothing' },
          { label: 'Lifestyle', href: '/products?category=lifestyle' },
        ],
      },
      {
        title: 'Collections',
        links: [
          { label: 'T-Shirts', href: '/products?category=t-shirts' },
          { label: 'Hoodies', href: '/products?category=hoodies' },
          { label: 'Accessories', href: '/products?category=accessories' },
          { label: 'Bags', href: '/products?category=bags' },
        ],
      },
      {
        title: 'Customer Service',
        links: [
          { label: 'Contact Us', href: '/contact' },
          { label: 'Shipping & Returns', href: '/shipping-returns' },
          { label: 'My Orders', href: '/orders' },
        ],
      },
      {
        title: 'Company',
        links: [
          { label: 'About', href: '/about' },
          { label: 'Privacy Policy', href: '/privacy' },
        ],
      },
    ] as FooterColumn[],
    /** Payment column copy — text only, no card logos. */
    payment: 'Cash on Delivery',
  },

  /** Product detail page — tab + trust copy. */
  productPage: {
    // OWNER: confirm — these statements must match the store's real policies before launch.
    shippingAndReturns:
      'Cash on Delivery. The delivery fee is shown at checkout.',
    trust: [
      { title: 'Cash on Delivery', text: 'Pay in cash when your order arrives.' },
      { title: 'Order history', text: 'View orders from your account.' },
      { title: 'Secure Checkout', text: 'Your details stay protected.' },
    ],
    relatedTitle: 'You may also like',
    relatedLinkLabel: 'View all',
  },

  // OWNER: confirm — replace '#' with the real profile URLs (or remove unused ones).
  socials: [] as SocialLink[],

  // OWNER: confirm — real support email and hours before launch.
  contact: {
    email: '',
    hours: '',
  },
};
