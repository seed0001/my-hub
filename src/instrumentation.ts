export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startReminderDispatcher } = await import("@/lib/reminderDispatcher");
    startReminderDispatcher();
  }
}
