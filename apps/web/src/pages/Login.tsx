import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, Input, Button } from '../components/ui';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const registeredEmail = searchParams.get('email') ?? '';
  const [email, setEmail] = useState(registeredEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const from = location.state?.from?.pathname || '/markets';
  const registrationSucceeded = searchParams.get('registered') === '1';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login({ email, password });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="auth-page">
      <Card className="auth-card">
        <div className="auth-header">
          <div className="auth-eyebrow">Control Plane Access</div>
          <h2 className="auth-title">Sign in to Analytics</h2>
          <p className="auth-subtitle">Use the account issued by your admin to access monitored markets, target workbenches, and ops tools.</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div>
            <label htmlFor="login-email" className="auth-field-label">Email</label>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label htmlFor="login-password" className="auth-field-label">Password</label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          {registrationSucceeded ? (
            <div className="auth-message success">Registration submitted. An admin must activate this account before the first sign-in.</div>
          ) : null}
          {error ? <div className="auth-message error">{error}</div> : null}
          <Button variant="primary" type="submit" style={{ marginTop: '8px' }}>Sign in</Button>
        </form>

        <div className="auth-footer">
          Need an account? <Link to="/register">Register with an invite</Link>
        </div>
      </Card>
    </div>
  );
}
