import { Hasher } from "../hasher.js";
import { ALG, CryptoSuite } from "../CryptoSuite.js";
import { bytesToHex, hexToBytes } from "../../utils/byteUtils.js";

const DEFAULT_ALGORITHM = ALG.ARIA_128_CFB128;
const ALG_VALUES = new Set(Object.values(ALG));
const KEY_LENGTH_BY_ALG = {
    [ALG.AES_128_CFB128]: 16,
    [ALG.AES_256_CFB128]: 32,
    [ALG.CAMELLIA_128_CFB128]: 16,
    [ALG.CAMELLIA_256_CFB128]: 32,
    [ALG.ARIA_128_CFB128]: 16,
    [ALG.ARIA_256_CFB128]: 32,
};
const NAME_IV_LENGTH = 16;

function normalizeAlgorithm(value) {
    if (typeof value === "number" && ALG_VALUES.has(value)) {
        return value;
    }
    if (typeof value === "string" && value) {
        const trimmed = value.trim().toUpperCase();
        if (ALG.hasOwnProperty(trimmed)) {
            return ALG[trimmed];
        }
        const withoutPrefix = trimmed.startsWith("ALG.") ? trimmed.slice(4) : trimmed;
        if (ALG.hasOwnProperty(withoutPrefix)) {
            return ALG[withoutPrefix];
        }
    }
    return DEFAULT_ALGORITHM;
}

function normalizeKey(keyBytes, algorithm) {
    if (!(keyBytes instanceof Uint8Array)) {
        throw new TypeError("Own mode requires keyBytes to be a Uint8Array");
    }
    if (keyBytes.length === 0) {
        throw new Error("Own mode requires a non-empty encryption key");
    }
    const requiredLength = KEY_LENGTH_BY_ALG[algorithm] ?? null;
    if (!requiredLength) {
        return keyBytes.slice();
    }
    if (keyBytes.length === requiredLength) {
        return keyBytes.slice();
    }
    if (keyBytes.length > requiredLength) {
        return keyBytes.slice(0, requiredLength);
    }
    const normalized = new Uint8Array(requiredLength);
    for (let i = 0; i < requiredLength; i += 1) {
        normalized[i] = keyBytes[i % keyBytes.length];
    }
    return normalized;
}

function generateIv(ivLength) {
    const iv = new Uint8Array(ivLength);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
        crypto.getRandomValues(iv);
    } else {
        for (let i = 0; i < iv.length; i += 1) {
            iv[i] = Math.floor(Math.random() * 256);
        }
    }
    return iv;
}

export function createEncryptionContext({ keyBytes, ivByteLength, encryptionAlgorithm }) {
    const algorithm = normalizeAlgorithm(encryptionAlgorithm);
    const key = normalizeKey(keyBytes, algorithm);
    const iv = generateIv(ivByteLength);
    return {
        key,
        algorithm,
        iv,
        ivWritten: false,
        encryptContext: CryptoSuite.cfb().createContext(algorithm, key, iv, true),
    };
}

export function ensureEncryptionIv(context, ivByteLength) {
    if (!context.iv || context.iv.byteLength !== ivByteLength) {
        context.iv = generateIv(ivByteLength);
        context.ivWritten = false;
    }
    return context.iv;
}

export function createDecryptionContext({ keyBytes, ivByteLength, encryptionAlgorithm }) {
    const algorithm = normalizeAlgorithm(encryptionAlgorithm);
    const key = normalizeKey(keyBytes, algorithm);
    return {
        key,
        algorithm,
        iv: new Uint8Array(ivByteLength),
        ivBytesRead: 0,
        decryptContext: null,
    };
}

export function encryptBlock(chunk, { context }) {
    return context.encryptContext.update(chunk);
}

export function decryptBlock(chunk, { context }) {
    if (!context.iv || context.iv.byteLength === 0) {
        throw new Error("Own mode requires IV before decrypting content");
    }
    if (!context.decryptContext) {
        context.decryptContext = CryptoSuite.cfb().createContext(context.algorithm, context.key, context.iv, false);
    }
    return context.decryptContext.update(chunk);
}

export function finalizeEncryption(context) {
    if (!context?.encryptContext) {
        return new Uint8Array(0);
    }
    const finalChunk =
        typeof context.encryptContext.finalize === "function"
            ? context.encryptContext.finalize()
            : new Uint8Array(0);
    if (typeof context.encryptContext.free === "function") {
        context.encryptContext.free();
    }
    context.encryptContext = null;
    return finalChunk;
}

export function finalizeDecryption(context) {
    if (!context?.decryptContext) {
        return new Uint8Array(0);
    }
    const finalChunk =
        typeof context.decryptContext.finalize === "function"
            ? context.decryptContext.finalize()
            : new Uint8Array(0);
    if (typeof context.decryptContext.free === "function") {
        context.decryptContext.free();
    }
    context.decryptContext = null;
    return finalChunk;
}

export function createHashContext(options = {}) {
    const { algorithm = "SHA-512" } = options || {};
    const hasher = new Hasher();
    hasher.init(algorithm);
    return { totalBytes: 0, hashCtx: hasher, algorithm };
}

export function updateHash(ctx, chunk) {
    if (!ctx) return;
    ctx.hashCtx.update(chunk);
    ctx.totalBytes += chunk.byteLength;
}

export async function finalizeHash(ctx) {
    if (!ctx) return null;
    const digest = await ctx.hashCtx.finalize();
    ctx.totalBytes = 0;
    return digest;
}

export function decryptDigest(bytes) {
    return bytes;
}

export function encryptDigest(bytes) {
    return bytes;
}

export function calculateEncryptedSize({ originalSize, ivByteLength }) {
    const size = Number.isFinite(originalSize) ? Number(originalSize) : 0;
    const ivSize = Number.isFinite(ivByteLength) ? Number(ivByteLength) : 0;
    return size + ivSize;
}

export function encryptFileName(name, { keyBytes, encryptionAlgorithm, mode } = {}) {
    if (!name) return name;
    const algorithm = normalizeAlgorithm(encryptionAlgorithm || DEFAULT_ALGORITHM);
    const key = normalizeKey(keyBytes, algorithm);
    const iv = generateIv(NAME_IV_LENGTH);
    const ctx = CryptoSuite.cfb().createContext(algorithm, key, iv, true);
    const plain = new TextEncoder().encode(name);
    const cipher = ctx.update(plain);
    const payload = new Uint8Array(iv.byteLength + cipher.byteLength);
    payload.set(iv, 0);
    payload.set(cipher, iv.byteLength);
    if (typeof ctx.finalize === "function") ctx.finalize();
    if (typeof ctx.free === "function") ctx.free();
    return bytesToHex(payload);
}

export function decryptFileName(name, { keyBytes, encryptionAlgorithm, mode } = {}) {
    if (!name) return name;
    try {
        const algorithm = normalizeAlgorithm(encryptionAlgorithm || DEFAULT_ALGORITHM);
        const key = normalizeKey(keyBytes, algorithm);
        const bytes = hexToBytes(name);
        if (!(bytes instanceof Uint8Array) || bytes.byteLength <= NAME_IV_LENGTH) {
            return name;
        }
        const iv = bytes.subarray(0, NAME_IV_LENGTH);
        const cipher = bytes.subarray(NAME_IV_LENGTH);
        const ctx = CryptoSuite.cfb().createContext(algorithm, key, iv, false);
        const plain = ctx.update(cipher);
        if (typeof ctx.finalize === "function") ctx.finalize();
        if (typeof ctx.free === "function") ctx.free();
        return new TextDecoder().decode(plain);
    } catch {
        return name;
    }
}
