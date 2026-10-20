import { useState, type FormEvent } from 'react';
import type { ApiError, FieldError } from '../api';
import { useAuth } from '../auth';
import { ErrorBox } from '../components';

export default function AuthPage() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<FieldError[]>([]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, string> = { email: String(f.get('email')), password: String(f.get('password')) };
    if (mode === 'register') body.displayName = String(f.get('displayName'));
    setBusy(true);
    setError('');
    setFields([]);
    try {
      await signIn(mode, body);
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.message);
      setFields(e2.details ?? []);
    } finally {
      setBusy(false);
    }
  }

  const err = (name: string) => fields.find((x) => x.field === name)?.message;
  const input = 'mt-1 w-full rounded border border-slate-500 p-2';

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-2xl font-bold text-blue-900">SmartResolve AI</h1>
      <p className="mb-4 text-slate-700">Report campus issues and follow them through to resolution.</p>
      <form onSubmit={submit} noValidate className="space-y-3 rounded border bg-white p-4" aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
        <h2 className="text-lg font-semibold">{mode === 'login' ? 'Sign in' : 'Create a reporter account'}</h2>
        {error && <ErrorBox message={error} />}
        {mode === 'register' && (
          <div>
            <label htmlFor="displayName">Your name</label>
            <input id="displayName" name="displayName" autoComplete="name" className={input} aria-describedby="displayName-err" />
            <p id="displayName-err" className="text-sm text-red-800">{err('displayName')}</p>
          </div>
        )}
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" className={input} aria-describedby="email-err" />
          <p id="email-err" className="text-sm text-red-800">{err('email')}</p>
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className={input} aria-describedby="password-err" />
          <p id="password-err" className="text-sm text-red-800">{err('password')}</p>
        </div>
        <button disabled={busy} className="w-full rounded bg-blue-800 px-3 py-2 font-semibold text-white disabled:opacity-60">
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <button
          type="button"
          className="w-full text-blue-800 underline"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
            setFields([]);
          }}
        >
          {mode === 'login' ? 'New here? Create an account' : 'Already registered? Sign in'}
        </button>
        <p className="text-xs text-slate-600">Use synthetic identities only. Do not enter real personal information.</p>
      </form>
    </main>
  );
}
