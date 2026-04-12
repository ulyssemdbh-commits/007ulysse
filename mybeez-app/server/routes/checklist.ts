import type { Express, Request, Response, NextFunction } from "express";
import { getChecklistService } from "../services/checklistService";
import { getBySlug, type RestaurantConfig, RESTAURANTS } from "@shared/restaurants";
import { comments } from "@shared/schema/checklist";
import { z } from "zod";
import { desc, eq, gte } from "drizzle-orm";
import { emitSuguChecklistUpdated } from "../services/realtimeSync";
import { getSessionToken } from "../middleware/auth";
import { authService } from "../services/auth";
import { getTenantDb } from "../tenantDb";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const toggleSchema = z.object({ itemId: z.number(), isChecked: z.boolean() });

const updateItemSchema = z.object({
  name: z.string().optional(),
  nameVi: z.string().nullable().optional(),
  nameTh: z.string().nullable().optional(),
  categoryId: z.number().optional(),
});

const translateSchema = z.object({
  text: z.string(),
  targetLanguage: z.enum(["vi", "th"]),
});

const moveItemSchema = z.object({ direction: z.enum(["up", "down"]) });

const reorderItemsSchema = z.object({
  categoryId: z.number(),
  orderedIds: z.array(z.number()),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  nameVi: z.string().nullable().optional(),
  nameTh: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
});

const createCategorySchema = z.object({
  name: z.string().min(1),
  sheet: z.enum(["Feuil1", "Feuil2"]),
});

const createItemSchema = z.object({
  name: z.string().min(1),
  categoryId: z.number(),
});

const reorderCategoriesSchema = z.object({
  orderedIds: z.array(z.number()),
});

const addCommentSchema = z.object({
  author: z.string().min(1).max(50),
  message: z.string().min(1).max(500),
});

const updateCommentSchema = z.object({
  message: z.string().min(1).max(500),
});

const futureItemSchema = z.object({
  itemId: z.number(),
  date: z.string(),
});

const commentTranslateSchema = z.object({
  text: z.string().min(1),
  fromLang: z.enum(["fr", "vi", "th"]),
  toLang: z.enum(["fr", "vi", "th"]),
});

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

async function requireSuguAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = getSessionToken(req);
  if (!token)
    return res
      .status(403)
      .json({ error: "Connexion requise pour cette op\u00e9ration" });

  const result = await authService.validateSession(token);
  if (!result.success)
    return res.status(403).json({ error: "Session invalide" });

  return next();
}

// ---------------------------------------------------------------------------
// Tenant resolution middleware
// ---------------------------------------------------------------------------

