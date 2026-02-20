import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation, Link } from 'wouter';
import { api } from '../lib/api';

export default function Login() {
    const [, setLocation] = useLocation();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const loginMutation = useMutation({
        mutationFn: () => api.post('/auth/login', { username, password }),
        onSuccess: (data) => {
            localStorage.setItem('token', data.token);
            localStorage.setItem('username', username);
            setLocation('/lobby');
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (username && password) {
            loginMutation.mutate();
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div>
                    <h1>Welcome Back to Carioca</h1>
                    <p>Log in to join the multiplayer lobby</p>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div className="form-group">
                        <label>Username</label>
                        <input
                            className="input"
                            type="text"
                            placeholder="Enter your username"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Password</label>
                        <input
                            className="input"
                            type="password"
                            placeholder="Enter your password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    {loginMutation.isError && (
                        <p className="error-text">Failed to log in. Please check your credentials.</p>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={loginMutation.isPending}
                        style={{ marginTop: '0.5rem' }}
                    >
                        {loginMutation.isPending ? 'Logging in...' : 'Sign In'}
                    </button>
                </form>

                <p style={{ marginTop: '1rem' }}>
                    Don't have an account? <Link href="/register">Register here</Link>
                </p>
            </div>
        </div>
    );
}
