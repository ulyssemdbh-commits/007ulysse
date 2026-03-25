import { brainService } from "./brainService";
import { brainContextService, type BrainContextRequest, type BrainContextResponse } from "./brainContextService";
import { brainSyncService } from "./brainSyncService";

export const brainFacade = {
    searchKnowledge: brainService.searchKnowledge.bind(brainService),
    addKnowledge: brainService.addKnowledge.bind(brainService),
    getContext: (request: BrainContextRequest): Promise<BrainContextResponse> =>
        brainContextService.getContext(request),
    syncMemories: brainSyncService.migrateMemoriesToBrain.bind(brainSyncService),
    syncWebSearches: brainSyncService.syncWebSearchesToBrain.bind(brainSyncService),
    syncProjects: brainSyncService.syncProjectsToBrain.bind(brainSyncService)
};

export type { BrainContextRequest, BrainContextResponse };
