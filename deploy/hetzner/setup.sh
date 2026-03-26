#!/bin/bash
# ==============================================
# Hetzner Server Setup for ulyssepro.org
# Reverse Proxy to Replit (ulysseproject.org)
# ==============================================
# Run this script as root on your Hetzner server:
# ssh root@65.21.209.102
# Then paste/run these commands one by one
# ==============================================

echo "=== Step 1: Update system ==="
apt update && apt upgrade -y

echo "=== Step 2: Install Nginx ==="
apt install -y nginx

echo "=== Step 3: Install Certbot for SSL ==="
apt install -y certbot python3-certbot-nginx

echo "=== Step 4: Stop any existing web server on port 80 ==="
systemctl stop nginx 2>/dev/null
# Kill anything else on port 80
fuser -k 80/tcp 2>/dev/null

echo "=== Step 5: Get SSL certificate ==="
certbot certonly --standalone -d ulyssepro.org -d www.ulyssepro.org --non-interactive --agree-tos --email YOUR_EMAIL@example.com

echo "=== Step 6: Copy Nginx config ==="
# The config file should be placed at:
# /etc/nginx/sites-available/ulyssepro.org
# (copy nginx-ulyssepro.conf to that location)

cp /root/nginx-ulyssepro.conf /etc/nginx/sites-available/ulyssepro.org

echo "=== Step 7: Enable the site ==="
ln -sf /etc/nginx/sites-available/ulyssepro.org /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

echo "=== Step 8: Test Nginx config ==="
nginx -t

echo "=== Step 9: Start Nginx ==="
systemctl start nginx
systemctl enable nginx

echo "=== Step 10: Setup auto-renewal for SSL ==="
certbot renew --dry-run

echo ""
echo "=== DONE! ==="
echo "ulyssepro.org should now forward to ulysseproject.org (Replit)"
echo "Both sites will always show the same latest version."
