# Clasp — Deployment Runbook

End-to-end: Firebase (data) → Vercel (app + cron) → Pi Developer Portal (auth +
payments) → Soroban contract (funds). Do it on **testnet first**, pass the PRD
§12 gates, then repeat for mainnet.

---

## 1. Firebase (Firestore)

1. Create a Firebase project → **Build → Firestore Database → Create** (production mode).
2. **Project settings → Service accounts → Generate new private key** (downloads JSON).
3. Deploy the rules + (empty) indexes from this repo:
   ```bash
   firebase use <your-project-id>
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   Rules are default-deny — clients never touch Firestore; the server uses the
   admin SDK which bypasses rules.

## 2. Vercel

```bash
npm i -g vercel
vercel link
# Secrets (from the Firebase JSON + generated values):
vercel env add FIREBASE_PROJECT_ID
vercel env add FIREBASE_CLIENT_EMAIL
vercel env add FIREBASE_PRIVATE_KEY      # paste with literal \n, wrapped in quotes
vercel env add SESSION_SECRET            # node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
vercel env add CRON_SECRET
vercel env add ADMIN_SECRET
vercel env add NEXT_PUBLIC_PI_SANDBOX    # leave UNSET/false for Pi Browser (see note below)
vercel deploy --prod
```
`vercel.json` already registers the hourly cron (`/api/cron/reminders` — deadline
reminders + webhook retries). Confirm `GET /api/health` shows
`"persistence":"firestore"`.

> ⚠️ **`NEXT_PUBLIC_PI_SANDBOX` does NOT select Testnet vs Mainnet.** It only
> controls `Pi.init({ sandbox })`. `sandbox: true` targets the desktop dev
> environment at `sandbox.minepi.com` and is for local development only. For the
> deployed app opened inside the **real Pi Browser, it MUST be `false`** (leave
> the var unset) — for **both** Testnet and Mainnet apps. The network is chosen
> by the app's **Developer Portal registration** (step 3), and the SDK connects
> to it automatically. `PI_API_KEY` must be the key of that *same* portal app, or
> server-side `GET /v2/payments/{id}` returns 404 and approval fails with
> "the developer has failed to approve this payment."

## 3. Pi Developer Portal

In **Pi Browser → `pi://develop.pi`**:
1. **New App** → choose **App Network = Pi Testnet** (permanent; make a separate
   Mainnet app later).
2. Set the hosting URL to your Vercel production URL.
3. Copy the **API Key** → `vercel env add PI_API_KEY` → redeploy.
4. **Domain validation:** copy the validation key →
   `vercel env add PI_VALIDATION_KEY` → redeploy → confirm it serves at
   `https://<domain>/validation-key.txt` → click Verify.
5. **App Wallet:** connect the wallet (test wallet on testnet; the KYC'd fee
   wallet on mainnet).

Open the app in Pi Browser and run a real **sign-in + Lock funds** flow.

## 4. Soroban contract

See [`../contract/README.md`](../contract/README.md). Summary:
```bash
cd contract
cargo test                                                   # logic
cargo build --release --target wasm32-unknown-unknown        # artifact
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/clasp_escrow.wasm \
  --source operator --network testnet                        # → CONTRACT_ID
stellar contract invoke --id <CONTRACT_ID> --source operator --network testnet \
  -- initialize --fee_account <FEE> --burn_account <BURN> --token <PI_TOKEN_SAC>
```
Then:
```bash
vercel env add NEXT_PUBLIC_CONTRACT_ADDRESS   # <CONTRACT_ID> — shown in-app (anti-phishing)
vercel env add PI_RPC_URL
vercel env add PI_TOKEN_SAC
```
With `NEXT_PUBLIC_CONTRACT_ADDRESS` set, `lib/chain.ts` is the integration point
to route writes through wallet-signed contract calls and reads through Pi RPC
(see that file's header).

## 5. Testnet → Mainnet

1. Pass **all** PRD §12 gates (200+ completed trades, 0 stuck funds, permissionless
   timeouts proven, dispute/adversarial sims, fuzzing, independent audit published).
2. Register a **separate Mainnet app** in the portal (new API key + KYC'd wallet).
3. Re-deploy the contract to mainnet, update `NEXT_PUBLIC_CONTRACT_ADDRESS`.
4. Keep `NEXT_PUBLIC_PI_SANDBOX` unset/false (it stays false for Pi Browser on
   either network); swap to the mainnet `PI_API_KEY` / `PI_VALIDATION_KEY` from
   the new mainnet portal app, and redeploy.
5. Apply for the Pi Ecosystem Directory listing.

## Verify after every deploy

```bash
curl https://<domain>/api/health           # ok + persistence:firestore
curl https://<domain>/validation-key.txt   # the portal key
```
