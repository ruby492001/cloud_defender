import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { ENCRYPTION_ALGORITHMS, DEFAULT_ENCRYPTION_ALGORITHM } from "../crypto/algorithms.js";
import {
    DEFAULT_HASH_ALGORITHM,
    DEFAULT_FILENAME_ENCRYPTION,
    DEFAULT_DIRECTORY_NAME_ENCRYPTION,
} from "../crypto/config.js";

const sessionPasswordCache = new Map();
const PasswordPromptContext = createContext(null);

export function PasswordPromptProvider({ children }) {
    const [requestState, setRequestState] = useState(null);
    const pendingRef = useRef(null);
    const idCounter = useRef(0);
    const cacheRef = useRef(sessionPasswordCache); // in-memory per-session cache: storageId -> password payload

    const finishRequest = useCallback((result) => {
        const pending = pendingRef.current;
        if (!pending) return;
        pendingRef.current = null;
        setRequestState(null);
        pending.resolve(result);
    }, []);

    const cancelPendingPrompt = useCallback(() => {
        finishRequest(null);
    }, [finishRequest]);

    const requestPassword = useCallback((options = {}) => {
        if (options.storageId && cacheRef.current.has(options.storageId) && !options.forcePrompt) {
            return Promise.resolve(cacheRef.current.get(options.storageId));
        }
        if (pendingRef.current?.promise) {
            return pendingRef.current.promise;
        }
        const id = ++idCounter.current;
        let resolver = null;
        const promise = new Promise((resolve) => {
            resolver = resolve;
            setRequestState({ id, options });
        });
        pendingRef.current = { resolve: resolver, id, promise };
        return promise;
    }, []);

    const onCancel = useCallback(() => {
        finishRequest(null);
    }, [finishRequest]);

    const onSubmit = useCallback(
        (value) => {
            if (requestState?.options?.storageId && value) {
                cacheRef.current.set(requestState.options.storageId, value);
            }
            finishRequest(value);
        },
        [finishRequest, requestState]
    );

    const contextValue = useMemo(
        () => ({
            requestPassword,
            clearPasswordCache: () => cacheRef.current.clear(),
            cancelPendingPrompt,
        }),
        [requestPassword, cancelPendingPrompt]
    );

    return (
        <PasswordPromptContext.Provider value={contextValue}>
            {children}
            <PasswordPromptDialog request={requestState} onSubmit={onSubmit} onCancel={onCancel} />
        </PasswordPromptContext.Provider>
    );
}

export function usePasswordPrompt() {
    const ctx = useContext(PasswordPromptContext);
    if (!ctx) {
        throw new Error("usePasswordPrompt must be used inside PasswordPromptProvider");
    }
    return ctx;
}

export function clearPasswordCacheGlobal() {
    sessionPasswordCache.clear();
}

