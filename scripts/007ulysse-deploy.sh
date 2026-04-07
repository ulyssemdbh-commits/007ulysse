#!/bin/bash
set -e
LOG=/var/log/007ulysse-deploy.log
DIR=/var/www/apps/007ulysse
exec >> "$LOG" 2>&1
echo ""
echo "[$(date -Iseconds)] =============================="
echo "[$(date -Iseconds)] === 007ULYSSE DEPLOY START ==="
echo "[$(date -Iseconds)] =============================="
cd "$DIR"

echo "[$(date -Iseconds)] [1/6] Git fetch + merge..."
git fetch origin main 2>&1
git merge origin/main --ff-only 2>&1 || { echo "Merge failed, trying reset"; git reset --hard origin/main 2>&1; }

echo "[$(date -Iseconds)] [2/6] Full dependency setup..."
npm ci --include=dev 2>&1 | tail -20
RC=$?
if [ $RC -ne 0 ]; then
  echo "[$(date -Iseconds)]   npm ci failed (code $RC), trying npm i..."
  npm i 2>&1 | tail -20
fi

echo "[$(date -Iseconds)] [3/6] Native externals..."
npm i pdfkit fontkit restructure 2>&1 | tail -5

echo "[$(date -Iseconds)] [4/6] Build..."
NODE_OPTIONS="--max-old-space-size=3072" npx tsx script/build.ts 2>&1 | tail -20
if [ ! -f dist/index.cjs ]; then
  echo "[$(date -Iseconds)] BUILD FAILED - no dist/index.cjs"
  exit 1
fi
BUNDLE_SIZE=$(stat -c%s dist/index.cjs 2>/dev/null || echo "0")
echo "[$(date -Iseconds)]   Bundle: $(( BUNDLE_SIZE / 1024 / 1024 ))MB"

echo "[$(date -Iseconds)] [5/6] PM2 restart..."
pm2 restart 007ulysse 2>&1 | tail -3
sleep 8

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5000/api/v2/health 2>/dev/null || echo "000")
echo "[$(date -Iseconds)] [6/6] Health: HTTP $HTTP_CODE"
echo "[$(date -Iseconds)] === 007ULYSSE DEPLOY COMPLETE ==="
