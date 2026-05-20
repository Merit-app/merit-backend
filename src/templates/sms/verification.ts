import { formatDate } from '../../utils/format';

export function formatVerificationSMS(opts: {
  supervisorName: string;
  studentName: string;
  hours: number;
  orgName: string;
  date: string;
}) {
  return `Hi ${opts.supervisorName}, ${opts.studentName} logged ${opts.hours} hours at ${opts.orgName} on ${formatDate(opts.date)}. Reply YES to verify, NO to dispute, STOP to opt out. — Merit`;
}
