// src/dnd/useGlobalDrop.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    collectFolderPaths,
    ensureDriveFolders,
    resolveParentIdForFile,
    stripRootFromPath,
} from "../utils/tree";

/**
 * Sets up global drag-and-drop listeners and funnels dropped files/folders into the upload manager.
 */
export default function useGlobalDrop({ api, uploadManager }) {
    const [isOver, setIsOver] = useState(false);
    const dragDepthRef = useRef(0);

    const hasWebkitEntries = useMemo(() => {
        try {
            const dt = new DataTransfer();
            return typeof dt.items?.add === "function";
        } catch {
            return false;
        }
    }, []);

    const prevent = useCallback((e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
    }, []);

    const onDragEnter = useCallback((e) => {
        prevent(e);
        dragDepthRef.current += 1;
        setIsOver(true);
    }, [prevent]);

    const onDragOver = useCallback((e) => {
        prevent(e);
    }, [prevent]);

    const onDragLeave = useCallback((e) => {
        prevent(e);
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsOver(false);
    }, [prevent]);

    const onDrop = useCallback(async (e) => {
        prevent(e);
        dragDepthRef.current = 0;
        setIsOver(false);

        const dt = e.dataTransfer;
        if (!dt) return;

        if (dt.items && typeof dt.items[0]?.webkitGetAsEntry === "function" && hasWebkitEntries) {
            const entries = [];
            for (let i = 0; i < dt.items.length; i++) {
                const entry = dt.items[i].webkitGetAsEntry?.();
                if (entry) entries.push(entry);
            }
            const items = await gatherFromWebkitEntries(entries);
            await handleCollectedEntries(items, { api, uploadManager });
            return;
        }

        const files = Array.from(dt.files ?? []).map((f) => ({ file: f, relPath: f.name }));
        await handleCollectedEntries(files, { api, uploadManager });
    }, [prevent, api, uploadManager, hasWebkitEntries]);

    useEffect(() => {
        const w = window;
        const d = document;

        w.addEventListener("dragenter", onDragEnter, { passive: false, capture: true });
        w.addEventListener("dragover", onDragOver, { passive: false, capture: true });
        w.addEventListener("dragleave", onDragLeave, { passive: false, capture: true });
        w.addEventListener("drop", onDrop, { passive: false, capture: true });

        d.addEventListener("dragover", prevent, { passive: false, capture: true });
        d.addEventListener("drop", prevent, { passive: false, capture: true });

        return () => {
            w.removeEventListener("dragenter", onDragEnter, { capture: true });
            w.removeEventListener("dragover", onDragOver, { capture: true });
            w.removeEventListener("dragleave", onDragLeave, { capture: true });
            w.removeEventListener("drop", onDrop, { capture: true });

            d.removeEventListener("dragover", prevent, { capture: true });
            d.removeEventListener("drop", prevent, { capture: true });
        };
    }, [onDragEnter, onDragOver, onDragLeave, onDrop, prevent]);

    return { isOver };
}

async function gatherFromWebkitEntries(entries) {
    const out = [];

    async function readAllDirectoryEntries(dirReader) {
        const all = [];
        let batch;
        do {
            batch = await new Promise((res, rej) => dirReader.readEntries(res, rej));
            all.push(...batch);
        } while (batch.length > 0);
        return all;
    }

    async function walkEntry(entry, parentPath = "") {
        if (entry.isFile) {
            const file = await new Promise((res, rej) => entry.file(res, rej));
            const relPath = parentPath ? `${parentPath}/${file.name}` : file.name;
            out.push({ file, relPath });
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const children = await readAllDirectoryEntries(reader);
            for (const child of children) {
                await walkEntry(child, parentPath ? `${parentPath}/${entry.name}` : entry.name);
            }
        }
    }

    for (const e of entries) {
        await walkEntry(e, "");
    }
    return out;
}

async function handleCollectedEntries(items, { api, uploadManager }) {
    if (!items.length) return;

    const singles = [];
    const byRoot = new Map();

    for (const it of items) {
        const [first, ...rest] = it.relPath.split("/");
        if (!rest.length) {
            singles.push(it.file);
        } else {
            const arr = byRoot.get(first) || [];
            arr.push(it);
            byRoot.set(first, arr);
        }
    }

    const defaultParentId =
        uploadManager.getDefaultParentId?.() || api?.rootId || api?.drive?.rootId || "root";

    if (singles.length) {
        const now = Date.now();
        singles.forEach((f, i) => {
            uploadManager.addTasks([
                {
                    id: `${now}_${i}_${f.name}_${f.size}`,
                    file: f,
                    name: f.name,
                    size: f.size,
                    type: f.type || "application/octet-stream",
                    parentId: defaultParentId,
                },
            ]);
        });
    }

    for (const [rootName, list] of byRoot.entries()) {
        const root = await api.createFolder(rootName, defaultParentId);
        const pseudoList = list.map(({ relPath }) => ({ webkitRelativePath: relPath }));
        const folderPaths = collectFolderPaths(pseudoList, rootName);
        const subMap = await ensureDriveFolders({ api, folderPaths, rootId: root.id });

        const groupId = uploadManager.createGroup({ type: "folder", name: rootName, total: list.length });
        const now = Date.now();

        list.forEach(({ file, relPath }, i) => {
            const trimmed = stripRootFromPath(relPath, rootName);
            const parentId = resolveParentIdForFile(trimmed, subMap, root.id);
            uploadManager.addTasks([
                {
                    id: `${now}_${i}_${file.name}_${file.size}`,
                    file,
                    name: file.name,
                    size: file.size,
                    type: file.type || "application/octet-stream",
                    parentId,
                    groupId,
                },
            ]);
        });
    }
}
