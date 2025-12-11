
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FileUploader from "./components/FileUploader";
import FolderUploader from "./components/FolderUploader";
import Toolbar from "./components/Toolbar.jsx";
import FileRow from "./components/FileRow.jsx";
import MoveCopyDialog from "./components/MoveCopyDialog.jsx";
import ContextMenu from "./components/ContextMenu.jsx";
import TransferTray from "./components/TransferTray.jsx";
import useUploadManager from "./logic/useUploadManager";
import useGlobalDrop from "./dnd/useGlobalDrop.jsx";
import DropHintOverlay from "./components/DropHintOverlay.jsx";
import { useDrive } from "./hooks/useDrive.js";
import { DownloadProvider, useDownload } from "./state/DownloadManager.jsx";
import { BusyProvider, useBusy } from "./components/BusyOverlay.jsx";
import { PasswordPromptProvider, usePasswordPrompt, clearPasswordCacheGlobal } from "./state/PasswordPromptProvider.jsx";
import { DialogProvider, useDialog } from "./state/DialogProvider.jsx";
import { CryptoSuite } from "./crypto/CryptoSuite.js";
import createCfbModule from "./crypto/wasm/cfb_wasm.js";
import AuthScreen from "./components/AuthScreen.jsx";
import AddStorageModal from "./components/AddStorageModal.jsx";
import StorageMenu from "./components/StorageMenu.jsx";
import StorageSelectModal from "./components/StorageSelectModal.jsx";
import { createStorage, fetchStorages, logout as logoutApi, refreshStorage, deleteStorage } from "./api/storages.js";
import { DriveApi } from "./api/drive.js";

const AUTH_STORAGE_KEY = "cloud-defender-auth";
const rootResolutionCache = new Map();