function resolveTenant(req: Request, res: Response, next: NextFunction) {
  const slug = req.params.tenant;
  const config = getBySlug(slug);
  if (!config) {
    return res.status(404).json({ error: `Unknown restaurant: ${slug}` });
  }
  (req as any).tenantConfig = config;
  (req as any).tenantId = config.id;
  next();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getService(req: Request) {
  return getChecklistService((req as any).tenantId);
}

function getConfig(req: Request): RestaurantConfig {
  return (req as any).tenantConfig;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerChecklistRoutes(app: Express) {
  const base = "/api/:tenant";

  // -----------------------------------------------------------------------
  // Public endpoints
  // -----------------------------------------------------------------------

  // 1. GET /categories
  app.get(`${base}/categories`, resolveTenant, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.getCategoriesWithItems();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. GET /dashboard
  app.get(`${base}/dashboard`, resolveTenant, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.getDashboardStats();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. GET /checks
  app.get(`${base}/checks`, resolveTenant, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.getTodayChecks();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. POST /toggle
  app.post(`${base}/toggle`, resolveTenant, async (req, res) => {
    try {
      const parsed = toggleSchema.parse(req.body);
      const service = getService(req);
      const result = await service.toggleCheck(parsed.itemId, parsed.isChecked);
      emitSuguChecklistUpdated((req as any).tenantId);
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // 5. GET /summary
  app.get(`${base}/summary`, resolveTenant, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.getCheckedItemsForToday();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. GET /history
  app.get(`${base}/history`, resolveTenant, async (req, res) => {
    try {
      const month = req.query.month as string | undefined;
      const service = getService(req);
      const result = await service.getHistory(month);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. GET /weekly
  app.get(`${base}/weekly`, resolveTenant, async (req, res) => {
    try {
      const service = getService(req);
      const result = await service.getWeeklyStats();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8. PATCH /items/:id
  app.patch(`${base}/items/:id`, resolveTenant, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const data = updateItemSchema.parse(req.body);
      const service = getService(req);
      const result = await service.updateItem(id, data);
      emitSuguChecklistUpdated((req as any).tenantId);
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // 9. PATCH /categories/:id
  app.patch(`${base}/categories/:id`, resolveTenant, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const data = updateCategorySchema.parse(req.body);
      const service = getService(req);
      const result = await service.updateCategory(id, data);
      emitSuguChecklistUpdated((req as any).tenantId);
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // 10. GET /future
  app.get(`${base}/future`, resolveTenant, async (req, res) => {
    try {
      const date = req.query.date as string | undefined;
      const service = getService(req);
      const result = await service.getFutureItems(date);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 11. POST /future
  app.post(`${base}/future`, resolveTenant, async (req, res) => {
    try {
      const parsed = futureItemSchema.parse(req.body);
      const service = getService(req);
      const result = await service.addFutureItem(parsed.itemId, parsed.date);
      emitSuguChecklistUpdated((req as any).tenantId);
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Auth-protected endpoints
  // -----------------------------------------------------------------------

  // 12. POST /reset
  app.post(
    `${base}/reset`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const service = getService(req);
        const result = await service.resetTodayChecks();
        emitSuguChecklistUpdated((req as any).tenantId);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 13. POST /categories/reorder
  app.post(
    `${base}/categories/reorder`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const parsed = reorderCategoriesSchema.parse(req.body);
        const service = getService(req);
        const result = await service.reorderCategories(parsed.orderedIds);
        emitSuguChecklistUpdated((req as any).tenantId);
        res.json(result);
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ error: err.errors });
        }
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 14. DELETE /future
  app.delete(
    `${base}/future`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const service = getService(req);
        const result = await service.removeFutureItem(req.body);
        emitSuguChecklistUpdated((req as any).tenantId);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 15. POST /items/:id/move
  app.post(
    `${base}/items/:id/move`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const parsed = moveItemSchema.parse(req.body);
        const service = getService(req);
        const result = await service.moveItem(id, parsed.direction);
        emitSuguChecklistUpdated((req as any).tenantId);
        res.json(result);
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ error: err.errors });
        }
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 16. POST /items/reorder
  app.post(
    `${base}/items/reorder`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const parsed = reorderItemsSchema.parse(req.body);
        const service = getService(req);
        const result = await service.reorderItems(
          parsed.categoryId,
          parsed.orderedIds,
        );
        emitSuguChecklistUpdated((req as any).tenantId);
        res.json(result);
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ error: err.errors });
        }
        res.status(500).json({ error: err.message });
      }
    },
  );

  // -----------------------------------------------------------------------
  // Feature-gated endpoints
  // -----------------------------------------------------------------------

  // 17. POST /translate (features.translate)
  app.post(
    `${base}/translate`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const config = getConfig(req);
        if (!config.features.translate) {
          return res
            .status(404)
            .json({ error: "Feature not available" });
        }

        const parsed = translateSchema.parse(req.body);
        const { getAIForContext } = await import("../services/ai");
        const ai = getAIForContext("translate");
        const result = await ai.translate(
          parsed.text,
          parsed.targetLanguage,
        );
        res.json(result);
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ error: err.errors });
        }
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 18. POST /categories (features.itemCrud)
  app.post(
    `${base}/categories`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const config = getConfig(req);
        if (!config.features.itemCrud) {
          return res
            .status(404)
            .json({ error: "Feature not available" });
        }

        const parsed = createCategorySchema.parse(req.body);
        const service = getService(req);
        const result = await service.createCategory(
          parsed.name,
          parsed.sheet,
        );
        emitSuguChecklistUpdated((req as any).tenantId);
        res.json(result);
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ error: err.errors });
        }
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 19. DELETE /categories/:id (features.itemCrud)
  app.delete(
    `${base}/categories/:id`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const config = getConfig(req);
        if (!config.features.itemCrud) {
          return res
            .status(404)
            .json({ error: "Feature not available" });
        }

        const id = parseInt(req.params.id, 10);
        const service = getService(req);
        const result = await service.deleteCategory(id);
        emitSuguChecklistUpdated((req as any).tenantId);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 20. POST /items (features.itemCrud)
  app.post(
    `${base}/items`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const config = getConfig(req);
        if (!config.features.itemCrud) {
          return res
            .status(404)
            .json({ error: "Feature not available" });
        }

        const parsed = createItemSchema.parse(req.body);
        const service = getService(req);
        const result = await service.createItem(
          parsed.name,
          parsed.categoryId,
        );
        emitSuguChecklistUpdated((req as any).tenantId);
        res.json(result);
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ error: err.errors });
        }
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 21. DELETE /items/:id (features.itemCrud)
  app.delete(
    `${base}/items/:id`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const config = getConfig(req);
        if (!config.features.itemCrud) {
          return res
            .status(404)
            .json({ error: "Feature not available" });
        }

        const id = parseInt(req.params.id, 10);
        const service = getService(req);
        const result = await service.deleteItem(id);
        emitSuguChecklistUpdated((req as any).tenantId);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 22. Comments (features.comments)

  // GET /comments
  app.get(`${base}/comments`, resolveTenant, async (req, res) => {
    try {
      const config = getConfig(req);
      if (!config.features.comments) {
        return res
          .status(404)
          .json({ error: "Feature not available" });
      }

      const db = getTenantDb((req as any).tenantId);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const result = await db
        .select()
        .from(comments)
        .where(gte(comments.createdAt, today))
        .orderBy(desc(comments.createdAt));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /comments
  app.post(`${base}/comments`, resolveTenant, async (req, res) => {
    try {
      const config = getConfig(req);
      if (!config.features.comments) {
        return res
          .status(404)
          .json({ error: "Feature not available" });
      }

      const parsed = addCommentSchema.parse(req.body);
      const db = getTenantDb((req as any).tenantId);
      const [result] = await db
        .insert(comments)
        .values({
          author: parsed.author,
          message: parsed.message,
        })
        .returning();
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /comments/:id
  app.patch(`${base}/comments/:id`, resolveTenant, async (req, res) => {
    try {
      const config = getConfig(req);
      if (!config.features.comments) {
        return res
          .status(404)
          .json({ error: "Feature not available" });
      }

      const id = parseInt(req.params.id, 10);
      const parsed = updateCommentSchema.parse(req.body);
      const db = getTenantDb((req as any).tenantId);
      const [result] = await db
        .update(comments)
        .set({ message: parsed.message })
        .where(eq(comments.id, id))
        .returning();
      res.json(result);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /comments/:id
  app.delete(
    `${base}/comments/:id`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const config = getConfig(req);
        if (!config.features.comments) {
          return res
            .status(404)
            .json({ error: "Feature not available" });
        }

        const id = parseInt(req.params.id, 10);
        const db = getTenantDb((req as any).tenantId);
        const [result] = await db
          .delete(comments)
          .where(eq(comments.id, id))
          .returning();
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 23. POST /translate-comment (features.comments)
  app.post(
    `${base}/translate-comment`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const config = getConfig(req);
        if (!config.features.comments) {
          return res
            .status(404)
            .json({ error: "Feature not available" });
        }

        const parsed = commentTranslateSchema.parse(req.body);
        const { translationService } = await import(
          "../services/translationService"
        );
        const result = await translationService.translate(
          parsed.text,
          parsed.fromLang,
          parsed.toLang,
        );
        res.json(result);
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ error: err.errors });
        }
        res.status(500).json({ error: err.message });
      }
    },
  );

  // -----------------------------------------------------------------------
  // Secret-protected endpoints
  // -----------------------------------------------------------------------

  // 24. POST /send-email
  app.post(
    `${base}/send-email`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const config = getConfig(req);
        const secret = req.headers["x-sugu-secret"];
        if (!secret || secret !== config.emailSecret) {
          return res.status(403).json({ error: "Invalid secret" });
        }

        const service = getService(req);
        const result = await service.sendDailyEmail();
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // 25. GET /email-logs
  app.get(`${base}/email-logs`, resolveTenant, async (req, res) => {
    try {
      const config = getConfig(req);
      const secret = req.headers["x-sugu-secret"];
      if (!secret || secret !== config.emailSecret) {
        return res.status(403).json({ error: "Invalid secret" });
      }

      const service = getService(req);
      const result = await service.getEmailLogs();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Manual send (auth only, no secret)
  // -----------------------------------------------------------------------

  // 26. POST /send-list-email
  app.post(
    `${base}/send-list-email`,
    resolveTenant,
    requireSuguAuth,
    async (req, res) => {
      try {
        const service = getService(req);
        const result = await service.sendDailyEmail();
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // -----------------------------------------------------------------------
  // Discord (features.discord)
  // -----------------------------------------------------------------------

  // 27. POST /send-discord
  app.post(
    `${base}/send-discord`,
    resolveTenant,
    async (req, res) => {
      try {
        const config = getConfig(req);
        if (!config.features.discord) {
          return res
            .status(404)
            .json({ error: "Feature not available" });
        }

        const { discordBotService } = await import(
          "../services/discordBotService"
        );
        const service = getService(req);
        const summary = await service.getCheckedItemsForToday();
        const result = await discordBotService.sendShoppingList(
          (req as any).tenantId,
          summary,
        );
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // -----------------------------------------------------------------------
  // AI consult (owner only)
  // -----------------------------------------------------------------------

  // 28. GET /ai-consult
  app.get(`${base}/ai-consult`, resolveTenant, async (req, res) => {
    try {
      if (!(req as any).user?.isOwner) {
        return res.status(403).json({ error: "Owner access required" });
      }

      const service = getService(req);
      const [categories, dashboard, checks, history, weekly] =
        await Promise.all([
          service.getCategoriesWithItems(),
          service.getDashboardStats(),
          service.getTodayChecks(),
          service.getHistory(),
          service.getWeeklyStats(),
        ]);

      res.json({
        categories,
        dashboard,
        checks,
        history,
        weekly,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Initialize all tenant data on startup
  // -----------------------------------------------------------------------

  for (const config of Object.values(RESTAURANTS)) {
    getChecklistService(config.id)
      .initializeFromExcel()
      .catch((err) => {
        console.error(`[${config.systemName}] Init error:`, err);
      });
  }

  console.log("[Checklist] Unified routes registered");
}
