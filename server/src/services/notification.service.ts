import { randomUUID } from 'node:crypto';
import type { ClientSession, Types } from 'mongoose';
import {
  NotificationModel,
  type NotificationDocument,
  type NotificationType,
} from '../models/notification.model.js';

const RETRY_DELAY_MS = 60_000;
const LOCK_STALE_MS = 60_000;
const MAX_ATTEMPTS = 5;

export interface NotificationInput {
  user: Types.ObjectId;
  order: Types.ObjectId;
  orderNumber: string;
  type: NotificationType;
  message: string;
}

export interface NotificationDto {
  id: string;
  orderId: string;
  orderNumber: string;
  type: NotificationType;
  message: string;
  createdAt: Date;
}

/** Adds a notification to the transactional outbox (optionally in a session). */
export const enqueueNotification = async (
  input: NotificationInput,
  session?: ClientSession,
): Promise<void> => {
  await NotificationModel.create(
    [
      {
        user: input.user,
        order: input.order,
        orderNumber: input.orderNumber,
        type: input.type,
        channel: 'in_app',
        message: input.message,
        status: 'pending',
        attempts: 0,
        availableAt: new Date(),
      },
    ],
    session ? { session } : {},
  );
};

/**
 * Delivers pending notifications. The only channel today is the in-app inbox,
 * so delivery is a local state transition; the pending/retry fields are the
 * hook for email/SMS transports later. Each row is claimed with an atomic
 * lease, so two dispatchers cannot process the same row concurrently. Failures
 * are recorded and retried and never propagate into the payment request.
 */
export const dispatchPendingNotifications = async (
  limit = 25,
): Promise<{ sent: number; failed: number }> => {
  let sent = 0;
  let failed = 0;

  for (let index = 0; index < limit; index += 1) {
    const now = new Date();
    const staleLock = new Date(now.getTime() - LOCK_STALE_MS);
    const lockId = randomUUID();

    let notification: NotificationDocument | null;
    try {
      notification = await NotificationModel.findOneAndUpdate(
        {
          status: 'pending',
          availableAt: { $lte: now },
          $or: [{ lockedAt: null }, { lockedAt: { $lt: staleLock } }],
        },
        { $set: { lockedAt: now, lockId } },
        { sort: { createdAt: 1 }, returnDocument: 'after' },
      ).exec();
    } catch {
      break;
    }
    if (!notification) {
      break;
    }

    try {
      const completed = await NotificationModel.findOneAndUpdate(
        { _id: notification._id, lockId, status: 'pending' },
        {
          $set: {
            status: 'sent',
            sentAt: new Date(),
            lastError: null,
            lockedAt: null,
            lockId: null,
          },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after' },
      ).exec();
      if (completed) {
        sent += 1;
      }
    } catch (error) {
      failed += 1;
      const attempts = notification.attempts + 1;
      await NotificationModel.findOneAndUpdate(
        { _id: notification._id, lockId },
        {
          $set: {
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            availableAt: new Date(Date.now() + RETRY_DELAY_MS),
            lockedAt: null,
            lockId: null,
            lastError: error instanceof Error ? error.message : 'Delivery failed',
          },
          $inc: { attempts: 1 },
        },
      )
        .exec()
        .catch(() => undefined);
    }
  }

  return { sent, failed };
};

/** Best-effort wrapper used after a committed transaction. */
export const deliverNotifications = (): void => {
  void dispatchPendingNotifications().catch(() => undefined);
};

export const toNotificationDto = (notification: NotificationDocument): NotificationDto => ({
  id: notification._id.toString(),
  orderId: notification.order.toString(),
  orderNumber: notification.orderNumber,
  type: notification.type,
  message: notification.message,
  createdAt: notification.createdAt,
});

export const listCustomerNotifications = async (
  userId: Types.ObjectId,
  limit = 20,
): Promise<NotificationDto[]> => {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const items = await NotificationModel.find({ user: userId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(safeLimit)
    .exec();
  return items.map(toNotificationDto);
};
