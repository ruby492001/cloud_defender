import {
    normalizeMode as normalizeCryptoModeValue,
    createEncryptionContext as createModeEncryptionContext,
    createDecryptionContext as createModeDecryptionContext,
    ensureEncryptionIv as ensureModeEncryptionIv,
    encryptBlock as encryptModeBlock,
    decryptBlock as decryptModeBlock,
    finalizeEncryption as finalizeModeEncryption,
    finalizeDecryption as finalizeModeDecryption,
    createHashContext as createModeHashContext,
    updateHash as updateModeHash,
    finalizeHash as finalizeModeHash,
    encryptDigest as encryptModeDigest,
    decryptDigest as decryptModeDigest,
    calculateEncryptedSize as calculateModeEncryptedSize,
    encryptFileName as encryptModeFileName,
    decryptFileName as decryptModeFileName,
} from "../crypto/modes/modeDriver.js";
import { CryptoSuite } from "../crypto/CryptoSuite.js";
import createCfbModule from "../crypto/wasm/cfb_wasm.js";
import {
    parseConfig,
    serializeConfig,
    CONFIG_FILE_NAME,
    KEY_FILE_NAME,
    RCLONE_KEY_FILE_1,
    RCLONE_KEY_FILE_2,
    CONTROL_PHRASE,
    DEFAULT_MODE,
    DEFAULT_HASH_ALGORITHM,
    SALT_BYTE_LENGTH,
    DEFAULT_FILENAME_ENCRYPTION,
    DEFAULT_DIRECTORY_NAME_ENCRYPTION,
} from "../crypto/config.js";

import {
    normalizeAlgorithmName,
    resolveAlgorithmId,
    keyLengthForAlgorithm,
    DEFAULT_ENCRYPTION_ALGORITHM,
} from "../crypto/algorithms.js";

import { deriveKeyBytes } from "../crypto/pbkdf2.js";
import { hexToBytes, bytesToHex, concatBytes, utf8ToBytes, bytesToUtf8 } from "../utils/byteUtils.js";
import { scrypt as wasmScrypt } from "hash-wasm";
import AES from "aes-js";

const DEFAULT_BLOCK_SIZE = 4 * 1024 * 1024; // 4MB
const DEFAULT_HASH_BYTES = 64; // SHA-512 digest length placeholder
const IV_BYTE_LENGTH = 16;
const CRYPTO_MODE_RCLONE = "rclone";
const CRYPTO_MODE_OWN = "own";
const RCLONE_IV_BYTE_LENGTH = 32;
const RCLONE_KEY_MATERIAL_LENGTH = 80;
const RCLONE_DEFAULT_SALT = new Uint8Array([
    0xa8, 0x0d, 0xf4, 0x3a, 0x8f, 0xbd, 0x03, 0x08, 0xa7, 0xca, 0xb8, 0x3e, 0x58, 0x1f, 0x86, 0xb1,
]);
const RCLONE_OBSCURE_KEY = Uint8Array.from([
    0x9c, 0x93, 0x5b, 0x48, 0x73, 0x0a, 0x55, 0x4d, 0x6b, 0xfd, 0x7c, 0x63, 0xc8, 0x86, 0xa9, 0x2b, 0xd3, 0x90, 0x19,
    0x8e, 0xb8, 0x12, 0x8a, 0xfb, 0xf4, 0xde, 0x16, 0x2b, 0x8b, 0x95, 0xf6, 0x38,
]);
const INTEGRITY_ERROR_CODE = "INTEGRITY_ERROR";
const INTEGRITY_ERROR_MESSAGE = "Data integrity corrupted";
const PBKDF2_HASH_ALGORITHM = "SHA-256";
const PBKDF2_ITERATIONS = 210000;

