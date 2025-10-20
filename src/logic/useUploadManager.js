// src/logic/useUploadManager.js
import { useRef, useState, useCallback } from "react";

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
        throw new Error("useUploadManager requires cryptoApi instance");
    }

    const [tasks, setTasks] = useState([]);
    const [groups, setGroups] = useState([]);
    const [hidden, setHidden] = useState(false);

    const queueRef = useRef([]);
    const activeCountRef = useRef(0);
    const abortMapRef = useRef(new Map());
    const cancelledSetRef = useRef(new Set());
    const runWorkersRef = useRef(() => {});

    const createGroup = useCallback(({ type, name, total }) => {
        const id = `grp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const g = { id, type, name, total, done: 0, failed: 0, cancelled: 0, percent: 0 };
        setGroups((prev) => [...prev, g]);
        return id;
    }, []);

    const bumpGroupDelta = useCallback((groupId, field, delta) => {
        setGroups((prev) =>
            prev.map((g) => {
                if (g.id !== groupId) return g;
                const next = { ...g, [field]: (g[field] || 0) + delta };
                const finished = next.done + next.failed + next.cancelled;
                next.percent = Math.floor((finished / Math.max(next.total, 1)) * 100);
                return next;
            })
        );
    }, []);

    const updateTask = useCallback((id, patch) => {
        setTasks((prev) =>
            prev.map((t) => {
                if (t.id !== id) return t;
                const merged = { ...t, ...patch };
                if (patch?.crypto) {
                    merged.crypto = { ...(t.crypto || {}), ...patch.crypto };
                }
                return merged;
            })
        );
    }, []);

    const processTask = useCallback(
        (task) => {
            const controller = new AbortController();
            abortMapRef.current.set(task.id, controller);
            activeCountRef.current += 1;

            const execute = async () => {
                const startedAt = task.startedAt ?? Date.now();
                task.startedAt = startedAt;
                updateTask(task.id, { status: "init", startedAt, etaSeconds: null });
                try {
                    const preparation = await cryptoApi.prepareUpload({
                        file: task.file,
                        parentId: task.parentId,
                        mimeType: task.type,
                        size: task.size,
                        session: task.crypto?.uploadSession,
                    });

                    const uploadUrl = preparation.uploadUrl;
                    const uploadFile = preparation.originalFile || task.file;
                    const preparationSession = preparation.session || null;
                    if (preparationSession) {
                        task.crypto = { ...(task.crypto || {}), uploadSession: preparationSession };
                        updateTask(task.id, { crypto: { uploadSession: preparationSession } });
                    }

                    updateTask(task.id, { status: "uploading", uploadUrl });

                    const { response: uploadResponse, session: completedSession } = await cryptoApi.uploadFileChunks({
                        uploadUrl,
                        file: uploadFile,
                        chunkSize,
                        signal: controller.signal,
                        onProgress: (uploaded, total) => {
                            const totalBytes = total || task.size || 0;
                            const percent = Math.floor((uploaded / (totalBytes || 1)) * 100);
                            const etaSeconds = computeEtaSeconds({
                                startedAt: task.startedAt,
                                uploaded,
                                total,
                                fallbackTotal: task.size,
                            });
                            updateTask(task.id, {
                                uploadedBytes: Math.min(uploaded, totalBytes || uploaded),
                                percent,
                                etaSeconds: Number.isFinite(etaSeconds) ? etaSeconds : null,
                            });
                        },
                        session: preparationSession || task.crypto?.uploadSession || null,
                        parallel: partConcurrency,
                    });

                    if (completedSession) {
                        task.crypto = { ...(task.crypto || {}), uploadSession: completedSession };
                        updateTask(task.id, { crypto: { uploadSession: completedSession } });
                    }

                    updateTask(task.id, { status: "done", percent: 100 });
                    await cryptoApi.finalizeUpload({ task, uploadResult: uploadResponse, session: completedSession });
                    updateTask(task.id, { etaSeconds: 0 });
                    if (task.groupId) bumpGroupDelta(task.groupId, "done", 1);
                } catch (e) {
                    const isAbort = e?.name === "AbortError" || cancelledSetRef.current.has(task.id);
                    updateTask(task.id, {
                        status: isAbort ? "cancelled" : "error",
                        error: isAbort ? "Cancelled" : String(e?.message || e),
                        etaSeconds: null,
                    });
                    if (task.groupId) bumpGroupDelta(task.groupId, isAbort ? "cancelled" : "failed", 1);
                } finally {
                    abortMapRef.current.delete(task.id);
                    cancelledSetRef.current.delete(task.id);
                    activeCountRef.current = Math.max(0, activeCountRef.current - 1);
                    runWorkersRef.current();
                }
            };

            execute();
        },
        [cryptoApi, chunkSize, updateTask, bumpGroupDelta, partConcurrency]
    );

    const runWorkers = useCallback(() => {
        while (activeCountRef.current < concurrency && queueRef.current.length > 0) {
            const next = queueRef.current.shift();
            if (!next) break;

            if (cancelledSetRef.current.has(next.id)) {
                updateTask(next.id, { status: "cancelled", error: "Cancelled" });
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
            }));
            setHidden(false);
            setTasks((prev) => [...prev, ...prepared]);
            queueRef.current.push(...prepared);
            runWorkers();
        },
        [runWorkers, cryptoApi]
    );

    const addFiles = useCallback(
        (fileList) => {
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
                        parentId: undefined,
                    },
                ]);
            });
        },
        [addTasks]
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
                        x.id === id ? { ...x, status: "cancelled", error: "Cancelled", etaSeconds: null } : x
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

            const activeIds = tasks
                .filter((t) => t.groupId === groupId && (t.status === "init" || t.status === "uploading"))
                .map((t) => t.id);

            activeIds.forEach((taskId) => {
                cancelledSetRef.current.add(taskId);
                const ac = abortMapRef.current.get(taskId);
                if (ac) ac.abort();
            });
        },
        [tasks, bumpGroupDelta]
    );

    const removeGroup = useCallback((groupId) => {
        setTasks((prev) => prev.filter((t) => t.groupId !== groupId));
        setGroups((prev) => prev.filter((g) => g.id !== groupId));
    }, []);

    const closePanel = useCallback(() => {
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
        closePanel,
    };
}


