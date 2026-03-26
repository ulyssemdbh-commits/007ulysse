import { describe, it, expect, vi, beforeEach } from "vitest";

interface Capability {
  name: string;
  category: string;
  description: string;
  status: "active" | "degraded" | "inactive";
  dependencies: string[];
  lastCheck: Date;
}

interface CapabilityCheck {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

function categorizeCapabilities(capabilities: Capability[]): Record<string, Capability[]> {
  return capabilities.reduce((acc, cap) => {
    if (!acc[cap.category]) acc[cap.category] = [];
    acc[cap.category].push(cap);
    return acc;
  }, {} as Record<string, Capability[]>);
}

function getActiveCapabilities(capabilities: Capability[]): Capability[] {
  return capabilities.filter(c => c.status === "active");
}

function getDegradedCapabilities(capabilities: Capability[]): Capability[] {
  return capabilities.filter(c => c.status === "degraded");
}

function checkDependencies(capability: Capability, allCapabilities: Capability[]): boolean {
  return capability.dependencies.every(dep => {
    const depCap = allCapabilities.find(c => c.name === dep);
    return depCap && depCap.status === "active";
  });
}

function calculateOverallHealth(capabilities: Capability[]): number {
  if (capabilities.length === 0) return 0;
  
  const weights = { active: 1, degraded: 0.5, inactive: 0 };
  const total = capabilities.reduce((sum, cap) => sum + weights[cap.status], 0);
  return Math.round((total / capabilities.length) * 100);
}

function generateReport(checks: CapabilityCheck[]): { passed: number; failed: number; duration: number } {
  return {
    passed: checks.filter(c => c.passed).length,
    failed: checks.filter(c => !c.passed).length,
    duration: checks.reduce((sum, c) => sum + c.duration, 0),
  };
}

describe("Capabilities Service", () => {
  const capabilities: Capability[] = [
    { name: "email", category: "communication", description: "Email management", status: "active", dependencies: [], lastCheck: new Date() },
    { name: "calendar", category: "productivity", description: "Calendar integration", status: "active", dependencies: [], lastCheck: new Date() },
    { name: "webSearch", category: "research", description: "Web search", status: "degraded", dependencies: ["mars"], lastCheck: new Date() },
    { name: "mars", category: "research", description: "MARS search system", status: "active", dependencies: [], lastCheck: new Date() },
    { name: "faceRecognition", category: "ai", description: "Face recognition", status: "inactive", dependencies: [], lastCheck: new Date() },
  ];

  describe("Categorization", () => {
    it("groups capabilities by category", () => {
      const grouped = categorizeCapabilities(capabilities);
      expect(grouped["communication"]).toHaveLength(1);
      expect(grouped["research"]).toHaveLength(2);
    });

    it("handles empty list", () => {
      const grouped = categorizeCapabilities([]);
      expect(Object.keys(grouped)).toHaveLength(0);
    });
  });

  describe("Status Filtering", () => {
    it("filters active capabilities", () => {
      const active = getActiveCapabilities(capabilities);
      expect(active).toHaveLength(3);
      expect(active.every(c => c.status === "active")).toBe(true);
    });

    it("filters degraded capabilities", () => {
      const degraded = getDegradedCapabilities(capabilities);
      expect(degraded).toHaveLength(1);
      expect(degraded[0].name).toBe("webSearch");
    });
  });

  describe("Dependency Checking", () => {
    it("validates met dependencies", () => {
      const webSearch = capabilities.find(c => c.name === "webSearch")!;
      expect(checkDependencies(webSearch, capabilities)).toBe(true);
    });

    it("validates capabilities without dependencies", () => {
      const email = capabilities.find(c => c.name === "email")!;
      expect(checkDependencies(email, capabilities)).toBe(true);
    });

    it("detects unmet dependencies", () => {
      const capWithBadDep: Capability = {
        name: "test", category: "test", description: "", status: "active",
        dependencies: ["nonexistent"], lastCheck: new Date()
      };
      expect(checkDependencies(capWithBadDep, capabilities)).toBe(false);
    });
  });

  describe("Health Calculation", () => {
    it("calculates overall health percentage", () => {
      const health = calculateOverallHealth(capabilities);
      expect(health).toBeGreaterThan(50);
      expect(health).toBeLessThan(100);
    });

    it("returns 0 for empty list", () => {
      expect(calculateOverallHealth([])).toBe(0);
    });

    it("returns 100 for all active", () => {
      const allActive = capabilities.map(c => ({ ...c, status: "active" as const }));
      expect(calculateOverallHealth(allActive)).toBe(100);
    });
  });

  describe("Report Generation", () => {
    it("generates check report", () => {
      const checks: CapabilityCheck[] = [
        { name: "email", passed: true, message: "OK", duration: 50 },
        { name: "calendar", passed: true, message: "OK", duration: 30 },
        { name: "faceRecog", passed: false, message: "Service unavailable", duration: 100 },
      ];
      const report = generateReport(checks);
      expect(report.passed).toBe(2);
      expect(report.failed).toBe(1);
      expect(report.duration).toBe(180);
    });
  });
});
