import React, { useEffect, useRef, useState } from "react";
import { t } from "../strings.js";

export default function MoveCopyDialog({
    api,
    open,
    mode,
    onClose,
    onConfirm,
    startFolder = "root",
    startName = t("movecopy_current_folder"),
}) {
    const [stack, setStack] = useState([{ id: startFolder, name: startName }]);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const listRef = useRef(null);

    useEffect(() => {
        if (open) {
            setStack([{ id: startFolder, name: startName || t("movecopy_current_folder") }]);
            void load(startFolder, true, startName);
        }
    }, [open, startFolder, startName]);

    const load = async (fid, replace = false, label) => {
        setLoading(true);
        try {
            const res = await api.listOnlyFolders(fid);
            setItems(res.files || []);
            if (replace) {
                const name = label || (fid === "root" ? t("movecopy_root") : t("movecopy_folder"));
                setStack([{ id: fid, name }]);
            }
        } finally {
            setLoading(false);
        }
    };

    const openFolder = async (folder) => {
        setStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
        await load(folder.id);
    };

    const upTo = async (id) => {
        const idx = stack.findIndex((x) => x.id === id);
        if (idx >= 0) {
            setStack(stack.slice(0, idx + 1));
            await load(id, false);
        }
    };

    if (!open) return null;
    return (
        <div className="modal" onMouseDown={(e) => { if (e.target.classList.contains("modal")) onClose(); }}>
            <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-head">
                    <div style={{ fontWeight: 700 }}>
                        {mode === "move"
                            ? t("movecopy_title_move")
                            : t("movecopy_title_copy")}
                    </div>
                    <button className="btn" onClick={onClose}>{t("movecopy_close")}</button>
                </div>

                <div className="dialog-body">
                    <div className="breadcrumb" style={{ borderBottom: "none", padding: ".4rem .75rem" }}>
                        {stack.map((bc, i) => (
                            <span key={bc.id}>
                                <a href="#" onClick={(e) => { e.preventDefault(); upTo(bc.id); }}>{bc.name}</a>
                                {i < stack.length - 1 && <span style={{ color: "var(--muted)" }}> / </span>}
                            </span>
                        ))}
                    </div>

                    <div ref={listRef} className="list" style={{ borderTop: "1px solid #263244" }}>
                        <div className="row th">
                            <div></div><div style={{ fontWeight: 700 }}>{t("movecopy_folder")}</div><div></div><div></div><div></div>
                        </div>
                        {items.length === 0 && !loading && <div className="empty">{t("movecopy_no_folders")}</div>}
                        {items.map((it) => (
                            <div key={it.id} className="row" onDoubleClick={() => openFolder(it)}>
                                <div></div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <img className="type-icon" src={folderSvg} alt={t("movecopy_folder")} />
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                                </div>
                                <div></div><div></div><div></div>
                            </div>
                        ))}
                        {loading && <div className="empty">{t("movecopy_loading")}</div>}
                    </div>
                </div>

                <div className="dialog-foot">
                    <button className="btn" onClick={onClose}>{t("movecopy_cancel")}</button>
                    <button className="btn" onClick={() => onConfirm(stack[stack.length - 1].id)}>
                        {mode === "move" ? t("movecopy_move_here") : t("movecopy_copy_here")}
                    </button>
                </div>
            </div>
        </div>
    );
}

const folderSvg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='%23f59e0b'><path d='M10 4H4a2 2 0 0 0-2 2v2h20V8a2 2 0 0 0-2-2h-8l-2-2z'/><path d='M22 10H2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8z'/></svg>`;
