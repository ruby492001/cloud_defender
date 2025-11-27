import { DEFAULT_ENCRYPTION_ALGORITHM, normalizeAlgorithmName } from "./algorithms.js";

export const CONFIG_FILE_NAME = ".crypto.config";
export const KEY_FILE_NAME = ".key";
export const RCLONE_KEY_FILE_1 = ".key1";
export const RCLONE_KEY_FILE_2 = ".key2";
export const RCLONE_KEY_FILES = [RCLONE_KEY_FILE_1, RCLONE_KEY_FILE_2];
export const CONTROL_PHRASE = "::CLOUD_DEFENDER::OK::";
export const DEFAULT_MODE = "own";
export const DEFAULT_HASH_ALGORITHM = "SHA-512";
export const DEFAULT_PBKDF2_ITERATIONS = 210000;
export const DEFAULT_PBKDF2_HASH = "SHA-256";
export const SALT_BYTE_LENGTH = 16;
export const DEFAULT_FILENAME_ENCRYPTION = "standard";
export const DEFAULT_DIRECTORY_NAME_ENCRYPTION = true;

const COMMENT_REGEX = /^\s*#/;

export function parseConfig(text) {
    if (typeof text !== "string") {
        throw new TypeError("Config content must be a string");
    }
    const result = {};
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        if (!line) continue;
        if (COMMENT_REGEX.test(line)) continue;
        const idx = line.indexOf("=");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!key) continue;
        switch (key.toLowerCase()) {
            case "mode":
                if (value) result.mode = value.toLowerCase();
                break;
            case "hashalgorithm":
                if (value) result.hashAlgorithm = value.toUpperCase();
                break;
            case "encryptionalgorithm":
                if (value) result.encryptionAlgorithm = normalizeAlgorithmName(value);
                break;
            case "pbkdf2iterations":
                if (value && /^\d+$/.test(value)) {
                    result.pbkdf2Iterations = Number(value);
                }
                break;
            case "pbkdf2hash":
                if (value) result.pbkdf2Hash = value.toUpperCase();
                break;
            case "filenameencryption":
                if (value) result.filenameEncryption = value.toLowerCase();
                break;
            case "directorynameencryption":
                if (value) result.directoryNameEncryption = value.toLowerCase() === "true";
                break;
            default:
                break;
        }
    }
    if (!result.mode) {
        result.mode = DEFAULT_MODE;
    }
    if (!result.hashAlgorithm) {
        result.hashAlgorithm = DEFAULT_HASH_ALGORITHM;
    }
    if (!result.encryptionAlgorithm) {
        result.encryptionAlgorithm = normalizeAlgorithmName(DEFAULT_ENCRYPTION_ALGORITHM);
    }
    if (!result.pbkdf2Iterations) {
        result.pbkdf2Iterations = DEFAULT_PBKDF2_ITERATIONS;
    }
    if (!result.pbkdf2Hash) {
        result.pbkdf2Hash = DEFAULT_PBKDF2_HASH;
    }
    if (result.mode === "rclone") {
        if (!result.filenameEncryption) {
            result.filenameEncryption = DEFAULT_FILENAME_ENCRYPTION;
        }
        if (typeof result.directoryNameEncryption === "undefined") {
            result.directoryNameEncryption = DEFAULT_DIRECTORY_NAME_ENCRYPTION;
        }
    }
    return result;
}

export function serializeConfig(config) {
    const lines = [];
    const mode = config?.mode ?? DEFAULT_MODE;
    lines.push(`mode=${mode}`);
    if (config?.mode === "rclone") {
        const filenameEncryption =
            config?.filenameEncryption ?? config?.fileNameEncryption ?? DEFAULT_FILENAME_ENCRYPTION;
        lines.push(`filenameEncryption=${filenameEncryption}`);
        const directoryFlag =
            typeof config?.directoryNameEncryption === "boolean"
                ? config.directoryNameEncryption
                : DEFAULT_DIRECTORY_NAME_ENCRYPTION;
        lines.push(`directoryNameEncryption=${directoryFlag}`);
        return lines.join("\n");
    }
    const hashAlgorithm = config?.hashAlgorithm ?? DEFAULT_HASH_ALGORITHM;
    if (hashAlgorithm) {
        lines.push(`hashAlgorithm=${hashAlgorithm}`);
    }
    const encryptionAlgorithm =
        config?.encryptionAlgorithm ?? normalizeAlgorithmName(DEFAULT_ENCRYPTION_ALGORITHM);
    if (encryptionAlgorithm) {
        lines.push(`encryptionAlgorithm=${encryptionAlgorithm}`);
    }
    const pbkdf2Iterations = config?.pbkdf2Iterations ?? DEFAULT_PBKDF2_ITERATIONS;
    if (pbkdf2Iterations) {
        lines.push(`pbkdf2Iterations=${pbkdf2Iterations}`);
    }
    const pbkdf2Hash = config?.pbkdf2Hash ?? DEFAULT_PBKDF2_HASH;
    if (pbkdf2Hash) {
        lines.push(`pbkdf2Hash=${pbkdf2Hash}`);
    }
    return lines.join("\n");
}
