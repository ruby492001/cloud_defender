const HEX_REGEX = /^[0-9a-fA-F]+$/;

export function hexToBytes(hexString) {
    if (typeof hexString !== "string") {
        throw new TypeError("hexToBytes expects a string input");
    }
    const normalized = hexString.replace(/\s+/g, "").toLowerCase();
    if (normalized.length === 0) {
        return new Uint8Array(0);
    }
    if (normalized.length % 2 !== 0 || !HEX_REGEX.test(normalized)) {
        throw new Error("Invalid HEX string");
    }
    const out = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

export function bytesToHex(bytes) {
    if (!(bytes instanceof Uint8Array)) {
        throw new TypeError("bytesToHex expects Uint8Array input");
    }
    let hex = "";
    for (let i = 0; i < bytes.length; i += 1) {
        const byte = bytes[i];
        const str = byte.toString(16).padStart(2, "0");
        hex += str;
    }
    return hex;
}

export function concatBytes(...parts) {
    const filtered = parts.filter((part) => part instanceof Uint8Array && part.length > 0);
    if (filtered.length === 0) {
        return new Uint8Array(0);
    }
    const total = filtered.reduce((sum, arr) => sum + arr.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of filtered) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

export function utf8ToBytes(text) {
    if (typeof text !== "string") {
        throw new TypeError("utf8ToBytes expects a string input");
    }
    return new TextEncoder().encode(text);
}

export function bytesToUtf8(bytes) {
    if (!(bytes instanceof Uint8Array)) {
        throw new TypeError("bytesToUtf8 expects Uint8Array input");
    }
    return new TextDecoder().decode(bytes);
}
