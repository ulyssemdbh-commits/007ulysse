/**
 * Script: transform catch(error: any) → catch(error: unknown)
 * with proper .message guarding.
 *
 * Run: npx tsx scripts/fix-catch-any.ts
 */
import fs from 'fs';
import path from 'path';

const SERVER_DIR = path.resolve(import.meta.dirname, '..', 'server');

function walkTs(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules') {
            results.push(...walkTs(full));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            results.push(full);
        }
    }
    return results;
}

let totalFixed = 0;
let filesFixed = 0;

for (const filePath of walkTs(SERVER_DIR)) {
    const original = fs.readFileSync(filePath, 'utf-8');
    const lines = original.split('\n');
    let changed = false;

    for (let i = 0; i < lines.length; i++) {
        const catchMatch = lines[i].match(/catch\s*\((\w+):\s*any\)/);
        if (!catchMatch) continue;

        const varName = catchMatch[1]; // e.g. "error", "e", "err"

        // Replace any → unknown on the catch line
        lines[i] = lines[i].replace(`(${varName}: any)`, `(${varName}: unknown)`);
        changed = true;
        totalFixed++;

        // Check if .message is used in the next ~20 lines (catch block)
        let usesMessage = false;
        let blockEnd = Math.min(i + 30, lines.length - 1);
        let braceDepth = 0;
        let blockStarted = false;

        for (let j = i; j <= blockEnd; j++) {
            for (const ch of lines[j]) {
                if (ch === '{') { braceDepth++; blockStarted = true; }
                if (ch === '}') braceDepth--;
            }
            if (blockStarted && braceDepth <= 0) {
                blockEnd = j;
                break;
            }
        }

        // Check for .message, .stack, .response, .code, .status, .statusCode usage
        const msgPattern = new RegExp(`${varName}\\s*[\\.\\?]+\\s*message`, 'g');
        const stackPattern = new RegExp(`${varName}\\.stack`, 'g');
        const responsePattern = new RegExp(`${varName}\\.response`, 'g');
        const codePattern = new RegExp(`${varName}\\.code\\b`, 'g');
        const statusPattern = new RegExp(`${varName}\\.status(?:Code)?\\b`, 'g');
        const namePattern = new RegExp(`${varName}\\.name\\b`, 'g');

        for (let j = i + 1; j <= blockEnd; j++) {
            if (msgPattern.test(lines[j]) || stackPattern.test(lines[j]) || namePattern.test(lines[j])) {
                usesMessage = true;
            }
            // Reset lastIndex for global patterns
            msgPattern.lastIndex = 0;
            stackPattern.lastIndex = 0;
            namePattern.lastIndex = 0;
        }

        if (usesMessage) {
            // Find the first non-empty line after the catch line's opening brace
            let insertIdx = i;
            // If the opening brace is on the catch line itself
            if (lines[i].includes('{')) {
                insertIdx = i + 1;
            } else {
                // The brace might be on the next line
                for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
                    if (lines[j].trim() === '{' || lines[j].includes('{')) {
                        insertIdx = j + 1;
                        break;
                    }
                }
            }

            // Detect indentation of the next line
            const nextLine = lines[insertIdx] || lines[i];
            const indentMatch = nextLine.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '      ';

            // Insert the msg helper line
            const msgLine = `${indent}const msg = ${varName} instanceof Error ? ${varName}.message : String(${varName});`;
            lines.splice(insertIdx, 0, msgLine);
            blockEnd++; // Adjust for the inserted line

            // Replace error.message with msg, error?.message with msg, etc.
            for (let j = insertIdx + 1; j <= blockEnd; j++) {
                // Replace varName.message and varName?.message
                lines[j] = lines[j]
                    .replace(new RegExp(`${varName}\\?\\.message`, 'g'), 'msg')
                    .replace(new RegExp(`${varName}\\.message`, 'g'), 'msg');
                // Replace varName.stack where used
                // Keep .stack as-is for now — it's less common and harder to generalize
            }
        }
    }

    if (changed) {
        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
        filesFixed++;
    }
}

console.log(`✅ Fixed ${totalFixed} catch blocks across ${filesFixed} files`);
