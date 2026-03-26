import { footdatasService } from "./footdatasService";
import { InsertFootdatasClub } from "@shared/schema";

interface TeamData {
  name: string;
  shortName: string;
  dataFileName: string;
  city?: string;
  stadium?: string;
  foundedYear?: number;
}

const LIGUE_1_TEAMS: TeamData[] = [
  { name: "Paris Saint-Germain", shortName: "PSG", dataFileName: "PSGDatas", city: "Paris", stadium: "Parc des Princes", foundedYear: 1970 },
  { name: "Olympique de Marseille", shortName: "OM", dataFileName: "OMDatas", city: "Marseille", stadium: "Stade Vélodrome", foundedYear: 1899 },
  { name: "AS Monaco", shortName: "ASM", dataFileName: "MonacoDatas", city: "Monaco", stadium: "Stade Louis II", foundedYear: 1924 },
  { name: "Olympique Lyonnais", shortName: "OL", dataFileName: "OLDatas", city: "Lyon", stadium: "Groupama Stadium", foundedYear: 1950 },
  { name: "LOSC Lille", shortName: "LOSC", dataFileName: "LilleDatas", city: "Lille", stadium: "Stade Pierre-Mauroy", foundedYear: 1944 },
  { name: "OGC Nice", shortName: "OGCN", dataFileName: "NiceDatas", city: "Nice", stadium: "Allianz Riviera", foundedYear: 1904 },
  { name: "Stade Rennais", shortName: "SRFC", dataFileName: "RennesDatas", city: "Rennes", stadium: "Roazhon Park", foundedYear: 1901 },
  { name: "RC Lens", shortName: "RCL", dataFileName: "LensDatas", city: "Lens", stadium: "Stade Bollaert-Delelis", foundedYear: 1906 },
  { name: "Stade Brestois 29", shortName: "SB29", dataFileName: "BrestDatas", city: "Brest", stadium: "Stade Francis-Le Blé", foundedYear: 1950 },
  { name: "RC Strasbourg", shortName: "RCSA", dataFileName: "StrasbourgDatas", city: "Strasbourg", stadium: "Stade de la Meinau", foundedYear: 1906 },
  { name: "Toulouse FC", shortName: "TFC", dataFileName: "ToulouseDatas", city: "Toulouse", stadium: "Stadium de Toulouse", foundedYear: 1937 },
  { name: "Montpellier HSC", shortName: "MHSC", dataFileName: "MontpellierDatas", city: "Montpellier", stadium: "Stade de la Mosson", foundedYear: 1919 },
  { name: "FC Nantes", shortName: "FCN", dataFileName: "NantesDatas", city: "Nantes", stadium: "Stade de la Beaujoire", foundedYear: 1943 },
  { name: "Stade de Reims", shortName: "SDR", dataFileName: "ReimsDatas", city: "Reims", stadium: "Stade Auguste-Delaune", foundedYear: 1931 },
  { name: "AJ Auxerre", shortName: "AJA", dataFileName: "AuxerreDatas", city: "Auxerre", stadium: "Stade de l'Abbé-Deschamps", foundedYear: 1905 },
  { name: "Le Havre AC", shortName: "HAC", dataFileName: "LeHavreDatas", city: "Le Havre", stadium: "Stade Océane", foundedYear: 1872 },
  { name: "AS Saint-Étienne", shortName: "ASSE", dataFileName: "SaintEtienneDatas", city: "Saint-Étienne", stadium: "Stade Geoffroy-Guichard", foundedYear: 1919 },
  { name: "Angers SCO", shortName: "SCO", dataFileName: "AngersDatas", city: "Angers", stadium: "Stade Raymond-Kopa", foundedYear: 1919 },
];

