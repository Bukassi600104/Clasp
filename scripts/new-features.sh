#!/usr/bin/env bash
# Verifies mutual completion (both parties required) + public successful-trade count.
set -u
B="http://localhost:3100"; H='Content-Type: application/json'; P=/tmp/pbn; mkdir -p $P
pass=0; fail=0
check(){ if [ "$2" = "$3" ]; then echo "PASS  $1 ($2)"; pass=$((pass+1)); else echo "FAIL  $1 got=$2 want=$3"; fail=$((fail+1)); fi; }
jq_(){ python -c "import sys,json;d=json.load(sys.stdin);print(eval(\"d$1\"))"; }
login(){ curl -s -c $P/$1 -X POST $B/api/auth -H "$H" -d "{\"accessToken\":\"sandbox_$1\"}" >/dev/null; }
mk(){ curl -s -b $P/$1 -X POST $B/api/trades -H "$H" -d "{\"amount\":$3,\"shipWindowS\":259200,\"inspectWindowS\":259200,\"memo\":\"$2\"}"; }
act(){ local body="${4:-}"; [ -z "$body" ] && body='{}'; curl -s -b $P/$1 -X POST "$B/api/trades/$2/$3" -H "$H" -d "$body"; }

echo "=== MUTUAL COMPLETION (neither party can finish alone) ==="
login seller_m; login buyer_m
ID=$(mk seller_m "Mutual item" 12 | jq_ "['data']['id']")
check "buyer cannot confirm an unfunded trade"       "$(act buyer_m $ID confirm | jq_ "['ok']")" "False"
act buyer_m $ID fund '{"txid":"m1"}' >/dev/null
check "buyer cannot confirm before the seller ships" "$(act buyer_m $ID confirm | jq_ "['ok']")" "False"
act seller_m $ID ship '{"evidenceNote":"sent"}' >/dev/null
check "seller cannot confirm (only the buyer can)"   "$(act seller_m $ID confirm | jq_ "['ok']")" "False"
act buyer_m $ID confirm >/dev/null
check "completes only after BOTH acted (ship+confirm)" "$(curl -s -b $P/seller_m $B/api/trades/$ID | jq_ "['data']['trade']['state']")" "COMPLETED"
# self-dealing is impossible (same person can't be buyer and seller)
SELF=$(mk seller_m "self" 5 | jq_ "['data']['id']")
check "seller cannot fund their own trade"           "$(act seller_m $SELF fund | jq_ "['ok']")" "False"

echo ""
echo "=== PUBLIC SUCCESSFUL-TRADE COUNT (visible to others) ==="
SUCC=$(curl -s -b $P/buyer_m $B/api/trades/$ID | jq_ "['data']['sellerStats']['successful']")
check "seller's successful count is visible (>=1)" "$([ "${SUCC:-0}" -ge 1 ] && echo yes || echo no)" "yes"
# a brand-new third party sees the seller's count too (public trust signal)
login viewer_x
SUCC2=$(curl -s -b $P/viewer_x $B/api/trades/$ID | jq_ "['data']['sellerStats']['successful']")
check "count is public to any viewer" "$([ "${SUCC2:-0}" -ge 1 ] && echo yes || echo no)" "yes"

echo ""
echo "$pass passed, $fail failed"
