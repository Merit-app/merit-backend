import { env } from './env';

const noop = {
  capture: (..._args: any[]) => {},
  identify: (..._args: any[]) => {},
  shutdown: async () => {},
};

const isReal = !!env.POSTHOG_API_KEY;

let posthogInstance: typeof noop | any = noop;

if (isReal) {
  try {
    const { PostHog } = require('posthog-node');
    posthogInstance = new PostHog(env.POSTHOG_API_KEY!, {
      host: env.POSTHOG_HOST ?? 'https://app.posthog.com',
    });
  } catch {
    posthogInstance = noop;
  }
}

export const posthog = posthogInstance;
