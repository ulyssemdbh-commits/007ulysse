import { pgTable, text, serial, integer, boolean, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const footdatasLeagues = pgTable("footdatas_leagues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  country: text("country").notNull(),
  code: text("code").notNull().unique(),
  logoUrl: text("logo_url"),
  tier: integer("tier").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasClubs = pgTable("footdatas_clubs", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  dataFileName: text("data_file_name").notNull().unique(),
  city: text("city"),
  stadium: text("stadium"),
  stadiumCapacity: integer("stadium_capacity"),
  foundedYear: integer("founded_year"),
  colors: text("colors").array(),
  logoUrl: text("logo_url"),
  website: text("website"),
  president: text("president"),
  budget: text("budget"),
  socialMedia: jsonb("social_media"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasOrganigramme = pgTable("footdatas_organigramme", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  role: text("role").notNull(),
  category: text("category").notNull(),
  personName: text("person_name").notNull(),
  nationality: text("nationality"),
  photoUrl: text("photo_url"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  previousClub: text("previous_club"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasStaff = pgTable("footdatas_staff", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  nationality: text("nationality"),
  birthDate: timestamp("birth_date"),
  photoUrl: text("photo_url"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  previousClubs: text("previous_clubs").array(),
  achievements: jsonb("achievements"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasPlayers = pgTable("footdatas_players", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  name: text("name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  shirtNumber: integer("shirt_number"),
  position: text("position"),
  positionDetail: text("position_detail"),
  nationality: text("nationality"),
  secondNationality: text("second_nationality"),
  birthDate: timestamp("birth_date"),
  age: integer("age"),
  height: integer("height"),
  weight: integer("weight"),
  preferredFoot: text("preferred_foot"),
  marketValue: text("market_value"),
  contractUntil: timestamp("contract_until"),
  photoUrl: text("photo_url"),
  status: text("status").default("active"),
  injuryDetails: text("injury_details"),
  captain: boolean("captain").default(false),
  youthAcademy: boolean("youth_academy").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasPlayerStats = pgTable("footdatas_player_stats", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  clubId: integer("club_id").notNull(),
  season: text("season").notNull(),
  competition: text("competition").notNull(),
  appearances: integer("appearances").default(0),
  starts: integer("starts").default(0),
  minutesPlayed: integer("minutes_played").default(0),
  goals: integer("goals").default(0),
  assists: integer("assists").default(0),
  yellowCards: integer("yellow_cards").default(0),
  redCards: integer("red_cards").default(0),
  cleanSheets: integer("clean_sheets").default(0),
  saves: integer("saves").default(0),
  passAccuracy: real("pass_accuracy"),
  shotsOnTarget: integer("shots_on_target").default(0),
  tacklesWon: integer("tackles_won").default(0),
  aerialDuelsWon: integer("aerial_duels_won").default(0),
  rating: real("rating"),
  manOfTheMatch: integer("man_of_the_match").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const footdatasClubStats = pgTable("footdatas_club_stats", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  season: text("season").notNull(),
  competition: text("competition").notNull(),
  matchesPlayed: integer("matches_played").default(0),
  wins: integer("wins").default(0),
  draws: integer("draws").default(0),
  losses: integer("losses").default(0),
  goalsFor: integer("goals_for").default(0),
  goalsAgainst: integer("goals_against").default(0),
  goalDifference: integer("goal_difference").default(0),
  points: integer("points").default(0),
  position: integer("position"),
  homeWins: integer("home_wins").default(0),
  awayWins: integer("away_wins").default(0),
  cleanSheets: integer("clean_sheets").default(0),
  topScorer: text("top_scorer"),
  topScorerGoals: integer("top_scorer_goals"),
  avgPossession: real("avg_possession"),
  avgPassAccuracy: real("avg_pass_accuracy"),
  formLast5: text("form_last_5"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const footdatasTransfers = pgTable("footdatas_transfers", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  playerId: integer("player_id"),
  playerName: text("player_name").notNull(),
  transferType: text("transfer_type").notNull(),
  transferWindow: text("transfer_window").notNull(),
  transferDate: timestamp("transfer_date"),
  fromClub: text("from_club"),
  toClub: text("to_club"),
  fee: text("fee"),
  feeAmount: real("fee_amount"),
  contractLength: text("contract_length"),
  salary: text("salary"),
  agentFee: text("agent_fee"),
  bonuses: text("bonuses"),
  buybackClause: text("buyback_clause"),
  source: text("source"),
  confirmed: boolean("confirmed").default(false),
  officialAnnouncement: text("official_announcement"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasNews = pgTable("footdatas_news", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  summary: text("summary"),
  category: text("category").notNull(),
  importance: text("importance").default("normal"),
  source: text("source"),
  sourceUrl: text("source_url"),
  imageUrl: text("image_url"),
  relatedPlayerId: integer("related_player_id"),
  relatedPlayerName: text("related_player_name"),
  publishedAt: timestamp("published_at").notNull(),
  verified: boolean("verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const footdatasRankings = pgTable("footdatas_rankings", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  competition: text("competition").notNull(),
  season: text("season").notNull(),
  matchday: integer("matchday"),
  position: integer("position").notNull(),
  points: integer("points").notNull(),
  matchesPlayed: integer("matches_played"),
  wins: integer("wins"),
  draws: integer("draws"),
  losses: integer("losses"),
  goalsFor: integer("goals_for"),
  goalsAgainst: integer("goals_against"),
  goalDifference: integer("goal_difference"),
  form: text("form"),
  recordedAt: timestamp("recorded_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const footdatasHistory = pgTable("footdatas_history", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  eventDate: timestamp("event_date"),
  season: text("season"),
  competition: text("competition"),
  opponent: text("opponent"),
  score: text("score"),
  significance: text("significance"),
  relatedPersons: text("related_persons").array(),
  imageUrl: text("image_url"),
  videoUrl: text("video_url"),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const footdatasTrophies = pgTable("footdatas_trophies", {
  id: serial("id").primaryKey(),
  clubId: integer("club_id").notNull(),
  competition: text("competition").notNull(),
  season: text("season").notNull(),
  result: text("result").notNull(),
  finalOpponent: text("final_opponent"),
  finalScore: text("final_score"),
  topScorer: text("top_scorer"),
  keyPlayers: text("key_players").array(),
  coach: text("coach"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const footdatasMatches = pgTable("footdatas_matches", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id"),
  homeClubId: integer("home_club_id"),
  awayClubId: integer("away_club_id"),
  homeTeamName: text("home_team_name").notNull(),
  awayTeamName: text("away_team_name").notNull(),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  status: text("status").notNull(),
  matchDate: text("match_date").notNull(),
  matchTime: text("match_time"),
  competition: text("competition").notNull(),
  leagueCode: text("league_code"),
  matchUrl: text("match_url"),
  source: text("source").default("matchendirect"),
  predictionData: jsonb("prediction_data").$type<{
    lastPrediction?: {
      won: boolean;
      betType: string;
      confidence: number;
      settledAt: string;
    };
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasApiTeamMap = pgTable("footdatas_api_team_map", {
  id: serial("id").primaryKey(),
  apiTeamId: integer("api_team_id").notNull().unique(),
  clubId: integer("club_id"),
  teamName: text("team_name").notNull(),
  teamLogo: text("team_logo"),
  apiLeagueId: integer("api_league_id"),
  country: text("country"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasApiStandings = pgTable("footdatas_api_standings", {
  id: serial("id").primaryKey(),
  apiLeagueId: integer("api_league_id").notNull(),
  season: integer("season").notNull(),
  apiTeamId: integer("api_team_id").notNull(),
  teamName: text("team_name").notNull(),
  teamLogo: text("team_logo"),
  rank: integer("rank").notNull(),
  points: integer("points").notNull(),
  goalsDiff: integer("goals_diff").notNull(),
  played: integer("played").notNull(),
  win: integer("win").notNull(),
  draw: integer("draw").notNull(),
  lose: integer("lose").notNull(),
  goalsFor: integer("goals_for").notNull(),
  goalsAgainst: integer("goals_against").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasApiSquads = pgTable("footdatas_api_squads", {
  id: serial("id").primaryKey(),
  apiTeamId: integer("api_team_id").notNull(),
  season: integer("season").notNull(),
  squadData: jsonb("squad_data").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const footdatasApiTeamStats = pgTable("footdatas_api_team_stats", {
  id: serial("id").primaryKey(),
  apiTeamId: integer("api_team_id").notNull(),
  season: integer("season").notNull(),
  statsData: jsonb("stats_data").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFootdatasMatchSchema = createInsertSchema(footdatasMatches).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFootdatasLeagueSchema = createInsertSchema(footdatasLeagues).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFootdatasClubSchema = createInsertSchema(footdatasClubs).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFootdatasOrganigrammeSchema = createInsertSchema(footdatasOrganigramme).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFootdatasStaffSchema = createInsertSchema(footdatasStaff).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFootdatasPlayerSchema = createInsertSchema(footdatasPlayers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFootdatasPlayerStatsSchema = createInsertSchema(footdatasPlayerStats).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFootdatasClubStatsSchema = createInsertSchema(footdatasClubStats).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFootdatasTransferSchema = createInsertSchema(footdatasTransfers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFootdatasNewsSchema = createInsertSchema(footdatasNews).omit({ id: true, createdAt: true });
export const insertFootdatasRankingSchema = createInsertSchema(footdatasRankings).omit({ id: true, createdAt: true, recordedAt: true });
export const insertFootdatasHistorySchema = createInsertSchema(footdatasHistory).omit({ id: true, createdAt: true });
export const insertFootdatasTrophySchema = createInsertSchema(footdatasTrophies).omit({ id: true, createdAt: true });
export const insertFootdatasApiTeamMapSchema = createInsertSchema(footdatasApiTeamMap).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFootdatasApiStandingsSchema = createInsertSchema(footdatasApiStandings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFootdatasApiSquadsSchema = createInsertSchema(footdatasApiSquads).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFootdatasApiTeamStatsSchema = createInsertSchema(footdatasApiTeamStats).omit({ id: true, createdAt: true, updatedAt: true });

export type FootdatasMatch = typeof footdatasMatches.$inferSelect;
export type InsertFootdatasMatch = z.infer<typeof insertFootdatasMatchSchema>;

export type FootdatasLeague = typeof footdatasLeagues.$inferSelect;
export type InsertFootdatasLeague = z.infer<typeof insertFootdatasLeagueSchema>;

export type FootdatasClub = typeof footdatasClubs.$inferSelect;
export type InsertFootdatasClub = z.infer<typeof insertFootdatasClubSchema>;

export type FootdatasOrganigramme = typeof footdatasOrganigramme.$inferSelect;
export type InsertFootdatasOrganigramme = z.infer<typeof insertFootdatasOrganigrammeSchema>;

export type FootdatasStaff = typeof footdatasStaff.$inferSelect;
export type InsertFootdatasStaff = z.infer<typeof insertFootdatasStaffSchema>;

export type FootdatasPlayer = typeof footdatasPlayers.$inferSelect;
export type InsertFootdatasPlayer = z.infer<typeof insertFootdatasPlayerSchema>;

export type FootdatasPlayerStats = typeof footdatasPlayerStats.$inferSelect;
export type InsertFootdatasPlayerStats = z.infer<typeof insertFootdatasPlayerStatsSchema>;

export type FootdatasClubStats = typeof footdatasClubStats.$inferSelect;
export type InsertFootdatasClubStats = z.infer<typeof insertFootdatasClubStatsSchema>;

export type FootdatasTransfer = typeof footdatasTransfers.$inferSelect;
export type InsertFootdatasTransfer = z.infer<typeof insertFootdatasTransferSchema>;

export type FootdatasNews = typeof footdatasNews.$inferSelect;
export type InsertFootdatasNews = z.infer<typeof insertFootdatasNewsSchema>;

export type FootdatasRanking = typeof footdatasRankings.$inferSelect;
export type InsertFootdatasRanking = z.infer<typeof insertFootdatasRankingSchema>;

export type FootdatasHistory = typeof footdatasHistory.$inferSelect;
export type InsertFootdatasHistory = z.infer<typeof insertFootdatasHistorySchema>;

export type FootdatasTrophy = typeof footdatasTrophies.$inferSelect;
export type InsertFootdatasTrophy = z.infer<typeof insertFootdatasTrophySchema>;

export type FootdatasApiTeamMap = typeof footdatasApiTeamMap.$inferSelect;
export type InsertFootdatasApiTeamMap = z.infer<typeof insertFootdatasApiTeamMapSchema>;

export type FootdatasApiStanding = typeof footdatasApiStandings.$inferSelect;
export type InsertFootdatasApiStanding = z.infer<typeof insertFootdatasApiStandingsSchema>;

export type FootdatasApiSquad = typeof footdatasApiSquads.$inferSelect;
export type InsertFootdatasApiSquad = z.infer<typeof insertFootdatasApiSquadsSchema>;

export type FootdatasApiTeamStat = typeof footdatasApiTeamStats.$inferSelect;
export type InsertFootdatasApiTeamStat = z.infer<typeof insertFootdatasApiTeamStatsSchema>;
