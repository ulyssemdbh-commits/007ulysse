/**
 * Sports Data Priority Service
 * 
 * Stratégie: DB First → API Fallback
 * 
 * 1. Brain System (knowledge_base, homework.notes, ulysse_memory)
 * 2. Sports Cache (matches_cache, odds_cache, predictions)
 * 3. API externes (uniquement si données DB insuffisantes)
 * 
 * Les homeworks quotidiens (ex: Football 365) enrichissent la DB,
 * permettant à Ulysse de répondre sans consommer de quota API.
 */

import { db } from "../db";
import { knowledgeBase, ulysseMemory, ulysseHomework, savedLinks } from "@shared/schema";
import { eq, and, or, desc, sql, gte } from "drizzle-orm";
import { brainService } from "./brainService";
import { sportsCacheService } from "./sportsCacheService";
import { globalOptimizerService } from "./globalOptimizerService";

interface SportsDataResult {
  source: 'brain' | 'cache' | 'api' | 'none';
  data: string;
  confidence: number;
  fromHomework: boolean;
  needsApiCall: boolean;
  debugInfo: {
    brainEntries: number;
    cacheMatches: number;
    homeworkData: boolean;
  };
}

class SportsDataPriorityService {
  
  /**
   * Recherche les données sports en priorisant la DB (cached)
   */
  async getSportsContext(userId: number, query: string, sport: string = 'football'): Promise<SportsDataResult> {
    const cacheKey = `context:${userId}:${sport}:${query.substring(0, 50)}`;
    
    return globalOptimizerService.getOrFetch(
      cacheKey,
      "sports_odds",
      () => this.getSportsContextDirect(userId, query, sport),
      { customTTL: 60 * 1000 } // 1 min TTL
    );
  }
  
