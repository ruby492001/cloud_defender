import { utf8ToBytes } from "../utils/byteUtils.js";

export async function deriveKeyBytes({ password, salt, iterations, hash, length }) {
    if (typeof crypto === "undefined" || !crypto.subtle) {
        throw new Error("Web Crypto API is not available (crypto.subtle missing)");
    }
    if (typeof password !== "string" || !password) {
        throw new Error("Password is required for PBKDF2 derivation");
    }
    if (!(salt instanceof Uint8Array) || salt.length === 0) {
        throw new Error("Salt must be a non-empty Uint8Array");
    }
    if (!Number.isFinite(iterations) || iterations <= 0) {
        throw new Error("Iterations must be a positive number");
    }
    if (!Number.isFinite(length) || length <= 0) {
        throw new Error("Derived key length must be a positive number");
    }
    const normalizedHash = typeof hash === "string" && hash.trim() ? hash.trim().toUpperCase() : "SHA-256";
    const passwordBytes = utf8ToBytes(password);

    const baseKey = await crypto.subtle.importKey(
        "raw",
        passwordBytes,
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
    );
    const result = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            hash: normalizedHash,
            salt,
            iterations: Math.floor(iterations),
        },
        baseKey,
        length * 8
    );
    return new Uint8Array(result);
}
