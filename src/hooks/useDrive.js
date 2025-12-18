import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DriveApi } from "../api/drive.js";
import { t } from "../strings.js";
import GoogleCryptoApi from "../api/GoogleCryptoApi.js";

export function useDrive(token, options = {}) {
    const {
        requestPassword,
        pbkdf2Iterations,
        pbkdf2Hash,
        onStorageInitStart,
        onStorageInitFinish,
        refreshAccessToken,
        baseFolderId = "root",
        baseName = t("default_storage_name"),
        onUnauthorized,
        rootId = baseFolderId,
        storageId,
    } = options || {};

    const coreApi = useMemo(
        () => new DriveApi(token, { refreshToken: refreshAccessToken, rootId }),
        [token, refreshAccessToken, rootId]
    );
    useEffect(() => {
        coreApi.rootId = baseFolderId || rootId || "root";
    }, [coreApi, baseFolderId, rootId]);
    const api = useMemo(
        () =>
            new GoogleCryptoApi(coreApi, {
                promptPassword: requestPassword,
                pbkdf2Iterations,
                pbkdf2Hash,
                onStorageInitStart,
                onStorageInitFinish,
                storageId,
            }),
        [coreApi, requestPassword, pbkdf2Iterations, pbkdf2Hash, onStorageInitStart, onStorageInitFinish, storageId]
    );

    const [configReady, setConfigReady] = useState(false);
    const [currentFolder, setCurrentFolder] = useState(baseFolderId);
    const [breadcrumb, setBreadcrumb] = useState([{ id: baseFolderId, name: baseName }]);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [nextPageToken, setNextPageToken] = useState(undefined);
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState({ field: "name", dir: "asc" });
    const loadingRef = useRef(false);
    const currentFolderRef = useRef(baseFolderId);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                await api.ensureConfigLoaded();
            } catch (e) {
                // ignore
            } finally {
                if (!cancelled) setConfigReady(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [api]);

    const loadMore = useCallback(
        async (folderId, pageToken, searchText, replace) => {
            const targetFolder = folderId ?? currentFolderRef.current;
            if (!targetFolder || loadingRef.current) return;
            loadingRef.current = true;
            setLoading(true);
            try {
                const res = await api.listFolder(targetFolder, pageToken ?? nextPageToken, searchText ?? search);
                setItems((prev) => (replace ? res.files || [] : [...prev, ...(res.files || [])]));
                setNextPageToken(res.nextPageToken);
                setError(null);
            } catch (e) {
                if (e?.status === 401) {
                    onUnauthorized?.();
                }
                setError(e?.message || t("drive_error_folder"));
            } finally {
                loadingRef.current = false;
                setLoading(false);
            }
        },
        [api, nextPageToken, search, onUnauthorized]
    );

    useEffect(() => {
        (async () => {
            await loadMore(baseFolderId, undefined, "", true);
        })();
    }, [baseFolderId]);

    const setSortBy = useCallback((field) => {
        setSort((prev) => ({ field, dir: prev.field === field && prev.dir === "asc" ? "desc" : "asc" }));
    }, []);

    const openFolder = useCallback(
        async (folder) => {
            setBreadcrumb((prev) => {
                const idx = prev.findIndex((x) => x.id === folder.id);
                if (idx >= 0) return prev.slice(0, idx + 1);
                return [...prev, { id: folder.id, name: folder.name }];
            });
            currentFolderRef.current = folder.id;
            setItems([]);
            setNextPageToken(undefined);
            setCurrentFolder(folder.id);
            await loadMore(folder.id, undefined, search, true);
        },
        [loadMore, search]
    );

    const upTo = useCallback(
        async (id) => {
            const idx = breadcrumb.findIndex((x) => x.id === id);
            if (idx >= 0) {
                setBreadcrumb(breadcrumb.slice(0, idx + 1));
                currentFolderRef.current = id;
                setItems([]);
                setNextPageToken(undefined);
                setCurrentFolder(id);
                await loadMore(id, undefined, search, true);
            }
        },
        [breadcrumb, loadMore, search]
    );

    const refresh = useCallback(async () => {
        const target = currentFolderRef.current;
        if (target) {
            setItems([]);
            setNextPageToken(undefined);
            await loadMore(target, undefined, search, true);
        }
    }, [loadMore, search]);

    useEffect(() => {
        currentFolderRef.current = baseFolderId;
        setCurrentFolder(baseFolderId);
        setBreadcrumb([{ id: baseFolderId, name: baseName }]);
        setItems([]);
        setNextPageToken(undefined);
        setSearch("");
        (async () => {
            await loadMore(baseFolderId, undefined, "", true);
        })();
    }, [baseFolderId, baseName]);

    return {
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
        setSearch,
        refresh,
        sort,
        setSortBy,
        configReady,
    };
}
