import { useState } from "react";
import { useGoogleLogin, hasGrantedAllScopesGoogle } from "@react-oauth/google";
import { t } from "../strings.js";

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
                setError(t("add_storage_error_perms"));
                setGoogleReady(false);
            }
        },
        onError: () => {
            setError(t("add_storage_error_google"));
            setGoogleReady(false);
        },
    });

    const handleSubmit = async (event) => {
        event.preventDefault();
        setShowValidation(true);
        setError("");

        const trimmed = name.trim();
        const rootTrimmed = rootPath.trim();
        const hasRoot = rootTrimmed.length > 0;
        const rootValid = !hasRoot || (rootTrimmed[0] !== "/" && !rootTrimmed.endsWith("/"));

        if (!trimmed || !rootValid || !code) {
            if (!trimmed) setError(t("add_storage_error_name"));
            else if (!rootValid) setError(t("add_storage_error_root"));
            else setError(t("add_storage_error_choose_account"));
            return;
        }
        setBusy(true);
        try {
            await onCreate?.({
                name: trimmed,
                root_path: hasRoot ? rootTrimmed : "/",
                code,
            });
            setName("");
            setRootPath("");
            setCode(null);
            setGoogleReady(false);
            setShowValidation(false);
        } catch (e) {
            setError(e?.message || t("add_storage_error_create"));
        } finally {
            setBusy(false);
        }
    };

    const nameError = showValidation && !name.trim() ? t("add_storage_error_name") : "";
    const trimmedRoot = rootPath.trim();
    const rootError =
        showValidation && trimmedRoot.length > 0 && (trimmedRoot.startsWith("/") || trimmedRoot.endsWith("/"))
            ? t("add_storage_error_root")
            : "";
    const googleError = showValidation && !code ? t("add_storage_error_choose_account") : "";

    if (!open) return null;

    const canClose = !blocking;

    return (
        <div className="modal register-modal" onClick={() => (canClose ? onClose?.() : null)}>
            <div className="register-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="auth-card-head">
                    <div>
                        <p className="eyebrow">{t("add_storage_title")}</p>
                        <h3>{t("add_storage_add")}</h3>
                    </div>
                </div>

                <form className="form" onSubmit={handleSubmit}>
                    <label className="field">
                        <span>{t("add_storage_name")}</span>
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
                        <span>{t("add_storage_root")}</span>
                        <input
                            className="input"
                            type="text"
                            value={rootPath}
                            onChange={(e) => setRootPath(e.target.value)}
                            placeholder="projects/cloud"
                        />
                        {rootError && <div className="field-error">{rootError}</div>}
                    </label>

                    <label className="field">
                        <span>{t("add_storage_google_account")}</span>
                        <div className="google-select">
                            <span
                                className={`status-dot ${googleReady ? "ok" : "warn"}`}
                                aria-label={t("aria_google_status")}
                            />
                            <button
                                type="button"
                                className="btn secondary"
                                onClick={() => googleLogin()}
                                disabled={busy}
                            >
                                {t("add_storage_choose_account")}
                            </button>
                        </div>
                        {googleError && <div className="field-error">{googleError}</div>}
                    </label>

                    <div className="form-actions">
                        {canClose && (
                            <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>
                                {t("add_storage_close")}
                            </button>
                        )}
                        <button className="btn primary" type="submit" disabled={busy}>
                            {busy ? t("add_storage_creating") : t("add_storage_submit")}
                        </button>
                    </div>
                </form>

                {error && <div className="alert" style={{ marginTop: 10 }}>{error}</div>}
            </div>
        </div>
    );
}
