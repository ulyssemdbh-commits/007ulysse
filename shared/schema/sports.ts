import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const cachedMatches = pgTable("cached_matches", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull(),
  sport: text("sport").notNull().default("football"),
  league: text("league").notNull(),
  leagueId: integer("league_id"),
  country: text("country"),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  homeTeamId: integer("home_team_id"),
  awayTeamId: integer("away_team_id"),
  homeTeamLogo: text("home_team_logo"),
  awayTeamLogo: text("away_team_logo"),
  matchDate: timestamp("match_date").notNull(),
  venue: text("venue"),
  status: text("status").notNull().default("scheduled"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  stats: jsonb("stats"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const cachedOdds = pgTable("cached_odds", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull(),
  externalMatchId: text("external_match_id"),
  bookmaker: text("bookmaker").notNull(),
  market: text("market").notNull().default("h2h"),
  homeOdds: real("home_odds"),
  drawOdds: real("draw_odds"),
  awayOdds: real("away_odds"),
  overOdds: real("over_odds"),
  underOdds: real("under_odds"),
  bttsYes: real("btts_yes"),
  bttsNo: real("btts_no"),
  oddsData: jsonb("odds_data"),
  fetchedAt: timestamp("fetched_at").defaultNow(),
});

export const sportsSyncJobs = pgTable("sports_sync_jobs", {
  id: serial("id").primaryKey(),
  jobType: text("job_type").notNull(),
  sport: text("sport").notNull().default("all"),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  matchesProcessed: integer("matches_processed").default(0),
  oddsProcessed: integer("odds_processed").default(0),
  apiCallsUsed: integer("api_calls_used").default(0),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const cachedTeamStats = pgTable("cached_team_stats", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull(),
  teamName: text("team_name").notNull(),
  league: text("league").notNull(),
  leagueId: integer("league_id"),
  formString: text("form_string"),
  last10Wins: integer("last10_wins").default(0),
  last10Draws: integer("last10_draws").default(0),
  last10Losses: integer("last10_losses").default(0),
  goalsForAvg: real("goals_for_avg"),
  goalsAgainstAvg: real("goals_against_avg"),
  over25Rate: real("over25_rate"),
  bttsRate: real("btts_rate"),
  cleanSheetRate: real("clean_sheet_rate"),
  failedToScoreRate: real("failed_to_score_rate"),
  homeGoalsForAvg: real("home_goals_for_avg"),
  homeGoalsAgainstAvg: real("home_goals_against_avg"),
  homeOver25Rate: real("home_over25_rate"),
  homeBttsRate: real("home_btts_rate"),
  awayGoalsForAvg: real("away_goals_for_avg"),
  awayGoalsAgainstAvg: real("away_goals_against_avg"),
  awayOver25Rate: real("away_over25_rate"),
  awayBttsRate: real("away_btts_rate"),
  matchesSampled: integer("matches_sampled").default(10),
  lastUpdated: timestamp("last_updated").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const bettingProfiles = pgTable("betting_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  favoriteLeagues: jsonb("favorite_leagues").$type<string[]>().default([]),
  preferredBetTypes: jsonb("preferred_bet_types").$type<string[]>().default([]),
  riskProfile: text("risk_profile").default("balanced"),
  favoriteTeams: jsonb("favorite_teams").$type<string[]>().default([]),
  blacklistedTeams: jsonb("blacklisted_teams").$type<string[]>().default([]),
  minOdds: real("min_odds").default(1.2),
  maxOdds: real("max_odds").default(5.0),
  preferredOddsRange: jsonb("preferred_odds_range").$type<{min: number, max: number}>(),
  typicalStake: real("typical_stake"),
  weeklyBudget: real("weekly_budget"),
  preferredTimeSlots: jsonb("preferred_time_slots").$type<string[]>().default([]),
  preferredTags: jsonb("preferred_tags").$type<string[]>().default([]),
  avoidedTags: jsonb("avoided_tags").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const bettingHistory = pgTable("betting_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  matchId: integer("match_id"),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  league: text("league").notNull(),
  matchDate: timestamp("match_date").notNull(),
  predictedBetType: text("predicted_bet_type").notNull(),
  predictedOdds: real("predicted_odds"),
  confidence: integer("confidence"),
  reasoning: text("reasoning"),
  tags: jsonb("tags").$type<string[]>().default([]),
  actualHomeScore: integer("actual_home_score"),
  actualAwayScore: integer("actual_away_score"),
  betResult: text("bet_result"),
  stakeAmount: real("stake_amount"),
  potentialWin: real("potential_win"),
  actualWin: real("actual_win"),
  wasActuallyBet: boolean("was_actually_bet").default(false),
  source: text("source").default("ulysse"),
  createdAt: timestamp("created_at").defaultNow(),
  settledAt: timestamp("settled_at"),
});

export const bettingStats = pgTable("betting_stats", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  period: text("period").notNull(),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  totalPredictions: integer("total_predictions").default(0),
  correctPredictions: integer("correct_predictions").default(0),
  successRate: real("success_rate").default(0),
  statsByBetType: jsonb("stats_by_bet_type").$type<Record<string, {total: number, won: number, rate: number}>>(),
  statsByLeague: jsonb("stats_by_league").$type<Record<string, {total: number, won: number, rate: number}>>(),
  totalStaked: real("total_staked").default(0),
  totalWon: real("total_won").default(0),
  roi: real("roi").default(0),
  currentStreak: integer("current_streak").default(0),
  bestStreak: integer("best_streak").default(0),
  worstStreak: integer("worst_streak").default(0),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const sportsPredictionSnapshots = pgTable("sports_prediction_snapshots", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id"),
  externalMatchId: text("external_match_id"),
  sport: text("sport").notNull().default("football"),
  league: text("league").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  matchDate: timestamp("match_date").notNull(),
  oddsSnapshot: jsonb("odds_snapshot").$type<{
    homeOdds: number;
    drawOdds?: number;
    awayOdds: number;
    overOdds?: number;
    underOdds?: number;
    bttsYes?: number;
    spreadHome?: number;
    spreadAway?: number;
    bookmaker: string;
    fetchedAt: string;
  }>(),
  statsSnapshot: jsonb("stats_snapshot").$type<{
    homeForm?: string;
    awayForm?: string;
    homeGoalsAvg?: number;
    awayGoalsAvg?: number;
    homeOver25Rate?: number;
    awayOver25Rate?: number;
    homeBttsRate?: number;
    awayBttsRate?: number;
    h2hHistory?: any;
  }>(),
  predictions: jsonb("predictions").$type<{
    homeWinProb: number;
    drawProb?: number;
    awayWinProb: number;
    over25Prob?: number;
    under25Prob?: number;
    bttsProb?: number;
    spreadProb?: number;
  }>().notNull(),
  recommendations: jsonb("recommendations").$type<{
    bestBet: string;
    confidence: number;
    valueScore: number;
    reasoning: string;
    altBets?: Array<{bet: string; confidence: number; value: number}>;
  }>().notNull(),
  actualResult: jsonb("actual_result").$type<{
    homeScore: number;
    awayScore: number;
    status: string;
    settledAt: string;
  }>(),
  predictionPerformance: jsonb("prediction_performance").$type<{
    mainBetWon: boolean;
    probabilityAccuracy: number;
    valueRealized: boolean;
    notes?: string;
  }>(),
  addedToBrain: boolean("added_to_brain").default(false),
  brainKnowledgeId: integer("brain_knowledge_id"),
  learningExtracted: boolean("learning_extracted").default(false),
  footdatasSynced: boolean("footdatas_synced").default(false),
  version: integer("version").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const actualBets = pgTable("actual_bets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  matchId: integer("match_id"),
  externalMatchId: text("external_match_id"),
  sport: text("sport").notNull(),
  league: text("league").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  matchDate: timestamp("match_date").notNull(),
  betType: text("bet_type").notNull(),
  odds: real("odds").notNull(),
  stake: real("stake").notNull(),
  potentialWin: real("potential_win"),
  bookmaker: text("bookmaker").notNull(),
  status: text("status").notNull().default("pending"),
  actualResult: jsonb("actual_result"),
  profit: real("profit"),
  confidence: integer("confidence"),
  reasoning: text("reasoning"),
  isValueBet: boolean("is_value_bet").default(false),
  predictionId: integer("prediction_id"),
  createdAt: timestamp("created_at").defaultNow(),
  settledAt: timestamp("settled_at"),
});

export const insertCachedMatchSchema = createInsertSchema(cachedMatches).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCachedOddsSchema = createInsertSchema(cachedOdds).omit({ id: true, fetchedAt: true });
export const insertCachedTeamStatsSchema = createInsertSchema(cachedTeamStats).omit({ id: true, createdAt: true, lastUpdated: true });
export const insertSportsSyncJobSchema = createInsertSchema(sportsSyncJobs).omit({ id: true, createdAt: true });
export const insertBettingProfileSchema = createInsertSchema(bettingProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBettingHistorySchema = createInsertSchema(bettingHistory).omit({ id: true, createdAt: true });
export const insertBettingStatsSchema = createInsertSchema(bettingStats).omit({ id: true, lastUpdated: true });
export const insertSportsPredictionSnapshotSchema = createInsertSchema(sportsPredictionSnapshots).omit({
  id: true, createdAt: true, updatedAt: true
});
export const insertActualBetSchema = createInsertSchema(actualBets).omit({
  id: true,
  createdAt: true,
  settledAt: true,
  profit: true,
  potentialWin: true,
  actualResult: true
});

export type CachedMatch = typeof cachedMatches.$inferSelect;
export type InsertCachedMatch = z.infer<typeof insertCachedMatchSchema>;

export type CachedOdds = typeof cachedOdds.$inferSelect;
export type InsertCachedOdds = z.infer<typeof insertCachedOddsSchema>;

export type SportsSyncJob = typeof sportsSyncJobs.$inferSelect;
export type InsertSportsSyncJob = z.infer<typeof insertSportsSyncJobSchema>;

export type CachedTeamStats = typeof cachedTeamStats.$inferSelect;
export type InsertCachedTeamStats = z.infer<typeof insertCachedTeamStatsSchema>;

export type BettingProfile = typeof bettingProfiles.$inferSelect;
export type InsertBettingProfile = z.infer<typeof insertBettingProfileSchema>;

export type BettingHistoryEntry = typeof bettingHistory.$inferSelect;
export type InsertBettingHistory = z.infer<typeof insertBettingHistorySchema>;

export type BettingStatsEntry = typeof bettingStats.$inferSelect;
export type InsertBettingStats = z.infer<typeof insertBettingStatsSchema>;

export type SportsPredictionSnapshot = typeof sportsPredictionSnapshots.$inferSelect;
export type InsertSportsPredictionSnapshot = z.infer<typeof insertSportsPredictionSnapshotSchema>;

export type ActualBet = typeof actualBets.$inferSelect;
export type InsertActualBet = z.infer<typeof insertActualBetSchema>;
