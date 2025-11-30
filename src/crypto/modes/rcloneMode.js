import nacl from "tweetnacl";
import AES from "aes-js";

const FILE_MAGIC = new TextEncoder().encode("RCLONE\u0000\u0000");
const FILE_NONCE_SIZE = 24;
const FILE_HEADER_SIZE = FILE_MAGIC.byteLength + FILE_NONCE_SIZE; // 32 bytes
const BLOCK_DATA_SIZE = 64 * 1024; // 64 KiB
const BLOCK_HEADER_SIZE = 16; // Poly1305 tag size
const ENCRYPTED_SUFFIX = ".bin";
// rclone uses base32hex (RFC 4648) without padding, case-insensitive.
const BASE32_HEX_ALPHABET = "0123456789abcdefghijklmnopqrstuv";
// Legacy alphabet we used earlier (RFC4648 base32, a-z2-7) to keep backward compatibility on read.
const BASE32_STD_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function randomBytes(length) {
    const out = new Uint8Array(length);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
        crypto.getRandomValues(out);
    } else {
        for (let i = 0; i < out.length; i += 1) {
            out[i] = Math.floor(Math.random() * 256);
        }
    }
    return out;
}

function base32Encode(bytes) {
    let bits = 0;
    let value = 0;
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) {
        value = (value << 8) | bytes[i];
        bits += 8;
        while (bits >= 5) {
            out += BASE32_HEX_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        out += BASE32_HEX_ALPHABET[(value << (5 - bits)) & 31];
    }
    return out;
}

function base32Decode(str) {
    const attemptBase32 = (alphabet) => {
        const clean = str.toLowerCase().replace(/=+$/, "");
        let bits = 0;
        let value = 0;
        const out = [];
        for (let i = 0; i < clean.length; i += 1) {
            const idx = alphabet.indexOf(clean[i]);
            if (idx === -1) return null;
            value = (value << 5) | idx;
            bits += 5;
            if (bits >= 8) {
                out.push((value >>> (bits - 8)) & 0xff);
                bits -= 8;
            }
        }
        return Uint8Array.from(out);
    };
    const attemptBase64 = () => {
        try {
            const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
            const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
            const b64 = normalized + pad;
            return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        } catch {
            return null;
        }
    };
    const hexDecoded = attemptBase32(BASE32_HEX_ALPHABET);
    if (hexDecoded) return hexDecoded;
    const legacyDecoded = attemptBase32(BASE32_STD_ALPHABET);
    if (legacyDecoded) return legacyDecoded;
    const b64Decoded = attemptBase64();
    if (b64Decoded) return b64Decoded;
    throw new Error("Invalid base32 character");
}

function pkcs7Pad(blockSize, data) {
    const pad = blockSize - (data.length % blockSize || blockSize);
    const out = new Uint8Array(data.length + pad);
    out.set(data, 0);
    out.fill(pad, data.length);
    return out;
}

function pkcs7Unpad(blockSize, data) {
    if (data.length === 0 || data.length % blockSize !== 0) {
        throw new Error("Invalid PKCS7 block length");
    }
    const pad = data[data.length - 1];
    if (pad === 0 || pad > blockSize) {
        throw new Error("Invalid PKCS7 padding");
    }
    for (let i = data.length - pad; i < data.length; i += 1) {
        if (data[i] !== pad) {
            throw new Error("Invalid PKCS7 padding");
        }
    }
    return data.subarray(0, data.length - pad);
}

function xorInto(out, a, b) {
    for (let i = 0; i < out.length; i += 1) {
        out[i] = a[i] ^ b[i];
    }
}

function multByTwo(out, input) {
    const tmp = new Uint8Array(16);
    tmp[0] = (input[0] << 1) & 0xff;
    if (input[15] & 0x80) tmp[0] ^= 0x87;
    for (let j = 1; j < 16; j += 1) {
        tmp[j] = (input[j] << 1) & 0xff;
        if (input[j - 1] & 0x80) {
            tmp[j] += 1;
        }
    }
    out.set(tmp);
}