const LALIGA_TEAMS: TeamData[] = [
  { name: "Real Madrid", shortName: "RMA", dataFileName: "RealMadridDatas", city: "Madrid", stadium: "Santiago Bernabéu", foundedYear: 1902 },
  { name: "FC Barcelona", shortName: "FCB", dataFileName: "BarcelonaDatas", city: "Barcelona", stadium: "Spotify Camp Nou", foundedYear: 1899 },
  { name: "Atlético Madrid", shortName: "ATM", dataFileName: "AtleticoMadridDatas", city: "Madrid", stadium: "Cívitas Metropolitano", foundedYear: 1903 },
  { name: "Athletic Bilbao", shortName: "ATH", dataFileName: "AthleticBilbaoDatas", city: "Bilbao", stadium: "San Mamés", foundedYear: 1898 },
  { name: "Real Sociedad", shortName: "RSO", dataFileName: "RealSociedadDatas", city: "San Sebastián", stadium: "Reale Arena", foundedYear: 1909 },
  { name: "Real Betis", shortName: "RBB", dataFileName: "RealBetisDatas", city: "Seville", stadium: "Benito Villamarín", foundedYear: 1907 },
  { name: "Villarreal CF", shortName: "VIL", dataFileName: "VillarrealDatas", city: "Villarreal", stadium: "Estadio de la Cerámica", foundedYear: 1923 },
  { name: "Sevilla FC", shortName: "SEV", dataFileName: "SevillaDatas", city: "Seville", stadium: "Ramón Sánchez-Pizjuán", foundedYear: 1890 },
  { name: "Valencia CF", shortName: "VCF", dataFileName: "ValenciaDatas", city: "Valencia", stadium: "Mestalla", foundedYear: 1919 },
  { name: "RC Celta de Vigo", shortName: "CEL", dataFileName: "CeltaVigoDatas", city: "Vigo", stadium: "Abanca-Balaídos", foundedYear: 1923 },
  { name: "Getafe CF", shortName: "GET", dataFileName: "GetafeDatas", city: "Getafe", stadium: "Coliseum Alfonso Pérez", foundedYear: 1983 },
  { name: "CA Osasuna", shortName: "OSA", dataFileName: "OsasunaDatas", city: "Pamplona", stadium: "El Sadar", foundedYear: 1920 },
  { name: "RCD Mallorca", shortName: "MLL", dataFileName: "MallorcaDatas", city: "Palma", stadium: "Visit Mallorca Estadi", foundedYear: 1916 },
  { name: "Rayo Vallecano", shortName: "RAY", dataFileName: "RayoVallecanoDatas", city: "Madrid", stadium: "Estadio de Vallecas", foundedYear: 1924 },
  { name: "UD Las Palmas", shortName: "LPA", dataFileName: "LasPalmasDatas", city: "Las Palmas", stadium: "Gran Canaria", foundedYear: 1949 },
  { name: "RCD Espanyol", shortName: "ESP", dataFileName: "EspanyolDatas", city: "Barcelona", stadium: "RCDE Stadium", foundedYear: 1900 },
  { name: "Deportivo Alavés", shortName: "ALA", dataFileName: "AlavesDatas", city: "Vitoria-Gasteiz", stadium: "Mendizorroza", foundedYear: 1921 },
  { name: "CD Leganés", shortName: "LEG", dataFileName: "LeganesDatas", city: "Leganés", stadium: "Estadio Municipal de Butarque", foundedYear: 1928 },
  { name: "Real Valladolid", shortName: "RVA", dataFileName: "ValladolidDatas", city: "Valladolid", stadium: "José Zorrilla", foundedYear: 1928 },
  { name: "Girona FC", shortName: "GIR", dataFileName: "GironaDatas", city: "Girona", stadium: "Estadi Montilivi", foundedYear: 1930 },
];

