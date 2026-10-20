import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../config';
import { User } from '../models';
import type { Role } from '../services/statusMachine';

export interface AuthUser {
  id: string;
  role: Role;
  displayName: string;
  email: string;
  departmentId?: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function signToken(userId: string, role: Role): string {
  return jwt.sign({ sub: userId, role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/** Identity always comes from the verified token + a fresh DB lookup, never from the request body. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(header.slice(7), config.jwtSecret) as jwt.JwtPayload;
    } catch {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    if (typeof payload.sub !== 'string' || !mongoose.isValidObjectId(payload.sub)) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const user = await User.findById(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: 'Account unavailable' });

    req.user = {
      id: user.id,
      role: user.role as Role,
      displayName: user.displayName,
      email: user.email,
      departmentId: user.departmentId?.toString(),
    };
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to do that' });
    next();
  };
