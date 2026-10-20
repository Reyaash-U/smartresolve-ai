import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { waitForBackend } from './api';
import { useAuth } from './auth';
import { AccessDenied, Layout, Spinner } from './components';
import AuthPage from './pages/AuthPage';
import ReportIssue from './pages/ReportIssue';
import IssueList from './pages/IssueList';
import IssueDetail from './pages/IssueDetail';
import RoutingQueue from './pages/RoutingQueue';
import Analytics from './pages/Analytics';

function Home() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'reporter' ? '/report' : '/issues'} replace />;
}

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return user ? <Layout /> : <AuthPage />;
}

export default function App() {
  const [state, setState] = useState<'checking' | 'ready' | 'failed'>('checking');
  const [attempt, setAttempt] = useState(1);
  const [run, setRun] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    setState('checking');
    waitForBackend(setAttempt).then((ok) => setState(ok ? 'ready' : 'failed'));
  }, [run]);

  if (state !== 'ready') {
    return (
      <main className="mx-auto max-w-xl p-4">
        <h1 className="text-2xl font-bold text-blue-900">SmartResolve AI</h1>
        <div role="status" className="mt-6 rounded border bg-white p-4">
          {state === 'checking' ? (
            <p>Connecting to the server (attempt {attempt}). The free-tier server can take about a minute to wake up…</p>
          ) : (
            <>
              <p>Could not reach the server. Please try again.</p>
              <button className="mt-2 rounded bg-blue-800 px-3 py-1 text-white" onClick={() => setRun((r) => r + 1)}>Retry</button>
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <Routes>
      <Route element={<Protected />}>
        <Route path="/" element={<Home />} />
        <Route path="/report" element={user?.role === 'staff' ? <AccessDenied /> : <ReportIssue />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/routing"element={user?.role === 'admin' ? <RoutingQueue /> : <AccessDenied />} />
        <Route path="/issues" element={<IssueList />} />
        <Route path="/issues/:id" element={<IssueDetail />} />
        <Route path="*" element={<AccessDenied />} />
      </Route>
    </Routes>
  );
}
