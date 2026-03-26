import { itineraryService } from './itineraryService';

interface WaypointInput {
  lat: number;
  lng: number;
  label: string;
  address?: string;
  name?: string;
}

export interface ItineraryAction {
  type: 'create' | 'optimize' | 'list' | 'load' | 'startNavigation' | 'stopNavigation';
  name?: string;
  waypoints?: WaypointInput[];
  profile?: string;
  routeId?: number;
}

export interface ActionResult {
  success: boolean;
  action: ItineraryAction;
  data?: any;
  error?: string;
}

const ITINERARY_ACTION_PATTERNS = {
  create: /\[ITINÉRAIRE_CRÉÉ\s*:\s*name="([^"]+)"\s*,\s*waypoints=\[([\s\S]+?)\]\s*,\s*profile="([^"]+)"\]/i,
  optimize: /\[ITINÉRAIRE_OPTIMISÉ\s*:\s*waypoints=\[([\s\S]+?)\]\]/i,
  startNavigation: /\[NAVIGATION_DÉMARRÉE\s*:\s*(?:routeId="(\d+)"|waypoints=\[([\s\S]+?)\])\]/i,
};

function parseWaypointsFromString(waypointsStr: string): WaypointInput[] {
  const waypoints: WaypointInput[] = [];
  const regex = /\{[^}]+lat[^}]+lng[^}]+\}/g;
  const matches = waypointsStr.match(regex);
  
  if (matches) {
    for (const match of matches) {
      try {
        const latMatch = match.match(/lat["\s:]+(-?\d+\.?\d*)/);
        const lngMatch = match.match(/lng["\s:]+(-?\d+\.?\d*)/);
        const addressMatch = match.match(/address["\s:]+["']([^"']+)["']/);
        const labelMatch = match.match(/label["\s:]+["']([^"']+)["']/);
        
        if (latMatch && lngMatch) {
          waypoints.push({
            lat: parseFloat(latMatch[1]),
            lng: parseFloat(lngMatch[1]),
            label: labelMatch ? labelMatch[1] : String.fromCharCode(65 + waypoints.length),
            address: addressMatch ? addressMatch[1] : undefined,
          });
        }
      } catch (e) {
        console.error('[ItineraryAction] Failed to parse waypoint:', match, e);
      }
    }
  }
  
  return waypoints;
}

export function parseItineraryActions(text: string): ItineraryAction[] {
  const actions: ItineraryAction[] = [];
  
  const createMatch = ITINERARY_ACTION_PATTERNS.create.exec(text);
  if (createMatch) {
    const waypoints = parseWaypointsFromString(createMatch[2]);
    actions.push({
      type: 'create',
      name: createMatch[1],
      waypoints,
      profile: createMatch[3] || 'driving',
    });
  }
  
  const optimizeMatch = ITINERARY_ACTION_PATTERNS.optimize.exec(text);
  if (optimizeMatch) {
    const waypoints = parseWaypointsFromString(optimizeMatch[1]);
    actions.push({
      type: 'optimize',
      waypoints,
    });
  }
  
  const navMatch = ITINERARY_ACTION_PATTERNS.startNavigation.exec(text);
  if (navMatch) {
    if (navMatch[1]) {
      actions.push({
        type: 'startNavigation',
        routeId: parseInt(navMatch[1]),
      });
    } else if (navMatch[2]) {
      const waypoints = parseWaypointsFromString(navMatch[2]);
      actions.push({
        type: 'startNavigation',
        waypoints,
      });
    }
  }
  
  return actions;
}

export async function executeItineraryActions(
  actions: ItineraryAction[],
  userId: number
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  
  for (const action of actions) {
    try {
      console.log(`[ItineraryAction] Executing ${action.type} action`);
      
      switch (action.type) {
        case 'create':
          if (action.name && action.waypoints && action.waypoints.length >= 2) {
            const route = await itineraryService.createRoute({
              userId,
              name: action.name,
              profile: action.profile || 'driving',
            });
            
            await itineraryService.setWaypoints(route.id, userId, action.waypoints);
            
            results.push({
              success: true,
              action,
              data: { routeId: route.id, waypointCount: action.waypoints.length },
            });
          } else {
            results.push({
              success: false,
              action,
              error: 'Nom ou points de passage manquants (minimum 2 étapes)',
            });
          }
          break;
          
        case 'optimize':
          if (action.waypoints && action.waypoints.length >= 3) {
            const result = await itineraryService.optimizeWaypointOrder(action.waypoints);
            results.push({
              success: true,
              action,
              data: result,
            });
          } else {
            results.push({
              success: false,
              action,
              error: 'Minimum 3 étapes requis pour optimiser',
            });
          }
          break;
          
        case 'list':
          const routes = await itineraryService.getRoutes(userId);
          results.push({
            success: true,
            action,
            data: { routes, count: routes.length },
          });
          break;
          
        case 'load':
          if (action.routeId) {
            const route = await itineraryService.getRoute(action.routeId, userId);
            if (route) {
              const waypoints = await itineraryService.getWaypoints(action.routeId, userId);
              results.push({
                success: true,
                action,
                data: { ...route, waypoints },
              });
            } else {
              results.push({
                success: false,
                action,
                error: 'Itinéraire non trouvé',
              });
            }
          }
          break;
          
        case 'startNavigation':
          if (action.routeId) {
            const route = await itineraryService.getRoute(action.routeId, userId);
            if (route) {
              const waypoints = await itineraryService.getWaypoints(action.routeId, userId);
              const wpInput = waypoints.map(wp => ({
                lat: parseFloat(wp.latitude),
                lng: parseFloat(wp.longitude),
                label: wp.label,
                address: wp.address || undefined,
              }));
              const nav = await itineraryService.startNavigation(userId, action.routeId, wpInput, route.profile || 'driving');
              results.push({
                success: true,
                action,
                data: nav,
              });
            } else {
              results.push({
                success: false,
                action,
                error: 'Itinéraire non trouvé',
              });
            }
          } else if (action.waypoints && action.waypoints.length >= 2) {
            const nav = await itineraryService.startNavigation(userId, null, action.waypoints, action.profile || 'driving');
            results.push({
              success: true,
              action,
              data: nav,
            });
          }
          break;
          
        case 'stopNavigation':
          await itineraryService.stopNavigation(userId);
          results.push({
            success: true,
            action,
          });
          break;
          
        default:
          results.push({
            success: false,
            action,
            error: 'Action non reconnue',
          });
      }
      
      console.log(`[ItineraryAction] ${action.type} result: ${results[results.length - 1].success}`);
    } catch (error) {
      console.error(`[ItineraryAction] Error executing ${action.type}:`, error);
      results.push({
        success: false,
        action,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      });
    }
  }
  
  return results;
}

export function formatItineraryResult(result: ActionResult): string {
  if (!result.success) {
    return `[ERREUR_ITINÉRAIRE: ${result.error}]`;
  }
  
  switch (result.action.type) {
    case 'create':
      return `[ITINÉRAIRE_SAUVEGARDÉ: id=${result.data.routeId}, étapes=${result.data.waypointCount}]`;
    case 'optimize':
      if (result.data.savings) {
        const km = (result.data.savings.distance / 1000).toFixed(1);
        const min = Math.round(result.data.savings.duration / 60);
        return `[ITINÉRAIRE_OPTIMISÉ: économie=${km}km, ${min}min]`;
      }
      return '[ITINÉRAIRE_OPTIMISÉ: ordre mis à jour]';
    case 'list':
      return `[ITINÉRAIRES: ${result.data.count} sauvegardés]`;
    case 'startNavigation':
      return '[NAVIGATION_ACTIVE: guidage démarré]';
    case 'stopNavigation':
      return '[NAVIGATION_ARRÊTÉE]';
    default:
      return '[ITINÉRAIRE_OK]';
  }
}

export const itineraryActionService = {
  parseItineraryActions,
  executeItineraryActions,
  formatItineraryResult,
};