function createAesCipher(keyBytes) {
    const aes = new AES.AES(keyBytes);
    return {
        encrypt(input, out) {
            const r = aes.encrypt(input);
            out.set(r);
        },
        decrypt(input, out) {
            const r = aes.decrypt(input);
            out.set(r);
        },
    };
}

function emeTransform(blockCipher, tweak, input, decrypt = false) {
    if (input.length % 16 !== 0 || input.length === 0) {
        throw new Error("EME requires data multiple of 16 bytes");
    }
    if (tweak.length !== 16) throw new Error("EME tweak must be 16 bytes");
    const m = input.length / 16;
    if (m > 16 * 8) throw new Error("EME input too large");

    const C = new Uint8Array(input.length);
    const LTable = [];
    const zero = new Uint8Array(16);
    const Li = new Uint8Array(16);
    blockCipher.encrypt(zero, Li);
    for (let i = 0; i < m; i += 1) {
        multByTwo(Li, Li);
        const l = new Uint8Array(16);
        l.set(Li);
        LTable.push(l);
    }

    const PPj = new Uint8Array(16);
    for (let j = 0; j < m; j += 1) {
        const Pj = input.subarray(j * 16, j * 16 + 16);
        xorInto(PPj, Pj, LTable[j]);
        const dest = C.subarray(j * 16, j * 16 + 16);
        if (decrypt) blockCipher.decrypt(PPj, dest);
        else blockCipher.encrypt(PPj, dest);
    }

    const MP = new Uint8Array(16);
    xorInto(MP, C.subarray(0, 16), tweak);
    for (let j = 1; j < m; j += 1) {
        xorInto(MP, MP, C.subarray(j * 16, j * 16 + 16));
    }

    const MC = new Uint8Array(16);
    if (decrypt) blockCipher.decrypt(MP, MC);
    else blockCipher.encrypt(MP, MC);

    const M = new Uint8Array(16);
    xorInto(M, MP, MC);
    const CCCj = new Uint8Array(16);
    for (let j = 1; j < m; j += 1) {
        multByTwo(M, M);
        xorInto(CCCj, C.subarray(j * 16, j * 16 + 16), M);
        C.set(CCCj, j * 16);
    }

    const CCC1 = new Uint8Array(16);
    xorInto(CCC1, MC, tweak);
    for (let j = 1; j < m; j += 1) {
        xorInto(CCC1, CCC1, C.subarray(j * 16, j * 16 + 16));
    }
    C.set(CCC1, 0);

    for (let j = 0; j < m; j += 1) {
        const block = C.subarray(j * 16, j * 16 + 16);
        if (decrypt) blockCipher.decrypt(block, block);
        else blockCipher.encrypt(block, block);
        xorInto(block, block, LTable[j]);
    }
    return C;
}

function addUint64ToNonce(baseNonce, add) {
    const out = new Uint8Array(baseNonce);
    let carry = add;
    for (let i = 0; i < 8; i += 1) {
        const sum = (out[i] || 0) + (carry & 0xff);
        out[i] = sum & 0xff;
        carry = (carry >>> 8) + (sum >> 8);
    }
    let idx = 8;
    while (carry > 0 && idx < out.length) {
        const sum = (out[idx] || 0) + (carry & 0xff);
        out[idx] = sum & 0xff;
        carry = (carry >>> 8) + (sum >> 8);
        idx += 1;
    }
    return out;
}

function getNonceForOffset(context, offset) {
    const blockIndex = Math.floor(offset / BLOCK_DATA_SIZE);
    return addUint64ToNonce(context.baseNonce, blockIndex);
}

export function createEncryptionContext({ keyBytes }) {
    if (!(keyBytes instanceof Uint8Array) || keyBytes.length < 80) {
        throw new Error("Rclone mode requires 80 bytes of key material");
    }
    const dataKey = keyBytes.subarray(0, 32);
    const nameKey = keyBytes.subarray(32, 64);
    const nameTweak = keyBytes.subarray(64, 80);
    const nonce = randomBytes(FILE_NONCE_SIZE);
    const header = new Uint8Array(FILE_HEADER_SIZE);
    header.set(FILE_MAGIC, 0);
    header.set(nonce, FILE_MAGIC.byteLength);
    return {
        dataKey,
        nameKey,
        nameTweak,
        baseNonce: nonce,
        iv: header,
        ivWritten: false,
    };
}

