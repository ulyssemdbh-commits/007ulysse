import { db } from "../db";
import { ulysseFiles, knownPersons, faceDescriptors, mediaLibrary, mediaFaces } from "@shared/schema";
import { eq, and, like, desc, sql } from "drizzle-orm";
import * as faceRecognitionService from "./faceRecognitionService";
import { persistentStorageService } from "./persistentStorageService";
import OpenAI from "openai";

// Use AI Integrations for Replit Core compatibility
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface PersonNameExtraction {
  isPersonName: boolean;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  confidence: number;
}

interface FaceDetectionResult {
  hasFaces: boolean;
  faceCount: number;
  primaryFaceBox?: { x: number; y: number; width: number; height: number };
  quality: number;
  isGoodForRecognition: boolean;
}

interface CatalogResult {
  success: boolean;
  personId?: number;
  personName?: string;
  isNewPerson: boolean;
  descriptorAdded: boolean;
  message: string;
}

const PERSON_NAME_PATTERNS = [
  /^[A-ZÀ-Ÿ][a-zà-ÿ]+\s+[A-ZÀ-Ÿ][a-zà-ÿ]+$/,
  /^[A-ZÀ-Ÿ][a-zà-ÿ]+\s+[A-ZÀ-Ÿ][a-zà-ÿ]+\s+[A-ZÀ-Ÿ][a-zà-ÿ]+$/,
  /^[A-ZÀ-Ÿ][a-zà-ÿ]+$/,
];

const FAMOUS_PERSON_KEYWORDS = [
  'président', 'acteur', 'actrice', 'chanteur', 'chanteuse', 
  'politicien', 'ministre', 'sportif', 'joueur', 'célébrité',
  'president', 'actor', 'actress', 'singer', 'politician'
];

const NOISE_WORDS_TO_STRIP = [
  'photos', 'photo', 'images', 'image', 'pictures', 'picture',
  'photos de', 'images de', 'photo de', 'image de',
  'montre', 'montrer', 'cherche', 'chercher', 'trouve', 'trouver',
  'show', 'find', 'search', 'get',
  'visage', 'visages', 'face', 'faces',
  'portrait', 'portraits'
];

function cleanSearchQuery(query: string): string {
  let cleaned = query.trim();
  
  for (const noise of NOISE_WORDS_TO_STRIP) {
    const pattern = new RegExp(`\\b${noise}\\b`, 'gi');
    cleaned = cleaned.replace(pattern, '');
  }
  
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  const words = cleaned.split(' ');
  const capitalizedWords = words.map(w => 
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  );
  
  return capitalizedWords.join(' ');
}

export function extractPersonName(query: string): PersonNameExtraction {
  const cleanQuery = cleanSearchQuery(query);
  
  const hasFamousKeyword = FAMOUS_PERSON_KEYWORDS.some(kw => 
    cleanQuery.toLowerCase().includes(kw)
  );
  
  for (const pattern of PERSON_NAME_PATTERNS) {
    if (pattern.test(cleanQuery)) {
      const parts = cleanQuery.split(/\s+/);
      return {
        isPersonName: true,
        firstName: parts[0],
        lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
        fullName: cleanQuery,
        confidence: hasFamousKeyword ? 0.95 : 0.85
      };
    }
  }
  
  const wordCount = cleanQuery.split(/\s+/).length;
  if (wordCount >= 2 && wordCount <= 4) {
    const words = cleanQuery.split(/\s+/);
    const allCapitalized = words.every(w => /^[A-ZÀ-Ÿ]/.test(w));
    
    if (allCapitalized) {
      return {
        isPersonName: true,
        firstName: words[0],
        lastName: words.slice(1).join(' '),
        fullName: cleanQuery,
        confidence: 0.7
      };
    }
  }
  
  return { isPersonName: false, confidence: 0 };
}

