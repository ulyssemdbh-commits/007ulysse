import { Router } from "express";
import { requireDevmaxAuth } from "./devmaxMiddleware";
import gitRoutes from "./gitRoutes";
import pullRoutes from "./pullRoutes";
import cicdRoutes from "./cicdRoutes";
import deployRoutes from "./deployRoutes";
import dgmRoutes from "./dgmRoutes";
import infraRoutes from "./infraRoutes";
import billingRoutes from "./billingRoutes";
import secretsRoutes from "./secretsRoutes";

const router = Router();

router.use(requireDevmaxAuth);

router.use(gitRoutes);
router.use(pullRoutes);
router.use(cicdRoutes);
router.use(deployRoutes);
router.use(dgmRoutes);
router.use(infraRoutes);
router.use(billingRoutes);
router.use(secretsRoutes);

export { runSourceCodePreflight } from "../../services/devmax/testService";
export default router;
