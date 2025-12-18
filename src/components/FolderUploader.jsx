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
import { t } from "../strings.js";

const FolderUploader = forwardRef(function FolderUploader(
    { api, uploadManager, className = "", showButton = true },
    ref
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
                title: t("folder_uploader_title_unavailable"),
                message: t("folder_uploader_msg_unavailable"),
                confirmText: t("dialog_understood"),
                cancelText: t("dialog_close"),
            });
            return;
        }

        const stopBusy = busy.start?.("folder-upload") ?? (() => {});
        try {
            const targetParentId =
                uploadManager.getDefaultParentId?.() || api?.rootId || api?.drive?.rootId || "root";
            const root = await api.createFolder(rootName, targetParentId);

            const folderPaths = collectFolderPaths(files, rootName);
            const subMap = await ensureDriveFolders({ api, folderPaths, rootId: root.id });

            const groupId = uploadManager.createGroup({ type: "folder", name: rootName, total: files.length });

            const now = Date.now();
            files.forEach((f, i) => {
                const rel = getRelativePath(f);
                const trimmed = stripRootFromPath(rel, rootName);
                const parentId = resolveParentIdForFile(trimmed, subMap, root.id);
                uploadManager.addTasks([
                    {
                        id: `${now}_${i}_${f.name}_${f.size}`,
                        file: f,
                        name: f.name,
                        size: f.size,
                        type: f.type || "application/octet-stream",
                        parentId,
                        groupId,
                    },
                ]);
            });
        } catch (err) {
            console.error(err);
            await confirm({
                title: t("folder_uploader_title_failed"),
                message: err?.message || t("folder_uploader_title_failed"),
                confirmText: t("folder_uploader_close"),
                cancelText: t("folder_uploader_cancel"),
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
                    {t("folder_uploader_button")}
                </button>
            )}
        </>
    );
});

export default FolderUploader;
