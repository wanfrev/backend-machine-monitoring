import { Router } from "express";
import {
  receiveData,
  getEvents,
  getStatus,
} from "../controllers/iotController";

const router = Router();

// Public endpoint for IoT devices (or protect with API Key middleware)
router.post("/data", receiveData);
router.get("/events", getEvents);
router.get("/status", getStatus);

export default router;
