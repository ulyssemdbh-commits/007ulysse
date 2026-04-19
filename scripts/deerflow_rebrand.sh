#!/bin/bash
set -e
cd /var/www/apps/deerflow/frontend

STAMP=$(date +%Y%m%d_%H%M%S)
BK=/var/www/apps/deerflow/.rebrand_backup_${STAMP}
mkdir -p "$BK/src/app" "$BK/src/components/landing" "$BK/src/components/workspace" "$BK/src/styles" "$BK/public/images"

echo "===== [1/6] Backup ====="
cp src/app/layout.tsx                          "$BK/src/app/"
cp src/components/landing/header.tsx           "$BK/src/components/landing/"
cp src/components/landing/footer.tsx           "$BK/src/components/landing/"
cp src/components/workspace/workspace-header.tsx "$BK/src/components/workspace/"
cp src/styles/globals.css                      "$BK/src/styles/"
cp public/images/deer.svg                      "$BK/public/images/" 2>/dev/null || true
cp public/favicon.ico                          "$BK/public/" 2>/dev/null || true
echo "Backup: $BK"

echo "===== [2/6] Metadata + page title ====="
sed -i 's|title: "DeerFlow"|title: "Ulysse Research"|' src/app/layout.tsx
sed -i 's|description: "A LangChain-based framework for building super agents."|description: "Moteur de recherche profonde — Ulysse Pro"|' src/app/layout.tsx

echo "===== [3/6] Headers (landing + workspace) ====="
sed -i 's|<h1 className="font-serif text-xl">DeerFlow</h1>|<h1 className="font-serif text-xl">Ulysse Research</h1>|' src/components/landing/header.tsx
# workspace-header has 2 occurrences (lines 41,45) — replace all
sed -i 's|>DeerFlow<|>Ulysse Research<|g' src/components/workspace/workspace-header.tsx

echo "===== [4/6] Footer copyright ====="
sed -i 's|&copy; {year} DeerFlow|\&copy; {year} Ulysse Pro|' src/components/landing/footer.tsx
sed -i 's|"Originated from Open Source, give back to Open Source."|"Recherche profonde au service de Maurice."|' src/components/landing/footer.tsx

echo "===== [5/6] Palette Ulysse (cyan/bleu) ====="
# light mode primary (was black) → Ulysse cyan
sed -i 's|--primary: oklch(0 0 0);|--primary: oklch(0.62 0.19 232);|' src/styles/globals.css
# accent
sed -i 's|--accent: oklch(0.94 0.0098 87.47);|--accent: oklch(0.92 0.05 230);|' src/styles/globals.css

echo "===== [6a/6] Logo Ulysse SVG ====="
cat > public/images/ulysse-logo.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <defs>
    <radialGradient id="g" cx="0.5" cy="0.4" r="0.6">
      <stop offset="0%" stop-color="#7dd3fc"/>
      <stop offset="60%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1e3a8a"/>
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="28" fill="url(#g)"/>
  <text x="32" y="42" text-anchor="middle" font-family="Georgia,serif" font-size="30" font-weight="700" fill="#fff">U</text>
</svg>
SVG
# remplace deer.svg par lien symbolique vers le nouveau logo
cp public/images/ulysse-logo.svg public/images/deer.svg

echo "===== [6b/6] Vérification diff ====="
echo "--- layout.tsx ---"
grep -nE "title:|description:" src/app/layout.tsx | head -3
echo "--- landing header ---"
grep -nE "Ulysse|DeerFlow" src/components/landing/header.tsx | head -3
echo "--- workspace header ---"
grep -nE "Ulysse|DeerFlow" src/components/workspace/workspace-header.tsx | head -3
echo "--- footer ---"
grep -nE "Ulysse|DeerFlow" src/components/landing/footer.tsx | head -3
echo "--- palette ---"
grep -nE "primary:|accent:" src/styles/globals.css | head -4

echo ""
echo "===== Build Next.js ====="
cd /var/www/apps/deerflow/frontend
pnpm build 2>&1 | tail -20

echo ""
echo "===== Restart pm2 deerflow ====="
pm2 restart deerflow --update-env
sleep 3
pm2 status deerflow

echo ""
echo "===== Smoke test ====="
sleep 2
curl -s -o /dev/null -w "HTTP: %{http_code}\n" https://deerflow.ulyssepro.org/
echo "--- title in HTML ---"
curl -s https://deerflow.ulyssepro.org/ | grep -oE "<title>[^<]+</title>" | head -1
echo ""
echo "✅ Rebrand terminé. Rollback : cp -r $BK/* /var/www/apps/deerflow/frontend/ && pnpm build && pm2 restart deerflow"