const PREMIER_LEAGUE_TEAMS: TeamData[] = [
  { name: "Manchester City", shortName: "MCI", dataFileName: "ManCityDatas", city: "Manchester", stadium: "Etihad Stadium", foundedYear: 1880 },
  { name: "Arsenal", shortName: "ARS", dataFileName: "ArsenalDatas", city: "London", stadium: "Emirates Stadium", foundedYear: 1886 },
  { name: "Liverpool", shortName: "LIV", dataFileName: "LiverpoolDatas", city: "Liverpool", stadium: "Anfield", foundedYear: 1892 },
  { name: "Manchester United", shortName: "MUN", dataFileName: "ManUnitedDatas", city: "Manchester", stadium: "Old Trafford", foundedYear: 1878 },
  { name: "Chelsea", shortName: "CHE", dataFileName: "ChelseaDatas", city: "London", stadium: "Stamford Bridge", foundedYear: 1905 },
  { name: "Tottenham Hotspur", shortName: "TOT", dataFileName: "TottenhamDatas", city: "London", stadium: "Tottenham Hotspur Stadium", foundedYear: 1882 },
  { name: "Newcastle United", shortName: "NEW", dataFileName: "NewcastleDatas", city: "Newcastle", stadium: "St James' Park", foundedYear: 1892 },
  { name: "Aston Villa", shortName: "AVL", dataFileName: "AstonVillaDatas", city: "Birmingham", stadium: "Villa Park", foundedYear: 1874 },
  { name: "Brighton & Hove Albion", shortName: "BHA", dataFileName: "BrightonDatas", city: "Brighton", stadium: "Amex Stadium", foundedYear: 1901 },
  { name: "West Ham United", shortName: "WHU", dataFileName: "WestHamDatas", city: "London", stadium: "London Stadium", foundedYear: 1895 },
  { name: "Fulham", shortName: "FUL", dataFileName: "FulhamDatas", city: "London", stadium: "Craven Cottage", foundedYear: 1879 },
  { name: "Brentford", shortName: "BRE", dataFileName: "BrentfordDatas", city: "London", stadium: "Gtech Community Stadium", foundedYear: 1889 },
  { name: "Crystal Palace", shortName: "CRY", dataFileName: "CrystalPalaceDatas", city: "London", stadium: "Selhurst Park", foundedYear: 1905 },
  { name: "Nottingham Forest", shortName: "NFO", dataFileName: "NottinghamForestDatas", city: "Nottingham", stadium: "City Ground", foundedYear: 1865 },
  { name: "Wolverhampton Wanderers", shortName: "WOL", dataFileName: "WolvesDatas", city: "Wolverhampton", stadium: "Molineux Stadium", foundedYear: 1877 },
  { name: "AFC Bournemouth", shortName: "BOU", dataFileName: "BournemouthDatas", city: "Bournemouth", stadium: "Vitality Stadium", foundedYear: 1899 },
  { name: "Everton", shortName: "EVE", dataFileName: "EvertonDatas", city: "Liverpool", stadium: "Goodison Park", foundedYear: 1878 },
  { name: "Leicester City", shortName: "LEI", dataFileName: "LeicesterDatas", city: "Leicester", stadium: "King Power Stadium", foundedYear: 1884 },
  { name: "Ipswich Town", shortName: "IPS", dataFileName: "IpswichDatas", city: "Ipswich", stadium: "Portman Road", foundedYear: 1878 },
  { name: "Southampton", shortName: "SOU", dataFileName: "SouthamptonDatas", city: "Southampton", stadium: "St Mary's Stadium", foundedYear: 1885 },
];

