import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import {
  listWeeklyReports,
  upsertWeeklyReport,
} from "../controllers/reportsController";

const router = Router();

router.use(authenticateToken);

router.get("/weekly", listWeeklyReports);
router.put("/weekly", upsertWeeklyReport);

export default router;
