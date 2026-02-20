import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation, Link } from 'wouter';
import { api } from '../lib/api';

export default function Register() {
    const [, setLocation] = useLocation();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const registerMutation = useMutation({
        mutationFn: () => api.post('/auth/register', { username, password }),
        onSuccess: () => {
            // Upon successful registration, redirect to login
            setLocation('/');
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (username && password) {
            registerMutation.mutate();
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div>
                    <h1>Create Account</h1>
                    <p>Join the best online Carioca platform</p>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div className="form-group">
                        <label>Username</label>
                        <input
                            className="input"
                            type="text"
                            placeholder="Choose a username"
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
                            placeholder="Create a password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    {registerMutation.isError && (
                        <p className="error-text">{registerMutation.error?.message || 'Failed to register account.'}</p>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={registerMutation.isPending}
                        style={{ marginTop: '0.5rem' }}
                    >
                        {registerMutation.isPending ? 'Creating Account...' : 'Register'}
                    </button>
                </form>

                <p style={{ marginTop: '1rem' }}>
                    Already have an account? <Link href="/">Log in</Link>
                </p>
            </div>
        </div>
    );
}
