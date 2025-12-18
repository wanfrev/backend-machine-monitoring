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

// Endpoint de prueba para enviar una notificación a todos los suscriptores
router.post("/send-test", async (req, res) => {
  try {
    const { sendNotificationToAll } = await import(
      "../utils/pushSubscriptions"
    );
    const payload = req.body || {
      title: "Notificación de prueba",
      body: "Prueba push desde el backend",
      data: { test: true, ts: new Date().toISOString() },
    };
    await sendNotificationToAll(payload);
    res.json({ status: "ok" });
  } catch (e) {
    console.error("Error sending test push:", e);
    res.status(500).json({ status: "error", message: String(e) });
  }
});

// Endpoint que recibe logs desde el Service Worker (solo para depuración)
router.post("/log", (req, res) => {
  try {
    console.log("[SW LOG]", req.ip || "-", req.body);
    res.json({ status: "ok" });
  } catch (e) {
    console.error("Error handling SW log:", e);
    res.status(500).json({ status: "error" });
  }
});

export default router;
