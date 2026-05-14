import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import {
  getExchangeRate,
  updateExchangeRate,
} from "../controllers/exchangeRateController";

const router = Router();

router.use(authenticateToken);
router.get("/", getExchangeRate);
router.put("/", updateExchangeRate);

export default router;
