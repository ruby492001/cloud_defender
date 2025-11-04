import * as ownMode from "../crypto/modes/ownMode.js";
import * as rcloneMode from "../crypto/modes/rcloneMode.js";
import * as commonModes from "../crypto/modes/commonModes.js";
const DEFAULT_BLOCK_SIZE = 4 * 1024 * 1024; // 4MB
const DEFAULT_HASH_BYTES = 64; // SHA-512 digest length placeholder
const IV_BYTE_LENGTH = 16;
const CRYPTO_MODE_RCLONE = "rclone";
const CRYPTO_MODE_OWN = "own";
const INTEGRITY_ERROR_CODE = "INTEGRITY_ERROR";
const INTEGRITY_ERROR_MESSAGE = "Data integrity corrupted";
export const EXCLUDED_FILE_NAMES = [];
export default class GoogleCryptoApi {
    constructor(driveApi, options = {}) {
        this.drive = driveApi;
        this._configPromise = null;
        this.blockSize = options.blockSize ?? DEFAULT_BLOCK_SIZE;
        this.hashByteLength = options.hashByteLength ?? DEFAULT_HASH_BYTES;
        this.ivByteLength = IV_BYTE_LENGTH;
        this.cryptoMode = CRYPTO_MODE_OWN;
        this.currentConfig = {};
        this._cachedKeyBytes = null;
    }
    async ensureConfigLoaded() {
        if (!this._configPromise) {
            this._configPromise = this.loadCryptoConfig()
                .then((config) => {
                    const normalized = config || {};
                    this.currentConfig = normalized;
                    this.cryptoMode = this.normalizeCryptoMode(normalized.mode || normalized.algorithm);
                    this._cachedKeyBytes = null;
                    return normalized;
                })
                .catch((err) => {
                    console.warn("GoogleCryptoApi: failed to load crypto config", err);
                    this.currentConfig = {};
                    this.cryptoMode = CRYPTO_MODE_OWN;
                    this._cachedKeyBytes = null;
                    return {};
                });
        }
        return this._configPromise;
    }
    async loadCryptoConfig() {
        // TODO: download and parse encryption parameters/config from Drive.
        return { key: "", mode: CRYPTO_MODE_OWN, hashAlgorithm: "SHA-512" };
    }
    normalizeCryptoMode(mode) {
        if (typeof mode !== "string") return CRYPTO_MODE_OWN;
        const value = mode.trim().toLowerCase();
        return value === CRYPTO_MODE_RCLONE ? CRYPTO_MODE_RCLONE : CRYPTO_MODE_OWN;
    }
    getCryptoMode() {
        return this.cryptoMode || CRYPTO_MODE_OWN;
    }
    isRcloneMode() {
        return this.getCryptoMode() === CRYPTO_MODE_RCLONE;
    }
    shouldUseStreamingCrypto(session) {
        return !!session && !session.skipCrypto;
    }
    getHashAlgorithm() {
        const alg = this.currentConfig?.hashAlgorithm;
        if (!alg) return "SHA-512";
        const normalized = String(alg).trim();
        return normalized ? normalized : "SHA-512";
    }
    getKeyBytes() {
        if (this._cachedKeyBytes) return this._cachedKeyBytes;
        const keySource = this.currentConfig?.key ?? "";
        if (!keySource) {
            this._cachedKeyBytes = new Uint8Array(32);
            return this._cachedKeyBytes;
        }
        try {
            const trimmed = keySource.trim();
            // Support base64-encoded keys; fallback to UTF-8 bytes.
            let raw;
            if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0) {
                if (typeof atob === "function") {
                    raw = Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0));
                } else if (typeof Buffer !== "undefined") {
                    raw = Uint8Array.from(Buffer.from(trimmed, "base64"));
                } else {
                    throw new Error("No base64 decoder available");
                }
            } else {
                raw = new TextEncoder().encode(trimmed);
            }
            this._cachedKeyBytes = raw;
            return raw;
        } catch (err) {
            console.warn("GoogleCryptoApi: failed to decode key, falling back to zero key", err);
            this._cachedKeyBytes = new Uint8Array(32);
            return this._cachedKeyBytes;
        }
    }
    createIntegrityError(details = {}) {
        const err = new Error(INTEGRITY_ERROR_MESSAGE);
        err.code = INTEGRITY_ERROR_CODE;
        Object.assign(err, details);
        return err;
    }
    isExcludedName(name = "") {
        if (!name) return false;
        return EXCLUDED_FILE_NAMES.includes(name);
    }
    encryptFileName(name) {
        return commonModes.encryptFileName(name, {
            isExcludedName: (value) => this.isExcludedName(value),
        });
    }
    decryptFileName(name) {
        return commonModes.decryptFileName(name, {
            isExcludedName: (value) => this.isExcludedName(value),
        });
    }
    createEncryptionContext({ file, mode, skipCrypto }) {
        void file;
        const keyBytes = this.getKeyBytes();
        if (skipCrypto) {
            return { mode, key: keyBytes, iv: null, ivWritten: true };
        }
        if (mode === CRYPTO_MODE_OWN) {
            const context = ownMode.createEncryptionContext({ keyBytes, ivByteLength: this.ivByteLength });
            return { mode, ...context };
        }
        const context = rcloneMode.createEncryptionContext({ keyBytes, ivByteLength: this.ivByteLength });
        return { mode, ...context };
    }
    createDecryptionContext({ meta, mode, skipCrypto }) {
        void meta;
        const keyBytes = this.getKeyBytes();
        if (skipCrypto) {
            return { mode, key: keyBytes, iv: null, ivBytesRead: 0 };
        }
        if (mode === CRYPTO_MODE_OWN) {
            const context = ownMode.createDecryptionContext({ keyBytes, ivByteLength: this.ivByteLength });
            return { mode, ...context };
        }
        const context = rcloneMode.createDecryptionContext({ keyBytes, ivByteLength: this.ivByteLength });
        return { mode, ...context };
    }
    createUploadSession(file) {
        const skipCrypto = file?.name ? this.isExcludedName(file.name) : false;
        const mode = this.getCryptoMode();
        const hashAlgorithm = mode === CRYPTO_MODE_OWN ? this.getHashAlgorithm() : null;
        return {
            hash: hashAlgorithm ? ownMode.createHashContext({ algorithm: hashAlgorithm }) : null,
            encryption: this.createEncryptionContext({ file, mode, skipCrypto }),
            metadata: {},
            skipCrypto,
            mode,
            hashAlgorithm,
        };
    }
    createDownloadSession(meta) {
        const skipCrypto = meta?.name ? this.isExcludedName(meta.name) : false;
        const mode = this.getCryptoMode();
        const hashAlgorithm = mode === CRYPTO_MODE_OWN ? this.getHashAlgorithm() : null;
        return {
            hash: hashAlgorithm ? ownMode.createHashContext({ algorithm: hashAlgorithm }) : null,
            decryption: this.createDecryptionContext({ meta, mode, skipCrypto }),
            metadata: {},
            skipCrypto,
            mode,
            hashAlgorithm,
        };
    }
    async appendCustomMetadataTail(fileId, digest, session) {
        // TODO: persist digest/custom metadata to Drive (e.g., using files.update).
        void fileId;
        void digest;
        void session;
    }
    async listFolder(folderId, pageToken, search) {
        await this.ensureConfigLoaded();
        const result = await this.drive.listFolder(folderId, pageToken, search);
        const files = (result.files || [])
            .map((it) => this.decorateIncomingItem(it))
            .filter(Boolean);
        return { ...result, files };
    }
    async createFolder(name, parentId) {
        await this.ensureConfigLoaded();
        const preparedName = this.encryptFileName(name);
        const folder = await this.drive.createFolder(preparedName, parentId ?? "root");
        return this.decorateIncomingItem(folder);
    }
    async deleteFile(id) {
        await this.ensureConfigLoaded();
        return this.drive.deleteFile(id);
    }
    async renameFile(id, newName, options = {}) {
        await this.ensureConfigLoaded();
        const { encrypted = false } = options || {};
        const finalName = encrypted ? newName : this.encryptFileName(newName);
        const res = await this.drive.renameFile(id, finalName);
        return this.decorateIncomingItem({ ...res, name: finalName });
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
        const plainName = this.decryptFileName(item.name);
        if (this.isExcludedName(plainName)) {
            return null;
        }
        return {
            ...item,
            name: plainName,
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
        const uploadSession = session ?? this.createUploadSession(file);
        if (uploadSession.mode === CRYPTO_MODE_OWN) {
            uploadSession.hashAlgorithm = uploadSession.hashAlgorithm || this.getHashAlgorithm();
            if (!uploadSession.hash && uploadSession.hashAlgorithm) {
                uploadSession.hash = ownMode.createHashContext({ algorithm: uploadSession.hashAlgorithm });
            }
        }
        const shouldSkipCrypto = uploadSession.skipCrypto;
        const usesStreaming = this.shouldUseStreamingCrypto(uploadSession);
        const requiresDigest = !shouldSkipCrypto && uploadSession.mode === CRYPTO_MODE_OWN;
        let finalSize = size ?? file.size;
        if (usesStreaming) {
            finalSize += this.ivByteLength;
        }
        if (requiresDigest) {
            finalSize += this.hashByteLength;
        }
        const preparedFile = file;
        const preparedName = shouldSkipCrypto ? file.name : this.encryptFileName(file.name);
        const uploadUrl = await this.drive.initResumableUpload({
            name: preparedName,
            mimeType: mimeType || file.type || "application/octet-stream",
            size: finalSize,
            parentId,
        });
        return { uploadUrl, originalFile: preparedFile, totalSize: finalSize, session: uploadSession };
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
        const usesStreaming = this.shouldUseStreamingCrypto(uploadSession);
        const requiresDigest = usesStreaming && uploadSession.mode === CRYPTO_MODE_OWN;
        const hashAlgorithm = requiresDigest
            ? uploadSession.hashAlgorithm || this.getHashAlgorithm()
            : null;
        if (requiresDigest && !uploadSession.hashAlgorithm) {
            uploadSession.hashAlgorithm = hashAlgorithm;
        }
        const hashCtx = requiresDigest
            ? uploadSession.hash ?? ownMode.createHashContext({ algorithm: hashAlgorithm })
            : null;
        if (requiresDigest && !uploadSession.hash && hashCtx) {
            uploadSession.hash = hashCtx;
        }
        const cryptoModule = uploadSession.mode === CRYPTO_MODE_OWN ? ownMode : rcloneMode;
        const ivForUpload = usesStreaming
            ? cryptoModule.ensureEncryptionIv(uploadSession.encryption, this.ivByteLength)
            : null;
        let ivQueued = !usesStreaming || !ivForUpload;
        const totalBytes =
            file.size + (usesStreaming ? this.ivByteLength : 0) + (requiresDigest ? this.hashByteLength : 0);
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
            if (requiresDigest && hashCtx) {
                ownMode.updateHash(hashCtx, plainChunk);
            }
            const encryptedBlock = usesStreaming
                ? cryptoModule.encryptBlock(plainChunk, {
                    context: uploadSession.encryption,
                    offset,
                    ivByteLength: this.ivByteLength,
                })
                : plainChunk;
            if (usesStreaming && !ivQueued && ivForUpload) {
                bufferQueue.push(ivForUpload.slice());
                bufferedBytes += ivForUpload.byteLength;
                ivQueued = true;
                if (uploadSession.encryption) {
                    uploadSession.encryption.ivWritten = true;
                }
            }
            bufferQueue.push(encryptedBlock);
            bufferedBytes += encryptedBlock.byteLength;
            await flush(false);
        }
        if (usesStreaming && !ivQueued && ivForUpload) {
            bufferQueue.push(ivForUpload.slice());
            bufferedBytes += ivForUpload.byteLength;
            ivQueued = true;
            if (uploadSession.encryption) {
                uploadSession.encryption.ivWritten = true;
            }
        }
        let digest = null;
        if (requiresDigest) {
            digest = await ownMode.finalizeHash(hashCtx);
            uploadSession.digest = digest;
            const encryptedDigest = ownMode.encryptDigest(digest);
            bufferQueue.push(encryptedDigest);
            bufferedBytes += encryptedDigest.byteLength;
        } else {
            uploadSession.digest = null;
        }
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
        if (requiresDigest) {
            await this.appendCustomMetadataTail(lastResponse?.id, digest, uploadSession);
        }
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
        if (restOptions.name && this.isExcludedName(restOptions.name)) {
            session.skipCrypto = true;
        }
        if (session.mode === CRYPTO_MODE_OWN) {
            session.hashAlgorithm = session.hashAlgorithm || this.getHashAlgorithm();
            if (!session.hash && session.hashAlgorithm) {
                session.hash = ownMode.createHashContext({ algorithm: session.hashAlgorithm });
            }
        }
        const usesStreaming = this.shouldUseStreamingCrypto(session);
        const requiresDigest = usesStreaming && session.mode === CRYPTO_MODE_OWN;
        const hashAlgorithm = requiresDigest
            ? session.hashAlgorithm || this.getHashAlgorithm()
            : null;
        if (requiresDigest && !session.hashAlgorithm) {
            session.hashAlgorithm = hashAlgorithm;
        }
        const hashCtx = requiresDigest
            ? session.hash ?? ownMode.createHashContext({ algorithm: hashAlgorithm })
            : null;
        if (requiresDigest && !session.hash && hashCtx) {
            session.hash = hashCtx;
        }
        const digestSize = requiresDigest ? this.hashByteLength : 0;
        const ivSize = usesStreaming ? this.ivByteLength : 0;
        const cryptoModule = session.mode === CRYPTO_MODE_OWN ? ownMode : rcloneMode;
        const cache = this.createDownloadCacheWriter();
        const digestBuffer = requiresDigest ? new Uint8Array(digestSize) : null;
        let digestOffset = 0;
        let totalBytes = 0;
        let ivBytesRead = 0;
        const result = await this.drive.downloadInChunks({
            ...restOptions,
            onChunk: async (encryptedChunk, meta) => {
                const { offset, total } = meta;
                totalBytes = total;
                const contentSize = Math.max(0, total - digestSize);
                let absoluteOffset = offset;
                let cursor = 0;
                while (cursor < encryptedChunk.byteLength) {
                    if (usesStreaming && ivBytesRead < ivSize) {
                        const remainingIv = ivSize - ivBytesRead;
                        const take = Math.min(remainingIv, encryptedChunk.byteLength - cursor);
                        if (take > 0) {
                            const ivSlice = encryptedChunk.subarray(cursor, cursor + take);
                            if (session.decryption?.iv) {
                                session.decryption.iv.set(ivSlice, ivBytesRead);
                            }
                            cursor += take;
                            absoluteOffset += take;
                            ivBytesRead += take;
                            if (cursor >= encryptedChunk.byteLength) {
                                break;
                            }
                            continue;
                        }
                    }
                    if (requiresDigest && absoluteOffset >= contentSize) {
                        const digestSlice = encryptedChunk.subarray(cursor);
                        const remainingDigest = Math.max(0, digestSize - digestOffset);
                        const copySlice =
                            remainingDigest < digestSlice.length ? digestSlice.subarray(0, remainingDigest) : digestSlice;
                        if (copySlice.length > 0 && digestBuffer) {
                            digestBuffer.set(copySlice, digestOffset);
                            digestOffset += copySlice.length;
                        }
                        break;
                    }
                    const remainingContent = contentSize - absoluteOffset;
                    const blockLength = Math.min(this.blockSize, remainingContent, encryptedChunk.byteLength - cursor);
                    const blockSlice = encryptedChunk.subarray(cursor, cursor + blockLength);
                    const contentOffset = Math.max(0, absoluteOffset - ivSize);
                    const decryptedBlock = usesStreaming
                        ? cryptoModule.decryptBlock(blockSlice, {
                            context: session.decryption,
                            offset: contentOffset,
                        })
                        : blockSlice;
                    if (requiresDigest && hashCtx) {
                        ownMode.updateHash(hashCtx, decryptedBlock);
                    }
                    await cache.write(decryptedBlock);
                    cursor += blockLength;
                    absoluteOffset += blockLength;
                }
            },
        });
        if (session.decryption) {
            session.decryption.ivBytesRead = ivBytesRead;
        }
        let calculatedDigest = null;
        if (requiresDigest && digestBuffer && hashCtx) {
            const decryptedDigest = ownMode.decryptDigest(digestBuffer);
            calculatedDigest = await ownMode.finalizeHash(hashCtx);
            session.digest = calculatedDigest;
            if (!this.compareDigests(decryptedDigest, calculatedDigest)) {
                throw this.createIntegrityError({
                    expectedDigest: decryptedDigest,
                    actualDigest: calculatedDigest,
                    fileId: restOptions.id,
                    name: result?.name ?? restOptions.name,
                });
            }
        } else {
            session.digest = null;
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