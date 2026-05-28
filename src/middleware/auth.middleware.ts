import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin, SUPABASE_MODE } from '../config/supabase';
import { UnauthorizedError } from '../lib/errors';

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next(new UnauthorizedError());
    }

    const token = authHeader.slice(7);

    if (SUPABASE_MODE === 'mock') {
      return next(new UnauthorizedError('Auth not available in mock mode'));
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      return next(new UnauthorizedError('Invalid or expired token'));
    }

    const { data: appUser, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, email, name, role, plan')
      .eq('id', data.user.id)
      .single();

    if (userErr || !appUser) {
      return next(new UnauthorizedError('User not found'));
    }

    req.authUser = { id: data.user.id, email: data.user.email };
    req.user = {
      id: appUser.id,
      email: appUser.email,
      name: appUser.name ?? '',
      role: appUser.role,
      plan: appUser.plan,
    };

    next();
  } catch (err) {
    next(err);
  }
}
