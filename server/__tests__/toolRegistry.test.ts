import { describe, it, expect } from "vitest";

// We can't import the full service (it requires DB, external services, etc.)
// Instead, we test the architecture: registry coverage and unknown tool handling.

describe("toolHandlerRegistry", () => {
  // Read the source to extract registered tool names
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(
    path.join(__dirname, "../services/ulysseToolsServiceV2.ts"),
    "utf-8"
  );

  // Extract all tool names from the registry (pattern: `tool_name:`)
  const registryMatch = source.match(
    /const toolHandlerRegistry[\s\S]*?^};/m
  );

  const registeredTools: string[] = [];
  if (registryMatch) {
    const lines = registryMatch[0].split("\n");
    for (const line of lines) {
      const match = line.match(/^\s+(\w+):\s*(?:async\s*)?\(/);
      if (match) {
        registeredTools.push(match[1]);
      }
    }
  }

  it("should use registry pattern (not switch statement)", () => {
    // Verify the function uses registry lookup, not a switch
    const fnMatch = source.match(
      /export async function executeToolCallV2Internal[\s\S]*?^}/m
    );
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch![0];
    expect(fnBody).toContain("toolHandlerRegistry[toolName]");
    expect(fnBody).not.toContain("switch (toolName)");
  });

  it("should have at least 60 registered tools", () => {
    expect(registeredTools.length).toBeGreaterThanOrEqual(60);
  });

  it("should register all expected core tools", () => {
    const coreTools = [
      // Data
      "query_suguval_history", "query_brain", "query_sports_data",
      // Calendar
      "calendar_list_events", "calendar_create_event",
      // Email
      "email_list_inbox", "email_send", "email_reply", "email_forward",
      // Smart Home
      "smarthome_control",
      // Web
      "web_search", "read_url",
      // Discord
      "discord_send_message", "discord_status",
      // Memory
      "memory_save",
      // Image
      "image_generate",
      // DevOps
      "devops_intelligence", "devops_github", "devops_server",
      // SUGU
      "manage_sugu_bank", "sugu_full_overview",
      // Business
      "compute_business_health", "detect_anomalies",
    ];
    for (const tool of coreTools) {
      expect(registeredTools).toContain(tool);
    }
  });

  it("should have unknown tool fallback in executeToolCallV2Internal", () => {
    const fnMatch = source.match(
      /export async function executeToolCallV2Internal[\s\S]*?^}/m
    );
    expect(fnMatch).toBeTruthy();
    expect(fnMatch![0]).toContain("Fonction inconnue");
  });

  it("should have unique tool names (no duplicates)", () => {
    const uniqueTools = new Set(registeredTools);
    expect(uniqueTools.size).toBe(registeredTools.length);
  });

  it("should categorize tools by domain (comments present)", () => {
    if (!registryMatch) throw new Error("Registry not found");
    const registryText = registryMatch[0];
    const domains = [
      "Data tools",
      "Calendar tools",
      "Email tools",
      "Discord tools",
      "SUGU management tools",
      "Business intelligence tools",
      "Automation features",
    ];
    for (const domain of domains) {
      expect(registryText).toContain(`// ${domain}`);
    }
  });
});
