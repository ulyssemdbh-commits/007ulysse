/**
 * Pass 2: Fix remaining error.message on unknown type.
 * Finds catch (X: unknown) blocks where X.message is used without a
 * `const msg = X instanceof Error ? X.message : String(X)` guard.
 *
 * Run: npx tsx scripts/fix-error-message.ts
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
    let insertionOffset = 0; // Track how many lines inserted

    for (let rawI = 0; rawI < lines.length; rawI++) {
        const i = rawI;
        const catchMatch = lines[i].match(/catch\s*\((\w+):\s*unknown\)/);
        if (!catchMatch) continue;

        const varName = catchMatch[1];

        // Already has a guard? Check if next 3 lines contain "const msg ="
        let hasGuard = false;
        for (let g = i + 1; g <= Math.min(i + 3, lines.length - 1); g++) {
            if (lines[g].includes('const msg =') || lines[g].includes('const msg=')) {
                hasGuard = true;
                break;
            }
        }
        if (hasGuard) continue;

        // Find end of catch block — only start counting AFTER the catch keyword's opening brace
        let blockEnd = Math.min(i + 30, lines.length - 1);
        let braceDepth = 0;
        let foundOpenBrace = false;

        outer:
        for (let j = i; j <= blockEnd; j++) {
            const line = lines[j];
            // On the catch line, skip everything before "catch"
            const startPos = (j === i) ? line.indexOf('catch') : 0;
            for (let c = startPos; c < line.length; c++) {
                if (line[c] === '{') {
                    if (!foundOpenBrace) {
                        foundOpenBrace = true;
                        braceDepth = 1;
                    } else {
                        braceDepth++;
                    }
                } else if (line[c] === '}' && foundOpenBrace) {
                    braceDepth--;
                    if (braceDepth <= 0) {
                        blockEnd = j;
                        break outer;
                    }
                }
            }
        }

        // Check if .message is used
        let usesMessage = false;
        const msgRe = new RegExp(`\\b${varName}\\.message\\b|\\b${varName}\\?\\.message\\b`);
        for (let j = i + 1; j <= blockEnd; j++) {
            if (msgRe.test(lines[j])) {
                usesMessage = true;
                break;
            }
        }

        if (!usesMessage) continue;

        // Find insertion point (right after the opening brace)
        let insertIdx = i + 1;
        if (!lines[i].includes('{')) {
            for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
                if (lines[j].includes('{')) {
                    insertIdx = j + 1;
                    break;
                }
            }
        }

        // Detect indentation from existing code
        const refLine = lines[insertIdx] || lines[i];
        const indentMatch = refLine.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '    ';

        // Insert the msg helper
        const msgLine = `${indent}const msg = ${varName} instanceof Error ? ${varName}.message : String(${varName});`;
        lines.splice(insertIdx, 0, msgLine);
        blockEnd++;
        totalFixed++;
        changed = true;

        // Replace error.message with msg in the catch block
        for (let j = insertIdx + 1; j <= blockEnd; j++) {
            lines[j] = lines[j]
                .replace(new RegExp(`\\b${varName}\\?\\.message\\b`, 'g'), 'msg')
                .replace(new RegExp(`\\b${varName}\\.message\\b`, 'g'), 'msg');
        }
    }

    if (changed) {
        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
        filesFixed++;
    }
}

console.log(`✅ Fixed ${totalFixed} unguarded error.message blocks across ${filesFixed} files`);
