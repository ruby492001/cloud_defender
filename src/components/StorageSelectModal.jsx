import React from "react";

export default function StorageSelectModal({ open, storages = [], onSelect }) {
    if (!open) return null;

    return (
        <div className="modal">
            <div className="dialog" style={{ minWidth: 520 }}>
                <div className="dialog-head">
                    <div style={{ fontWeight: 700, fontSize: 18 }}>Выберите хранилище</div>
                </div>
                <div className="dialog-body" style={{ paddingTop: 8 }}>
                    {storages.length === 0 ? (
                        <div className="empty">Нет доступных хранилищ</div>
                    ) : (
                        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 8px" }}>
                            <thead>
                                <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 13 }}>
                                    <th style={{ padding: "6px 10px" }}>Имя</th>
                                    <th style={{ padding: "6px 10px" }}>Путь</th>
                                    <th style={{ padding: "6px 10px", width: 120 }}>Действие</th>
                                </tr>
                            </thead>
                            <tbody>
                                {storages.map((s) => (
                                    <tr key={s.id} style={{ background: "rgba(59,130,246,0.08)" }}>
                                        <td style={{ padding: "10px 12px", fontWeight: 600 }}>{s.name || "Хранилище"}</td>
                                        <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{s.root_path || "/"}</td>
                                        <td style={{ padding: "10px 12px" }}>
                                            <button className="btn primary" type="button" onClick={() => onSelect?.(s.id)}>
                                                Выбрать
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
