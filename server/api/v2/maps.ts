/**
 * Google Maps / Geocoding / Places API routes
 * Endpoint: /api/v2/maps/*
 * 
 * Server-side proxy to keep GOOGLE_MAPS_API_KEY secure.
 * Falls back to Nominatim if no Google API key is configured.
 */

import { Router, Request, Response } from "express";
import { googleMapsService } from "../../services/googleMapsService";
import { z } from "zod";

const router = Router();

/**
 * GET /api/v2/maps/geocode?address=...
 * Forward geocode: address → lat/lng
 */
router.get("/geocode", async (req: Request, res: Response) => {
    try {
        const schema = z.object({ address: z.string().min(1).max(500) });
        const { address } = schema.parse(req.query);

        const result = await googleMapsService.geocode(address);
        if (!result) {
            return res.status(404).json({ error: "Address not found" });
        }
        res.json(result);
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: "Missing or invalid 'address' query parameter" });
        }
        console.error("[Maps API] Geocode error:", error);
        res.status(500).json({ error: "Geocoding failed" });
    }
});

/**
 * GET /api/v2/maps/reverse?lat=...&lng=...
 * Reverse geocode: lat/lng → address
 */
router.get("/reverse", async (req: Request, res: Response) => {
    try {
        const schema = z.object({
            lat: z.coerce.number().min(-90).max(90),
            lng: z.coerce.number().min(-180).max(180),
        });
        const { lat, lng } = schema.parse(req.query);

        const result = await googleMapsService.reverseGeocode(lat, lng);
        if (!result) {
            return res.status(404).json({ error: "No address found for these coordinates" });
        }
        res.json(result);
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: "Invalid lat/lng parameters" });
        }
        console.error("[Maps API] Reverse geocode error:", error);
        res.status(500).json({ error: "Reverse geocoding failed" });
    }
});

/**
 * GET /api/v2/maps/places/nearby?query=...&lat=...&lng=...&radius=5000&limit=5
 * Search for nearby places around a location
 */
router.get("/places/nearby", async (req: Request, res: Response) => {
    try {
        const schema = z.object({
            query: z.string().min(1).max(200),
            lat: z.coerce.number().min(-90).max(90),
            lng: z.coerce.number().min(-180).max(180),
            radius: z.coerce.number().min(100).max(50000).optional().default(5000),
            limit: z.coerce.number().min(1).max(20).optional().default(5),
        });
        const { query, lat, lng, radius, limit } = schema.parse(req.query);

        const results = await googleMapsService.searchNearbyPlaces(query, lat, lng, radius, limit);
        res.json({ count: results.length, places: results });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: "Invalid parameters", details: error.errors });
        }
        console.error("[Maps API] Places nearby error:", error);
        res.status(500).json({ error: "Places search failed" });
    }
});

/**
 * GET /api/v2/maps/places/search?query=...&limit=5
 * Text-based place search (no location bias)
 */
router.get("/places/search", async (req: Request, res: Response) => {
    try {
        const schema = z.object({
            query: z.string().min(1).max(200),
            limit: z.coerce.number().min(1).max(20).optional().default(5),
        });
        const { query, limit } = schema.parse(req.query);

        const results = await googleMapsService.searchPlacesByText(query, limit);
        res.json({ count: results.length, places: results });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: "Invalid parameters" });
        }
        console.error("[Maps API] Places search error:", error);
        res.status(500).json({ error: "Places search failed" });
    }
});

/**
 * GET /api/v2/maps/status
 * Check Google Maps API availability
 */
router.get("/status", (_req: Request, res: Response) => {
    res.json({
        googleAvailable: googleMapsService.isGoogleAvailable,
        fallback: "nominatim",
        endpoints: [
            "GET /api/v2/maps/geocode?address=...",
            "GET /api/v2/maps/reverse?lat=...&lng=...",
            "GET /api/v2/maps/places/nearby?query=...&lat=...&lng=...&radius=...&limit=...",
            "GET /api/v2/maps/places/search?query=...&limit=...",
        ],
    });
});

export default router;
