import type { RequestHandler } from 'express';
import { getAuthUser } from '../middleware/auth.js';
import { createOrderSchema, orderListQuerySchema, orderParamsSchema } from '../schemas/order.schema.js';
import { cancelOrder, createOrder, getOrder, listOrders } from '../services/order.service.js';

export const createOrderHandler: RequestHandler = async (req, res) => {
  const input = createOrderSchema.parse(req.body);
  const user = getAuthUser(req);
  res.status(201).json({ order: await createOrder(user, input) });
};

export const listOrdersHandler: RequestHandler = async (req, res) => {
  const query = orderListQuerySchema.parse(req.query);
  const user = getAuthUser(req);
  res.status(200).json(await listOrders(user, query));
};

export const getOrderHandler: RequestHandler = async (req, res) => {
  const { id } = orderParamsSchema.parse(req.params);
  const user = getAuthUser(req);
  res.status(200).json({ order: await getOrder(user, id) });
};

export const cancelOrderHandler: RequestHandler = async (req, res) => {
  const { id } = orderParamsSchema.parse(req.params);
  const user = getAuthUser(req);
  res.status(200).json({ order: await cancelOrder(user, id) });
};
