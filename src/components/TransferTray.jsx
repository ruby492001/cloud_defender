import React, { useLayoutEffect, useMemo, useRef } from "react";

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
    header: {
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
    },
    name: {
        fontSize: 13,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    badge: {
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        textTransform: "capitalize",
        border: "1px solid rgba(148, 163, 184, 0.35)",
        color: "#94a3b8",
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

    const containerRef = useRef(null);
    const scrollSnapshot = useRef(0);

    const hasUploads = !uploadsHidden && (uploadGroups.length > 0 || uploadTasks.length > 0);
    const hasDownloads = downloadsVisible && downloadTasks.length > 0;

    const totalItems = uploadTasks.length + uploadGroups.length + downloadTasks.length;

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
        const maxScroll = Math.max(el.scrollHeight - el.clientHeight, 0);
        const target = Math.min(scrollSnapshot.current, maxScroll);
        if (Math.abs(el.scrollTop - target) > 1) {
            el.scrollTop = target;
        }
        scrollSnapshot.current = el.scrollTop;
    }, [fingerprint]);

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

    if (!hasUploads && !hasDownloads) {
        return null;
    }

    return (
        <div ref={containerRef} style={styles.container}>
            <div style={styles.header}>
                <div>
                    <div style={styles.headerTitle}>File Transfers</div>
                    <div style={styles.headerCaption}>Uploads to Drive and downloads to this device</div>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>{totalItems} items</div>
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
                            width: `${Math.min(100, percent || 0)}%`,
                            background: failed > 0 ? "#facc15" : barColor(label === "Done" ? "done" : "uploading", "upload"),
                        };

                        return (
                            <div key={id || `group-${name}`} style={styles.groupCard}>
                                <div style={styles.row}>
                                    <div style={styles.taskMain}>
                                        <img alt="Upload group" src={arrowUpIcon} style={styles.icon} />
                                        <div style={styles.name} title={name}>
                                            {name || "Upload batch"}
                                        </div>
                                    </div>
                                    <span style={styles.badge}>{label}</span>
                                </div>
                                <div style={styles.meta}>
                                    <span>
                                        Files {done}/{total}
                                    </span>
                                    {failed > 0 && <span style={styles.error}>Errors {failed}</span>}
                                    {cancelled > 0 && <span>Canceled {cancelled}</span>}
                                </div>
                                <div style={styles.progress}>
                                    <div style={barStyle} />
                                </div>
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    <button className="btn ghost" onClick={() => onCancelGroup(id)}>
                                        Cancel
                                    </button>
                                    <button className="btn secondary" onClick={() => onRemoveGroup(id)}>
                                        Remove
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    {uploadTasks
                        .filter((task) => !task.groupId)
                        .map((task) => {
                            const { id, name, status, percent = 0, error } = task;
                            const canCancel = ["queued", "init", "uploading"].includes(status);
                            const canRemove = ["done", "cancelled", "error"].includes(status);
                            return (
                                <div key={id} style={styles.taskCard}>
                                    <div style={styles.row}>
                                        <div style={styles.taskMain}>
                                            <img alt="Upload task" src={arrowUpIcon} style={styles.icon} />
                                            <div style={styles.name} title={name}>
                                                {name}
                                            </div>
                                        </div>
                                        <span style={{ ...styles.badge, borderColor: "rgba(99,102,241,0.35)", color: "#c7d2fe" }}>
                                            {uploadStatusLabel(status)}
                                        </span>
                                    </div>
                                    <div style={styles.progress}>
                                        <div
                                            style={{
                                                ...styles.progressFill,
                                                width: `${status === "queued" ? 0 : Math.min(100, percent)}%`,
                                                background: barColor(status, "upload"),
                                            }}
                                        />
                                    </div>
                                    <div style={styles.meta}>
                                        <span>
                                            {uploadStatusLabel(status)} - {Math.min(100, Math.max(0, percent))}%
                                        </span>
                                        {error && <span style={styles.error}>{error}</span>}
                                    </div>
                                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                        {canCancel && (
                                            <button className="btn ghost" onClick={() => onCancelTask(id)}>
                                                Cancel
                                            </button>
                                        )}
                                        {canRemove && (
                                            <button className="btn secondary" onClick={() => onRemoveTask(id)}>
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
                            <button className="btn ghost" onClick={onClearFinished}>
                                Clear finished
                            </button>
                            <button className="btn ghost" onClick={onHide}>
                                Hide
                            </button>
                        </div>
                    </div>

                    {downloadTasks.map((task) => {
                        const { id, name, progress = 0, status, kind, error } = task;
                        const subtitle = kind === "folder" ? "Folder (zip)" : "File";
                        const canCancel = status === "running";
                        const canRemove = ["queued", "error", "canceled", "done"].includes(status);
                        return (
                            <div key={id} style={styles.taskCard}>
                                <div style={styles.row}>
                                    <div style={styles.taskMain}>
                                        <img alt="Download task" src={arrowDownIcon} style={styles.icon} />
                                        <div style={styles.name} title={name}>
                                            {name}
                                        </div>
                                    </div>
                                    <span style={{ ...styles.badge, borderColor: "rgba(34,197,94,0.35)", color: "#bbf7d0" }}>
                                        {downloadStatusLabel(status)}
                                    </span>
                                </div>
                                <div style={styles.meta}>
                                    <span>{subtitle}</span>
                                    {error && <span style={styles.error}>{error}</span>}
                                </div>
                                <div style={styles.progress}>
                                    <div
                                        style={{
                                            ...styles.progressFill,
                                            width: `${Math.min(100, progress || 0)}%`,
                                            background: barColor(status, "download"),
                                        }}
                                    />
                                </div>
                                <div style={styles.meta}>
                                    <span>
                                        {downloadStatusLabel(status)} - {Math.min(100, Math.max(0, progress || 0))}%
                                    </span>
                                </div>
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    {canCancel && (
                                        <button className="btn ghost" onClick={() => onCancel(id)}>
                                            Cancel
                                        </button>
                                    )}
                                    {canRemove && (
                                        <button className="btn secondary" onClick={() => onRemove(id)}>
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



