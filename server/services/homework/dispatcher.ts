/**
 * Pure routing helpers for homework execution. Exposed as a separate
 * module so the dispatcher behavior can be unit-tested without spinning
 * up the full executor (DB, AI, scraper, etc).
 */

import {
  classifyHomeworkTarget,
  type HomeworkTargetType,
} from "./targetClassifier";

export interface ClassifiedHomeworkUrl {
  url: string;
  classification: ReturnType<typeof classifyHomeworkTarget>;
}

export type HomeworkRouteMode = "sport" | "multi-target";

export interface HomeworkRouteDecision {
  mode: HomeworkRouteMode;
  classified: ClassifiedHomeworkUrl[];
  hasNonSportTarget: boolean;
}

const NON_SPORT_TYPES = new Set<HomeworkTargetType>([
  "github_repo",
  "web_article",
  "pdf",
  "notion",
]);

/**
 * Decide which pipeline a homework should follow:
 *   - "multi-target" if at least one URL is github / web / pdf / notion;
 *   - "sport"        otherwise (legacy verified pipeline, no regression).
 */
export function routeHomeworkUrls(
  urls: string[],
  taskHint?: string,
): HomeworkRouteDecision {
  const classified: ClassifiedHomeworkUrl[] = urls.map((url) => ({
    url,
    classification: classifyHomeworkTarget({ url, text: taskHint }),
  }));
  const hasNonSportTarget = classified.some((c) =>
    NON_SPORT_TYPES.has(c.classification.type),
  );
  return {
    mode: hasNonSportTarget ? "multi-target" : "sport",
    classified,
    hasNonSportTarget,
  };
}
