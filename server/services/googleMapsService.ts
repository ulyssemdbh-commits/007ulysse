/**
 * Google Maps Service - Geocoding & Places API integration
 * 
 * Proxied through the server to:
 * 1. Keep API key secure (never exposed to client)
 * 2. Add caching to reduce costs
 * 3. Fallback to Nominatim if Google quota exceeded
 */

// Simple LRU-like cache
interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

class SimpleCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private maxSize: number;
    private ttlMs: number;

    constructor(maxSize = 500, ttlMinutes = 60) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMinutes * 60 * 1000;
    }

    get(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }

    set(key: string, data: T): void {
        if (this.cache.size >= this.maxSize) {
            // Evict oldest entry
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
        }
        this.cache.set(key, { data, expiresAt: Date.now() + this.ttlMs });
    }
}

export interface GeocodingResult {
    lat: number;
    lng: number;
    formattedAddress: string;
    placeId?: string;
    source: "google" | "nominatim";
}

export interface ReverseGeocodingResult {
    formattedAddress: string;
    road?: string;
    houseNumber?: string;
    city?: string;
    postalCode?: string;
    country?: string;
    placeId?: string;
    source: "google" | "nominatim";
}

export interface PlaceResult {
    name: string;
    address: string;
    lat: number;
    lng: number;
    placeId: string;
    types: string[];
    rating?: number;
    openNow?: boolean;
    distance?: number; // meters from search location
    source: "google" | "nominatim";
}

class GoogleMapsService {
    private apiKey: string | null;
    private geocodeCache = new SimpleCache<GeocodingResult>(500, 120); // 2h cache
    private reverseCache = new SimpleCache<ReverseGeocodingResult>(500, 120);
    private placesCache = new SimpleCache<PlaceResult[]>(200, 30); // 30min for places (more dynamic)

    constructor() {
        this.apiKey = process.env.GOOGLE_MAPS_API_KEY || null;
        if (this.apiKey) {
            console.log("[GoogleMaps] API key configured - using Google Geocoding + Places");
        } else {
            console.log("[GoogleMaps] No API key - falling back to Nominatim/OSM");
        }
    }

    /**
     * Forward geocoding: address → coordinates
     */
    async geocode(address: string): Promise<GeocodingResult | null> {
        const cacheKey = `geo:${address.toLowerCase().trim()}`;
        const cached = this.geocodeCache.get(cacheKey);
        if (cached) return cached;

        // Try Google first
        if (this.apiKey) {
            try {
                const result = await this.googleGeocode(address);
                if (result) {
                    this.geocodeCache.set(cacheKey, result);
                    return result;
                }
            } catch (err) {
                console.warn("[GoogleMaps] Geocoding failed, falling back to Nominatim:", err);
            }
        }

        // Fallback to Nominatim
        const result = await this.nominatimGeocode(address);
        if (result) {
            this.geocodeCache.set(cacheKey, result);
        }
        return result;
    }

    /**
     * Reverse geocoding: coordinates → address
     */
    async reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodingResult | null> {
        const cacheKey = `rev:${lat.toFixed(5)},${lng.toFixed(5)}`;
        const cached = this.reverseCache.get(cacheKey);
        if (cached) return cached;

        if (this.apiKey) {
            try {
                const result = await this.googleReverseGeocode(lat, lng);
                if (result) {
                    this.reverseCache.set(cacheKey, result);
                    return result;
                }
            } catch (err) {
                console.warn("[GoogleMaps] Reverse geocoding failed, falling back:", err);
            }
        }

        const result = await this.nominatimReverseGeocode(lat, lng);
        if (result) {
            this.reverseCache.set(cacheKey, result);
        }
        return result;
    }

