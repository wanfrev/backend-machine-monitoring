import { Router } from "express";
import {
  getCoinValues,
  setCoinValue,
} from "../controllers/coinValueController";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware";

const router = Router();

router.use(authenticateToken);

// Any authenticated user can read values (needed to compute incomes)
router.get("/", getCoinValues);

// Only admin can change values
router.put("/:type", requireAdmin, setCoinValue);

export default router;
