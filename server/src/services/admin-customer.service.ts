import type { Types } from 'mongoose';
import { AppError } from '../middleware/error-handler.js';
import { OrderModel } from '../models/order.model.js';
import { UserModel, type UserRole } from '../models/user.model.js';
import type { AdminCustomerQuery } from '../schemas/admin.schema.js';
import { toOrderDto, type OrderDto } from './order.service.js';

export interface AdminCustomerDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
}

export interface AdminCustomerListResult {
  items: AdminCustomerDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Escapes regex metacharacters so user search text can never alter the pattern. */
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toCustomerDto = (user: {
  _id: Types.ObjectId;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
}): AdminCustomerDto => ({
  id: user._id.toString(),
  email: user.email,
  name: user.name,
  role: user.role,
  createdAt: user.createdAt,
});

export const adminListCustomers = async (
  query: AdminCustomerQuery,
): Promise<AdminCustomerListResult> => {
  const filter = query.search
    ? {
        $or: [
          { email: { $regex: escapeRegex(query.search), $options: 'i' } },
          { name: { $regex: escapeRegex(query.search), $options: 'i' } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    UserModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .exec(),
    UserModel.countDocuments(filter).exec(),
  ]);

  return {
    items: users.map(toCustomerDto),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export const adminGetCustomer = async (
  customerId: string,
): Promise<{ user: AdminCustomerDto; recentOrders: OrderDto[] }> => {
  const user = await UserModel.findById(customerId).exec();
  if (!user) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  const recentOrders = await OrderModel.find({ user: user._id })
    .sort({ createdAt: -1, _id: -1 })
    .limit(5)
    .exec();

  return { user: toCustomerDto(user), recentOrders: recentOrders.map(toOrderDto) };
};