export function ensureEncryptionIv(context) {
    if (!context.iv || context.iv.byteLength !== FILE_HEADER_SIZE) {
        const header = new Uint8Array(FILE_HEADER_SIZE);
        header.set(FILE_MAGIC, 0);
        header.set(context.baseNonce, FILE_MAGIC.byteLength);
        context.iv = header;
        context.ivWritten = false;
    }
    return context.iv;
}

export function createDecryptionContext({ keyBytes, ivByteLength }) {
    if (!(keyBytes instanceof Uint8Array) || keyBytes.length < 80) {
        throw new Error("Rclone mode requires 80 bytes of key material");
    }
    return {
        dataKey: keyBytes.subarray(0, 32),
        nameKey: keyBytes.subarray(32, 64),
        nameTweak: keyBytes.subarray(64, 80),
        iv: new Uint8Array(ivByteLength),
        ivBytesRead: 0,
    };
}

export function encryptBlock(chunk, { context, offset = 0 }) {
    ensureEncryptionIv(context);
    const nonce = getNonceForOffset(context, offset);
    const boxed = nacl.secretbox(chunk, nonce, context.dataKey);
    return boxed;
}

export function decryptBlock(chunk, { context, offset = 0 }) {
    if (!context.baseNonce) {
        if (!context.iv || context.iv.byteLength < FILE_HEADER_SIZE) {
            throw new Error("Rclone mode requires IV header before decrypting content");
        }
        const magic = context.iv.subarray(0, FILE_MAGIC.byteLength);
        for (let i = 0; i < FILE_MAGIC.length; i += 1) {
            if (magic[i] !== FILE_MAGIC[i]) {
                throw new Error("Invalid rclone header magic");
            }
        }
        context.baseNonce = context.iv.subarray(FILE_MAGIC.byteLength, FILE_HEADER_SIZE).slice();
    }
    const blockIndex = Math.floor(offset / BLOCK_DATA_SIZE);
    const nonce = getNonceForOffset(context, offset);
    const plain = nacl.secretbox.open(chunk, nonce, context.dataKey);
    if (!plain) {
        const toHex = (arr, len = 8) =>
            Array.from(arr.slice(0, len))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
        console.error("[rcloneMode] secretbox auth failed", {
            offset,
            blockIndex,
            chunkLength: chunk?.length,
            baseNonce: toHex(context.baseNonce || new Uint8Array()),
            nonce: toHex(nonce),
        });
        throw new Error("Failed to authenticate decrypted block");
    }
    return plain;
}

export function finalizeEncryption() {
    return new Uint8Array(0);
}

export function finalizeDecryption() {
    return new Uint8Array(0);
}

export function calculateEncryptedSize({ originalSize }) {
    const size = Number.isFinite(originalSize) ? Number(originalSize) : 0;
    const blocks = size === 0 ? 0 : Math.ceil(size / BLOCK_DATA_SIZE);
    return FILE_HEADER_SIZE + blocks * BLOCK_HEADER_SIZE + size;
}

function getNameCipher(context) {
    if (!context.nameCipher) {
        context.nameCipher = createAesCipher(context.nameKey);
    }
    return context.nameCipher;
}

function encryptSegment(segment, context) {
    const padded = pkcs7Pad(16, new TextEncoder().encode(segment));
    const cipher = getNameCipher(context);
    const encrypted = emeTransform(cipher, context.nameTweak, padded, false);
    return base32Encode(encrypted);
}

function decryptSegment(segment, context) {
    const cipher = getNameCipher(context);
    const bytes = base32Decode(segment);
    const decrypted = emeTransform(cipher, context.nameTweak, bytes, true);
    const unpadded = pkcs7Unpad(16, decrypted);
    return new TextDecoder().decode(unpadded);
}

