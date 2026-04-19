/**
 * Express router exposant le bridge MCP DevOps en HTTP JSON-RPC 2.0.
 *
 * Endpoint:  POST /api/mcp/devops
 * Auth:      Bearer token via header `Authorization: Bearer <MCP_BRIDGE_TOKEN>`
 *            (env var MCP_BRIDGE_TOKEN — si non définie, accès uniquement
 *             pour user authentifié owner de Ulysse).
 *
 * Voir server/services/mcp/devopsMcpServer.ts pour la logique RPC.
 */

import { Router, type Request, type Response } from "express";
import { mcpDevopsServer } from "../services/mcp/devopsMcpServer";

const router = Router();

const OWNER_USER_ID = 1; // Ulysse owner = Maurice (id=1)

router.post("/", async (req: Request, res: Response) => {
  // Auth: soit token Bearer, soit session owner
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const expectedToken = process.env.MCP_BRIDGE_TOKEN;

  let userId: number = OWNER_USER_ID;

  if (expectedToken && bearerToken === expectedToken) {
    // OK, token valide → exécution en tant qu'owner Ulysse
  } else {
    // Sécurité: PAS de fallback session générique — uniquement owner authentifié.
    const sessionUserId = (req.session as any)?.userId;
    if (sessionUserId !== OWNER_USER_ID) {
      return res.status(401).json({
        jsonrpc: "2.0",
        id: req.body?.id ?? null,
        error: { code: -32001, message: "Unauthorized: MCP DevOps bridge requires Bearer MCP_BRIDGE_TOKEN or owner session." },
      });
    }
    userId = sessionUserId;
  }

  const result = await mcpDevopsServer.handleRpc(req.body, userId);
  if (result === null) {
    // Notification MCP → 204 No Content
    return res.status(204).end();
  }
  return res.json(result);
});

// GET /api/mcp/devops — métadonnées publiques (utile pour DeerFlow auto-discovery)
router.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "ulysse-devops-mcp",
    version: "1.0.0",
    protocol: "MCP JSON-RPC 2.0",
    transport: "http",
    endpoint: "POST /api/mcp/devops",
    auth: process.env.MCP_BRIDGE_TOKEN ? "Bearer token (header)" : "Session-based (owner only)",
    tools_count: mcpDevopsServer.listTools().length,
    tools: mcpDevopsServer.listTools().map(t => ({ name: t.name, description: t.description })),
  });
});

// GET /api/mcp/devops/tools — discovery complet (name + description + inputSchema)
// pour clients MCP qui veulent introspecter les capacités sans authentification.
// L'invocation des tools reste protégée par MCP_BRIDGE_TOKEN sur POST /.
router.get("/tools", (_req: Request, res: Response) => {
  const tools = mcpDevopsServer.listTools();
  res.json({
    server: "ulysse-devops-mcp",
    version: "1.0.0",
    invoke_endpoint: "POST /api/mcp/devops",
    invoke_auth: "Authorization: Bearer <MCP_BRIDGE_TOKEN>",
    tools_count: tools.length,
    tools, // includes inputSchema
  });
});

export default router;
