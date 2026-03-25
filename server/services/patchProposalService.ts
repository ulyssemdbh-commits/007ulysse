import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db';
import { patchProposals, InsertPatchProposal, PatchProposal } from '@shared/schema';
import { eq, desc, and } from 'drizzle-orm';
import * as diff from 'diff';

interface FileChange {
  path: string;
  action: 'add' | 'modify' | 'delete';
  oldContent?: string;
  newContent?: string;
}

interface PatchFile {
  path: string;
  action: 'add' | 'modify' | 'delete';
  additions: number;
  deletions: number;
}

class PatchProposalService {
  async createPatch(
    userId: number,
    title: string,
    description: string,
    changes: FileChange[]
  ): Promise<PatchProposal> {
    const unifiedDiff = this.generateUnifiedDiff(changes);
    const files = this.calculateFileStats(changes);
    const changelog = this.generateChangelog(changes);

    const [patch] = await db.insert(patchProposals).values({
      userId,
      title,
      description,
      diff: unifiedDiff,
      files,
      changelog,
      status: 'pending'
    }).returning();

    console.log(`[PatchProposal] Created patch #${patch.id}: ${title}`);
    return patch;
  }

  private generateUnifiedDiff(changes: FileChange[]): string {
    let unifiedDiff = '';

    for (const change of changes) {
      switch (change.action) {
        case 'add':
          unifiedDiff += `diff --git a/${change.path} b/${change.path}\n`;
          unifiedDiff += `new file mode 100644\n`;
          unifiedDiff += `--- /dev/null\n`;
          unifiedDiff += `+++ b/${change.path}\n`;
          if (change.newContent) {
            const lines = change.newContent.split('\n');
            unifiedDiff += `@@ -0,0 +1,${lines.length} @@\n`;
            for (const line of lines) {
              unifiedDiff += `+${line}\n`;
            }
          }
          break;

        case 'delete':
          unifiedDiff += `diff --git a/${change.path} b/${change.path}\n`;
          unifiedDiff += `deleted file mode 100644\n`;
          unifiedDiff += `--- a/${change.path}\n`;
          unifiedDiff += `+++ /dev/null\n`;
          if (change.oldContent) {
            const lines = change.oldContent.split('\n');
            unifiedDiff += `@@ -1,${lines.length} +0,0 @@\n`;
            for (const line of lines) {
              unifiedDiff += `-${line}\n`;
            }
          }
          break;

        case 'modify':
          if (change.oldContent && change.newContent) {
            const patch = diff.createPatch(
              change.path,
              change.oldContent,
              change.newContent,
              'original',
              'modified'
            );
            unifiedDiff += patch;
          }
          break;
      }
    }

    return unifiedDiff;
  }

  private calculateFileStats(changes: FileChange[]): PatchFile[] {
    return changes.map(change => {
      let additions = 0;
      let deletions = 0;

      if (change.action === 'add' && change.newContent) {
        additions = change.newContent.split('\n').length;
      } else if (change.action === 'delete' && change.oldContent) {
        deletions = change.oldContent.split('\n').length;
      } else if (change.action === 'modify' && change.oldContent && change.newContent) {
        const differences = diff.diffLines(change.oldContent, change.newContent);
        for (const part of differences) {
          if (part.added) {
            additions += part.count || 1;
          } else if (part.removed) {
            deletions += part.count || 1;
          }
        }
      }

      return {
        path: change.path,
        action: change.action,
        additions,
        deletions
      };
    });
  }

  private generateChangelog(changes: FileChange[]): string {
    let changelog = `## Changes\n\n`;
    
    const added = changes.filter(c => c.action === 'add');
    const modified = changes.filter(c => c.action === 'modify');
    const deleted = changes.filter(c => c.action === 'delete');

    if (added.length > 0) {
      changelog += `### Added\n`;
      for (const f of added) {
        changelog += `- \`${f.path}\`\n`;
      }
      changelog += '\n';
    }

    if (modified.length > 0) {
      changelog += `### Modified\n`;
      for (const f of modified) {
        changelog += `- \`${f.path}\`\n`;
      }
      changelog += '\n';
    }

    if (deleted.length > 0) {
      changelog += `### Deleted\n`;
      for (const f of deleted) {
        changelog += `- \`${f.path}\`\n`;
      }
      changelog += '\n';
    }

    return changelog;
  }

