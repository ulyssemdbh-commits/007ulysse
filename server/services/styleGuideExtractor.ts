import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db';
import { styleGuides, InsertStyleGuide, StyleGuide } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';

interface StyleRule {
  category: string;
  rule: string;
  examples: string[];
  confidence: number;
}

interface StyleAnalysis {
  frameworks: string[];
  conventions: Record<string, string>;
  patterns: string[];
  antiPatterns: string[];
}

class StyleGuideExtractor {
  private excludeDirs = ['node_modules', '.git', 'dist', 'build', '.replit', '.cache', 'coverage'];

  async extractStyleGuide(userId: number, rootDir: string = '.'): Promise<StyleGuide> {
    const rules: StyleRule[] = [];
    const analysis: StyleAnalysis = {
      frameworks: [],
      conventions: {},
      patterns: [],
      antiPatterns: []
    };

    await this.analyzePackageJson(rootDir, analysis);
    await this.analyzeTypeScriptConfig(rootDir, analysis, rules);
    await this.analyzeCodePatterns(rootDir, rules, analysis);
    await this.analyzeNamingConventions(rootDir, rules);
    await this.analyzeImportPatterns(rootDir, rules);

    const snapshotId = `style-${Date.now()}`;

    const [guide] = await db.insert(styleGuides).values({
      userId,
      snapshotId,
      rules,
      analysis
    }).returning();

    console.log(`[StyleGuide] Extracted ${rules.length} rules for user ${userId}`);
    return guide;
  }

  private async analyzePackageJson(rootDir: string, analysis: StyleAnalysis): Promise<void> {
    const pkgPath = path.join(rootDir, 'package.json');
    
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps['react']) analysis.frameworks.push('React');
        if (deps['vue']) analysis.frameworks.push('Vue');
        if (deps['express']) analysis.frameworks.push('Express');
        if (deps['tailwindcss']) analysis.frameworks.push('Tailwind CSS');
        if (deps['@tanstack/react-query']) analysis.frameworks.push('TanStack Query');
        if (deps['drizzle-orm']) analysis.frameworks.push('Drizzle ORM');
        if (deps['typescript']) analysis.frameworks.push('TypeScript');
        if (deps['zod']) analysis.frameworks.push('Zod');
        if (deps['framer-motion']) analysis.frameworks.push('Framer Motion');