  private async getSportsContextDirect(userId: number, query: string, sport: string): Promise<SportsDataResult> {
    const queryLower = query.toLowerCase();
    const debugInfo = { brainEntries: 0, cacheMatches: 0, homeworkData: false };
    
    console.log(`[SportsDataPriority] Query: "${queryLower.substring(0, 50)}..." Sport: ${sport}`);
    
    // ═══════════════════════════════════════════════════════════════
    // DÉTECTION: Requête "matchs du jour" / "paris" → Cache prioritaire
    // ═══════════════════════════════════════════════════════════════
    const isTodayQuery = /\b(ce soir|aujourd'?hui|tonight|today|match|matchs|paris|pari|parier|cotes?|pronostic|meilleur)\b/i.test(queryLower);
    
    if (isTodayQuery && sport === 'football') {
      console.log(`[SportsDataPriority] 🔥 TODAY/BETTING query detected - checking cache FIRST`);
      
      // Pour les matchs du jour, on vérifie le cache EN PREMIER
      const cacheData = await this.querySportsCache(sport, queryLower);
      debugInfo.cacheMatches = cacheData.matchCount;
      
      if (cacheData.content && cacheData.matchCount > 0) {
        console.log(`[SportsDataPriority] ✅ Live cache data found (${cacheData.matchCount} matches) - USING THIS`);
        return {
          source: 'cache',
          data: cacheData.content,
          confidence: 0.90, // Haute confiance pour données live
          fromHomework: false,
          needsApiCall: false,
          debugInfo
        };
      }
      console.log(`[SportsDataPriority] ⚠️ No live cache data, falling back to brain`);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // ÉTAPE 1: Brain System (homeworks, knowledge_base, memories)
    // ═══════════════════════════════════════════════════════════════
    const brainData = await this.queryBrainForSports(userId, queryLower, sport);
    debugInfo.brainEntries = brainData.entries;
    debugInfo.homeworkData = brainData.fromHomework;
    
    if (brainData.content && brainData.confidence >= 0.7) {
      console.log(`[SportsDataPriority] ✅ Brain data sufficient (confidence: ${brainData.confidence})`);
      return {
        source: 'brain',
        data: brainData.content,
        confidence: brainData.confidence,
        fromHomework: brainData.fromHomework,
        needsApiCall: false,
        debugInfo
      };
    }
    
    // ═══════════════════════════════════════════════════════════════
    // ÉTAPE 2: Sports Cache (matches, odds, predictions) - fallback
    // ═══════════════════════════════════════════════════════════════
    const cacheData = await this.querySportsCache(sport, queryLower);
    debugInfo.cacheMatches = cacheData.matchCount;
    
    if (cacheData.content && cacheData.matchCount > 0) {
      console.log(`[SportsDataPriority] ✅ Cache data found (${cacheData.matchCount} matches)`);
      
      // Combiner brain + cache si les deux ont des données
      const combinedContent = brainData.content 
        ? `${brainData.content}\n\n${cacheData.content}`
        : cacheData.content;
      
      return {
        source: 'cache',
        data: combinedContent,
        confidence: 0.85,
        fromHomework: brainData.fromHomework,
        needsApiCall: false,
        debugInfo
      };
    }
    
    // ═══════════════════════════════════════════════════════════════
    // ÉTAPE 3: Données insuffisantes → Appel API nécessaire
    // ═══════════════════════════════════════════════════════════════
    console.log(`[SportsDataPriority] ⚠️ DB data insufficient, API call needed`);
    
    // Retourner les données partielles du brain si disponibles
    if (brainData.content) {
      return {
        source: 'brain',
        data: brainData.content,
        confidence: brainData.confidence,
        fromHomework: brainData.fromHomework,
        needsApiCall: true,
        debugInfo
      };
    }
    
    return {
      source: 'none',
      data: '',
      confidence: 0,
      fromHomework: false,
      needsApiCall: true,
      debugInfo
    };
  }

  /**
   * Recherche dans le Brain System pour les données sports
   */
  private async queryBrainForSports(userId: number, query: string, sport: string): Promise<{
    content: string;
    confidence: number;
    entries: number;
    fromHomework: boolean;
  }> {
    const results: string[] = [];
    let fromHomework = false;
    let totalEntries = 0;
    
    // Keywords pour la recherche
    const sportsKeywords = this.getSportsKeywords(sport, query);
    
    // 1. Recherche dans homework.notes (données des homeworks quotidiens)
    const recentHomeworks = await this.getRecentSportsHomeworks(userId, sport);
    if (recentHomeworks.length > 0) {
      fromHomework = true;
      totalEntries += recentHomeworks.length;
      
      for (const hw of recentHomeworks) {
        if (hw.notes) {
          results.push(`[Veille ${hw.title} - ${this.formatDate(hw.lastExecutedAt)}]\n${hw.notes}`);
        }
      }
    }
    
    // 2. Recherche dans knowledge_base
    for (const keyword of sportsKeywords.slice(0, 3)) {
      const knowledge = await brainService.searchKnowledge(userId, keyword, {
        limit: 5
      });
      
      if (knowledge.length > 0) {
        totalEntries += knowledge.length;
        for (const k of knowledge) {
          if (!results.some(r => r.includes(k.title))) {
            results.push(`[${k.title}] ${k.summary || k.content.slice(0, 3000)}`);
          }
        }
      }
    }
    
    // 3. Recherche dans ulysse_memory (mémoires personnelles sur le sport)
    const memories = await db.select().from(ulysseMemory)
      .where(and(
        eq(ulysseMemory.userId, userId),
        or(
          ...sportsKeywords.map(kw => sql`LOWER(${ulysseMemory.key}) LIKE ${'%' + kw + '%'}`),
          ...sportsKeywords.map(kw => sql`LOWER(${ulysseMemory.value}) LIKE ${'%' + kw + '%'}`)
        )
      ))
      .orderBy(desc(ulysseMemory.confidence))
      .limit(10);
    
    if (memories.length > 0) {
      totalEntries += memories.length;
      for (const m of memories) {
        results.push(`[Mémoire: ${m.key}] ${m.value}`);
      }
    }
    
    // 4. Recherche dans saved_links (liens sauvegardés sur le sport)
    const links = await db.select().from(savedLinks)
      .where(and(
        eq(savedLinks.userId, userId),
        or(
          ...sportsKeywords.map(kw => sql`LOWER(${savedLinks.title}) LIKE ${'%' + kw + '%'}`),
          ...sportsKeywords.map(kw => sql`LOWER(${savedLinks.summary}) LIKE ${'%' + kw + '%'}`)
        )
      ))
      .orderBy(desc(savedLinks.visitCount))
      .limit(5);
    
    if (links.length > 0) {
      totalEntries += links.length;
      for (const link of links) {
        if (link.summary) {
          results.push(`[Source: ${link.title}] ${link.summary}`);
        }
      }
    }
    
    // 5. Recherche dans learning_log (apprentissages des prédictions)
    const learnings = await brainService.getLearningsByType(userId, 'sports');
    if (learnings.length > 0) {
      totalEntries += learnings.length;
      const recentLearnings = learnings.slice(0, 5);
      for (const learning of recentLearnings) {
        results.push(`[Apprentissage ${this.formatDate(learning.createdAt)}] ${learning.insight}`);
      }
    }
    
    // Calculer la confiance basée sur la fraîcheur et la quantité de données
    const confidence = this.calculateConfidence(results.length, fromHomework, recentHomeworks);
    
    return {
      content: results.join('\n\n'),
      confidence,
      entries: totalEntries,
      fromHomework
    };
  }

  /**
   * Récupère les homeworks sports récents avec leurs notes
   */
  private async getRecentSportsHomeworks(userId: number, sport: string): Promise<any[]> {
    const sportsPatterns = {
      football: ['football', 'foot', 'ligue', 'premier league', 'champions', 'mercato', 'pronos', 'classement', 'veille', '365'],
      basketball: ['basketball', 'nba', 'basket', 'classement'],
      hockey: ['hockey', 'nhl', 'classement'],
      nfl: ['nfl', 'football américain', 'super bowl', 'classement']
    };
    
    const patterns = sportsPatterns[sport as keyof typeof sportsPatterns] || sportsPatterns.football;
    
    // Homeworks exécutés dans les dernières 48h
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    console.log(`[SportsDataPriority] Searching homeworks for userId=${userId}, sport=${sport}, patterns=${patterns.join(',')}, cutoff=${cutoff.toISOString()}`);
    
    const homeworks = await db.select().from(ulysseHomework)
      .where(and(
        eq(ulysseHomework.userId, userId),
        gte(ulysseHomework.lastExecutedAt, cutoff),
        or(
          ...patterns.map(p => sql`LOWER(${ulysseHomework.title}) LIKE ${'%' + p + '%'}`),
          ...patterns.map(p => sql`LOWER(${ulysseHomework.description}) LIKE ${'%' + p + '%'}`)
        )
      ))
      .orderBy(desc(ulysseHomework.lastExecutedAt))
      .limit(5);
    
    console.log(`[SportsDataPriority] Found ${homeworks.length} homeworks:`, homeworks.map(h => ({ id: h.id, title: h.title, hasNotes: !!h.notes, notesLength: h.notes?.length || 0 })));
    
    return homeworks;
  }

  /**
   * Recherche dans le cache sports
   */
  private async querySportsCache(sport: string, query: string): Promise<{
    content: string;
    matchCount: number;
  }> {
    try {
      // Utiliser le service de cache existant - passer un objet Date, pas une string!
      const today = new Date();
      console.log(`[SportsDataPriority] Querying cache for date: ${today.toISOString()}`);
      
      if (sport === 'football') {
        // Utiliser getMatchesWithOdds pour avoir cotes + stats + betting interest
        const matches = await sportsCacheService.getMatchesWithOdds(today);
        console.log(`[SportsDataPriority] Cache returned ${matches.length} football matches WITH ODDS`);
        
        if (matches.length > 0) {
          // Filtrer par mots-clés si spécifiques
          const relevantMatches = this.filterMatchesByQuery(matches, query);
          
          if (relevantMatches.length > 0) {
            const formatted = this.formatCacheMatchesWithOdds(relevantMatches);
            return { content: formatted, matchCount: relevantMatches.length };
          }
          
          // Sinon retourner tous les matchs triés par intérêt betting
          const sortedMatches = matches.sort((a, b) => (b.bettingInterest || 0) - (a.bettingInterest || 0));
          const formatted = this.formatCacheMatchesWithOdds(sortedMatches.slice(0, 15));
          return { content: formatted, matchCount: matches.length };
        }
      }
      
      // Pour autres sports, vérifier le cache générique
      const predictions = await sportsCacheService.getPredictionsForAI?.() || null;
      if (predictions) {
        return { content: predictions, matchCount: 1 };
      }
      
      return { content: '', matchCount: 0 };
    } catch (err) {
      console.error('[SportsDataPriority] Cache query error:', err);
      return { content: '', matchCount: 0 };
    }
  }

  /**
   * Filtre les matchs par mots-clés dans la requête
   */
  private filterMatchesByQuery(matches: any[], query: string): any[] {
    const teamKeywords = this.extractTeamKeywords(query);
    
    if (teamKeywords.length === 0) return matches;
    
    return matches.filter(m => {
      const matchText = `${m.homeTeam} ${m.awayTeam} ${m.league}`.toLowerCase();
      return teamKeywords.some(kw => matchText.includes(kw));
    });
  }

  /**
   * Extrait les noms d'équipes/ligues de la requête
   */
  private extractTeamKeywords(query: string): string[] {
    const knownTeams = [
      'psg', 'paris', 'marseille', 'om', 'lyon', 'ol', 'monaco', 'lille', 'lens', 'nice', 'rennes',
      'barcelona', 'real madrid', 'atletico', 'manchester', 'liverpool', 'arsenal', 'chelsea',
      'bayern', 'dortmund', 'juventus', 'inter', 'milan', 'napoli'
    ];
    
    const knownLeagues = [
      'ligue 1', 'premier league', 'la liga', 'bundesliga', 'serie a', 'champions league'
    ];
    
    const found: string[] = [];
    const queryLower = query.toLowerCase();
    
    for (const team of knownTeams) {
      if (queryLower.includes(team)) found.push(team);
    }
    for (const league of knownLeagues) {
      if (queryLower.includes(league)) found.push(league);
    }
    
    return found;
  }

  /**
   * Formate les matchs du cache pour l'IA
   */
  private formatCacheMatches(matches: any[]): string {
    const lines = ['### ⚽ MATCHS DU JOUR - DONNÉES VÉRIFIÉES DU CACHE:'];
    lines.push(`📅 Date: ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`);
    lines.push(`📊 ${matches.length} matchs disponibles\n`);
    
    for (const m of matches) {
      const matchDate = m.matchDate || m.match_date;
      const time = matchDate ? new Date(matchDate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Heure TBC';
      const homeTeam = m.homeTeam || m.home_team;
      const awayTeam = m.awayTeam || m.away_team;
      const league = m.league || 'Compétition';
      
      lines.push(`🔹 ${homeTeam} vs ${awayTeam}`);
      lines.push(`   📍 ${league} - 🕐 ${time}`);
    }
    
    lines.push('\n💡 UTILISE CES MATCHS POUR RÉPONDRE À L\'UTILISATEUR!');
    
    return lines.join('\n');
  }
  
  /**
   * Formate les matchs avec cotes et recommandations betting
   */
  private formatCacheMatchesWithOdds(matches: any[]): string {
    const lines = ['### ⚽ MATCHS DU JOUR - DONNÉES VÉRIFIÉES'];
    lines.push(`📅 ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`);
    lines.push(`📊 ${matches.length} matchs programmés\n`);
    
    // Check if we have any odds data
    const matchesWithOdds = matches.filter(m => m.odds && m.odds.length > 0);
    const hasOdds = matchesWithOdds.length > 0;
    
    if (!hasOdds) {
      lines.push('⚠️ COTES NON DISPONIBLES (APIs temporairement limitées)');
      lines.push('📋 MATCHS DU JOUR:');
      // Show all matches by league when no odds available
      const byLeague: Record<string, any[]> = {};
      for (const m of matches) {
        const league = m.league || 'Autre';
        if (!byLeague[league]) byLeague[league] = [];
        byLeague[league].push(m);
      }
      for (const [league, leagueMatches] of Object.entries(byLeague)) {
        lines.push(`\n**${league}:**`);
        for (const m of leagueMatches.slice(0, 10)) {
          const matchDate = m.matchDate || m.match_date;
          const time = matchDate ? new Date(matchDate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
          const homeTeam = m.homeTeam || m.home_team || 'Équipe 1';
          const awayTeam = m.awayTeam || m.away_team || 'Équipe 2';
          lines.push(`  ⚽ ${homeTeam} vs ${awayTeam} - ${time}`);
        }
      }
      lines.push('\n💡 TIP: Présente ces matchs à l\'utilisateur et indique que les cotes seront disponibles prochainement.');
    } else {
      // Séparer les matchs par niveau d'intérêt
      const hotMatches = matches.filter(m => (m.bettingInterest || 0) >= 70);
      const goodMatches = matches.filter(m => (m.bettingInterest || 0) >= 40 && (m.bettingInterest || 0) < 70);
      const otherMatches = matches.filter(m => (m.bettingInterest || 0) < 40);
      
      if (hotMatches.length > 0) {
        lines.push('🔥 PARIS RECOMMANDÉS (forte valeur):');
        for (const m of hotMatches.slice(0, 5)) {
          lines.push(this.formatSingleMatchWithOdds(m, '  '));
        }
        lines.push('');
      }
      
      if (goodMatches.length > 0) {
        lines.push('⭐ MATCHS INTÉRESSANTS:');
        for (const m of goodMatches.slice(0, 5)) {
          lines.push(this.formatSingleMatchWithOdds(m, '  '));
        }
        lines.push('');
      }
      
      if (otherMatches.length > 0 && hotMatches.length + goodMatches.length < 8) {
        lines.push('📋 AUTRES MATCHS:');
        for (const m of otherMatches.slice(0, 5)) {
          lines.push(this.formatSingleMatchWithOdds(m, '  '));
        }
      }
      
      lines.push('\n✅ UTILISE CES DONNÉES POUR RECOMMANDER DES PARIS À L\'UTILISATEUR!');
    }
    
    return lines.join('\n');
  }
  
  /**
   * Formate un seul match avec ses cotes
   */
  private formatSingleMatchWithOdds(m: any, indent: string = ''): string {
    const matchDate = m.matchDate || m.match_date;
    const time = matchDate ? new Date(matchDate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    const homeTeam = m.homeTeam || m.home_team;
    const awayTeam = m.awayTeam || m.away_team;
    const league = m.league || 'Compétition';
    
    let result = `${indent}⚽ ${homeTeam} vs ${awayTeam} (${league}) - ${time}`;
    
    // Ajouter les cotes si disponibles (schema uses homeOdds/drawOdds/awayOdds)
    if (m.odds && m.odds.length > 0) {
      const mainOdd = m.odds[0];
      const homeOdd = (mainOdd.homeOdds || mainOdd.homeWin)?.toFixed(2) || '-';
      const drawOdd = (mainOdd.drawOdds || mainOdd.draw)?.toFixed(2) || '-';
      const awayOdd = (mainOdd.awayOdds || mainOdd.awayWin)?.toFixed(2) || '-';
      result += `\n${indent}   📊 Cotes: 1=${homeOdd} | N=${drawOdd} | 2=${awayOdd}`;
    }
    
    // Ajouter les tags d'intérêt
    if (m.interestTags && m.interestTags.length > 0) {
      result += `\n${indent}   🏷️ ${m.interestTags.join(', ')}`;
    }
    
    // Ajouter l'emoji d'intérêt si disponible
    if (m.interestEmoji) {
      result += ` ${m.interestEmoji}`;
    }
    
    return result;
  }

  /**
   * Génère les mots-clés de recherche pour un sport
   */
  private getSportsKeywords(sport: string, query: string): string[] {
    const baseKeywords: Record<string, string[]> = {
      football: ['football', 'foot', 'ligue 1', 'premier league', 'champions league', 'mercato', 'transfert', 'but', 'match'],
      basketball: ['basketball', 'nba', 'basket', 'playoffs', 'lebron', 'curry'],
      hockey: ['hockey', 'nhl', 'stanley cup', 'puck'],
      nfl: ['nfl', 'super bowl', 'touchdown', 'quarterback']
    };
    
    const keywords = baseKeywords[sport] || baseKeywords.football;
    
    // Ajouter les mots-clés spécifiques de la requête
    const queryWords = query.split(/\s+/).filter(w => w.length > 3);
    
    return [...new Set([...keywords, ...queryWords])];
  }

  /**
   * Calcule la confiance basée sur les données disponibles
   */
  private calculateConfidence(entryCount: number, fromHomework: boolean, homeworks: any[]): number {
    let confidence = 0;
    
    // Base: nombre d'entrées trouvées (plus généreux)
    confidence += Math.min(entryCount * 0.15, 0.5);
    
    // Bonus: données de homework récent
    if (fromHomework && homeworks.length > 0) {
      const mostRecent = homeworks[0];
      const hoursSinceExecution = (Date.now() - new Date(mostRecent.lastExecutedAt).getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceExecution < 6) {
        confidence += 0.5; // Très récent (< 6h)
      } else if (hoursSinceExecution < 24) {
        confidence += 0.4; // Aujourd'hui (< 24h)
      } else if (hoursSinceExecution < 48) {
        confidence += 0.3; // Hier (< 48h)
      } else {
        confidence += 0.2; // Plus ancien
      }
      
      // Bonus si les notes contiennent des données structurées (tableaux, classements)
      const hasStructuredData = homeworks.some(h => 
        h.notes?.includes('|') || h.notes?.includes('Position') || h.notes?.includes('Classement')
      );
      if (hasStructuredData) {
        confidence += 0.15;
        console.log(`[SportsDataPriority] Bonus +0.15 for structured data in homework notes`);
      }
    }
    
    console.log(`[SportsDataPriority] Confidence calculation: entryCount=${entryCount}, fromHomework=${fromHomework}, final=${Math.min(confidence, 1).toFixed(2)}`);
    
    return Math.min(confidence, 1);
  }

  /**
   * Formate une date pour l'affichage
   */
  private formatDate(date: Date | null): string {
    if (!date) return '';
    return new Date(date).toLocaleDateString('fr-FR', { 
      day: 'numeric', 
      month: 'short', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  /**
   * Détermine si un appel API est vraiment nécessaire
   */
  shouldCallAPI(result: SportsDataResult, requiresLiveData: boolean = false): boolean {
    // Si on a des données fraîches du brain avec haute confiance, pas besoin d'API
    if (result.source === 'brain' && result.confidence >= 0.8 && !requiresLiveData) {
      return false;
    }
    
    // Si on a des données du cache avec des matchs, pas besoin d'API
    if (result.source === 'cache' && result.debugInfo.cacheMatches >= 5) {
      return false;
    }
    
    // Sinon, API nécessaire
    return result.needsApiCall;
  }
}

export const sportsDataPriorityService = new SportsDataPriorityService();
