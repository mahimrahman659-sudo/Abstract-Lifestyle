import { Schema, model, type Types } from 'mongoose';
import { LOW_STOCK_THRESHOLD_DEFAULT } from '../utils/stock.js';

export interface Variant {
  product: Types.ObjectId;
  sku: string;
  size: string | null;
  color: string | null;
  price: number | null;
  /**
   * Optional original price in poisha. Only meaningful when the variant has
   * its own `price`; a variant without its own price uses the product's value.
   */
  compareAtPrice?: number | null;
  stock: number;
  lowStockThreshold: number;
  images: string[];
  /**
   * Set when the variant is retired because orders reference it: the document
   * (and its stock) is kept so cancellations can restore inventory and order
   * snapshots keep a valid target. Archived variants are never sold.
   */
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const variantSchema = new Schema<Variant>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true, uppercase: true, trim: true },
    size: { type: String, default: null, trim: true },
    color: { type: String, default: null, trim: true },
    price: { type: Number, default: null, min: 0 },
    compareAtPrice: { type: Number, default: null, min: 0 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    lowStockThreshold: { type: Number, default: LOW_STOCK_THRESHOLD_DEFAULT, min: 0 },
    images: { type: [String], default: [] },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

variantSchema.index({ product: 1 });
variantSchema.index({ sku: 1 }, { unique: true });
variantSchema.index({ product: 1, size: 1, color: 1 }, { unique: true });


export const VariantModel = model<Variant>('Variant', variantSchema);
