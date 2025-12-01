// src/components/FolderUploader.jsx
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
    getRelativePath,
    getSelectionRootFolderName,
    stripRootFromPath,
    collectFolderPaths,
    ensureDriveFolders,
    resolveParentIdForFile,
} from "../utils/tree";
import { useBusy } from "./BusyOverlay.jsx";
import { useDialog } from "../state/DialogProvider.jsx";

const FolderUploader = forwardRef(function FolderUploader(
    { api, uploadManager, className = "", showButton = true },
    ref,
) {
    const inputRef = useRef(null);
    const busy = useBusy();
    const { confirm } = useDialog();

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.setAttribute("directory", "");
        el.setAttribute("multiple", "");
        el.setAttribute("webkitdirectory", "");
        el.setAttribute("mozdirectory", "");
        el.setAttribute("allowdirs", "");
    }, []);

    const openPicker = () => inputRef.current?.click();

    useImperativeHandle(ref, () => ({
        open: openPicker,
    }));

    async function onChange(e) {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (!files.length) return;

        const rootName = getSelectionRootFolderName(files);
        if (!rootName) {
            await confirm({
                title: "Не удалось определить корень папки",
                message: "Браузер не вернул корневую папку. В Firefox нужно включить флаг directory picker.",
                confirmText: "Понятно",
                cancelText: "Закрыть",
            });
            return;
        }

        const stopBusy = busy.start?.("folder-upload") ?? (() => {});
        try {
            const root = await api.createFolder(rootName, undefined);

            const folderPaths = collectFolderPaths(files, rootName);
            const subMap = await ensureDriveFolders({ api, folderPaths, rootId: root.id });

            const groupId = uploadManager.createGroup({ type: "folder", name: rootName, total: files.length });

            const now = Date.now();
            files.forEach((f, i) => {
                const rel = getRelativePath(f);
                const trimmed = stripRootFromPath(rel, rootName);
                const parentId = resolveParentIdForFile(trimmed, subMap, root.id);
                uploadManager.addTasks([{
                    id: `${now}_${i}_${f.name}_${f.size}`,
                    file: f,
                    name: f.name,
                    size: f.size,
                    type: f.type || "application/octet-stream",
                    parentId,
                    groupId,
                }]);
            });
        } catch (err) {
            console.error(err);
            await confirm({
                title: "Ошибка загрузки папки",
                message: err?.message || "Failed to prepare folder upload",
                confirmText: "Закрыть",
                cancelText: "Отмена",
            });
        } finally {
            stopBusy();
        }
    }

    const buttonClass = ["btn secondary", className].filter(Boolean).join(" ");

    return (
        <>
            <input ref={inputRef} type="file" style={{ display: "none" }} onChange={onChange} />
            {showButton && (
                <button type="button" className={buttonClass} onClick={openPicker}>
                    Upload folder
                </button>
            )}
        </>
    );
});

export default FolderUploader;
