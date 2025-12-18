import { useRef, useState, useCallback } from "react";
import { t } from "../strings.js";

function computeEtaSeconds({ startedAt, uploaded, total, fallbackTotal }) {
    if (!startedAt) return null;
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs <= 0) return null;
    const elapsedSeconds = elapsedMs / 1000;
    const totalBytes = total || fallbackTotal;
    if (!totalBytes || totalBytes <= 0) return null;
    if (!uploaded || uploaded <= 0) return null;
    const speed = uploaded / elapsedSeconds;
    if (!Number.isFinite(speed) || speed <= 0) return null;
    const remainingBytes = Math.max(0, totalBytes - uploaded);
    if (remainingBytes === 0) return 0;
    return remainingBytes / speed;
}


export default function useUploadManager({
    cryptoApi,
    chunkSize = 8 * 1024 * 1024,
    concurrency = 2,
    partConcurrency = 3,
}) {
    if (!cryptoApi) {
        throw new Error(t("upload_error_crypto_required"));
    }

    const [tasks, setTasks] = useState([]);
    const [groups, setGroups] = useState([]);
    const [hidden, setHidden] = useState(false);

    const queueRef = useRef([]);
    const activeCountRef = useRef(0);
    const abortMapRef = useRef(new Map());
    const cancelledSetRef = useRef(new Set());
    const runWorkersRef = useRef(() => {});
    const defaultParentRef = useRef(cryptoApi?.rootId || "root");

    const bumpGroupDelta = useCallback((groupId, field, delta) => {
        setGroups((prev) =>
            prev.map((g) => (g.id === groupId ? { ...g, [field]: Math.max(0, (g[field] || 0) + delta) } : g))
        );
    }, []);

    const updateTask = useCallback((id, patch) => {
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    }, []);

    const createGroup = useCallback(({ type, name, total }) => {
        const id = `grp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        setGroups((prev) => [...prev, { id, type, name, total, done: 0, failed: 0, cancelled: 0 }]);
        return id;
    }, []);

    const processTask = useCallback(
        async (task) => {
            const controller = new AbortController();
            abortMapRef.current.set(task.id, controller);
            activeCountRef.current += 1;
            const startedAt = Date.now();
            updateTask(task.id, { status: "uploading", startedAt });
            try {
                const parentId = task.parentId || defaultParentRef.current || cryptoApi.rootId || "root";
                const resp = await cryptoApi.uploadFile({
                    file: task.file,
                    parentId,
                    signal: controller.signal,
                    chunkSize,
                    onProgress: (uploaded, total) => {
                        const etaSeconds = computeEtaSeconds({
                            startedAt,
                            uploaded,
                            total,
                            fallbackTotal: task.size,
                        });
                        updateTask(task.id, {
                            uploadedBytes: uploaded,
                            percent: total ? Math.min(100, Math.floor((uploaded / total) * 100)) : 0,
                            etaSeconds,
                        });
                    },
                    partConcurrency,
                });
                updateTask(task.id, { status: "done", response: resp, percent: 100, etaSeconds: 0 });
                bumpGroupDelta(task.groupId, "done", 1);
            } catch (err) {
                if (controller.signal.aborted || cancelledSetRef.current.has(task.id)) {
                    updateTask(task.id, { status: "cancelled", error: t("upload_status_cancelled") });
                    bumpGroupDelta(task.groupId, "cancelled", 1);
                } else {
                    updateTask(task.id, { status: "error", error: err?.message || t("upload_status_failed") });
                    bumpGroupDelta(task.groupId, "failed", 1);
                }
            } finally {
                abortMapRef.current.delete(task.id);
                activeCountRef.current -= 1;
                runWorkersRef.current();
            }
        },
        [cryptoApi, updateTask, bumpGroupDelta, partConcurrency]
    );

    const runWorkers = useCallback(() => {
        while (activeCountRef.current < concurrency && queueRef.current.length > 0) {
            const next = queueRef.current.shift();
            if (!next) break;
            if (cancelledSetRef.current.has(next.id)) {
                updateTask(next.id, { status: "cancelled", error: t("upload_status_cancelled") });
                cancelledSetRef.current.delete(next.id);
                if (next.groupId) bumpGroupDelta(next.groupId, "cancelled", 1);
                continue;
            }
            processTask(next);
        }
    }, [concurrency, processTask, updateTask, bumpGroupDelta]);
    runWorkersRef.current = runWorkers;

    const addTasks = useCallback(
        (newTasks) => {
            if (!Array.isArray(newTasks) || !newTasks.length) return;
            const prepared = newTasks.map((t) => ({
                ...t,
                status: "queued",
                percent: 0,
                uploadedBytes: 0,
                uploadUrl: null,
                error: "",
                etaSeconds: null,
                startedAt: null,
                parentId: t.parentId ?? defaultParentRef.current ?? cryptoApi?.rootId ?? "root",
            }));
            setHidden(false);
            setTasks((prev) => [...prev, ...prepared]);
            queueRef.current.push(...prepared);
            runWorkers();
        },
        [runWorkers, cryptoApi]
    );

    const addFiles = useCallback(
        (fileList, parentIdOverride) => {
            const list = Array.from(fileList ?? []);
            if (!list.length) return;
            const now = Date.now();
            list.forEach((f, i) => {
                addTasks([
                    {
                        id: `${now}_${i}_${f.name}_${f.size}`,
                        file: f,
                        name: f.name,
                        size: f.size,
                        type: f.type || "application/octet-stream",
                        parentId: parentIdOverride ?? defaultParentRef.current ?? cryptoApi?.rootId ?? "root",
                    },
                ]);
            });
        },
        [addTasks, cryptoApi]
    );

    const cancelTask = useCallback(
        (id) => {
            const idx = queueRef.current.findIndex((t) => t.id === id);
            if (idx !== -1) {
                const t = queueRef.current[idx];
                queueRef.current.splice(idx, 1);
                cancelledSetRef.current.add(id);
                setTasks((prev) =>
                    prev.map((x) =>
                        x.id === id ? { ...x, status: "cancelled", error: t("upload_status_cancelled"), etaSeconds: null } : x
                    )
                );
                if (t.groupId) bumpGroupDelta(t.groupId, "cancelled", 1);
                return;
            }
            cancelledSetRef.current.add(id);
            const ac = abortMapRef.current.get(id);
            if (ac) ac.abort();
        },
        [bumpGroupDelta]
    );

    const removeTask = useCallback((id) => {
        setTasks((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const cancelGroup = useCallback(
        (groupId) => {
            const queued = queueRef.current.filter((t) => t.groupId === groupId);
            if (queued.length) {
                queueRef.current = queueRef.current.filter((t) => t.groupId !== groupId);
                queued.forEach((t) => cancelledSetRef.current.add(t.id));
                setTasks((prev) =>
                    prev.map((t) =>
                        t.groupId === groupId && t.status === "queued"
                            ? { ...t, status: "cancelled", error: "Cancelled", etaSeconds: null }
                            : t
                    )
                );
                bumpGroupDelta(groupId, "cancelled", queued.length);
            }
            const active = tasks.filter((t) => t.groupId === groupId && t.status === "uploading");
            active.forEach((t) => cancelTask(t.id));
        },
        [tasks, cancelTask, bumpGroupDelta]
    );

    const removeGroup = useCallback((groupId) => {
        setGroups((prev) => prev.filter((g) => g.id !== groupId));
        setTasks((prev) => prev.filter((t) => t.groupId !== groupId));
    }, []);

    const hideFinished = useCallback(() => {
        setTasks((prev) => prev.filter((t) => !["done", "cancelled"].includes(t.status)));
        setGroups((prev) => prev.filter((g) => g.done + g.failed + g.cancelled < g.total));
        setHidden(true);
    }, []);

    const visibleTasks = tasks;
    const visibleGroups = groups;
    const allDone =
        (visibleTasks.length === 0 ||
            visibleTasks.every((t) => ["done", "cancelled", "error"].includes(t.status))) &&
        (visibleGroups.length === 0 ||
            visibleGroups.every((g) => g.done + g.failed + g.cancelled >= g.total));

    return {
        tasks: visibleTasks,
        groups: visibleGroups,
        hidden,
        allDone,
        addFiles,
        addTasks,
        createGroup,
        cancelTask,
        removeTask,
        cancelGroup,
        removeGroup,
        closePanel: hideFinished,
        setDefaultParentId: (id) => {
            defaultParentRef.current = id || cryptoApi?.rootId || "root";
        },
        getDefaultParentId: () => defaultParentRef.current,
    };
}
