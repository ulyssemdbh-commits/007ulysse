/**
 * Structured Data Extraction API
 * Converts any URL to structured JSON
 */

import { Router } from 'express';
import { smartExtract, extractStructuredData, ContentType } from '../../services/structuredExtractor';
import { smartCrawl } from '../../core/strategyEngine';
import { 
  extractRankingTable, 
  extractTopScorers, 
  extractFixtures,
  fetchHtmlForScraper
} from '../../services/scraper/verified';

const router = Router();

router.post('/url', async (req, res) => {
  try {
    const { url, contentType } = req.body;
    
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL required' });
    }
    
    const result = await smartExtract(url, contentType as ContentType);
    
    res.json(result);
  } catch (error: any) {
    console.error('[Extract API] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      contentType: 'unknown',
      data: null,
    });
  }
});

router.post('/content', async (req, res) => {
  try {
    const { content, url, contentType } = req.body;
    
    if (!content) {
      return res.status(400).json({ success: false, error: 'Content required' });
    }
    
    const result = await extractStructuredData(
      content, 
      url || 'unknown', 
      contentType as ContentType
    );
    
    res.json(result);
  } catch (error: any) {
    console.error('[Extract API] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      contentType: 'unknown',
      data: null,
    });
  }
});

router.get('/types', (req, res) => {
  res.json({
    success: true,
    types: [
      { id: 'sports_ranking', description: 'Classements sportifs (football, basket, etc.)' },
      { id: 'sports_scores', description: 'Scores et résultats de matchs' },
      { id: 'betting_odds', description: 'Cotes de paris sportifs' },
      { id: 'news_article', description: 'Articles de presse/blog' },
      { id: 'product_listing', description: 'Listings de produits' },
      { id: 'price_list', description: 'Listes de prix' },
      { id: 'table_data', description: 'Données tabulaires génériques' },
    ]
  });
});

router.get('/football/:league', async (req, res) => {
  try {
    const { league } = req.params;
    const includeAll = req.query.full === 'true' || req.query.all === 'true';
    
    const leagueUrls: Record<string, string> = {
      'ligue1': 'https://www.eurotopteam.com/football/ligue1.php',
      'premierleague': 'https://www.eurotopteam.com/football/premierleague.php',
      'liga': 'https://www.eurotopteam.com/football/liga.php',
      'bundesliga': 'https://www.eurotopteam.com/football/bundesliga.php',
      'seriea': 'https://www.eurotopteam.com/football/seriea.php',
    };
    
    const url = leagueUrls[league.toLowerCase()];
    if (!url) {
      return res.status(404).json({ 
        success: false, 
        error: `League not found. Available: ${Object.keys(leagueUrls).join(', ')}` 
      });
    }
    
    // Fast HTML-based extraction (much faster than AI)
    const html = await fetchHtmlForScraper(url);
    if (!html) {
      return res.status(500).json({ success: false, error: 'Failed to fetch page' });
    }
    
    const ranking = extractRankingTable(html);
    const topScorers = extractTopScorers(html);
    const fixturesData = extractFixtures(html);
    
    // Format ranking data with stats
    const formattedRanking = ranking.map(r => ({
      position: r.position,
      name: r.name,
      score: r.points,
      stats: {
        J: r.played,
        V: r.wins,
        N: r.draws,
        D: r.losses,
        BP: r.goalsFor,
        BC: r.goalsAgainst,
        Diff: r.goalDiff,
      }
    }));
    
    // Full response with all data
    if (includeAll) {
      res.json({
        success: true,
        contentType: 'football_page',
        source: url,
        extractedAt: new Date().toISOString(),
        data: {
          ranking: {
            type: 'ranking',
            title: `Classement ${league}`,
            items: formattedRanking,
          },
          topScorers: {
            type: 'topScorers',
            items: topScorers,
          },
          fixtures: {
            type: 'fixtures',
            matchday: fixturesData.matchday,
            items: fixturesData.fixtures,
          },
        },
      });
    } else {
      // Default: ranking only (backward compatible)
      res.json({
        success: true,
        contentType: 'sports_ranking',
        source: url,
        extractedAt: new Date().toISOString(),
        data: {
          type: 'ranking',
          title: `Classement ${league}`,
          items: formattedRanking,
        },
        confidence: 0.95,
      });
    }
  } catch (error: any) {
    console.error('[Extract API] Football error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Dedicated endpoint for top scorers
router.get('/football/:league/scorers', async (req, res) => {
  try {
    const { league } = req.params;
    
    const leagueUrls: Record<string, string> = {
      'ligue1': 'https://www.eurotopteam.com/football/ligue1.php',
      'premierleague': 'https://www.eurotopteam.com/football/premierleague.php',
      'liga': 'https://www.eurotopteam.com/football/liga.php',
      'bundesliga': 'https://www.eurotopteam.com/football/bundesliga.php',
      'seriea': 'https://www.eurotopteam.com/football/seriea.php',
    };
    
    const url = leagueUrls[league.toLowerCase()];
    if (!url) {
      return res.status(404).json({ 
        success: false, 
        error: `League not found. Available: ${Object.keys(leagueUrls).join(', ')}` 
      });
    }
    
    const html = await fetchHtmlForScraper(url);
    if (!html) {
      return res.status(500).json({ success: false, error: 'Failed to fetch page' });
    }
    
    const topScorers = extractTopScorers(html);
    
    res.json({
      success: true,
      contentType: 'top_scorers',
      source: url,
      extractedAt: new Date().toISOString(),
      data: {
        type: 'topScorers',
        title: `Meilleurs buteurs ${league}`,
        items: topScorers,
      },
    });
  } catch (error: any) {
    console.error('[Extract API] Scorers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Dedicated endpoint for fixtures
router.get('/football/:league/fixtures', async (req, res) => {
  try {
    const { league } = req.params;
    
    const leagueUrls: Record<string, string> = {
      'ligue1': 'https://www.eurotopteam.com/football/ligue1.php',
      'premierleague': 'https://www.eurotopteam.com/football/premierleague.php',
      'liga': 'https://www.eurotopteam.com/football/liga.php',
      'bundesliga': 'https://www.eurotopteam.com/football/bundesliga.php',
      'seriea': 'https://www.eurotopteam.com/football/seriea.php',
    };
    
    const url = leagueUrls[league.toLowerCase()];
    if (!url) {
      return res.status(404).json({ 
        success: false, 
        error: `League not found. Available: ${Object.keys(leagueUrls).join(', ')}` 
      });
    }
    
    const html = await fetchHtmlForScraper(url);
    if (!html) {
      return res.status(500).json({ success: false, error: 'Failed to fetch page' });
    }
    
    const fixturesData = extractFixtures(html);
    
    res.json({
      success: true,
      contentType: 'fixtures',
      source: url,
      extractedAt: new Date().toISOString(),
      data: {
        type: 'fixtures',
        title: `Prochaine journée ${league}`,
        matchday: fixturesData.matchday,
        items: fixturesData.fixtures,
      },
    });
  } catch (error: any) {
    console.error('[Extract API] Fixtures error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
