import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { AppLockGate } from '@/components/AppLockGate';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--bg)' }}
      />
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <AppLockGate>{children}</AppLockGate>;
}
