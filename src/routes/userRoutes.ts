import { Router } from "express";
import {
  getUsers,
  createUser,
  deleteUser,
  updateUser,
  getMe,
  updateMe,
  getMyTeamUsers,
} from "../controllers/userController";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware";

const router = Router();

router.use(authenticateToken); // All user routes require auth

// Self profile routes (no admin required)
router.get("/me", getMe);
router.put("/me", updateMe);

// Team users for supervisors (only their assigned machines' operators)
router.get("/my-team", getMyTeamUsers);

// Admin-only user management
router.use(requireAdmin);

router.get("/", getUsers);
router.post("/", createUser);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);

export default router;
