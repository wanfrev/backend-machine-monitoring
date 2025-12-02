import { Router } from 'express';
import { receiveData } from '../controllers/iotController';

const router = Router();

// Public endpoint for IoT devices (or protect with API Key middleware)
router.post('/data', receiveData);

export default router;
