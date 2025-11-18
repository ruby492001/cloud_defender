// src/api/drive.js
// РРјРїРѕСЂС‚РѕРІ РЅРµ С‚СЂРµР±СѓРµС‚СЃСЏ вЂ” РёСЃРїРѕР»СЊР·СѓРµРј fetch РёР· Р±СЂР°СѓР·РµСЂР°.

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_INIT =
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";

export class DriveApi {
    constructor(token) {
        this.token = token;
    }

    authHeaders(extra) {
        return { Authorization: `Bearer ${this.token}`, Accept: "application/json", ...(extra || {}) };
    }

    async getFileMeta(id) {
        const url = new URL(`${DRIVE_BASE}/files/${id}`);
        url.searchParams.set("fields", "id,name,mimeType,size,parents");
        url.searchParams.set("supportsAllDrives", "true");
        const res = await fetch(url, { headers: this.authHeaders() });
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`meta ${res.status} ${t}`);
        }
        return res.json();
    }

    async listFolder(folderId = "root", pageToken, search) {
        const qParts = [`'${folderId}' in parents`, "trashed = false"];
        if (search && search.trim()) {
            qParts.push(`name contains '${search.replace(/'/g, "\\'")}'`);
        }

        const url = new URL(`${DRIVE_BASE}/files`);
        url.searchParams.set("q", qParts.join(" and "));
        url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime,parents),nextPageToken");
        url.searchParams.set("orderBy", "folder,name");
        url.searchParams.set("pageSize", "100");
        url.searchParams.set("supportsAllDrives", "true");
        url.searchParams.set("includeItemsFromAllDrives", "true");
        url.searchParams.set("spaces", "drive");
        url.searchParams.set("corpora", "user");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const res = await fetch(url, { headers: this.authHeaders() });
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`list ${res.status} ${t}`);
        }
        return res.json();
    }

    async createFolder(name, parentId = "root") {
        const res = await fetch(`${DRIVE_BASE}/files?supportsAllDrives=true`, {
            method: "POST",
            headers: this.authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
        });
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`create folder failed ${res.status} ${t}`);
        }
        return res.json();
    }

    async deleteFile(id) {
        const res = await fetch(`${DRIVE_BASE}/files/${id}?supportsAllDrives=true`, {
            method: "DELETE",
            headers: this.authHeaders(),
        });
        if (!res.ok) throw new Error(`delete failed ${res.status}`);
    }

    async renameFile(id, newName) {
        const res = await fetch(`${DRIVE_BASE}/files/${id}?supportsAllDrives=true`, {
            method: "PATCH",
            headers: this.authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ name: newName }),
        });
        if (!res.ok) throw new Error(`rename failed ${res.status}`);
        return res.json();
    }

    async moveFile(id, newParentId, oldParentId) {
        const url = new URL(`${DRIVE_BASE}/files/${id}`);
        url.searchParams.set("addParents", newParentId);
        if (oldParentId) url.searchParams.set("removeParents", oldParentId);
        url.searchParams.set("supportsAllDrives", "true");
        const res = await fetch(url, {
            method: "PATCH",
            headers: this.authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`move failed ${res.status}`);
        return res.json();
    }

    async copyFile(id, name, newParentId) {
        const res = await fetch(`${DRIVE_BASE}/files/${id}/copy?supportsAllDrives=true`, {
            method: "POST",
            headers: this.authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ name, parents: [newParentId] }),
        });
        if (!res.ok) throw new Error(`copy failed ${res.status}`);
        return res.json();
    }

    async findFileByName(name, parentId = "root") {
        if (!name) return null;
        const url = new URL(`${DRIVE_BASE}/files`);
        const escapedName = name.replace(/'/g, "\\'");
        url.searchParams.set(
            "q",
            `name='${escapedName}' and '${parentId}' in parents and trashed = false`
        );
        url.searchParams.set("fields", "files(id,name,mimeType,parents,size,modifiedTime)");
        url.searchParams.set("pageSize", "1");
        url.searchParams.set("supportsAllDrives", "true");
        url.searchParams.set("includeItemsFromAllDrives", "true");
        url.searchParams.set("spaces", "drive");
        url.searchParams.set("corpora", "user");
        const res = await fetch(url, { headers: this.authHeaders() });
        if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw new Error(`findFileByName failed ${res.status} ${t}`);
        }
        const data = await res.json();
        return (data.files && data.files[0]) || null;
    }

    async downloadInChunks({ id, name, size, onProgress, signal, onChunk, concurrency = 3 }) {
        const meta = await this.getFileMeta(id);
        const finalName = name ?? meta.name;
        const fileSize = Number(size ?? meta.size ?? 0) || 0;

        if (!fileSize) {
            const res = await fetch(`${DRIVE_BASE}/files/${id}?alt=media`, {
                headers: this.authHeaders(),
                signal,
            });
            if (!res.ok) throw new Error("Download fetch error");
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
            const task = (async () => {
                if (signal?.aborted) throw new DOMException("aborted", "AbortError");
                const res = await fetch(`${DRIVE_BASE}/files/${id}?alt=media`, {
                    headers: this.authHeaders({ Range: `bytes=${range.start}-${range.end - 1}` }),
                    signal,
                });
                if (!(res.ok || res.status === 206)) throw new Error(`Read error: ${res.status}`);
                const buf = new Uint8Array(await res.arrayBuffer());
                pending.set(range.start, buf);
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
        const res = await fetch(DRIVE_UPLOAD_INIT, {
            method: "POST",
            headers: {
                ...this.authHeaders({ "Content-Type": "application/json; charset=UTF-8" }),
                "X-Upload-Content-Type": metadata.mimeType,
                "X-Upload-Content-Length": String(size),
            },
            body: JSON.stringify(metadata),
        });
        if (!res.ok) throw new Error(`Init resumable failed: ${res.status} ${await res.text()}`);
        const location = res.headers.get("Location");
        if (!location) throw new Error("No Location header for resumable upload");
        return location;
    }

    async uploadSmallFile({ name, data, mimeType = "application/octet-stream", parentId = "root" }) {
        const metadata = {
            name,
            mimeType,
            ...(parentId ? { parents: [parentId] } : {}),
        };
        const createRes = await fetch(`${DRIVE_BASE}/files?supportsAllDrives=true`, {
            method: "POST",
            headers: this.authHeaders({ "Content-Type": "application/json; charset=UTF-8" }),
            body: JSON.stringify(metadata),
        });
        if (!createRes.ok) {
            const text = await createRes.text();
            throw new Error(`Small upload metadata failed ${createRes.status} ${text}`);
        }
        const created = await createRes.json();
        await this.updateFileContent(created.id, data, mimeType);
        return created;
    }

    async downloadSmallFile(id, { responseType = "blob" } = {}) {
        const res = await fetch(`${DRIVE_BASE}/files/${id}?alt=media`, {
            headers: this.authHeaders(),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Small download failed ${res.status} ${text}`);
        }
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
        const res = await fetch(
            `${DRIVE_UPLOAD_BASE}/${id}?uploadType=media&supportsAllDrives=true`,
            {
                method: "PATCH",
                headers: this.authHeaders({ "Content-Type": mimeType }),
                body,
            }
        );
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`update content failed ${res.status} ${text}`);
        }
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
