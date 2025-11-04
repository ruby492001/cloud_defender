import { Hasher } from "../hasher.js";
import {ALG, CryptoSuite} from "../CryptoSuite.js";

// хардкодный ключ
let KEY = new Uint8Array([142, 57, 203, 19, 88, 241, 76, 12,
    199, 34, 158, 5, 243, 61, 129, 90,
    44, 177, 230, 211, 6, 254, 119, 38,
    97, 165, 14, 208, 73, 190, 52, 241]);


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

export function createEncryptionContext({ keyBytes, ivByteLength }) {
    let iv = generateIv(ivByteLength);
    return {
        key: keyBytes,
        iv: iv,
        ivWritten: false,
        encryptContext: CryptoSuite.cfb().createContext(ALG.AES_256_CFB128, KEY, iv, true),
    };
}

export function ensureEncryptionIv(context, ivByteLength) {
    if (!context.iv || context.iv.byteLength !== ivByteLength) {
        context.iv = generateIv(ivByteLength);
        context.ivWritten = false;
    }
    return context.iv;
}

export function createDecryptionContext({ keyBytes, ivByteLength }) {
    console.log(ivByteLength);
    return {
        key: keyBytes,
        iv: new Uint8Array(ivByteLength),
        ivBytesRead: 0,
        decryptContext: null,
    };
}

export function encryptBlock(chunk, { context }) {
    return context.encryptContext.update(chunk);
}

export function decryptBlock(chunk, { context, offset = 0 }) {
    if (!context.iv || context.iv.byteLength === 0) {
        throw new Error("Own mode requires IV before decrypting content");
    }

    if(!context.decryptContext)
    {
        context.decryptContext = CryptoSuite.cfb().createContext(ALG.AES_256_CFB128, KEY, context.iv, false);
    }

    return context.decryptContext.update(chunk);
}

export function createHashContext(options = {}) {
    const { algorithm = "SHA-512" } = options || {};
    const hasher = new Hasher();
    hasher.init(algorithm);
    return { totalBytes: 0, hashCtx: hasher, algorithm };
}

export function updateHash(ctx, chunk /* Uint8Array */) {
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