const BUNDESLIGA_TEAMS: TeamData[] = [
  { name: "Bayern Munich", shortName: "FCB", dataFileName: "BayernMunichDatas", city: "Munich", stadium: "Allianz Arena", foundedYear: 1900 },
  { name: "Borussia Dortmund", shortName: "BVB", dataFileName: "BorussiaDortmundDatas", city: "Dortmund", stadium: "Signal Iduna Park", foundedYear: 1909 },
  { name: "RB Leipzig", shortName: "RBL", dataFileName: "RBLeipzigDatas", city: "Leipzig", stadium: "Red Bull Arena", foundedYear: 2009 },
  { name: "Bayer Leverkusen", shortName: "B04", dataFileName: "BayerLeverkusenDatas", city: "Leverkusen", stadium: "BayArena", foundedYear: 1904 },
  { name: "VfB Stuttgart", shortName: "VFB", dataFileName: "StuttgartDatas", city: "Stuttgart", stadium: "MHPArena", foundedYear: 1893 },
  { name: "Eintracht Frankfurt", shortName: "SGE", dataFileName: "EintrachtFrankfurtDatas", city: "Frankfurt", stadium: "Deutsche Bank Park", foundedYear: 1899 },
  { name: "VfL Wolfsburg", shortName: "WOB", dataFileName: "WolfsburgDatas", city: "Wolfsburg", stadium: "Volkswagen Arena", foundedYear: 1945 },
  { name: "Borussia Mönchengladbach", shortName: "BMG", dataFileName: "GladbachDatas", city: "Mönchengladbach", stadium: "Borussia-Park", foundedYear: 1900 },
  { name: "SC Freiburg", shortName: "SCF", dataFileName: "FreiburgDatas", city: "Freiburg", stadium: "Europa-Park Stadion", foundedYear: 1904 },
  { name: "FC Augsburg", shortName: "FCA", dataFileName: "AugsburgDatas", city: "Augsburg", stadium: "WWK Arena", foundedYear: 1907 },
  { name: "1. FC Union Berlin", shortName: "FCU", dataFileName: "UnionBerlinDatas", city: "Berlin", stadium: "Stadion An der Alten Försterei", foundedYear: 1966 },
  { name: "Werder Bremen", shortName: "SVW", dataFileName: "WerderBremenDatas", city: "Bremen", stadium: "Weserstadion", foundedYear: 1899 },
  { name: "1. FSV Mainz 05", shortName: "M05", dataFileName: "MainzDatas", city: "Mainz", stadium: "Mewa Arena", foundedYear: 1905 },
  { name: "TSG Hoffenheim", shortName: "TSG", dataFileName: "HoffenheimDatas", city: "Sinsheim", stadium: "PreZero Arena", foundedYear: 1899 },
  { name: "FC Heidenheim", shortName: "HDH", dataFileName: "HeidenheimDatas", city: "Heidenheim", stadium: "Voith-Arena", foundedYear: 1846 },
  { name: "FC St. Pauli", shortName: "STP", dataFileName: "StPauliDatas", city: "Hamburg", stadium: "Millerntor-Stadion", foundedYear: 1910 },
  { name: "Holstein Kiel", shortName: "KSV", dataFileName: "HolsteinKielDatas", city: "Kiel", stadium: "Holstein-Stadion", foundedYear: 1900 },
  { name: "VfL Bochum", shortName: "BOC", dataFileName: "BochumDatas", city: "Bochum", stadium: "Vonovia Ruhrstadion", foundedYear: 1848 },
];

const SERIE_A_TEAMS: TeamData[] = [
  { name: "Inter Milan", shortName: "INT", dataFileName: "InterMilanDatas", city: "Milan", stadium: "San Siro", foundedYear: 1908 },
  { name: "AC Milan", shortName: "ACM", dataFileName: "ACMilanDatas", city: "Milan", stadium: "San Siro", foundedYear: 1899 },
  { name: "Juventus", shortName: "JUV", dataFileName: "JuventusDatas", city: "Turin", stadium: "Allianz Stadium", foundedYear: 1897 },
  { name: "Napoli", shortName: "NAP", dataFileName: "NapoliDatas", city: "Naples", stadium: "Stadio Diego Armando Maradona", foundedYear: 1926 },
  { name: "AS Roma", shortName: "ROM", dataFileName: "ASRomaDatas", city: "Rome", stadium: "Stadio Olimpico", foundedYear: 1927 },
  { name: "SS Lazio", shortName: "LAZ", dataFileName: "LazioDatas", city: "Rome", stadium: "Stadio Olimpico", foundedYear: 1900 },
  { name: "Atalanta", shortName: "ATA", dataFileName: "AtalantaDatas", city: "Bergamo", stadium: "Gewiss Stadium", foundedYear: 1907 },
  { name: "ACF Fiorentina", shortName: "FIO", dataFileName: "FiorentinaDatas", city: "Florence", stadium: "Stadio Artemio Franchi", foundedYear: 1926 },
  { name: "Bologna FC", shortName: "BOL", dataFileName: "BolognaDatas", city: "Bologna", stadium: "Stadio Renato Dall'Ara", foundedYear: 1909 },
  { name: "Torino FC", shortName: "TOR", dataFileName: "TorinoDatas", city: "Turin", stadium: "Stadio Olimpico Grande Torino", foundedYear: 1906 },
  { name: "Udinese", shortName: "UDI", dataFileName: "UdineseDatas", city: "Udine", stadium: "Bluenergy Stadium", foundedYear: 1896 },
  { name: "Genoa CFC", shortName: "GEN", dataFileName: "GenoaDatas", city: "Genoa", stadium: "Stadio Luigi Ferraris", foundedYear: 1893 },
  { name: "Cagliari", shortName: "CAG", dataFileName: "CagliariDatas", city: "Cagliari", stadium: "Unipol Domus", foundedYear: 1920 },
  { name: "Hellas Verona", shortName: "VER", dataFileName: "VeronaData", city: "Verona", stadium: "Stadio Bentegodi", foundedYear: 1903 },
  { name: "Parma Calcio", shortName: "PAR", dataFileName: "ParmaDatas", city: "Parma", stadium: "Stadio Ennio Tardini", foundedYear: 1913 },
  { name: "Empoli FC", shortName: "EMP", dataFileName: "EmpoliDatas", city: "Empoli", stadium: "Stadio Carlo Castellani", foundedYear: 1920 },
  { name: "Como 1907", shortName: "COM", dataFileName: "ComoDatas", city: "Como", stadium: "Stadio Giuseppe Sinigaglia", foundedYear: 1907 },
  { name: "US Lecce", shortName: "LEC", dataFileName: "LecceDatas", city: "Lecce", stadium: "Stadio Via del Mare", foundedYear: 1908 },
  { name: "Venezia FC", shortName: "VEN", dataFileName: "VeneziaDatas", city: "Venice", stadium: "Stadio Pier Luigi Penzo", foundedYear: 1907 },
  { name: "AC Monza", shortName: "MON", dataFileName: "MonzaDatas", city: "Monza", stadium: "U-Power Stadium", foundedYear: 1912 },
];

