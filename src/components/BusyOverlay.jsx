import React, { createContext, useContext, useMemo, useState } from "react";

const BusyContext = createContext(null);

export function useBusy() {
    const ctx = useContext(BusyContext);
    if (!ctx) {
        throw new Error("useBusy must be used inside BusyProvider");
    }
    return ctx;
}

export function BusyProvider({ children }) {
    const [counter, setCounter] = useState(0);
    const value = useMemo(() => {
        const start = (label = "") => {
            setCounter((x) => x + 1);
            let stopped = false;
            return () => {
                if (stopped) return;
                stopped = true;
                setCounter((x) => Math.max(0, x - 1));
            };
        };
        const stop = () => setCounter((x) => Math.max(0, x - 1));
        return {
            start,
            stop,
            isBusy: counter > 0,
        };
    }, [counter]);

    return (
        <BusyContext.Provider value={value}>
            {children}
            {counter > 0 && (
                <div style={overlayStyles.backdrop}>
                    <div style={overlayStyles.spinner}>
                        <div style={overlayStyles.loader} />
                        <div style={{ marginTop: 12, fontSize: 16 }}>Please wait…</div>
                    </div>
                </div>
            )}
        </BusyContext.Provider>
    );
}

const overlayStyles = {
    backdrop: {
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        zIndex: 5000,
    },
    spinner: {
        background: "#0f172a",
        color: "#e5e7eb",
        padding: "32px 48px",
        borderRadius: 16,
        border: "1px solid #334155",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        minWidth: 220,
    },
    loader: {
        width: 48,
        height: 48,
        borderRadius: "50%",
        border: "5px solid rgba(148, 163, 184, 0.25)",
        borderTopColor: "#3b82f6",
        animation: "busyspin 0.9s linear infinite",
    },
};

const style = document.createElement("style");
style.innerHTML = `
@keyframes busyspin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;
if (typeof document !== "undefined") {
    document.head.appendChild(style);
}
