import { NextResponse } from 'next/server';
import { backendName } from '@/lib/db/repo';

export const dynamic = 'force-dynamic';

/** GET /v1/health (PRD §9). Reports configuration posture, never secrets. */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'clasp-escrow',
    version: '1.0.0',
    time: new Date().toISOString(),
    config: {
      pi_platform: !!process.env.PI_API_KEY,
      persistence: backendName(),
      sandbox: process.env.NEXT_PUBLIC_PI_SANDBOX === 'true',
    },
  });
}
