// src/dnd/useGlobalDrop.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDriveFolder } from "../api/drive";
import {
    collectFolderPaths,
    ensureDriveFolders,
    resolveParentIdForFile,
    stripRootFromPath,
} from "../utils/tree";

/**
 * Глобальный drag & drop: файлы + папки, без видимого дроп-зоны.
 * Работает на всех DOM-участках страницы.
 * - Chromium: рекурсивно обходим папки через webkitGetAsEntry().
 * - Fallback: используем dataTransfer.files (структуру папок в FF сохранить нельзя).
 *
 * Возвращает { isOver } для опциональной подсказки.
 */
export default function useGlobalDrop({ accessToken, uploadManager }) {
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
        // Разрешаем дроп в любом месте
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
        // можно добавить эффекты курсора
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

        // 1) Chromium путь: webkitGetAsEntry
        if (dt.items && typeof dt.items[0]?.webkitGetAsEntry === "function") {
            const entries = [];
            for (let i = 0; i < dt.items.length; i++) {
                const entry = dt.items[i].webkitGetAsEntry?.();
                if (entry) entries.push(entry);
            }
            const items = await gatherFromWebkitEntries(entries); // [{file, relPath}]
            await handleCollectedEntries(items, { accessToken, uploadManager });
            return;
        }

        // 2) Fallback: просто файлы (структуры нет)
        const files = Array.from(dt.files ?? []).map((f) => ({ file: f, relPath: f.name }));
        await handleCollectedEntries(files, { accessToken, uploadManager });
    }, [prevent, accessToken, uploadManager]);

    useEffect(() => {
        // Слушатели на весь документ/окно
        const w = window;
        const d = document;

        w.addEventListener("dragenter", onDragEnter, { passive: false, capture: true });
        w.addEventListener("dragover", onDragOver, { passive: false, capture: true });
        w.addEventListener("dragleave", onDragLeave, { passive: false, capture: true });
        w.addEventListener("drop", onDrop, { passive: false, capture: true });

        // Блокируем дефолт браузера (например, открытие файла вместо страницы)
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

/* ───────────────────────── helpers ───────────────────────── */

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

async function handleCollectedEntries(items, { accessToken, uploadManager }) {
    if (!items.length) return;

    // singles = файлы в корне, byRoot — сгруппированные по первому сегменту (папки)
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

    // 1) Одиночные — в корень
    if (singles.length) {
        const now = Date.now();
        const tasks = singles.map((f, i) => ({
            id: `${now}_${i}_${f.name}_${f.size}`,
            file: f,
            name: f.name,
            size: f.size,
            type: f.type || "application/octet-stream",
            parentId: undefined,
        }));
        uploadManager.addTasks(tasks);
    }

    // 2) Папки — для каждого корня созд. структуру на Диске и группу
    for (const [rootName, list] of byRoot.entries()) {
        const root = await createDriveFolder({ accessToken, name: rootName, parentId: undefined });

        const pseudoList = list.map(({ relPath }) => ({ webkitRelativePath: relPath }));
        const folderPaths = collectFolderPaths(pseudoList, rootName);
        const subMap = await ensureDriveFolders({ accessToken, folderPaths, rootId: root.id });

        const groupId = uploadManager.createGroup({ type: "folder", name: rootName, total: list.length });

        const now = Date.now();
        const tasks = list.map(({ file, relPath }, i) => {
            const trimmed = stripRootFromPath(relPath, rootName);
            const parentId = resolveParentIdForFile(trimmed, subMap, root.id);
            return {
                id: `${now}_${i}_${file.name}_${file.size}`,
                file,
                name: file.name,
                size: file.size,
                type: file.type || "application/octet-stream",
                parentId,
                groupId,
            };
        });

        uploadManager.addTasks(tasks);
    }
}
