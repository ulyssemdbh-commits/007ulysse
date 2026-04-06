import { sshService } from './server/services/sshService';

  async function main() {
    try {
      const cmd1 = "sudo -u postgres psql -d ulysse_db -c 'SELECT tablename FROM pg_tables WHERE tablename LIKE '\''devmax%'\'' OR tablename LIKE '\''dgm%'\'' ORDER BY tablename;' 2>/dev/null";
      const r = await sshService.executeCommand(cmd1, 10000);
      console.log("=== DevMax tables ===");
      console.log(r.output?.trim());

      const cmd2 = "sudo -u postgres psql -d ulysse_db -t -c 'SELECT column_name FROM information_schema.columns WHERE table_name = '\''devmax_project_journal'\'' ORDER BY ordinal_position;' 2>/dev/null";
      const r2 = await sshService.executeCommand(cmd2, 10000);
      console.log("\n=== devmax_project_journal cols ===");
      console.log(r2.output?.trim() || "(table does not exist)");

      const cmd3 = "sudo -u postgres psql -d ulysse_db -t -c 'SELECT column_name FROM information_schema.columns WHERE table_name = '\''devmax_activity_log'\'' ORDER BY ordinal_position;' 2>/dev/null";
      const r3 = await sshService.executeCommand(cmd3, 10000);
      console.log("\n=== devmax_activity_log cols ===");
      console.log(r3.output?.trim() || "(table does not exist)");

    } catch (e) { console.error(e.message); }
    process.exit(0);
  }
  main();
  