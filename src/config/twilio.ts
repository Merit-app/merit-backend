import { env } from './env';

const mockTwilio = {
  messages: {
    create: async (params: { to: string; body: string; from?: string }) => {
      console.log(`[MOCK_SMS] to=${params.to} body="${params.body}"`);
      return { sid: 'MOCK_SID_' + Date.now() };
    },
  },
};

const isReal = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);

export const TWILIO_MODE: 'real' | 'mock' = isReal ? 'real' : 'mock';

let twilioClientInstance: typeof mockTwilio | any;

if (isReal) {
  const Twilio = require('twilio');
  twilioClientInstance = new Twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
} else {
  twilioClientInstance = mockTwilio;
}

export const twilioClient = twilioClientInstance;
