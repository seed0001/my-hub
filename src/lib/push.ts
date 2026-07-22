import webpush from "web-push";
import { prisma } from "@/lib/db";

let configured = false;

export function pushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
}

function ensureConfig() {
  if (configured || !pushConfigured()) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  configured = true;
}

export interface PushPayload {
  title: string;
  body?: string;
  tag?: string;
}

/** Send a push notification to every device the user has subscribed. */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!pushConfigured()) return;
  ensureConfig();

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload)
        );
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        // Subscription expired or was revoked — drop it.
        if (status === 404 || status === 410) {
          await prisma.pushSubscription
            .delete({ where: { id: s.id } })
            .catch(() => {});
        } else {
          console.error("push send failed", status, err);
        }
      }
    })
  );
}
