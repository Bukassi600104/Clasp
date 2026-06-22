// Counts documents in each Firestore collection via the admin SDK (bypasses
// security rules, exactly like the app). Proves data persisted in Firestore.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ||= 'localhost:8080';
initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'clasp-local' });
const db = getFirestore();

const cols = ['users', 'trades', 'trade_events', 'settlement_proposals', 'partners', 'webhook_deliveries', 'notifications', 'evidence'];
for (const c of cols) {
  const snap = await db.collection(c).count().get();
  console.log(`  ${c.padEnd(22)} ${snap.data().count} docs`);
}
const t = await db.collection('trades').limit(1).get();
if (!t.empty) {
  const d = t.docs[0].data();
  console.log('\nsample trade:', { state: d.state, amount_micro: d.amount_micro, seller_bond_micro: d.seller_bond_micro, memo: d.memo });
}
const ev = await db.collection('trade_events').limit(3).get();
console.log('sample events:', ev.docs.map((d) => d.data().event));
process.exit(0);
