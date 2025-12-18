import { useCallback, useEffect, useState } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import AuthScreen from "./components/AuthScreen.jsx";
import AddStorageModal from "./components/AddStorageModal.jsx";
import StorageMenu from "./components/StorageMenu.jsx";
import StorageSelectModal from "./components/StorageSelectModal.jsx";
import StartupSpinner from "./components/StartupSpinner.jsx";
import AppContent from "./app/AppContent.jsx";
import { PasswordPromptProvider, clearPasswordCacheGlobal } from "./state/PasswordPromptProvider.jsx";
import { DialogProvider } from "./state/DialogProvider.jsx";
import { BusyProvider } from "./components/BusyOverlay.jsx";
import { createStorage, fetchStorages, logout as logoutApi, refreshStorage, deleteStorage } from "./api/storages.js";
import { fetchClientId } from "./api/auth.js";
import { DriveApi } from "./api/drive.js";
import { t } from "./strings.js";

const AUTH_STORAGE_KEY = "cloud-defender-auth";
const rootResolutionCache = new Map();

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
    const [baseName, setBaseName] = useState(t("default_storage_name"));
    const [rootReady, setRootReady] = useState(false);
    const [storageLoading, setStorageLoading] = useState(false);
    const [globalError, setGlobalError] = useState("");
    const [addModalOpen, setAddModalOpen] = useState(false);
    const [blockAddModal, setBlockAddModal] = useState(false);
    const [selectModalOpen, setSelectModalOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [clientId, setClientId] = useState("");
    const [clientIdError, setClientIdError] = useState("");
    const [clientIdLoading, setClientIdLoading] = useState(false);

    const persistUser = (u) => {
        try {
            if (u) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(u));
            else localStorage.removeItem(AUTH_STORAGE_KEY);
        } catch (e) {
            // ignore
        }
    };
    const handleSelectStorage = useCallback(
        (id) => {
            if (!id) return;
            if (id === activeStorageId) return;
            setActiveStorageId(id);
            setDriveToken(null);
            setRootReady(false);
            setBaseFolderId("root");
        },
        [activeStorageId]
    );

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
                setGlobalError(e?.message || t("storages_error_load"));
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
                    setBaseName(storage.name || t("default_storage_name"));
                    setDriveToken(storage.access_token);
                    setRootReady(true);
                    return;
                }
                const driveApi = new DriveApi(storage.access_token, { refreshToken: refreshDriveToken, rootId: "root" });
                const rootId = await ensureRootFolder(driveApi, storage.root_path);
                setStorages((prev) => prev.map((s) => (s.id === storage.id ? { ...s, resolvedRootId: rootId } : s)));
                setBaseFolderId(rootId);
                setBaseName(storage.name || t("default_storage_name"));
                setDriveToken(storage.access_token);
                setRootReady(true);
            } catch (e) {
                setGlobalError(e?.message || t("storages_error_prepare"));
            } finally {
                setStorageLoading(false);
            }
        })();
    }, [activeStorageId, storages, refreshDriveToken]);

    const handleAuthenticated = (authResponse) => {
        setUser(authResponse);
        persistUser(authResponse);
    };

    useEffect(() => {
        if (!user) {
            setClientId("");
            setClientIdError("");
            setClientIdLoading(false);
            return;
        }
        setClientIdLoading(true);
        setClientIdError("");
        (async () => {
            try {
                const data = await fetchClientId();
                setClientId(data?.client_id || data?.clientId || "");
            } catch (e) {
                setClientIdError(e?.message || "Failed to load Google client id");
            } finally {
                setClientIdLoading(false);
            }
        })();
    }, [user]);

    const handleCreateStorage = async (payload) => {
        try {
            const created = await createStorage(payload);
            setStorages((prev) => [...prev, created]);
            setAddModalOpen(false);
            setBlockAddModal(false);
            setActiveStorageId(created.id);
            setDriveToken(null);
            setBaseName(created.name || t("default_storage_name"));
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
                setGlobalError(e?.message || t("storages_error_delete"));
            }
        } finally {
            setDeleteBusy(false);
        }
    };

    const readyForDrive = Boolean(user && driveToken && rootReady);

    const appShell = (
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
                            onSelectStorage={handleSelectStorage}
                        />
                    ) : user ? (
                        <div className="workspace-shell">
                            <StartupSpinner
                                visible={storageLoading}
                                message={t("storage_connecting")}
                            />
                            <div className="session-bar">
                                <div>
                                    <p className="eyebrow">{t("app_title")}</p>
                                    <h2 className="page-title">{t("storage_list_title")}</h2>
                                    <p className="session-meta">
                                        {t("connected_as")}{" "}
                                        <span className="session-user">{user?.login}</span>
                                    </p>
                                </div>
                                <div className="session-actions">
                                    <StorageMenu
                                        user={user}
                                        storages={storages}
                                        activeId={activeStorageId}
                                        onSelect={handleSelectStorage}
                                        onAdd={() => setAddModalOpen(true)}
                                        onLogout={handleLogout}
                                        onDelete={(s) => setDeleteTarget(s)}
                                    />
                                </div>
                            </div>
                            {globalError && <div className="alert" style={{ marginTop: 12 }}>{globalError}</div>}
                        </div>
                    ) : (
                        <AuthScreen onAuthenticated={handleAuthenticated} />
                    )}

                    {user && (
                        <AddStorageModal
                            open={addModalOpen}
                            blocking={blockAddModal}
                            hasStorages={storages.length > 0}
                            onClose={() => (!blockAddModal ? setAddModalOpen(false) : null)}
                            onCreate={handleCreateStorage}
                        />
                    )}
                    {user && (
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
                    )}
                    {deleteTarget && (
                        <div className="modal confirm-modal" onClick={() => (!deleteBusy ? setDeleteTarget(null) : null)}>
                            <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                                <h3 style={{ marginTop: 0, marginBottom: 8 }}>{t("storages_delete_confirm")}</h3>
                                <p style={{ marginTop: 0, color: "var(--muted)" }}>
                                    {t("storages_delete_question").replace(
                                        "{name}",
                                        deleteTarget.name || ""
                                    )}
                                </p>
                                <div className="confirm-actions">
                                    <button className="btn ghost" type="button" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                                        {t("delete_cancel")}
                                    </button>
                                    <button className="btn primary" type="button" onClick={handleDeleteStorage} disabled={deleteBusy}>
                                        {deleteBusy ? t("delete_busy") : t("delete_confirm")}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </BusyProvider>
            </DialogProvider>
        </PasswordPromptProvider>
    );

    if (user) {
        if (clientIdLoading) {
            return <StartupSpinner visible={true} message={t("storage_loading_message")} />;
        }
        if (clientIdError) {
            return (
                <div className="workspace-shell">
                    <div className="alert">{clientIdError}</div>
                </div>
            );
        }
        if (!clientId) {
            return null;
        }
        return <GoogleOAuthProvider clientId={clientId}>{appShell}</GoogleOAuthProvider>;
    }

    return appShell;
}

