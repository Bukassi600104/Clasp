// Counts documents in the PRODUCTION Firestore via the admin SDK (proves data
// physically persists in the cloud DB). Usage: node fs-prod-count.mjs <serviceAccount.json>
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const key = JSON.parse(readFileSync(process.argv[2], 'utf8'));
initializeApp({ credential: cert(key) });
const db = getFirestore();

for (const c of ['users', 'trades', 'trade_events', 'notifications', 'settlement_proposals']) {
  const snap = await db.collection(c).count().get();
  console.log(`  ${c.padEnd(20)} ${snap.data().count} docs`);
}
const t = await db.collection('trades').where('memo', '==', 'Firestore durability test').limit(1).get();
console.log('\n  durability-test trade in cloud DB:', t.empty ? 'NOT FOUND' : `FOUND (${t.docs[0].id})`);
process.exit(0);
