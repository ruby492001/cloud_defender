import React, { useLayoutEffect, useMemo, useRef, useState } from "react";

const arrowUpIcon = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%233b82f6'><path d='M12 4l7 7h-4v9h-6v-9H5z'/></svg>";
const arrowDownIcon = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2322c55e'><path d='M12 20l-7-7h4V4h6v9h4z'/></svg>";

const styles = {
    container: {
        position: "fixed",
        right: 16,
        bottom: 16,
        width: 420,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: "70vh",
        overflowY: "auto",
        overflowX: "hidden",
        background: "#0f172a",
        border: "1px solid #263244",
        borderRadius: 12,
        padding: 16,
        boxShadow: "0 22px 50px rgba(0,0,0,0.45)",
        color: "#e5e7eb",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        zIndex: 1600,
    },
    collapsedContainer: {
        position: "fixed",
        right: 16,
        bottom: 16,
        width: 280,
        maxWidth: "calc(100vw - 24px)",
        background: "#0f172a",
        border: "1px solid #263244",
        borderRadius: 12,
        padding: "10px 14px",
        boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
        color: "#e5e7eb",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        zIndex: 1600,
        cursor: "pointer",
    },
    collapsedSummary: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 13,
    },
    collapsedActions: {
        display: "flex",
        alignItems: "center",
        gap: 8,
    },    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    headerTitle: {
        fontWeight: 600,
        fontSize: 16,
    },
    headerCaption: {
        fontSize: 12,
        color: "#94a3b8",
    },
    section: {
        display: "grid",
        gap: 12,
    },
    sectionHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    sectionTitle: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontWeight: 600,
        fontSize: 14,
    },
    sectionActions: {
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
    icon: {
        width: 18,
        height: 18,
    },
    groupCard: {
        display: "grid",
        gap: 8,
        padding: 12,
        background: "#111c2d",
        border: "1px solid #1f2937",
        borderRadius: 10,
    },
    taskCard: {
        display: "grid",
        gap: 8,
        padding: 12,
        background: "#111c2d",
        border: "1px solid #1f2937",
        borderRadius: 10,
    },
    row: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    taskMain: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flex: 1,
        minWidth: 0,
        overflow: "hidden",
    },
    name: {
        fontSize: 13,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1,
        minWidth: 0,
        display: "block",
    },
    badge: {
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        textTransform: "capitalize",
        border: "1px solid rgba(148, 163, 184, 0.35)",
        color: "#94a3b8",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
    },
    status: {
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        marginLeft: 8,
    },
    progress: {
        width: "100%",
        height: 6,
        borderRadius: 999,
        background: "#1e293b",
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        borderRadius: 999,
        transition: "width .2s ease",
    },
    meta: {
        fontSize: 12,
        color: "#94a3b8",
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
    },
    error: {
        color: "#f87171",
    },
    divider: {
        height: 1,
        background: "rgba(148,163,184,0.2)",
    },
};

const MAX_NAME_LENGTH = 40;
const VISIBLE_NAME_LENGTH = 37;
function truncateName(name = "") {
    if (typeof name !== "string") return "";
    return name.length > MAX_NAME_LENGTH ? `${name.slice(0, VISIBLE_NAME_LENGTH)}...` : name;
}

function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (parts.length < 2 && hours === 0 && secs > 0) {
        parts.push(`${secs}s`);
    }
    if (parts.length === 0) {
        parts.push(`${secs}s`);
    }
    return `~${parts.join(" ")}`;
}

function computeGroupEta(tasks) {
    if (!tasks || tasks.length === 0) return null;
    const candidates = tasks
        .filter((task) => ["queued", "init", "uploading"].includes(task.status))
        .map((task) => task.etaSeconds)
        .filter((eta) => Number.isFinite(eta) && eta > 0);
    if (candidates.length === 0) return null;
    return Math.max(...candidates);
}

const noop = () => {};

const uploadStatusLabel = (status) => {
    switch (status) {
        case "queued":
            return "Queued";
        case "init":
            return "Preparing";
        case "uploading":
            return "Uploading";
        case "done":
            return "Done";
        case "cancelled":
            return "Canceled";
        default:
            return "Error";
    }
};

const downloadStatusLabel = (status) => {
    switch (status) {
        case "queued":
            return "Queued";
        case "running":
            return "Downloading";
        case "done":
            return "Done";
        case "canceled":
            return "Canceled";
        default:
            return "Error";
    }
};

const barColor = (status, type) => {
    if (status === "error") return "#f87171";
    if (status === "cancelled" || status === "canceled") return "#94a3b8";
    if (status === "done") return type === "upload" ? "#3b82f6" : "#22c55e";
    return type === "upload" ? "#6366f1" : "#22c55e";
};

