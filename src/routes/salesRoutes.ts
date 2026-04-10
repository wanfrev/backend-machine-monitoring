import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import {
  getMyOperatorCoinBalance,
  listDailySales,
  listDailySaleEntries,
  resetOperatorCoinBalance,
  upsertDailySale,
} from "../controllers/salesController";

const router = Router();

router.use(authenticateToken);

router.get("/daily", listDailySales);
router.get("/daily/entries", listDailySaleEntries);
router.get("/operator/coins/me", getMyOperatorCoinBalance);
router.put("/operator/coins/:employeeId/reset", resetOperatorCoinBalance);
router.put("/daily", upsertDailySale);

export default router;
