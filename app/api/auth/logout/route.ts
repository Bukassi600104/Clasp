import { clearSession } from '@/lib/session';
import { handler, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = handler(async () => {
  clearSession();
  return ok({ signedOut: true });
});
