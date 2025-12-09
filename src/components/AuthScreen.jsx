import { useState } from "react";
import { login as loginRequest, register as registerRequest } from "../api/auth.js";

const initialLoginState = { login: "", password: "" };
const initialRegisterState = { login: "", password: "", confirm: "" };

export default function AuthScreen({ onAuthenticated }) {
    const [loginForm, setLoginForm] = useState(initialLoginState);
    const [registerForm, setRegisterForm] = useState(initialRegisterState);
    const [registerOpen, setRegisterOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [loginError, setLoginError] = useState("");
    const [registerError, setRegisterError] = useState("");

    const handleLoginChange = (field, value) => {
        setLoginForm((prev) => ({ ...prev, [field]: value }));
    };

    const handleRegisterChange = (field, value) => {
        setRegisterForm((prev) => ({ ...prev, [field]: value }));
    };

    const handleLoginSubmit = async (event) => {
        event.preventDefault();
        setBusy(true);
        setLoginError("");

        try {
            const user = await loginRequest(loginForm);
            onAuthenticated?.(user);
        } catch (err) {
            setLoginError(err?.message || "Не удалось выполнить вход");
        } finally {
            setBusy(false);
        }
    };

    const handleRegisterSubmit = async (event) => {
        event.preventDefault();
        setRegisterError("");

        if (!registerForm.login.trim() || !registerForm.password.trim()) {
            setRegisterError("Заполните логин и пароль");
            return;
        }

        if (registerForm.password.length < 8) {
            setRegisterError("Пароль должен быть не короче 8 символов");
            return;
        }

        if (registerForm.password !== registerForm.confirm) {
            setRegisterError("Пароли не совпадают");
            return;
        }

        setBusy(true);
        try {
            const user = await registerRequest({
                login: registerForm.login,
                password: registerForm.password,
            });
            onAuthenticated?.(user);
        } catch (err) {
            setRegisterError(err?.message || "Не удалось создать учетную запись");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="auth-shell">
            <div className="auth-card auth-single">
                <div className="auth-card-head">
                    <div>
                        <h2>Войти</h2>
                    </div>
                </div>

                <form className="form" onSubmit={handleLoginSubmit}>
                    <label className="field">
                        <span>Логин</span>
                        <input
                            className="input"
                            type="text"
                            name="login"
                            autoComplete="username"
                            value={loginForm.login}
                            onChange={(e) => handleLoginChange("login", e.target.value)}
                            required
                        />
                    </label>
                    <label className="field">
                        <span>Пароль</span>
                        <input
                            className="input"
                            type="password"
                            name="password"
                            autoComplete="current-password"
                            value={loginForm.password}
                            onChange={(e) => handleLoginChange("password", e.target.value)}
                            required
                        />
                    </label>

                    <div className="form-actions">
                        <button className="btn primary" type="submit" disabled={busy}>
                            {busy ? "Входим..." : "Войти"}
                        </button>
                        <button
                            className="btn secondary"
                            type="button"
                            onClick={() => setRegisterOpen(true)}
                        >
                            Создать аккаунт
                        </button>
                    </div>
                </form>

                {loginError && <div className="alert">{loginError}</div>}
            </div>

            {registerOpen && (
                <div className="modal register-modal" onClick={() => setRegisterOpen(false)}>
                    <div className="register-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="auth-card-head">
                            <div>
                                <p className="eyebrow">Регистрация</p>
                                <h3>Создать учетную запись</h3>
                            </div>
                            <button className="btn ghost" type="button" onClick={() => setRegisterOpen(false)}>
                                Закрыть
                            </button>
                        </div>

                        <form className="form" onSubmit={handleRegisterSubmit}>
                            <label className="field">
                                <span>Логин</span>
                                <input
                                    className="input"
                                    type="text"
                                    name="new-login"
                                    autoComplete="username"
                                    value={registerForm.login}
                                    onChange={(e) => handleRegisterChange("login", e.target.value)}
                                    required
                                />
                            </label>
                            <label className="field">
                                <span>Пароль</span>
                                <input
                                    className="input"
                                    type="password"
                                    name="new-password"
                                    autoComplete="new-password"
                                    value={registerForm.password}
                                    onChange={(e) => handleRegisterChange("password", e.target.value)}
                                    required
                                    minLength={8}
                                />
                            </label>
                            <label className="field">
                                <span>Подтверждение пароля</span>
                                <input
                                    className="input"
                                    type="password"
                                    name="confirm-password"
                                    autoComplete="new-password"
                                    value={registerForm.confirm}
                                    onChange={(e) => handleRegisterChange("confirm", e.target.value)}
                                    required
                                    minLength={8}
                                />
                            </label>

                            <div className="form-actions">
                                <button className="btn primary" type="submit" disabled={busy}>
                                    {busy ? "Создаем..." : "Создать"}
                                </button>
                                <button
                                    className="btn ghost"
                                    type="button"
                                    onClick={() => setRegisterOpen(false)}
                                >
                                    Отмена
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
