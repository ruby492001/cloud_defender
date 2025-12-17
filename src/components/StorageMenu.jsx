import { useMemo, useState } from "react";
import { t } from "../strings.js";

export default function StorageMenu({
    user,
    storages,
    activeId,
    onSelect,
    onAdd,
    onLogout,
    onDelete,
    onChangePassword,
    onChangeStoragePassword,
    onExportRclone,
}) {
    const [open, setOpen] = useState(false);
    const [accountOpen, setAccountOpen] = useState(false);
    const [storageMenuId, setStorageMenuId] = useState(null);
    const initials = useMemo(() => (user?.login ? user.login.slice(0, 2).toUpperCase() : "??"), [user]);
    const fullLogin = user?.login || "—";

    const closeAll = () => {
        setOpen(false);
        setAccountOpen(false);
        setStorageMenuId(null);
    };

    return (
        <div className="storage-menu">
            <button
                className="avatar"
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label={t("storage_list_title")}
            >
                {initials}
            </button>
            {open && (
                <div className="storage-menu-popup">
                    <div className="storage-menu-header">{t("storage_list_title")}</div>
                    <div className="storage-menu-list">
                        <div className="storage-menu-scroll">
                            {storages.map((s) => {
                                const opened = storageMenuId === s.id;
                                return (
                                    <div key={s.id} className={`storage-entry ${s.id === activeId ? "active" : ""}`}>
                                        <button
                                            type="button"
                                            className="storage-entry-main"
                                            onClick={() => {
                                                onSelect?.(s.id);
                                                setStorageMenuId((prev) => (prev === s.id ? null : s.id));
                                                setAccountOpen(false);
                                            }}
                                        >
                                            <span className="storage-name">{s.name}</span>
                                            <span className="storage-toggle">{opened ? "v" : ">"}</span>
                                        </button>
                                        {opened && (
                                            <div className="storage-dropdown">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        onSelect?.(s.id);
                                                        closeAll();
                                                        onChangeStoragePassword?.(s);
                                                    }}
                                                >
                                                    {t("storage_change_password")}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="danger"
                                                    onClick={() => {
                                                        closeAll();
                                                        onDelete?.(s);
                                                    }}
                                                >
                                                    {t("storage_delete")}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {storages.length === 0 && <div className="muted">{t("storage_none")}</div>}
                        </div>
                        <button
                            className="storage-entry add-storage"
                            type="button"
                            onClick={() => {
                                closeAll();
                                onAdd?.();
                            }}
                        >
                            <span className="storage-name">{t("storage_add")}</span>
                            <span className="storage-add-icon">+</span>
                        </button>
                    </div>

                    <div className="storage-menu-divider" />

                    <div className="storage-account">
                        <div className="storage-menu-header subtle">{t("account_section_title")}</div>
                        <button
                            className="storage-entry account-toggle"
                            type="button"
                            onClick={() => {
                                setAccountOpen((v) => !v);
                                setStorageMenuId(null);
                            }}
                            aria-expanded={accountOpen}
                        >
                            <span className="account-pill">
                                <span className="avatar sm">{initials}</span>
                                <span className="account-login">{fullLogin}</span>
                            </span>
                            <span className="storage-add-icon">{accountOpen ? "v" : ">"}</span>
                        </button>
                        {accountOpen && (
                            <div className="account-dropdown">
                                <button
                                    type="button"
                                    onClick={() => {
                                        closeAll();
                                        onChangePassword?.();
                                    }}
                                >
                                    {t("account_change_password")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        closeAll();
                                        onExportRclone?.();
                                    }}
                                >
                                    {t("account_export_rclone")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        closeAll();
                                        onLogout?.();
                                    }}
                                >
                                    {t("account_logout")}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
