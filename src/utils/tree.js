// src/utils/tree.js
export function getRelativePath(file) {
    return file.webkitRelativePath && file.webkitRelativePath.length > 0 ? file.webkitRelativePath : file.name;
}

export function getSelectionRootFolderName(files) {
    const f = files.find((x) => x.webkitRelativePath);
    if (!f) return null;
    return f.webkitRelativePath.split("/")[0] || null;
}

export function stripRootFromPath(relativePath, rootName) {
    if (!rootName) return relativePath;
    const parts = relativePath.split("/");
    return parts[0] === rootName ? parts.slice(1).join("/") || "" : relativePath;
}

export function collectFolderPaths(files, rootName = null) {
    const folders = new Set();
    for (const f of files) {
        const rel = stripRootFromPath(getRelativePath(f), rootName);
        if (!rel) continue;
        const parts = rel.split("/").slice(0, -1);
        let curr = "";
        for (const p of parts) {
            curr = curr ? `${curr}/${p}` : p;
            folders.add(curr);
        }
    }
    return folders;
}

export async function ensureDriveFolders({ api, folderPaths, rootId }) {
    const map = new Map();
    const ordered = Array.from(folderPaths).sort((a, b) => a.split("/").length - b.split("/").length);
    for (const path of ordered) {
        const parts = path.split("/");
        const name = parts[parts.length - 1];
        const parentId = parts.length > 1 ? map.get(parts.slice(0, -1).join("/")) || rootId : rootId;
        const folder = await api.createFolder(name, parentId);
        map.set(path, folder.id);
    }
    return map;
}

export function resolveParentIdForFile(trimmedRelativePath, foldersMap, rootId) {
    const parts = trimmedRelativePath.split("/").slice(0, -1);
    if (!parts.length) return rootId;
    return foldersMap.get(parts.join("/")) || rootId;
}
