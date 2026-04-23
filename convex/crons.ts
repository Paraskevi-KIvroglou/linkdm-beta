import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run the cloud campaign loop every 5 minutes.
// LinkedIn's comment feed updates slowly; 5 min is a reasonable polling interval
// that stays well within Convex action rate limits.
crons.interval(
  "cloud campaign loop",
  { minutes: 5 },
  internal.cloudLoop.cloudCampaignLoop
);

export default crons;
