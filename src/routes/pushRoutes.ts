import { Router } from "express";
import {
  addSubscription,
  removeSubscription,
  getVapidPublicKey,
} from "../utils/pushSubscriptions";

const router = Router();

// Registrar una suscripción push desde el cliente
router.post("/subscribe", async (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint)
    return res.status(400).json({ message: "Invalid subscription" });
  try {
    await addSubscription(sub);
    return res.json({ status: "ok" });
  } catch (err) {
    console.error("Error in /api/push/subscribe:", err);
    return res.status(500).json({ message: "Failed to save subscription" });
  }
});

router.post("/unsubscribe", async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ message: "Missing endpoint" });
  try {
    await removeSubscription(endpoint);
    return res.json({ status: "ok" });
  } catch (err) {
    console.error("Error in /api/push/unsubscribe:", err);
    return res.status(500).json({ message: "Failed to remove subscription" });
  }
});

router.get("/vapid-public", (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

export default router;
