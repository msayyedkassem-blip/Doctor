import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  computeCartTotals, quoteAllShipping,
  type CartLineInput, type CartTotals, type ShippingQuote, type VatMode,
} from '@souk/core';
import type { ApiProduct } from './types';

/**
 * Cart state.
 *
 * Quantities live on the device; pricing goes through @souk/core — the same
 * module the website and the admin use. That is the point of the shared
 * package: the app cannot quote a different total from the website.
 */

const CART_KEY = 'souk:cart:v1';
const MAX_QUANTITY_PER_LINE = 50;

type Quantities = Record<string, number>;

interface CartContextValue {
  quantities: Quantities;
  itemCount: number;
  totals: CartTotals;
  shippingOptions: ShippingQuote[];
  add: (productId: string, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clear: () => void;
  ready: boolean;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({
  children, products, vatMode,
}: { children: React.ReactNode; products: ApiProduct[]; vatMode: VatMode }) {
  const [quantities, setQuantities] = useState<Quantities>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(CART_KEY);
        if (raw) setQuantities(JSON.parse(raw) as Quantities);
      } catch {
        // A corrupt cart is not worth blocking the app for; start empty.
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persist = useCallback((next: Quantities) => {
    setQuantities(next);
    void AsyncStorage.setItem(CART_KEY, JSON.stringify(next));
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setQuantities((current) => {
      const next = { ...current };
      const clamped = Math.min(Math.trunc(quantity), MAX_QUANTITY_PER_LINE);
      if (clamped <= 0) delete next[productId];
      else next[productId] = clamped;
      void AsyncStorage.setItem(CART_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const add = useCallback((productId: string, quantity = 1) => {
    setQuantities((current) => {
      const next = {
        ...current,
        [productId]: Math.min((current[productId] ?? 0) + quantity, MAX_QUANTITY_PER_LINE),
      };
      void AsyncStorage.setItem(CART_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clear = useCallback(() => persist({}), [persist]);

  const lines: CartLineInput[] = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    return Object.entries(quantities).flatMap(([productId, quantity]) => {
      const product = byId.get(productId);
      // A product withdrawn from sale since it was added simply drops out.
      if (!product || quantity <= 0) return [];
      return [{
        productId: product.id,
        slug: product.slug,
        nameFr: product.displayNameFr,
        unitPriceCents: product.priceCents,
        quantity,
        vatCategory: product.vatCategory,
        shippingWeightGrams: product.shippingWeightGrams,
      }];
    });
  }, [products, quantities]);

  const totals = useMemo(
    () => computeCartTotals({ lines, shippingQuote: null, vatMode }),
    [lines, vatMode],
  );

  const shippingOptions = useMemo(
    () => (lines.length === 0
      ? []
      : quoteAllShipping({
          itemsWeightGrams: totals.itemsWeightGrams,
          subtotalCents: totals.subtotalCents,
        })),
    [lines.length, totals.itemsWeightGrams, totals.subtotalCents],
  );

  const value = useMemo<CartContextValue>(() => ({
    quantities, itemCount: totals.itemCount, totals, shippingOptions,
    add, setQuantity, clear, ready,
  }), [quantities, totals, shippingOptions, add, setQuantity, clear, ready]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart doit être utilisé dans un CartProvider');
  return context;
}
