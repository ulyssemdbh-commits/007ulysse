const { Storage } = require("@google-cloud/storage");
const fs = require("fs");
const path = require("path");

async function main() {
  const lines = fs.readFileSync("/tmp/sugu_files_list.txt", "utf8").trim().split("\n").filter(Boolean);
  console.log(`Files to download: ${lines.length}`);
  
  const client = new Storage({
    apiEndpoint: `http://${process.env.REPLIT_CONNECTORS_HOSTNAME}:8787`,
  });

  const exportDir = "/tmp/sugu_files_export";
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  let success = 0, failed = 0;
  const manifest = [];
  const errors = [];

  for (const line of lines) {
    const [idStr, storagePath, fileName] = line.split("|");
    const id = parseInt(idStr);
    try {
      const sp = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;
      const parts = sp.split("/");
      const bucketName = parts[0];
      const objectName = parts.slice(1).join("/");
      
      const [contents] = await client.bucket(bucketName).file(objectName).download();
      
      const safeName = `${id}_${fileName}`;
      fs.writeFileSync(path.join(exportDir, safeName), contents);
      manifest.push({ id, fileName, storagePath, exportedAs: safeName, size: contents.length });
      success++;
      if (success % 25 === 0) console.log(`  ${success}/${lines.length} downloaded...`);
    } catch (e) {
      failed++;
      errors.push(`#${id} ${fileName}: ${e.message?.substring(0, 60)}`);
    }
  }

  fs.writeFileSync(path.join(exportDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nDone: ${success} ok, ${failed} failed`);
  if (errors.length > 0) console.log("Errors:", errors.slice(0, 5).join("\n"));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
