// src/api/drive.js
// Импортов не требуется — используем fetch из браузера.

const DRIVE_UPLOAD_INIT =
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink";
const DRIVE_FILES =
    "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,parents";

export async function createDriveFolder({ accessToken, name, parentId }) {
    const metadata = {
        name,
        mimeType: "application/vnd.google-apps.folder",
        ...(parentId ? { parents: [parentId] } : {}),
    };
    const res = await fetch(DRIVE_FILES, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(metadata),
    });
    if (!res.ok) throw new Error(`Create folder failed: ${res.status} ${await res.text()}`);
    return res.json();
}

export async function initResumableUpload({ accessToken, name, mimeType, size, parentId }) {
    const metadata = {
        name,
        mimeType: mimeType || "application/octet-stream",
        ...(parentId ? { parents: [parentId] } : {}),
    };
    const res = await fetch(DRIVE_UPLOAD_INIT, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
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

export async function uploadResumable({ uploadUrl, file, chunkSize = 8 * 1024 * 1024, signal, onProgress }) {
    const total = file.size;
    let uploaded = 0;
    while (uploaded < total) {
        const end = Math.min(uploaded + chunkSize, total);
        const res = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
                "Content-Type": file.type || "application/octet-stream",
                "Content-Length": String(end - uploaded),
                "Content-Range": `bytes ${uploaded}-${end - 1}/${total}`,
            },
            body: await file.slice(uploaded, end).arrayBuffer(),
            signal,
        });
        if (res.status === 308) {
            const range = res.headers.get("Range");
            uploaded = range ? parseInt(range.split("-")[1], 10) + 1 : end;
            onProgress && onProgress(uploaded, total);
        } else if (res.ok) {
            onProgress && onProgress(total, total);
            return await res.json();
        } else {
            throw new Error(`Chunk failed: ${res.status} ${await res.text()}`);
        }
    }
}
