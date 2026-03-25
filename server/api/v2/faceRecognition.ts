import { Router, Request, Response } from "express";
import { z } from "zod";
import * as faceRecognitionService from "../../services/faceRecognitionService";
import * as faceCatalogService from "../../services/faceCatalogService";

const router = Router();

const createPersonSchema = z.object({
  name: z.string().min(1).max(100),
  notes: z.string().optional(),
  isOwner: z.boolean().optional(),
});

const addDescriptorSchema = z.object({
  personId: z.number().optional(),
  descriptor: z.array(z.number()),
  sourceMediaId: z.number().optional(),
  quality: z.number().optional(),
});

const matchFaceSchema = z.object({
  descriptor: z.array(z.number()),
});

const analyzeFacesSchema = z.object({
  mediaId: z.number(),
  faces: z.array(z.object({
    descriptor: z.array(z.number()),
    box: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
    confidence: z.number(),
  })),
});

const confirmFaceSchema = z.object({
  personId: z.number(),
});

router.get("/persons", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const persons = await faceRecognitionService.getPersons(userId);
    res.json(persons);
  } catch (error) {
    console.error("[FaceRecognition] Error getting persons:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/persons/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const personId = parseInt(req.params.id);
    const person = await faceRecognitionService.getPerson(userId, personId);
    
    if (!person) {
      return res.status(404).json({ error: "Personne non trouvée" });
    }
    
    res.json(person);
  } catch (error) {
    console.error("[FaceRecognition] Error getting person:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/persons", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const data = createPersonSchema.parse(req.body);
    const person = await faceRecognitionService.createPerson({
      userId,
      name: data.name,
      notes: data.notes,
      isOwner: data.isOwner ?? false,
    });
    
    res.status(201).json(person);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    }
    console.error("[FaceRecognition] Error creating person:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.patch("/persons/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const personId = parseInt(req.params.id);
    const data = createPersonSchema.partial().parse(req.body);
    
    const person = await faceRecognitionService.updatePerson(userId, personId, data);
    
    if (!person) {
      return res.status(404).json({ error: "Personne non trouvée" });
    }
    
    res.json(person);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    }
    console.error("[FaceRecognition] Error updating person:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.delete("/persons/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const personId = parseInt(req.params.id);
    const deleted = await faceRecognitionService.deletePerson(userId, personId);
    
    if (!deleted) {
      return res.status(404).json({ error: "Personne non trouvée" });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("[FaceRecognition] Error deleting person:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/persons/:id/descriptors", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const personId = parseInt(req.params.id);
    const descriptors = await faceRecognitionService.getPersonDescriptors(userId, personId);
    
    res.json(descriptors);
  } catch (error) {
    console.error("[FaceRecognition] Error getting descriptors:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/descriptors", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const data = addDescriptorSchema.parse(req.body);
    const descriptor = await faceRecognitionService.addDescriptor({
      userId,
      personId: data.personId,
      descriptor: data.descriptor,
      sourceMediaId: data.sourceMediaId,
      quality: data.quality ?? 0,
    });
    
    res.status(201).json(descriptor);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    }
    console.error("[FaceRecognition] Error adding descriptor:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.delete("/descriptors/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const descriptorId = parseInt(req.params.id);
    const deleted = await faceRecognitionService.deleteDescriptor(userId, descriptorId);
    
    if (!deleted) {
      return res.status(404).json({ error: "Descripteur non trouvé" });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("[FaceRecognition] Error deleting descriptor:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/match", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const data = matchFaceSchema.parse(req.body);
    const match = await faceRecognitionService.matchFace(userId, data.descriptor);
    
    res.json({ match });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    }
    console.error("[FaceRecognition] Error matching face:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/analyze", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const data = analyzeFacesSchema.parse(req.body);
    const results = await faceRecognitionService.analyzeMediaForFaces(
      userId,
      data.mediaId,
      data.faces
    );
    
    res.json(results);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    }
    console.error("[FaceRecognition] Error analyzing faces:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/media/:mediaId/faces", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const mediaId = parseInt(req.params.mediaId);
    const faces = await faceRecognitionService.getMediaFaces(mediaId);
    
    res.json(faces);
  } catch (error) {
    console.error("[FaceRecognition] Error getting media faces:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/media-faces/:faceId/confirm", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const faceId = parseInt(req.params.faceId);
    const data = confirmFaceSchema.parse(req.body);
    
    const face = await faceRecognitionService.confirmMediaFace(faceId, data.personId);
    
    if (!face) {
      return res.status(404).json({ error: "Visage non trouvé" });
    }
    
    res.json(face);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    }
    console.error("[FaceRecognition] Error confirming face:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/persons/:id/media", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const personId = parseInt(req.params.id);
    const detailed = req.query.detailed === "true";
    
    if (detailed) {
      const media = await faceRecognitionService.getMediaByPersonWithDetails(userId, personId);
      return res.json(media);
    }
    
    const media = await faceRecognitionService.getMediaByPerson(userId, personId);
    res.json(media);
  } catch (error) {
    console.error("[FaceRecognition] Error getting person media:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/persons/search/:name", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const name = req.params.name;
    const person = await faceRecognitionService.searchPersonByName(userId, name);
    
    if (!person) {
      return res.status(404).json({ error: "Personne non trouvée" });
    }
    
    const media = await faceRecognitionService.getMediaByPersonWithDetails(userId, person.id);
    
    res.json({
      person,
      mediaCount: media.length,
      media: media.slice(0, 20),
    });
  } catch (error) {
    console.error("[FaceRecognition] Error searching person:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/all-with-descriptors", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const data = await faceRecognitionService.getAllDescriptorsWithPersons(userId);
    
    const result = data.map(({ person, descriptors }) => ({
      id: person.id,
      name: person.name,
      descriptors,
      photoCount: person.photoCount,
      createdAt: person.createdAt,
    }));
    
    res.json(result);
  } catch (error) {
    console.error("[FaceRecognition] Error getting all descriptors:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/match-multiple", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const data = matchFaceSchema.parse(req.body);
    const limit = parseInt(req.query.limit as string) || 3;
    const matches = await faceRecognitionService.matchFaceMultiple(userId, data.descriptor, limit);
    
    res.json({ matches });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    }
    console.error("[FaceRecognition] Error matching faces:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/stats", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const stats = await faceRecognitionService.getStats(userId);
    res.json(stats);
  } catch (error) {
    console.error("[FaceRecognition] Error getting stats:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/persons/:id/optimize", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const personId = parseInt(req.params.id);
    const removed = await faceRecognitionService.optimizeDescriptors(userId, personId);
    
    res.json({ success: true, removedDescriptors: removed });
  } catch (error) {
    console.error("[FaceRecognition] Error optimizing descriptors:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/identify-live", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const { faces } = req.body;
    if (!Array.isArray(faces)) {
      return res.status(400).json({ error: "Format invalide" });
    }
    
    const results = await Promise.all(
      faces.map(async (face: { descriptor: number[]; box: { x: number; y: number; width: number; height: number } }) => {
        const match = await faceRecognitionService.matchFace(userId, face.descriptor);
        return {
          box: face.box,
          match: match ? {
            personId: match.personId,
            personName: match.personName,
            confidence: match.confidence,
            matchType: match.matchType,
          } : null,
        };
      })
    );
    
    res.json({ results });
  } catch (error) {
    console.error("[FaceRecognition] Error in live identification:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/persons/:id/media", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const personId = parseInt(req.params.id);
    const person = await faceRecognitionService.getPerson(userId, personId);
    
    if (!person) {
      return res.status(404).json({ error: "Personne non trouvée" });
    }
    
    const mediaItems = await faceRecognitionService.getMediaByPerson(userId, personId);
    
    res.json({
      person: {
        id: person.id,
        name: person.name,
      },
      media: mediaItems,
      count: mediaItems.length,
    });
  } catch (error) {
    console.error("[FaceRecognition] Error getting media by person:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

const catalogImageSchema = z.object({
  imageUrl: z.string().url(),
  personName: z.string().min(1),
  storagePath: z.string().optional(),
  fileName: z.string().optional(),
});

router.post("/catalog", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const validation = catalogImageSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Données invalides", details: validation.error.errors });
    }
    
    const { imageUrl, personName, storagePath, fileName } = validation.data;
    
    if (!storagePath || !fileName) {
      return res.status(400).json({ 
        error: "storagePath et fileName requis",
        hint: "L'image doit être stockée dans le système avant catalogage. Utilisez l'upload média ou la recherche d'images automatique."
      });
    }
    
    const result = await faceCatalogService.catalogImageFromSearch(
      userId, 
      { 
        imageUrl, 
        storagePath, 
        fileName 
      }, 
      personName
    );
    
    res.json(result);
  } catch (error) {
    console.error("[FaceRecognition] Error cataloging image:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/catalog/stats", async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    
    const stats = await faceCatalogService.getCatalogStats(userId);
    res.json(stats);
  } catch (error) {
    console.error("[FaceRecognition] Error getting catalog stats:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
