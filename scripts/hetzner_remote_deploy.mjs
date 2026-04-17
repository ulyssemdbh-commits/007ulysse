import { Client } from "ssh2";

const host = process.env.HETZNER_SSH_HOST;
const port = parseInt(process.env.HETZNER_SSH_PORT || "22", 10);
const username = process.env.HETZNER_SSH_USER;
const password = process.env.HETZNER_SSH_PASSWORD || process.env.HETZNER_SSH_KEY;
const mode = process.argv[2] || "kick"; // 'kick' | 'tail' | 'status'

if (!host || !username || !password) {
  console.error("Missing HETZNER_SSH_* env vars");
  process.exit(1);
}

const CMD_KICK = `pgrep -f hetzner_deploy.sh && echo "ALREADY RUNNING" || (nohup bash /var/www/ulysse/scripts/hetzner_deploy.sh > /dev/null 2>&1 & echo "DEPLOY PID=$!")`;
const CMD_TAIL = `tail -n 80 /var/log/ulysse-deploy.log; echo "---"; pgrep -f hetzner_deploy.sh && echo "STATE: RUNNING" || echo "STATE: DONE"`;
const CMD_STATUS = `cd /var/www/ulysse && git log --oneline -1 && echo "---" && pm2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const u=j.find(x=>x.name==='ulysse');console.log('pm2:',u?.pm2_env?.status,'uptime:',u?.pm2_env?.pm_uptime?new Date(u.pm2_env.pm_uptime).toISOString():'?')})" && echo "---" && curl -s -o /dev/null -w "health: %{http_code}\\n" http://127.0.0.1:5000/api/v2/health`;

const cmd = mode === "tail" ? CMD_TAIL : mode === "status" ? CMD_STATUS : CMD_KICK;

const conn = new Client();
conn
  .on("ready", () => {
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) { console.error(err); conn.end(); process.exit(1); }
      stream
        .on("close", (code) => { conn.end(); process.exit(code ?? 0); })
        .on("data", (d) => process.stdout.write(d.toString()))
        .stderr.on("data", (d) => process.stderr.write(d.toString()));
    });
  })
  .on("error", (err) => { console.error("SSH error:", err.message); process.exit(1); })
  .connect({ host, port, username, password, readyTimeout: 20000 });
