import { requireSession } from '@/lib/session';
import { getNotifications, markNotificationsRead } from '@/lib/store';
import { handler, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** GET /api/notifications — the caller's notification center. */
export const GET = handler(async () => {
  const session = requireSession();
  return ok(await getNotifications(session.uid));
});

/** POST /api/notifications — mark all read. */
export const POST = handler(async () => {
  const session = requireSession();
  await markNotificationsRead(session.uid);
  return ok({ read: true });
});
