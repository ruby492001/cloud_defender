// src/api/drive.js

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_INIT =
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";

export class DriveApi {
    constructor(token, options = {}) {
        this.token = token;
        this.refreshToken = options.refreshToken; // async () => newToken
        this.rootId = options.rootId || "root";
    }

    setToken(token) {
        this.token = token;
    }

    authHeaders(extra) {
        return { Authorization: `Bearer ${this.token}`, Accept: "application/json", ...(extra || {}) };
    }

    async fetchWithAuth(url, init = {}, retry = true) {
        const res = await fetch(url, { ...init, headers: this.authHeaders(init.headers) });
        if (res.status === 401 && this.refreshToken && retry) {
            const next = await this.refreshToken().catch(() => null);
            if (next) {
                this.token = next;
                return this.fetchWithAuth(url, init, false);
            }
        }
        return res;
    }

    async ensureOk(res, label) {
        if (res.ok) return res;
        const text = await res.text().catch(() => "");
        const err = new Error(`${label} ${res.status}${text ? ` ${text}` : ""}`);
        err.status = res.status;
        throw err;
    }

    async getFileMeta(id) {
        const url = new URL(`${DRIVE_BASE}/files/${id}`);
        url.searchParams.set("fields", "id,name,size,modifiedTime,mimeType,parents,md5Checksum");
        url.searchParams.set("supportsAllDrives", "true");
        const res = await this.fetchWithAuth(url, { headers: this.authHeaders() });
        await this.ensureOk(res, "meta");
        return res.json();
    }

    async listFolder(folderId = this.rootId, pageToken, search) {
        const target = folderId || this.rootId;
        const qParts = [`'${target}' in parents`, "trashed = false"];
        if (search && search.trim()) {
            qParts.push(`name contains '${search.replace(/'/g, "\\'")}'`);
        }

        const url = new URL(`${DRIVE_BASE}/files`);
        url.searchParams.set("q", qParts.join(" and "));
        url.searchParams.set("fields", "files(id,name,size,modifiedTime,mimeType,parents),nextPageToken");
        url.searchParams.set("orderBy", "folder,name");
        url.searchParams.set("pageSize", "1000");
        url.searchParams.set("supportsAllDrives", "true");
        url.searchParams.set("includeItemsFromAllDrives", "true");
        url.searchParams.set("spaces", "drive");
        url.searchParams.set("corpora", "allDrives");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const res = await this.fetchWithAuth(url, { headers: this.authHeaders() });
        await this.ensureOk(res, "list");
        return res.json();
    }

    async createFolder(name, parentId = this.rootId) {
        const res = await this.fetchWithAuth(`${DRIVE_BASE}/files?supportsAllDrives=true`, {
            method: "POST",
            headers: this.authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
        });
        await this.ensureOk(res, "create folder failed");
        return res.json();
    }

    async deleteFile(id) {
        const res = await this.fetchWithAuth(`${DRIVE_BASE}/files/${id}?supportsAllDrives=true`, {
            method: "DELETE",
            headers: this.authHeaders(),
        });
        await this.ensureOk(res, "delete failed");
    }