    /**
     * Nearby places search: find places around a location
     */
    async searchNearbyPlaces(
        query: string,
        lat: number,
        lng: number,
        radiusMeters = 5000,
        maxResults = 5
    ): Promise<PlaceResult[]> {
        const cacheKey = `places:${query.toLowerCase()}:${lat.toFixed(3)},${lng.toFixed(3)}:${radiusMeters}`;
        const cached = this.placesCache.get(cacheKey);
        if (cached) return cached;

        if (this.apiKey) {
            try {
                const results = await this.googlePlacesSearch(query, lat, lng, radiusMeters, maxResults);
                if (results.length > 0) {
                    this.placesCache.set(cacheKey, results);
                    return results;
                }
            } catch (err) {
                console.warn("[GoogleMaps] Places search failed, falling back:", err);
            }
        }

        // Fallback to Nominatim search
        const results = await this.nominatimPlacesSearch(query, lat, lng, maxResults);
        if (results.length > 0) {
            this.placesCache.set(cacheKey, results);
        }
        return results;
    }

    /**
     * Text search for places (without location bias)
     */
    async searchPlacesByText(query: string, maxResults = 5): Promise<PlaceResult[]> {
        const cacheKey = `text:${query.toLowerCase()}`;
        const cached = this.placesCache.get(cacheKey);
        if (cached) return cached;

        if (this.apiKey) {
            try {
                const results = await this.googleTextSearch(query, maxResults);
                if (results.length > 0) {
                    this.placesCache.set(cacheKey, results);
                    return results;
                }
            } catch (err) {
                console.warn("[GoogleMaps] Text search failed, falling back:", err);
            }
        }

        const results = await this.nominatimPlacesSearch(query, 0, 0, maxResults);
        if (results.length > 0) {
            this.placesCache.set(cacheKey, results);
        }
        return results;
    }

    // ========================= GOOGLE APIs =========================

    private async googleGeocode(address: string): Promise<GeocodingResult | null> {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&language=fr&key=${this.apiKey}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const data = await response.json();

        if (data.status !== "OK" || !data.results?.length) {
            console.log(`[GoogleMaps] Geocode status: ${data.status} for "${address}"`);
            return null;
        }

        const result = data.results[0];
        return {
            lat: result.geometry.location.lat,
            lng: result.geometry.location.lng,
            formattedAddress: result.formatted_address,
            placeId: result.place_id,
            source: "google",
        };
    }

    private async googleReverseGeocode(lat: number, lng: number): Promise<ReverseGeocodingResult | null> {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=fr&key=${this.apiKey}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const data = await response.json();

        if (data.status !== "OK" || !data.results?.length) return null;

        const result = data.results[0];
        const components = result.address_components || [];

        const getComponent = (type: string) =>
            components.find((c: any) => c.types.includes(type))?.long_name;

        return {
            formattedAddress: result.formatted_address,
            road: getComponent("route"),
            houseNumber: getComponent("street_number"),
            city: getComponent("locality") || getComponent("administrative_area_level_2"),
            postalCode: getComponent("postal_code"),
            country: getComponent("country"),
            placeId: result.place_id,
            source: "google",
        };
    }

