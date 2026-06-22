import { getSession } from '@/lib/session';
import { getProfile, getNotifications } from '@/lib/store';
import { handler, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = getSession();
  if (!session) return ok({ user: null });
  const profile = await getProfile(session.uid);
  const unread = (await getNotifications(session.uid)).filter((n) => !n.read_at).length;
  return ok({ user: session, profile, unread });
});
