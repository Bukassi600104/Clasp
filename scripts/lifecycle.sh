#!/usr/bin/env bash
# Full lifecycle verification using curl with per-user cookie jars.
set -u
B="http://localhost:3100"
H='Content-Type: application/json'
P=/tmp/pb
mkdir -p $P
pass=0; fail=0
state(){ curl -s -b $P/$1 "$B/api/trades/$2" | python -c "import sys,json;print(json.load(sys.stdin)['data']['trade']['state'])"; }
check(){ if [ "$2" = "$3" ]; then echo "PASS  $1 ($2)"; pass=$((pass+1)); else echo "FAIL  $1 got=$2 want=$3"; fail=$((fail+1)); fi; }
login(){ curl -s -c $P/$1 -X POST $B/api/auth -H "$H" -d "{\"accessToken\":\"sandbox_$1\"}" >/dev/null; }
mk(){ curl -s -b $P/$1 -X POST $B/api/trades -H "$H" -d "{\"amount\":$3,\"shipWindowS\":259200,\"inspectWindowS\":259200,\"memo\":\"$2\"}"; }
act(){ local body="${4:-}"; [ -z "$body" ] && body='{}'; curl -s -b $P/$1 -X POST "$B/api/trades/$2/$3" -H "$H" -d "$body"; }

echo "=== HAPPY PATH (create→fund→ship→confirm) ==="
login seller_happy; login buyer_happy
ID=$(mk seller_happy "Aso-Oke fabric" 12 | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
check "created" "$(state seller_happy $ID)" CREATED
OK=$(act buyer_happy $ID fund '{"txid":"t0"}' | python -c "import sys,json;print(json.load(sys.stdin)['ok'])")
check "fund before seller bond rejected" "$OK" False
act seller_happy $ID bond >/dev/null;                            check "seller bond posted" "$(state seller_happy $ID)" CREATED
act buyer_happy $ID fund '{"txid":"t1"}' >/dev/null;            check "fund→FUNDED" "$(state seller_happy $ID)" FUNDED
act seller_happy $ID ship '{"evidenceNote":"DHL handed over"}' >/dev/null; check "ship→SHIPPED" "$(state seller_happy $ID)" SHIPPED
act buyer_happy $ID confirm >/dev/null;                          check "confirm→COMPLETED" "$(state seller_happy $ID)" COMPLETED

echo ""
echo "=== DISPUTE → SETTLE ==="
login seller_disp; login buyer_disp
ID=$(mk seller_disp "Phone case" 20 | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
act seller_disp $ID bond >/dev/null
act buyer_disp $ID fund '{"txid":"t2"}' >/dev/null
act seller_disp $ID ship '{"evidenceNote":"shipped"}' >/dev/null
act buyer_disp $ID dispute >/dev/null;                          check "dispute→DISPUTED" "$(state seller_disp $ID)" DISPUTED
PID=$(act buyer_disp $ID propose '{"sellerPct":40}' | python -c "import sys,json;print(json.load(sys.stdin)['data']['proposal']['id'])")
act seller_disp $ID accept "{\"proposalId\":\"$PID\"}" >/dev/null; check "accept→SETTLED" "$(state seller_disp $ID)" SETTLED

echo ""
echo "=== AUTHORIZATION GUARDS ==="
login seller_guard; login buyer_guard
ID=$(mk seller_guard "Guard test" 10 | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
act seller_guard $ID bond >/dev/null
act buyer_guard $ID fund '{"txid":"t3"}' >/dev/null
act seller_guard $ID ship '{"evidenceNote":"x"}' >/dev/null
OK=$(act seller_guard $ID confirm | python -c "import sys,json;print(json.load(sys.stdin)['ok'])")
check "seller cannot confirm" "$OK" False
SELF=$(mk seller_guard "Self fund" 5 | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
OK=$(act seller_guard $SELF fund | python -c "import sys,json;print(json.load(sys.stdin)['ok'])")
check "seller cannot fund own trade" "$OK" False

echo ""
echo "=== CANCEL → REACTIVATE ==="
login seller_react
ID=$(mk seller_react "Relist test" 8 | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
act seller_react $ID bond >/dev/null
act seller_react $ID cancel >/dev/null;                          check "cancel→CANCELLED" "$(state seller_react $ID)" CANCELLED
act seller_react $ID reactivate >/dev/null;                      check "reactivate→CREATED" "$(state seller_react $ID)" CREATED

echo ""
echo "=== AMOUNT BOUNDS (Starter tier = 100 Pi cap) ==="
login bound_test
OK=$(mk bound_test "withincap" 60 | python -c "import sys,json;print(json.load(sys.stdin)['ok'])")
check "60 Pi within new Starter cap" "$OK" True
OK=$(mk bound_test "toobig" 120 | python -c "import sys,json;print(json.load(sys.stdin)['ok'])")
check "over 100 Pi Starter cap rejected" "$OK" False
OK=$(mk bound_test "small" 0.5 | python -c "import sys,json;print(json.load(sys.stdin)['ok'])")
check "under 1 Pi floor rejected" "$OK" False

echo ""
echo "$pass passed, $fail failed"