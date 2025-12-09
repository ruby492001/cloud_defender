import { useState } from "react";
import { useGoogleLogin, hasGrantedAllScopesGoogle } from "@react-oauth/google";

const scopes = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive.appdata",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.install",
];

export default function AddStorageModal({ open, onClose, onCreate, blocking }) {
    const [name, setName] = useState("");
    const [rootPath, setRootPath] = useState("");
    const [code, setCode] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [googleReady, setGoogleReady] = useState(false);
    const [showValidation, setShowValidation] = useState(false);

    const googleLogin = useGoogleLogin({
        flow: "auth-code",
        scope: scopes.join(" "),
        onSuccess: (resp) => {
            if (hasGrantedAllScopesGoogle(resp, ...scopes)) {
                setCode(resp.code);
                setGoogleReady(true);
                setError("");
            } else {
                setError("Не выданы все разрешения Google Drive");
                setGoogleReady(false);
            }
        },
        onError: () => {
            setError("Не удалось выбрать Google аккаунт");
            setGoogleReady(false);
        },
    });

    const handleSubmit = async (event) => {
        event.preventDefault();
        setShowValidation(true);
        setError("");

        const trimmed = name.trim();
        if (!trimmed || !code) {
            if (!trimmed) setError("Укажите название хранилища");
            else setError("Выберите Google аккаунт");
            return;
        }
        setBusy(true);
        try {
            await onCreate?.({
                name: trimmed,
                root_path: rootPath?.trim() || "/",
                code,
            });
            setName("");
            setRootPath("");
            setCode(null);
            setGoogleReady(false);
            setShowValidation(false);
        } catch (e) {
            setError(e?.message || "Не удалось создать хранилище");
        } finally {
            setBusy(false);
        }
    };

    const nameError = showValidation && !name.trim() ? "Укажите название" : "";
    const googleError = showValidation && !code ? "Выберите Google аккаунт" : "";

    if (!open) return null;

    const canClose = !blocking;

    return (
        <div className="modal register-modal" onClick={() => (canClose ? onClose?.() : null)}>
            <div className="register-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="auth-card-head">
                    <div>
                        <p className="eyebrow">Новое хранилище</p>
                        <h3>Добавить</h3>
                    </div>
                </div>

                <form className="form" onSubmit={handleSubmit}>
                    <label className="field">
                        <span>Название</span>
                        <input
                            className="input"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder=""
                            required
                        />
                        {nameError && <div className="field-error">{nameError}</div>}
                    </label>
                    <label className="field">
                        <span>Корневой путь</span>
                        <input
                            className="input"
                            type="text"
                            value={rootPath}
                            onChange={(e) => setRootPath(e.target.value)}
                            placeholder=""
                        />
                    </label>

                    <label className="field">
                        <span>Google аккаунт</span>
                        <div className="google-select">
                            <span className={`status-dot ${googleReady ? "ok" : "warn"}`} aria-label="google status" />
                            <button
                                type="button"
                                className="btn secondary"
                                onClick={() => googleLogin()}
                                disabled={busy}
                            >
                                Выбрать
                            </button>
                        </div>
                        {googleError && <div className="field-error">{googleError}</div>}
                    </label>

                    <div className="form-actions">
                        <button className="btn primary" type="submit" disabled={busy}>
                            {busy ? "Добавляем..." : "Добавить"}
                        </button>
                    </div>
                </form>

                {error && <div className="alert" style={{ marginTop: 10 }}>{error}</div>}
            </div>
        </div>
    );
}
