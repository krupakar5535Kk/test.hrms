import { Router, Request, Response, NextFunction } from 'express';
import { requireActiveUser } from '../../middleware/authMiddleware.js';
import { withTenantTransaction } from '../../db/transaction.js';
import { fetchMappedNotifications } from '../../services/recordMappers.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireActiveUser('ADMIN', 'EMPLOYEE'));

notificationsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const notifications = await withTenantTransaction(
      session.organizationId,
      (client) =>
        fetchMappedNotifications(client, session.organizationId, session.authUserId, session.appRole),
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { notifications },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post('/:notificationId/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = req.hrmsUser!;
    const { notificationId } = req.params as { notificationId: string };

    await withTenantTransaction(
      session.organizationId,
      async (client) => {
        await client.query(
          `UPDATE public.notifications
           SET is_read = TRUE, read_at = NOW()
           WHERE organization_id = $1::uuid
             AND id = $2::uuid
             AND recipient_user_id = $3::uuid;`,
          [session.organizationId, notificationId, session.authUserId]
        );
      },
      session.authUserId
    );

    res.status(200).json({
      success: true,
      data: { updated: true },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
});
