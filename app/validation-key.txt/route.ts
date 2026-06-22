/**
 * Pi Developer Portal domain validation. The Portal asks you to host a
 * validation key at https://<your-domain>/validation-key.txt. Set the value as
 * PI_VALIDATION_KEY in the environment and this route serves it as plain text.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const key = process.env.PI_VALIDATION_KEY ?? '';
  return new Response(key, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
