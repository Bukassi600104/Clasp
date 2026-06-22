#!/usr/bin/env bash
# Verifies the v1 features: idempotency, partner API, webhook delivery + HMAC, evidence.
set -u
B="http://localhost:3100"; H='Content-Type: application/json'; P=/tmp/pbf; mkdir -p $P
ADMIN="${ADMIN_SECRET:-clasp_admin_test}"  # must match the server's ADMIN_SECRET
pass=0; fail=0
check(){ if [ "$2" = "$3" ]; then echo "PASS  $1 ($2)"; pass=$((pass+1)); else echo "FAIL  $1 got=$2 want=$3"; fail=$((fail+1)); fi; }
jq_(){ python -c "import sys,json;d=json.load(sys.stdin);print(eval(\"d$1\"))"; }
login(){ curl -s -c $P/$1 -X POST $B/api/auth -H "$H" -d "{\"accessToken\":\"sandbox_$1\"}" >/dev/null; }

echo "=== IDEMPOTENCY (POST /api/trades) ==="
login seller_idem
KEY="idem-$(date +%s)"
T1=$(curl -s -b $P/seller_idem -X POST $B/api/trades -H "$H" -H "Idempotency-Key: $KEY" -d '{"amount":10,"shipWindowS":259200,"inspectWindowS":259200,"memo":"Idempotent item"}' | jq_ "['data']['id']")
T2=$(curl -s -b $P/seller_idem -X POST $B/api/trades -H "$H" -H "Idempotency-Key: $KEY" -d '{"amount":10,"shipWindowS":259200,"inspectWindowS":259200,"memo":"Idempotent item"}' | jq_ "['data']['id']")
check "replay returns same trade id" "$T1" "$T2"

echo ""
echo "=== PARTNER API + WEBHOOK (signed) ==="
node scripts/webhook-receiver.mjs /tmp/hooks.log >/dev/null 2>&1 &
RECV=$!; sleep 1
SECRET="whsec_test_123456789"
# key issuance is locked down — without the admin bearer it must be refused
NOADMIN=$(curl -s -o /dev/null -w "%{http_code}" -X POST $B/api/v1/partners -H "$H" -d '{"name":"x"}')
check "partner issuance denied without admin" "$NOADMIN" "401"
KEYJSON=$(curl -s -X POST $B/api/v1/partners -H "$H" -H "Authorization: Bearer $ADMIN" -d '{"name":"Acme Marketplace"}')
APIKEY=$(echo "$KEYJSON" | jq_ "['data']['api_key']")
check "partner key issued (with admin)" "$(echo $APIKEY | cut -c1-11)" "clasp_test_"
# register webhook
REG=$(curl -s -X POST $B/api/v1/webhooks -H "$H" -H "Authorization: Bearer $APIKEY" -d "{\"url\":\"http://localhost:4001/hook\",\"secret\":\"$SECRET\"}")
check "webhook registered (signed)" "$(echo $REG | jq_ "['data']['signed']")" "True"
# create a trade via partner API with idempotency + ref
PKEY="pidem-$(date +%s)"
CREATE=$(curl -s -X POST $B/api/v1/trades -H "$H" -H "Authorization: Bearer $APIKEY" -H "Idempotency-Key: $PKEY" -d '{"amount":15,"memo":"API-created trade","ref":"order-7788"}')
PID=$(echo "$CREATE" | jq_ "['data']['trade']['id']")
CHECKOUT=$(echo "$CREATE" | jq_ "['data']['checkout_url']")
check "partner trade has checkout url" "$(echo $CHECKOUT | grep -c "/t/$PID")" "1"
# idempotent replay on partner API
PID2=$(curl -s -X POST $B/api/v1/trades -H "$H" -H "Authorization: Bearer $APIKEY" -H "Idempotency-Key: $PKEY" -d '{"amount":15,"memo":"API-created trade","ref":"order-7788"}' | jq_ "['data']['trade']['id']")
check "partner idempotent replay" "$PID" "$PID2"
# lookup by ref
REFHIT=$(curl -s -X GET "$B/api/v1/trades?ref=order-7788" -H "Authorization: Bearer $APIKEY" | jq_ "['data'][0]['id']")
check "lookup by ref" "$REFHIT" "$PID"
# GET by id (partner-scoped)
GETST=$(curl -s -X GET "$B/api/v1/trades/$PID" -H "Authorization: Bearer $APIKEY" | jq_ "['data']['trade']['state']")
check "partner GET trade" "$GETST" "CREATED"
# unauthorized without key
UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$B/api/v1/trades/$PID")
check "v1 requires api key" "$UNAUTH" "401"

# verify webhook delivered + signature valid
sleep 2
HOOKLINE=$(tail -1 /tmp/hooks.log 2>/dev/null)
HOOKBODY=$(echo "$HOOKLINE" | python -c "import sys,json;print(json.load(sys.stdin)['body'])" 2>/dev/null)
HOOKSIG=$(echo "$HOOKLINE" | python -c "import sys,json;print(json.load(sys.stdin)['sig'])" 2>/dev/null)
EXPECT="sha256=$(printf '%s' "$HOOKBODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.*= //')"
check "webhook event is trade.created" "$(echo "$HOOKBODY" | jq_ "['event']" 2>/dev/null)" "trade.created"
check "webhook HMAC signature valid" "$HOOKSIG" "$EXPECT"
kill $RECV 2>/dev/null

echo ""
echo "=== EVIDENCE UPLOAD (dispute) ==="
login seller_ev; login buyer_ev
EID=$(curl -s -b $P/seller_ev -X POST $B/api/trades -H "$H" -d '{"amount":18,"shipWindowS":259200,"inspectWindowS":259200,"memo":"Disputed item"}' | jq_ "['data']['id']")
curl -s -b $P/buyer_ev -X POST $B/api/trades/$EID/fund -H "$H" -d '{"txid":"e1"}' >/dev/null
curl -s -b $P/seller_ev -X POST $B/api/trades/$EID/ship -H "$H" -d '{"evidenceNote":"shipped it"}' >/dev/null
curl -s -b $P/buyer_ev -X POST $B/api/trades/$EID/dispute -H "$H" >/dev/null
EVST=$(curl -s -b $P/buyer_ev -o /dev/null -w "%{http_code}" -X POST $B/api/trades/$EID/evidence -H "$H" -d '{"caption":"Arrived cracked, see corner"}')
check "buyer can add evidence" "$EVST" "201"
EVCOUNT=$(curl -s -b $P/buyer_ev $B/api/trades/$EID | jq_ "['data']['evidence'].__len__()")
check "evidence appears on trade" "$EVCOUNT" "1"
# a stranger cannot add evidence
login stranger_x
STR=$(curl -s -b $P/stranger_x -o /dev/null -w "%{http_code}" -X POST $B/api/trades/$EID/evidence -H "$H" -d '{"caption":"hi"}')
check "non-party evidence rejected" "$STR" "409"

echo ""
echo "$pass passed, $fail failed"