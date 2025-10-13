// src/api/drive.js
// Импортов не требуется — используем fetch из браузера.

const DRIVE_UPLOAD_INIT =
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink";
const DRIVE_FILES =
    "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,parents";

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3'


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


export class DriveApi {
    constructor(token){ this.token = token }
    authHeaders(extra){
        return { Authorization: `Bearer ${this.token}`, Accept:'application/json', ...(extra||{}) }
    }

    // --- МЕТА ФАЙЛА: точный размер и имя (исключает бесконечные догрузки) ---
    async getFileMeta(id){
        const url = new URL(`${DRIVE_BASE}/files/${id}`)
        url.searchParams.set('fields', 'id,name,mimeType,size,parents')
        url.searchParams.set('supportsAllDrives','true')
        const res = await fetch(url, { headers: this.authHeaders() })
        if(!res.ok){ const t = await res.text(); throw new Error(`meta ${res.status} ${t}`) }
        return res.json()
    }

    /** Листинг содержимого папки */
    async listFolder(folderId = 'root', pageToken, search){
        const qParts = [ `'${folderId}' in parents`, 'trashed = false' ]
        if(search && search.trim()) qParts.push(`name contains '${search.replace(/'/g, "\\'")}'`)

        const url = new URL(`${DRIVE_BASE}/files`)
        url.searchParams.set('q', qParts.join(' and '))
        url.searchParams.set('fields', 'files(id,name,mimeType,size,modifiedTime,parents),nextPageToken')
        url.searchParams.set('orderBy', 'folder,name')
        url.searchParams.set('pageSize', '100')
        url.searchParams.set('supportsAllDrives', 'true')
        url.searchParams.set('includeItemsFromAllDrives', 'true')
        url.searchParams.set('spaces', 'drive')
        url.searchParams.set('corpora', 'user')
        if (pageToken) url.searchParams.set('pageToken', pageToken)

        const res = await fetch(url, { headers: this.authHeaders() })
        if(!res.ok){ const t = await res.text(); throw new Error(`Ошибка списка: ${res.status} ${t}`) }
        return res.json()
    }

    /** Только папки — для выбора в диалоге */
    async listOnlyFolders(folderId='root', pageToken){
        const url = new URL(`${DRIVE_BASE}/files`)
        url.searchParams.set('q', `('${folderId}' in parents) and trashed = false and mimeType = 'application/vnd.google-apps.folder'`)
        url.searchParams.set('fields', 'files(id,name,mimeType,parents),nextPageToken')
        url.searchParams.set('orderBy', 'name')
        url.searchParams.set('pageSize', '100')
        url.searchParams.set('supportsAllDrives', 'true')
        url.searchParams.set('includeItemsFromAllDrives', 'true')
        if(pageToken) url.searchParams.set('pageToken', pageToken)
        const res = await fetch(url, { headers: this.authHeaders() })
        if(!res.ok) throw new Error('Ошибка загрузки папок')
        return res.json()
    }

    async createFolder(name, parentId = 'root'){
        const res = await fetch(`${DRIVE_BASE}/files?supportsAllDrives=true`, {
            method: 'POST',
            headers: { ...this.authHeaders({ 'Content-Type': 'application/json' }) },
            body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents:[parentId] })
        })
        if(!res.ok) throw new Error('Не удалось создать папку')
        return res.json()
    }

    async deleteFile(id){
        const res = await fetch(`${DRIVE_BASE}/files/${id}?supportsAllDrives=true`, { method:'DELETE', headers: this.authHeaders() })
        if(!res.ok) throw new Error('Не удалось удалить объект')
    }

    async renameFile(id, newName){
        const res = await fetch(`${DRIVE_BASE}/files/${id}?supportsAllDrives=true`, {
            method: 'PATCH',
            headers: { ...this.authHeaders({ 'Content-Type': 'application/json' }) },
            body: JSON.stringify({ name: newName })
        })
        if(!res.ok) throw new Error('Не удалось переименовать')
        return res.json()
    }

    async moveFile(id, newParentId, oldParentId){
        const url = new URL(`${DRIVE_BASE}/files/${id}`)
        url.searchParams.set('addParents', newParentId)
        if(oldParentId) url.searchParams.set('removeParents', oldParentId)
        url.searchParams.set('supportsAllDrives', 'true')
        const res = await fetch(url, { method:'PATCH', headers: this.authHeaders({ 'Content-Type':'application/json' }), body: JSON.stringify({}) })
        if(!res.ok) throw new Error('Не удалось переместить')
        return res.json()
    }

    async copyFile(id, name, newParentId){
        const res = await fetch(`${DRIVE_BASE}/files/${id}/copy?supportsAllDrives=true`, {
            method: 'POST',
            headers: this.authHeaders({ 'Content-Type':'application/json' }),
            body: JSON.stringify({ name, parents:[newParentId] })
        })
        if(!res.ok) throw new Error('Не удалось копировать файл')
        return res.json()
    }

    /**
     * Скачивание файла чанками. ВСЕГДА узнаём точный размер сначала.
     * Возвращает { blob, name, size }, не кликает по ссылке.
     */
    async downloadInChunks({ id, name, size, onProgress, signal }){
        // сначала достаём точную мету
        const meta = await this.getFileMeta(id)
        const finalName = name ?? meta.name
        const fileSize = Number(size ?? meta.size ?? 0) || 0

        // если размер неизвестен (например, Google Docs) — отдадим одним запросом
        if(!fileSize){
            const res = await fetch(`${DRIVE_BASE}/files/${id}?alt=media`, { headers: this.authHeaders(), signal })
            if(!res.ok) throw new Error('Ошибка скачивания')
            const blob = await res.blob()
            return { blob, name: finalName, size: blob.size }
        }

        const chunkSize = 10 * 1024 * 1024 // 10MB
        const chunks = []
        let start = 0

        while(start < fileSize){
            if(signal?.aborted) throw new DOMException('aborted','AbortError')
            const end = Math.min(start + chunkSize - 1, fileSize - 1)
            const res = await fetch(`${DRIVE_BASE}/files/${id}?alt=media`, {
                headers: this.authHeaders({ Range: `bytes=${start}-${end}` }),
                signal
            })
            if(!(res.ok || res.status === 206)) throw new Error(`Ошибка при скачивании: ${res.status}`)
            const buf = new Uint8Array(await res.arrayBuffer())
            chunks.push(buf)
            start = end + 1
            onProgress?.(Math.min(start, fileSize), fileSize)
        }

        const totalLen = chunks.reduce((a,c)=> a + c.byteLength, 0)
        const out = new Uint8Array(totalLen)
        let offset = 0; for(const c of chunks){ out.set(c, offset); offset += c.byteLength }
        const blob = new Blob([out], { type:'application/octet-stream' })
        return { blob, name: finalName, size: fileSize }
    }
}