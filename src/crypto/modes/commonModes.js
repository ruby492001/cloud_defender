export function encryptFileName(name, { isExcludedName } = {}) {
    if (typeof isExcludedName === "function" && isExcludedName(name)) return name;
    // TODO: apply deterministic filename encryption here.
    return name;
}

export function decryptFileName(name, { isExcludedName } = {}) {
    if (typeof isExcludedName === "function" && isExcludedName(name)) return name;
    // TODO: decode encrypted filename back to its original value.
    return name;
}