function PasswordPromptDialog({ request, onSubmit, onCancel }) {
    const [value, setValue] = useState("");
    const [confirmValue, setConfirmValue] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [localError, setLocalError] = useState("");
    const [encryptionAlgorithm, setEncryptionAlgorithm] = useState(DEFAULT_ENCRYPTION_ALGORITHM);
    const [hashAlgorithm, setHashAlgorithm] = useState(DEFAULT_HASH_ALGORITHM);
    const [mode, setMode] = useState("own");
    const [rcloneFilenameEncryption, setRcloneFilenameEncryption] = useState(DEFAULT_FILENAME_ENCRYPTION);
    const [rcloneDirectoryEncryption, setRcloneDirectoryEncryption] = useState(
        DEFAULT_DIRECTORY_NAME_ENCRYPTION ? "true" : "false"
    );
    const [rclonePassword, setRclonePassword] = useState("");
    const [rclonePassword2, setRclonePassword2] = useState("");

    const options = request?.options || {};
    const attempt = typeof options.attempt === "number" ? options.attempt : 0;

    useEffect(() => {
        setValue("");
        setConfirmValue("");
        setShowPassword(false);
        setLocalError("");
        setEncryptionAlgorithm(DEFAULT_ENCRYPTION_ALGORITHM);
        setHashAlgorithm(DEFAULT_HASH_ALGORITHM);
        setMode("own");
        setRcloneFilenameEncryption(DEFAULT_FILENAME_ENCRYPTION);
        setRcloneDirectoryEncryption(DEFAULT_DIRECTORY_NAME_ENCRYPTION ? "true" : "false");
        setRclonePassword("");
        setRclonePassword2("");
    }, [request?.id]);

    if (!request) {
        return null;
    }

    const needsConfirmation = !!options.confirm;
    const message =
        attempt > 0
            ? options.message || "Incorrect password. Try again."
            : options.initialMessage || options.message || "Enter the password";
    const title =
        options.title ||
        (options.reason === "setup"
            ? "Create Password"
            : options.reason === "unlock"
            ? "Password Required"
            : "Password");
    const errorMessage = localError || options.errorMessage || "";

    const handleSubmit = (event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) {
            setLocalError("Password cannot be empty");
            return;
        }
        if (needsConfirmation && trimmed !== confirmValue.trim()) {
            setLocalError("Passwords do not match");
            return;
        }
        const normalizedMode = mode === "rclone" ? "rclone" : "own";
        if (normalizedMode === "rclone") {
            if (!rclonePassword.trim()) {
                setLocalError("Primary rclone password is required");
                return;
            }
        }
        setLocalError("");
        if (options.reason === "setup") {
            const payload = {
                password: trimmed,
                encryptionAlgorithm,
                hashAlgorithm,
                mode: normalizedMode,
            };
            if (normalizedMode === "rclone") {
                payload.rclone = {
                    filenameEncryption: rcloneFilenameEncryption,
                    directoryNameEncryption: rcloneDirectoryEncryption === "true",
                    password: rclonePassword.trim(),
                    password2: rclonePassword2.trim(),
                };
            }
            onSubmit(payload);
        } else {
            onSubmit(trimmed);
        }
    };

    return (
        <div style={overlayStyles.backdrop}>
            <div style={overlayStyles.card}>
                <h2 style={overlayStyles.title}>{title}</h2>
                <p style={overlayStyles.message}>{message}</p>
                <form onSubmit={handleSubmit} style={overlayStyles.form}>
                    {options.reason === "setup" && (
                        <label style={overlayStyles.label}>
                            Encryption mode
                            <select
                                value={mode}
                                onChange={(e) => {
                                    setMode(e.target.value);
                                    setLocalError("");
                                }}
                                style={overlayStyles.select}
                            >
                                <option value="own">Client-side encryption</option>
                                <option value="rclone">rclone</option>
                            </select>
                        </label>
                    )}

                    <label style={overlayStyles.label}>
                        Password
                        <div style={overlayStyles.inputRow}>
                            <input
                                type={showPassword ? "text" : "password"}
                                value={value}
                                autoFocus
                                onChange={(e) => setValue(e.target.value)}
                                style={overlayStyles.input}
                                placeholder="Enter password"
                            />
                            <button
                                type="button"
                                style={overlayStyles.toggle}
                                onClick={() => setShowPassword((flag) => !flag)}
                            >
                                {showPassword ? "Hide" : "Show"}
                            </button>
                        </div>
                    </label>

                    {needsConfirmation && (
                        <label style={overlayStyles.label}>
                            Confirm password
                            <input
                                type={showPassword ? "text" : "password"}
                                value={confirmValue}
                                onChange={(e) => setConfirmValue(e.target.value)}
                                style={overlayStyles.input}
                                placeholder="Repeat password"
                            />
                        </label>
                    )}
                    {options.reason === "setup" && mode === "own" && (
                        <>
                            <label style={overlayStyles.label}>
                                Encryption algorithm
                                <select
                                    value={encryptionAlgorithm}
                                    onChange={(e) => setEncryptionAlgorithm(e.target.value)}
                                    style={overlayStyles.select}
                                >
                                    {ENCRYPTION_ALGORITHMS.map((alg) => (
                                        <option key={alg} value={alg}>
                                            {alg}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label style={overlayStyles.label}>
                                Hash algorithm
                                <select
                                    value={hashAlgorithm}
                                    onChange={(e) => setHashAlgorithm(e.target.value)}
                                    style={overlayStyles.select}
                                >
                                    {HASH_ALGORITHMS.map((alg) => (
                                        <option key={alg} value={alg}>
                                            {alg}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </>
                    )}
                    {options.reason === "setup" && mode === "rclone" && (
                        <>
                            <label style={overlayStyles.label}>
                                How to encrypt the filenames.
                                <select
                                    value={rcloneFilenameEncryption}
                                    onChange={(e) => setRcloneFilenameEncryption(e.target.value)}
                                    style={overlayStyles.select}
                                >
                                    <option value="standard">Encrypt the filenames</option>
                                    <option value="obfuscate">Very simple filename obfuscation</option>
                                    <option value="off">Don't encrypt the file names</option>
                                </select>
                            </label>
                            <label style={overlayStyles.label}>
                                Encrypt directory name
                                <select
                                    value={rcloneDirectoryEncryption}
                                    onChange={(e) => setRcloneDirectoryEncryption(e.target.value)}
                                    style={overlayStyles.select}
                                >
                                    <option value="true">Encrypt directory names</option>
                                    <option value="false">Don't encrypt directory names, leave them intact.</option>
                                </select>
                            </label>
                            <label style={overlayStyles.label}>
                                password
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={rclonePassword}
                                    onChange={(e) => setRclonePassword(e.target.value)}
                                    style={overlayStyles.input}
                                    placeholder="password from rclone config"
                                />
                            </label>
                            <label style={overlayStyles.label}>
                                password2 (optional)
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={rclonePassword2}
                                    onChange={(e) => setRclonePassword2(e.target.value)}
                                    style={overlayStyles.input}
                                    placeholder="password2 from rclone config (optional)"
                                />
                            </label>
                        </>
                    )}

                    {errorMessage && <div style={overlayStyles.error}>{errorMessage}</div>}

                    <div style={overlayStyles.actions}>
                        <button type="button" style={overlayStyles.secondary} onClick={onCancel}>
                            Cancel
                        </button>
                        <button type="submit" style={overlayStyles.primary}>
                            Continue
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

const overlayStyles = {
    backdrop: {
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        zIndex: 6000,
        padding: 24,
    },
    card: {
        width: "100%",
        maxWidth: 420,
        background: "#0f172a",
        color: "#e2e8f0",
        borderRadius: 16,
        border: "1px solid rgba(148, 163, 184, 0.2)",
        boxShadow: "0 24px 60px rgba(15,23,42,0.55)",
        padding: "28px 32px",
    },
    title: {
        margin: 0,
        fontSize: 22,
        fontWeight: 600,
        color: "#f8fafc",
    },
    message: {
        marginTop: 12,
        marginBottom: 20,
        lineHeight: 1.5,
        color: "#cbd5f5",
    },
    form: {
        display: "flex",
        flexDirection: "column",
        gap: 18,
    },
    label: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontSize: 14,
    },
    inputRow: {
        display: "flex",
        gap: 8,
        alignItems: "center",
    },
    input: {
        flex: 1,
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(148, 163, 184, 0.35)",
        background: "rgba(15, 23, 42, 0.55)",
        color: "#f8fafc",
        fontSize: 15,
    },
    select: {
        width: "100%",
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(148, 163, 184, 0.35)",
        background: "rgba(15, 23, 42, 0.55)",
        color: "#f8fafc",
        fontSize: 15,
    },
    toggle: {
        padding: "9px 12px",
        borderRadius: 8,
        border: "1px solid rgba(148, 163, 184, 0.35)",
        background: "rgba(148, 163, 184, 0.1)",
        color: "#e2e8f0",
        cursor: "pointer",
    },
    error: {
        color: "#f87171",
        fontSize: 13,
    },
    actions: {
        display: "flex",
        justifyContent: "flex-end",
        gap: 12,
        marginTop: 8,
    },
    secondary: {
        padding: "10px 18px",
        borderRadius: 10,
        border: "1px solid rgba(148, 163, 184, 0.35)",
        background: "transparent",
        color: "#cbd5f5",
        cursor: "pointer",
    },
    primary: {
        padding: "10px 18px",
        borderRadius: 10,
        border: "none",
        background: "linear-gradient(135deg, #3b82f6, #6366f1)",
        color: "#f8fafc",
        cursor: "pointer",
        fontWeight: 600,
    },
};

const HASH_ALGORITHMS = ["SHA-256", "SHA-512", "SHA3-256", "SHA3-512", "BLAKE2b512", "BLAKE2s256"];

