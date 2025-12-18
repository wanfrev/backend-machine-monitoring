import fs from "fs";
import path from "path";
import webpush from "web-push";

const DB_PATH = path.join(__dirname, "..", "..", "push_subscriptions.json");

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
    fs.writeFileSync(DB_PATH, JSON.stringify(arr, null, 2), "utf-8");
  } catch (e) {
    console.error("Error writing push subscriptions DB:", e);
  }
}

export function addSubscription(sub: any) {
  const all = readDb();
  // avoid duplicates by endpoint
  const exists = all.find((s) => s.endpoint === sub.endpoint);
  if (exists) return;
  all.push(sub);
  writeDb(all);
}

export function removeSubscription(endpoint: string) {
  const all = readDb().filter((s) => s.endpoint !== endpoint);
  writeDb(all);
}

export function getSubscriptions() {
  return readDb();
}

export async function sendNotificationToAll(payload: any) {
  const subs = getSubscriptions();
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
