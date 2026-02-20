const BASE_URL = 'http://localhost:3000/api';

export const api = {
    async get(endpoint: string) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${BASE_URL}${endpoint}`, {
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });
        if (!res.ok) throw new Error('API Error');
        return res.json();
    },

    async post(endpoint: string, data: unknown) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(data),
        });

        // Axum returning text or json depending on the endpoint
        const text = await res.text();
        if (!res.ok) {
            throw new Error(text || 'API Error');
        }

        try {
            return JSON.parse(text);
        } catch {
            // If it's just a raw token string (like our login endpoint returns)
            return { token: text };
        }
    },
};
