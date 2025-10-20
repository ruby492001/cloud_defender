import { initResumableUpload } from "./drive";

const DEFAULT_BLOCK_SIZE = 4 * 1024 * 1024; // 4MB
const DEFAULT_HASH_BYTES = 64; // SHA-512 digest length placeholder

export default class GoogleCryptoApi {
    constructor(driveApi, options = {}) {
        this.drive = driveApi;
        this._configPromise = null;
        this.blockSize = options.blockSize ?? DEFAULT_BLOCK_SIZE;
        this.hashByteLength = options.hashByteLength ?? DEFAULT_HASH_BYTES;
    }

    async ensureConfigLoaded() {
        if (!this._configPromise) {
            this._configPromise = this.loadCryptoConfig().catch((err) => {
                console.warn("GoogleCryptoApi: failed to load crypto config", err);
                return {};
            });
        }
        return this._configPromise;
    }

    async loadCryptoConfig() {
        // TODO: download and parse encryption parameters/config from Drive.
        return {};
    }

    encryptFileName(name) {
        // TODO: apply deterministic filename encryption here.
        return name + 'test';
    }

    decryptFileName(name) {
        // TODO: decode encrypted filename back to its original value.
        return name.replace('test', '');
    }

    createEncryptionContext(file) {
        // TODO: instantiate block-encryption state for the given file.
        void file;
        console.log(file);
        return {};
    }

    createDecryptionContext(meta) {
        // TODO: instantiate block-decryption state for the given download (meta contains id/name/size).
        void meta;
        return {};
    }

    createUploadSession(file) {
        return {
            hash: this.createUploadHashContext(),
            encryption: this.createEncryptionContext(file),
            metadata: {},
        };
    }

    createDownloadSession(meta) {
        return {
            hash: this.createDownloadHashContext(),
            decryption: this.createDecryptionContext(meta),
            metadata: {},
        };
    }

    createUploadHashContext() {
        // TODO: return streaming hash context (e.g., incremental SHA-512 state).
        return { totalBytes: 0 };
    }

    updateUploadHash(ctx, chunk /* Uint8Array */, offset, session) {
        // TODO: feed chunk into streaming hash here. session contains per-file state.
        ctx.totalBytes += chunk.byteLength;
        void offset;
        void session;
    }

    async finalizeUploadHash(ctx, session) {
        // TODO: replace placeholder with real digest extraction from hash context.
        void session;
        const digest = new Uint8Array(this.hashByteLength);
        const view = new DataView(digest.buffer);
        view.setBigUint64(0, BigInt(ctx.totalBytes)); // simple marker for now
        return digest;
    }

    async encryptBlock(chunk /* Uint8Array */, { offset, session }) {
        // TODO: replace with real block encryption (chunk -> encryptedChunk) using session.encryption.
        void offset;
        void session;
        return chunk;
    }

    async encryptDigest(digest /* Uint8Array */, { file, session }) {
        // TODO: optionally encrypt digest bytes before appending to payload.
        void file;
        void session;
        return digest;
    }

    async appendCustomMetadataTail(fileId, digest, session) {
        // TODO: persist digest/custom metadata to Drive (e.g., using files.update).
        void fileId;
        void digest;
        void session;
    }

    createDownloadHashContext() {
        // TODO: match upload hash context for verification.
        return { totalBytes: 0 };
    }

    updateDownloadHash(ctx, chunk /* Uint8Array */, offset, session) {
        // TODO: feed decrypted block into streaming hash verification.
        ctx.totalBytes += chunk.byteLength;
        void offset;
        void session;
    }

    async finalizeDownloadHash(ctx, session) {
        // TODO: produce digest from download hash context.
        void session;
        const digest = new Uint8Array(this.hashByteLength);
        const view = new DataView(digest.buffer);
        view.setBigUint64(0, BigInt(ctx.totalBytes));
        return digest;
    }

    async decryptBlock(chunk /* Uint8Array */, { offset, session }) {
        // TODO: replace with block-level decryption (session.decryption).
        void offset;
        void session;
        return chunk;
    }

    async decryptDigest(digest /* Uint8Array */, session) {
        // TODO: decrypt digest bytes if they were encrypted during upload.
        void session;
        return digest;
    }

