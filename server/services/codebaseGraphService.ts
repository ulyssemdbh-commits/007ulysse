import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db';
import { codebaseGraphs, InsertCodebaseGraph, CodebaseGraph } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';

interface FileNode {
  path: string;
  imports: Array<{ from: string; names: string[] }>;
  exports: string[];
  dependencies: string[];
}

interface CodebaseGraphData {
  files: FileNode[];
  modules: Record<string, string[]>;
  entryPoints: string[];
}

interface GraphStats {
  totalFiles: number;
  totalImports: number;
  totalExports: number;
  scanDurationMs: number;
}

class CodebaseGraphService {
  private excludeDirs = ['node_modules', '.git', 'dist', 'build', '.replit', '.cache', 'coverage'];
  private includeExtensions = ['.ts', '.tsx', '.js', '.jsx'];

  async scanCodebase(userId: number, rootDir: string = '.'): Promise<CodebaseGraph> {
    const startTime = Date.now();
    const files: FileNode[] = [];
    const modules: Record<string, string[]> = {};

    await this.walkDirectory(rootDir, files);

    for (const file of files) {
      const moduleName = this.getModuleName(file.path);
      if (!modules[moduleName]) {
        modules[moduleName] = [];
      }
      modules[moduleName].push(file.path);
    }

    const entryPoints = this.findEntryPoints(files);
    
    const graph: CodebaseGraphData = {
      files,
      modules,
      entryPoints
    };

    const stats: GraphStats = {
      totalFiles: files.length,
      totalImports: files.reduce((sum, f) => sum + f.imports.length, 0),
      totalExports: files.reduce((sum, f) => sum + f.exports.length, 0),
      scanDurationMs: Date.now() - startTime
    };

    const snapshotId = `scan-${Date.now()}`;
    
    const [result] = await db.insert(codebaseGraphs).values({
      userId,
      snapshotId,
      graph,
      stats
    }).returning();

    console.log(`[CodebaseGraph] Scanned ${stats.totalFiles} files in ${stats.scanDurationMs}ms`);
    return result;
  }

