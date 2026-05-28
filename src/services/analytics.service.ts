import { posthog } from '../config/posthog';

export function trackEvent(userId: string, event: string, properties?: Record<string, any>) {
  try {
    posthog.capture({ distinctId: userId, event, properties });
  } catch {
    // Analytics failures are non-fatal
  }
}
