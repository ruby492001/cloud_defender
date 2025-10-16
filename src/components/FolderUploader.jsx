// src/components/FolderUploader.jsx
import React, { useEffect, useRef } from "react";
import {
    getRelativePath,
    getSelectionRootFolderName,
    stripRootFromPath,
    collectFolderPaths,
    ensureDriveFolders,
    resolveParentIdForFile,
} from "../utils/tree";
import { createDriveFolder } from "../api/drive";

export default function FolderUploader({ accessToken, uploadManager, className = "" }) {
    const inputRef = useRef(null);

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

    async function onChange(e) {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (!files.length) return;

        const rootName = getSelectionRootFolderName(files);
        if (!rootName) {
            alert("Unable to detect the root folder. Chromium requires the directory picker flag in Firefox.");
            return;
        }

        const root = await createDriveFolder({ accessToken, name: rootName, parentId: undefined });

        const folderPaths = collectFolderPaths(files, rootName);
        const subMap = await ensureDriveFolders({ accessToken, folderPaths, rootId: root.id });

        const groupId = uploadManager.createGroup({ type: "folder", name: rootName, total: files.length });

        const now = Date.now();
        const tasks = files.map((f, i) => {
            const rel = getRelativePath(f);
            const trimmed = stripRootFromPath(rel, rootName);
            const parentId = resolveParentIdForFile(trimmed, subMap, root.id);
            return {
                id: `${now}_${i}_${f.name}_${f.size}`,
                file: f,
                name: f.name,
                size: f.size,
                type: f.type || "application/octet-stream",
                parentId,
                groupId,
            };
        });

        uploadManager.addTasks(tasks);
    }

    const buttonClass = ["btn secondary", className].filter(Boolean).join(" ");

    return (
        <>
            <input ref={inputRef} type="file" style={{ display: "none" }} onChange={onChange} />
            <button type="button" className={buttonClass} onClick={openPicker}>
                Upload folder
            </button>
        </>
    );
}
