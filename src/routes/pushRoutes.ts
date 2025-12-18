import { Router } from "express";
import {
  addSubscription,
  removeSubscription,
  getVapidPublicKey,
} from "../utils/pushSubscriptions";

const router = Router();

// Registrar una suscripción push desde el cliente
router.post("/subscribe", (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint)
    return res.status(400).json({ message: "Invalid subscription" });
  addSubscription(sub);
  res.json({ status: "ok" });
});

router.post("/unsubscribe", (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ message: "Missing endpoint" });
  removeSubscription(endpoint);
  res.json({ status: "ok" });
});

router.get("/vapid-public", (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

export default router;