function isValidUtf8(str) {
    try {
        new TextEncoder().encode(str);
        return true;
    } catch {
        return false;
    }
}

function isValidRune(code) {
    try {
        const s = String.fromCodePoint(code);
        return isValidUtf8(s);
    } catch {
        return false;
    }
}

function obfuscateSegment(segment, context) {
    if (segment === "") return "";
    if (!isValidUtf8(segment)) return "!." + segment;
    let dir = 0;
    for (const ch of segment) dir += ch.codePointAt(0);
    dir %= 256;
    let result = `${dir}.`;
    for (let i = 0; i < context.nameKey.length; i += 1) dir += context.nameKey[i];
    for (const ch of segment) {
        const code = ch.codePointAt(0);
        switch (true) {
            case ch === "!":
                result += "!!";
                break;
            case code >= 0x30 && code <= 0x39: {
                const thisdir = (dir % 9) + 1;
                const newRune = 0x30 + ((code - 0x30 + thisdir) % 10);
                result += String.fromCharCode(newRune);
                break;
            }
            case (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a): {
                const thisdir = (dir % 25) + 1;
                let pos = code - 0x41;
                if (pos >= 26) pos -= 6;
                pos = (pos + thisdir) % 52;
                if (pos >= 26) pos += 6;
                result += String.fromCharCode(0x41 + pos);
                break;
            }
            case code >= 0xa0 && code <= 0xff: {
                const thisdir = (dir % 95) + 1;
                const newRune = 0xa0 + ((code - 0xa0 + thisdir) % 96);
                result += String.fromCharCode(newRune);
                break;
            }
            case code >= 0x100: {
                const thisdir = (dir % 127) + 1;
                const base = code - (code % 256);
                const newRune = base + ((code - base + thisdir) % 256);
                if (!isValidRune(newRune)) {
                    result += "!" + ch;
                } else {
                    result += String.fromCodePoint(newRune);
                }
                break;
            }
            default:
                result += ch;
        }
    }
    return result;
}

function deobfuscateSegment(segment, context) {
    if (segment === "") return "";
    const decodeWithDir = (raw, dirBase) => {
        let dir = dirBase;
        for (let i = 0; i < context.nameKey.length; i += 1) dir += context.nameKey[i];
        let result = "";
        let inQuote = false;
        for (const ch of raw) {
            const code = ch.codePointAt(0);
            switch (true) {
                case inQuote:
                    result += ch;
                    inQuote = false;
                    break;
                case ch === "!":
                    inQuote = true;
                    break;
                case code >= 0x30 && code <= 0x39: {
                    const thisdir = (dir % 9) + 1;
                    let newRune = code - thisdir;
                    while (newRune < 0x30) newRune += 10;
                    result += String.fromCharCode(newRune);
                    break;
                }
                case (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a): {
                    const thisdir = (dir % 25) + 1;
                    let pos = code - 0x41;
                    if (pos >= 26) pos -= 6;
                    pos -= thisdir;
                    while (pos < 0) pos += 52;
                    if (pos >= 26) pos += 6;
                    result += String.fromCharCode(0x41 + pos);
                    break;
                }
                case code >= 0xa0 && code <= 0xff: {
                    const thisdir = (dir % 95) + 1;
                    let newRune = code - thisdir;
                    while (newRune < 0xa0) newRune += 96;
                    result += String.fromCharCode(newRune);
                    break;
                }
                case code >= 0x100: {
                    const thisdir = (dir % 127) + 1;
                    const base = code - (code % 256);
                    let newRune = code - thisdir;
                    while (newRune < base) newRune += 256;
                    result += String.fromCodePoint(newRune);
                    break;
                }
                default:
                    result += ch;
            }
        }
        return result;
    };

    const dot = segment.indexOf(".");
    if (dot !== -1) {
        const num = segment.slice(0, dot);
        const rest = segment.slice(dot + 1);
        if (num === "!") return rest;
        const dirBase = parseInt(num, 10);
        if (!Number.isNaN(dirBase)) {
            return decodeWithDir(rest, dirBase);
        }
    }

    // Fallback: brute force rotation when prefix is missing
    let best = null;
    let bestScore = -1;
    let bestDir = -1;
    for (let dirCandidate = 0; dirCandidate < 256; dirCandidate += 1) {
        try {
            const decoded = decodeWithDir(segment, dirCandidate);
            let printable = 0;
            for (let i = 0; i < decoded.length; i += 1) {
                const c = decoded.charCodeAt(i);
                if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) printable += 1;
            }
            const score = decoded.length ? printable / decoded.length : 0;
            if (score > bestScore) {
                bestScore = score;
                best = decoded;
                bestDir = dirCandidate;
            }
        } catch {
            // ignore candidate errors
        }
    }
    if (best !== null) {
        return best;
    }
    console.error("[rcloneMode] deobfuscate failed", { segment });
    throw new Error("Not an obfuscated name");
}

