import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FileUploader from "../components/FileUploader";
import FolderUploader from "../components/FolderUploader";
import Toolbar from "../components/Toolbar.jsx";
import FileRow from "../components/FileRow.jsx";
import MoveCopyDialog from "../components/MoveCopyDialog.jsx";
import ContextMenu from "../components/ContextMenu.jsx";
import TransferTray from "../components/TransferTray.jsx";
import useUploadManager from "../logic/useUploadManager";
import useGlobalDrop from "../dnd/useGlobalDrop.jsx";
import DropHintOverlay from "../components/DropHintOverlay.jsx";
import { useDrive } from "../hooks/useDrive.js";
import { DownloadProvider, useDownload } from "../state/DownloadManager.jsx";
import { useBusy } from "../components/BusyOverlay.jsx";
import { usePasswordPrompt } from "../state/PasswordPromptProvider.jsx";
import { useDialog } from "../state/DialogProvider.jsx";
import { CryptoSuite } from "../crypto/CryptoSuite.js";
import createCfbModule from "../crypto/wasm/cfb_wasm.js";
import StorageMenu from "../components/StorageMenu.jsx";
import StartupSpinner from "../components/StartupSpinner.jsx";
import { changePassword, fetchDesktopClient } from "../api/auth.js";
import { t } from "../strings.js";

/**
 * Displays the Drive workspace: lists items, handles uploads/downloads, storage actions and dialogs.
 */