    async renameFile(id, newName) {
        const res = await this.fetchWithAuth(`${DRIVE_BASE}/files/${id}?supportsAllDrives=true`, {
            method: "PATCH",
            headers: this.authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ name: newName }),
        });
        await this.ensureOk(res, "rename failed");
        return res.json();
    }

    async moveFile(id, newParentId, oldParentId) {
        const url = new URL(`${DRIVE_BASE}/files/${id}`);
        url.searchParams.set("addParents", newParentId);
        if (oldParentId) url.searchParams.set("removeParents", oldParentId);
        url.searchParams.set("supportsAllDrives", "true");
        const res = await this.fetchWithAuth(url, {
            method: "PATCH",
            headers: this.authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({}),
        });
        await this.ensureOk(res, "move failed");
        return res.json();
    }

    async copyFile(id, name, newParentId) {
        const res = await this.fetchWithAuth(`${DRIVE_BASE}/files/${id}/copy?supportsAllDrives=true`, {
            method: "POST",
            headers: this.authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ name, parents: [newParentId] }),
        });
        await this.ensureOk(res, "copy failed");
        return res.json();
    }

    async findFileByName(name, parentId = this.rootId) {
        if (!name) return null;
        const url = new URL(`${DRIVE_BASE}/files`);
        const escapedName = name.replace(/'/g, "\\'");
        url.searchParams.set("q", `name='${escapedName}' and '${parentId}' in parents and trashed = false`);
        url.searchParams.set("fields", "files(id,name,parents,mimeType,size,modifiedTime),nextPageToken");
        url.searchParams.set("pageSize", "10");
        url.searchParams.set("supportsAllDrives", "true");
        url.searchParams.set("includeItemsFromAllDrives", "true");
        url.searchParams.set("spaces", "drive");
        url.searchParams.set("corpora", "allDrives");
        const res = await this.fetchWithAuth(url, { headers: this.authHeaders() });
        await this.ensureOk(res, "findFileByName failed");
        const data = await res.json();
        return (data.files && data.files[0]) || null;
    }

    async downloadInChunks({ id, name, size, onProgress, signal, onChunk, concurrency = 3 }) {
        const meta = await this.getFileMeta(id);
        const finalName = name ?? meta.name;
        let fileSize = Number(size ?? meta.size ?? 0) || 0;

        // Some Drive file types may omit `size`. Try to resolve the total using a 1-byte range request.
        // This allows a progressive download UI instead of a 0% -> 100% jump.
        if (!fileSize) {
            try {
                const probe = await this.fetchWithAuth(`${DRIVE_BASE}/files/${id}?alt=media`, {
                    headers: this.authHeaders({ Range: "bytes=0-0" }),
                    signal,
                });
                if (probe.status === 206) {
                    const contentRange = probe.headers.get("Content-Range") || "";
                    const match = contentRange.match(/\/(\d+)\s*$/);
                    const total = match ? Number(match[1]) : 0;
                    if (Number.isFinite(total) && total > 0) {
                        fileSize = total;
                    }
                }
            } catch {
                // ignore probe errors and fall back to non-progressive download
            }
        }

        if (!fileSize) {
            const res = await this.fetchWithAuth(`${DRIVE_BASE}/files/${id}?alt=media`, {
                headers: this.authHeaders(),
                signal,
            });
            await this.ensureOk(res, "Download fetch error");
            const blob = await res.blob();
            if (onChunk) {
                const arr = new Uint8Array(await blob.arrayBuffer());
                await onChunk(arr, { offset: 0, end: arr.length, total: arr.length });
                return { name: finalName, size: arr.length };
            }
            return { blob, name: finalName, size: blob.size };
        }

        const chunkSize = 10 * 1024 * 1024;
        const effectiveConcurrency = Math.max(1, Number(concurrency || 3));
        const ranges = [];
        for (let start = 0; start < fileSize; start += chunkSize) {
            const end = Math.min(start + chunkSize, fileSize);
            ranges.push({ start, end });
        }

        const pending = new Map();
        const HIGH_WATER_BYTES = 200 * 1024 * 1024;
        const LOW_WATER_BYTES = 100 * 1024 * 1024;
        let pendingBytes = 0;
        let nextOffset = 0;
        let draining = false;
        const orderedBuffers = [];

        const drain = async () => {
            if (draining) return;
            draining = true;
            try {
                while (pending.has(nextOffset)) {
                    const buf = pending.get(nextOffset);
                    pending.delete(nextOffset);
                    pendingBytes -= buf.byteLength;
                    const chunkEnd = nextOffset + buf.byteLength;
                    if (onChunk) {
                        await onChunk(buf, { offset: nextOffset, end: chunkEnd, total: fileSize });
                    } else {
                        orderedBuffers.push(buf);
                    }
                    nextOffset = chunkEnd;
                    onProgress?.(Math.min(nextOffset, fileSize), fileSize);
                }
            } finally {
                draining = false;
            }
        };

        const inflight = new Set();
        const schedule = async (range) => {
            while (inflight.size >= effectiveConcurrency) {
                await Promise.race(inflight);
            }
            while (pendingBytes > HIGH_WATER_BYTES) {
                await drain();
                if (pendingBytes > LOW_WATER_BYTES && inflight.size > 0) {
                    await Promise.race(inflight);
                } else {
                    break;
                }
            }
            const task = (async () => {
                if (signal?.aborted) throw new DOMException("aborted", "AbortError");
                const res = await this.fetchWithAuth(`${DRIVE_BASE}/files/${id}?alt=media`, {
                    headers: this.authHeaders({ Range: `bytes=${range.start}-${range.end - 1}` }),
                    signal,
                });
                if (!(res.ok || res.status === 206)) throw new Error(`Read error: ${res.status}`);
                const buf = new Uint8Array(await res.arrayBuffer());
                pending.set(range.start, buf);
                pendingBytes += buf.byteLength;
                await drain();
            })();
            inflight.add(task);
            task.finally(() => inflight.delete(task));
        };

        for (const range of ranges) {
            await schedule(range);
        }

        if (inflight.size > 0) {
            await Promise.all(Array.from(inflight));
        }
        await drain();

        if (onChunk) {
            return { name: finalName, size: fileSize };
        }

        const totalLen = orderedBuffers.reduce((a, buf) => a + buf.byteLength, 0);
        const out = new Uint8Array(totalLen);
        let offset = 0;
        for (const buf of orderedBuffers) {
            out.set(buf, offset);
            offset += buf.byteLength;
        }
        const blob = new Blob([out], { type: "application/octet-stream" });
        return { blob, name: finalName, size: fileSize };
    }

    async initResumableUpload({ name, mimeType, size, parentId }) {
        const metadata = {
            name,
            mimeType: mimeType || "application/octet-stream",
            ...(parentId ? { parents: [parentId] } : {}),
        };
        const res = await this.fetchWithAuth(DRIVE_UPLOAD_INIT, {
            method: "POST",
            headers: {
                ...this.authHeaders({ "Content-Type": "application/json; charset=UTF-8" }),
                "X-Upload-Content-Type": metadata.mimeType,
                "X-Upload-Content-Length": String(size),
            },
            body: JSON.stringify(metadata),
        });
        await this.ensureOk(res, "Init resumable failed");
        const location = res.headers.get("Location");
        if (!location) throw new Error("No Location header for resumable upload");
        return location;
    }

    async uploadSmallFile({ name, data, mimeType = "application/octet-stream", parentId = this.rootId }) {
        const metadata = {
            name,
            mimeType,
            ...(parentId ? { parents: [parentId] } : {}),
        };
        const createRes = await this.fetchWithAuth(`${DRIVE_BASE}/files?supportsAllDrives=true`, {
            method: "POST",
            headers: this.authHeaders({ "Content-Type": "application/json; charset=UTF-8" }),
            body: JSON.stringify(metadata),
        });
        await this.ensureOk(createRes, "Small upload metadata failed");
        const created = await createRes.json();
        await this.updateFileContent(created.id, data, mimeType);
        return created;
    }

    async downloadSmallFile(id, { responseType = "blob" } = {}) {
        const res = await this.fetchWithAuth(`${DRIVE_BASE}/files/${id}?alt=media`, {
            headers: this.authHeaders(),
        });
        await this.ensureOk(res, "Small download failed");
        if (responseType === "arrayBuffer") {
            return res.arrayBuffer();
        }
        if (responseType === "text") {
            return res.text();
        }
        return res.blob();
    }

    async updateFileContent(id, data, mimeType = "application/octet-stream") {
        const body = await this._asBlob(data, mimeType);
        const res = await this.fetchWithAuth(
            `${DRIVE_UPLOAD_BASE}/${id}?uploadType=media&supportsAllDrives=true`,
            {
                method: "PATCH",
                headers: this.authHeaders({ "Content-Type": mimeType }),
                body,
            }
        );
        await this.ensureOk(res, "update content failed");
        return res.json();
    }

    async _asBlob(data, mimeType) {
        if (data instanceof Blob) {
            return data;
        }
        if (typeof File !== "undefined" && data instanceof File) {
            return data;
        }
        if (data instanceof ArrayBuffer) {
            return new Blob([data], { type: mimeType });
        }
        if (ArrayBuffer.isView(data)) {
            const slice = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            return new Blob([slice], { type: mimeType });
        }
        if (typeof data === "string") {
            return new Blob([data], { type: mimeType });
        }
        throw new TypeError("Unsupported data type for Drive upload");
    }
}
