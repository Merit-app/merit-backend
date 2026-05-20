export function formatReminderSMS(opts: {
  supervisorName: string;
  studentName: string;
  hours: number;
  orgName: string;
}) {
  return `Reminder from Merit: ${opts.studentName} is waiting for verification of ${opts.hours} hours at ${opts.orgName}. Reply YES or NO. (Reply STOP to opt out.)`;
}
