import { Client } from "ssh2";
import { readFileSync } from "fs";

const cmdArg = process.argv[2];
if (!cmdArg) { console.error("usage: ssh_run.mjs <cmd | @file>"); process.exit(1); }
const cmd = cmdArg.startsWith("@") ? readFileSync(cmdArg.slice(1), "utf8") : cmdArg;

new Client().on("ready", function() {
  this.exec(cmd, { pty: true }, (err, stream) => {
    if (err) { console.error(err); process.exit(1); }
    stream.on("close", code => process.exit(code ?? 0))
      .on("data", d => process.stdout.write(d.toString()))
      .stderr.on("data", d => process.stderr.write(d.toString()));
  });
}).on("error", e => { console.error("SSH:", e.message); process.exit(1); }).connect({
  host: process.env.HETZNER_SSH_HOST,
  port: parseInt(process.env.HETZNER_SSH_PORT||"22",10),
  username: process.env.HETZNER_SSH_USER,
  password: process.env.HETZNER_SSH_PASSWORD || process.env.HETZNER_SSH_KEY,
  readyTimeout: 30000,
});
