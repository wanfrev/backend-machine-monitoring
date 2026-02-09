import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import {
  listDailySales,
  listDailySaleEntries,
  upsertDailySale,
} from "../controllers/salesController";

const router = Router();

router.use(authenticateToken);

router.get("/daily", listDailySales);
router.get("/daily/entries", listDailySaleEntries);
router.put("/daily", upsertDailySale);

export default router;