export function encryptFileName(
    name,
    { keyBytes, filenameEncryption, directoryNameEncryption, isDirectory = false } = {}
) {
    if (!name) return name;
    const mode = (filenameEncryption || "standard").toLowerCase();
    if (mode === "off") {
        // In rclone, plaintext files get ".bin" suffix; directories remain untouched.
        return isDirectory ? name : name + ENCRYPTED_SUFFIX;
    }
    if (!(keyBytes instanceof Uint8Array) || keyBytes.length < 80) {
        throw new Error("Rclone mode requires 80 bytes of key material");
    }
    if (isDirectory && directoryNameEncryption === false) {
        return name;
    }
    const context = {
        nameKey: keyBytes.subarray(32, 64),
        nameTweak: keyBytes.subarray(64, 80),
    };
    const segments = name.split("/");
    const lastIdx = segments.length - 1;
    for (let i = 0; i < segments.length; i += 1) {
        if (directoryNameEncryption === false && (i !== lastIdx || isDirectory)) continue;
        segments[i] = mode === "obfuscate" ? obfuscateSegment(segments[i], context) : encryptSegment(segments[i], context);
    }
    return segments.join("/");
}

export function decryptFileName(
    name,
    { keyBytes, filenameEncryption, directoryNameEncryption, isDirectory = false } = {}
) {
    if (!name) return name;
    const mode = (filenameEncryption || "standard").toLowerCase();
    if (mode === "off") {
        return name.endsWith(ENCRYPTED_SUFFIX)
            ? name.slice(0, -ENCRYPTED_SUFFIX.length)
            : name;
    }
    if (!(keyBytes instanceof Uint8Array) || keyBytes.length < 80) {
        throw new Error("Rclone mode requires 80 bytes of key material");
    }
    if (isDirectory && directoryNameEncryption === false) {
        return name;
    }
    const looksBase32 = (seg) => /^[A-Z2-7]+=*$/i.test(seg);
    const context = {
        nameKey: keyBytes.subarray(32, 64),
        nameTweak: keyBytes.subarray(64, 80),
    };
    const segments = name.split("/");
    const lastIdx = segments.length - 1;
    for (let i = 0; i < segments.length; i += 1) {
        if (directoryNameEncryption === false && (i !== lastIdx || isDirectory)) continue;
        const originalSeg = segments[i];
        if (mode === "obfuscate") {
            segments[i] = deobfuscateSegment(originalSeg, context);
            continue;
        }
        // For "standard" names rclone appends ".bin" to encrypted names; strip before decoding.
        const hasSuffix = mode === "standard" && originalSeg.endsWith(ENCRYPTED_SUFFIX);
        const seg = hasSuffix ? originalSeg.slice(0, -ENCRYPTED_SUFFIX.length) : originalSeg;
        if (mode === "standard" && !looksBase32(seg)) {
            // Not an encrypted/encoded segment; return plain (restore suffix removal).
            segments[i] = hasSuffix ? seg : originalSeg;
            continue;
        }
        segments[i] = decryptSegment(seg, context);
    }
    return segments.join("/");
}