export const EXCLUDED_FILE_NAMES = [
    CONFIG_FILE_NAME,
    KEY_FILE_NAME,
    RCLONE_KEY_FILE_1,
    RCLONE_KEY_FILE_2,
];
const registerCfbSuite = (() => {
    let registered = false;
    return () => {
        if (registered) return;
        CryptoSuite.registerSuite(
            "cfb",
            createCfbModule,
            (p) => (p.endsWith(".wasm") ? new URL("../crypto/wasm/cfb_wasm.wasm", import.meta.url).href : p)
        );
        registered = true;
    };
})();
const defaultPromptPassword = async () => {
    throw new Error("Password prompt handler is not configured");
};
export default class GoogleCryptoApi {
    constructor(driveApi, options = {}) {
        registerCfbSuite();
        this.drive = driveApi;
        this._configPromise = null;
        this.blockSize = options.blockSize ?? DEFAULT_BLOCK_SIZE;
        this.hashByteLength = options.hashByteLength ?? DEFAULT_HASH_BYTES;
        this.ivByteLength = IV_BYTE_LENGTH;
        this.cryptoMode = CRYPTO_MODE_OWN;
        this.currentConfig = {};
        this._cachedKeyBytes = null;
        this.promptPassword = typeof options.promptPassword === "function" ? options.promptPassword : defaultPromptPassword;
        this._configFileId = null;
        this._keyFileId = null;
        this._rcloneKey1Id = null;
        this._rcloneKey2Id = null;
        this._configInitializationPromise = null;
        this.onStorageInitStart =
            typeof options.onStorageInitStart === "function" ? options.onStorageInitStart : null;
        this.onStorageInitFinish =
            typeof options.onStorageInitFinish === "function" ? options.onStorageInitFinish : null;
        this._oneTimeUnlockPassword = null;
        this._skipUnlockNext = false;
    }
    async ensureConfigLoaded() {
        if (!this._configPromise && this.currentConfig?.key && this.currentConfig?.mode) {
            this._configPromise = Promise.resolve(this.currentConfig);
            return this._configPromise;
        }
        if (!this._configPromise) {
            this._configPromise = this.loadCryptoConfig()
                .then((config) => {
                    const normalized = config || {};
                    const nextConfig = { ...normalized };
                    if (!nextConfig.encryptionAlgorithm) {
                        nextConfig.encryptionAlgorithm = DEFAULT_ENCRYPTION_ALGORITHM;
                    }
                    this.currentConfig = nextConfig;
                    this.cryptoMode = this.normalizeCryptoMode(nextConfig.mode || nextConfig.algorithm);
                    this.ivByteLength =
                        this.cryptoMode === CRYPTO_MODE_RCLONE ? RCLONE_IV_BYTE_LENGTH : IV_BYTE_LENGTH;
                    this._cachedKeyBytes = null;
                    if (!this._loggedKey) {
                        console.info("[Crypto] current key (debug)", this.currentConfig?.key);
                        this._loggedKey = true;
                    }
                    return nextConfig;
                })
                .catch((err) => {
                    this._configPromise = null;
                    this.currentConfig = {};
                    this.cryptoMode = CRYPTO_MODE_OWN;
                    this.ivByteLength = IV_BYTE_LENGTH;
                    this._cachedKeyBytes = null;
                    throw err;
                });
        }
        return this._configPromise;
    }
    async loadCryptoConfig() {
        const { configText, keyText, key1Text, key2Text, configMeta, keyMeta, key1Meta, key2Meta } =
            await this.ensureConfigFiles();
        const parsed = parseConfig(configText);
        parsed.mode = (parsed.mode || DEFAULT_MODE).toLowerCase();
        parsed.hashAlgorithm = parsed.hashAlgorithm || DEFAULT_HASH_ALGORITHM;
        parsed.encryptionAlgorithm = normalizeAlgorithmName(parsed.encryptionAlgorithm || DEFAULT_ENCRYPTION_ALGORITHM);
        parsed.pbkdf2Iterations = this.pickPbkdf2Iterations(parsed.pbkdf2Iterations);
        parsed.pbkdf2Hash = this.pickPbkdf2Hash(parsed.pbkdf2Hash);
        if (this._skipUnlockNext && this.currentConfig?.key && this.currentConfig?.mode === parsed.mode) {
            this._skipUnlockNext = false;
            this.cryptoMode = this.normalizeCryptoMode(parsed.mode);
            this.ivByteLength =
                this.cryptoMode === CRYPTO_MODE_RCLONE ? RCLONE_IV_BYTE_LENGTH : IV_BYTE_LENGTH;
            this._cachedKeyBytes = null;
            return { ...parsed, ...this.currentConfig };
        }
        this._configFileId = configMeta?.id ?? this._configFileId;
        this._keyFileId = keyMeta?.id ?? this._keyFileId;
        this._rcloneKey1Id = key1Meta?.id ?? this._rcloneKey1Id;
        this._rcloneKey2Id = key2Meta?.id ?? this._rcloneKey2Id;
        if (this.normalizeCryptoMode(parsed.mode) !== CRYPTO_MODE_OWN) {
            const unlockedRclone = await this.unlockRcloneKeys({
                config: parsed,
                encryptedPrimary: key1Text,
                encryptedSecondary: key2Text,
            });
            return unlockedRclone;
        }
        const unlocked = await this.unlockEncryptedKey({
            config: parsed,
            encryptedHex: keyText,
        });
        return unlocked;
    }
    pickPbkdf2Iterations() {
        return PBKDF2_ITERATIONS;
    }
    pickPbkdf2Hash() {
        return PBKDF2_HASH_ALGORITHM;
    }
    async ensureConfigFiles() {
        const configMeta = await this.drive.findFileByName(CONFIG_FILE_NAME);
        const keyMeta = await this.drive.findFileByName(KEY_FILE_NAME);
        const key1Meta = await this.drive.findFileByName(RCLONE_KEY_FILE_1);
        const key2Meta = await this.drive.findFileByName(RCLONE_KEY_FILE_2);
        const hasRcloneKeys = Boolean(key1Meta);
        if (!configMeta || (!keyMeta && !hasRcloneKeys)) {
            await this.ensureConfigSeedCreated();
            const refreshedConfig = await this.drive.findFileByName(CONFIG_FILE_NAME);
            const refreshedKey = await this.drive.findFileByName(KEY_FILE_NAME);
            const refreshedKey1 = await this.drive.findFileByName(RCLONE_KEY_FILE_1);
            const refreshedKey2 = await this.drive.findFileByName(RCLONE_KEY_FILE_2);
            const refreshedHasRcloneKeys = Boolean(refreshedKey1);
            if (!refreshedConfig || (!refreshedKey && !refreshedHasRcloneKeys)) {
                throw new Error("Crypto configuration files are missing after initialization attempt");
            }
            const configTextRetry = await this.drive.downloadSmallFile(refreshedConfig.id, {
                responseType: "text",
            });
            const keyTextRetry = refreshedKey
                ? await this.drive.downloadSmallFile(refreshedKey.id, { responseType: "text" })
                : null;
            const key1TextRetry = refreshedKey1
                ? await this.drive.downloadSmallFile(refreshedKey1.id, { responseType: "text" })
                : null;
            const key2TextRetry =
                refreshedKey2 && refreshedHasRcloneKeys
                    ? await this.drive.downloadSmallFile(refreshedKey2.id, { responseType: "text" })
                    : null;
            return {
                configText: configTextRetry,
                keyText: keyTextRetry,
                key1Text: key1TextRetry,
                key2Text: key2TextRetry,
                configMeta: refreshedConfig,
                keyMeta: refreshedKey,
                key1Meta: refreshedKey1,
                key2Meta: refreshedKey2,
            };
        }
        const configText = await this.drive.downloadSmallFile(configMeta.id, { responseType: "text" });
        const keyText = keyMeta ? await this.drive.downloadSmallFile(keyMeta.id, { responseType: "text" }) : null;
        const key1Text = key1Meta ? await this.drive.downloadSmallFile(key1Meta.id, { responseType: "text" }) : null;
        const key2Text = key2Meta ? await this.drive.downloadSmallFile(key2Meta.id, { responseType: "text" }) : null;
        return { configText, keyText, key1Text, key2Text, configMeta, keyMeta, key1Meta, key2Meta };
    }
    async ensureConfigSeedCreated() {
        if (this._configInitializationPromise) {
            await this._configInitializationPromise;
            return;
        }
        this._configInitializationPromise = (async () => {
            const passwordResponse = await this.requestPassword({
                reason: "setup",
                message: "Create a password for file encryption",
                confirm: true,
            });
            let rawPassword = passwordResponse;
            let chosenEncryption = DEFAULT_ENCRYPTION_ALGORITHM;
            let chosenHash = DEFAULT_HASH_ALGORITHM;
            let chosenMode = CRYPTO_MODE_OWN;
            let rcloneOptions = {
                filenameEncryption: DEFAULT_FILENAME_ENCRYPTION,
                directoryNameEncryption: DEFAULT_DIRECTORY_NAME_ENCRYPTION,
                rclonePassword: "",
                rclonePassword2: "",
            };
            if (passwordResponse && typeof passwordResponse === "object") {
                rawPassword = passwordResponse.password;
                if (passwordResponse.encryptionAlgorithm) {
                    chosenEncryption = normalizeAlgorithmName(passwordResponse.encryptionAlgorithm);
                }
                if (passwordResponse.hashAlgorithm) {
                    const hashCandidate = String(passwordResponse.hashAlgorithm).trim().toUpperCase();
                    chosenHash = hashCandidate || DEFAULT_HASH_ALGORITHM;
                }
                if (passwordResponse.mode) {
                    chosenMode = this.normalizeCryptoMode(passwordResponse.mode);
                }
                if (chosenMode === CRYPTO_MODE_RCLONE && passwordResponse.rclone) {
                    const rclone = passwordResponse.rclone;
                    rcloneOptions = {
                        filenameEncryption:
                            rclone.filenameEncryption ||
                            rclone.fileNameEncryption ||
                            DEFAULT_FILENAME_ENCRYPTION,
                        directoryNameEncryption:
                            typeof rclone.directoryNameEncryption === "boolean"
                                ? rclone.directoryNameEncryption
                                : rclone.directoryNameEncryption ?? DEFAULT_DIRECTORY_NAME_ENCRYPTION,
                        rclonePassword: rclone.password || "",
                        rclonePassword2: rclone.password2 || "",
                    };
                }
            }
            if (typeof rawPassword !== "string" || !rawPassword.trim()) {
                throw new Error("Password is required to initialize crypto configuration");
            }
            const trimmedPassword = rawPassword.trim();
            this._oneTimeUnlockPassword = trimmedPassword;
            try {
                if (this.onStorageInitStart) {
                    try {
                        this.onStorageInitStart();
                    } catch {}
                }
                const resultConfig =
                    chosenMode === CRYPTO_MODE_RCLONE
                        ? await this.configureRcloneCrypto({
                              mode: CRYPTO_MODE_RCLONE,
                              hashAlgorithm: chosenHash,
                              encryptionAlgorithm: chosenEncryption,
                              pbkdf2Iterations: PBKDF2_ITERATIONS,
                              pbkdf2Hash: PBKDF2_HASH_ALGORITHM,
                              password: trimmedPassword,
                              filenameEncryption: rcloneOptions.filenameEncryption,
                              directoryNameEncryption: this.normalizeDirectoryNameEncryption(
                                  rcloneOptions.directoryNameEncryption
                              ),
                              rclonePassword: rcloneOptions.rclonePassword,
                              rclonePassword2: rcloneOptions.rclonePassword2,
                          })
                        : await this.configureCrypto({
                              mode: CRYPTO_MODE_OWN,
                              hashAlgorithm: chosenHash,
                              encryptionAlgorithm: chosenEncryption,
                              pbkdf2Iterations: PBKDF2_ITERATIONS,
                              pbkdf2Hash: PBKDF2_HASH_ALGORITHM,
                              password: trimmedPassword,
                          });
                this.currentConfig = resultConfig;
                this.cryptoMode = this.normalizeCryptoMode(resultConfig.mode);
                this._cachedKeyBytes = null;
                this._cachedKeyBytes = null;
                this.currentConfig = { ...this.currentConfig, key: resultConfig.key };
                this._skipUnlockNext = true;
            } finally {
                if (this.onStorageInitFinish) {
                    try {
                        this.onStorageInitFinish();
                    } catch {}
                }
            }
        })();
        try {
            await this._configInitializationPromise;
        } finally {
            this._configInitializationPromise = null;
        }
    }
    async requestPassword(options = {}) {
        if (this._oneTimeUnlockPassword) {
            const pwd = this._oneTimeUnlockPassword;
            this._oneTimeUnlockPassword = null;
            return pwd;
        }
        const handler = this.promptPassword ?? defaultPromptPassword;
        const result = await handler(options);
        if (result && typeof result === "object" && result.password) {
            return result;
        }
        if (typeof result === "string") {
            return result;
        }
        if (result === null || typeof result === "undefined" || result === false) {
            return null;
        }
        return String(result);
    }
    async unlockEncryptedKey({ config, encryptedHex }) {
        if (typeof encryptedHex !== "string" || !encryptedHex.trim()) {
            throw new Error("Encrypted key payload is missing");
        }
        const sanitized = encryptedHex.replace(/\s+/g, "");
        const payload = hexToBytes(sanitized);
        if (payload.length <= SALT_BYTE_LENGTH + this.ivByteLength) {
            throw new Error("Encrypted key payload is too short");
        }
        const salt = payload.slice(0, SALT_BYTE_LENGTH);
        const ivStart = SALT_BYTE_LENGTH;
        const ivEnd = ivStart + this.ivByteLength;
        const iv = payload.slice(ivStart, ivEnd);
        const ciphertext = payload.slice(ivEnd);
        const iterations = this.pickPbkdf2Iterations(config.pbkdf2Iterations);
        const hash = this.pickPbkdf2Hash(config.pbkdf2Hash);
        const keyLength = keyLengthForAlgorithm(config.encryptionAlgorithm);
        let attempt = 0;
        while (true) {
            const password = await this.requestPassword({
                reason: "unlock",
                attempt,
                message:
                    attempt > 0
                        ? "Incorrect password. Try again."
                        : "Enter the password to unlock the encryption key.",
            });
            const trimmedPassword = typeof password === "string" ? password.trim() : String(password).trim();
            if (!trimmedPassword) {
                attempt += 1;
                continue;
            }
            try {
                const derivedKey = await deriveKeyBytes({
                    password: trimmedPassword,
                    salt,
                    iterations,
                    hash,
                    length: keyLength,
                });
                console.debug("[Crypto] derived PBKDF2 key:", bytesToHex(derivedKey).toLowerCase());
                const decrypted = await this.decryptBytesWithAlgorithm({
                    algorithm: config.encryptionAlgorithm,
                    key: derivedKey,
                    iv,
                    ciphertext,
                });
                const plain = bytesToUtf8(decrypted).replace(/\0+$/g, "");
                if (!plain.endsWith(CONTROL_PHRASE)) {
                    throw new Error("CONTROL_MISMATCH");
                }
                const keyHex = plain.slice(0, -CONTROL_PHRASE.length).trim();
                if (!/^[0-9a-fA-F]+$/.test(keyHex) || keyHex.length % 2 !== 0) {
                    throw new Error("DECRYPTED_KEY_INVALID");
                }
                console.debug("[Crypto] decrypted key:", keyHex.toLowerCase());
                return { ...config, key: keyHex.toLowerCase() };
            } catch (err) {
                attempt += 1;
                if (attempt >= 10) {
                    throw err instanceof Error && err.message !== "CONTROL_MISMATCH"
                        ? err
                        : new Error("Too many failed password attempts");
                }
            }
        }
    }
    async unlockRcloneKeys({ config, encryptedPrimary, encryptedSecondary }) {
        if (typeof encryptedPrimary !== "string") {
            throw new Error("Encrypted rclone key payloads are missing");
        }
        const iterations = this.pickPbkdf2Iterations(config.pbkdf2Iterations);
        const hash = this.pickPbkdf2Hash(config.pbkdf2Hash);
        const algorithm = normalizeAlgorithmName(config.encryptionAlgorithm || DEFAULT_ENCRYPTION_ALGORITHM);
        let attempt = 0;
        const normalizedFilenameEncryption = this.normalizeFilenameEncryptionOption(
            config.filenameEncryption || config.fileNameEncryption || DEFAULT_FILENAME_ENCRYPTION
        );
        const normalizedDirectoryEncryption = this.normalizeDirectoryNameEncryption(
            config.directoryNameEncryption
        );
        while (true) {
            const password = await this.requestPassword({
                reason: "unlock",
                attempt,
                message:
                    attempt > 0
                        ? "Incorrect password. Try again."
                        : "Enter the password to unlock the encryption key.",
            });
            const trimmedPassword = typeof password === "string" ? password.trim() : String(password).trim();
            if (!trimmedPassword) {
                attempt += 1;
                continue;
            }
            try {
                const primarySecret = await this.decryptSecretPayload({
                    encryptedHex: encryptedPrimary,
                    password: trimmedPassword,
                    encryptionAlgorithm: algorithm,
                    pbkdf2Iterations: iterations,
                    pbkdf2Hash: hash,
                });
                const secondarySecret =
                    typeof encryptedSecondary === "string" && encryptedSecondary.trim()
                        ? await this.decryptSecretPayload({
                              encryptedHex: encryptedSecondary,
                              password: trimmedPassword,
                              encryptionAlgorithm: algorithm,
                              pbkdf2Iterations: iterations,
                              pbkdf2Hash: hash,
                          })
                        : "";
                const keyMaterial = await this.deriveRcloneKeyMaterial(primarySecret, secondarySecret);
                const unlockedConfig = {
                    ...config,
                    mode: CRYPTO_MODE_RCLONE,
                    filenameEncryption: normalizedFilenameEncryption,
                    directoryNameEncryption: normalizedDirectoryEncryption,
                    encryptionAlgorithm: DEFAULT_ENCRYPTION_ALGORITHM,
                    pbkdf2Iterations: PBKDF2_ITERATIONS,
                    pbkdf2Hash: PBKDF2_HASH_ALGORITHM,
                    key: bytesToHex(keyMaterial).toLowerCase(),
                    rclonePassword: primarySecret,
                    rclonePassword2: secondarySecret,
                };
                this.currentConfig = unlockedConfig;
                this.cryptoMode = CRYPTO_MODE_RCLONE;
                this.ivByteLength = RCLONE_IV_BYTE_LENGTH;
                this._cachedKeyBytes = null;
                return unlockedConfig;
            } catch (err) {
                attempt += 1;
                if (attempt >= 10) {
                    throw err instanceof Error && err.message !== "CONTROL_MISMATCH"
                        ? err
                        : new Error("Too many failed password attempts");
                }
            }
        }
    }
    async decryptBytesWithAlgorithm({ algorithm, key, iv, ciphertext }) {
        await this.ensureSuiteReady();
        const algId = resolveAlgorithmId(algorithm);
        const suite = CryptoSuite.cfb();
        const context = suite.createContext(algId, key, iv, false);
        const parts = [];
        parts.push(context.update(ciphertext));
        if (typeof context.finalize === "function") {
            const finalChunk = context.finalize();
            if (finalChunk && finalChunk.length) {
                parts.push(finalChunk);
            }
        }
        if (typeof context.free === "function") {
            context.free();
        }
        return concatBytes(...parts);
    }
    async encryptBytesWithAlgorithm({ algorithm, key, iv, plaintext }) {
        await this.ensureSuiteReady();
        const algId = resolveAlgorithmId(algorithm);
        const suite = CryptoSuite.cfb();
        const context = suite.createContext(algId, key, iv, true);
        const parts = [];
        parts.push(context.update(plaintext));
        if (typeof context.finalize === "function") {
            const finalChunk = context.finalize();
            if (finalChunk && finalChunk.length) {
                parts.push(finalChunk);
            }
        }
        if (typeof context.free === "function") {
            context.free();
        }
        return concatBytes(...parts);
    }
    async ensureSuiteReady() {
        registerCfbSuite();
        if (typeof CryptoSuite.isReady === "function" && CryptoSuite.isReady("cfb")) {
            return;
        }
        await CryptoSuite.ready("cfb");
    }
    generateRandomBytes(length) {
        const out = new Uint8Array(length);
        if (typeof crypto !== "undefined" && crypto.getRandomValues) {
            crypto.getRandomValues(out);
        } else {
            for (let i = 0; i < out.length; i += 1) {
                out[i] = Math.floor(Math.random() * 256);
            }
        }
        return out;
    }
    async encryptSecretPayload({
        plaintext,
        password,
        encryptionAlgorithm,
        pbkdf2Iterations,
        pbkdf2Hash,
    }) {
        const normalizedAlgorithm = normalizeAlgorithmName(encryptionAlgorithm || DEFAULT_ENCRYPTION_ALGORITHM);
        const normalizedPassword = typeof password === "string" ? password : String(password ?? "");
        const salt = this.generateRandomBytes(SALT_BYTE_LENGTH);
        const keyLength = keyLengthForAlgorithm(normalizedAlgorithm);
        const derivedKey = await deriveKeyBytes({
            password: normalizedPassword,
            salt,
            iterations: this.pickPbkdf2Iterations(pbkdf2Iterations),
            hash: this.pickPbkdf2Hash(pbkdf2Hash),
            length: keyLength,
        });
        const iv = this.generateRandomBytes(this.ivByteLength);
        const payload = await this.encryptBytesWithAlgorithm({
            algorithm: normalizedAlgorithm,
            key: derivedKey,
            iv,
            plaintext: utf8ToBytes(String(plaintext ?? "") + CONTROL_PHRASE),
        });
        return bytesToHex(concatBytes(salt, iv, payload));
    }
    async decryptSecretPayload({
        encryptedHex,
        password,
        encryptionAlgorithm,
        pbkdf2Iterations,
        pbkdf2Hash,
    }) {
        if (typeof encryptedHex !== "string" || !encryptedHex.trim()) {
            throw new Error("Encrypted payload is missing");
        }
        const sanitized = encryptedHex.replace(/\s+/g, "");
        const payload = hexToBytes(sanitized);
        if (payload.length <= SALT_BYTE_LENGTH + this.ivByteLength) {
            throw new Error("Encrypted payload is too short");
        }
        const salt = payload.slice(0, SALT_BYTE_LENGTH);
        const ivStart = SALT_BYTE_LENGTH;
        const ivEnd = ivStart + this.ivByteLength;
        const iv = payload.slice(ivStart, ivEnd);
        const ciphertext = payload.slice(ivEnd);
        const normalizedAlgorithm = normalizeAlgorithmName(encryptionAlgorithm || DEFAULT_ENCRYPTION_ALGORITHM);
        const keyLength = keyLengthForAlgorithm(normalizedAlgorithm);
        const derivedKey = await deriveKeyBytes({
            password,
            salt,
            iterations: this.pickPbkdf2Iterations(pbkdf2Iterations),
            hash: this.pickPbkdf2Hash(pbkdf2Hash),
            length: keyLength,
        });
        const decrypted = await this.decryptBytesWithAlgorithm({
            algorithm: normalizedAlgorithm,
            key: derivedKey,
            iv,
            ciphertext,
        });
        const plain = bytesToUtf8(decrypted).replace(/\0+$/g, "");
        if (!plain.endsWith(CONTROL_PHRASE)) {
            throw new Error("CONTROL_MISMATCH");
        }
        return plain.slice(0, -CONTROL_PHRASE.length);
    }
    async deriveRcloneKeyMaterial(primary, secondary) {
        const salt = secondary && secondary.trim() ? utf8ToBytes(secondary.trim()) : RCLONE_DEFAULT_SALT;
        const derived = await wasmScrypt({
            password: primary || "",
            salt,
            costFactor: 16384,
            blockSize: 8,
            parallelism: 1,
            hashLength: RCLONE_KEY_MATERIAL_LENGTH,
            outputType: "binary",
        });
        return derived instanceof Uint8Array ? derived : new Uint8Array(derived);
    }
    async revealRcloneSecret(secret) {
        const trimmed = typeof secret === "string" ? secret.trim() : "";
        if (!trimmed) return "";
        try {
            const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
            const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
            const b64 = normalized + pad;
            const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            if (raw.length <= 16) {
                return trimmed;
            }
            const iv = raw.subarray(0, 16);
            const payload = raw.subarray(16);
            const aesCtr = new AES.ModeOfOperation.ctr(RCLONE_OBSCURE_KEY, new AES.Counter(iv));
            const decrypted = aesCtr.decrypt(payload);
            return new TextDecoder().decode(decrypted);
        } catch {
            return trimmed;
        }
    }
    async configureCrypto(options = {}) {
        const normalizedMode = this.normalizeCryptoMode(options.mode ?? DEFAULT_MODE);
        if (normalizedMode !== CRYPTO_MODE_OWN) {
            throw new Error("Only OWN mode is supported by configureCrypto");
        }
        const normalized = {
            mode: normalizedMode,
            hashAlgorithm:
                typeof options.hashAlgorithm === "string" && options.hashAlgorithm.trim()
                    ? options.hashAlgorithm.trim().toUpperCase()
                    : DEFAULT_HASH_ALGORITHM,
            encryptionAlgorithm: normalizeAlgorithmName(
                options.encryptionAlgorithm || DEFAULT_ENCRYPTION_ALGORITHM
            ),
        };
        normalized.pbkdf2Iterations = PBKDF2_ITERATIONS;
        normalized.pbkdf2Hash = PBKDF2_HASH_ALGORITHM;
        const password = typeof options.password === "string" ? options.password.trim() : "";
        if (!password) {
            throw new Error("Password is required to configure crypto");
        }
        const keyLength = keyLengthForAlgorithm(normalized.encryptionAlgorithm);
        const fileKeyBytes = this.generateRandomBytes(keyLength);
        const fileKeyHex = bytesToHex(fileKeyBytes);
        const salt = this.generateRandomBytes(SALT_BYTE_LENGTH);
        const derivedKey = await deriveKeyBytes({
            password,
            salt,
            iterations: normalized.pbkdf2Iterations,
            hash: normalized.pbkdf2Hash,
            length: keyLength,
        });
        const iv = this.generateRandomBytes(this.ivByteLength);
        const payload = await this.encryptBytesWithAlgorithm({
            algorithm: normalized.encryptionAlgorithm,
            key: derivedKey,
            iv,
            plaintext: utf8ToBytes(fileKeyHex + CONTROL_PHRASE),
        });
        const payloadHex = bytesToHex(concatBytes(salt, iv, payload));
        const configMeta = await this.createOrUpdateTextFile({
            name: CONFIG_FILE_NAME,
            data: serializeConfig(normalized),
            mimeType: "text/plain",
        });
        const keyMeta = await this.createOrUpdateTextFile({
            name: KEY_FILE_NAME,
            data: payloadHex,
            mimeType: "text/plain",
        });
        this._configFileId = configMeta?.id ?? this._configFileId;
        this._keyFileId = keyMeta?.id ?? this._keyFileId;
        this.currentConfig = { ...normalized, key: fileKeyHex.toLowerCase() };
        this.cryptoMode = this.normalizeCryptoMode(normalized.mode);
        this.ivByteLength = IV_BYTE_LENGTH;
        this._cachedKeyBytes = null;
        this._configPromise = Promise.resolve(this.currentConfig);
        return this.currentConfig;
    }
    normalizeFilenameEncryptionOption(value) {
        const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
        if (normalized === "obfuscate") return "obfuscate";
        if (normalized === "off" || normalized === "none" || normalized === "plain") return "off";
        return DEFAULT_FILENAME_ENCRYPTION;
    }
    normalizeDirectoryNameEncryption(value) {
        if (typeof value === "boolean") return value;
        const normalized = String(value ?? "").trim().toLowerCase();
        if (!normalized) return DEFAULT_DIRECTORY_NAME_ENCRYPTION;
        if (normalized === "false" || normalized === "0" || normalized === "off") return false;
        return true;
    }
    async configureRcloneCrypto(options = {}) {
        const basePassword = typeof options.password === "string" ? options.password.trim() : "";
        if (!basePassword) {
            throw new Error("Password is required to configure crypto");
        }
        const primaryRaw = typeof options.rclonePassword === "string" ? options.rclonePassword.trim() : "";
        const secondaryRaw = typeof options.rclonePassword2 === "string" ? options.rclonePassword2.trim() : "";
        const primarySecret = await this.revealRcloneSecret(primaryRaw);
        const secondarySecretRaw = await this.revealRcloneSecret(secondaryRaw);
        const secondarySecret = secondarySecretRaw ?? "";
        if (!primarySecret) {
            throw new Error("Primary rclone password is required");
        }
        const normalized = {
            mode: CRYPTO_MODE_RCLONE,
        };
        normalized.filenameEncryption = this.normalizeFilenameEncryptionOption(
            options.filenameEncryption || DEFAULT_FILENAME_ENCRYPTION
        );
        normalized.directoryNameEncryption = this.normalizeDirectoryNameEncryption(
            options.directoryNameEncryption
        );
        const primaryPayload = await this.encryptSecretPayload({
            plaintext: primarySecret,
            password: basePassword,
            encryptionAlgorithm: DEFAULT_ENCRYPTION_ALGORITHM,
            pbkdf2Iterations: PBKDF2_ITERATIONS,
            pbkdf2Hash: PBKDF2_HASH_ALGORITHM,
        });
        const secondaryPayload =
            secondarySecret !== ""
                ? await this.encryptSecretPayload({
                      plaintext: secondarySecret,
                      password: basePassword,
                      encryptionAlgorithm: DEFAULT_ENCRYPTION_ALGORITHM,
                      pbkdf2Iterations: PBKDF2_ITERATIONS,
                      pbkdf2Hash: PBKDF2_HASH_ALGORITHM,
                  })
                : null;
        const keyMaterial = await this.deriveRcloneKeyMaterial(primarySecret, secondarySecret);
        this._oneTimeUnlockPassword = basePassword;
        const combinedKey = bytesToHex(keyMaterial);
        const configMeta = await this.createOrUpdateTextFile({
            name: CONFIG_FILE_NAME,
            data: serializeConfig(normalized),
            mimeType: "text/plain",
        });
        const key1Meta = await this.createOrUpdateTextFile({
            name: RCLONE_KEY_FILE_1,
            data: primaryPayload,
            mimeType: "text/plain",
        });
        let key2Meta = null;
        if (secondaryPayload) {
            key2Meta = await this.createOrUpdateTextFile({
                name: RCLONE_KEY_FILE_2,
                data: secondaryPayload,
                mimeType: "text/plain",
            });
        }
        this._configFileId = configMeta?.id ?? this._configFileId;
        this._rcloneKey1Id = key1Meta?.id ?? this._rcloneKey1Id;
        this._rcloneKey2Id = key2Meta?.id ?? this._rcloneKey2Id;
        this.currentConfig = {
            ...normalized,
            key: combinedKey.toLowerCase(),
            rclonePassword: primarySecret,
            rclonePassword2: secondarySecret,
        };
        this.cryptoMode = CRYPTO_MODE_RCLONE;
        this.ivByteLength = RCLONE_IV_BYTE_LENGTH;
        this._cachedKeyBytes = null;
        this._configPromise = Promise.resolve(this.currentConfig);
        return this.currentConfig;
    }
    async createOrUpdateTextFile({ name, data, mimeType = "text/plain" }) {
        const existing = await this.drive.findFileByName(name);
        if (existing?.id) {
            await this.drive.updateFileContent(existing.id, data, mimeType);
            return existing;
        }
        return this.drive.uploadSmallFile({
            name,
            data,
            mimeType,
            parentId: this.drive.rootId || "root",
        });
    }
    normalizeCryptoMode(mode) {
        const normalized = normalizeCryptoModeValue(mode);
        return normalized === CRYPTO_MODE_RCLONE ? CRYPTO_MODE_RCLONE : CRYPTO_MODE_OWN;
    }
    getCryptoMode() {
        return this.cryptoMode || CRYPTO_MODE_OWN;
    }
    isRcloneMode() {
        return this.getCryptoMode() === CRYPTO_MODE_RCLONE;
    }
    getEncryptionAlgorithm(mode = this.getCryptoMode()) {
        if (mode === CRYPTO_MODE_RCLONE) {
            return null;
        }
        const configured = this.currentConfig?.encryptionAlgorithm;
        if (configured && typeof configured === "string") {
            const trimmed = configured.trim();
            if (trimmed) return trimmed;
        }
        return DEFAULT_ENCRYPTION_ALGORITHM;
    }
    shouldUseStreamingCrypto(session) {
        return !!session && !session.skipCrypto;
    }
    calculateUploadSize({ size, mode, skipCrypto } = {}) {
        const originalSize = Number.isFinite(size) ? Number(size) : 0;
        const normalizedMode = this.normalizeCryptoMode(mode ?? this.getCryptoMode());
        return calculateModeEncryptedSize({
            mode: normalizedMode,
            skipCrypto: !!skipCrypto,
            originalSize,
            ivByteLength: this.ivByteLength,
        });
    }
    getHashAlgorithm() {
        const alg = this.currentConfig?.hashAlgorithm;
        if (!alg) return "SHA-512";
        const normalized = String(alg).trim();
        return normalized ? normalized : "SHA-512";
    }
    getKeyBytes() {
        if (this._cachedKeyBytes) return this._cachedKeyBytes;
        const keyCandidate = this.currentConfig?.key;
        const keySource = typeof keyCandidate === "string" ? keyCandidate.trim() : "";
        if (!keySource) {
            throw new Error("GoogleCryptoApi: encryption key is missing in the crypto config");
        }
        try {
            // Support base64-encoded keys; fallback to UTF-8 bytes.
            let raw;
            const hexCandidate = keySource.startsWith("0x") || keySource.startsWith("0X")
                ? keySource.slice(2)
                : keySource;
            if (/^[0-9a-fA-F]+$/.test(hexCandidate) && hexCandidate.length % 2 === 0) {
                const byteLength = hexCandidate.length / 2;
                raw = new Uint8Array(byteLength);
                for (let i = 0; i < byteLength; i += 1) {
                    const byte = hexCandidate.slice(i * 2, i * 2 + 2);
                    raw[i] = parseInt(byte, 16);
                }
            } else if (/^[A-Za-z0-9+/=]+$/.test(keySource) && keySource.length % 4 === 0) {
                if (typeof atob === "function") {
                    raw = Uint8Array.from(atob(keySource), (c) => c.charCodeAt(0));
                } else if (typeof Buffer !== "undefined") {
                    raw = Uint8Array.from(Buffer.from(keySource, "base64"));
                } else {
                    throw new Error("No base64 decoder available");
                }
            } else {
                raw = new TextEncoder().encode(keySource);
            }
            this._cachedKeyBytes = raw;
            return raw;
        } catch (err) {
            const error = new Error(`GoogleCryptoApi: failed to decode encryption key: ${err?.message ?? err}`);
            error.cause = err;
            throw error;
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
    encryptFileName(name, options = {}) {
        if (!name) return name;
        if (this.isExcludedName(name)) {
            return name;
        }
        const normalizedMode = this.normalizeCryptoMode(this.getCryptoMode());
        const keyBytes = this.getKeyBytes();
        return encryptModeFileName({
            mode: normalizedMode,
            name,
            keyBytes,
            encryptionAlgorithm: this.getEncryptionAlgorithm(normalizedMode),
            isExcludedName: (value) => this.isExcludedName(value),
            filenameEncryption: this.currentConfig?.filenameEncryption,
            directoryNameEncryption: this.currentConfig?.directoryNameEncryption,
            isDirectory: options.isDirectory ?? false,
        });
    }
    decryptFileName(name, options = {}) {
        if (!name) return name;
        if (this.isExcludedName(name)) {
            return name;
        }
        const normalizedMode = this.normalizeCryptoMode(this.getCryptoMode());
        const keyBytes = this.getKeyBytes();
        // Fast-path: rclone with filename_encryption=off – return plain name (strip suffix if present).
        const cfgFileEnc = (this.currentConfig?.filenameEncryption || "").trim().toLowerCase();
        if (normalizedMode === CRYPTO_MODE_RCLONE && cfgFileEnc === "off") {
            return name.endsWith(".bin") ? name.slice(0, -4) : name;
        }
        try {
            return decryptModeFileName({
                mode: normalizedMode,
                name,
                keyBytes,
                encryptionAlgorithm: this.getEncryptionAlgorithm(normalizedMode),
                isExcludedName: (value) => this.isExcludedName(value),
                filenameEncryption: this.currentConfig?.filenameEncryption,
                directoryNameEncryption: this.currentConfig?.directoryNameEncryption,
                isDirectory: options.isDirectory ?? false,
            });
        } catch (err) {
            if (normalizedMode === CRYPTO_MODE_RCLONE && /not an obfusc/i.test(err?.message || "")) {
                // Name is already plain or not obfuscated; return as-is
                return name;
            }
            console.error(
                "[Crypto] decryptFileName failed",
                err?.message || err,
                {
                    mode: normalizedMode,
                    name,
                    filenameEncryption: this.currentConfig?.filenameEncryption,
                    directoryNameEncryption: this.currentConfig?.directoryNameEncryption,
                    isDirectory: options.isDirectory ?? false,
                }
            );
            throw err;
        }
    }
    createEncryptionContext({ file, mode, skipCrypto }) {
        void file;
        const normalizedMode = this.normalizeCryptoMode(mode);
        const encryptionAlgorithm = this.getEncryptionAlgorithm(normalizedMode);
        const keyBytes = skipCrypto ? null : this.getKeyBytes();
        return createModeEncryptionContext({
            mode: normalizedMode,
            skipCrypto,
            keyBytes,
            ivByteLength: this.ivByteLength,
            encryptionAlgorithm,
        });
    }
    createDecryptionContext({ meta, mode, skipCrypto }) {
        void meta;
        const normalizedMode = this.normalizeCryptoMode(mode);
        const encryptionAlgorithm = this.getEncryptionAlgorithm(normalizedMode);
        const keyBytes = skipCrypto ? null : this.getKeyBytes();
        return createModeDecryptionContext({
            mode: normalizedMode,
            skipCrypto,
            keyBytes,
            ivByteLength: this.ivByteLength,
            encryptionAlgorithm,
        });
    }
    createUploadSession(file) {
        const skipCrypto = file?.name ? this.isExcludedName(file.name) : false;
        const mode = this.normalizeCryptoMode(this.getCryptoMode());
        const hashAlgorithm = !skipCrypto && mode === CRYPTO_MODE_OWN ? this.getHashAlgorithm() : null;
        const hashContext = hashAlgorithm
            ? createModeHashContext({ mode, algorithm: hashAlgorithm })
            : null;
        const encryption = this.createEncryptionContext({ file, mode, skipCrypto });
        return {
            hash: hashContext,
            encryption,
            metadata: {},
            skipCrypto,
            mode,
            hashAlgorithm,
        };
    }
    createDownloadSession(meta) {
        const skipCrypto = meta?.name ? this.isExcludedName(meta.name) : false;
        const mode = this.normalizeCryptoMode(this.getCryptoMode());
        const hashAlgorithm = !skipCrypto && mode === CRYPTO_MODE_OWN ? this.getHashAlgorithm() : null;
        const hashContext = hashAlgorithm
            ? createModeHashContext({ mode, algorithm: hashAlgorithm })
            : null;
        const decryption = this.createDecryptionContext({ meta, mode, skipCrypto });
        if (mode === CRYPTO_MODE_RCLONE && decryption) {
            decryption.blockIndex = 0;
            decryption.cipherBuffer = new Uint8Array(0);
        }
        return {
            hash: hashContext,
            decryption,
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
    async listOnlyFolders(folderId, pageToken, search) {
        const res = await this.listFolder(folderId, pageToken, search);
        const onlyFolders = (res.files || []).filter(
            (it) => it?.mimeType === "application/vnd.google-apps.folder"
        );
        return { ...res, files: onlyFolders };
    }
    async createFolder(name, parentId) {
        await this.ensureConfigLoaded();
        const preparedName = this.encryptFileName(name, { isDirectory: true });
        const folder = await this.drive.createFolder(preparedName, parentId ?? "root");
        return this.decorateIncomingItem(folder);
    }
    async deleteFile(id) {
        await this.ensureConfigLoaded();
        return this.drive.deleteFile(id);
    }
    async renameFile(id, newName, options = {}) {
        await this.ensureConfigLoaded();
        const { encrypted = false, isDirectory = false } = options || {};
        const finalName = encrypted ? newName : this.encryptFileName(newName, { isDirectory });
        const res = await this.drive.renameFile(id, finalName);
        return this.decorateIncomingItem({ ...res, name: finalName, mimeType: options?.mimeType });
    }
    async moveFile(id, newParentId, oldParentId) {
        await this.ensureConfigLoaded();
        const res = await this.drive.moveFile(id, newParentId, oldParentId);
        return this.decorateIncomingItem(res);
    }
    async copyFile(id, name, newParentId) {
        await this.ensureConfigLoaded();
        const encryptedName = this.encryptFileName(name, { isDirectory: false });
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
        const isDir = item?.mimeType === "application/vnd.google-apps.folder";
        const plainName = this.decryptFileName(item.name, { isDirectory: isDir });
        if (this.isExcludedName(plainName)) {
            return null;
        }
        return {
            ...item,
            name: plainName,
            encryptedName: item.name,
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
    createDownloadCacheWriter(options = {}) {
        const { fileHandle } = options || {};
        if (fileHandle && typeof fileHandle.createWritable === "function") {
            let writerPromise = null;
            let closed = false;
            let writtenBytes = 0;
            const ensureWriter = () => {
                if (!writerPromise) {
                    writerPromise = fileHandle.createWritable();
                }
                return writerPromise;
            };
            const closeWriter = async () => {
                if (!writerPromise || closed) {
                    return null;
                }
                try {
                    const writer = await writerPromise;
                    if (writer?.close && !closed) {
                        await writer.close();
                        closed = true;
                    }
                    return writer;
                } catch (err) {
                    closed = true;
                    throw err;
                }
            };
            return {
                async write(chunk) {
                    if (!chunk || !chunk.byteLength) return;
                    const writer = await ensureWriter();
                    await writer.write(chunk);
                    writtenBytes += chunk.byteLength;
                },
                async finalize() {
                    if (!writerPromise) {
                        await ensureWriter();
                    }
                    await closeWriter();
                    return { blob: null, size: writtenBytes, savedToFile: true, cleanup: null };
                },
                async abort() {
                    if (!writerPromise || closed) return;
                    try {
                        const writer = await writerPromise;
                        if (writer?.abort) {
                            await writer.abort();
                        } else if (writer?.close) {
                            await writer.close();
                        }
                    } catch (err) {
                        console.warn("Failed to abort download writer", err);
                    } finally {
                        closed = true;
                    }
                },
            };
        }
        return this._createMemoryCacheWriter();
    }
    _createMemoryCacheWriter() {
        const chunks = [];
        return {
            async write(chunk) {
                if (!chunk || !chunk.byteLength) return;
                chunks.push(chunk.slice());
            },
            async finalize(type = "application/octet-stream") {
                const blob = chunks.length ? new Blob(chunks, { type }) : new Blob([], { type });
                return { blob, size: blob.size, savedToFile: false, cleanup: null };
            },
            async abort() {
                chunks.length = 0;
            },
        };
    }
    async prepareUpload({ file, parentId, mimeType, size, session }) {
        await this.ensureConfigLoaded();
        const uploadSession = session ?? this.createUploadSession(file);
        if (uploadSession.mode === CRYPTO_MODE_OWN) {
            uploadSession.hashAlgorithm = uploadSession.hashAlgorithm || this.getHashAlgorithm();
            if (!uploadSession.hash && uploadSession.hashAlgorithm) {
                uploadSession.hash = createModeHashContext({
                    mode: uploadSession.mode,
                    algorithm: uploadSession.hashAlgorithm,
                });
            }
        }
        const shouldSkipCrypto = uploadSession.skipCrypto;
        const usesStreaming = this.shouldUseStreamingCrypto(uploadSession);
        const requiresDigest = usesStreaming && uploadSession.mode === CRYPTO_MODE_OWN;
        const sourceSize = size ?? file.size;
        let finalSize = this.calculateUploadSize({
            size: sourceSize,
            mode: uploadSession.mode,
            skipCrypto: shouldSkipCrypto,
        });
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
            ? uploadSession.hash ?? createModeHashContext({ mode: uploadSession.mode, algorithm: hashAlgorithm })
            : null;
        if (requiresDigest && !uploadSession.hash && hashCtx) {
            uploadSession.hash = hashCtx;
        }
        const ivForUpload = usesStreaming
            ? ensureModeEncryptionIv({
                mode: uploadSession.mode,
                context: uploadSession.encryption,
                ivByteLength: this.ivByteLength,
            })
            : null;
        const baseUploadSize = this.calculateUploadSize({
            size: file.size,
            mode: uploadSession.mode,
            skipCrypto: uploadSession.skipCrypto,
        });
        let ivQueued = !usesStreaming || !ivForUpload;
        const totalBytes = baseUploadSize + (requiresDigest ? this.hashByteLength : 0);
        const bufferQueue = [];
        let bufferedBytes = 0;
        let nextPlannedStart = 0;
        let serverConfirmed = 0;
        let lastResponse = null;
        const normalizedParallel = Math.max(1, Number(parallel) || 1);
        const rcloneBlockSize = 64 * 1024;
        const effectiveBlockSize = uploadSession.mode === CRYPTO_MODE_RCLONE ? rcloneBlockSize : this.blockSize;
        const normalizedChunkSize = chunkSize && chunkSize > 0 ? chunkSize : effectiveBlockSize;
        const chunkStride = Math.max(effectiveBlockSize, normalizedChunkSize);
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
        for (let offset = 0; offset < file.size; offset += effectiveBlockSize) {
            if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError");
            const slice = file.slice(offset, Math.min(offset + effectiveBlockSize, file.size));
            const plainChunk = new Uint8Array(await slice.arrayBuffer());
            if (requiresDigest && hashCtx) {
                updateModeHash({
                    mode: uploadSession.mode,
                    hashContext: hashCtx,
                    chunk: plainChunk,
                });
            }
            const encryptedBlock = usesStreaming
                ? encryptModeBlock({
                    mode: uploadSession.mode,
                    context: uploadSession.encryption,
                    chunk: plainChunk,
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
        const finalEncryptedChunk = finalizeModeEncryption({
            mode: uploadSession.mode,
            context: uploadSession.encryption,
        });
        if (finalEncryptedChunk && finalEncryptedChunk.byteLength) {
            bufferQueue.push(finalEncryptedChunk);
            bufferedBytes += finalEncryptedChunk.byteLength;
        }
        let digest = null;
        if (requiresDigest) {
            digest = await finalizeModeHash({ mode: uploadSession.mode, hashContext: hashCtx });
            uploadSession.digest = digest;
            const encryptedDigest = digest
                ? encryptModeDigest({ mode: uploadSession.mode, digest })
                : null;
            if (encryptedDigest && encryptedDigest.byteLength) {
                bufferQueue.push(encryptedDigest);
                bufferedBytes += encryptedDigest.byteLength;
            }
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
    async uploadFile({ file, parentId, onProgress, signal, partConcurrency, chunkSize }) {
        const preparation = await this.prepareUpload({ file, parentId, mimeType: file.type, size: file.size });
        const { response } = await this.uploadFileChunks({
            uploadUrl: preparation.uploadUrl,
            file,
            session: preparation.session,
            onProgress,
            signal,
            parallel: partConcurrency,
            chunkSize,
        });
        return response;
    }
    async downloadInChunks(options = {}) {
        await this.ensureConfigLoaded();
        const normalizedOptions = options || {};
        const { session: providedSession, fileHandle, encryptedName, ...restOptions } = normalizedOptions;
        const metaForSession = {
            id: restOptions.id,
            name: encryptedName || restOptions.name,
            size: restOptions.size,
        };
        const session = providedSession ?? this.createDownloadSession(metaForSession);
        if (restOptions.name && this.isExcludedName(restOptions.name)) {
            session.skipCrypto = true;
        }
        if (session.mode === CRYPTO_MODE_OWN) {
            session.hashAlgorithm = session.hashAlgorithm || this.getHashAlgorithm();
            if (!session.hash && session.hashAlgorithm) {
                session.hash = createModeHashContext({
                    mode: session.mode,
                    algorithm: session.hashAlgorithm,
                });
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
            ? session.hash ?? createModeHashContext({ mode: session.mode, algorithm: hashAlgorithm })
            : null;
        if (requiresDigest && !session.hash && hashCtx) {
            session.hash = hashCtx;
        }
        const digestSize = requiresDigest ? this.hashByteLength : 0;
        // For rclone we still need to read the 32-byte header (magic + base nonce) up front.
        const ivSize =
            usesStreaming && session.mode === CRYPTO_MODE_RCLONE
                ? RCLONE_IV_BYTE_LENGTH
                : usesStreaming
                ? this.ivByteLength
                : 0;
        const cache = this.createDownloadCacheWriter({
            fileHandle,
            debugContext: {
                id: restOptions.id,
                name: restOptions.name || metaForSession.name,
                mode: session.mode,
            },
        });
        const digestBuffer = requiresDigest ? new Uint8Array(digestSize) : null;
        let digestOffset = 0;
        let totalBytes = 0;
        let ivBytesRead = 0;
        let result;
        try {
            result = await this.drive.downloadInChunks({
                ...restOptions,
                onChunk: async (encryptedChunk, meta) => {
                    const { offset, total } = meta;
                    totalBytes = total;
                    const contentSize = Math.max(0, total - digestSize - ivSize);
                    let absoluteOffset = offset;
                    let cursor = 0;
                    try {
                        const rcloneBlockPlain = 64 * 1024;
                        const rcloneBlockCipherMax = rcloneBlockPlain + 16;
                        const isRclone = session.mode === CRYPTO_MODE_RCLONE;
                        if (isRclone) {
                            if (typeof session.decryption.blockIndex !== "number") {
                                session.decryption.blockIndex = 0;
                            }
                            if (!session.decryption.cipherBuffer) {
                                session.decryption.cipherBuffer = new Uint8Array(0);
                            }
                            if (typeof session.decryption.cipherConsumed !== "number") {
                                session.decryption.cipherConsumed = 0;
                            }
                        }
                        const concatBuffers = (a, b) => {
                            if (!a || a.byteLength === 0) return b.slice();
                            if (!b || b.byteLength === 0) return a.slice();
                            const out = new Uint8Array(a.byteLength + b.byteLength);
                            out.set(a, 0);
                            out.set(b, a.byteLength);
                            return out;
                        };
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
                        if (isRclone) {
                            // Accumulate cipher data and process per-block (64KiB + 16 tag) as soon as available.
                            const incoming = encryptedChunk.subarray(cursor);
                            const buffered =
                                session.decryption.cipherBuffer && session.decryption.cipherBuffer.byteLength
                                    ? concatBuffers(session.decryption.cipherBuffer, incoming)
                                    : incoming.slice();
                            session.decryption.cipherBuffer = buffered;
                            cursor = encryptedChunk.byteLength; // consumed whole chunk into buffer
                            while (true) {
                                const consumed = session.decryption.cipherConsumed || 0;
                                const remainingCipher = contentSize - consumed;
                                if (remainingCipher <= 0) break;
                                const available = session.decryption.cipherBuffer.byteLength;
                                if (available <= 16) break;
                                const plainLen = Math.min(rcloneBlockPlain, Math.max(0, remainingCipher - 16));
                                const cipherLen = plainLen + 16;
                                if (plainLen <= 0 || available < cipherLen) break;
                                const blockIdx = session.decryption.blockIndex || 0;
                                const blockSlice = session.decryption.cipherBuffer.subarray(0, cipherLen);
                                const decryptedBlock = decryptModeBlock({
                                    mode: session.mode,
                                    context: session.decryption,
                                    chunk: blockSlice,
                                    offset: blockIdx * rcloneBlockPlain,
                                });
                                await cache.write(decryptedBlock.subarray(0, plainLen));
                                const prevDecoded = session.decryption.bytesDecrypted || 0;
                                const nextDecoded = prevDecoded + plainLen;
                                session.decryption.bytesDecrypted = nextDecoded;
                                session.decryption.blockIndex = blockIdx + 1;
                                session.decryption.cipherConsumed = consumed + cipherLen;
                                session.decryption.cipherBuffer =
                                    cipherLen === available
                                        ? new Uint8Array(0)
                                        : session.decryption.cipherBuffer.subarray(cipherLen).slice();
                                absoluteOffset += cipherLen;
                            }
                            continue;
                        }
                        const contentProgress = Math.max(0, absoluteOffset - ivSize);
                        if (requiresDigest && contentProgress >= contentSize) {
                            const digestSlice = encryptedChunk.subarray(cursor);
                            const remainingDigest = Math.max(0, digestSize - digestOffset);
                            const copySlice =
                                remainingDigest < digestSlice.length
                                    ? digestSlice.subarray(0, remainingDigest)
                                    : digestSlice;
                            if (copySlice.length > 0 && digestBuffer) {
                                digestBuffer.set(copySlice, digestOffset);
                                digestOffset += copySlice.length;
                            }
                            break;
                        }
                        const remainingContent = contentSize - contentProgress;
                        const blockLength = Math.min(
                            this.blockSize,
                            remainingContent,
                            encryptedChunk.byteLength - cursor
                        );
                        const blockSlice = encryptedChunk.subarray(cursor, cursor + blockLength);
                        const contentOffset = Math.max(0, absoluteOffset - ivSize);
                        const decryptedBlock = usesStreaming
                            ? decryptModeBlock({
                                  mode: session.mode,
                                  context: session.decryption,
                                  chunk: blockSlice,
                                  offset: contentOffset,
                              })
                            : blockSlice;
                        if (requiresDigest && hashCtx) {
                            updateModeHash({
                                mode: session.mode,
                                hashContext: hashCtx,
                                chunk: decryptedBlock,
                            });
                        }
                        await cache.write(decryptedBlock);
                        cursor += blockLength;
                        absoluteOffset += blockLength;
                    }
                    } catch (err) {
                        console.error("[DownloadChunk] decrypt failed", {
                            offset,
                            total,
                            absoluteOffset,
                            ivBytesRead,
                            ivSize,
                            digestOffset,
                            digestSize,
                            chunkLength: encryptedChunk?.byteLength,
                            mode: session.mode,
                        });
                        throw err;
                    }
                },
            });
        } catch (err) {
            if (cache?.abort) {
                await cache.abort().catch(() => {});
            }
            throw err;
        }
        if (session.decryption) {
            session.decryption.ivBytesRead = ivBytesRead;
        }
        // Flush pending rclone buffered block if any
        if (session.mode === CRYPTO_MODE_RCLONE && session.decryption?.cipherBuffer?.byteLength) {
            const pending = session.decryption.cipherBuffer;
            while (pending.byteLength >= 16) {
                const consumed = session.decryption.cipherConsumed || 0;
                const remainingCipher = contentSize - consumed;
                if (remainingCipher <= 0) break;
                const plainLen = Math.min(64 * 1024, Math.max(0, remainingCipher - 16));
                const cipherLen = plainLen + 16;
                if (plainLen <= 0 || pending.byteLength < cipherLen) break;
                const blockIdx = session.decryption.blockIndex || 0;
                const blockSlice = pending.subarray(0, cipherLen);
                const decryptedBlock = decryptModeBlock({
                    mode: session.mode,
                    context: session.decryption,
                    chunk: blockSlice,
                    offset: blockIdx * 64 * 1024,
                });
                if (decryptedBlock && decryptedBlock.byteLength) {
                    await cache.write(decryptedBlock.subarray(0, plainLen));
                    const prevDecoded = session.decryption.bytesDecrypted || 0;
                    const nextDecoded = prevDecoded + plainLen;
                    session.decryption.bytesDecrypted = nextDecoded;
                }
                session.decryption.blockIndex = blockIdx + 1;
                session.decryption.cipherConsumed = consumed + cipherLen;
                session.decryption.cipherBuffer =
                    cipherLen === pending.byteLength ? new Uint8Array(0) : pending.subarray(cipherLen).slice();
            }
        }
        let calculatedDigest = null;
        if (requiresDigest && digestBuffer && hashCtx) {
            const decryptedDigest = decryptModeDigest({ mode: session.mode, digest: digestBuffer });
            calculatedDigest = await finalizeModeHash({ mode: session.mode, hashContext: hashCtx });
            session.digest = calculatedDigest;
            const hasStoredDigest =
                decryptedDigest && decryptedDigest.byteLength && Array.from(decryptedDigest).some((b) => b !== 0);
            const hasCalcDigest =
                calculatedDigest && calculatedDigest.byteLength && Array.from(calculatedDigest).some((b) => b !== 0);
            if (hasStoredDigest && hasCalcDigest && !this.compareDigests(decryptedDigest, calculatedDigest)) {
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
        const finalDecryptedChunk = finalizeModeDecryption({
            mode: session.mode,
            context: session.decryption,
        });
        if (finalDecryptedChunk && finalDecryptedChunk.byteLength) {
            await cache.write(finalDecryptedChunk);
        }
        const finalized = await cache.finalize(restOptions.type || "application/octet-stream");
        const encryptedNameResolved = result?.encryptedName ?? restOptions.encryptedName ?? null;
        const decryptedFromCrypto =
            session.mode === CRYPTO_MODE_RCLONE && encryptedNameResolved
                ? this.decryptFileName(encryptedNameResolved)
                : null;
        const finalName = restOptions.name || decryptedFromCrypto || encryptedNameResolved || result?.name || "";
        return {
            blob: finalized?.blob ?? null,
            name: finalName,
            size: finalized?.size ?? 0,
            savedToFile: Boolean(finalized?.savedToFile),
            cleanup: finalized?.cleanup || null,
            asBlob: finalized?.asBlob || null,
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
