import { ALG } from "./CryptoSuite.js";

const KEY_LENGTH_MAP = {
    [ALG.AES_128_CFB128]: 16,
    [ALG.AES_256_CFB128]: 32,
    [ALG.CAMELLIA_128_CFB128]: 16,
    [ALG.CAMELLIA_256_CFB128]: 32,
    [ALG.ARIA_128_CFB128]: 16,
    [ALG.ARIA_256_CFB128]: 32,
};

export const DEFAULT_ENCRYPTION_ALGORITHM = "AES_256_CFB128";
export const ENCRYPTION_ALGORITHMS = Object.keys(ALG);

function normalizeName(value) {
    if (typeof value === "number") {
        return value;
    }
    if (typeof value !== "string" || !value) {
        return DEFAULT_ENCRYPTION_ALGORITHM;
    }
    let trimmed = value.trim();
    if (!trimmed) {
        return DEFAULT_ENCRYPTION_ALGORITHM;
    }
    if (trimmed.startsWith("ALG.")) {
        trimmed = trimmed.slice(4);
    }
    return trimmed.toUpperCase();
}

export function resolveAlgorithmId(value) {
    if (typeof value === "number" && Object.values(ALG).includes(value)) {
        return value;
    }
    const key = normalizeName(value);
    if (Object.prototype.hasOwnProperty.call(ALG, key)) {
        return ALG[key];
    }
    return ALG[DEFAULT_ENCRYPTION_ALGORITHM];
}

export function normalizeAlgorithmName(value) {
    const key = normalizeName(value);
    if (Object.prototype.hasOwnProperty.call(ALG, key)) {
        return key;
    }
    return DEFAULT_ENCRYPTION_ALGORITHM;
}

export function keyLengthForAlgorithm(value) {
    const id = resolveAlgorithmId(value);
    return KEY_LENGTH_MAP[id] ?? 32;
}
