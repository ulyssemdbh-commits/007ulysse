import { db } from '../db';
import { assistantModes, InsertAssistantMode, AssistantMode } from '@shared/schema';
import { eq } from 'drizzle-orm';

export type DevMode = 'ship' | 'craft' | 'audit';

interface ModePreferences {
  strictness: number;
  autoFix: boolean;
  codeReview: boolean;
  suggestTests: boolean;
  debtTracking: boolean;
}

const DEFAULT_PREFERENCES: Record<DevMode, ModePreferences> = {
  ship: {
    strictness: 30,
    autoFix: true,
    codeReview: false,
    suggestTests: false,
    debtTracking: false
  },
  craft: {
    strictness: 60,
    autoFix: true,
    codeReview: true,
    suggestTests: true,
    debtTracking: true
  },
  audit: {
    strictness: 100,
    autoFix: false,
    codeReview: true,
    suggestTests: true,
    debtTracking: true
  }
};

class AssistantModeService {
  async getMode(userId: number): Promise<{ mode: DevMode; preferences: ModePreferences }> {
    const [existing] = await db.select()
      .from(assistantModes)
      .where(eq(assistantModes.userId, userId))
      .limit(1);

    if (existing) {
      return {
        mode: existing.mode as DevMode,
        preferences: (existing.preferences as ModePreferences) || DEFAULT_PREFERENCES[existing.mode as DevMode]
      };
    }

    return {
      mode: 'craft',
      preferences: DEFAULT_PREFERENCES.craft
    };
  }

  async setMode(userId: number, mode: DevMode, customPreferences?: Partial<ModePreferences>): Promise<AssistantMode> {
    const preferences = {
      ...DEFAULT_PREFERENCES[mode],
      ...customPreferences
    };

    const [existing] = await db.select()
      .from(assistantModes)
      .where(eq(assistantModes.userId, userId))
      .limit(1);

    if (existing) {
      const [updated] = await db.update(assistantModes)
        .set({
          mode,
          preferences,
          updatedAt: new Date()
        })
        .where(eq(assistantModes.userId, userId))
        .returning();

      console.log(`[AssistantMode] User ${userId} switched to ${mode} mode`);
      return updated;
    }

    const [created] = await db.insert(assistantModes)
      .values({
        userId,
        mode,
        preferences
      })
      .returning();

    console.log(`[AssistantMode] User ${userId} initialized with ${mode} mode`);
    return created;
  }

  async updatePreferences(userId: number, preferences: Partial<ModePreferences>): Promise<AssistantMode> {
    const current = await this.getMode(userId);
    
    const newPreferences = {
      ...current.preferences,
      ...preferences
    };

    const [existing] = await db.select()
      .from(assistantModes)
      .where(eq(assistantModes.userId, userId))
      .limit(1);

    if (existing) {
      const [updated] = await db.update(assistantModes)
        .set({
          preferences: newPreferences,
          updatedAt: new Date()
        })
        .where(eq(assistantModes.userId, userId))
        .returning();

      return updated;
    }

    const [created] = await db.insert(assistantModes)
      .values({
        userId,
        mode: current.mode,
        preferences: newPreferences
      })
      .returning();

    return created;
  }

  isActionAllowed(mode: DevMode, action: string): boolean {
    const restrictedInAudit = [
      'file_write',
      'file_delete',
      'db_modify',
      'deploy',
      'git_commit'
    ];

    if (mode === 'audit' && restrictedInAudit.includes(action)) {
      return false;
    }

    return true;
  }

  getModeDescription(mode: DevMode): string {
    switch (mode) {
      case 'ship':
        return `Mode SHIP: Focus sur la livraison rapide. Quick & dirty assumé, minimum de friction. 
        But = tester une idée ou livrer une feature vite.`;
      
      case 'craft':
        return `Mode CRAFT: Équilibre entre vitesse et qualité. Design discuté, dette identifiée, tests posés.
        But = code propre et maintenable.`;
      
      case 'audit':
        return `Mode AUDIT: Analyse sans modification. Scanner le code, identifier les dettes/failles/incohérences.
        But = audit technique complet.`;
      
      default:
        return `Mode inconnu`;
    }
  }

  getPromptModifier(mode: DevMode, preferences: ModePreferences): string {
    let modifier = `\n\n[MODE: ${mode.toUpperCase()}]\n`;
    
    switch (mode) {
      case 'ship':
        modifier += `Tu es en mode "ship" - priorité à la livraison rapide.
- Propose des solutions pragmatiques, pas forcément parfaites
- Ignore les optimisations non-essentielles
- Minimise les discussions techniques
- Focus sur "est-ce que ça marche?"
- Pas de tests sauf si explicitement demandé`;
        break;
      
      case 'craft':
        modifier += `Tu es en mode "craft" - équilibre qualité/vitesse.
- Propose des solutions propres et maintenables
- Identifie la dette technique créée
- Suggère des tests pertinents
- Discute les choix architecturaux importants
- Structure le code correctement`;
        break;
      
      case 'audit':
        modifier += `Tu es en mode "audit" - analyse uniquement, pas de modifications.
- Analyse le code en profondeur
- Identifie toutes les failles de sécurité
- Liste les dettes techniques
- Évalue la qualité du code
- Propose des améliorations sans les implémenter
- NE MODIFIE AUCUN FICHIER`;
        break;
    }

    if (preferences.strictness >= 80) {
      modifier += `\n- Niveau d'exigence ÉLEVÉ`;
    } else if (preferences.strictness <= 40) {
      modifier += `\n- Niveau d'exigence RELÂCHÉ`;
    }

    return modifier;
  }

  getModeForPrompt(userId: number): Promise<string> {
    return this.getMode(userId).then(({ mode, preferences }) => 
      this.getPromptModifier(mode, preferences)
    );
  }
}

export const assistantModeService = new AssistantModeService();
