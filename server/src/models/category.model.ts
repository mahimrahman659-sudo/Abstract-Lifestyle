import { Schema, model, type Types } from 'mongoose';

export interface Category {
  name: string;
  slug: string;
  description?: string;
  parent: Types.ObjectId | null;
  image?: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<Category>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    parent: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    image: { type: String, trim: true },
    sortOrder: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

categorySchema.index({ slug: 1 }, { unique: true });
categorySchema.index({ parent: 1, sortOrder: 1 });

export const CategoryModel = model<Category>('Category', categorySchema);
