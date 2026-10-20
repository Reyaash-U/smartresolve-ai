import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User } from '../models';
import { requireAuth, signToken } from '../middleware/auth';

// .strict() rejects unknown keys, so a client sending {"role":"admin"} gets a 400, not an elevation.
const registerSchema = z
  .object({
    displayName: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(120),
    password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  })
  .strict();

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(120), password: z.string().min(1).max(72) }).strict();

// Valid bcrypt hash of a random string; used so unknown emails take comparable time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function authRouter(loginMax = 10) {
  const r = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: loginMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
  });

  r.post('/register', async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
      }
      const { displayName, email, password } = parsed.data;
      if (await User.exists({ email })) return res.status(409).json({ error: 'An account with this email already exists' });

      const user = await User.create({ displayName, email, passwordHash: await bcrypt.hash(password, 10), role: 'reporter' });
      res.status(201).json({ token: signToken(user.id, 'reporter'), user: { id: user.id, displayName, email, role: 'reporter' } });
    } catch (e) {
      next(e);
    }
  });

  r.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Enter your email and password' });
      const { email, password } = parsed.data;

      const user = await User.findOne({ email }).select('+passwordHash');
      const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok || !user.active) return res.status(401).json({ error: 'Incorrect email or password' });

      res.json({ token: signToken(user.id, user.role as 'reporter'), user: { id: user.id, displayName: user.displayName, email: user.email, role: user.role } });
    } catch (e) {
      next(e);
    }
  });

  return r;
}

export const meRouter = Router();
meRouter.get('/', requireAuth, (req, res) => res.json({ user: req.user }));
