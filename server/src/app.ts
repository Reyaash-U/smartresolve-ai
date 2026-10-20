import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { config } from './config';
import { authRouter, meRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { analyticsRouter } from './routes/analytics';
import { issuesRouter } from './routes/issues';
import { issueActionsRouter } from './routes/issueActions';

export function createApp(opts: { loginRateLimitMax?: number } = {}) {
  const app = express();
  // Render sits behind one proxy: trust it so rate limiting keys on the real client IP, not the proxy's.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.clientOrigins, credentials: false }));
  app.use(express.json({ limit: '50kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', time: new Date().toISOString() });
  });

  app.use('/auth', authRouter(opts.loginRateLimitMax));
  app.use('/me', meRouter);
  app.use('/admin', adminRouter);
  app.use('/analytics', analyticsRouter);
  app.use('/issues', issuesRouter);
  app.use('/issues', issueActionsRouter);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // Malformed JSON and other errors: never leak stack traces to clients
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    console.error(err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