    async listFolder(folderId, pageToken, search) {
        await this.ensureConfigLoaded();
        const result = await this.drive.listFolder(folderId, pageToken, search);
        const files = (result.files || []).map((it) => this.decorateIncomingItem(it));
        return { ...result, files };
    }

    async createFolder(name, parentId) {
        await this.ensureConfigLoaded();
        const targetParent = parentId ?? "root";
        const folder = await this.drive.createFolder(this.encryptFileName(name), targetParent);
        return this.decorateIncomingItem(folder);
    }

    async deleteFile(id) {
        await this.ensureConfigLoaded();
        return this.drive.deleteFile(id);
    }

    async renameFile(id, newName) {
        await this.ensureConfigLoaded();
        const encryptedName = this.encryptFileName(newName);
        const res = await this.drive.renameFile(id, encryptedName);
        return this.decorateIncomingItem({ ...res, name: encryptedName });
    }

    async moveFile(id, newParentId, oldParentId) {
        await this.ensureConfigLoaded();
        const res = await this.drive.moveFile(id, newParentId, oldParentId);
        return this.decorateIncomingItem(res);
    }

    async copyFile(id, name, newParentId) {
        await this.ensureConfigLoaded();
        const encryptedName = this.encryptFileName(name);
        const res = await this.drive.copyFile(id, encryptedName, newParentId);
        return this.decorateIncomingItem(res);
    }

    decorateIncomingItem(item) {
        if (!item) return item;
        const cryptoContext =
            item.cryptoContext ||
            {
                uploadSession: null,
                downloadSession: null,
                // Place to cache per-file encryption metadata (keys IVs etc.)
                metadata: {},
            };
        return {
            ...item,
            name: this.decryptFileName(item.name),
            cryptoContext,
        };
    }

    compareDigests(expected, actual) {
        if (!expected || !actual || expected.byteLength !== actual.byteLength) return false;
        for (let i = 0; i < expected.byteLength; i++) {
            if (expected[i] !== actual[i]) return false;
        }
        return true;
    }

    createDownloadCacheWriter() {
        // TODO: swap with disk-based cache (IndexedDB/File System Access) for large files.
        const chunks = [];
        return {
            async write(chunk) {
                chunks.push(chunk.slice());
            },
            async finalize(type = "application/octet-stream") {
                return new Blob(chunks, { type });
            },
        };
    }

    async prepareUpload({ file, parentId, mimeType, size, session }) {
        await this.ensureConfigLoaded();
        const preparedName = this.encryptFileName(file.name);
        const uploadSession = session ?? this.createUploadSession(file);
        const finalSize = (size ?? file.size) + this.hashByteLength;
        const uploadUrl = await initResumableUpload({
            accessToken: this.drive.token,
            name: preparedName,
            mimeType: mimeType || file.type || "application/octet-stream",
            size: finalSize,
            parentId,
        });
        return { uploadUrl, originalFile: file, totalSize: finalSize, session: uploadSession };
    }

