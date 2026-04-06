
  import { sshService } from './server/services/sshService';

  async function main() {
    try {
      // Find the ecosystem config file
      const r = await sshService.executeCommand(
        'find /var/www -name "ecosystem.config.cjs" -maxdepth 3 2>/dev/null && echo "---" && ls -la /var/www/ulysse/ 2>/dev/null | head -5 && echo "---" && ls -la /var/www/ulysse/ecosystem.config.cjs 2>/dev/null',
        10000
      );
      console.log(r.output?.trim());
      
      // Check the main ulysse directory
      const r2 = await sshService.executeCommand(
        'pm2 show ulysse 2>/dev/null | grep -E "exec cwd|script path"',
        5000
      );
      console.log("\nUlysse PM2:", r2.output?.trim());
      
      // Get env vars directly from PM2
      const r3 = await sshService.executeCommand(
        'pm2 env 7 2>/dev/null | grep -E "^(DATABASE_URL|OPENAI_API_KEY|AI_INTEGRATIONS|SESSION_SECRET|JWT_SECRET|COOKIE_SECRET|XAI|PERPLEXITY|REDIS|GOOGLE|GITHUB|DISCORD|SPOTIFY|AGENTMAIL|HETZNER|VAPID|TELEGRAM|FINNHUB|ALPHA|ODDS|API_FOOT)" | head -30',
        5000
      );
      console.log("\nPM2 env vars:", r3.output?.trim());
    } catch (e) {
      console.error('Error:', e.message);
    }
    process.exit(0);
  }
  main();
  