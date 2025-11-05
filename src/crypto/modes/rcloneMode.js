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

function xorTransform(chunk, keyBytes, ivBytes, offset = 0) {
    const keyLen = keyBytes.length || 1;
    const ivLen = ivBytes.length || 1;
    const out = new Uint8Array(chunk.byteLength);
    for (let i = 0; i < chunk.byteLength; i += 1) {
        const keyByte = keyBytes[(offset + i) % keyLen];
        const ivByte = ivBytes[(offset + i) % ivLen];
        out[i] = chunk[i] ^ keyByte ^ ivByte;
    }
    return out;
}

export function createEncryptionContext({ keyBytes, ivByteLength, encryptionAlgorithm }) {
    void encryptionAlgorithm;
    return {
        key: keyBytes,
        iv: generateIv(ivByteLength),
        ivWritten: false,
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
    void encryptionAlgorithm;
    return {
        key: keyBytes,
        iv: new Uint8Array(ivByteLength),
        ivBytesRead: 0,
    };
}

export function encryptBlock(chunk, { context, offset = 0, ivByteLength }) {
    const iv = ensureEncryptionIv(context, ivByteLength);
    return xorTransform(chunk, context.key, iv, offset);
}

export function decryptBlock(chunk, { context, offset = 0 }) {
    if (!context.iv || context.iv.byteLength === 0) {
        throw new Error("Rclone mode requires IV before decrypting content");
    }
    return xorTransform(chunk, context.key, context.iv, offset);
}

export function finalizeEncryption(context) {
    void context;
    return new Uint8Array(0);
}

export function finalizeDecryption(context) {
    void context;
    return new Uint8Array(0);
}

export function calculateEncryptedSize({ originalSize }) {
    const size = Number.isFinite(originalSize) ? Number(originalSize) : 0;
    return size;
}

export function encryptFileName(name, { keyBytes, encryptionAlgorithm, mode } = {}) {
    void keyBytes;
    void encryptionAlgorithm;
    void mode;
    return name;
}

export function decryptFileName(name, { keyBytes, encryptionAlgorithm, mode } = {}) {
    void keyBytes;
    void encryptionAlgorithm;
    void mode;
    return name;
}
