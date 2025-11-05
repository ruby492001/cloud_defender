import * as ownMode from "./ownMode.js";
import * as rcloneMode from "./rcloneMode.js";

const EMPTY_BYTES = new Uint8Array(0);
const MODE_IMPLEMENTATIONS = {
    own: ownMode,
    rclone: rcloneMode,
};

export function normalizeMode(mode) {
    if (typeof mode !== "string") {
        return "own";
    }
    return mode.trim().toLowerCase() === "rclone" ? "rclone" : "own";
}

function getImplementation(mode) {
    const normalized = normalizeMode(mode);
    return MODE_IMPLEMENTATIONS[normalized] ?? ownMode;
}

export function createEncryptionContext({ mode, skipCrypto, keyBytes, ivByteLength, encryptionAlgorithm }) {
    const normalized = normalizeMode(mode);
    if (skipCrypto) {
        return {
            mode: normalized,
            skip: true,
            key: keyBytes ?? null,
            iv: null,
            ivWritten: true,
        };
    }
    if (!(keyBytes instanceof Uint8Array) || keyBytes.length === 0) {
        throw new Error("Encryption key is required for the selected crypto mode");
    }
    const impl = getImplementation(normalized);
    const context = impl.createEncryptionContext({
        keyBytes,
        ivByteLength,
        encryptionAlgorithm,
    });
    return {
        mode: normalized,
        skip: false,
        ...context,
    };
}

export function createDecryptionContext({ mode, skipCrypto, keyBytes, ivByteLength, encryptionAlgorithm }) {
    const normalized = normalizeMode(mode);
    if (skipCrypto) {
        return {
            mode: normalized,
            skip: true,
            key: keyBytes ?? null,
            iv: null,
            ivBytesRead: 0,
        };
    }
    if (!(keyBytes instanceof Uint8Array) || keyBytes.length === 0) {
        throw new Error("Decryption key is required for the selected crypto mode");
    }
    const impl = getImplementation(normalized);
    const context = impl.createDecryptionContext({
        keyBytes,
        ivByteLength,
        encryptionAlgorithm,
    });
    return {
        mode: normalized,
        skip: false,
        ...context,
    };
}

export function ensureEncryptionIv({ mode, context, ivByteLength }) {
    if (!context || context.skip) {
        return context?.iv ?? null;
    }
    const impl = getImplementation(mode);
    return impl.ensureEncryptionIv(context, ivByteLength);
}

export function encryptBlock({ mode, context, chunk, offset = 0, ivByteLength }) {
    if (!context || context.skip) {
        return chunk;
    }
    const impl = getImplementation(mode);
    return impl.encryptBlock(chunk, { context, offset, ivByteLength });
}

export function decryptBlock({ mode, context, chunk, offset = 0 }) {
    if (!context || context.skip) {
        return chunk;
    }
    const impl = getImplementation(mode);
    return impl.decryptBlock(chunk, { context, offset });
}

export function finalizeEncryption({ mode, context }) {
    if (!context || context.skip) {
        return EMPTY_BYTES;
    }
    const impl = getImplementation(mode);
    if (typeof impl.finalizeEncryption === "function") {
        return impl.finalizeEncryption(context) ?? EMPTY_BYTES;
    }
    return EMPTY_BYTES;
}

export function finalizeDecryption({ mode, context }) {
    if (!context || context.skip) {
        return EMPTY_BYTES;
    }
    const impl = getImplementation(mode);
    if (typeof impl.finalizeDecryption === "function") {
        return impl.finalizeDecryption(context) ?? EMPTY_BYTES;
    }
    return EMPTY_BYTES;
}

export function createHashContext({ mode, algorithm }) {
    const impl = getImplementation(mode);
    if (typeof impl.createHashContext === "function") {
        return impl.createHashContext({ algorithm });
    }
    return null;
}

export function updateHash({ mode, hashContext, chunk }) {
    if (!hashContext) return;
    const impl = getImplementation(mode);
    if (typeof impl.updateHash === "function") {
        impl.updateHash(hashContext, chunk);
    }
}

export async function finalizeHash({ mode, hashContext }) {
    if (!hashContext) return null;
    const impl = getImplementation(mode);
    if (typeof impl.finalizeHash === "function") {
        return impl.finalizeHash(hashContext);
    }
    return null;
}

export function encryptDigest({ mode, digest }) {
    const impl = getImplementation(mode);
    if (typeof impl.encryptDigest === "function") {
        return impl.encryptDigest(digest);
    }
    return digest;
}

export function decryptDigest({ mode, digest }) {
    const impl = getImplementation(mode);
    if (typeof impl.decryptDigest === "function") {
        return impl.decryptDigest(digest);
    }
    return digest;
}

export function calculateEncryptedSize({ mode, skipCrypto, originalSize, ivByteLength }) {
    if (skipCrypto) {
        const size = Number.isFinite(originalSize) ? Number(originalSize) : 0;
        return size;
    }
    const impl = getImplementation(mode);
    if (typeof impl.calculateEncryptedSize === "function") {
        return impl.calculateEncryptedSize({ originalSize, ivByteLength });
    }
    const size = Number.isFinite(originalSize) ? Number(originalSize) : 0;
    return size;
}

export function encryptFileName({ mode, name, keyBytes, encryptionAlgorithm, isExcludedName }) {
    if (!name) {
        return name;
    }
    if (typeof isExcludedName === "function" && isExcludedName(name)) {
        return name;
    }
    if (!(keyBytes instanceof Uint8Array) || keyBytes.length === 0) {
        throw new Error("Encryption key is required to encrypt file names");
    }
    const impl = getImplementation(mode);
    if (typeof impl.encryptFileName === "function") {
        return impl.encryptFileName(name, { keyBytes, encryptionAlgorithm, mode });
    }
    return name;
}

export function decryptFileName({ mode, name, keyBytes, encryptionAlgorithm, isExcludedName }) {
    if (!name) {
        return name;
    }
    if (typeof isExcludedName === "function" && isExcludedName(name)) {
        return name;
    }
    if (!(keyBytes instanceof Uint8Array) || keyBytes.length === 0) {
        throw new Error("Decryption key is required to decrypt file names");
    }
    const impl = getImplementation(mode);
    if (typeof impl.decryptFileName === "function") {
        return impl.decryptFileName(name, { keyBytes, encryptionAlgorithm, mode, isExcludedName });
    }
    return name;
}
