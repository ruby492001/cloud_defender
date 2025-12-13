import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "../strings.js";

const arrowUpIcon =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%233b82f6'><path d='M12 4l7 7h-4v9h-6v-9H5z'/></svg>";
const arrowDownIcon =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2322c55e'><path d='M12 20l-7-7h4V4h6v9h4z'/></svg>";

const styles = {
    container: {
        position: "fixed",
        right: 16,
        bottom: 16,
        width: 520,
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
        width: 360,
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
        flexWrap: "nowrap",
    },
    wideButton: {
        minWidth: 170,
        justifyContent: "center",
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
    if (hours > 0) parts.push(`${hours}ч`);
    if (minutes > 0) parts.push(`${minutes}м`);
    if (parts.length < 2 && hours === 0 && secs > 0) {
        parts.push(`${secs}с`);
    }
    if (parts.length === 0) {
        parts.push(`${secs}с`);
    }
    return parts.join(" ");
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
            return t("upload_overlay_queue");
        case "init":
            return t("upload_overlay_init");
        case "uploading":
            return t("upload_overlay_uploading");
        case "done":
            return t("upload_overlay_done");
        case "cancelled":
            return t("upload_overlay_cancelled");
        default:
            return t("upload_overlay_error");
    }
};

const downloadStatusLabel = (status) => {
    switch (status) {
        case "queued":
            return t("upload_overlay_queue");
        case "running":
            return t("upload_overlay_uploading");
        case "done":
            return t("upload_overlay_done");
        case "canceled":
            return t("upload_overlay_cancelled");
        default:
            return t("upload_overlay_error");
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
        stats.forEach((entry) => {
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
    const activeUploadGroups = uploadGroups.filter((g) => g.done + g.failed + g.cancelled < g.total).length;
    const activeDownloadTasks = downloadTasks.filter((t) => !["done", "canceled", "error"].includes(t.status)).length;
    const activeTransfers = activeUploadTasks + activeUploadGroups + activeDownloadTasks;
    const canDismiss = activeTransfers === 0;

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

    const summaryLabel =
        activeTransfers > 0
            ? t("transfer_summary_active").replace("{count}", String(activeTransfers))
            : t("transfer_summary_total").replace("{count}", String(totalItems));

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
                    <span>{t("transfer_title")}</span>
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
                        aria-label={t("transfer_expand")}
                    >
                        &gt;
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
                        aria-label={t("transfer_close")}
                    >
                        ×
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div ref={containerRef} style={styles.container}>
            <div style={styles.header}>
                <div>
                    <div style={styles.headerTitle}>{t("transfer_header_title")}</div>
                </div>
                <div style={styles.collapsedActions}>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{summaryLabel}</div>
                    <button className="btn ghost" type="button" onClick={() => setCollapsed(true)}>
                        {t("transfer_collapse")}
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
                        {t("transfer_close")}
                    </button>
                </div>
            </div>

            {hasUploads && (
                <div style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionTitle}>
                            <img alt={t("upload_overlay_uploading")} src={arrowUpIcon} style={styles.icon} />
                            <span>{t("transfer_uploads")}</span>
                        </div>
                        <div style={styles.sectionActions}>
                            {uploadsAllDone && (
                                <button className="btn ghost" onClick={onClose}>
                                    {t("transfer_hide")}
                                </button>
                            )}
                        </div>
                    </div>

                    {uploadGroups.map((group) => {
                        const { name, id, total = 0, done = 0, failed = 0, cancelled = 0, percent = 0 } = group ?? {};
                        const finished = done + failed + cancelled;
                        let label;
                        if (finished < total) {
                            label = t("transfer_label_in_progress");
                        } else if (failed > 0 && done === 0 && cancelled === 0) {
                            label = t("transfer_label_failed");
                        } else if (failed > 0) {
                            label = t("transfer_label_partial_done");
                        } else if (cancelled === total) {
                            label = t("transfer_label_cancelled");
                        } else if (cancelled > 0 && done > 0) {
                            label = t("transfer_label_partial_cancel");
                        } else {
                            label = t("transfer_label_done");
                        }

                        const barStyle = {
                            ...styles.progressFill,
                            width: "0%",
                            background: failed > 0 ? "#facc15" : barColor(label === t("transfer_label_done") ? "done" : "uploading", "upload"),
                        };
                        const groupFinished = finished >= total && total > 0;
                        const progressEntry = groupProgressMap.get(id);
                        const computedPercent = Math.min(100, progressEntry?.percent ?? percent ?? 0);
                        barStyle.width = `${computedPercent}%`;
                        const groupEtaSeconds = groupEtaMap.get(id);
                        const groupEtaLabel = formatEta(groupEtaSeconds);
                        const hasByteStats = (progressEntry?.totalBytes ?? 0) > 0;

                        const rawGroupName = name || t("transfer_group_default");
                        const displayGroupName = truncateName(rawGroupName);

                        return (
                            <div key={id || `group-${name}`} style={styles.groupCard}>
                                <div style={styles.row}>
                                    <div style={styles.taskMain}>
                                        <img alt={t("upload_overlay_folder_label")} src={arrowUpIcon} style={styles.icon} />
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
                                        {t("transfer_meta_files")
                                            .replace("{done}", String(done))
                                            .replace("{total}", String(total))}
                                    </span>
                                    {hasByteStats && (
                                        <span>
                                            {t("transfer_meta_progress").replace(
                                                "{percent}",
                                                String(computedPercent)
                                            )}
                                        </span>
                                    )}
                                    {groupEtaLabel && (
                                        <span>{t("transfer_meta_eta").replace("{eta}", groupEtaLabel)}</span>
                                    )}
                                    {failed > 0 && (
                                        <span style={styles.error}>
                                            {t("transfer_meta_errors").replace("{count}", String(failed))}
                                        </span>
                                    )}
                                    {cancelled > 0 && (
                                        <span>{t("transfer_meta_cancelled").replace("{count}", String(cancelled))}</span>
                                    )}
                                </div>
                                <div style={styles.progress}>
                                    <div style={barStyle} />
                                </div>
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    <button className="btn ghost" type="button" onClick={() => onCancelGroup(id)}>
                                        {t("action_cancel")}
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
                                        {t("action_remove")}
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    {soloUploadTasks.map((task) => {
                        const { id, name, status, percent = 0, error, etaSeconds } = task;
                        const rawName = name || t("transfer_task_untitled");
                        const displayName = truncateName(rawName);
                        const canCancel = ["queued", "init", "uploading"].includes(status);
                        const canRemove = ["done", "cancelled", "error"].includes(status);
                        const safePercent = Math.min(100, Math.max(0, percent));
                        const etaLabel = formatEta(etaSeconds);
                        return (
                            <div key={id} style={styles.taskCard}>
                                <div style={styles.row}>
                                    <div style={styles.taskMain}>
                                        <img alt={t("upload_overlay_uploading")} src={arrowUpIcon} style={styles.icon} />
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
                                        {uploadStatusLabel(status)} -{" "}
                                        {t("transfer_meta_progress").replace("{percent}", String(safePercent))}
                                    </span>
                                    {etaLabel && <span>{t("transfer_meta_eta").replace("{eta}", etaLabel)}</span>}
                                    {error && <span style={styles.error}>{error}</span>}
                                </div>
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    {canCancel && (
                                        <button className="btn ghost" type="button" onClick={() => onCancelTask(id)}>
                                            {t("action_cancel")}
                                        </button>
                                    )}
                                    {canRemove && (
                                        <button className="btn secondary" type="button" onClick={() => onRemoveTask(id)}>
                                            {t("action_remove")}
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
                            <img alt={t("menu_download")} src={arrowDownIcon} style={styles.icon} />
                            <span>{t("transfer_downloads")}</span>
                        </div>
                        <div style={styles.sectionActions}>
                            <button className="btn ghost" type="button" onClick={onClearFinished}>
                                {t("transfer_clear_finished")}
                            </button>
                            <button className="btn ghost" type="button" onClick={onHide}>
                                {t("transfer_hide")}
                            </button>
                        </div>
                    </div>

                    {downloadTasks.map((task) => {
                        const { id, name, progress = 0, status, kind, error, etaSeconds, integrityCorrupted } = task;
                        const rawName = name || t("transfer_task_untitled");
                        const displayName = truncateName(rawName);
                        const subtitle =
                            kind === "folder"
                                ? t("transfer_subtitle_folder")
                                : t("transfer_subtitle_file");
                        const canCancel = status === "running";
                        const canRemove = ["error", "canceled", "done"].includes(status);
                        const safeProgress = Math.min(100, Math.max(0, progress || 0));
                        const etaLabel = formatEta(etaSeconds);
                        const errorMessage = integrityCorrupted
                            ? t("transfer_integrity_error")
                            : error;
                        return (
                            <div key={id} style={styles.taskCard}>
                                <div style={styles.row}>
                                    <div style={styles.taskMain}>
                                        <img alt={t("menu_download")} src={arrowDownIcon} style={styles.icon} />
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
                                        {downloadStatusLabel(status)} -{" "}
                                        {t("transfer_meta_progress").replace(
                                            "{percent}",
                                            String(safeProgress)
                                        )}
                                    </span>
                                    {etaLabel && <span>{t("transfer_meta_eta").replace("{eta}", etaLabel)}</span>}
                                </div>
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    {canCancel && (
                                        <button className="btn ghost" type="button" onClick={() => onCancel(id)}>
                                            {t("action_cancel")}
                                        </button>
                                    )}
                                    {canRemove && (
                                        <button className="btn secondary" type="button" onClick={() => onRemove(id)}>
                                            {t("action_remove")}
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
