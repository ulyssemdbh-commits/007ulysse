import * as fs from "fs";
import * as path from "path";

const TEMP = "/tmp/ulysse-files";
function ensureDir() { if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP, { recursive: true }); }

export const fileToolsAdvanced = {

  async convert(args: { input_path?: string; input_data?: string; from_format: string; to_format: string; file_name?: string }): Promise<string> {
    ensureDir();
    const { from_format, to_format, file_name } = args;
    const outName = file_name || `converted_${Date.now()}`;
    const outPath = path.join(TEMP, `${outName}.${to_format}`);

    let inputData = args.input_data || "";
    if (args.input_path && fs.existsSync(args.input_path)) {
      inputData = fs.readFileSync(args.input_path, "utf8");
    }
    if (!inputData) return JSON.stringify({ error: "Aucune donnée en entrée (input_path ou input_data requis)" });

    try {
      if (from_format === "csv" && to_format === "json") {
        const lines = inputData.trim().split("\n");
        const sep = inputData.includes(";") ? ";" : ",";
        const headers = lines[0].split(sep).map(h => h.trim().replace(/^["']|["']$/g, ""));
        const rows = lines.slice(1).map(line => {
          const vals = line.split(sep).map(v => v.trim().replace(/^["']|["']$/g, ""));
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
          return obj;
        });
        fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
        return JSON.stringify({ success: true, output: outPath, rows: rows.length, format: "json" });
      }

      if (from_format === "json" && to_format === "csv") {
        const data = JSON.parse(inputData);
        const arr = Array.isArray(data) ? data : [data];
        if (arr.length === 0) return JSON.stringify({ error: "JSON vide" });
        const headers = Object.keys(arr[0]);
        const csvLines = [headers.join(";")];
        for (const row of arr) {
          csvLines.push(headers.map(h => {
            const v = String(row[h] ?? "");
            return v.includes(";") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
          }).join(";"));
        }
        fs.writeFileSync(outPath, csvLines.join("\n"));
        return JSON.stringify({ success: true, output: outPath, rows: arr.length, format: "csv" });
      }

      if (from_format === "json" && to_format === "yaml") {
        const data = JSON.parse(inputData);
        const yaml = jsonToYaml(data, 0);
        fs.writeFileSync(outPath, yaml);
        return JSON.stringify({ success: true, output: outPath, format: "yaml" });
      }

      if (from_format === "yaml" && to_format === "json") {
        const data = simpleYamlParse(inputData);
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
        return JSON.stringify({ success: true, output: outPath, format: "json" });
      }

      if (to_format === "md" || to_format === "markdown") {
        let md = "";
        if (from_format === "json") {
          const data = JSON.parse(inputData);
          const arr = Array.isArray(data) ? data : [data];
          if (arr.length > 0) {
            const headers = Object.keys(arr[0]);
            md += "| " + headers.join(" | ") + " |\n";
            md += "| " + headers.map(() => "---").join(" | ") + " |\n";
            for (const row of arr) {
              md += "| " + headers.map(h => String(row[h] ?? "")).join(" | ") + " |\n";
            }
          }
        } else if (from_format === "csv") {
          const lines = inputData.trim().split("\n");
          const sep = inputData.includes(";") ? ";" : ",";
          const headers = lines[0].split(sep).map(h => h.trim());
          md += "| " + headers.join(" | ") + " |\n";
          md += "| " + headers.map(() => "---").join(" | ") + " |\n";
          for (const line of lines.slice(1)) {
            md += "| " + line.split(sep).map(v => v.trim()).join(" | ") + " |\n";
          }
        } else {
          md = inputData;
        }
        const mdPath = path.join(TEMP, `${outName}.md`);
        fs.writeFileSync(mdPath, md);
        return JSON.stringify({ success: true, output: mdPath, format: "markdown" });
      }

      if (from_format === "csv" && to_format === "xml") {
        const lines = inputData.trim().split("\n");
        const sep = inputData.includes(";") ? ";" : ",";
        const headers = lines[0].split(sep).map(h => h.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "_"));
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<data>\n';
        for (const line of lines.slice(1)) {
          const vals = line.split(sep).map(v => v.trim().replace(/^["']|["']$/g, ""));
          xml += "  <row>\n";
          headers.forEach((h, i) => { xml += `    <${h}>${escapeXml(vals[i] || "")}</${h}>\n`; });
          xml += "  </row>\n";
        }
        xml += "</data>";
        fs.writeFileSync(outPath, xml);
        return JSON.stringify({ success: true, output: outPath, format: "xml" });
      }

      if (from_format === "txt" && to_format === "json") {
        const lines = inputData.trim().split("\n").filter(l => l.trim());
        fs.writeFileSync(outPath, JSON.stringify({ lines, count: lines.length }, null, 2));
        return JSON.stringify({ success: true, output: outPath, lines: lines.length });
      }

      return JSON.stringify({ error: `Conversion ${from_format}→${to_format} non supportée. Formats: csv, json, yaml, xml, md, txt` });
    } catch (e: any) {
      return JSON.stringify({ error: e.message });
    }
  },

  async compress(args: { action: string; files?: string[]; input_path?: string; output_name?: string }): Promise<string> {
    ensureDir();
    try {
      const AdmZip = (await import("adm-zip")).default;

      if (args.action === "create" || args.action === "zip") {
        if (!args.files || args.files.length === 0) return JSON.stringify({ error: "files[] requis pour créer un ZIP" });
        const zip = new AdmZip();
        let added = 0;
        for (const f of args.files) {
          if (fs.existsSync(f)) {
            const stat = fs.statSync(f);
            if (stat.isDirectory()) {
              zip.addLocalFolder(f, path.basename(f));
            } else {
              zip.addLocalFile(f);
            }
            added++;
          }
        }
        if (added === 0) return JSON.stringify({ error: "Aucun fichier trouvé dans la liste" });
        const outPath = path.join(TEMP, `${args.output_name || "archive_" + Date.now()}.zip`);
        zip.writeZip(outPath);
        const size = fs.statSync(outPath).size;
        return JSON.stringify({ success: true, output: outPath, filesAdded: added, sizeBytes: size });
      }

      if (args.action === "extract" || args.action === "unzip") {
        if (!args.input_path || !fs.existsSync(args.input_path)) return JSON.stringify({ error: "input_path requis (chemin du ZIP)" });
        const zip = new AdmZip(args.input_path);
        const extractDir = path.join(TEMP, `extract_${Date.now()}`);
        fs.mkdirSync(extractDir, { recursive: true });
        zip.extractAllTo(extractDir, true);
        const entries = zip.getEntries().map(e => ({ name: e.entryName, size: e.header.size, dir: e.isDirectory }));
        return JSON.stringify({ success: true, extractedTo: extractDir, entries: entries.length, files: entries.slice(0, 50) });
      }

      if (args.action === "list") {
        if (!args.input_path || !fs.existsSync(args.input_path)) return JSON.stringify({ error: "input_path requis" });
        const zip = new AdmZip(args.input_path);
        const entries = zip.getEntries().map(e => ({ name: e.entryName, size: e.header.size, dir: e.isDirectory }));
        return JSON.stringify({ success: true, entries: entries.length, files: entries });
      }

      return JSON.stringify({ error: "Actions: create/zip, extract/unzip, list" });
    } catch (e: any) {
      return JSON.stringify({ error: e.message });
    }
  },

  async spreadsheetAnalyze(args: { input_path?: string; csv_data?: string; action: string; column?: string; filter?: { column: string; operator: string; value: string }; group_by?: string; sort_by?: string; sort_order?: string; limit?: number }): Promise<string> {
    try {
      let csvData = args.csv_data || "";
      if (args.input_path && fs.existsSync(args.input_path)) {
        csvData = fs.readFileSync(args.input_path, "utf8");
      }
      if (!csvData) return JSON.stringify({ error: "csv_data ou input_path requis" });

      const sep = csvData.includes(";") ? ";" : ",";
      const lines = csvData.trim().split("\n");
      const headers = lines[0].split(sep).map(h => h.trim().replace(/^["']|["']$/g, ""));
      let rows = lines.slice(1).map(line => {
        const vals = line.split(sep).map(v => v.trim().replace(/^["']|["']$/g, ""));
        const obj: Record<string, any> = {};
        headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
        return obj;
      });

      if (args.filter) {
        const { column, operator, value } = args.filter;
        rows = rows.filter(r => {
          const v = String(r[column] || "");
          const num = parseFloat(v), numVal = parseFloat(value);
          switch (operator) {
            case "=": case "==": return v === value;
            case "!=": return v !== value;
            case ">": return num > numVal;
            case "<": return num < numVal;
            case ">=": return num >= numVal;
            case "<=": return num <= numVal;
            case "contains": return v.toLowerCase().includes(value.toLowerCase());
            case "starts_with": return v.toLowerCase().startsWith(value.toLowerCase());
            default: return true;
          }
        });
      }

      if (args.action === "stats" || args.action === "summary") {
        const numericCols = headers.filter(h => {
          const vals = rows.map(r => parseFloat(r[h])).filter(v => !isNaN(v));
          return vals.length > rows.length * 0.5;
        });
        const stats: Record<string, any> = { totalRows: rows.length, columns: headers };
        for (const col of numericCols) {
          const vals = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
          if (vals.length === 0) continue;
          vals.sort((a, b) => a - b);
          stats[col] = {
            count: vals.length, sum: round2(vals.reduce((a, b) => a + b, 0)),
            avg: round2(vals.reduce((a, b) => a + b, 0) / vals.length),
            min: vals[0], max: vals[vals.length - 1],
            median: vals.length % 2 === 0 ? round2((vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : vals[Math.floor(vals.length / 2)],
          };
        }
        return JSON.stringify(stats);
      }

      if (args.action === "group" || args.action === "pivot") {
        const groupCol = args.group_by || args.column;
        if (!groupCol) return JSON.stringify({ error: "group_by requis" });
        const groups: Record<string, any[]> = {};
        for (const r of rows) {
          const key = String(r[groupCol] || "N/A");
          if (!groups[key]) groups[key] = [];
          groups[key].push(r);
        }
        const result = Object.entries(groups).map(([key, items]) => {
          const agg: Record<string, any> = { [groupCol]: key, count: items.length };
          for (const h of headers) {
            if (h === groupCol) continue;
            const nums = items.map(r => parseFloat(r[h])).filter(v => !isNaN(v));
            if (nums.length > 0) {
              agg[`${h}_sum`] = round2(nums.reduce((a, b) => a + b, 0));
              agg[`${h}_avg`] = round2(nums.reduce((a, b) => a + b, 0) / nums.length);
            }
          }
          return agg;
        });
        return JSON.stringify({ groups: result.length, data: result });
      }

      if (args.action === "filter" || args.action === "search") {
        if (args.sort_by) {
          const col = args.sort_by;
          const asc = args.sort_order !== "desc";
          rows.sort((a, b) => {
            const va = parseFloat(a[col]), vb = parseFloat(b[col]);
            if (!isNaN(va) && !isNaN(vb)) return asc ? va - vb : vb - va;
            return asc ? String(a[col]).localeCompare(String(b[col])) : String(b[col]).localeCompare(String(a[col]));
          });
        }
        const limit = args.limit || 100;
        return JSON.stringify({ total: rows.length, showing: Math.min(rows.length, limit), data: rows.slice(0, limit) });
      }

      if (args.action === "columns") {
        return JSON.stringify({ columns: headers, totalRows: rows.length });
      }

      if (args.action === "unique" || args.action === "distinct") {
        const col = args.column;
        if (!col) return JSON.stringify({ error: "column requis" });
        const values = [...new Set(rows.map(r => String(r[col] || "")))];
        return JSON.stringify({ column: col, uniqueValues: values.length, values: values.slice(0, 200) });
      }

      if (args.action === "top") {
        const col = args.column;
        if (!col) return JSON.stringify({ error: "column requis pour top" });
        const freq: Record<string, number> = {};
        for (const r of rows) { const v = String(r[col] || ""); freq[v] = (freq[v] || 0) + 1; }
        const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, args.limit || 20);
        return JSON.stringify({ column: col, top: sorted.map(([value, count]) => ({ value, count })) });
      }

      return JSON.stringify({ error: "Actions: stats, summary, filter, search, group, pivot, columns, unique, distinct, top" });
    } catch (e: any) {
      return JSON.stringify({ error: e.message });
    }
  },

  async compare(args: { file_a: string; file_b: string; mode?: string }): Promise<string> {
    try {
      if (!fs.existsSync(args.file_a)) return JSON.stringify({ error: `Fichier A introuvable: ${args.file_a}` });
      if (!fs.existsSync(args.file_b)) return JSON.stringify({ error: `Fichier B introuvable: ${args.file_b}` });

      const contentA = fs.readFileSync(args.file_a, "utf8");
      const contentB = fs.readFileSync(args.file_b, "utf8");

      if (contentA === contentB) {
        return JSON.stringify({ identical: true, message: "Les deux fichiers sont identiques" });
      }

      const linesA = contentA.split("\n");
      const linesB = contentB.split("\n");

      const diffs: { line: number; type: string; a?: string; b?: string }[] = [];
      const maxLines = Math.max(linesA.length, linesB.length);

      for (let i = 0; i < maxLines && diffs.length < 200; i++) {
        const la = linesA[i], lb = linesB[i];
        if (la === undefined && lb !== undefined) {
          diffs.push({ line: i + 1, type: "added_in_b", b: lb });
        } else if (la !== undefined && lb === undefined) {
          diffs.push({ line: i + 1, type: "removed_in_b", a: la });
        } else if (la !== lb) {
          diffs.push({ line: i + 1, type: "modified", a: la, b: lb });
        }
      }

      return JSON.stringify({
        identical: false,
        fileA: { path: args.file_a, lines: linesA.length, size: contentA.length },
        fileB: { path: args.file_b, lines: linesB.length, size: contentB.length },
        differences: diffs.length,
        diff: diffs,
      });
    } catch (e: any) {
      return JSON.stringify({ error: e.message });
    }
  },

  async qrCode(args: { data: string; type?: string; format?: string; size?: number; file_name?: string }): Promise<string> {
    ensureDir();
    try {
      const content = args.data;
      if (!content) return JSON.stringify({ error: "data requis (URL, texte, vCard...)" });

      const size = args.size || 256;
      const fileName = args.file_name || `qr_${Date.now()}`;

      const svgSize = size;
      const modules = generateQRModules(content);
      const moduleCount = modules.length;
      const cellSize = svgSize / moduleCount;

      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}">`;
      svg += `<rect width="100%" height="100%" fill="white"/>`;
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          if (modules[row][col]) {
            svg += `<rect x="${col * cellSize}" y="${row * cellSize}" width="${cellSize}" height="${cellSize}" fill="black"/>`;
          }
        }
      }
      svg += `</svg>`;

      const outPath = path.join(TEMP, `${fileName}.svg`);
      fs.writeFileSync(outPath, svg);

      return JSON.stringify({
        success: true,
        output: outPath,
        format: "svg",
        size: svgSize,
        data: content.substring(0, 100),
        modules: moduleCount,
      });
    } catch (e: any) {
      return JSON.stringify({ error: e.message });
    }
  },

  async ocrExtract(args: { imageBase64: string; mimeType?: string; language?: string }): Promise<string> {
    try {
      if (!args.imageBase64) return JSON.stringify({ error: "imageBase64 requis" });

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI();

      const mime = args.mimeType || "image/jpeg";
      const dataUrl = args.imageBase64.startsWith("data:") ? args.imageBase64 : `data:${mime};base64,${args.imageBase64}`;

      const lang = args.language || "fr";
      const resp = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `Tu es un moteur OCR de précision. Extrais TOUT le texte visible dans cette image, en respectant la mise en page originale autant que possible. Langue principale: ${lang}. Si c'est un tableau, formate-le en tableau markdown. Si c'est un document, respecte les paragraphes et titres. Retourne UNIQUEMENT le texte extrait, sans commentaire.` },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ]
        }],
      });

      const text = resp.choices[0]?.message?.content || "";
      const lines = text.split("\n").filter(l => l.trim()).length;

      return JSON.stringify({
        success: true,
        text,
        lines,
        chars: text.length,
        language: lang,
        model: "gpt-4o",
      });
    } catch (e: any) {
      return JSON.stringify({ error: e.message });
    }
  },
};

function round2(n: number): number { return Math.round(n * 100) / 100; }

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function jsonToYaml(obj: any, indent: number): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "null\n";
  if (typeof obj === "string") return obj.includes("\n") ? `|\n${obj.split("\n").map(l => pad + "  " + l).join("\n")}\n` : `${obj}\n`;
  if (typeof obj === "number" || typeof obj === "boolean") return `${obj}\n`;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]\n";
    return obj.map(item => `${pad}- ${jsonToYaml(item, indent + 1).trimStart()}`).join("");
  }
  if (typeof obj === "object") {
    const keys = Object.keys(obj);
    if (keys.length === 0) return "{}\n";
    return keys.map(k => `${pad}${k}: ${jsonToYaml(obj[k], indent + 1).trimStart()}`).join("");
  }
  return `${obj}\n`;
}

function simpleYamlParse(yaml: string): any {
  const result: Record<string, any> = {};
  for (const line of yaml.split("\n")) {
    const match = line.match(/^(\w[\w\s]*?):\s*(.+)$/);
    if (match) {
      const key = match[1].trim();
      let val: any = match[2].trim();
      if (val === "true") val = true;
      else if (val === "false") val = false;
      else if (val === "null") val = null;
      else if (!isNaN(Number(val)) && val !== "") val = Number(val);
      result[key] = val;
    }
  }
  return result;
}

function generateQRModules(data: string): boolean[][] {
  const size = data.length <= 25 ? 21 : data.length <= 47 ? 25 : data.length <= 77 ? 29 : 33;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  addFinderPattern(modules, 0, 0);
  addFinderPattern(modules, 0, size - 7);
  addFinderPattern(modules, size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    modules[6][i] = i % 2 === 0;
    modules[i][6] = i % 2 === 0;
  }

  let bitIndex = 0;
  const bits: boolean[] = [];
  for (const ch of data) {
    const code = ch.charCodeAt(0);
    for (let b = 7; b >= 0; b--) {
      bits.push(Boolean((code >> b) & 1));
    }
  }

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let row = 0; row < size; row++) {
      for (let c = 0; c < 2; c++) {
        const x = col - c;
        if (isReserved(x, row, size)) continue;
        if (bitIndex < bits.length) {
          modules[row][x] = bits[bitIndex++];
        } else {
          modules[row][x] = (row + x) % 2 === 0;
        }
      }
    }
  }

  return modules;
}

function addFinderPattern(modules: boolean[][], row: number, col: number) {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const isEdge = r === 0 || r === 6 || c === 0 || c === 6;
      const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      modules[row + r][col + c] = isEdge || isInner;
    }
  }
}

function isReserved(x: number, y: number, size: number): boolean {
  if (x < 9 && y < 9) return true;
  if (x < 9 && y >= size - 8) return true;
  if (x >= size - 8 && y < 9) return true;
  if (x === 6 || y === 6) return true;
  return false;
}
