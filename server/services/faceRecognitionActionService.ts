import * as faceRecognitionService from "./faceRecognitionService";
import { broadcastToUser } from "./realtimeSync";
import { db } from "../db";
import { mediaLibrary } from "@shared/schema";
import { eq } from "drizzle-orm";

interface FaceSearchAction {
  type: 'search_person';
  personName: string;
}

interface FaceListAction {
  type: 'list_persons';
}

type FaceAction = FaceSearchAction | FaceListAction;

interface FaceSearchResult {
  success: boolean;
  type: 'search_person';
  personName: string;
  person?: {
    id: number;
    name: string;
    photoCount: number;
  };
  mediaCount?: number;
  media?: Array<{
    id: number;
    type: string;
    filename: string;
    thumbnailPath: string | null;
    storagePath: string;
    confidence: number;
  }>;
  error?: string;
}

interface FaceListResult {
  success: boolean;
  type: 'list_persons';
  persons: Array<{
    id: number;
    name: string;
    photoCount: number;
    lastSeenAt: Date | null;
  }>;
}

type FaceActionResult = FaceSearchResult | FaceListResult;

const SEARCH_PERSON_PATTERN = /\[RECHERCHE_VISAGE:\s*person="([^"]+)"\]/gi;
const LIST_PERSONS_PATTERN = /\[LISTE_PERSONNES_CONNUES\]/gi;

class FaceRecognitionActionService {
  parseFaceActions(response: string): FaceAction[] {
    const actions: FaceAction[] = [];
    let match;

    while ((match = SEARCH_PERSON_PATTERN.exec(response)) !== null) {
      actions.push({
        type: 'search_person',
        personName: match[1].trim(),
      });
    }
    SEARCH_PERSON_PATTERN.lastIndex = 0;

    while ((match = LIST_PERSONS_PATTERN.exec(response)) !== null) {
      actions.push({
        type: 'list_persons',
      });
    }
    LIST_PERSONS_PATTERN.lastIndex = 0;

    return actions;
  }

  async executeActions(actions: FaceAction[], userId: number): Promise<FaceActionResult[]> {
    const results: FaceActionResult[] = [];

    for (const action of actions) {
      try {
        if (action.type === 'search_person') {
          const result = await this.searchPersonMedia(userId, action.personName);
          results.push(result);
          
          if (result.success && result.media && result.media.length > 0) {
            // Broadcast as search.results with source=media_library for image grid display
            broadcastToUser(userId, {
              type: "search.results",
              timestamp: Date.now(),
              data: {
                query: result.personName,
                source: "media_library",
                images: result.media.map(m => ({
                  link: m.storagePath,
                  thumbnailLink: m.thumbnailPath || m.storagePath,
                  title: m.filename,
                  contextLink: m.storagePath,
                  width: 400,
                  height: 400
                })),
                personName: result.personName,
                person: result.person,
                mediaCount: result.mediaCount,
              },
            });
          }
        } else if (action.type === 'list_persons') {
          const result = await this.listPersons(userId);
          results.push(result);
          
          if (result.success && result.persons.length > 0) {
            broadcastToUser(userId, {
              type: "search.results",
              timestamp: Date.now(),
              data: {
                source: "face_list",
                persons: result.persons,
                count: result.persons.length,
              },
            });
          }
        }
      } catch (error: any) {
        console.error(`[FaceRecognitionAction] Error executing ${action.type}:`, error);
        if (action.type === 'search_person') {
          results.push({
            success: false,
            type: 'search_person',
            personName: action.personName,
            error: error.message,
          });
        }
      }
    }

    return results;
  }

  private async searchPersonMedia(userId: number, personName: string): Promise<FaceSearchResult> {
    const person = await faceRecognitionService.searchPersonByName(userId, personName);
    
    if (!person) {
      return {
        success: false,
        type: 'search_person',
        personName,
        error: `Aucune personne trouvée avec le nom "${personName}"`,
      };
    }

    const mediaWithFaces = await faceRecognitionService.getMediaByPersonWithDetails(userId, person.id);
    
    return {
      success: true,
      type: 'search_person',
      personName,
      person: {
        id: person.id,
        name: person.name,
        photoCount: person.photoCount,
      },
      mediaCount: mediaWithFaces.length,
      media: mediaWithFaces.slice(0, 20).map(m => ({
        id: m.media.id,
        type: m.media.type,
        filename: m.media.filename,
        thumbnailPath: m.media.thumbnailPath,
        storagePath: m.media.storagePath,
        confidence: m.confidence,
      })),
    };
  }

  private async listPersons(userId: number): Promise<FaceListResult> {
    const persons = await faceRecognitionService.getPersons(userId);
    
    return {
      success: true,
      type: 'list_persons',
      persons: persons.map(p => ({
        id: p.id,
        name: p.name,
        photoCount: p.photoCount,
        lastSeenAt: p.lastSeenAt,
      })),
    };
  }

  formatResultForUser(result: FaceActionResult): string {
    if (result.type === 'search_person') {
      if (!result.success) {
        return `Recherche visage: ${result.error}`;
      }
      
      if (result.mediaCount === 0) {
        return `Aucune photo/vidéo trouvée pour ${result.personName}`;
      }
      
      return `${result.mediaCount} photo(s)/vidéo(s) trouvée(s) pour ${result.person?.name || result.personName}`;
    }
    
    if (result.type === 'list_persons') {
      if (result.persons.length === 0) {
        return "Aucune personne enregistrée";
      }
      
      return `${result.persons.length} personne(s) connue(s): ${result.persons.map(p => p.name).join(", ")}`;
    }
    
    return "Action terminée";
  }
}

export const faceRecognitionActionService = new FaceRecognitionActionService();
