import React from "react";

/**
 * Lightweight blocking spinner used while storage or Drive configuration initializes.
 */
export default function StartupSpinner({ visible, message }) {
    if (!visible) return null;
    return (
        <div style={startupSpinnerStyles.backdrop}>
            <div style={startupSpinnerStyles.card}>
                <div style={startupSpinnerStyles.loader} />
                <div style={startupSpinnerStyles.text}>{message}</div>
            </div>
        </div>
    );
}

const startupSpinnerStyles = {
    backdrop: {
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(6px)",
        display: "grid",
        placeItems: "center",
        zIndex: 6000,
    },
    card: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding: "32px 48px",
        borderRadius: 20,
        background: "rgba(15, 23, 42, 0.9)",
        border: "1px solid rgba(148, 163, 184, 0.3)",
        boxShadow: "0 25px 70px rgba(0,0,0,0.6)",
        minWidth: 260,
        color: "#e5e7eb",
        fontSize: 16,
    },
    loader: {
        width: 56,
        height: 56,
        borderRadius: "50%",
        border: "6px solid rgba(148, 163, 184, 0.2)",
        borderTopColor: "#3b82f6",
        animation: "busyspin 0.9s linear infinite",
    },
    text: {
        fontSize: 18,
        fontWeight: 500,
    },
};
