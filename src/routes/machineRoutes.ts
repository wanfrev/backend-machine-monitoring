import { Router } from 'express';
import { getMachines, getMachineById, createMachine, updateMachine, deleteMachine, getMachineHistory, getMachineStats } from '../controllers/machineController';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/', getMachines);
router.get('/:id', getMachineById);
router.get('/:id/history', getMachineHistory);
router.get('/:id/stats', getMachineStats);

// Only admin can manage machines
router.post('/', requireAdmin, createMachine);
router.put('/:id', requireAdmin, updateMachine);
router.delete('/:id', requireAdmin, deleteMachine);

export default router;
