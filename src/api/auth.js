const API_PREFIX = '/api';

async function parseResponse(response, fallbackMessage) {
    let data = null;
    try {
        data = await response.json();
    } catch (e) {
        // ignore parse errors, we'll fall back to a generic message
    }

    if (!response.ok) {
        const message = data?.error || fallbackMessage || `Request failed (${response.status})`;
        throw new Error(message);
    }

    return data;
}

export async function login(payload) {
    const response = await fetch(`${API_PREFIX}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
    });

    return parseResponse(response, 'Не удалось выполнить вход');
}

export async function register(payload) {
    const response = await fetch(`${API_PREFIX}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
    });

    return parseResponse(response, 'Не удалось создать учетную запись');
}
