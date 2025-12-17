import React, { createContext, useContext, useState, useCallback } from "react";

const DialogCtx = createContext(null);

export function useDialog() {
    const ctx = useContext(DialogCtx);
    if (!ctx) throw new Error("useDialog must be used within DialogProvider");
    return ctx;
}

export function DialogProvider({ children }) {
    const [promptState, setPromptState] = useState(null);
    const [confirmState, setConfirmState] = useState(null);

    const prompt = useCallback((options = {}) => {
        return new Promise((resolve) => {
            setPromptState({
                open: true,
                title: options.title || "Enter value",
                message: options.message || "",
                placeholder: options.placeholder || "",
                defaultValue: options.defaultValue || "",
                confirmText: options.confirmText || "OK",
                cancelText: options.cancelText || "Cancel",
                resolve,
            });
        });
    }, []);

    const confirm = useCallback((options = {}) => {
        return new Promise((resolve) => {
            const hasCancel = Object.prototype.hasOwnProperty.call(options, "cancelText");
            const cancelText = hasCancel ? options.cancelText : "Cancel";
            setConfirmState({
                open: true,
                title: options.title || "Confirm",
                message: options.message || "",
                confirmText: options.confirmText || "Continue",
                cancelText,
                resolve,
            });
        });
    }, []);

    const handlePromptSubmit = (value) => {
        if (!promptState) return;
        promptState.resolve(value);
        setPromptState(null);
    };
    const handlePromptCancel = () => handlePromptSubmit(null);

    const handleConfirm = (result) => {
        if (!confirmState) return;
        confirmState.resolve(result);
        setConfirmState(null);
    };

    return (
        <DialogCtx.Provider value={{ prompt, confirm }}>
            {children}
            {promptState?.open && (
                <PromptOverlay
                    state={promptState}
                    onSubmit={handlePromptSubmit}
                    onCancel={handlePromptCancel}
                />
            )}
            {confirmState?.open && (
                <Overlay>
                    <Card>
                        <Title>{confirmState.title}</Title>
                        {confirmState.message && <Message>{confirmState.message}</Message>}
                        <Actions>
                            {confirmState.cancelText !== null && confirmState.cancelText !== false && (
                                <button className="btn secondary" onClick={() => handleConfirm(false)}>
                                    {confirmState.cancelText}
                                </button>
                            )}
                            <button className="btn" onClick={() => handleConfirm(true)}>
                                {confirmState.confirmText}
                            </button>
                        </Actions>
                    </Card>
                </Overlay>
            )}
        </DialogCtx.Provider>
    );
}

const styles = {
    backdrop: {
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.7)",
        backdropFilter: "blur(3px)",
        display: "grid",
        placeItems: "center",
        zIndex: 7000,
        padding: 16,
    },
    card: {
        background: "#0f172a",
        border: "1px solid #1f2937",
        borderRadius: 10,
        padding: "18px 20px",
        width: "min(420px, 90vw)",
        color: "#e5e7eb",
        boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
    },
    title: { fontSize: 18, fontWeight: 700, marginBottom: 10 },
    message: { fontSize: 14, color: "#cbd5e1", marginBottom: 14, lineHeight: 1.4 },
    input: {
        width: "100%",
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid #1f2937",
        background: "#111827",
        color: "#e5e7eb",
        marginBottom: 14,
    },
    actions: {
        display: "flex",
        gap: 10,
        justifyContent: "flex-end",
        marginTop: 4,
    },
};

function Overlay({ children }) {
    return (
        <div style={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && e.stopPropagation()}>
            {children}
        </div>
    );
}
function Card({ children }) {
    return <div style={styles.card}>{children}</div>;
}
function Title({ children }) {
    return <div style={styles.title}>{children}</div>;
}
function Message({ children }) {
    return <div style={styles.message}>{children}</div>;
}
function Actions({ children }) {
    return <div style={styles.actions}>{children}</div>;
}

function PromptOverlay({ state, onSubmit, onCancel }) {
    const [value, setValue] = useState(state.defaultValue || "");
    return (
        <Overlay>
            <Card>
                <Title>{state.title}</Title>
                {state.message && <Message>{state.message}</Message>}
                <input
                    autoFocus
                    type="text"
                    value={value}
                    placeholder={state.placeholder}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            onSubmit(value);
                        }
                        if (e.key === "Escape") onCancel();
                    }}
                    style={styles.input}
                />
                <Actions>
                    <button className="btn secondary" onClick={onCancel}>
                        {state.cancelText}
                    </button>
                    <button className="btn" onClick={() => onSubmit(value)}>
                        {state.confirmText}
                    </button>
                </Actions>
            </Card>
        </Overlay>
    );
}
