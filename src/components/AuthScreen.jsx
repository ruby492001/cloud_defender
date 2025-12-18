import { useState } from "react";
import { login as loginRequest, register as registerRequest } from "../api/auth.js";
import { t } from "../strings.js";

const initialLoginState = { login: "", password: "" };
const initialRegisterState = { login: "", password: "", confirm: "" };


export default function AuthScreen({ onAuthenticated }) {
    const [loginForm, setLoginForm] = useState(initialLoginState);
    const [registerForm, setRegisterForm] = useState(initialRegisterState);
    const [registerOpen, setRegisterOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [loginError, setLoginError] = useState("");
    const [registerError, setRegisterError] = useState("");

    const handleLoginSubmit = async (event) => {
        event.preventDefault();
        setBusy(true);
        setLoginError("");
        try {
            const user = await loginRequest(loginForm);
            onAuthenticated?.(user);
        } catch (err) {
            setLoginError(err?.message || t("auth_error_login"));
        } finally {
            setBusy(false);
        }
    };

    const handleRegisterSubmit = async (event) => {
        event.preventDefault();
        setRegisterError("");
        const { login, password, confirm } = registerForm;
        if (!login.trim() || !password.trim()) {
            setRegisterError(t("auth_error_register_fill"));
            return;
        }
        if (password.length < 8) {
            setRegisterError(t("auth_error_register_length"));
            return;
        }
        if (password !== confirm) {
            setRegisterError(t("auth_error_register_mismatch"));
            return;
        }
        setBusy(true);
        try {
            const user = await registerRequest({ login, password });
            onAuthenticated?.(user);
        } catch (err) {
            setRegisterError(err?.message || t("auth_error_register"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="auth-shell">
            <div className="auth-card auth-single">
                <div className="auth-card-head">
                    <div>
                        <h2>{t("auth_login_heading")}</h2>
                    </div>
                </div>

                <form className="form" onSubmit={handleLoginSubmit}>
                    <label className="field">
                        <span>{t("auth_username")}</span>
                        <input
                            className="input"
                            type="text"
                            name="login"
                            autoComplete="username"
                            value={loginForm.login}
                            onChange={(e) => setLoginForm((p) => ({ ...p, login: e.target.value }))}
                            required
                        />
                    </label>
                    <label className="field">
                        <span>{t("auth_password")}</span>
                        <input
                            className="input"
                            type="password"
                            name="password"
                            autoComplete="current-password"
                            value={loginForm.password}
                            onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                            required
                        />
                    </label>

                    <div className="form-actions">
                        <button className="btn primary" type="submit" disabled={busy}>
                            {busy ? t("auth_login_busy") : t("auth_login")}
                        </button>
                        <button className="btn secondary" type="button" onClick={() => setRegisterOpen(true)} disabled={busy}>
                            {t("auth_register")}
                        </button>
                    </div>
                </form>

                {loginError && <div className="alert">{loginError}</div>}
            </div>

            {registerOpen && (
                <div className="modal register-modal" onClick={() => (!busy ? setRegisterOpen(false) : null)}>
                    <div className="register-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="auth-card-head">
                            <div>
                                <p className="eyebrow">{t("auth_register_eyebrow")}</p>
                                <h3>{t("auth_register_title")}</h3>
                            </div>
                            <button className="btn ghost" type="button" onClick={() => setRegisterOpen(false)} disabled={busy}>
                                {t("auth_close")}
                            </button>
                        </div>

                        <form className="form" onSubmit={handleRegisterSubmit}>
                            <label className="field">
                                <span>{t("auth_username")}</span>
                                <input
                                    className="input"
                                    type="text"
                                    name="new-login"
                                    autoComplete="username"
                                    value={registerForm.login}
                                    onChange={(e) => setRegisterForm((p) => ({ ...p, login: e.target.value }))}
                                    required
                                />
                            </label>
                            <label className="field">
                                <span>{t("auth_password")}</span>
                                <input
                                    className="input"
                                    type="password"
                                    name="new-password"
                                    autoComplete="new-password"
                                    value={registerForm.password}
                                    onChange={(e) => setRegisterForm((p) => ({ ...p, password: e.target.value }))}
                                    required
                                    minLength={8}
                                />
                            </label>
                            <label className="field">
                                <span>{t("auth_password_confirm")}</span>
                                <input
                                    className="input"
                                    type="password"
                                    name="confirm-password"
                                    autoComplete="new-password"
                                    value={registerForm.confirm}
                                    onChange={(e) => setRegisterForm((p) => ({ ...p, confirm: e.target.value }))}
                                    required
                                    minLength={8}
                                />
                            </label>

                            <div className="form-actions">
                                <button className="btn primary" type="submit" disabled={busy}>
                                    {busy ? t("auth_register_busy") : t("auth_register_button")}
                                </button>
                                <button
                                    className="btn ghost"
                                    type="button"
                                    onClick={() => setRegisterOpen(false)}
                                    disabled={busy}
                                >
                                    {t("auth_register_cancel")}
                                </button>
                            </div>
                        </form>
                        {registerError && <div className="alert" style={{ marginTop: 10 }}>{registerError}</div>}
                    </div>
                </div>
            )}
        </div>
    );
}
