import { CategoryModel } from '../models/category.model.js';

export interface CategoryTreeItem {
  id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  sortOrder: number;
  children: CategoryTreeItem[];
}

export const getCategoryTree = async (): Promise<CategoryTreeItem[]> => {
  const categories = await CategoryModel.find().sort({ sortOrder: 1, name: 1 }).exec();

  const nodes = new Map<string, CategoryTreeItem>();
  for (const category of categories) {
    nodes.set(category._id.toString(), {
      id: category._id.toString(),
      name: category.name,
      slug: category.slug,
      description: category.description,
      image: category.image,
      sortOrder: category.sortOrder,
      children: [],
    });
  }

  const roots: CategoryTreeItem[] = [];
  for (const category of categories) {
    const node = nodes.get(category._id.toString());
    if (!node) {
      continue;
    }
    const parentId = category.parent ? category.parent.toString() : null;
    const parentNode = parentId ? nodes.get(parentId) : undefined;
    if (parentNode) {
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
};