export async function initializeAllTeams(): Promise<{ leagues: number; clubs: number }> {
  console.log('[FOOTDATAS] Starting full initialization of Big 5 European leagues...');
  
  await footdatasService.initializeBig5Leagues();
  
  const leagues = await footdatasService.getLeagues();
  const leagueMap: Record<string, number> = {};
  for (const league of leagues) {
    leagueMap[league.code] = league.id;
  }
  
  let clubCount = 0;
  
  const allTeams: { leagueCode: string; teams: TeamData[] }[] = [
    { leagueCode: 'L1', teams: LIGUE_1_TEAMS },
    { leagueCode: 'LL', teams: LALIGA_TEAMS },
    { leagueCode: 'PL', teams: PREMIER_LEAGUE_TEAMS },
    { leagueCode: 'BL', teams: BUNDESLIGA_TEAMS },
    { leagueCode: 'SA', teams: SERIE_A_TEAMS },
  ];
  
  for (const { leagueCode, teams } of allTeams) {
    const leagueId = leagueMap[leagueCode];
    if (!leagueId) {
      console.warn(`[FOOTDATAS] League ${leagueCode} not found, skipping teams`);
      continue;
    }
    
    for (const team of teams) {
      const clubData: InsertFootdatasClub = {
        leagueId,
        name: team.name,
        shortName: team.shortName,
        dataFileName: team.dataFileName,
        city: team.city,
        stadium: team.stadium,
        foundedYear: team.foundedYear,
      };
      
      await footdatasService.upsertClub(clubData);
      clubCount++;
    }
    
    console.log(`[FOOTDATAS] Initialized ${teams.length} teams for ${leagueCode}`);
  }
  
  console.log(`[FOOTDATAS] Initialization complete: 5 leagues, ${clubCount} clubs`);
  return { leagues: 5, clubs: clubCount };
}

export function getTeamMapping(): Map<string, string> {
  const mapping = new Map<string, string>();
  
  const allTeams = [
    ...LIGUE_1_TEAMS.map(t => ({ ...t, league: 'Ligue 1' })),
    ...LALIGA_TEAMS.map(t => ({ ...t, league: 'LaLiga' })),
    ...PREMIER_LEAGUE_TEAMS.map(t => ({ ...t, league: 'Premier League' })),
    ...BUNDESLIGA_TEAMS.map(t => ({ ...t, league: 'Bundesliga' })),
    ...SERIE_A_TEAMS.map(t => ({ ...t, league: 'Serie A' })),
  ];
  
  for (const team of allTeams) {
    mapping.set(team.name.toLowerCase(), team.league);
    mapping.set(team.shortName.toLowerCase(), team.league);
    
    const simpleName = team.name.toLowerCase()
      .replace(/fc |cf |ac |as |rc |sc |afc |1\. |vfl |vfb |tsg |sv |ssc? /gi, '')
      .trim();
    if (simpleName && simpleName !== team.name.toLowerCase()) {
      mapping.set(simpleName, team.league);
    }
  }
  
  return mapping;
}

export const TEAM_TO_LEAGUE_MAP = getTeamMapping();
