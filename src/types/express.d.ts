import { Plan } from '../config/plans';

declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: {
        id: string;
        email: string;
        name: string;
        role: string;
        plan: Plan;
      };
      authUser?: {
        id: string;
        email?: string;
      };
    }
  }
}

export {};
