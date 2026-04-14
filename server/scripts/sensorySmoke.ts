import { hearingHub } from "../services/sensory/HearingHub";
import { visionHub } from "../services/sensory/VisionHub";
import { actionHub } from "../services/sensory/ActionHub";
import { voiceOutputHub } from "../services/sensory/VoiceOutputHub";
import { brainHub } from "../services/sensory/BrainHub";

async function runSensorySmokeTest(): Promise<void> {
  const userId = 1;

  console.log("[SensorySmoke] Starting...");

  const hearing = await hearingHub.hear({
    content: "hello sensory system",
    metadata: {
      source: "web_chat",
      type: "text",
      timestamp: Date.now(),
      userId,
      persona: "ulysse",
      conversationId: 0
    }
  });

  const vision = await visionHub.seeDocument(
    "Sample document text for VisionHub.",
    "smoke-test.txt",
    "text/plain",
    userId
  );

  const action = await actionHub.execute({
    name: "system:ping",
    params: {},
    metadata: {
      category: "system",
      userId,
      persona: "ulysse",
      source: "api"
    }
  });

  const output = await voiceOutputHub.speak({
    text: "Sensory smoke test output",
    metadata: {
      destination: "web_chat",
      priority: "low",
      userId,
      persona: "ulysse",
    }
  });

  brainHub.updateNavigationContext("dashboard", "diagnostics");
  const navContext = brainHub.getNavigationContext();

  console.log("[SensorySmoke] Results:");
  console.log({
    hearing: { shouldRouteToBrain: hearing.shouldRouteToBrain, intent: hearing.intent?.domain || null, domain: hearing.domain },
    vision: { insights: vision.insights.length, textLength: (vision.text || "").length },
    action: { success: action.success, status: action.status },
    output: { success: output.success, destination: output.destination },
    navigation: { pageId: navContext.pageId, pageLabel: navContext.pageLabel, actions: navContext.availableActions.length }
  });

  console.log("[SensorySmoke] Done.");
}

runSensorySmokeTest()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("[SensorySmoke] Failed:", error);
    process.exit(1);
  });
