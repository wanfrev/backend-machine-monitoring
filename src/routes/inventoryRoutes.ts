import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import { getInventorySummary } from "../controllers/inventoryController";

const router = Router();

router.use(authenticateToken);
router.get("/", getInventorySummary);

export default router;
