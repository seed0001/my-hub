import { prisma } from "@/lib/db";
import { sendPushToUser, pushConfigured } from "@/lib/push";

declare global {
  // eslint-disable-next-line no-var
  var __reminderDispatcher: ReturnType<typeof setInterval> | undefined;
}

/**
 * Background loop (started from instrumentation.ts on server boot) that
 * delivers due reminders as web-push notifications. Reminders for users
 * with no push subscription are left PENDING so the in-app poller can
 * surface them when the app is open.
 */
export function startReminderDispatcher() {
  if (!pushConfigured()) {
    console.log("[push] VAPID keys not set — push dispatch disabled (in-app reminders still work)");
    return;
  }
  if (globalThis.__reminderDispatcher) return;
  globalThis.__reminderDispatcher = setInterval(tick, 60_000);
  console.log("[push] reminder dispatcher started");
}

async function tick() {
  try {
    const due = await prisma.reminder.findMany({
      where: { status: "PENDING", dueAt: { lte: new Date() } },
      orderBy: { dueAt: "asc" },
      take: 50,
    });
    if (due.length === 0) return;

    const userIds = [...new Set(due.map((r) => r.userId))];
    const subCounts = await prisma.pushSubscription.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _count: true,
    });
    const hasSubs = new Set(subCounts.map((s) => s.userId));

    for (const r of due) {
      if (!hasSubs.has(r.userId)) continue; // leave for the in-app poller
      await prisma.reminder.update({
        where: { id: r.id },
        data: { status: "SENT" },
      });
      await sendPushToUser(r.userId, {
        title: r.title,
        body: r.body || undefined,
        tag: r.id,
      });
    }
  } catch (err) {
    console.error("[push] dispatch tick failed", err);
  }
}
