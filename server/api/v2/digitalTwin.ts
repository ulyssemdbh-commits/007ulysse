import { Router, Request, Response } from "express";

const router = Router();

router.get("/snapshot", async (req: Request, res: Response) => {
  try {
    const { digitalTwinService } = await import("../../services/digitalTwinService");
    const restaurant = (req.query.restaurant as string) || "suguval";
    const snapshot = await digitalTwinService.getSnapshot(restaurant);
    res.json({ success: true, snapshot });
  } catch (error: any) {
    console.error("[DigitalTwin] Snapshot error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/simulate", async (req: Request, res: Response) => {
  try {
    const { digitalTwinService } = await import("../../services/digitalTwinService");
    const { scenario, restaurant } = req.body;

    if (!scenario || !scenario.type) {
      return res.status(400).json({ error: "scenario.type requis (remove_employee, add_employee, change_supplier, price_change, add_expense, remove_expense, revenue_change, custom)" });
    }

    const result = await digitalTwinService.simulate(scenario, restaurant || "suguval");
    res.json(result);
  } catch (error: any) {
    console.error("[DigitalTwin] Simulate error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post("/multi-simulate", async (req: Request, res: Response) => {
  try {
    const { digitalTwinService } = await import("../../services/digitalTwinService");
    const { scenarios, restaurant } = req.body;

    if (!scenarios || !Array.isArray(scenarios) || scenarios.length === 0) {
      return res.status(400).json({ error: "scenarios (array) requis" });
    }

    const result = await digitalTwinService.multiScenario(scenarios, restaurant || "suguval");
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error("[DigitalTwin] Multi-simulate error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
