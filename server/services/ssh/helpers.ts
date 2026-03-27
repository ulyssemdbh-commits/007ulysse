import * as fs from "fs";

export const SSH_HOST = process.env.HETZNER_SSH_HOST || "65.21.209.102";
export const SSH_PORT = parseInt(process.env.HETZNER_SSH_PORT || "22");
export const SSH_USER = process.env.HETZNER_SSH_USER || "root";
export const SSH_PASSWORD = process.env.HETZNER_SSH_PASSWORD || "";
export const isLocalServer = fs.existsSync("/etc/nginx/sites-available");
export const MAX_RETRIES = 2;
export const RETRY_DELAY = 1000;

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function normalizeNginxName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function resolveAppDomain(appName: string, customDomain?: string): string {
  if (customDomain) return customDomain;
  return `${appName}.ulyssepro.org`;
}

export const ORIGIN_CERT = "/etc/ssl/certs/ulysse.crt";
export const ORIGIN_KEY = "/etc/ssl/private/ulysse.key";

export function sslCertForDomain(_domain: string): { cert: string; key: string } {
  return { cert: ORIGIN_CERT, key: ORIGIN_KEY };
}

export const ULYSSE_FRAME_ANCESTORS = "'self' https://ulysseproject.org https://*.ulysseproject.org https://ulyssepro.org https://*.ulyssepro.org";

export function securityHeaders(opts?: { allowIframe?: boolean }): string {
  const framePolicy = opts?.allowIframe
    ? `add_header Content-Security-Policy "frame-ancestors ${ULYSSE_FRAME_ANCESTORS}" always;`
    : `add_header X-Frame-Options "SAMEORIGIN" always;`;
  return [
    `add_header X-Content-Type-Options "nosniff" always;`,
    framePolicy,
    `add_header X-XSS-Protection "1; mode=block" always;`,
    `add_header Referrer-Policy "strict-origin-when-cross-origin" always;`,
  ].join("\n    ");
}

export function securityHeadersSSL(opts?: { allowIframe?: boolean }): string {
  return [
    securityHeaders(opts),
    `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`,
  ].join("\n    ");
}

export function nginxCleanupCmd(appName: string): string {
  const normalized = normalizeNginxName(appName);
  const variants = new Set([appName, normalized, appName.toLowerCase()]);
  if (appName[0]) {
    variants.add(appName[0].toUpperCase() + appName.slice(1));
    variants.add(appName[0].toLowerCase() + appName.slice(1));
  }
  const rmParts = Array.from(variants).map(v =>
    `rm -f /etc/nginx/sites-enabled/${v} /etc/nginx/sites-available/${v}`
  ).join(" && ");
  return rmParts;
}

export function staticNginxBlock(domain: string, rootDir: string, appName?: string): string {
  const ssl = sslCertForDomain(domain);
  const logName = appName ? normalizeNginxName(appName) : domain.replace(/\./g, "_");
  return `server {
    listen 80;
    server_name ${domain};
    root ${rootDir};
    index index.html;

    access_log /var/log/nginx/${logName}.access.log;
    error_log /var/log/nginx/${logName}.error.log;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 4;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss image/svg+xml application/wasm font/woff font/woff2;
    gzip_min_length 256;

    location ~ /\\. { deny all; return 404; }
    location ~* \\.(env|gitignore|DS_Store|htaccess|htpasswd|log|bak|sql|conf|ini|yml|yaml|toml|lock|ts|tsx|jsx)\$ { deny all; return 404; }
    location ~* \\.(map)\$ { deny all; return 404; }
    location / { try_files \$uri \$uri/ /index.html =404; }
    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot|webp|avif)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header Access-Control-Allow-Origin "*";
    }

    ${securityHeaders({ allowIframe: true })}
}

server {
    listen 443 ssl http2;
    server_name ${domain};

    ssl_certificate ${ssl.cert};
    ssl_certificate_key ${ssl.key};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    root ${rootDir};
    index index.html;

    access_log /var/log/nginx/${logName}.access.log;
    error_log /var/log/nginx/${logName}.error.log;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 4;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss image/svg+xml application/wasm font/woff font/woff2;
    gzip_min_length 256;

    location ~ /\\. { deny all; return 404; }
    location ~* \\.(env|gitignore|DS_Store|htaccess|htpasswd|log|bak|sql|conf|ini|yml|yaml|toml|lock|ts|tsx|jsx)\$ { deny all; return 404; }
    location ~* \\.(map)\$ { deny all; return 404; }
    location / { try_files \$uri \$uri/ /index.html =404; }
    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot|webp|avif)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header Access-Control-Allow-Origin "*";
    }

    ${securityHeadersSSL({ allowIframe: true })}
}`;
}

export function proxyNginxBlock(domain: string, appName: string, port: number): string {
  const ssl = sslCertForDomain(domain);
  const upstream = normalizeNginxName(appName).replace(/-/g, "_");
  const logName = normalizeNginxName(appName);
  const startingPage = `'<!DOCTYPE html><html><head><title>${appName} - Starting</title><meta http-equiv="refresh" content="5"><style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}div{text-align:center}h1{font-size:2rem;margin-bottom:1rem}.spinner{width:40px;height:40px;border:3px solid #333;border-top:3px solid #10b981;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div><div class="spinner"></div><h1>${appName}</h1><p>Application is starting up... auto-refreshing in 5s</p></div></body></html>'`;
  const proxyBlock = `
        proxy_pass http://${upstream}_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\$scheme;
        proxy_cache_bypass \\$http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 300s;
        proxy_next_upstream error timeout http_502 http_503;
        proxy_next_upstream_tries 2;
        proxy_next_upstream_timeout 30s;`;
  return `upstream ${upstream}_backend {
    server 127.0.0.1:${port} max_fails=3 fail_timeout=30s;
    keepalive 8;
}

server {
    listen 80;
    server_name ${domain};
    client_max_body_size 50M;

    access_log /var/log/nginx/${logName}.access.log;
    error_log /var/log/nginx/${logName}.error.log;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 4;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss image/svg+xml application/wasm;
    gzip_min_length 256;

    proxy_intercept_errors on;
    error_page 502 503 504 /502.html;
    location = /502.html {
        default_type text/html;
        return 502 ${startingPage};
    }

    location / {${proxyBlock}
    }

    ${securityHeaders({ allowIframe: true })}
}

server {
    listen 443 ssl http2;
    server_name ${domain};

    ssl_certificate ${ssl.cert};
    ssl_certificate_key ${ssl.key};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    client_max_body_size 50M;

    access_log /var/log/nginx/${logName}.access.log;
    error_log /var/log/nginx/${logName}.error.log;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 4;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss image/svg+xml application/wasm;
    gzip_min_length 256;

    proxy_intercept_errors on;
    error_page 502 503 504 /502.html;
    location = /502.html {
        default_type text/html;
        return 502 ${startingPage};
    }

    location / {${proxyBlock}
    }

    ${securityHeadersSSL({ allowIframe: true })}
}`;
}

export function pm2EcosystemConfig(appName: string, appDir: string, envVars: Record<string, string>): string {
  return `module.exports = {
  apps: [{
    name: '${appName}',
    script: 'npm',
    args: 'start',
    cwd: '${appDir}',
    max_memory_restart: '512M',
    restart_delay: 3000,
    max_restarts: 10,
    min_uptime: '10s',
    env: ${JSON.stringify(envVars, null, 6)}
  }]
};`;
}
