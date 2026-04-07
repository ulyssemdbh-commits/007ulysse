import { db } from "../../db";
import { eq, sql, and, desc, gte } from "drizzle-orm";
import { knowledgeBase } from "@shared/schema";

interface Pattern {
  id: string;
  regex: RegExp;
  template: string;
  category: string;
  confidence: number;
  usageCount: number;
  successRate: number;
}

interface PatternMatch {
  patternId: string;
  response: string;
  confidence: number;
  variables: Record<string, string>;
}

interface AnalyzedPattern {
  type: string;
  keywords: string[];
  intent: string;
  entities: Record<string, string>;
}

export class PatternRecognitionService {
  private patterns: Map<string, Pattern> = new Map();
  private intentPatterns: Map<string, RegExp[]> = new Map();
  private entityExtractors: Map<string, RegExp> = new Map();
  private analysisBuffer: Array<{ input: string; output: string; timestamp: number }> = [];
  private readonly BUFFER_SIZE = 50;
  private readonly MIN_PATTERN_FREQUENCY = 3;

  constructor() {
    this.initializeBasePatterns();
    this.initializeEntityExtractors();
    console.log('[PatternRecognition] Service initialized with', this.patterns.size, 'base patterns');
  }

  private initializeBasePatterns(): void {
    this.addPattern({
      id: 'greeting_morning',
      regex: /^(bonjour|salut|coucou|hello|hey)\s*(ulysse|iris|alfred)?[!?\s]*$/i,
      template: 'Bonjour {user}! Comment puis-je t\'aider aujourd\'hui?',
      category: 'greeting',
      confidence: 0.95,
      usageCount: 0,
      successRate: 1.0
    });

    this.addPattern({
      id: 'time_query',
      regex: /^(quelle?\s+)?heure\s+(est[- ]il|actuelle?)?[?\s]*$/i,
      template: 'Il est {time} à Marseille.',
      category: 'time',
      confidence: 0.95,
      usageCount: 0,
      successRate: 1.0
    });

    this.addPattern({
      id: 'weather_query',
      regex: /^(quel\s+temps|m[ée]t[ée]o)\s*(fait[- ]il|aujourd'?hui|à marseille)?[?\s]*$/i,
      template: '{weather_response}',
      category: 'weather',
      confidence: 0.9,
      usageCount: 0,
      successRate: 1.0
    });

    this.addPattern({
      id: 'stock_quote',
      regex: /^(cours|prix|valeur)\s+(de\s+)?(\w+)[?\s]*$/i,
      template: '{stock_response}',
      category: 'finance',
      confidence: 0.85,
      usageCount: 0,
      successRate: 1.0
    });

    this.addPattern({
      id: 'suguval_list',
      regex: /^(liste\s+)?suguval[?\s]*$/i,
      template: '{suguval_response}',
      category: 'suguval',
      confidence: 0.9,
      usageCount: 0,
      successRate: 1.0
    });

    this.addPattern({
      id: 'match_today',
      regex: /^(quels?\s+)?(matchs?|foot)\s*(aujourd'?hui|ce\s+soir)?[?\s]*$/i,
      template: '{sports_response}',
      category: 'sports',
      confidence: 0.85,
      usageCount: 0,
      successRate: 1.0
    });

    this.addPattern({
      id: 'thanks',
      regex: /^(merci|thanks?|super|parfait|génial|excellent)[!?\s]*$/i,
      template: 'Avec plaisir! N\'hésite pas si tu as besoin d\'autre chose.',
      category: 'acknowledgment',
      confidence: 0.95,
      usageCount: 0,
      successRate: 1.0
    });

    this.addPattern({
      id: 'goodbye',
      regex: /^(au\s+revoir|bye|à\s+plus|ciao|salut|bonne\s+(nuit|journée|soirée))[!?\s]*$/i,
      template: 'À bientôt! Bonne {time_of_day}!',
      category: 'farewell',
      confidence: 0.95,
      usageCount: 0,
      successRate: 1.0
    });
  }

  private initializeEntityExtractors(): void {
    this.entityExtractors.set('stock_symbol', /\b([A-Z]{1,5})\b/);
    this.entityExtractors.set('team_name', /(psg|om|marseille|paris|lyon|monaco|real|barca|liverpool|chelsea|city|united)/i);
    this.entityExtractors.set('league_name', /(ligue\s*1|premier\s*league|la\s*liga|serie\s*a|bundesliga|champions)/i);
    this.entityExtractors.set('date', /(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|aujourd'?hui|demain|hier)/i);
    this.entityExtractors.set('time', /(\d{1,2}[h:]\d{0,2})/i);
    this.entityExtractors.set('restaurant', /(suguval|sugumaillane|maillane)/i);
  }

  private addPattern(pattern: Pattern): void {
    this.patterns.set(pattern.id, pattern);
  }

  async match(input: string, context: any): Promise<PatternMatch | null> {
    const normalizedInput = input.toLowerCase().trim();
    
    for (const [id, pattern] of this.patterns) {
      const match = normalizedInput.match(pattern.regex);
      if (match) {
        const variables = this.extractVariables(match, pattern);
        const response = await this.renderTemplate(pattern.template, variables, context);
        
        pattern.usageCount++;
        
        return {
          patternId: id,
          response,
          confidence: pattern.confidence,
          variables
        };
      }
    }

    const dbPattern = await this.matchFromDatabase(normalizedInput, context);
    if (dbPattern) {
      return dbPattern;
    }
    
    return null;
  }

  async analyze(input: string, output: string, context: any): Promise<AnalyzedPattern | null> {
    this.analysisBuffer.push({
      input: input.toLowerCase().trim(),
      output,
      timestamp: Date.now()
    });

    if (this.analysisBuffer.length >= this.BUFFER_SIZE) {
      await this.discoverNewPatterns(context.userId);
      this.analysisBuffer = this.analysisBuffer.slice(-10);
    }

    return this.extractPattern(input);
  }

  private async matchFromDatabase(input: string, context: any): Promise<PatternMatch | null> {
    try {
      const patterns = await db.select()
        .from(knowledgeBase)
        .where(and(
          eq(knowledgeBase.userId, context.userId),
          eq(knowledgeBase.type, 'discovered_pattern'),
          gte(knowledgeBase.confidence, 0.8)
        ))
        .orderBy(desc(knowledgeBase.accessCount))
        .limit(20);
      
      for (const pattern of patterns) {
        if (pattern.summary) {
          try {
            const regex = new RegExp(pattern.summary, 'i');
            if (regex.test(input)) {
              await db.update(knowledgeBase)
                .set({ 
                  accessCount: sql`${knowledgeBase.accessCount} + 1`,
                  lastAccessedAt: new Date()
                })
                .where(eq(knowledgeBase.id, pattern.id));
              
              return {
                patternId: `db:${pattern.id}`,
                response: pattern.content || '',
                confidence: pattern.confidence || 0.8,
                variables: {}
              };
            }
          } catch (e) {
          }
        }
      }
    } catch (error) {
      console.error('[PatternRecognition] Error matching from DB:', error);
    }
    
    return null;
  }

  private async discoverNewPatterns(userId: number): Promise<void> {
    console.log('[PatternRecognition] Analyzing buffer for new patterns...');
    
    const inputGroups = new Map<string, typeof this.analysisBuffer>();
    
    for (const entry of this.analysisBuffer) {
      const key = this.extractPatternSignature(entry.input);
      if (!inputGroups.has(key)) {
        inputGroups.set(key, []);
      }
      inputGroups.get(key)!.push(entry);
    }

    for (const [signature, entries] of inputGroups) {
      if (entries.length >= this.MIN_PATTERN_FREQUENCY) {
        const commonPattern = this.findCommonPattern(entries.map(e => e.input));
        if (commonPattern) {
          try {
            await db.insert(knowledgeBase).values({
              userId,
              title: `Pattern: ${signature.substring(0, 50)}`,
              content: entries[entries.length - 1].output,
              summary: commonPattern,
              type: 'discovered_pattern',
              category: 'pattern_discovery',
              importance: 6,
              confidence: 0.8,
              sourceType: 'pattern_recognition',
              metadata: {
                signature,
                frequency: entries.length,
                discoveredAt: new Date().toISOString()
              }
            }).onConflictDoNothing();
            
            console.log(`[PatternRecognition] Discovered pattern: ${signature}`);
          } catch (error) {
            console.error('[PatternRecognition] Error saving pattern:', error);
          }
        }
      }
    }
  }

  private extractPatternSignature(input: string): string {
    const stopWords = ['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'que', 'qui', 'quoi', 'est', 'sont', 'pour', 'avec', 'dans', 'sur'];
    
    const words = input.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w))
      .slice(0, 4);
    
    return words.sort().join('_');
  }

  private findCommonPattern(inputs: string[]): string | null {
    if (inputs.length < 2) return null;
    
    const firstWords = inputs[0].split(/\s+/);
    const pattern: string[] = [];
    
    for (let i = 0; i < firstWords.length; i++) {
      const word = firstWords[i].toLowerCase();
      const isCommon = inputs.every(input => {
        const words = input.toLowerCase().split(/\s+/);
        return words.includes(word);
      });
      
      if (isCommon) {
        pattern.push(word);
      } else {
        pattern.push('\\S+');
      }
    }
    
    if (pattern.filter(p => p !== '\\S+').length >= 2) {
      return '^' + pattern.join('\\s+') + '$';
    }
    
    return null;
  }

  private extractVariables(match: RegExpMatchArray, pattern: Pattern): Record<string, string> {
    const variables: Record<string, string> = {};
    
    for (let i = 1; i < match.length; i++) {
      if (match[i]) {
        variables[`group${i}`] = match[i];
      }
    }
    
    for (const [name, extractor] of this.entityExtractors) {
      const entityMatch = match[0].match(extractor);
      if (entityMatch) {
        variables[name] = entityMatch[1];
      }
    }
    
    return variables;
  }

  private async renderTemplate(template: string, variables: Record<string, string>, context: any): Promise<string> {
    let rendered = template;

    if (template.includes('{time}')) {
      const now = new Date();
      rendered = rendered.replace('{time}', now.toLocaleTimeString('fr-FR', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Europe/Paris'
      }));
    }

    if (template.includes('{time_of_day}')) {
      const hour = new Date().getHours();
      let timeOfDay = 'journée';
      if (hour >= 18 || hour < 5) timeOfDay = 'soirée';
      else if (hour >= 5 && hour < 12) timeOfDay = 'matinée';
      rendered = rendered.replace('{time_of_day}', timeOfDay);
    }

    if (template.includes('{user}')) {
      rendered = rendered.replace('{user}', context.displayName || 'ami');
    }

    for (const [key, value] of Object.entries(variables)) {
      rendered = rendered.replace(`{${key}}`, value);
    }
    
    return rendered;
  }

  private extractPattern(input: string): AnalyzedPattern {
    const words = input.toLowerCase().split(/\s+/);
    const keywords: string[] = [];
    const entities: Record<string, string> = {};

    const stopWords = ['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'que', 'qui'];
    for (const word of words) {
      if (word.length > 2 && !stopWords.includes(word)) {
        keywords.push(word);
      }
    }

    for (const [name, extractor] of this.entityExtractors) {
      const match = input.match(extractor);
      if (match) {
        entities[name] = match[1];
      }
    }

    let intent = 'unknown';
    if (/^(qu('|e)|comment|pourquoi|où|quand)/.test(input.toLowerCase())) {
      intent = 'question';
    } else if (/^(fais|fait|mets|envoie|crée|ajoute|supprime)/.test(input.toLowerCase())) {
      intent = 'command';
    } else if (/^(bonjour|salut|coucou|hello)/.test(input.toLowerCase())) {
      intent = 'greeting';
    }

    return {
      type: 'analyzed',
      keywords,
      intent,
      entities
    };
  }

  getStats(): {
    patternCount: number;
    bufferSize: number;
    entityExtractorCount: number;
  } {
    return {
      patternCount: this.patterns.size,
      bufferSize: this.analysisBuffer.length,
      entityExtractorCount: this.entityExtractors.size
    };
  }
}