    async uploadFileChunks({
        uploadUrl,
        file,
        chunkSize = 16 * 1024 * 1024,
        signal,
        onProgress,
        session,
        parallel = 3,
    }) {
        await this.ensureConfigLoaded();
        const uploadSession = session ?? this.createUploadSession(file);
        uploadSession.hash = uploadSession.hash ?? this.createUploadHashContext();
        const hashCtx = uploadSession.hash;

        const totalBytes = file.size + this.hashByteLength;
        const bufferQueue = [];
        let bufferedBytes = 0;
        let nextPlannedStart = 0;
        let serverConfirmed = 0;
        let lastResponse = null;
        const normalizedParallel = Math.max(1, Number(parallel) || 1);
        const normalizedChunkSize = chunkSize && chunkSize > 0 ? chunkSize : this.blockSize;
        const chunkStride = Math.max(this.blockSize, normalizedChunkSize);
        const inflight = new Set();
        let errored = null;

        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const reportProgress = () => {
            onProgress?.(Math.min(serverConfirmed, totalBytes), totalBytes);
        };

        const syncOffset = async () => {
            if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError");
            const res = await fetch(uploadUrl, {
                method: "PUT",
                headers: {
                    "Content-Length": "0",
                    "Content-Range": `bytes */${totalBytes}`,
                },
                signal,
            });
            if (res.status === 308) {
                const range = res.headers.get("Range");
                const confirmed = range ? parseInt(range.split("-")[1], 10) + 1 : 0;
                if (!Number.isNaN(confirmed)) {
                    serverConfirmed = Math.max(serverConfirmed, confirmed);
                }
                reportProgress();
                return serverConfirmed;
            }
            if (res.ok) {
                lastResponse = await res.json();
                serverConfirmed = totalBytes;
                reportProgress();
                return serverConfirmed;
            }
            const text = await res.text().catch(() => "");
            throw new Error(`Failed to sync upload offset: ${res.status} ${text}`);
        };

        const waitForTurn = async (startByte) => {
            while (!errored && serverConfirmed < startByte) {
                if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError");
                if (inflight.size === 0) {
                    await sleep(25);
                } else {
                    try {
                        await Promise.race(inflight);
                    } catch {
                        // swallow; errored state will be handled separately
                    }
                }
            }
        };

        const scheduleChunk = async (chunk, length, forceAwait = false) => {
            if (!chunk || length === 0) return;
            const startByte = nextPlannedStart;
            nextPlannedStart += length;

            await waitForTurn(startByte);

            while (!errored && inflight.size >= normalizedParallel) {
                try {
                    await Promise.race(inflight);
                } catch {
                    break;
                }
            }
            if (errored) throw errored;

            const uploadOnce = async () => {
                let attempt = 0;
                for (;;) {
                    if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError");
                    const endByte = startByte + length - 1;
                    const res = await fetch(uploadUrl, {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/octet-stream",
                            "Content-Length": String(length),
                            "Content-Range": `bytes ${startByte}-${endByte}/${totalBytes}`,
                        },
                        body: chunk,
                        signal,
                    });

                    if (res.status === 308) {
                        const range = res.headers.get("Range");
                        const confirmed = range ? parseInt(range.split("-")[1], 10) + 1 : endByte + 1;
                        if (!Number.isNaN(confirmed)) {
                            serverConfirmed = Math.max(serverConfirmed, confirmed);
                        }
                        reportProgress();
                        return;
                    }

                    if (res.ok) {
                        lastResponse = await res.json();
                        serverConfirmed = totalBytes;
                        reportProgress();
                        return;
                    }

                    if ((res.status === 400 || res.status === 416) && attempt < 5) {
                        await syncOffset();
                        await waitForTurn(startByte);
                        attempt += 1;
                        continue;
                    }

                    if ((res.status >= 500 || res.status === 429) && attempt < 5) {
                        attempt += 1;
                        await sleep(Math.min(2000, 200 * attempt));
                        continue;
                    }

                    const errorText = await res.text().catch(() => "");
                    throw new Error(`Upload chunk failed: ${res.status} ${errorText}`);
                }
            };

            const runner = (async () => {
                try {
                    await uploadOnce();
                } catch (err) {
                    errored = err;
                    throw err;
                }
            })();

            inflight.add(runner);
            runner.finally(() => inflight.delete(runner));

            if (forceAwait || normalizedParallel === 1) {
                await runner;
            }
        };

        const flush = async (forceAll = false, forceAwait = false) => {
            while (bufferedBytes > 0 && (forceAll || bufferedBytes >= chunkStride)) {
                const targetSize = forceAll ? bufferedBytes : chunkStride;
                const { chunk, length } = consumeBuffer(bufferQueue, targetSize);
                if (!chunk || length === 0) break;
                bufferedBytes -= length;
                await scheduleChunk(chunk, length, forceAwait);
            }
        };

        for (let offset = 0; offset < file.size; offset += this.blockSize) {
            if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError");
            const slice = file.slice(offset, Math.min(offset + this.blockSize, file.size));
            const plainChunk = new Uint8Array(await slice.arrayBuffer());
            this.updateUploadHash(hashCtx, plainChunk, offset, uploadSession);
            const encryptedBlock = await this.encryptBlock(plainChunk, { offset, session: uploadSession });
            bufferQueue.push(encryptedBlock);
            bufferedBytes += encryptedBlock.byteLength;
            await flush(false);
        }

        const digest = await this.finalizeUploadHash(hashCtx, uploadSession);
        uploadSession.digest = digest;
        const encryptedDigest = await this.encryptDigest(digest, { file, session: uploadSession });
        bufferQueue.push(encryptedDigest);
        bufferedBytes += encryptedDigest.byteLength;
        await flush(true, true);

        if (errored) throw errored;