export default function TransferTray({ uploads = {}, downloads = {} }) {
    const {
        tasks: uploadTasks = [],
        groups: uploadGroups = [],
        hidden: uploadsHidden = false,
        allDone: uploadsAllDone = false,
        onCancelTask = noop,
        onRemoveTask = noop,
        onCancelGroup = noop,
        onRemoveGroup = noop,
        onClose = noop,
    } = uploads;

    const {
        tasks: downloadTasks = [],
        visible: downloadsVisible = false,
        onCancel = noop,
        onRemove = noop,
        onClearFinished = noop,
        onHide = noop,
    } = downloads;
    const { onUploadDone = noop } = uploads;

    const containerRef = useRef(null);
    const scrollSnapshot = useRef(0);
    const [collapsed, setCollapsed] = useState(false);

    const soloUploadTasks = useMemo(() => uploadTasks.filter((task) => !task.groupId), [uploadTasks]);
    const groupedUploadTasks = useMemo(() => {
        const map = new Map();
        uploadTasks.forEach((task) => {
            if (!task.groupId) return;
            const list = map.get(task.groupId);
            if (list) {
                list.push(task);
            } else {
                map.set(task.groupId, [task]);
            }
        });
        return map;
    }, [uploadTasks]);
    const groupEtaMap = useMemo(() => {
        const map = new Map();
        groupedUploadTasks.forEach((tasks, groupId) => {
            const eta = computeGroupEta(tasks);
            if (eta !== null) {
                map.set(groupId, eta);
            }
        });
        return map;
    }, [groupedUploadTasks]);
    const groupProgressMap = useMemo(() => {
        const stats = new Map();
        uploadGroups.forEach((group) => {
            stats.set(group.id, {
                totalBytes: 0,
                uploadedBytes: 0,
                percent: group.percent ?? 0,
                done: group.done ?? 0,
                total: group.total ?? 0,
                failed: group.failed ?? 0,
                cancelled: group.cancelled ?? 0,
            });
        });
        uploadTasks.forEach((task) => {
            if (!task.groupId) return;
            const entry = stats.get(task.groupId);
            if (!entry) return;
            const size = Number(task.size || 0) || 0;
            entry.totalBytes += size;
            const uploadedBytes = Math.min(size, Number(task.uploadedBytes || 0) || 0);
            if (task.status === "done") {
                entry.uploadedBytes += size;
            } else {
                entry.uploadedBytes += uploadedBytes;
            }
        });
        stats.forEach((entry, id) => {
            if (entry.totalBytes > 0) {
                entry.percent = Math.min(100, Math.round((entry.uploadedBytes / entry.totalBytes) * 100));
            }
        });
        return stats;
    }, [uploadGroups, uploadTasks]);

    const hasUploads = !uploadsHidden && (uploadGroups.length > 0 || soloUploadTasks.length > 0);
    const hasDownloads = downloadsVisible && downloadTasks.length > 0;

    const totalItems = soloUploadTasks.length + uploadGroups.length + downloadTasks.length;
    const activeUploadTasks = soloUploadTasks.filter((t) => !["done", "cancelled", "error"].includes(t.status)).length;
    const activeUploadGroups = uploadGroups.filter((g) => (g.done + g.failed + g.cancelled) < g.total).length;
    const activeDownloadTasks = downloadTasks.filter((t) => !["done", "canceled", "error"].includes(t.status)).length;
    const activeTransfers = activeUploadTasks + activeUploadGroups + activeDownloadTasks;
    const canDismiss = activeTransfers === 0;


    const fingerprint = useMemo(
        () =>
            JSON.stringify({
                ug: uploadGroups.map(({ id, percent, done, failed, cancelled, total }) => [id, percent, done, failed, cancelled, total]),
                ut: uploadTasks.map(({ id, status, percent, error }) => [id, status, percent, Boolean(error)]),
                dt: downloadTasks.map(({ id, status, progress, error }) => [id, status, progress, Boolean(error)]),
            }),
        [uploadGroups, uploadTasks, downloadTasks],
    );

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const handle = () => {
            scrollSnapshot.current = el.scrollTop;
        };
        handle();
        el.addEventListener("scroll", handle, { passive: true });
        return () => el.removeEventListener("scroll", handle);
    }, []);

    const summaryLabel = activeTransfers > 0 ? `${activeTransfers} active` : `${totalItems} items`;
    const handleDismiss = () => {
        onClose?.();
        onHide?.();
        setCollapsed(false);
    };

    if (!hasUploads && !hasDownloads) {
        return null;
    }

    if (collapsed) {
        return (
            <div
                style={styles.collapsedContainer}
                onClick={() => setCollapsed(false)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setCollapsed(false);
                }}
            >
                <div style={styles.collapsedSummary}>
                    <span>Transfers</span>
                    <span style={{ color: "#94a3b8" }}>{summaryLabel}</span>
                </div>
                <div style={styles.collapsedActions}>
                    <button
                        className="btn ghost"
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setCollapsed(false);
                        }}
                        aria-label="Expand transfers"
                    >
                        ▲
                    </button>
                    <button
                        className="btn ghost"
                        type="button"
                        disabled={!canDismiss}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!canDismiss) return;
                            handleDismiss();
                        }}
                        aria-label="Close transfers"
                    >
                        ✕
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div ref={containerRef} style={styles.container}>
            <div style={styles.header}>
                <div>
                    <div style={styles.headerTitle}>File Transfers</div>
                    <div style={styles.headerCaption}>Uploads to Drive and downloads to this device</div>
                </div>
                <div style={styles.collapsedActions}>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{summaryLabel}</div>
                    <button className="btn ghost" type="button" onClick={() => setCollapsed(true)}>
                        Collapse
                    </button>
                    <button
                        className="btn ghost"
                        type="button"
                        disabled={!canDismiss}
                        onClick={() => {
                            if (!canDismiss) return;
                            handleDismiss();
                        }}
                    >
                        Close
                    </button>
                </div>
            </div>

            {hasUploads && (
                <div style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionTitle}>
                            <img alt="Upload indicator" src={arrowUpIcon} style={styles.icon} />
                            <span>Uploads</span>
                        </div>
                        <div style={styles.sectionActions}>
                            {uploadsAllDone && (
                                <button className="btn ghost" onClick={onClose}>
                                    Hide
                                </button>
                            )}
                        </div>
                    </div>

                    {uploadGroups.map((group) => {
                        const { name, id, total = 0, done = 0, failed = 0, cancelled = 0, percent = 0 } = group ?? {};
                        const finished = done + failed + cancelled;
                        let label;
                        if (finished < total) {
                            label = "In progress";
                        } else if (failed > 0 && done === 0) {
                            label = "Failed";
                        } else if (failed > 0) {
                            label = "Partially done";
                        } else if (cancelled === total) {
                            label = "Canceled";
                        } else if (cancelled > 0 && done > 0) {
                            label = "Partially canceled";
                        } else {
                            label = "Done";
                        }

                        const barStyle = {
                            ...styles.progressFill,
                            width: "0%",
                            background: failed > 0 ? "#facc15" : barColor(label === "Done" ? "done" : "uploading", "upload"),
                        };
                        const groupFinished = finished >= total && total > 0;
                        const progressEntry = groupProgressMap.get(id);
                        const computedPercent = Math.min(100, progressEntry?.percent ?? percent ?? 0);
                        barStyle.width = `${computedPercent}%`;
                        const groupEtaSeconds = groupEtaMap.get(id);
                        const groupEtaLabel = formatEta(groupEtaSeconds);
                        const hasByteStats = (progressEntry?.totalBytes ?? 0) > 0;

                        const rawGroupName = name || "Upload batch";
                        const displayGroupName = truncateName(rawGroupName);

                        return (
                            <div key={id || `group-${name}`} style={styles.groupCard}>
                                <div style={styles.row}>
                                    <div style={styles.taskMain}>
                                        <img alt="Upload group" src={arrowUpIcon} style={styles.icon} />
                                        <div style={styles.name} title={rawGroupName}>
                                            {displayGroupName}
                                        </div>
                                    </div>
                                    <div style={styles.status}>
                                        <span style={styles.badge}>{label}</span>
                                    </div>
                                </div>
                                <div style={styles.meta}>
                                    <span>
                                        Files {done}/{total}
                                    </span>
                                    {hasByteStats && <span>Progress {computedPercent}%</span>}
                                    {groupEtaLabel && <span>ETA {groupEtaLabel}</span>}
                                    {failed > 0 && <span style={styles.error}>Errors {failed}</span>}
                                    {cancelled > 0 && <span>Canceled {cancelled}</span>}
                                </div>
                                <div style={styles.progress}>
                                    <div style={barStyle} />
                                </div>
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    <button className="btn ghost" type="button" onClick={() => onCancelGroup(id)}>
                                        Cancel
                                    </button>
                                    <button
                                        className="btn secondary"
                                        type="button"
                                        disabled={!groupFinished}
                                        onClick={() => {
                                            if (!groupFinished) return;
                                            onRemoveGroup(id);
                                        }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    {soloUploadTasks.map((task) => {
                        const { id, name, status, percent = 0, error, etaSeconds } = task;
                        const rawName = name || "Untitled";
                        const displayName = truncateName(rawName);
                        const canCancel = ["queued", "init", "uploading"].includes(status);
                        const canRemove = ["done", "cancelled", "error"].includes(status);
                        const safePercent = Math.min(100, Math.max(0, percent));
                        const etaLabel = formatEta(etaSeconds);
                        return (
                            <div key={id} style={styles.taskCard}>
                                <div style={styles.row}>
                                    <div style={styles.taskMain}>
                                        <img alt="Upload task" src={arrowUpIcon} style={styles.icon} />
                                        <div style={styles.name} title={rawName}>
                                            {displayName}
                                        </div>
                                    </div>
                                    <div style={styles.status}>
                                        <span style={{ ...styles.badge, borderColor: "rgba(99,102,241,0.35)", color: "#c7d2fe" }}>
                                            {uploadStatusLabel(status)}
                                        </span>
                                    </div>
                                </div>
                                <div style={styles.progress}>
                                    <div
                                        style={{
                                            ...styles.progressFill,
                                            width: `${status === "queued" ? 0 : safePercent}%`,
                                            background: barColor(status, "upload"),
                                        }}
                                    />
                                </div>
                                <div style={styles.meta}>
                                    <span>
                                        {uploadStatusLabel(status)} - {safePercent}%
                                    </span>
                                    {etaLabel && <span>ETA {etaLabel}</span>}
                                    {error && <span style={styles.error}>{error}</span>}
                                </div>
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    {canCancel && (
                                        <button className="btn ghost" type="button" onClick={() => onCancelTask(id)}>
                                            Cancel
                                        </button>
                                    )}
                                    {canRemove && (
                                        <button className="btn secondary" type="button" onClick={() => onRemoveTask(id)}>
                                            Remove
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {hasUploads && hasDownloads && <div style={styles.divider} />}

            {hasDownloads && (
                <div style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionTitle}>
                            <img alt="Download indicator" src={arrowDownIcon} style={styles.icon} />
                            <span>Downloads</span>
                        </div>
                        <div style={styles.sectionActions}>
                            <button className="btn ghost" type="button" onClick={onClearFinished}>
                                Clear finished
                            </button>
                            <button className="btn ghost" type="button" onClick={onHide}>
                                Hide
                            </button>
                        </div>
                    </div>

                    {downloadTasks.map((task) => {
                        const { id, name, progress = 0, status, kind, error, etaSeconds, integrityCorrupted } = task;
                        const rawName = name || "Untitled";
                        const displayName = truncateName(rawName);
                        const subtitle = kind === "folder" ? "Folder (zip)" : "File";
                        const canCancel = status === "running";
                        const canRemove = ["error", "canceled", "done"].includes(status);
                        const safeProgress = Math.min(100, Math.max(0, progress || 0));
                        const etaLabel = formatEta(etaSeconds);
                        const errorMessage = integrityCorrupted ? "Data integrity corrupted" : error;
                        return (
                            <div key={id} style={styles.taskCard}>
                                <div style={styles.row}>
                                    <div style={styles.taskMain}>
                                        <img alt="Download task" src={arrowDownIcon} style={styles.icon} />
                                        <div style={styles.name} title={rawName}>
                                            {displayName}
                                        </div>
                                    </div>
                                    <div style={styles.status}>
                                        <span style={{ ...styles.badge, borderColor: "rgba(34,197,94,0.35)", color: "#bbf7d0" }}>
                                            {downloadStatusLabel(status)}
                                        </span>
                                    </div>
                                </div>
                                <div style={styles.meta}>
                                    <span>{subtitle}</span>
                                    {errorMessage && <span style={styles.error}>{errorMessage}</span>}
                                </div>
                                <div style={styles.progress}>
                                    <div
                                        style={{
                                            ...styles.progressFill,
                                            width: `${safeProgress}%`,
                                            background: barColor(status, "download"),
                                        }}
                                    />
                                </div>
                                <div style={styles.meta}>
                                    <span>
                                        {downloadStatusLabel(status)} - {safeProgress}%
                                    </span>
                                    {etaLabel && <span>ETA {etaLabel}</span>}
                                </div>
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    {canCancel && (
                                        <button className="btn ghost" type="button" onClick={() => onCancel(id)}>
                                            Cancel
                                        </button>
                                    )}
                                    {canRemove && (
                                        <button className="btn secondary" type="button" onClick={() => onRemove(id)}>
                                            Remove
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
