import { Router, Request, Response } from "express";
import { footdatasService } from "../services/footdatasService";
import { initializeAllTeams } from "../services/footdatasInitializer";

const router = Router();

router.get("/leagues", async (req: Request, res: Response) => {
  try {
    const leagues = await footdatasService.getLeagues();
    res.json(leagues);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs", async (req: Request, res: Response) => {
  try {
    const { league } = req.query;
    
    if (league) {
      const leagueData = await footdatasService.getLeagueByCode(league as string);
      if (!leagueData) {
        return res.status(404).json({ error: `League ${league} not found` });
      }
      const clubs = await footdatasService.getClubsByLeague(leagueData.id);
      return res.json(clubs);
    }
    
    const clubs = await footdatasService.getAllClubs();
    res.json(clubs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/search", async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }
    const clubs = await footdatasService.searchClubs(q);
    res.json(clubs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const club = await footdatasService.getClubById(clubId);
    if (!club) {
      return res.status(404).json({ error: "Club not found" });
    }
    res.json(club);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id/full", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const dataFile = await footdatasService.getClubDataFile(clubId);
    if (!dataFile) {
      return res.status(404).json({ error: "Club data file not found" });
    }
    res.json(dataFile);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/datafile/:dataFileName", async (req: Request, res: Response) => {
  try {
    const { dataFileName } = req.params;
    const dataFile = await footdatasService.getClubDataFileByName(dataFileName);
    if (!dataFile) {
      return res.status(404).json({ error: `Data file ${dataFileName} not found` });
    }
    res.json(dataFile);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id/players", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const players = await footdatasService.getPlayers(clubId);
    res.json(players);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id/transfers", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    const { window, limit } = req.query;
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const transfers = window 
      ? await footdatasService.getTransfers(clubId, window as string)
      : await footdatasService.getRecentTransfers(clubId, parseInt(limit as string) || 10);
    res.json(transfers);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id/news", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    const { category, limit } = req.query;
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const news = category
      ? await footdatasService.getNewsByCategory(clubId, category as string, parseInt(limit as string) || 10)
      : await footdatasService.getNews(clubId, parseInt(limit as string) || 20);
    res.json(news);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id/rankings", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    const { season } = req.query;
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const rankings = await footdatasService.getRankings(clubId, season as string | undefined);
    res.json(rankings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id/trophies", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const trophies = await footdatasService.getTrophies(clubId);
    res.json(trophies);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id/trophy-count", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const trophyCount = await footdatasService.getTrophyCount(clubId);
    res.json(trophyCount);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id/history", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    const { type } = req.query;
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const history = type
      ? await footdatasService.getHistoryByType(clubId, type as string)
      : await footdatasService.getHistory(clubId);
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id/stats", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    const { season } = req.query;
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const stats = await footdatasService.getClubStats(clubId, season as string | undefined);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/players/:id", async (req: Request, res: Response) => {
  try {
    const playerId = parseInt(req.params.id);
    if (isNaN(playerId)) {
      return res.status(400).json({ error: "Invalid player ID" });
    }
    const player = await footdatasService.getPlayerById(playerId);
    if (!player) {
      return res.status(404).json({ error: "Player not found" });
    }
    res.json(player);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/players/:id/stats", async (req: Request, res: Response) => {
  try {
    const playerId = parseInt(req.params.id);
    const { season } = req.query;
    if (isNaN(playerId)) {
      return res.status(400).json({ error: "Invalid player ID" });
    }
    const stats = await footdatasService.getPlayerStats(playerId, season as string | undefined);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/initialize", async (req: Request, res: Response) => {
  try {
    const result = await initializeAllTeams();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/summary/:clubName", async (req: Request, res: Response) => {
  try {
    const { clubName } = req.params;
    const summary = await footdatasService.getClubSummaryForAI(clubName);
    res.json({ summary });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id/form-ai", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    const { matches } = req.query;
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const form = await footdatasService.getClubFormForAI(clubId, parseInt(matches as string) || 5);
    res.json({ form });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id/key-players-ai", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    const { limit } = req.query;
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const keyPlayers = await footdatasService.getKeyPlayersForAI(clubId, parseInt(limit as string) || 5);
    res.json({ keyPlayers });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clubs/:id/summary-ai", async (req: Request, res: Response) => {
  try {
    const clubId = parseInt(req.params.id);
    if (isNaN(clubId)) {
      return res.status(400).json({ error: "Invalid club ID" });
    }
    const summary = await footdatasService.getClubSummaryForAI(clubId);
    res.json({ summary });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