        if (deps['eslint']) analysis.conventions['linter'] = 'ESLint';
        if (deps['prettier']) analysis.conventions['formatter'] = 'Prettier';
        if (deps['vitest']) analysis.conventions['testing'] = 'Vitest';
        if (deps['jest']) analysis.conventions['testing'] = 'Jest';
        if (deps['playwright']) analysis.conventions['e2e'] = 'Playwright';
      }
    } catch (err) {
      console.error('[StyleGuide] Error reading package.json:', err);
    }
  }

  private async analyzeTypeScriptConfig(
    rootDir: string, 
    analysis: StyleAnalysis, 
    rules: StyleRule[]
  ): Promise<void> {
    const tsconfigPath = path.join(rootDir, 'tsconfig.json');
    
    try {
      if (fs.existsSync(tsconfigPath)) {
        const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
        const options = tsconfig.compilerOptions || {};

        if (options.strict) {
          rules.push({
            category: 'typescript',
            rule: 'Strict mode enabled - use explicit types',
            examples: ['function add(a: number, b: number): number'],
            confidence: 100
          });
        }

        if (options.paths) {
          const aliases = Object.keys(options.paths);
          rules.push({
            category: 'imports',
            rule: `Use path aliases: ${aliases.join(', ')}`,
            examples: aliases.map(a => `import { x } from "${a.replace('/*', '')}/module"`),
            confidence: 100
          });
          analysis.conventions['pathAliases'] = aliases.join(', ');
        }

        if (options.baseUrl) {
          analysis.conventions['baseUrl'] = options.baseUrl;
        }
      }
    } catch (err) {
      console.error('[StyleGuide] Error reading tsconfig:', err);
    }
  }

  private async analyzeCodePatterns(
    rootDir: string, 
    rules: StyleRule[],
    analysis: StyleAnalysis
  ): Promise<void> {
    const patterns = {
      hooks: { count: 0, examples: [] as string[] },
      components: { count: 0, examples: [] as string[] },
      services: { count: 0, examples: [] as string[] },
      utils: { count: 0, examples: [] as string[] }
    };

    await this.walkDirectory(rootDir, (filePath, content) => {
      if (filePath.includes('/hooks/')) {
        const hookMatch = content.match(/export\s+(?:const|function)\s+(use\w+)/);
        if (hookMatch) {
          patterns.hooks.count++;
          if (patterns.hooks.examples.length < 3) {
            patterns.hooks.examples.push(hookMatch[1]);
          }
        }
      }

      if (filePath.includes('/components/')) {
        const componentMatch = content.match(/export\s+(?:default\s+)?(?:const|function)\s+(\w+)/);
        if (componentMatch) {
          patterns.components.count++;
          if (patterns.components.examples.length < 3) {
            patterns.components.examples.push(componentMatch[1]);
          }
        }
      }

      if (filePath.includes('/services/')) {
        const serviceMatch = content.match(/class\s+(\w+Service)/);
        if (serviceMatch) {
          patterns.services.count++;
          if (patterns.services.examples.length < 3) {
            patterns.services.examples.push(serviceMatch[1]);
          }
        }
      }

      if (content.includes('export const')) {
        analysis.patterns.push('Named exports');
      }
      if (content.includes('export default')) {
        analysis.patterns.push('Default exports');
      }
    });

    if (patterns.hooks.count > 0) {
      rules.push({
        category: 'naming',
        rule: 'Custom hooks use "use" prefix',
        examples: patterns.hooks.examples,
        confidence: 95
      });
    }

    if (patterns.services.count > 0) {
      rules.push({
        category: 'naming',
        rule: 'Services use "Service" suffix with class pattern',
        examples: patterns.services.examples,
        confidence: 90
      });
    }

    analysis.patterns = [...new Set(analysis.patterns)];
  }

  private async analyzeNamingConventions(rootDir: string, rules: StyleRule[]): Promise<void> {
    const namingPatterns = {
      camelCase: 0,
      PascalCase: 0,
      kebabCase: 0,
      snake_case: 0
    };

    const examples: Record<string, string[]> = {
      camelCase: [],
      PascalCase: [],
      kebabCase: [],
      snake_case: []
    };

    await this.walkDirectory(rootDir, (filePath, content) => {
      const fileName = path.basename(filePath, path.extname(filePath));

      if (/^[a-z][a-zA-Z0-9]*$/.test(fileName)) {
        namingPatterns.camelCase++;
        if (examples.camelCase.length < 3) examples.camelCase.push(fileName);
      } else if (/^[A-Z][a-zA-Z0-9]*$/.test(fileName)) {
        namingPatterns.PascalCase++;
        if (examples.PascalCase.length < 3) examples.PascalCase.push(fileName);
      } else if (/^[a-z]+(-[a-z]+)*$/.test(fileName)) {
        namingPatterns.kebabCase++;
        if (examples.kebabCase.length < 3) examples.kebabCase.push(fileName);
      } else if (/^[a-z]+(_[a-z]+)*$/.test(fileName)) {
        namingPatterns.snake_case++;
        if (examples.snake_case.length < 3) examples.snake_case.push(fileName);
      }
    });

    const total = Object.values(namingPatterns).reduce((a, b) => a + b, 0);
    
    for (const [pattern, count] of Object.entries(namingPatterns)) {
      if (count > 0 && count / total >= 0.2) {
        rules.push({
          category: 'naming',
          rule: `File naming: ${pattern}`,
          examples: examples[pattern as keyof typeof examples],
          confidence: Math.round((count / total) * 100)
        });
      }
    }
  }

  private async analyzeImportPatterns(rootDir: string, rules: StyleRule[]): Promise<void> {
    const importPatterns = {
      absoluteImports: 0,
      relativeImports: 0,
      aliasImports: 0
    };

    await this.walkDirectory(rootDir, (filePath, content) => {
      const imports = content.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || [];
      
      for (const imp of imports) {
        const fromMatch = imp.match(/from\s+['"]([^'"]+)['"]/);
        if (fromMatch) {
          const source = fromMatch[1];
          if (source.startsWith('.')) {
            importPatterns.relativeImports++;
          } else if (source.startsWith('@/') || source.startsWith('~')) {
            importPatterns.aliasImports++;
          } else {
            importPatterns.absoluteImports++;
          }
        }
      }
    });

    const total = Object.values(importPatterns).reduce((a, b) => a + b, 0);
    
    if (total > 0) {
      if (importPatterns.aliasImports / total > 0.3) {
        rules.push({
          category: 'imports',
          rule: 'Prefer path aliases for internal imports',
          examples: ['import { Button } from "@/components/ui/button"'],
          confidence: 85
        });
      }
    }
  }

  private async walkDirectory(
    dir: string, 
    callback: (filePath: string, content: string) => void
  ): Promise<void> {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (!this.excludeDirs.includes(entry.name)) {
            await this.walkDirectory(fullPath, callback);
          }
        } else if (entry.isFile() && (
          entry.name.endsWith('.ts') || 
          entry.name.endsWith('.tsx') ||
          entry.name.endsWith('.js') ||
          entry.name.endsWith('.jsx')
        )) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            callback(fullPath, content);
          } catch (err) {
          }
        }
      }
    } catch (err) {
    }
  }

  async getLatestStyleGuide(userId: number): Promise<StyleGuide | null> {
    const [guide] = await db.select()
      .from(styleGuides)
      .where(eq(styleGuides.userId, userId))
      .orderBy(desc(styleGuides.createdAt))
      .limit(1);

    return guide || null;
  }

  getStyleGuideForPrompt(guide: StyleGuide | null): string {
    if (!guide) return 'Aucun guide de style extrait.';

    const rules = guide.rules as StyleRule[];
    const analysis = guide.analysis as StyleAnalysis;

    let text = `Guide de style du projet:\n`;
    
    if (analysis.frameworks.length > 0) {
      text += `\nFrameworks: ${analysis.frameworks.join(', ')}\n`;
    }

    if (rules.length > 0) {
      text += `\nConventions:\n`;
      for (const rule of rules.slice(0, 10)) {
        text += `  - [${rule.category}] ${rule.rule}\n`;
        if (rule.examples.length > 0) {
          text += `    Ex: ${rule.examples[0]}\n`;
        }
      }
    }

    if (analysis.patterns.length > 0) {
      text += `\nPatterns utilisés: ${analysis.patterns.slice(0, 5).join(', ')}\n`;
    }

    return text;
  }
}

export const styleGuideExtractor = new StyleGuideExtractor();
