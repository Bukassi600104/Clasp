#!/usr/bin/env bash
# Verifies the tier limit ladder + mutual rating features.
set -u
B="http://localhost:3100"; H='Content-Type: application/json'; P=/tmp/pbt; mkdir -p $P
pass=0; fail=0
check(){ if [ "$2" = "$3" ]; then echo "PASS  $1 ($2)"; pass=$((pass+1)); else echo "FAIL  $1 got=$2 want=$3"; fail=$((fail+1)); fi; }
jq_(){ python -c "import sys,json;d=json.load(sys.stdin);print(eval(\"d$1\"))"; }
login(){ curl -s -c $P/$1 -X POST $B/api/auth -H "$H" -d "{\"accessToken\":\"sandbox_$1\"}" >/dev/null; }
mk(){ curl -s -b $P/$1 -X POST $B/api/trades -H "$H" -d "{\"amount\":$3,\"shipWindowS\":259200,\"inspectWindowS\":259200,\"memo\":\"$2\"}"; }
act(){ local body="${4:-}"; [ -z "$body" ] && body='{}'; curl -s -b $P/$1 -X POST "$B/api/trades/$2/$3" -H "$H" -d "$body"; }
prof(){ curl -s -b $P/$1 $B/api/profile; }

echo "=== TIER CAP (new seller = Starter, 100 Pi) ==="
login tier_seller
OK=$(mk tier_seller "at cap" 100 | jq_ "['ok']");          check "100 Pi allowed" "$OK" True
OK=$(mk tier_seller "over cap" 150 | jq_ "['ok']");        check "150 Pi rejected (over Starter cap)" "$OK" False
check "profile tier is Starter" "$(prof tier_seller | jq_ "['data']['stats']['tier']['name']")" Starter
check "effective cap = 100 Pi" "$(prof tier_seller | jq_ "['data']['effective_limit_micro']")" 100000000

echo ""
echo "=== SELLER LIMIT CONTROL ==="
curl -s -b $P/tier_seller -X POST $B/api/profile -H "$H" -d '{"limitPi":50}' >/dev/null
check "self-lowered cap to 50 Pi" "$(prof tier_seller | jq_ "['data']['effective_limit_micro']")" 50000000
OK=$(mk tier_seller "over self cap" 60 | jq_ "['ok']");    check "60 Pi rejected after lowering to 50" "$OK" False
# request above the earned ceiling is clamped down, never granted
curl -s -b $P/tier_seller -X POST $B/api/profile -H "$H" -d '{"limitPi":500}' >/dev/null
check "raise above ceiling clamps to 100" "$(prof tier_seller | jq_ "['data']['effective_limit_micro']")" 100000000

echo ""
echo "=== MUTUAL FEEDBACK (positive / negative → % positive) ==="
login rate_seller; login rate_buyer
ID=$(mk rate_seller "Rated item" 12 | jq_ "['data']['id']")
act rate_buyer $ID fund '{"txid":"r1"}' >/dev/null
act rate_seller $ID ship '{"evidenceNote":"sent"}' >/dev/null
act rate_buyer $ID confirm >/dev/null
RB=$(curl -s -b $P/rate_buyer -o /dev/null -w "%{http_code}" -X POST $B/api/trades/$ID/rate -H "$H" -d '{"positive":true,"comment":"Great seller"}')
check "buyer can rate seller" "$RB" 201
RB2=$(curl -s -b $P/rate_buyer -o /dev/null -w "%{http_code}" -X POST $B/api/trades/$ID/rate -H "$H" -d '{"positive":false}')
check "double rating rejected" "$RB2" 409
act rate_seller $ID rate '{"positive":true,"comment":"Quick payer"}' >/dev/null
check "two ratings on trade" "$(curl -s -b $P/rate_seller $B/api/trades/$ID | jq_ "['data']['ratings'].__len__()")" 2
check "seller positive feedback 100%" "$(curl -s -b $P/rate_seller $B/api/trades/$ID | jq_ "['data']['sellerStats']['seller_rating']['positivePct']")" 100
# non-party cannot rate
login rate_stranger
RS=$(curl -s -b $P/rate_stranger -o /dev/null -w "%{http_code}" -X POST $B/api/trades/$ID/rate -H "$H" -d '{"positive":true}')
check "non-party rating rejected" "$RS" 409
# cannot rate a still-active trade
NID=$(mk rate_seller "Not done" 8 | jq_ "['data']['id']")
RN=$(curl -s -b $P/rate_seller -o /dev/null -w "%{http_code}" -X POST $B/api/trades/$NID/rate -H "$H" -d '{"positive":true}')
check "cannot rate non-terminal trade" "$RN" 409
# a negative rating lowers the % (third trade, buyer leaves 👎)
login rate_buyer2
ID2=$(mk rate_seller "Rated item 2" 10 | jq_ "['data']['id']")
act rate_buyer2 $ID2 fund '{"txid":"r2"}' >/dev/null
act rate_seller $ID2 ship '{"evidenceNote":"sent"}' >/dev/null
act rate_buyer2 $ID2 confirm >/dev/null
curl -s -b $P/rate_buyer2 -X POST $B/api/trades/$ID2/rate -H "$H" -d '{"positive":false}' >/dev/null
check "seller positive drops to 67% (2 of 3)" "$(curl -s -b $P/rate_seller $B/api/trades/$ID2 | jq_ "['data']['sellerStats']['seller_rating']['positivePct']")" 67

echo ""
echo "$pass passed, $fail failed"
