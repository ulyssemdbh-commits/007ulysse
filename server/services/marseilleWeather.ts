export interface MarseilleData {
  time: string;
  date: string;
  dateShort: string;
  weather: {
    temperature: string;
    condition: string;
    humidity: string;
    wind: string;
    icon: string;
  };
  location: string;
  lastUpdated: string;
}

const MARSEILLE_LAT = 43.2965;
const MARSEILLE_LON = 5.3698;

const weatherCodeToCondition: Record<number, { label: string; icon: string }> = {
  0: { label: "Ciel clair", icon: "sun" },
  1: { label: "Principalement clair", icon: "sun" },
  2: { label: "Partiellement nuageux", icon: "cloud-sun" },
  3: { label: "Couvert", icon: "cloud" },
  45: { label: "Brouillard", icon: "cloud-fog" },
  48: { label: "Brouillard givrant", icon: "cloud-fog" },
  51: { label: "Bruine legere", icon: "cloud-drizzle" },
  53: { label: "Bruine moderee", icon: "cloud-drizzle" },
  55: { label: "Bruine dense", icon: "cloud-drizzle" },
  61: { label: "Pluie legere", icon: "cloud-rain" },
  63: { label: "Pluie moderee", icon: "cloud-rain" },
  65: { label: "Pluie forte", icon: "cloud-rain" },
  71: { label: "Neige legere", icon: "snowflake" },
  73: { label: "Neige moderee", icon: "snowflake" },
  75: { label: "Neige forte", icon: "snowflake" },
  80: { label: "Averses legeres", icon: "cloud-rain" },
  81: { label: "Averses moderees", icon: "cloud-rain" },
  82: { label: "Averses violentes", icon: "cloud-rain" },
  95: { label: "Orage", icon: "cloud-lightning" },
  96: { label: "Orage avec grele", icon: "cloud-lightning" },
  99: { label: "Orage violent", icon: "cloud-lightning" },
};

let cachedData: MarseilleData | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 heure - synchronisation horaire

// Force refresh des données météo (appelé par le job scheduler)
export async function refreshWeatherCache(): Promise<void> {
  console.log("[MarseilleWeather] Synchronisation horaire des données météo...");
  lastFetchTime = 0; // Force le refresh
  await fetchMarseilleData();
  console.log("[MarseilleWeather] Données météo synchronisées:", cachedData?.weather.temperature, cachedData?.weather.condition);
}

// Retourne les infos du cache pour diagnostic
export function getCacheInfo(): { lastUpdate: Date | null; hasData: boolean } {
  return {
    lastUpdate: lastFetchTime ? new Date(lastFetchTime) : null,
    hasData: !!cachedData
  };
}

export async function fetchMarseilleData(): Promise<MarseilleData> {
  const now = Date.now();
  
  if (cachedData && now - lastFetchTime < CACHE_DURATION) {
    const currentTime = new Date().toLocaleTimeString("fr-FR", { 
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    return { ...cachedData, time: currentTime };
  }

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", MARSEILLE_LAT.toString());
    url.searchParams.set("longitude", MARSEILLE_LON.toString());
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m");
    url.searchParams.set("timezone", "Europe/Paris");

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const json = await response.json() as {
      current: {
        temperature_2m: number;
        relative_humidity_2m: number;
        weather_code: number;
        wind_speed_10m: number;
      };
    };

    const current = json.current;
    const weatherInfo = weatherCodeToCondition[current.weather_code] || { label: "Inconnu", icon: "cloud" };

    const parisTime = new Date().toLocaleTimeString("fr-FR", { 
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    const parisDate = new Date().toLocaleDateString("fr-FR", {
      timeZone: "Europe/Paris",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });

    const parisDateShort = new Date().toLocaleDateString("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });

    const data: MarseilleData = {
      time: parisTime,
      date: parisDate.charAt(0).toUpperCase() + parisDate.slice(1),
      dateShort: parisDateShort,
      weather: {
        temperature: `${Math.round(current.temperature_2m)}°C`,
        condition: weatherInfo.label,
        humidity: `${current.relative_humidity_2m}%`,
        wind: `${Math.round(current.wind_speed_10m)} km/h`,
        icon: weatherInfo.icon,
      },
      location: "Marseille, France",
      lastUpdated: new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" }),
    };

    cachedData = data;
    lastFetchTime = now;

    return data;
  } catch (error) {
    console.error("Error fetching weather data:", error);
    
    const fallbackTime = new Date().toLocaleTimeString("fr-FR", { 
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    
    const fallbackDate = new Date().toLocaleDateString("fr-FR", {
      timeZone: "Europe/Paris",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });

    const fallbackDateShort = new Date().toLocaleDateString("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });

    if (cachedData) {
      return { ...cachedData, time: fallbackTime };
    }

    return {
      time: fallbackTime,
      date: fallbackDate.charAt(0).toUpperCase() + fallbackDate.slice(1),
      dateShort: fallbackDateShort,
      weather: {
        temperature: "--°C",
        condition: "Indisponible",
        humidity: "--%",
        wind: "-- km/h",
        icon: "cloud",
      },
      location: "Marseille, France",
      lastUpdated: new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" }),
    };
  }
}