function AppContent({
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
    const [creatingStorage, setCreatingStorage] = useState(false);
    const handleStorageInitStart = useCallback(() => setCreatingStorage(true), []);
    const handleStorageInitFinish = useCallback(() => setCreatingStorage(false), []);

    const drive = useDrive(driveToken, {
        requestPassword: (opts) => requestPassword({ ...(opts || {}), storageId: activeStorageId }),
        onStorageInitStart: handleStorageInitStart,
        onStorageInitFinish: handleStorageInitFinish,
        refreshAccessToken: refreshDriveToken,
        baseFolderId,
        baseName,
        onUnauthorized: handleLogoutLocal,
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
        ? "Создаем шифрование"
        : !configReady || !dataLoaded
            ? "Инициализация"
            : "Подключаем хранилище";

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
                        title: "Переименовать",
                        message: "Введите новое имя",
                        defaultValue: item.name,
                        placeholder: "Новое имя",
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
                        title: "Новая папка",
                        message: "Введите название папки",
                        placeholder: "Имя папки",
                        confirmText: "Создать",
                    });
                    const trimmed = name?.trim();
                    if (!trimmed) return;
                    const stopBusy = busy.start?.("create-folder") ?? (() => {});
                    try {
                        await api.createFolder(trimmed, currentFolder);
                        await refresh();
                    } catch (err) {
                        await confirm({
                            title: "Ошибка",
                            message: err?.message || "Failed to create folder",
                            confirmText: "OK",
                            cancelText: "Закрыть",
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
                        base.push({ id: "open", label: "Open", onClick: () => onDouble(menu.item) });
                        if (menu.item.mimeType === "application/vnd.google-apps.folder") {
                            base.push({ id: "download-folder", label: "Download as zip", onClick: () => enqueue(menu.item) });
                        } else {
                            base.push({ id: "download-one", label: "Download", onClick: () => enqueue(menu.item) });
                        }
                        base.push({ id: "rename", label: "Rename", onClick: () => doRename(menu.item) });
                    }
                    base.push({
                        id: "move",
                        label: "Move",
                        onClick: () =>
                            setDialog({
                                open: true,
                                mode: "move",
                                targetIds: menu?.group ? [...selectedIds] : [(menu?.item?.id) || [...selectedIds][0]],
                            }),
                    });
                    base.push({
                        id: "copy",
                        label: "Copy",
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
                            label: "Download selected (zip)",
                            onClick: () => {
                                const sel = [...selectedIds].map((id) => items.find((x) => x.id === id)).filter(Boolean);
                                enqueueMany(sel);
                            },
                        });
                    } else if (menu?.item) {
                        base.push({ id: "download", label: "Download", onClick: () => enqueue(menu.item) });
                    }

                    base.push({
                        id: "delete",
                        label: "Delete",
                        danger: true,
                        onClick: async () => {
                            const ids = menu?.group ? [...selectedIds] : [menu?.item?.id];
                            const count = ids.length;
                            const ok = await confirm({
                                title: "Удаление",
                                message: count > 1 ? `Удалить ${count} объектов безвозвратно?` : `Удалить "${menu?.item?.name}"?`,
                                confirmText: "Удалить",
                                cancelText: "Отмена",
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
                                Create
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
                                        aria-label="Select all files"
                                    />
                                </div>

                                <div className="sort" style={{ fontWeight: 700 }} onClick={() => setSortBy("name")}>
                                    Name <span className="sort-arrow">{sortInd("name")}</span>
                                </div>
                                <div className="sort" style={{ fontWeight: 700 }} onClick={() => setSortBy("size")}>
                                    Size <span className="sort-arrow">{sortInd("size")}</span>
                                </div>
                                <div className="sort" style={{ fontWeight: 700 }} onClick={() => setSortBy("modifiedTime")}>
                                    Modified <span className="sort-arrow">{sortInd("modifiedTime")}</span>
                                </div>
                                <div></div>
                            </div>

                            {sortedItems.length === 0 && !loading && <div className="empty">Nothing here yet</div>}

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
                            {loading && <div className="empty">Loading...</div>}
                            {error && <div className="empty" style={{ color: "var(--danger)" }}>{error}</div>}
                        </div>

                        {createMenu && (
                            <ContextMenu
                                x={createMenu.x}
                                y={createMenu.y}
                                onClose={() => setCreateMenu(null)}
                                items={[
                                    { id: "create-folder", label: "Create folder", onClick: handleCreateFolder },
                                    { id: "upload-file", label: "Upload file", onClick: handleUploadFile },
                                    { id: "upload-folder", label: "Upload folder", onClick: handleUploadFolder },
                                ]}
                            />
                        )}

                        {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={buildMenu()} />}

                        <MoveCopyDialog
                            api={api}
                            open={dialog.open}
                            mode={dialog.mode}
                            startFolder={currentFolder}
                            startName={breadcrumb[breadcrumb.length - 1]?.name || "Текущая папка"}
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
                    <p className="eyebrow">Cloud Defender</p>
                    <h2 className="page-title">{storageName || "Хранилище"}</h2>
                    <p className="session-meta">
                        Подключены как <span className="session-user">{user?.login}</span>
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
                    />
                </div>
            </div>

            <DownloadProvider api={api}>
                <TransferTrayConnector uploadManager={uploadManager} />
                <AppShell uploadManager={uploadManager} {...drive} />
            </DownloadProvider>
        </div>
    );
}
async function ensureRootFolder(driveApi, rootPath) {
    const key = rootPath && rootPath.trim() ? rootPath.trim() : "/";
    if (rootResolutionCache.has(key)) return rootResolutionCache.get(key);
    const promise = (async () => {
        if (!rootPath || rootPath === "/") return "root";
        const parts = rootPath.split("/").map((p) => p.trim()).filter(Boolean);
        let parentId = "root";
        for (const part of parts) {
            const existing = await driveApi.findFileByName(part, parentId);
            if (existing) {
                parentId = existing.id;
            } else {
                const created = await driveApi.createFolder(part, parentId);
                parentId = created.id;
            }
        }
        return parentId;
    })().finally(() => {
        rootResolutionCache.delete(key);
    });
    rootResolutionCache.set(key, promise);
    return promise;
}

export default function App() {
    const [user, setUser] = useState(() => {
        try {
            const stored = localStorage.getItem(AUTH_STORAGE_KEY);
            return stored ? JSON.parse(stored) : null;
        } catch (e) {
            return null;
        }
    });
    const [storages, setStorages] = useState([]);
    const [activeStorageId, setActiveStorageId] = useState(null);
    const [driveToken, setDriveToken] = useState(null);
    const [baseFolderId, setBaseFolderId] = useState("root");
    const [baseName, setBaseName] = useState("Storage");
    const [rootReady, setRootReady] = useState(false);
    const [storageLoading, setStorageLoading] = useState(false);
    const [globalError, setGlobalError] = useState("");
    const [addModalOpen, setAddModalOpen] = useState(false);
    const [blockAddModal, setBlockAddModal] = useState(false);
    const [selectModalOpen, setSelectModalOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteBusy, setDeleteBusy] = useState(false);

    const persistUser = (u) => {
        try {
            if (u) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(u));
            else localStorage.removeItem(AUTH_STORAGE_KEY);
        } catch (e) {
            // ignore
        }
    };

    const clearSession = useCallback(() => {
        clearPasswordCacheGlobal();
        setUser(null);
        setStorages([]);
        setActiveStorageId(null);
        setDriveToken(null);
        setAddModalOpen(false);
        setBlockAddModal(false);
        setDeleteTarget(null);
        setDeleteBusy(false);
        setRootReady(false);
        persistUser(null);
    }, []);

    const handleLogout = useCallback(async () => {
        await logoutApi().catch(() => {});
        clearSession();
        try {
            window.location.reload();
        } catch (_) {
            // ignore reload errors
        }
    }, [clearSession]);
    const loadStorages = useCallback(async () => {
        if (!user) return;
        setGlobalError("");
        try {
            const data = await fetchStorages();
            const list = data.storages || [];
            setStorages(list);
            if (list.length === 0) {
                setAddModalOpen(true);
                setBlockAddModal(true);
                setActiveStorageId(null);
                setDriveToken(null);
                setRootReady(false);
            } else {
                setBlockAddModal(false);
                if (!activeStorageId || !list.find((s) => s.id === activeStorageId)) {
                    setActiveStorageId(null);
                    setDriveToken(null);
                    setRootReady(false);
                    setBaseFolderId("root");
                    setSelectModalOpen(true);
                }
            }
        } catch (e) {
            if (e?.status === 401) {
                clearSession();
            } else {
                setGlobalError(e?.message || "Не удалось загрузить хранилища");
            }
        }
    }, [user, clearSession, activeStorageId]);

    const refreshDriveToken = useCallback(async () => {
        if (!activeStorageId) return null;
        try {
            const updated = await refreshStorage(activeStorageId);
            setStorages((prev) => prev.map((s) => (s.id === activeStorageId ? updated : s)));
            setDriveToken(updated.access_token);
            return updated.access_token;
        } catch (e) {
            if (e?.status === 401) {
                clearSession();
            }
            throw e;
        }
    }, [activeStorageId, clearSession]);

    useEffect(() => {
        if (user) {
            loadStorages();
        }
    }, [user, loadStorages]);

    useEffect(() => {
        // switching storage: reset token until root resolved
        setDriveToken(null);
        setRootReady(false);
    }, [activeStorageId]);

    useEffect(() => {
        if (!activeStorageId) return;
        const storage = storages.find((s) => s.id === activeStorageId);
        if (!storage) return;
        setStorageLoading(true);
        setGlobalError("");
        (async () => {
            try {
                if (storage.resolvedRootId) {
                    setBaseFolderId(storage.resolvedRootId);
                    setBaseName(storage.name || "Storage");
                    setDriveToken(storage.access_token);
                    setRootReady(true);
                    return;
                }
                const driveApi = new DriveApi(storage.access_token, { refreshToken: refreshDriveToken, rootId: "root" });
                const rootId = await ensureRootFolder(driveApi, storage.root_path);
                setStorages((prev) => prev.map((s) => (s.id === storage.id ? { ...s, resolvedRootId: rootId } : s)));
                setBaseFolderId(rootId);
                setBaseName(storage.name || "Storage");
                setDriveToken(storage.access_token);
                setRootReady(true);
            } catch (e) {
                setGlobalError(e?.message || "Не удалось подготовить хранилище");
            } finally {
                setStorageLoading(false);
            }
        })();
    }, [activeStorageId, storages, refreshDriveToken]);

    const handleAuthenticated = (authResponse) => {
        setUser(authResponse);
        persistUser(authResponse);
    };

    const handleCreateStorage = async (payload) => {
        try {
            const created = await createStorage(payload);
            setStorages((prev) => [...prev, created]);
            setAddModalOpen(false);
            setBlockAddModal(false);
            setActiveStorageId(created.id);
            setDriveToken(null);
            setBaseName(created.name || "Storage");
            setBaseFolderId("root");
            setRootReady(false);
            return created;
        } catch (e) {
            if (e?.status === 401) {
                await handleLogout();
            }
            throw e;
        }
    };

    const handleDeleteStorage = async () => {
        if (!deleteTarget) return;
        setDeleteBusy(true);
        try {
            await deleteStorage(deleteTarget.id);
            setStorages((prev) => {
                const filtered = prev.filter((s) => s.id !== deleteTarget.id);
                const next = filtered[0];
                if (deleteTarget.id === activeStorageId) {
                    if (next) {
                        setActiveStorageId(next.id);
                        setDriveToken(next.access_token);
                    } else {
                        setActiveStorageId(null);
                        setDriveToken(null);
                        setAddModalOpen(true);
                        setBlockAddModal(true);
                    }
                }
                return filtered;
            });
            setDeleteTarget(null);
        } catch (e) {
            if (e?.status === 401) {
                await handleLogout();
            } else {
                setGlobalError(e?.message || "Не удалось удалить хранилище");
            }
        } finally {
            setDeleteBusy(false);
        }
    };

    const readyForDrive = Boolean(user && driveToken && rootReady);

    return (
        <PasswordPromptProvider>
            <DialogProvider>
                <BusyProvider>
                    {readyForDrive ? (
                        <AppContent
                            user={user}
                            storageName={baseName}
                            baseFolderId={baseFolderId}
                            baseName={baseName}
                            driveToken={driveToken}
                            refreshDriveToken={refreshDriveToken}
                            onLogout={handleLogout}
                            loadingStorage={storageLoading}
                            onAddStorage={() => setAddModalOpen(true)}
                            onDeleteStorage={(s) => setDeleteTarget(s)}
                            storages={storages}
                            activeStorageId={activeStorageId}
                            onSelectStorage={(id) => { setActiveStorageId(id); setDriveToken(null); setRootReady(false); setBaseFolderId("root"); }}
                        />
                    ) : user ? (
                        <div className="workspace-shell">
                            <StartupSpinner visible={storageLoading} message="Подключаемся..." />
                            <div className="session-bar">
                                <div>
                                    <p className="eyebrow">Cloud Defender</p>
                                    <h2 className="page-title">Хранилища</h2>
                                    <p className="session-meta">
                                        Подключены как <span className="session-user">{user?.login}</span>
                                    </p>
                                </div>
                            </div>
                            {globalError && <div className="alert" style={{ marginTop: 12 }}>{globalError}</div>}
                        </div>
                    ) : (
                        <AuthScreen onAuthenticated={handleAuthenticated} />
                    )}

                        <AddStorageModal
                            open={addModalOpen}
                            blocking={blockAddModal}
                            onClose={() => (!blockAddModal ? setAddModalOpen(false) : null)}
                            onCreate={handleCreateStorage}
                        />
                    <StorageSelectModal
                        open={selectModalOpen}
                        storages={storages}
                        onSelect={(id) => {
                            setActiveStorageId(id);
                            setDriveToken(null);
                            setRootReady(false);
                            setBaseFolderId("root");
                            setSelectModalOpen(false);
                        }}
                        onClose={() => setSelectModalOpen(false)}
                    />
                    {deleteTarget && (
                        <div className="modal confirm-modal" onClick={() => (!deleteBusy ? setDeleteTarget(null) : null)}>
                            <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                                <h3 style={{ marginTop: 0, marginBottom: 8 }}>Удалить хранилище</h3>
                                <p style={{ marginTop: 0, color: "var(--muted)" }}>
                                    Вы уверены, что хотите удалить "{deleteTarget.name}"?
                                </p>
                                <div className="confirm-actions">
                                    <button className="btn ghost" type="button" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                                        Отмена
                                    </button>
                                    <button className="btn primary" type="button" onClick={handleDeleteStorage} disabled={deleteBusy}>
                                        {deleteBusy ? "Удаляем..." : "Удалить"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </BusyProvider>
            </DialogProvider>
        </PasswordPromptProvider>
    );
}
function StartupSpinner({ visible, message }) {
    if (!visible) return null;
    return (
        <div style={startupSpinnerStyles.backdrop}>
            <div style={startupSpinnerStyles.card}>
                <div style={startupSpinnerStyles.loader} />
                <div style={startupSpinnerStyles.text}>{message}</div>
            </div>
        </div>
    );
}

const startupSpinnerStyles = {
    backdrop: {
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(6px)",
        display: "grid",
        placeItems: "center",
        zIndex: 6000,
    },
    card: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding: "32px 48px",
        borderRadius: 20,
        background: "rgba(15, 23, 42, 0.9)",
        border: "1px solid rgba(148, 163, 184, 0.3)",
        boxShadow: "0 25px 70px rgba(0,0,0,0.6)",
        minWidth: 260,
        color: "#e5e7eb",
        fontSize: 16,
    },
    loader: {
        width: 56,
        height: 56,
        borderRadius: "50%",
        border: "6px solid rgba(148, 163, 184, 0.2)",
        borderTopColor: "#3b82f6",
        animation: "busyspin 0.9s linear infinite",
    },
    text: {
        fontSize: 18,
        fontWeight: 500,
    },
};


