import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// 08:00 Europe/Moscow = 05:00 UTC.
crons.daily(
  "daily Finplan cost comment sync",
  { hourUTC: 5, minuteUTC: 0 },
  internal.finplanSync.syncDailyFinplanCosts,
);

crons.daily(
  "daily payment deadline reminders",
  { hourUTC: 5, minuteUTC: 0 },
  internal.requests.sendDailyPaymentDeadlineReminders,
);

export default crons;
