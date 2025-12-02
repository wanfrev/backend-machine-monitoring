import { Router } from 'express';
import { getUsers, createUser, deleteUser } from '../controllers/userController';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken); // All user routes require auth
router.use(requireAdmin);      // All user routes require admin (for now)

router.get('/', getUsers);
router.post('/', createUser);
router.delete('/:id', deleteUser);

export default router;
