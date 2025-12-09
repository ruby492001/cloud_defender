import { useMemo, useState } from "react";

export default function StorageMenu({ user, storages, activeId, onSelect, onAdd, onLogout, onDelete }) {
    const [open, setOpen] = useState(false);
    const initials = useMemo(() => (user?.login ? user.login.slice(0, 2).toUpperCase() : "??"), [user]);

    return (
        <div className="storage-menu">
            <button className="avatar" type="button" onClick={() => setOpen((v) => !v)} aria-label="storages">
                {initials}
            </button>
            {open && (
                <div className="storage-menu-popup">
                    <div className="storage-menu-list">
                        {storages.map((s) => (
                            <button
                                key={s.id}
                                className={`storage-item ${s.id === activeId ? "active" : ""}`}
                                type="button"
                                onClick={() => {
                                    onSelect?.(s.id);
                                    setOpen(false);
                                }}
                            >
                                <span className="storage-name">{s.name}</span>
                                <span
                                    className="storage-delete"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDelete?.(s);
                                        setOpen(false);
                                    }}
                                    aria-label="Удалить хранилище"
                                >
                                    ×
                                </span>
                            </button>
                        ))}
                        {storages.length === 0 && <div className="muted">Нет доступных хранилищ</div>}
                    </div>
                    <div className="storage-menu-actions">
                        <button className="btn primary" type="button" onClick={() => { setOpen(false); onAdd?.(); }}>
                            Добавить хранилище
                        </button>
                        <button className="btn ghost" type="button" onClick={() => { setOpen(false); onLogout?.(); }}>
                            Выйти
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
