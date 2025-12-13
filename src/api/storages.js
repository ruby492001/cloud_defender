import { t } from "../strings.js";

const API_PREFIX = "/api";

async function parseJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

async function handleResponse(res, fallbackMessage) {
    const data = await parseJson(res);
    if (!res.ok) {
        const err = new Error(data?.error || fallbackMessage || `Request failed ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

export async function fetchStorages() {
    const res = await fetch(`${API_PREFIX}/storages`, {
        method: "GET",
        credentials: "include",
    });
    return handleResponse(res, t("storages_error_fetch"));
}

export async function createStorage(payload) {
    const res = await fetch(`${API_PREFIX}/storages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
    });
    return handleResponse(res, t("storages_error_create"));
}

export async function deleteStorage(id) {
    const res = await fetch(`${API_PREFIX}/storages/${id}`, {
        method: "DELETE",
        credentials: "include",
    });
    if (res.status === 204) return { id };
    return handleResponse(res, t("storages_error_delete"));
}

export async function refreshStorage(id) {
    const res = await fetch(`${API_PREFIX}/storages/${id}/refresh`, {
        method: "POST",
        credentials: "include",
    });
    return handleResponse(res, t("storages_error_refresh"));
}

export async function logout() {
    await fetch(`${API_PREFIX}/logout`, {
        method: "POST",
        credentials: "include",
    });
}
