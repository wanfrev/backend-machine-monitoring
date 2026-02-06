import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import { listDailySales, upsertDailySale } from "../controllers/salesController";

const router = Router();

router.use(authenticateToken);

router.get("/daily", listDailySales);
router.put("/daily", upsertDailySale);

export default router;
