// src/components/UploadOverlay.jsx
import React from "react";

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

    // файлы без группы показываем пофайлово
    const fileRows = safeTasks.filter((t) => !t.groupId);

    const statusLabel = (s) =>
        s === "queued"
            ? "В очереди"
            : s === "init"
                ? "Инициализация"
                : s === "uploading"
                    ? "Загрузка"
                    : s === "done"
                        ? "Готово"
                        : s === "cancelled"
                            ? "Отменено"
                            : "Ошибка";

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
                <div style={{ fontWeight: 600, fontSize: 16, flex: 1 }}>Загрузка в Google Drive</div>
                {allDone && (
                    <button
                        onClick={onClose}
                        style={{ border: "1px solid #ddd", background: "white", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}
                    >
                        Закрыть
                    </button>
                )}
            </div>

            {/* Папки (агрегированные группы) */}
            {safeGroups.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginBottom: fileRows.length ? 12 : 0 }}>
                    {safeGroups.map((g) => {
                        const done = g?.done ?? 0;
                        const failed = g?.failed ?? 0;
                        const cancelled = g?.cancelled ?? 0;
                        const total = g?.total ?? 0;
                        const finished = done + failed + cancelled;
                        const percent = Math.floor((Math.min(finished, total) / Math.max(total, 1)) * 100);

                        // Честный человекочитабельный статус группы
                        let label;
                        if (finished < total) {
                            label = "Загрузка";
                        } else if (failed > 0 && done === 0 && cancelled === 0) {
                            label = "Ошибка";
                        } else if (failed > 0) {
                            label = "Завершено с ошибками";
                        } else if (cancelled === total) {
                            label = "Отменено";
                        } else if (cancelled > 0 && done > 0) {
                            label = "Частично отменено";
                        } else {
                            label = "Готово";
                        }

                        // Цвет прогресс-бара по приоритету: ошибки > полная отмена > частичная отмена > готово > загрузка
                        const barColor =
                            failed > 0
                                ? "#ef4444" // красный
                                : cancelled === total
                                    ? "#9ca3af" // серый
                                    : cancelled > 0
                                        ? "#f59e0b" // оранжевый (частичная отмена)
                                        : finished >= total
                                            ? "#10b981" // зелёный
                                            : "#4f46e5"; // фиолетовый (в процессе)

                        const subtitle = `${done} / ${total}${
                            failed ? ` (ошибок: ${failed})` : ""
                        }${cancelled ? ` (отменено: ${cancelled})` : ""}`;

                        const canCancel = finished < total;

                        return (
                            <div key={g.id} style={{ border: "1px solid #f3f4f6", borderRadius: 8, padding: 10 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ flex: 1, fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>
                                        📁 {g?.name ?? "Папка"}
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
                                            Отмена
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
                                            Удалить
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
                                    {label} · {subtitle}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Одиночные файлы (не в группах) */}
            {fileRows.length > 0 && (
                <div style={{ display: "grid", gap: 8 }}>
                    {fileRows.map((t) => {
                        const canCancel = ["queued", "init", "uploading"].includes(t.status);
                        const canRemove = ["done", "cancelled", "error"].includes(t.status);
                        const pct = t.status === "queued" ? 0 : t.percent ?? 0;

                        const barColor =
                            t.status === "error"
                                ? "#ef4444"
                                : t.status === "cancelled"
                                    ? "#9ca3af"
                                    : t.status === "done"
                                        ? "#10b981"
                                        : "#4f46e5";

                        return (
                            <div key={t.id} style={{ border: "1px solid #f3f4f6", borderRadius: 8, padding: 10 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ flex: 1, fontSize: 13, wordBreak: "break-all" }}>{t.name}</div>
                                    {canCancel && (
                                        <button
                                            onClick={() => onCancelTask(t.id)}
                                            style={{
                                                fontSize: 12,
                                                padding: "4px 8px",
                                                border: "1px solid #ddd",
                                                borderRadius: 6,
                                                background: "transparent",
                                                cursor: "pointer",
                                            }}
                                        >
                                            Отмена
                                        </button>
                                    )}
                                    {canRemove && (
                                        <button
                                            onClick={() => onRemoveTask(t.id)}
                                            style={{
                                                fontSize: 12,
                                                padding: "4px 8px",
                                                border: "1px solid #ddd",
                                                borderRadius: 6,
                                                background: "transparent",
                                                cursor: "pointer",
                                            }}
                                        >
                                            Удалить
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
                                    {statusLabel(t.status)}
                                    {["uploading", "init", "done", "error", "cancelled"].includes(t.status) ? ` · ${pct}%` : ""}
                                    {t.error ? <span style={{ color: "#b91c1c" }}> · {t.error}</span> : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
