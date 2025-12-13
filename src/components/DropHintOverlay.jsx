// src/components/DropHintOverlay.jsx
import React from "react";
import { t } from "../strings.js";

export default function DropHintOverlay({ visible = false }) {
    if (!visible) return null;
    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15, 23, 42, 0.15)",
                backdropFilter: "blur(1px)",
                zIndex: 999998,
                pointerEvents: "none",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    inset: 16,
                    border: "2px dashed #94a3b8",
                    borderRadius: 16,
                }}
            />
            <div
                style={{
                    position: "fixed",
                    right: 16,
                    bottom: 16,
                    background: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: 10,
                    padding: "10px 14px",
                    fontSize: 13,
                    boxShadow: "0 8px 24px rgba(0,0,0,.15)",
                    color: "#334155",
                }}
            >
                {t("drop_hint")}
            </div>
        </div>
    );
}
