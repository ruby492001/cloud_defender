// src/components/UploadOverlay.jsx
import React from "react";
import { t } from "../strings.js";

export default function UploadOverlay({
    tasks = [],
    groups = [],
    hidden = false,
    allDone = false,
    onCancelTask = () => {},
    onRemoveTask = () => {},
    onCancelGroup = () => {},
    onRemoveGroup = () => {},
    onClose = () => {},
}) {
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const safeGroups = Array.isArray(groups) ? groups : [];

    if (hidden || (safeTasks.length === 0 && safeGroups.length === 0)) return null;

    const fileRows = safeTasks.filter((t) => !t.groupId);

    const statusLabel = (s) =>
        s === "queued"
            ? t("upload_overlay_queue")
            : s === "init"
                ? t("upload_overlay_init")
                : s === "uploading"
                    ? t("upload_overlay_uploading")
                    : s === "done"
                        ? t("upload_overlay_done")
                        : s === "cancelled"
                            ? t("upload_overlay_cancelled")
                            : t("upload_overlay_error");

    return (
        <div
            style={{
                position: "fixed",
                right: 16,
                bottom: 16,
                width: 460,
                maxWidth: "calc(100vw - 24px)",
                maxHeight: "70vh",
                overflowY: "auto",
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                boxShadow: "0 10px 30px rgba(0,0,0,.15)",
                zIndex: 999999,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 16, flex: 1 }}>
                    {t("upload_overlay_title")}
                </div>
                {allDone && (
                    <button
                        onClick={onClose}
                        style={{ border: "1px solid #ddd", background: "white", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}
                    >
                        {t("upload_overlay_close")}
                    </button>
                )}
            </div>

            {safeGroups.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginBottom: fileRows.length ? 12 : 0 }}>
                    {safeGroups.map((g) => {
                        const done = g?.done ?? 0;
                        const failed = g?.failed ?? 0;
                        const cancelled = g?.cancelled ?? 0;
                        const total = g?.total ?? 0;
                        const finished = done + failed + cancelled;
                        const percent = Math.floor((Math.min(finished, total) / Math.max(total, 1)) * 100);

                        let label;
                        if (finished < total) {
                            label = t("upload_overlay_uploading");
                        } else if (failed > 0 && done === 0 && cancelled === 0) {
                            label = t("upload_overlay_error");
                        } else if (failed > 0) {
                            label = t("upload_overlay_partial_error");
                        } else if (cancelled === total) {
                            label = t("upload_overlay_cancelled");
                        } else if (cancelled > 0 && done > 0) {
                            label = t("upload_overlay_partial_cancel");
                        } else {
                            label = t("upload_overlay_done");
                        }

                        const barColor =
                            failed > 0
                                ? "#ef4444"
                                : cancelled === total
                                    ? "#9ca3af"
                                    : cancelled > 0
                                        ? "#f59e0b"
                                        : finished >= total
                                            ? "#10b981"
                                            : "#4f46e5";

                        const subtitle = `${done} / ${total}${failed ? ` (${t("transfer_meta_errors").replace("{count}", failed)})` : ""}${cancelled ? ` (${t("transfer_meta_cancelled").replace("{count}", cancelled)})` : ""}`;
                        const canCancel = finished < total;

                        return (
                            <div key={g.id} style={{ border: "1px solid #f3f4f6", borderRadius: 8, padding: 10 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ flex: 1, fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>
                                        {g?.name ?? t("upload_overlay_folder_label")}
                                    </div>
                                    {canCancel ? (
                                        <button
                                            onClick={() => onCancelGroup(g.id)}
                                            style={{
                                                fontSize: 12,
                                                padding: "4px 8px",
                                                border: "1px solid #ddd",
                                                borderRadius: 6,
                                                background: "transparent",
                                                cursor: "pointer",
                                            }}
                                        >
                                            {t("upload_overlay_cancel")}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => onRemoveGroup(g.id)}
                                            style={{
                                                fontSize: 12,
                                                padding: "4px 8px",
                                                border: "1px solid #ddd",
                                                borderRadius: 6,
                                                background: "transparent",
                                                cursor: "pointer",
                                            }}
                                        >
                                            {t("upload_overlay_remove")}
                                        </button>
                                    )}
                                </div>

                                <div style={{ height: 6, background: "#eee", borderRadius: 6, marginTop: 8 }}>
                                    <div
                                        style={{
                                            width: `${percent}%`,
                                            height: "100%",
                                            borderRadius: 6,
                                            background: barColor,
                                            transition: "width .2s",
                                        }}
                                    />
                                </div>
                                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                                    {label} • {subtitle}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {fileRows.length > 0 && (
                <div style={{ display: "grid", gap: 8 }}>
                    {fileRows.map((tTask) => {
                        const canCancel = ["queued", "init", "uploading"].includes(tTask.status);
                        const canRemove = ["done", "cancelled", "error"].includes(tTask.status);
                        const pct = tTask.status === "queued" ? 0 : tTask.percent ?? 0;

                        const barColor =
                            tTask.status === "error"
                                ? "#ef4444"
                                : tTask.status === "cancelled"
                                    ? "#9ca3af"
                                    : tTask.status === "done"
                                        ? "#10b981"
                                        : "#4f46e5";

                        return (
                            <div key={tTask.id} style={{ border: "1px solid #f3f4f6", borderRadius: 8, padding: 10 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ flex: 1, fontSize: 13, wordBreak: "break-all" }}>{tTask.name}</div>
                                    {canCancel && (
                                        <button
                                            onClick={() => onCancelTask(tTask.id)}
                                            style={{
                                                fontSize: 12,
                                                padding: "4px 8px",
                                                border: "1px solid #ddd",
                                                borderRadius: 6,
                                                background: "transparent",
                                                cursor: "pointer",
                                            }}
                                        >
                                            {t("upload_overlay_cancel")}
                                        </button>
                                    )}
                                    {canRemove && (
                                        <button
                                            onClick={() => onRemoveTask(tTask.id)}
                                            style={{
                                                fontSize: 12,
                                                padding: "4px 8px",
                                                border: "1px solid #ddd",
                                                borderRadius: 6,
                                                background: "transparent",
                                                cursor: "pointer",
                                            }}
                                        >
                                            {t("upload_overlay_remove")}
                                        </button>
                                    )}
                                </div>

                                <div style={{ height: 6, background: "#eee", borderRadius: 6, marginTop: 8 }}>
                                    <div
                                        style={{
                                            width: `${pct}%`,
                                            height: "100%",
                                            borderRadius: 6,
                                            background: barColor,
                                            transition: "width .2s",
                                        }}
                                    />
                                </div>
                                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                                    {statusLabel(tTask.status)} • {tTask.percent ?? 0}%
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