export default function AppContent({
    user,
    storageName,
    baseFolderId,
    baseName,
    driveToken,
    refreshDriveToken,
    onLogout,
    loadingStorage,
    onAddStorage,
    onDeleteStorage,
    storages,
    activeStorageId,
    onSelectStorage,
}) {
    const { requestPassword, clearPasswordCache, cancelPendingPrompt } = usePasswordPrompt();
    const handleLogoutLocal = useCallback(() => {
        clearPasswordCache?.();
        cancelPendingPrompt?.();
        onLogout?.();
    }, [clearPasswordCache, cancelPendingPrompt, onLogout]);
    const { prompt, confirm } = useDialog();
    const [rcloneModal, setRcloneModal] = useState({ open: false, data: null, loading: false, error: "" });
    const [pwdModal, setPwdModal] = useState({
        open: false,
        loading: false,
        error: "",
        current: "",
        next: "",
        confirm: "",
    });
    const [storagePwdModal, setStoragePwdModal] = useState({
        open: false,
        loading: false,
        error: "",
        current: "",
        next: "",
        confirm: "",
    });
    const [creatingStorage, setCreatingStorage] = useState(false);
    const handleStorageInitStart = useCallback(() => setCreatingStorage(true), []);
    const handleStorageInitFinish = useCallback(() => setCreatingStorage(false), []);

    const handleChangePassword = useCallback(() => {
        setPwdModal({ open: true, loading: false, error: "", current: "", next: "", confirm: "" });
    }, []);
    const handleChangeStoragePassword = useCallback(() => {
        setStoragePwdModal({ open: true, loading: false, error: "", current: "", next: "", confirm: "" });
    }, []);

    const handleExportRcloneKeys = useCallback(async () => {
        setRcloneModal({ open: true, data: null, loading: true, error: "" });
        try {
            const data = await fetchDesktopClient();
            setRcloneModal({ open: true, data, loading: false, error: "" });
        } catch (e) {
            setRcloneModal({
                open: true,
                data: null,
                loading: false,
                error: e?.message || t("rclone_error"),
            });
        }
    }, []);

    const drive = useDrive(driveToken, {
        requestPassword: (opts) => requestPassword({ ...(opts || {}), storageId: activeStorageId }),
        onStorageInitStart: handleStorageInitStart,
        onStorageInitFinish: handleStorageInitFinish,
        refreshAccessToken: refreshDriveToken,
        baseFolderId,
        baseName,
        onUnauthorized: handleLogoutLocal,
        storageId: activeStorageId,
    });
    const { api, loading: driveLoading, configReady } = drive;
    const initStarted = useRef(false);
    const [dataLoaded, setDataLoaded] = useState(false);

    useEffect(() => {
        if (initStarted.current) return;
        initStarted.current = true;

        CryptoSuite.registerSuite(
            "cfb",
            createCfbModule,
            (p) => (p.endsWith(".wasm") ? new URL("./crypto/wasm/cfb_wasm.wasm", import.meta.url).href : p)
        );
        (async () => {
            await CryptoSuite.ready("cfb");
        })();
    }, []);

    useEffect(() => {
        if (!configReady || dataLoaded) return;
        if (!driveLoading) {
            setDataLoaded(true);
        }
    }, [configReady, dataLoaded, driveLoading]);

    const showInitSpinner = creatingStorage || !configReady || !dataLoaded || loadingStorage || !driveToken;
    const spinnerMessage = creatingStorage
        ? t("connect_spinner_creating")
        : !configReady || !dataLoaded
            ? t("connect_spinner_init")
            : t("connect_spinner_loading");

    const uploadManager = useUploadManager({
        cryptoApi: api,
        chunkSize: 5 * 1024 * 1024,
        concurrency: 10,
        partConcurrency: 4,
    });

    useEffect(() => {
        if (baseFolderId) {
            uploadManager.setDefaultParentId(baseFolderId);
        }
    }, [uploadManager, baseFolderId]);

    const { isOver } = useGlobalDrop({ api, uploadManager });

    const TransferTrayConnector = useMemo(
        () =>
            function TransferTrayConnectorInner({ uploadManager }) {
                const download = useDownload();
                return (
                    <TransferTray
                        uploads={{
                            tasks: uploadManager.tasks,
                            groups: uploadManager.groups,
                            hidden: uploadManager.hidden,
                            allDone: uploadManager.allDone,
                            onCancelTask: uploadManager.cancelTask,
                            onRemoveTask: uploadManager.removeTask,
                            onCancelGroup: uploadManager.cancelGroup,
                            onRemoveGroup: uploadManager.removeGroup,
                            onClose: uploadManager.closePanel,
                            onUploadDone: (task) => scheduleRefreshIfSameFolder(task?.parentId),
                        }}
                        downloads={{
                            tasks: download.tasks,
                            visible: download.dockVisible,
                            onCancel: download.cancel,
                            onRemove: download.remove,
                            onClearFinished: download.clearFinished,
                            onHide: () => download.setDockVisible(false),
                        }}
                    />
                );
            },
        []
    );
    const AppShell = useMemo(
        () =>
            function AppShellInner({
                uploadManager,
                api,
                items,
                loading,
                error,
                currentFolder,
                nextPageToken,
                loadMore,
                openFolder,
                upTo,
                breadcrumb,
                refresh,
                sort,
                setSortBy,
            }) {
                const { enqueue, enqueueMany } = useDownload();
                const busy = useBusy();

                const [selectedIds, setSelectedIds] = useState(new Set());
                const [menu, setMenu] = useState(null); // {x,y,item?,group?}
                const [dialog, setDialog] = useState({ open: false, mode: null }); // move/copy
                const listRef = useRef(null);
                const sentinelRef = useRef(null);
                const fileUploadRef = useRef(null);
                const folderUploadRef = useRef(null);
                const [createMenu, setCreateMenu] = useState(null);
                const refreshPendingRef = useRef(false);
                const refreshTimerRef = useRef(null);
                const doneUploadsRef = useRef(new Set());

                useEffect(() => {
                    if (currentFolder) {
                        uploadManager.setDefaultParentId(currentFolder);
                    }
                    // сбрасываем трекинг завершённых задач при смене каталога
                    doneUploadsRef.current = new Set();
                }, [currentFolder, uploadManager]);

                useEffect(() => {
                    return () => {
                        if (refreshTimerRef.current) {
                            clearTimeout(refreshTimerRef.current);
                            refreshTimerRef.current = null;
                        }
                        refreshPendingRef.current = false;
                    };
                }, []);

                useEffect(() => {
                    const sentinel = sentinelRef.current;
                    if (!sentinel) return;
                    const io = new IntersectionObserver(
                        (entries) => {
                            for (const e of entries) {
                                if (e.isIntersecting && nextPageToken && !loading) {
                                    loadMore();
                                }
                            }
                        },
                        { root: listRef.current, rootMargin: "600px 0px" }
                    );
                    io.observe(sentinel);
                    return () => io.disconnect();
                }, [loadMore, loading, nextPageToken]);

                const toggleSelect = (checked, it) => {
                    setSelectedIds((prev) => {
                        const n = new Set(prev);
                        if (checked) n.add(it.id);
                        else n.delete(it.id);
                        return n;
                    });
                };
                const clearSelection = () => setSelectedIds(new Set());
                const allChecked = items.length > 0 && items.every((i) => selectedIds.has(i.id));
                const onToggleAll = (checked) => setSelectedIds(checked ? new Set(items.map((i) => i.id)) : new Set());

                const sortedItems = useMemo(() => {
                    const arr = [...items];
                    const dir = sort.dir === "asc" ? 1 : -1;
                    arr.sort((a, b) => {
                        if (sort.field === "name") {
                            const af = a.mimeType === "application/vnd.google-apps.folder";
                            const bf = b.mimeType === "application/vnd.google-apps.folder";
                            if (af !== bf) return -1 * dir;
                        }
                        let av, bv;
                        switch (sort.field) {
                            case "name":
                                av = a.name || "";
                                bv = b.name || "";
                                return av.localeCompare(bv, "ru", { sensitivity: "base" }) * dir;
                            case "size":
                                av = Number(a.size || 0);
                                bv = Number(b.size || 0);
                                return (av - bv) * dir;
                            case "modifiedTime":
                                av = new Date(a.modifiedTime || 0).getTime();
                                bv = new Date(b.modifiedTime || 0).getTime();
                                return (av - bv) * dir;
                            default:
                                return 0;
                        }
                    });
                    return arr;
                }, [items, sort]);

                const sortInd = (f) => (sort.field === f ? (sort.dir === "asc" ? "^" : "v") : "");

                const onDouble = (it) => {
                    if (it.mimeType === "application/vnd.google-apps.folder") openFolder(it);
                    else enqueue(it);
                };

                const scheduleRefreshIfSameFolder = (targetParentId) => {
                    if (!targetParentId || currentFolder !== targetParentId) return;
                    if (refreshPendingRef.current) return;
                    refreshPendingRef.current = true;
                    refreshTimerRef.current = setTimeout(() => {
                        refreshPendingRef.current = false;
                        refresh();
                    }, 300);
                };

                useEffect(() => {
                    uploadManager.tasks.forEach((task) => {
                        if (task.status === "done" && task.parentId && !doneUploadsRef.current.has(task.id)) {
                            doneUploadsRef.current.add(task.id);
                            scheduleRefreshIfSameFolder(task.parentId);
                        }
                    });
                }, [uploadManager.tasks]);

                const openMenuAt = (pt, item) => {
                    setCreateMenu(null);
                    setMenu({ x: pt.x, y: pt.y, item });
                };
                const openRowMenu = (e, item) => {
                    const pos = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
                    setCreateMenu(null);
                    setMenu({ x: pos.x, y: pos.y, item, fromContext: true });
                };
                const onListContext = (e) => {
                    if (selectedIds.size > 0) {
                        e.preventDefault();
                        setCreateMenu(null);
                        setMenu({ x: e.clientX + window.scrollX, y: e.clientY + window.scrollY, item: null, group: true });
                    }
                };
                const doRename = async (item) => {
                        const v = await prompt({
                            title: t("dialog_rename_title"),
                            message: t("dialog_rename_message"),
                            defaultValue: item.name,
                            placeholder: t("dialog_rename_placeholder"),
                        });
                    if (v && v.trim()) {
                        const trimmed = v.trim();
                        const shouldEncrypt = !(api.isExcludedName?.(trimmed));
                        const isDirectory = item.mimeType === "application/vnd.google-apps.folder";
                        await api.renameFile(item.id, trimmed, { encrypted: !shouldEncrypt, isDirectory, mimeType: item.mimeType });
                        await refresh();
                    }
                };
                const copyFolderRecursive = async (sourceFolderId, sourceName, destParentId) => {
                    const created = await api.createFolder(sourceName, destParentId);
                    const newFolderId = created.id;

                    let pageToken = undefined;
                    do {
                        const { files = [], nextPageToken } = await api.listFolder(sourceFolderId, pageToken);
                        for (const it of files) {
                            if (it.mimeType === "application/vnd.google-apps.folder") {
                                await copyFolderRecursive(it.id, it.name, newFolderId);
                            } else {
                                await api.copyFile(it.id, it.name, newFolderId);
                            }
                        }
                        pageToken = nextPageToken;
                    } while (pageToken);

                    return newFolderId;
                };

                const confirmMoveCopy = async (destId) => {
                    const ids = dialog.targetIds;
                    const stopBusy = busy.start?.(dialog.mode === "move" ? "move" : "copy") ?? (() => {});
                    try {
                        if (dialog.mode === "move") {
                            for (const id of ids) {
                                const it = items.find((x) => x.id === id);
                                const old = it?.parents?.[0];
                                await api.moveFile(id, destId, old);
                            }
                        } else if (dialog.mode === "copy") {
                            for (const id of ids) {
                                const it = items.find((x) => x.id === id);
                                if (!it) continue;
                                if (it.mimeType === "application/vnd.google-apps.folder") {
                                    await copyFolderRecursive(it.id, it.name, destId);
                                } else {
                                    await api.copyFile(it.id, it.name, destId);
                                }
                            }
                        }
                    } finally {
                        stopBusy();
                    }
                    clearSelection();
                    await refresh();
                    setDialog({ open: false, mode: null });
                };

                const toggleCreateMenu = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (createMenu) {
                        setCreateMenu(null);
                        return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenu(null);
                    setCreateMenu({
                        x: rect.left + window.scrollX,
                        y: rect.bottom + 6 + window.scrollY,
                    });
                };

                const handleCreateFolder = async () => {
                    const name = await prompt({
                        title: t("dialog_new_folder_title"),
                        message: t("dialog_new_folder_message"),
                        placeholder: t("dialog_new_folder_placeholder"),
                        confirmText: t("dialog_create"),
                    });
                    const trimmed = name?.trim();
                    if (!trimmed) return;
            const stopBusy = busy.start?.("create-folder") ?? (() => {});
            try {
                await api.createFolder(trimmed, currentFolder);
                await refresh();
            } catch (err) {
                await confirm({
                    title: t("dialog_error"),
                    message: err?.message || t("folder_create_error"),
                    confirmText: t("dialog_ok"),
                    cancelText: t("dialog_close"),
                });
            } finally {
                stopBusy();
                    }
                };

                const handleUploadFile = () => {
                    fileUploadRef.current?.open();
                };

                const handleUploadFolder = () => {
                    folderUploadRef.current?.open();
                };

                const buildMenu = () => {
                    const base = [];
                    if (menu?.item) {
                        if (menu.item.mimeType === "application/vnd.google-apps.folder") {
                            base.push({ id: "download-folder", label: t("menu_download_zip"), onClick: () => enqueue(menu.item) });
                        } else {
                            base.push({ id: "download-one", label: t("menu_download"), onClick: () => enqueue(menu.item) });
                        }
                        base.push({ id: "rename", label: t("menu_rename"), onClick: () => doRename(menu.item) });
                    }
                    base.push({
                        id: "move",
                        label: t("menu_move"),
                        onClick: () =>
                            setDialog({
                                open: true,
                                mode: "move",
                                targetIds: menu?.group ? [...selectedIds] : [(menu?.item?.id) || [...selectedIds][0]],
                            }),
                    });
                    base.push({
                        id: "copy",
                        label: t("menu_copy"),
                        onClick: () =>
                            setDialog({
                                open: true,
                                mode: "copy",
                                targetIds: menu?.group ? [...selectedIds] : [(menu?.item?.id) || [...selectedIds][0]],
                            }),
                    });

                    if (menu?.group) {
                        base.push({
                            id: "download-multi",
                            label: t("menu_download_selected"),
                            onClick: () => {
                                const sel = [...selectedIds].map((id) => items.find((x) => x.id === id)).filter(Boolean);
                                enqueueMany(sel);
                            },
                        });
                    } else if (menu?.item) {
                        base.push({ id: "download", label: t("menu_download"), onClick: () => enqueue(menu.item) });
                    }

                    base.push({
                        id: "delete",
                        label: t("dialog_delete"),
                        danger: true,
                        onClick: async () => {
                            const ids = menu?.group ? [...selectedIds] : [menu?.item?.id];
                            const count = ids.length;
                            const ok = await confirm({
                                title: t("dialog_delete_title"),
                                message:
                                    count > 1
                                        ? t("dialog_delete_many").replace(
                                              "{count}",
                                              String(count)
                                          )
                                        : t("dialog_delete_one").replace(
                                              "{name}",
                                              menu?.item?.name ?? ""
                                          ),
                                confirmText: t("dialog_delete"),
                                cancelText: t("dialog_cancel"),
                            });
                            if (!ok) return;
                            const stopBusy = busy.start?.("delete") ?? (() => {});
                            try {
                                for (const id of ids) {
                                    try {
                                        await api.deleteFile(id);
                                    } catch (err) {
                                        console.error(err);
                                    }
                                }
                                clearSelection();
                                await refresh();
                            } finally {
                                stopBusy();
                            }
                        },
                    });
                    return base;
                };
                return (
                    <div className="app">
                        <Toolbar onRefresh={refresh}>
                            <button className="btn primary" type="button" onClick={toggleCreateMenu}>
                                {t("dialog_create")}
                            </button>
                            <FileUploader
                                ref={fileUploadRef}
                                uploadManager={uploadManager}
                                parentId={currentFolder}
                                showButton={false}
                            />
                            <FolderUploader
                                ref={folderUploadRef}
                                api={api}
                                uploadManager={uploadManager}
                                showButton={false}
                            />
                        </Toolbar>

                        <div className="breadcrumb">
                            {breadcrumb.map((bc, i) => (
                                <span key={bc.id}>
                                    <a
                                        href="#"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            upTo(bc.id);
                                        }}
                                    >
                                        {bc.name}
                                    </a>
                                    {i < breadcrumb.length - 1 && <span style={{ color: "var(--muted)" }}> / </span>}
                                </span>
                            ))}
                        </div>

                        <div
                            ref={listRef}
                            className="list"
                            onContextMenu={onListContext}
                            onClick={() => {
                                setMenu(null);
                                setCreateMenu(null);
                            }}
                        >
                            <div className="row th">
                                <div>
                                    <input
                                        className="checkbox"
                                        type="checkbox"
                                        checked={allChecked}
                                        onChange={(e) => onToggleAll(e.target.checked)}
                                        aria-label={t("aria_select_all")}
                                    />
                                </div>

                                <div className="sort" style={{ fontWeight: 700 }} onClick={() => setSortBy("name")}>
                                    {t("table_name")} <span className="sort-arrow">{sortInd("name")}</span>
                                </div>
                                <div className="sort" style={{ fontWeight: 700 }} onClick={() => setSortBy("size")}>
                                    {t("table_size")} <span className="sort-arrow">{sortInd("size")}</span>
                                </div>
                                <div className="sort" style={{ fontWeight: 700 }} onClick={() => setSortBy("modifiedTime")}>
                                    {t("table_modified")} <span className="sort-arrow">{sortInd("modifiedTime")}</span>
                                </div>
                                <div></div>
                            </div>

                            {sortedItems.length === 0 && !loading && (
                                <div className="empty">{t("table_empty")}</div>
                            )}

                            {sortedItems.map((it) => (
                                <FileRow
                                    key={it.id}
                                    item={it}
                                    selected={selectedIds.has(it.id)}
                                    onSelect={toggleSelect}
                                    onDoubleClick={onDouble}
                                    onMenu={(pt) => openMenuAt(pt, it)}
                                    onContext={openRowMenu}
                                />
                            ))}

                            <div ref={sentinelRef} className="sentinel" />
                            {loading && <div className="empty">{t("table_loading")}</div>}
                            {error && <div className="empty" style={{ color: "var(--danger)" }}>{error}</div>}
                        </div>

                        {createMenu && (
                            <ContextMenu
                                x={createMenu.x}
                                y={createMenu.y}
                                onClose={() => setCreateMenu(null)}
                                items={[
                                    { id: "create-folder", label: t("action_create_folder"), onClick: handleCreateFolder },
                                    { id: "upload-file", label: t("action_upload_file"), onClick: handleUploadFile },
                                    { id: "upload-folder", label: t("action_upload_folder"), onClick: handleUploadFolder },
                                ]}
                            />
                        )}

                        {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={buildMenu()} />}

                    <MoveCopyDialog
                        api={api}
                        open={dialog.open}
                        mode={dialog.mode}
                        startFolder={currentFolder}
                        startName={breadcrumb[breadcrumb.length - 1]?.name || t("movecopy_current_folder")}
                        onClose={() => setDialog({ open: false, mode: null })}
                        onConfirm={confirmMoveCopy}
                    />
                    </div>
                );
            },
        []
    );

    return (
        <div className="workspace-shell">
            <StartupSpinner visible={showInitSpinner} message={spinnerMessage} />
            <DropHintOverlay visible={isOver} />

            <div className="session-bar">
                <div>
                    <p className="eyebrow">{t("app_title")}</p>
                    <h2 className="page-title">{storageName || t("storage_title")}</h2>
                    <p className="session-meta">
                        {t("connected_as")} <span className="session-user">{user?.login}</span>
                    </p>
                </div>
                <div className="session-actions">
                    <StorageMenu
                        user={user}
                        storages={storages}
                        activeId={activeStorageId}
                        onSelect={onSelectStorage}
                        onAdd={onAddStorage}
                        onLogout={onLogout}
                        onDelete={onDeleteStorage}
                        onChangePassword={handleChangePassword}
                        onChangeStoragePassword={handleChangeStoragePassword}
                        onExportRclone={handleExportRcloneKeys}
                    />
                </div>
            </div>

            <DownloadProvider api={api}>
                <TransferTrayConnector uploadManager={uploadManager} />
                <AppShell uploadManager={uploadManager} {...drive} />
            </DownloadProvider>

            {rcloneModal.open && (
                <div
                    className="modal confirm-modal"
                    onClick={() => setRcloneModal({ open: false, data: null, loading: false, error: "" })}
                >
                    <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ marginTop: 0, marginBottom: 8 }}>{t("rclone_keys_title")}</h3>
                        {rcloneModal.loading && <p style={{ color: "var(--muted)" }}>{t("rclone_keys_loading")}</p>}
                        {rcloneModal.error && <p style={{ color: "var(--danger)" }}>{rcloneModal.error}</p>}
                        {!rcloneModal.loading && !rcloneModal.error && (
                            <pre
                                style={{
                                    background: "#0b1120",
                                    border: "1px solid #1f2937",
                                    borderRadius: 10,
                                    padding: 12,
                                    maxHeight: 300,
                                    overflow: "auto",
                                    color: "var(--text)",
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-all",
                                }}
                            >
                                {JSON.stringify(rcloneModal.data || {}, null, 2)}
                            </pre>
                        )}
                        <div className="confirm-actions">
                            <button
                                className="btn primary"
                                type="button"
                                onClick={() => setRcloneModal({ open: false, data: null, loading: false, error: "" })}
                            >
                                {t("action_close")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {storagePwdModal.open && (
                <div
                    className="modal confirm-modal"
                    onClick={() =>
                        !storagePwdModal.loading
                            ? setStoragePwdModal({
                                  open: false,
                                  loading: false,
                                  error: "",
                                  current: "",
                                  next: "",
                                  confirm: "",
                              })
                            : null
                    }
                >
                    <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ marginTop: 0, marginBottom: 8 }}>{t("change_password_encryption_title")}</h3>
                        {storagePwdModal.error && <p style={{ color: "var(--danger)" }}>{storagePwdModal.error}</p>}
                        <div className="field">
                            <span>{t("field_current_password")}</span>
                            <input
                                className="input"
                                type="password"
                                value={storagePwdModal.current}
                                onChange={(e) => setStoragePwdModal((p) => ({ ...p, current: e.target.value }))}
                            />
                        </div>
                        <div className="field">
                            <span>{t("field_new_password")}</span>
                            <input
                                className="input"
                                type="password"
                                value={storagePwdModal.next}
                                onChange={(e) => setStoragePwdModal((p) => ({ ...p, next: e.target.value }))}
                            />
                        </div>
                        <div className="field">
                            <span>{t("field_confirm")}</span>
                            <input
                                className="input"
                                type="password"
                                value={storagePwdModal.confirm}
                                onChange={(e) => setStoragePwdModal((p) => ({ ...p, confirm: e.target.value }))}
                            />
                        </div>
                        <div className="confirm-actions">
                            <button
                                className="btn secondary"
                                type="button"
                                onClick={() =>
                                    setStoragePwdModal({
                                        open: false,
                                        loading: false,
                                        error: "",
                                        current: "",
                                        next: "",
                                        confirm: "",
                                    })
                                }
                                disabled={storagePwdModal.loading}
                            >
                                {t("action_cancel")}
                            </button>
                            <button
                                className="btn primary"
                                type="button"
                                disabled={storagePwdModal.loading}
                                onClick={async () => {
                                    const current = storagePwdModal.current.trim();
                                    const next = storagePwdModal.next.trim();
                                    const confirmPwd = storagePwdModal.confirm.trim();
                                    if (!current || !next || !confirmPwd) {
                                        setStoragePwdModal((p) => ({ ...p, error: t("error_fill_all") }));
                                        return;
                                    }
                                    if (next !== confirmPwd) {
                                        setStoragePwdModal((p) => ({ ...p, error: t("error_password_mismatch") }));
                                        return;
                                    }
                                    setStoragePwdModal((p) => ({ ...p, loading: true, error: "" }));
                                    try {
                                        await api.changeEncryptionPassword({
                                            currentPassword: current,
                                            newPassword: next,
                                        });
                                        setStoragePwdModal({
                                            open: false,
                                            loading: false,
                                            error: "",
                                            current: "",
                                            next: "",
                                            confirm: "",
                                        });
                                        await confirm({
                                            title: t("dialog_done_title"),
                                            message: t("encryption_password_changed_ok"),
                                            confirmText: t("dialog_ok"),
                                            cancelText: null,
                                        });
                                    } catch (e) {
                                        setStoragePwdModal((p) => ({
                                            ...p,
                                            loading: false,
                                            error: e?.message || t("change_password_encryption_title"),
                                        }));
                                    }
                                }}
                            >
                                {storagePwdModal.loading ? t("action_saving") : t("action_save")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {pwdModal.open && (
                <div
                    className="modal confirm-modal"
                    onClick={() =>
                        setPwdModal({ open: false, loading: false, error: "", current: "", next: "", confirm: "" })
                    }
                >
                    <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ marginTop: 0, marginBottom: 8 }}>{t("change_password_title")}</h3>
                        {pwdModal.error && <p style={{ color: "var(--danger)" }}>{pwdModal.error}</p>}
                        <div className="field">
                            <span>{t("field_current_password")}</span>
                            <input
                                className="input"
                                type="password"
                                value={pwdModal.current}
                                onChange={(e) => setPwdModal((p) => ({ ...p, current: e.target.value }))}
                            />
                        </div>
                        <div className="field">
                            <span>{t("field_new_password")}</span>
                            <input
                                className="input"
                                type="password"
                                value={pwdModal.next}
                                onChange={(e) => setPwdModal((p) => ({ ...p, next: e.target.value }))}
                            />
                        </div>
                        <div className="field">
                            <span>{t("field_confirm")}</span>
                            <input
                                className="input"
                                type="password"
                                value={pwdModal.confirm}
                                onChange={(e) => setPwdModal((p) => ({ ...p, confirm: e.target.value }))}
                            />
                        </div>
                        <div className="confirm-actions">
                            <button
                                className="btn secondary"
                                type="button"
                                onClick={() =>
                                    setPwdModal({ open: false, loading: false, error: "", current: "", next: "", confirm: "" })
                                }
                                disabled={pwdModal.loading}
                            >
                                {t("action_cancel")}
                            </button>
                            <button
                                className="btn primary"
                                type="button"
                                disabled={pwdModal.loading}
                                onClick={async () => {
                                    const current = pwdModal.current.trim();
                                    const next = pwdModal.next.trim();
                                    const confirmPwd = pwdModal.confirm.trim();
                                    if (!current || !next || !confirmPwd) {
                                        setPwdModal((p) => ({ ...p, error: t("error_fill_all") }));
                                        return;
                                    }
                                    if (next !== confirmPwd) {
                                        setPwdModal((p) => ({ ...p, error: t("error_password_mismatch") }));
                                        return;
                                    }
                                    setPwdModal((p) => ({ ...p, loading: true, error: "" }));
                                    try {
                                        await changePassword({ old_password: current, new_password: next });
                                        setPwdModal({ open: false, loading: false, error: "", current: "", next: "", confirm: "" });
                                        await confirm({
                                            title: t("dialog_done_title"),
                                            message: t("password_changed_ok"),
                                            confirmText: t("dialog_ok"),
                                            cancelText: null,
                                        });
                                    } catch (e) {
                                        setPwdModal((p) => ({
                                            ...p,
                                            loading: false,
                                            error: e?.message || t("change_password_title"),
                                        }));
                                    }
                                }}
                            >
                                {pwdModal.loading ? t("action_saving") : t("action_save")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}



