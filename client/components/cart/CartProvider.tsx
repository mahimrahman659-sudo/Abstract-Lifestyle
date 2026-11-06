'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { cartApi } from '@/lib/api/cart';
import type { CartView, GuestCartItem } from '@/lib/types';

const GUEST_CART_KEY = 'al_guest_cart';
const MAX_LINE_QUANTITY = 20;

const isGuestItem = (value: unknown): value is GuestCartItem => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { variantId?: unknown; quantity?: unknown };
  return (
    typeof candidate.variantId === 'string' &&
    typeof candidate.quantity === 'number' &&
    Number.isInteger(candidate.quantity) &&
    candidate.quantity >= 1
  );
};

const readGuestCart = (): GuestCartItem[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(GUEST_CART_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isGuestItem) : [];
  } catch {
    return [];
  }
};

const writeGuestCart = (items: GuestCartItem[]): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (items.length === 0) {
      window.localStorage.removeItem(GUEST_CART_KEY);
    } else {
      window.localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
    }
  } catch {
    // Storage unavailable (private mode/quota) — guest cart degrades to memory.
  }
};

const clampQuantity = (quantity: number): number => {
  const safe = Number.isFinite(quantity) ? quantity : 1;
  return Math.min(Math.max(1, Math.trunc(safe)), MAX_LINE_QUANTITY);
};

export interface CartContextValue {
  /** Server-priced cart (logged-in users). Prices always come from the server. */
  serverCart: CartView | null;
  /** Guest cart lines (variantId + quantity only — never prices). */
  guestItems: GuestCartItem[];
  itemCount: number;
  /** Returns the updated server cart (logged-in) or null (guest mode). */
  addItem: (variantId: string, quantity?: number) => Promise<CartView | null>;
  /** Returns the updated server cart (logged-in) or null (guest mode). */
  updateItem: (variantId: string, quantity: number) => Promise<CartView | null>;
  removeItem: (variantId: string) => Promise<void>;
  clearCart: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [serverCart, setServerCart] = useState<CartView | null>(null);
  const [guestItems, setGuestItems] = useState<GuestCartItem[]>([]);
  const mergedForUser = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setServerCart(await cartApi.getCart());
    } catch {
      // Keep whatever we have; the API is the authority on the next call.
    }
  }, []);

  // Hydrate the guest cart and merge it into the server cart on login.
  // State updates are deferred into an async task so they never run
  // synchronously during the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    const userId = user?.id ?? null;

    void (async () => {
      await Promise.resolve();

      if (userId === null) {
        mergedForUser.current = null;
        setServerCart(null);
        setGuestItems(readGuestCart());
        return;
      }

      if (mergedForUser.current === userId) {
        return;
      }
      mergedForUser.current = userId;

      const guest = readGuestCart();
      try {
        if (guest.length > 0) {
          const cart = await cartApi.merge({ items: guest });
          writeGuestCart([]);
          setGuestItems([]);
          setServerCart(cart);
        } else {
          await refresh();
        }
      } catch {
        await refresh();
      }
    })();
  }, [user, refresh]);

  const addItem = useCallback(
    async (variantId: string, quantity = 1): Promise<CartView | null> => {
      const qty = clampQuantity(quantity);

      if (!user) {
        const current = readGuestCart();
        const existing = current.find((item) => item.variantId === variantId);
        const next = existing
          ? current.map((item) =>
              item.variantId === variantId
                ? { ...item, quantity: clampQuantity(item.quantity + qty) }
                : item,
            )
          : [...current, { variantId, quantity: qty }];
        writeGuestCart(next);
        setGuestItems(next);
        return null;
      }

      const cart = await cartApi.addItem(variantId, qty);
      setServerCart(cart);
      return cart;
    },
    [user],
  );

  const updateItem = useCallback(
    async (variantId: string, quantity: number): Promise<CartView | null> => {
      const qty = clampQuantity(quantity);

      if (!user) {
        const next = readGuestCart().map((item) =>
          item.variantId === variantId ? { ...item, quantity: qty } : item,
        );
        writeGuestCart(next);
        setGuestItems(next);
        return null;
      }

      const cart = await cartApi.updateItem(variantId, qty);
      setServerCart(cart);
      return cart;
    },
    [user],
  );

  const removeItem = useCallback(
    async (variantId: string) => {
      if (!user) {
        const next = readGuestCart().filter((item) => item.variantId !== variantId);
        writeGuestCart(next);
        setGuestItems(next);
        return;
      }

      setServerCart(await cartApi.removeItem(variantId));
    },
    [user],
  );

  const clearCart = useCallback(async () => {
    if (!user) {
      writeGuestCart([]);
      setGuestItems([]);
      return;
    }

    setServerCart(await cartApi.clear());
  }, [user]);

  const itemCount = user
    ? (serverCart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0)
    : guestItems.reduce((sum, item) => sum + item.quantity, 0);

  const value = useMemo<CartContextValue>(
    () => ({ serverCart, guestItems, itemCount, addItem, updateItem, removeItem, clearCart, refresh }),
    [serverCart, guestItems, itemCount, addItem, updateItem, removeItem, clearCart, refresh],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
