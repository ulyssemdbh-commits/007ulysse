import { Router } from "express";
import { ensureDevmaxTables } from "./devmaxTables";
import authRoutes from "./authRoutes";
import projectCrudRoutes from "./projectCrudRoutes";
import githubOAuthRoutes from "./githubOAuthRoutes";
import chatJournalRoutes from "./chatJournalRoutes";
import adminRoutes from "./adminRoutes";

ensureDevmaxTables();

const router = Router();

router.use(authRoutes);
router.use(projectCrudRoutes);
router.use(githubOAuthRoutes);
router.use(chatJournalRoutes);
router.use(adminRoutes);

export {
  requireDevmaxAuth,
  logDevmaxActivity,
  getProjectGitHubToken,
  checkPlanLimits,
  sendDevmaxNotification,
} from "./devmaxMiddleware";

export default router;