  async applyPatch(patchId: number): Promise<{ success: boolean; errors: string[] }> {
    const [patch] = await db.select()
      .from(patchProposals)
      .where(eq(patchProposals.id, patchId))
      .limit(1);

    if (!patch) {
      return { success: false, errors: ['Patch not found'] };
    }

    if (patch.status !== 'pending') {
      return { success: false, errors: [`Patch is already ${patch.status}`] };
    }

    const errors: string[] = [];
    const files = patch.files as PatchFile[];

    for (const file of files) {
      try {
        switch (file.action) {
          case 'add':
          case 'modify': {
            const newContent = this.extractNewContent(patch.diff, file.path);
            if (newContent) {
              const dir = path.dirname(file.path);
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
              }
              fs.writeFileSync(file.path, newContent);
            }
            break;
          }

          case 'delete':
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
            break;
        }
      } catch (err) {
        errors.push(`Failed to apply ${file.action} to ${file.path}: ${err}`);
      }
    }

    await db.update(patchProposals)
      .set({
        status: errors.length === 0 ? 'applied' : 'pending',
        appliedAt: errors.length === 0 ? new Date() : null
      })
      .where(eq(patchProposals.id, patchId));

    if (errors.length === 0) {
      console.log(`[PatchProposal] Applied patch #${patchId}`);
    } else {
      console.error(`[PatchProposal] Errors applying patch #${patchId}:`, errors);
    }

    return { success: errors.length === 0, errors };
  }

  private extractNewContent(diffText: string, filePath: string): string | null {
    const fileRegex = new RegExp(`diff --git a/${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} b/${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)(?=diff --git|$)`);
    const match = diffText.match(fileRegex);
    
    if (!match) return null;

    const patchContent = match[1];
    const lines = patchContent.split('\n');
    const newLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        newLines.push(line.slice(1));
      } else if (!line.startsWith('-') && !line.startsWith('@@') && !line.startsWith('diff') && !line.startsWith('index') && !line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('new file') && !line.startsWith('deleted')) {
        newLines.push(line);
      }
    }

    return newLines.join('\n');
  }

  async rejectPatch(patchId: number, reason?: string): Promise<PatchProposal> {
    const [updated] = await db.update(patchProposals)
      .set({
        status: 'rejected',
        changelog: reason ? `## Rejected\n${reason}` : undefined
      })
      .where(eq(patchProposals.id, patchId))
      .returning();

    console.log(`[PatchProposal] Rejected patch #${patchId}`);
    return updated;
  }

  async getPendingPatches(userId: number): Promise<PatchProposal[]> {
    return db.select()
      .from(patchProposals)
      .where(and(
        eq(patchProposals.userId, userId),
        eq(patchProposals.status, 'pending')
      ))
      .orderBy(desc(patchProposals.createdAt));
  }

  async getRecentPatches(userId: number, limit: number = 20): Promise<PatchProposal[]> {
    return db.select()
      .from(patchProposals)
      .where(eq(patchProposals.userId, userId))
      .orderBy(desc(patchProposals.createdAt))
      .limit(limit);
  }

  getPatchSummaryForPrompt(patches: PatchProposal[]): string {
    if (patches.length === 0) return 'Aucun patch en attente.';

    const pending = patches.filter(p => p.status === 'pending');
    const applied = patches.filter(p => p.status === 'applied');
    const rejected = patches.filter(p => p.status === 'rejected');

    let text = `Patches: ${pending.length} en attente, ${applied.length} appliqués, ${rejected.length} rejetés\n`;

    if (pending.length > 0) {
      text += `\nEn attente:\n`;
      for (const p of pending.slice(0, 5)) {
        const files = p.files as PatchFile[];
        const totalChanges = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
        text += `  - #${p.id}: ${p.title} (${files.length} fichiers, ${totalChanges} lignes)\n`;
      }
    }

    return text;
  }

  async previewPatch(changes: FileChange[]): Promise<string> {
    return this.generateUnifiedDiff(changes);
  }
}

export const patchProposalService = new PatchProposalService();
