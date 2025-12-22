import fs from "fs";
import path from "path";
import webpush from "web-push";
import { pool } from "../db";

// Allow configuring a storage path outside the repo to avoid process watchers
// restarting the app when the file is written. Default: <cwd>/data/push_subscriptions.json
const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");
try {
  if (!fs.existsSync(DEFAULT_DATA_DIR))
    fs.mkdirSync(DEFAULT_DATA_DIR, { recursive: true });
} catch (e) {
  // ignore directory creation errors; fallback to repo path below
}

const DB_PATH =
  process.env.PUSH_SUBSCRIPTIONS_PATH ||
  process.env.PUSH_DB_PATH ||
  path.join(DEFAULT_DATA_DIR, "push_subscriptions.json");

const USE_DB =
  (process.env.PUSH_USE_DB === "true" || process.env.PUSH_USE_DB === "1") &&
  !!process.env.DATABASE_URL;

function readDb(): any[] {
  try {
    if (!fs.existsSync(DB_PATH)) return [];
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("Error reading push subscriptions DB:", e);
    return [];
  }
}

function writeDb(arr: any[]) {
  try {
    // atomic write: write to temp then rename
    const tmp = DB_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), "utf-8");
    fs.renameSync(tmp, DB_PATH);
  } catch (e) {
    console.error("Error writing push subscriptions DB:", e);
  }
}

export async function addSubscription(sub: any): Promise<void> {
  if (USE_DB) {
    const q = `INSERT INTO push_subscriptions(endpoint, subscription) VALUES($1, $2) ON CONFLICT (endpoint) DO NOTHING`;
    try {
      await pool.query(q, [sub.endpoint, sub]);
    } catch (err) {
      console.error("Error inserting push subscription:", err);
      throw err;
    }
    return;
  }
  try {
    const all = readDb();
    // avoid duplicates by endpoint
    const exists = all.find((s) => s.endpoint === sub.endpoint);
    if (exists) return;
    all.push(sub);
    writeDb(all);
  } catch (err) {
    console.error("Error adding subscription to file DB:", err);
    throw err;
  }
}

export async function removeSubscription(endpoint: string): Promise<void> {
  if (USE_DB) {
    try {
      await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [
        endpoint,
      ]);
    } catch (err) {
      console.error("Error removing push subscription:", err);
      throw err;
    }
    return;
  }
  try {
    const all = readDb().filter((s) => s.endpoint !== endpoint);
    writeDb(all);
  } catch (err) {
    console.error("Error removing subscription from file DB:", err);
    throw err;
  }
}

export function getSubscriptions() {
  if (USE_DB) {
    // synchronous semantics not possible for DB; return empty and let
    // sendNotificationToAll read from DB directly
    return [] as any[];
  }
  return readDb();
}

export async function sendNotificationToAll(payload: any) {
  let subs: any[] = [];
  if (USE_DB) {
    try {
      const res = await pool.query(
        "SELECT subscription FROM push_subscriptions"
      );
      subs = res.rows.map((r: any) => r.subscription).filter(Boolean);
    } catch (e) {
      console.error("Error querying push subscriptions:", e);
      subs = [];
    }
  } else {
    subs = getSubscriptions();
  }
  if (!subs.length) return;
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!vapidPublic || !vapidPrivate) {
    console.warn("VAPID keys not set; skipping push notifications");
    return;
  }
  try {
    webpush.setVapidDetails(subject, vapidPublic, vapidPrivate);
  } catch (e) {
    console.error("Error setting VAPID details:", e);
    return;
  }

  const promises = subs.map((s) => {
    try {
      return webpush
        .sendNotification(s, JSON.stringify(payload))
        .catch((err: any) => {
          // If subscription is no longer valid, remove it
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            removeSubscription(s.endpoint);
          } else {
            console.error("Error sending push to", s.endpoint, err);
          }
        });
    } catch (err: any) {
      console.error("Error sending push (sync):", err);
      return Promise.resolve();
    }
  });
  await Promise.all(promises);
}

export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}