        if (inflight.size > 0) {
            await Promise.all(Array.from(inflight));
        }

        if (serverConfirmed < totalBytes) {
            await waitForTurn(totalBytes);
            if (serverConfirmed < totalBytes) {
                await syncOffset();
            }
        }

        await this.appendCustomMetadataTail(lastResponse?.id, digest, uploadSession);
        return { response: lastResponse, session: uploadSession };
    }

    async uploadFile({ file, parentId }) {
        const preparation = await this.prepareUpload({ file, parentId, mimeType: file.type, size: file.size });
        const { response } = await this.uploadFileChunks({
            uploadUrl: preparation.uploadUrl,
            file,
            session: preparation.session,
        });
        return response;
    }

    async downloadInChunks(options = {}) {
        await this.ensureConfigLoaded();
        const normalizedOptions = options || {};
        const { session: providedSession, ...restOptions } = normalizedOptions;

        const metaForSession = {
            id: restOptions.id,
            name: restOptions.name,
            size: restOptions.size,
        };
        const session = providedSession ?? this.createDownloadSession(metaForSession);
        session.hash = session.hash ?? this.createDownloadHashContext();
        const hashCtx = session.hash;

        const cache = this.createDownloadCacheWriter();
        const digestBuffer = new Uint8Array(this.hashByteLength);
        let digestOffset = 0;
        let totalBytes = 0;

        const result = await this.drive.downloadInChunks({
            ...restOptions,
            onChunk: async (encryptedChunk, meta) => {
                const { offset, total } = meta;
                totalBytes = total;
                const contentSize = Math.max(0, total - this.hashByteLength);
                let absoluteOffset = offset;
                let cursor = 0;

                while (cursor < encryptedChunk.byteLength) {
                    if (absoluteOffset >= contentSize) {
                        const digestSlice = encryptedChunk.subarray(cursor);
                        const remainingDigest = Math.max(0, this.hashByteLength - digestOffset);
                        const copySlice =
                            remainingDigest < digestSlice.length ? digestSlice.subarray(0, remainingDigest) : digestSlice;
                        if (copySlice.length > 0) {
                            digestBuffer.set(copySlice, digestOffset);
                            digestOffset += copySlice.length;
                        }
                        break;
                    }

                    const remainingContent = contentSize - absoluteOffset;
                    const blockLength = Math.min(this.blockSize, remainingContent, encryptedChunk.byteLength - cursor);
                    const blockSlice = encryptedChunk.subarray(cursor, cursor + blockLength);
                    const decryptedBlock = await this.decryptBlock(blockSlice, { offset: absoluteOffset, session });
                    this.updateDownloadHash(hashCtx, decryptedBlock, absoluteOffset, session);
                    await cache.write(decryptedBlock);
                    cursor += blockLength;
                    absoluteOffset += blockLength;
                }
            },
        });

        const decryptedDigest = await this.decryptDigest(digestBuffer, session);
        const calculatedDigest = await this.finalizeDownloadHash(hashCtx, session);
        session.digest = calculatedDigest;

        if (!this.compareDigests(decryptedDigest, calculatedDigest)) {
            throw new Error("Checksum mismatch while downloading file");
        }

        const blob = await cache.finalize(restOptions.type || "application/octet-stream");
        const finalName = this.decryptFileName(result?.name ?? restOptions.name ?? "");
        return {
            blob,
            name: finalName,
            size: blob.size,
            session,
        };
    }

    async finalizeUpload(/* context */) {
        // Optional hook for post-upload steps (e.g., store additional metadata).
    }
}

function consumeBuffer(queue, targetSize) {
    let remaining = targetSize;
    const parts = [];
    while (queue.length && remaining > 0) {
        const head = queue[0];
        if (head.byteLength <= remaining) {
            parts.push(head);
            queue.shift();
            remaining -= head.byteLength;
        } else {
            const slice = head.subarray(0, remaining);
            const rest = head.subarray(remaining);
            parts.push(slice);
            queue[0] = rest;
            remaining = 0;
        }
    }

    const length = parts.reduce((acc, arr) => acc + arr.byteLength, 0);
    if (!length) {
        return { chunk: null, length: 0 };
    }
    const merged = mergeBuffers(parts, length);
    return { chunk: merged, length };
}

function mergeBuffers(parts, totalLength) {
    const out = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.byteLength;
    }
    return out;
}