export async function analyzeImageForFaces(imageUrl: string): Promise<FaceDetectionResult> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a face detection analyzer. Analyze the image and respond with ONLY valid JSON:
{
  "hasFaces": boolean,
  "faceCount": number,
  "primaryFaceBox": { "x": 0-100, "y": 0-100, "width": 0-100, "height": 0-100 } or null,
  "quality": 0.0-1.0 (face clarity/size),
  "isGoodForRecognition": boolean (face is clear, frontal, well-lit)
}
Provide x,y,width,height as percentages of image dimensions.`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this image for faces. How many faces? Is the primary face suitable for recognition training?" },
            { type: "image_url", image_url: { url: imageUrl, detail: "low" } }
          ]
        }
      ],
      max_tokens: 200,
      temperature: 0.1
    });

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      let result: any = {};
      try { result = JSON.parse(jsonMatch[0]); } catch { console.warn("[FaceCatalog] Failed to parse AI face detection response"); }
      return {
        hasFaces: result.hasFaces || false,
        faceCount: result.faceCount || 0,
        primaryFaceBox: result.primaryFaceBox || undefined,
        quality: result.quality || 0,
        isGoodForRecognition: result.isGoodForRecognition || false
      };
    }
    
    return { hasFaces: false, faceCount: 0, quality: 0, isGoodForRecognition: false };
  } catch (error) {
    console.error('[FaceCatalog] Face analysis failed:', error);
    return { hasFaces: false, faceCount: 0, quality: 0, isGoodForRecognition: false };
  }
}


export interface CatalogImageInput {
  imageUrl: string;
  storagePath?: string;
  buffer?: Buffer;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export async function catalogImageFromSearch(
  userId: number,
  input: CatalogImageInput,
  searchQuery: string
): Promise<CatalogResult> {
  console.log(`[FaceCatalog] Processing image for query: "${searchQuery}"`);
  
  const nameExtraction = extractPersonName(searchQuery);
  
  if (!nameExtraction.isPersonName) {
    console.log(`[FaceCatalog] Query "${searchQuery}" does not appear to be a person name`);
    return {
      success: false,
      isNewPerson: false,
      descriptorAdded: false,
      message: "Query is not a person name"
    };
  }
  
  const faceAnalysis = await analyzeImageForFaces(input.imageUrl);
  
  if (!faceAnalysis.hasFaces) {
    console.log(`[FaceCatalog] No faces detected in image`);
    return {
      success: false,
      isNewPerson: false,
      descriptorAdded: false,
      message: "No faces detected"
    };
  }
  
  const existingPersons = await db.select()
    .from(knownPersons)
    .where(and(
      eq(knownPersons.userId, userId),
      sql`LOWER(${knownPersons.name}) = LOWER(${nameExtraction.fullName})`
    ))
    .limit(1);
  
  let personId: number;
  let isNewPerson = false;
  
  if (existingPersons.length > 0) {
    personId = existingPersons[0].id;
    console.log(`[FaceCatalog] Found existing person: ${existingPersons[0].name} (ID: ${personId})`);
  } else {
    const [newPerson] = await db.insert(knownPersons).values({
      userId,
      name: nameExtraction.fullName!,
      notes: `Auto-cataloged from search: "${searchQuery}"`,
      photoCount: 0,
      lastSeenAt: new Date(),
    }).returning();
    
    personId = newPerson.id;
    isNewPerson = true;
    console.log(`[FaceCatalog] Created new person: ${nameExtraction.fullName} (ID: ${personId})`);
  }
  
  let mediaId: number | null = null;
  
  if (input.storagePath && input.fileName) {
    try {
      const [mediaEntry] = await db.insert(mediaLibrary).values({
        userId,
        type: 'photo',
        filename: input.fileName,
        originalName: input.fileName,
        mimeType: input.mimeType || 'image/jpeg',
        sizeBytes: input.sizeBytes || input.buffer?.length || 0,
        storagePath: input.storagePath,
        description: `Face training: ${nameExtraction.fullName} | Source: ${searchQuery}`,
        tags: ['face-training', nameExtraction.fullName!.toLowerCase().replace(/\s+/g, '-')],
      }).returning();
      
      mediaId = mediaEntry.id;
      
      const box = faceAnalysis.primaryFaceBox || { x: 25, y: 25, width: 50, height: 50 };
      await faceRecognitionService.addMediaFace({
        mediaId: mediaId,
        personId: personId,
        confidence: faceAnalysis.quality,
        boxX: box.x,
        boxY: box.y,
        boxWidth: box.width,
        boxHeight: box.height,
        isConfirmed: true,
      });
      
      await db.update(knownPersons)
        .set({ 
          photoCount: sql`${knownPersons.photoCount} + 1`,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(knownPersons.id, personId));
      
      console.log(`[FaceCatalog] Linked media ${mediaId} to person ${personId}. Descriptors can be added via client face-api.`);
    } catch (mediaError) {
      console.error(`[FaceCatalog] Failed to create media entry:`, mediaError);
      return {
        success: false,
        isNewPerson,
        descriptorAdded: false,
        message: "Échec de la création du lien média"
      };
    }
  } else {
    console.log(`[FaceCatalog] No storage path provided - person profile created without media link`);
  }
  
  return {
    success: true,
    personId,
    personName: nameExtraction.fullName,
    isNewPerson,
    descriptorAdded: mediaId !== null,
    message: isNewPerson 
      ? `Nouvelle personne créée: ${nameExtraction.fullName} (visages: ${faceAnalysis.faceCount})` 
      : `Photo liée à: ${nameExtraction.fullName}`
  };
}

export interface BatchImageInput {
  url: string;
  title: string;
  storagePath?: string;
  buffer?: Buffer;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export async function batchCatalogFromQuery(
  userId: number,
  images: Array<BatchImageInput>,
  searchQuery: string,
  maxImages: number = 3
): Promise<{ processed: number; successful: number; personName?: string }> {
  const nameExtraction = extractPersonName(searchQuery);
  
  if (!nameExtraction.isPersonName) {
    return { processed: 0, successful: 0 };
  }
  
  console.log(`[FaceCatalog] Batch cataloging ${Math.min(images.length, maxImages)} images for: ${nameExtraction.fullName}`);
  
  let processed = 0;
  let successful = 0;
  
  for (const image of images.slice(0, maxImages)) {
    processed++;
    
    try {
      const result = await catalogImageFromSearch(
        userId, 
        {
          imageUrl: image.url,
          storagePath: image.storagePath,
          buffer: image.buffer,
          fileName: image.fileName,
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
        },
        searchQuery
      );
      if (result.success) {
        successful++;
      }
      
      await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      console.error(`[FaceCatalog] Failed to process image:`, error);
    }
  }
  
  console.log(`[FaceCatalog] Batch complete: ${successful}/${processed} images cataloged for ${nameExtraction.fullName}`);
  
  return { processed, successful, personName: nameExtraction.fullName };
}

export async function getCatalogStats(userId: number): Promise<{
  totalPersons: number;
  autoCreatedPersons: number;
  totalDescriptors: number;
  recentlyCataloged: Array<{ name: string; photoCount: number; createdAt: Date }>;
}> {
  const persons = await db.select()
    .from(knownPersons)
    .where(eq(knownPersons.userId, userId));
  
  const autoCreated = persons.filter(p => p.notes?.includes('Auto-cataloged'));
  
  let totalDescriptors = 0;
  for (const person of persons) {
    const descriptors = await faceRecognitionService.getPersonDescriptors(userId, person.id);
    totalDescriptors += descriptors.length;
  }
  
  const recent = await db.select()
    .from(knownPersons)
    .where(eq(knownPersons.userId, userId))
    .orderBy(desc(knownPersons.createdAt))
    .limit(5);
  
  return {
    totalPersons: persons.length,
    autoCreatedPersons: autoCreated.length,
    totalDescriptors,
    recentlyCataloged: recent.map(p => ({
      name: p.name,
      photoCount: p.photoCount,
      createdAt: p.createdAt ?? new Date()
    }))
  };
}
