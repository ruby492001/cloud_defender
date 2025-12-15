import { t } from "../strings.js";

const API_PREFIX = "/api";

async function parseResponse(response, fallbackMessage) {
    let data = null;
    try {
        data = await response.json();
    } catch (e) {
        // ignore parse errors, fallback below
    }

    if (!response.ok) {
        const message = data?.error || fallbackMessage || `Request failed (${response.status})`;
        throw new Error(message);
    }

    return data;
}

export async function login(payload) {
    const response = await fetch(`${API_PREFIX}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
    });

    return parseResponse(response, t("api_login_error"));
}

export async function register(payload) {
    const response = await fetch(`${API_PREFIX}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
    });

    return parseResponse(response, t("api_register_error"));
}

export async function changePassword(payload) {
    const response = await fetch(`${API_PREFIX}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
    });

    return parseResponse(response, t("api_change_pwd_error"));
}

export async function fetchDesktopClient() {
    const response = await fetch(`${API_PREFIX}/google/desktop-client`, {
        method: "GET",
        credentials: "include",
    });

    return parseResponse(response, t("api_fetch_rclone_error"));
}

export async function fetchClientId() {
    const response = await fetch(`${API_PREFIX}/google/client-id`, {
        method: "GET",
        credentials: "include",
    });

    return parseResponse(response, "Failed to fetch Google client id");
}
