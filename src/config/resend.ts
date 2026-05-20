import { env } from './env';

const mockResend = {
  emails: {
    send: async (params: { from: string; to: string | string[]; subject: string; html?: string; react?: any }) => {
      console.log(`[MOCK_EMAIL] to=${JSON.stringify(params.to)} subject="${params.subject}"`);
      return { data: { id: 'mock_email_' + Date.now() }, error: null };
    },
  },
};

const isReal = !!env.RESEND_API_KEY;

export const RESEND_MODE: 'real' | 'mock' = isReal ? 'real' : 'mock';

let resendClientInstance: typeof mockResend | any;

if (isReal) {
  const { Resend } = require('resend');
  resendClientInstance = new Resend(env.RESEND_API_KEY);
} else {
  resendClientInstance = mockResend;
}

export const resendClient = resendClientInstance;
