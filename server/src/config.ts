import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required('MONGODB_URI', process.env.NODE_ENV === 'test' ? 'mongodb://127.0.0.1/test' : undefined),
  jwtSecret: required('JWT_SECRET', process.env.NODE_ENV === 'test' ? 'test-secret' : undefined),
  /** One or more allowed browser origins, comma separated (e.g. the Cloudflare Pages URL). No wildcards. */
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  jwtExpiresIn: '8h' as const,
  /** Starting values from the brief; tunable and not claimed to be calibrated. */
  classifierThreshold: Number(process.env.CLASSIFIER_THRESHOLD ?? 0.65),
  duplicateThreshold: Number(process.env.DUPLICATE_THRESHOLD ?? 0.55),
};
