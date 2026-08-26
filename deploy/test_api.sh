#!/bin/bash
set -e
BASE="https://hris.agentlab.my.id"

echo "=== login ==="
curl -s -c /tmp/cj.txt -X POST "$BASE/api/auth/login/" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@feraco.id","password":"password"}' \
  -o /tmp/resp.json -w "STATUS=%{http_code}\n"
echo "--- body ---"
cat /tmp/resp.json
echo ""

echo "=== me (session) ==="
curl -s -b /tmp/cj.txt "$BASE/api/auth/me/" -w "\nME_STATUS=%{http_code}\n"
echo ""

echo "=== employees (auth) ==="
curl -s -b /tmp/cj.txt "$BASE/api/employees/" -w "\nEMP_STATUS=%{http_code}\n" | head -c 400
echo ""
