"use client";

import { useState, type FormEvent } from "react";
import { LoaderCircle, LogIn } from "lucide-react";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "登录失败。");
      }

      window.location.href = "/";
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "登录失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-entry-shell">
      <form className="login-panel" onSubmit={handleSubmit}>
        <span className="eyebrow">SECURE SESSION LOGIN</span>
        <h1>登录工作台</h1>
        <label className="login-field">
          <span>用户名</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            autoComplete="username"
            placeholder="管理员或成员账号"
          />
        </label>
        <label className="login-field">
          <span>密码</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            autoComplete="current-password"
            placeholder="请输入密码"
            type="password"
          />
        </label>
        {errorMessage ? <div className="top-error-banner">{errorMessage}</div> : null}
        <button className="primary-action auth-entry-action" type="submit" disabled={isSubmitting}>
          {isSubmitting ? <LoaderCircle className="spin-icon" size={17} /> : <LogIn size={17} />}
          登录
        </button>
        <a className="login-back-link" href="/">
          返回游客入口
        </a>
      </form>
    </main>
  );
}
