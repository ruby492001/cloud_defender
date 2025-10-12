// src/logic/useUploadManager.js
import { useRef, useState, useCallback } from "react";
import { initResumableUpload, uploadResumable } from "../api/drive";

/**
 * Устойчивый к гонкам менеджер загрузок:
 * - статус "queued" показывается в UI;
 * - отмена отдельного файла и всей группы (папки) работает для queued/init/uploading;
 * - отменённые задачи помечаются флагом в cancelledSetRef, чтобы воркер не стартовал их по гонке.
 */
export default function useUploadManager({
                                             accessToken,
                                             chunkSize = 8 * 1024 * 1024,
                                             concurrency = 2,
                                         }) {
    const [tasks, setTasks] = useState([]);
    const [groups, setGroups] = useState([]);
    const [hidden, setHidden] = useState(false);

    const queueRef = useRef([]);                    // очередь задач (которые ещё не стартовали)
    const activeCountRef = useRef(0);               // сколько сейчас выполняется
    const abortMapRef = useRef(new Map());          // id -> AbortController
    const cancelledSetRef = useRef(new Set());      // id отменённых (для мгновенной фильтрации воркерами)

    // ─────────────────────────── Groups ───────────────────────────
    const createGroup = useCallback(({ type, name, total }) => {
        const id = `grp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const g = { id, type, name, total, done: 0, failed: 0, cancelled: 0, percent: 0 };
        setGroups((prev) => [...prev, g]);
        return id;
    }, []);

    const bumpGroup = useCallback((groupId, patch) => {
        setGroups((prev) =>
            prev.map((g) => {
                if (g.id !== groupId) return g;
                const next = { ...g, ...patch };
                const finished = next.done + next.failed + next.cancelled;
                next.percent = Math.floor((finished / Math.max(next.total, 1)) * 100);
                return next;
            })
        );
    }, []);

    // ─────────────────────────── Add tasks ────────────────────────
    const addTasks = useCallback((newTasks) => {
        if (!Array.isArray(newTasks) || !newTasks.length) return;
        const prepared = newTasks.map((t) => ({
            ...t,
            status: "queued",
            percent: 0,
            uploadedBytes: 0,
            uploadUrl: null,
            error: "",
        }));
        setHidden(false);
        // кладём в стейт и в очередь
        setTasks((prev) => [...prev, ...prepared]);
        queueRef.current.push(...prepared);
        runWorkers(); // стартуем воркеры без гонок setState
    }, []);

    const addFiles = useCallback(
        (fileList) => {
            const list = Array.from(fileList ?? []);
            if (!list.length) return;
            const now = Date.now();
            const ts = list.map((f, i) => ({
                id: `${now}_${i}_${f.name}_${f.size}`,
                file: f,
                name: f.name,
                size: f.size,
                type: f.type || "application/octet-stream",
                parentId: undefined,
            }));
            addTasks(ts);
        },
        [addTasks]
    );

    // ─────────────────────────── Workers ──────────────────────────
    function runWorkers() {
        while (activeCountRef.current < concurrency && queueRef.current.length > 0) {
            const task = queueRef.current.shift();
            // Мгновенная фильтрация отменённых (на случай, если успели отменить в очереди)
            if (cancelledSetRef.current.has(task.id) || task.status === "cancelled") {
                // Синхронизируем статус в стейте (если ещё не проставлен)
                setTasks((prev) =>
                    prev.map((t) => (t.id === task.id ? { ...t, status: "cancelled", error: "Отменено" } : t))
                );
                // Счётчик группы
                if (task.groupId) {
                    bumpGroupDelta(task.groupId, "cancelled", 1);
                }
                continue;
            }
            activeCountRef.current += 1;
            processTask(task).finally(() => {
                activeCountRef.current -= 1;
                runWorkers();
            });
        }
    }

    async function processTask(task) {
        // Последняя проверка перед стартом: не отменили ли?
        if (cancelledSetRef.current.has(task.id)) {
            setTasks((prev) =>
                prev.map((t) => (t.id === task.id ? { ...t, status: "cancelled", error: "Отменено" } : t))
            );
            if (task.groupId) bumpGroupDelta(task.groupId, "cancelled", 1);
            return;
        }

        updateTask(task.id, { status: "init", error: "" });
        const ac = new AbortController();
        abortMapRef.current.set(task.id, ac);

        try {
            const uploadUrl = await initResumableUpload({
                accessToken,
                name: task.name,
                mimeType: task.type,
                size: task.size,
                parentId: task.parentId,
            });

            // Если отменили прямо в момент инициализации — не продолжаем
            if (cancelledSetRef.current.has(task.id)) {
                abortMapRef.current.delete(task.id);
                updateTask(task.id, { status: "cancelled", error: "Отменено" });
                if (task.groupId) bumpGroupDelta(task.groupId, "cancelled", 1);
                return;
            }

            updateTask(task.id, { status: "uploading", uploadUrl });

            await uploadResumable({
                uploadUrl,
                file: task.file,
                chunkSize,
                signal: ac.signal,
                onProgress: (uploaded, total) => {
                    const percent = Math.floor((uploaded / (total || 1)) * 100);
                    updateTask(task.id, { uploadedBytes: uploaded, percent });
                },
            });

            abortMapRef.current.delete(task.id);
            updateTask(task.id, { status: "done", percent: 100 });
            if (task.groupId) bumpGroupDelta(task.groupId, "done", 1);
        } catch (e) {
            abortMapRef.current.delete(task.id);

            const isAbort = e?.name === "AbortError" || cancelledSetRef.current.has(task.id);
            updateTask(task.id, {
                status: isAbort ? "cancelled" : "error",
                error: isAbort ? "Отменено" : String(e?.message || e),
            });

            if (task.groupId) bumpGroupDelta(task.groupId, isAbort ? "cancelled" : "failed", 1);
        }
    }

    function updateTask(id, patch) {
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    }

    function bumpGroupDelta(groupId, field, delta) {
        setGroups((prev) =>
            prev.map((g) => {
                if (g.id !== groupId) return g;
                const next = { ...g, [field]: (g[field] || 0) + delta };
                const finished = next.done + next.failed + next.cancelled;
                next.percent = Math.floor((finished / Math.max(next.total, 1)) * 100);
                return next;
            })
        );
    }

    // ───────────────────── Cancel / Remove (file / group) ────────────────────────
    function cancelTask(id) {
        // 1) queued: снять из очереди, пометить отменённым
        const idx = queueRef.current.findIndex((t) => t.id === id);
        if (idx !== -1) {
            const t = queueRef.current[idx];
            queueRef.current.splice(idx, 1);
            cancelledSetRef.current.add(id);

            setTasks((prev) =>
                prev.map((x) => (x.id === id ? { ...x, status: "cancelled", error: "Отменено" } : x))
            );
            if (t.groupId) bumpGroupDelta(t.groupId, "cancelled", 1);
            return;
        }

        // 2) активная: прервать
        cancelledSetRef.current.add(id);
        const ac = abortMapRef.current.get(id);
        if (ac) ac.abort();
    }

    function removeTask(id) {
        setTasks((prev) => prev.filter((t) => t.id !== id));
    }

    function cancelGroup(groupId) {
        // queued → снять из очереди, пометить
        const queued = queueRef.current.filter((t) => t.groupId === groupId);
        if (queued.length) {
            // удалить из очереди
            queueRef.current = queueRef.current.filter((t) => t.groupId !== groupId);
            // отметить как отменённые
            const ids = queued.map((t) => t.id);
            ids.forEach((id) => cancelledSetRef.current.add(id));

            setTasks((prev) =>
                prev.map((t) =>
                    t.groupId === groupId && t.status === "queued"
                        ? { ...t, status: "cancelled", error: "Отменено" }
                        : t
                )
            );
            bumpGroupDelta(groupId, "cancelled", queued.length);
        }

        // init/uploading → abort
        const activeIds = tasks
            .filter((t) => t.groupId === groupId && (t.status === "init" || t.status === "uploading"))
            .map((t) => t.id);

        activeIds.forEach((id) => {
            cancelledSetRef.current.add(id);
            const ac = abortMapRef.current.get(id);
            if (ac) ac.abort();
        });
    }

    function removeGroup(groupId) {
        setTasks((prev) => prev.filter((t) => t.groupId !== groupId));
        setGroups((prev) => prev.filter((g) => g.id !== groupId));
    }

    function closePanel() {
        setHidden(true);
    }

    // ─────────────────────────── View model ───────────────────────
    const visibleTasks = tasks;      // показываем всю очередь, включая queued
    const visibleGroups = groups;

    const allDone =
        (visibleTasks.length === 0 ||
            visibleTasks.every((t) => ["done", "cancelled", "error"].includes(t.status))) &&
        (visibleGroups.length === 0 ||
            visibleGroups.every((g) => g.done + g.failed + g.cancelled >= g.total));

    return {
        // данные
        tasks: visibleTasks,
        groups: visibleGroups,
        hidden,
        allDone,
        // API
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