    private async googlePlacesSearch(
        query: string,
        lat: number,
        lng: number,
        radiusMeters: number,
        maxResults: number
    ): Promise<PlaceResult[]> {
        // Use Places API (New) - Text Search
        const url = "https://places.googleapis.com/v1/places:searchText";
        const body = {
            textQuery: query,
            locationBias: {
                circle: {
                    center: { latitude: lat, longitude: lng },
                    radius: radiusMeters,
                },
            },
            languageCode: "fr",
            maxResultCount: maxResults,
        };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": this.apiKey!,
                "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.id,places.types,places.rating,places.currentOpeningHours",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(5000),
        });

        const data = await response.json();
        if (!data.places?.length) return [];

        return data.places.map((place: any) => {
            const placeLat = place.location?.latitude || 0;
            const placeLng = place.location?.longitude || 0;
            return {
                name: place.displayName?.text || "",
                address: place.formattedAddress || "",
                lat: placeLat,
                lng: placeLng,
                placeId: place.id || "",
                types: place.types || [],
                rating: place.rating,
                openNow: place.currentOpeningHours?.openNow,
                distance: this.haversineDistance(lat, lng, placeLat, placeLng),
                source: "google" as const,
            };
        });
    }

    private async googleTextSearch(query: string, maxResults: number): Promise<PlaceResult[]> {
        const url = "https://places.googleapis.com/v1/places:searchText";
        const body = {
            textQuery: query,
            languageCode: "fr",
            maxResultCount: maxResults,
        };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": this.apiKey!,
                "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.id,places.types,places.rating",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(5000),
        });

        const data = await response.json();
        if (!data.places?.length) return [];

        return data.places.map((place: any) => ({
            name: place.displayName?.text || "",
            address: place.formattedAddress || "",
            lat: place.location?.latitude || 0,
            lng: place.location?.longitude || 0,
            placeId: place.id || "",
            types: place.types || [],
            rating: place.rating,
            source: "google" as const,
        }));
    }

    // ========================= NOMINATIM FALLBACK =========================

    private lastNominatimCall = 0;
    private async nominatimThrottle(): Promise<void> {
        const now = Date.now();
        const wait = Math.max(0, 1100 - (now - this.lastNominatimCall));
        this.lastNominatimCall = now + wait;
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }

    private async nominatimGeocode(address: string): Promise<GeocodingResult | null> {
        await this.nominatimThrottle();
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&addressdetails=1`;
        const response = await fetch(url, {
            headers: { "User-Agent": "UlysseApp/1.0 (ulyssepro.org)" },
            signal: AbortSignal.timeout(5000),
        });
        const results = await response.json();

        if (!results?.length) return null;

        return {
            lat: parseFloat(results[0].lat),
            lng: parseFloat(results[0].lon),
            formattedAddress: results[0].display_name,
            source: "nominatim",
        };
    }

    private async nominatimReverseGeocode(lat: number, lng: number): Promise<ReverseGeocodingResult | null> {
        await this.nominatimThrottle();
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;
        const response = await fetch(url, {
            headers: { "User-Agent": "UlysseApp/1.0 (ulyssepro.org)" },
            signal: AbortSignal.timeout(5000),
        });
        const data = await response.json();

        if (!data?.address) return null;

        const addr = data.address;
        return {
            formattedAddress: data.display_name,
            road: addr.road || addr.pedestrian || addr.footway,
            houseNumber: addr.house_number,
            city: addr.city || addr.town || addr.village,
            postalCode: addr.postcode,
            country: addr.country,
            source: "nominatim",
        };
    }

    private async nominatimPlacesSearch(
        query: string,
        lat: number,
        lng: number,
        maxResults: number
    ): Promise<PlaceResult[]> {
        await this.nominatimThrottle();
        let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${maxResults}&addressdetails=1`;

        // Add location bias if provided
        if (lat !== 0 && lng !== 0) {
            const viewbox = `${lng - 0.1},${lat + 0.1},${lng + 0.1},${lat - 0.1}`;
            url += `&viewbox=${viewbox}&bounded=0`;
        }

        const response = await fetch(url, {
            headers: { "User-Agent": "UlysseApp/1.0 (ulyssepro.org)" },
            signal: AbortSignal.timeout(5000),
        });
        const results = await response.json();

        if (!results?.length) return [];

        return results.map((r: any) => ({
            name: r.name || r.display_name?.split(",")[0] || "",
            address: r.display_name || "",
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
            placeId: `nominatim:${r.osm_id}`,
            types: r.type ? [r.type] : [],
            distance: lat !== 0 ? this.haversineDistance(lat, lng, parseFloat(r.lat), parseFloat(r.lon)) : undefined,
            source: "nominatim" as const,
        }));
    }

    // ========================= UTILS =========================

    private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /** Check if Google APIs are available */
    get isGoogleAvailable(): boolean {
        return !!this.apiKey;
    }
}

export const googleMapsService = new GoogleMapsService();
