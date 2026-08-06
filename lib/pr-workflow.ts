/** How many days a Purchase Request can sit in one office before Monitoring
 *  flags it "overdue" (and the reminder cron -- see
 *  /api/cron/pr-reminders -- emails the submitter). Shared between the two
 *  so they never disagree about what "overdue" means. */
export const OVERDUE_DAYS = 15;