  private async walkDirectory(dir: string, files: FileNode[]): Promise<void> {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (!this.excludeDirs.includes(entry.name)) {
            await this.walkDirectory(fullPath, files);
          }
        } else if (entry.isFile() && this.includeExtensions.some(ext => entry.name.endsWith(ext))) {
          const fileNode = this.parseFile(fullPath);
          if (fileNode) {
            files.push(fileNode);
          }
        }
      }
    } catch (err) {
      console.error(`[CodebaseGraph] Error scanning ${dir}:`, err);
    }
  }

  private parseFile(filePath: string): FileNode | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const imports = this.extractImports(content);
      const exports = this.extractExports(content);
      const dependencies = imports.map(i => i.from).filter(f => !f.startsWith('.'));

      return {
        path: filePath,
        imports,
        exports,
        dependencies
      };
    } catch (err) {
      return null;
    }
  }

  private extractImports(content: string): Array<{ from: string; names: string[] }> {
    const imports: Array<{ from: string; names: string[] }> = [];
    
    const importRegex = /import\s+(?:(?:\{([^}]*)\}|\*\s+as\s+(\w+)|(\w+))(?:\s*,\s*(?:\{([^}]*)\}|\*\s+as\s+(\w+)|(\w+)))?\s+from\s+)?['"]([^'"]+)['"]/g;
    
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const names: string[] = [];
      
      if (match[1]) names.push(...match[1].split(',').map(n => n.trim().split(' as ')[0].trim()).filter(Boolean));
      if (match[2]) names.push(match[2]);
      if (match[3]) names.push(match[3]);
      if (match[4]) names.push(...match[4].split(',').map(n => n.trim().split(' as ')[0].trim()).filter(Boolean));
      if (match[5]) names.push(match[5]);
      if (match[6]) names.push(match[6]);
      
      imports.push({
        from: match[7],
        names
      });
    }

    const requireRegex = /(?:const|let|var)\s+(?:\{([^}]*)\}|(\w+))\s*=\s*require\(['"]([^'"]+)['"]\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      const names: string[] = [];
      if (match[1]) names.push(...match[1].split(',').map(n => n.trim()).filter(Boolean));
      if (match[2]) names.push(match[2]);
      
      imports.push({
        from: match[3],
        names
      });
    }

    return imports;
  }

  private extractExports(content: string): string[] {
    const exports: string[] = [];
    
    const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
    let match;
    while ((match = namedExportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }

    const exportListRegex = /export\s*\{([^}]+)\}/g;
    while ((match = exportListRegex.exec(content)) !== null) {
      exports.push(...match[1].split(',').map(n => n.trim().split(' as ')[0].trim()).filter(Boolean));
    }

    if (/export\s+default/.test(content)) {
      exports.push('default');
    }

    return exports;
  }

  private getModuleName(filePath: string): string {
    const parts = filePath.split('/');
    if (parts.includes('client')) return 'client';
    if (parts.includes('server')) return 'server';
    if (parts.includes('shared')) return 'shared';
    return 'root';
  }

  private findEntryPoints(files: FileNode[]): string[] {
    return files
      .filter(f => 
        f.path.includes('index.') || 
        f.path.includes('main.') || 
        f.path.includes('App.')
      )
      .map(f => f.path);
  }

  async getLatestGraph(userId: number): Promise<CodebaseGraph | null> {
    const [graph] = await db
      .select()
      .from(codebaseGraphs)
      .where(eq(codebaseGraphs.userId, userId))
      .orderBy(desc(codebaseGraphs.createdAt))
      .limit(1);
    
    return graph || null;
  }

  async getFileUsage(userId: number, filePath: string): Promise<{
    importedBy: string[];
    imports: string[];
    exports: string[];
  }> {
    const graph = await this.getLatestGraph(userId);
    if (!graph) {
      return { importedBy: [], imports: [], exports: [] };
    }

    const graphData = graph.graph as CodebaseGraphData;
    const file = graphData.files.find(f => f.path === filePath);
    
    if (!file) {
      return { importedBy: [], imports: [], exports: [] };
    }

    const importedBy = graphData.files
      .filter(f => f.imports.some(i => i.from.includes(filePath.replace(/\.[^/.]+$/, ''))))
      .map(f => f.path);

    return {
      importedBy,
      imports: file.imports.map(i => i.from),
      exports: file.exports
    };
  }

  async getDependencyTree(userId: number, filePath: string, depth: number = 3): Promise<Record<string, string[]>> {
    const graph = await this.getLatestGraph(userId);
    if (!graph) return {};

    const graphData = graph.graph as CodebaseGraphData;
    const tree: Record<string, string[]> = {};
    
    const visited = new Set<string>();
    const queue: Array<{ path: string; level: number }> = [{ path: filePath, level: 0 }];

    while (queue.length > 0) {
      const { path: currentPath, level } = queue.shift()!;
      
      if (visited.has(currentPath) || level >= depth) continue;
      visited.add(currentPath);

      const file = graphData.files.find(f => f.path === currentPath);
      if (!file) continue;

      tree[currentPath] = file.imports.map(i => i.from);
      
      for (const imp of file.imports) {
        if (imp.from.startsWith('.')) {
          const resolvedPath = this.resolvePath(currentPath, imp.from);
          const matchedFile = graphData.files.find(f => 
            f.path === resolvedPath || 
            f.path === resolvedPath + '.ts' || 
            f.path === resolvedPath + '.tsx'
          );
          if (matchedFile) {
            queue.push({ path: matchedFile.path, level: level + 1 });
          }
        }
      }
    }

    return tree;
  }

  private resolvePath(from: string, to: string): string {
    const fromDir = path.dirname(from);
    return path.join(fromDir, to);
  }
}

export const codebaseGraphService = new CodebaseGraphService();
