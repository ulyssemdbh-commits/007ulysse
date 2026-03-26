/**
 * CodeContextService - Code-aware context for Ulysse
 * 
 * Indexes and searches the codebase to provide relevant code context
 * during conversations. Supports file search, pattern matching, and
 * symbol detection.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface FileInfo {
  path: string;
  relativePath: string;
  size: number;
  extension: string;
  type: 'frontend' | 'backend' | 'shared' | 'config' | 'other';
  lastModified: Date;
}

interface CodeSearchResult {
  file: string;
  line: number;
  content: string;
  context: string[];
}

interface SymbolInfo {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'const' | 'export';
  file: string;
  line: number;
}

interface FileContent {
  path: string;
  content: string;
  size: number;
  language: string;
  symbols: SymbolInfo[];
}

class CodeContextService {
  private fileIndex: Map<string, FileInfo> = new Map();
  private symbolIndex: Map<string, SymbolInfo[]> = new Map();
  private lastIndexTime: Date | null = null;
  private readonly rootDir: string;
  private readonly maxFileSize = 100000; // 100KB max per file

  constructor() {
    this.rootDir = process.cwd();
  }

  /**
   * Index all code files in the project
   */
  async indexProject(): Promise<{ files: number; symbols: number }> {
    this.fileIndex.clear();
    this.symbolIndex.clear();

    const patterns = [
      'client/src/**/*.{ts,tsx,js,jsx}',
      'server/**/*.ts',
      'shared/**/*.ts',
      '*.{ts,js,json}',
      'client/*.{ts,js,json,html}'
    ];

    const ignorePatterns = [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/build/**',
      '**/*.d.ts'
    ];

    let totalSymbols = 0;

    for (const pattern of patterns) {
      try {
        const files = await glob(pattern, {
          cwd: this.rootDir,
          ignore: ignorePatterns,
          nodir: true
        });

        for (const file of files) {
          const fullPath = path.join(this.rootDir, file);
          try {
            const stats = fs.statSync(fullPath);
            
            if (stats.size > this.maxFileSize) continue;

            const fileInfo: FileInfo = {
              path: fullPath,
              relativePath: file,
              size: stats.size,
              extension: path.extname(file),
              type: this.categorizeFile(file),
              lastModified: stats.mtime
            };

            this.fileIndex.set(file, fileInfo);

            // Extract symbols from TypeScript/JavaScript files
            if (['.ts', '.tsx', '.js', '.jsx'].includes(fileInfo.extension)) {
              const symbols = await this.extractSymbols(fullPath, file);
              if (symbols.length > 0) {
                this.symbolIndex.set(file, symbols);
                totalSymbols += symbols.length;
              }
            }
          } catch (err) {
            // Skip files we can't read
          }
        }
      } catch (err) {
        console.error(`Error indexing pattern ${pattern}:`, err);
      }
    }

    this.lastIndexTime = new Date();
    return { files: this.fileIndex.size, symbols: totalSymbols };
  }

  /**
   * Search files by path pattern
   */
  searchFiles(query: string, options?: { 
    type?: FileInfo['type'];
    extension?: string;
    limit?: number;
  }): FileInfo[] {
    const results: FileInfo[] = [];
    const queryLower = query.toLowerCase();
    const limit = options?.limit || 20;

    for (const [filePath, info] of this.fileIndex) {
      if (options?.type && info.type !== options.type) continue;
      if (options?.extension && info.extension !== options.extension) continue;

      if (filePath.toLowerCase().includes(queryLower)) {
        results.push(info);
        if (results.length >= limit) break;
      }
    }

    return results.sort((a, b) => {
      // Prioritize exact matches
      const aExact = a.relativePath.toLowerCase() === queryLower;
      const bExact = b.relativePath.toLowerCase() === queryLower;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      
      // Then by path length (shorter = more specific)
      return a.relativePath.length - b.relativePath.length;
    });
  }

  /**
   * Search for content within files
   */
  async searchContent(pattern: string, options?: {
    path?: string;
    type?: FileInfo['type'];
    limit?: number;
    contextLines?: number;
  }): Promise<CodeSearchResult[]> {
    const results: CodeSearchResult[] = [];
    const limit = options?.limit || 50;
    const contextLines = options?.contextLines || 2;
    const regex = new RegExp(pattern, 'gi');

    for (const [filePath, info] of this.fileIndex) {
      if (options?.type && info.type !== options.type) continue;
      if (options?.path && !filePath.includes(options.path)) continue;

      try {
        const content = fs.readFileSync(info.path, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const contextStart = Math.max(0, i - contextLines);
            const contextEnd = Math.min(lines.length - 1, i + contextLines);
            
            results.push({
              file: filePath,
              line: i + 1,
              content: lines[i].trim(),
              context: lines.slice(contextStart, contextEnd + 1)
            });

            if (results.length >= limit) break;
          }
        }

        if (results.length >= limit) break;
      } catch (err) {
        // Skip unreadable files
      }
    }

    return results;
  }

  /**
   * Get file content with metadata
   */
  async getFile(filePath: string): Promise<FileContent | null> {
    // Normalize path
    let normalizedPath = filePath;
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = path.join(this.rootDir, filePath);
    }

    // Try relative path first
    const info = this.fileIndex.get(filePath);
    const fullPath = info?.path || normalizedPath;

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const ext = path.extname(fullPath);
      
      const symbols = await this.extractSymbols(fullPath, filePath);

      return {
        path: filePath,
        content,
        size: content.length,
        language: this.getLanguage(ext),
        symbols
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Find similar/related files
   */
  findRelatedFiles(filePath: string, limit: number = 5): FileInfo[] {
    const info = this.fileIndex.get(filePath);
    if (!info) return [];

    const baseName = path.basename(filePath, info.extension);
    const dirName = path.dirname(filePath);
    const related: FileInfo[] = [];

    // Find files in same directory
    for (const [fp, fi] of this.fileIndex) {
      if (fp === filePath) continue;
      
      const fpDir = path.dirname(fp);
      const fpBase = path.basename(fp, fi.extension);

      // Same directory
      if (fpDir === dirName) {
        related.push(fi);
        continue;
      }

      // Similar name
      if (fpBase.toLowerCase().includes(baseName.toLowerCase()) ||
          baseName.toLowerCase().includes(fpBase.toLowerCase())) {
        related.push(fi);
      }
    }

    return related.slice(0, limit);
  }

  /**
   * Search for symbols (functions, classes, etc.)
   */
  searchSymbols(query: string, options?: {
    type?: SymbolInfo['type'];
    limit?: number;
  }): SymbolInfo[] {
    const results: SymbolInfo[] = [];
    const queryLower = query.toLowerCase();
    const limit = options?.limit || 20;

    for (const [_, symbols] of this.symbolIndex) {
      for (const symbol of symbols) {
        if (options?.type && symbol.type !== options.type) continue;
        
        if (symbol.name.toLowerCase().includes(queryLower)) {
          results.push(symbol);
          if (results.length >= limit) break;
        }
      }
      if (results.length >= limit) break;
    }

    return results;
  }

  /**
   * Get project structure overview
   */
  getProjectStructure(): {
    frontend: string[];
    backend: string[];
    shared: string[];
    config: string[];
    totalFiles: number;
  } {
    const structure = {
      frontend: [] as string[],
      backend: [] as string[],
      shared: [] as string[],
      config: [] as string[],
      totalFiles: this.fileIndex.size
    };

    for (const [filePath, info] of this.fileIndex) {
      switch (info.type) {
        case 'frontend':
          structure.frontend.push(filePath);
          break;
        case 'backend':
          structure.backend.push(filePath);
          break;
        case 'shared':
          structure.shared.push(filePath);
          break;
        case 'config':
          structure.config.push(filePath);
          break;
      }
    }

    return structure;
  }

  /**
   * Generate code context for AI based on query intent
   */
  async generateCodeContext(query: string, maxTokens: number = 4000): Promise<string> {
    const lines: string[] = [];
    let estimatedTokens = 0;

    // Detect intent
    const keywords = this.extractKeywords(query);
    
    // Search for relevant files
    const relevantFiles: Set<string> = new Set();
    
    for (const keyword of keywords) {
      // Search file names
      const fileMatches = this.searchFiles(keyword, { limit: 3 });
      fileMatches.forEach(f => relevantFiles.add(f.relativePath));
      
      // Search symbols
      const symbolMatches = this.searchSymbols(keyword, { limit: 3 });
      symbolMatches.forEach(s => relevantFiles.add(s.file));
    }

    // Add file contents
    for (const filePath of relevantFiles) {
      if (estimatedTokens >= maxTokens) break;
      
      const fileContent = await this.getFile(filePath);
      if (!fileContent) continue;

      // Estimate tokens (rough: 4 chars = 1 token)
      const fileTokens = Math.ceil(fileContent.content.length / 4);
      
      if (estimatedTokens + fileTokens > maxTokens) {
        // Truncate
        const remainingChars = (maxTokens - estimatedTokens) * 4;
        lines.push(`\n--- ${filePath} (truncated) ---`);
        lines.push('```' + fileContent.language);
        lines.push(fileContent.content.slice(0, remainingChars) + '\n... [truncated]');
        lines.push('```');
        break;
      }

      lines.push(`\n--- ${filePath} ---`);
      lines.push('```' + fileContent.language);
      lines.push(fileContent.content);
      lines.push('```');
      
      estimatedTokens += fileTokens;
    }

    return lines.join('\n');
  }

  // Private methods

  private categorizeFile(filePath: string): FileInfo['type'] {
    if (filePath.startsWith('client/')) return 'frontend';
    if (filePath.startsWith('server/')) return 'backend';
    if (filePath.startsWith('shared/')) return 'shared';
    if (filePath.endsWith('.json') || filePath.endsWith('.config.ts') || 
        filePath.endsWith('.config.js') || filePath === 'tsconfig.json') {
      return 'config';
    }
    return 'other';
  }

  private getLanguage(ext: string): string {
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.json': 'json',
      '.css': 'css',
      '.html': 'html',
      '.md': 'markdown',
      '.sql': 'sql'
    };
    return langMap[ext] || 'plaintext';
  }

  private async extractSymbols(fullPath: string, relativePath: string): Promise<SymbolInfo[]> {
    const symbols: SymbolInfo[] = [];
    
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      // Simple regex-based symbol extraction
      const patterns = [
        { regex: /^export\s+(?:async\s+)?function\s+(\w+)/m, type: 'function' as const },
        { regex: /^export\s+const\s+(\w+)\s*=/m, type: 'const' as const },
        { regex: /^export\s+class\s+(\w+)/m, type: 'class' as const },
        { regex: /^export\s+interface\s+(\w+)/m, type: 'interface' as const },
        { regex: /^export\s+type\s+(\w+)/m, type: 'type' as const },
        { regex: /^(?:async\s+)?function\s+(\w+)/m, type: 'function' as const },
        { regex: /^const\s+(\w+)\s*=\s*(?:async\s*)?\(/m, type: 'function' as const },
        { regex: /^class\s+(\w+)/m, type: 'class' as const }
      ];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        for (const { regex, type } of patterns) {
          const match = line.match(regex);
          if (match) {
            symbols.push({
              name: match[1],
              type,
              file: relativePath,
              line: i + 1
            });
            break; // Only one match per line
          }
        }
      }
    } catch (err) {
      // Ignore errors
    }

    return symbols;
  }

  private extractKeywords(query: string): string[] {
    // Extract potential file/symbol names from query
    const words = query.toLowerCase().split(/\s+/);
    const keywords: string[] = [];

    const codePatterns = [
      /use[\w]+/i,       // hooks
      /[\w]+service/i,   // services
      /[\w]+controller/i,// controllers
      /[\w]+\.tsx?/i,    // file names
      /handle[\w]+/i,    // handlers
      /fetch[\w]+/i,     // fetchers
      /[\w]+api/i,       // APIs
      /[\w]+route/i      // routes
    ];

    for (const word of words) {
      // Skip common words
      if (['le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'ou', 'dans', 
           'pour', 'avec', 'sur', 'the', 'a', 'an', 'in', 'on', 'for', 'with'].includes(word)) {
        continue;
      }

      // Check if it looks like code
      for (const pattern of codePatterns) {
        if (pattern.test(word)) {
          keywords.push(word);
          break;
        }
      }

      // Include technical words
      if (word.length > 3 && /^[a-z]+$/i.test(word)) {
        keywords.push(word);
      }
    }

    return [...new Set(keywords)].slice(0, 5);
  }

  /**
   * Get indexing status
   */
  getStatus(): {
    indexed: boolean;
    fileCount: number;
    symbolCount: number;
    lastIndexTime: Date | null;
  } {
    let symbolCount = 0;
    for (const symbols of this.symbolIndex.values()) {
      symbolCount += symbols.length;
    }

    return {
      indexed: this.fileIndex.size > 0,
      fileCount: this.fileIndex.size,
      symbolCount,
      lastIndexTime: this.lastIndexTime
    };
  }
}

export const codeContextService = new CodeContextService();

// Auto-index on startup (async) - delayed to avoid memory pressure during initialization
setTimeout(() => {
  codeContextService.indexProject().then(result => {
    console.log(`[CodeContext] Indexed ${result.files} files, ${result.symbols} symbols`);
  }).catch(err => {
    console.error('[CodeContext] Failed to index:', err);
  });
}, 120000);
