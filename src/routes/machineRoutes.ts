import { Router } from "express";
import {
  getMachines,
  getMachineById,
  createMachine,
  updateMachine,
  deleteMachine,
  getMachineHistory,
  getMachineStats,
  getTotalCoins,
  getCoinsByMachine,
  getMachineDailyIncome,
} from "../controllers/machineController";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware";

const router = Router();

router.use(authenticateToken);

router.get("/", getMachines);
router.get("/coins/total", getTotalCoins);
router.get("/coins/by-machine", getCoinsByMachine);
router.get("/:id", getMachineById);
router.get("/:id/history", getMachineHistory);

router.get("/:id/income/daily", getMachineDailyIncome);
router.get("/:id/stats", getMachineStats);

// Only admin can manage machines
router.post("/", requireAdmin, createMachine);
router.put("/:id", requireAdmin, updateMachine);
router.delete("/:id", requireAdmin, deleteMachine);

export default router;
