import { coreEntryPoint } from "../services/core/coreEntryPoint";
import { webExtractionFacade } from "../services/webExtractionFacade";

async function runCoreEntrySmoke(): Promise<void> {
    console.log("[CoreEntrySmoke] Starting...");

    const providerInfo = coreEntryPoint.getProviderInfo();
    console.log("[CoreEntrySmoke] Providers:", providerInfo);

    if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        const result = await coreEntryPoint.processConversation("ping", {
            userId: 1,
            persona: "ulysse",
            hasFamilyAccess: true
        });
        console.log("[CoreEntrySmoke] Core response:", {
            source: result.processingSource,
            toolsUsed: result.toolsUsed,
            totalTimeMs: result.metrics.totalTimeMs
        });
    } else {
        console.log("[CoreEntrySmoke] Skipping processConversation (no OpenAI key).");
    }

    if (process.env.ULYSSE_SMOKE_RUN_NETWORK === "1") {
        const crawl = await webExtractionFacade.crawlUrl({
            url: "https://example.com",
            mode: "http",
            timeoutMs: 8000,
            maxBytes: 200000
        });
        console.log("[CoreEntrySmoke] Web extraction:", {
            success: crawl.success,
            crawlStatus: crawl.crawlStatus,
            modeUsed: crawl.modeUsed,
            textLength: crawl.content.textLength
        });
    } else {
        console.log("[CoreEntrySmoke] Skipping web extraction (set ULYSSE_SMOKE_RUN_NETWORK=1 to enable).");
    }

    console.log("[CoreEntrySmoke] Done.");
}

runCoreEntrySmoke().catch((error) => {
    console.error("[CoreEntrySmoke] Failed:", error);
    process.exitCode = 1;
});
