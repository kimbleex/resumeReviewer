"use client";

import { useState, type FormEvent } from "react";
import { LoaderCircle, LogIn, ShieldAlert, KeyRound, ArrowRight, Compass, ArrowLeft, User, Lock } from "lucide-react";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Phase state: false = intro/splash, true = login form
  const [showForm, setShowForm] = useState(false);

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
    <main className="auth-entry-shell premium-login-bg">
      {/* Self-contained CSS styles for breathtaking effects */}
      <style>{`
        .premium-login-bg {
          background: radial-gradient(circle at 50% 50%, #080f1d 0%, #02040a 100%) !important;
          position: relative;
          overflow: hidden;
        }

        /* Abstract glowing particles in background */
        .premium-login-bg::before {
          content: '';
          position: absolute;
          width: 700px;
          height: 700px;
          background: radial-gradient(circle, rgba(0, 242, 254, 0.06) 0%, transparent 70%);
          top: 5%;
          left: 15%;
          pointer-events: none;
          z-index: 0;
          animation: floatGlow 14s infinite alternate ease-in-out;
        }
        
        .premium-login-bg::after {
          content: '';
          position: absolute;
          width: 600px;
          height: 600px;
          background: radial-gradient(circle, rgba(79, 172, 254, 0.05) 0%, transparent 70%);
          bottom: 5%;
          right: 10%;
          pointer-events: none;
          z-index: 0;
          animation: floatGlow 18s infinite alternate-reverse ease-in-out;
        }

        @keyframes floatGlow {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(50px, 40px) scale(1.15); }
        }

        /* Intro Splash Container */
        .intro-container {
          text-align: center;
          max-width: 600px;
          z-index: 10;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          animation: fadeInScale 1s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }

        /* Title flare/shimmer gradient */
        .shimmer-eyebrow {
          font-size: 0.85rem;
          letter-spacing: 0.25em;
          text-transform: uppercase;
          color: rgba(0, 242, 254, 0.75);
          text-shadow: 0 0 12px rgba(0, 242, 254, 0.3);
          margin-bottom: 18px;
          font-weight: 700;
          animation: pulseGlow 3s infinite alternate ease-in-out;
        }

        .shimmer-title {
          font-size: clamp(2.3rem, 5.5vw, 4rem);
          font-weight: 900;
          margin: 0 0 32px 0;
          background: linear-gradient(120deg, #00f2fe 0%, #4facfe 35%, #ffffff 65%, #00f2fe 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: textShimmer 4s linear infinite;
          line-height: 1.15;
          letter-spacing: -0.02em;
        }

        @keyframes textShimmer {
          0% { background-position: 0% center; }
          100% { background-position: 200% center; }
        }

        @keyframes pulseGlow {
          0% { opacity: 0.6; text-shadow: 0 0 8px rgba(0, 242, 254, 0.1); }
          100% { opacity: 1; text-shadow: 0 0 20px rgba(0, 242, 254, 0.5); }
        }

        /* Fade-in Entry CTA Button */
        .premium-cta-btn {
          margin-top: 12px;
          height: 54px;
          padding: 0 34px;
          border-radius: 30px;
          border: 1px solid rgba(0, 242, 254, 0.35);
          background: linear-gradient(135deg, rgba(0, 242, 254, 0.18), rgba(79, 172, 254, 0.06));
          color: #ffffff;
          font-size: 1rem;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 8px 24px -6px rgba(0, 242, 254, 0.25);
          opacity: 0;
          animation: slideUpFadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.6s forwards;
        }

        .premium-cta-btn:hover {
          transform: translateY(-2px) scale(1.03);
          border-color: rgba(0, 242, 254, 0.75);
          box-shadow: 0 12px 30px -4px rgba(0, 242, 254, 0.4);
          background: linear-gradient(135deg, rgba(0, 242, 254, 0.28), rgba(79, 172, 254, 0.12));
        }

        .premium-cta-btn:active {
          transform: translateY(0) scale(0.98);
        }

        @keyframes slideUpFadeIn {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Beautiful Animated Form Panel - Redesigned for Ultimate Exquisiteness */
        .premium-form-panel {
          position: relative;
          width: min(450px, 95%);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          background: linear-gradient(135deg, rgba(13, 23, 42, 0.7) 0%, rgba(6, 11, 23, 0.85) 100%);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          box-shadow: 
            0 0 0 1px rgba(255, 255, 255, 0.05) inset,
            0 30px 60px rgba(0, 0, 0, 0.65),
            0 0 40px rgba(0, 242, 254, 0.03) inset;
          padding: 44px 38px;
          z-index: 10;
          display: flex;
          flex-direction: column;
          gap: 22px;
          transform-origin: center;
          animation: unfoldPanel 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .premium-back-arrow {
          position: absolute;
          top: 24px;
          right: 24px;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          color: rgba(255, 255, 255, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
          outline: none;
        }

        .premium-back-arrow:hover {
          border-color: rgba(0, 242, 254, 0.4);
          background: rgba(0, 242, 254, 0.08);
          color: #00f2fe;
          transform: scale(1.05);
        }
        
        .premium-back-arrow:active {
          transform: scale(0.95);
        }

        @keyframes unfoldPanel {
          0% { opacity: 0; transform: scale(0.92) translateY(24px); filter: blur(6px); }
          100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
        }

        .title-neon-bar {
          width: 32px;
          height: 3px;
          background: linear-gradient(90deg, #00f2fe, #4facfe);
          border-radius: 2px;
          margin-top: 10px;
          box-shadow: 0 1px 6px rgba(0, 242, 254, 0.5);
        }

        .premium-form-panel .eyebrow {
          font-size: 0.72rem;
          letter-spacing: 0.15em;
          color: var(--cyan);
          font-weight: 700;
          text-transform: uppercase;
        }

        /* Premium Form Field Styles - Inline Icon Integration */
        .premium-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .premium-field span {
          font-size: 0.75rem;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.55);
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .premium-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          width: 100%;
        }

        .premium-input-wrapper .input-icon {
          position: absolute;
          left: 14px;
          color: rgba(255, 255, 255, 0.35);
          transition: all 0.3s ease;
          pointer-events: none;
        }

        /* Focus states for input wrappers */
        .premium-input-wrapper:focus-within .input-icon {
          color: #00f2fe;
          transform: scale(1.05);
          filter: drop-shadow(0 0 6px rgba(0, 242, 254, 0.4));
        }

        .premium-input {
          height: 46px;
          width: 100%;
          background: rgba(255, 255, 255, 0.02) !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          border-radius: 12px !important;
          color: #ffffff !important;
          padding: 0 16px 0 42px !important;
          font-size: 0.9rem !important;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }

        .premium-input:hover {
          border-color: rgba(255, 255, 255, 0.16) !important;
          background: rgba(255, 255, 255, 0.03) !important;
        }

        .premium-input:focus {
          border-color: rgba(0, 242, 254, 0.5) !important;
          background: rgba(0, 242, 254, 0.01) !important;
          box-shadow: 0 0 16px rgba(0, 242, 254, 0.12) !important;
        }

        .premium-error {
          padding: 12px 16px;
          border-radius: 10px;
          border: 1px solid rgba(239, 68, 68, 0.18);
          background: rgba(239, 68, 68, 0.08);
          color: #fca5a5;
          font-size: 0.82rem;
          display: flex;
          align-items: center;
          gap: 8px;
          animation: shake 0.3s ease;
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }

        .form-divider {
          height: 1px;
          width: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06) 50%, transparent);
          margin: 4px 0;
        }

        /* Form Buttons styling */
        .premium-submit-btn {
          height: 48px;
          border-radius: 12px;
          background: linear-gradient(135deg, #00f2fe, #4facfe);
          border: none;
          color: #02040a;
          font-weight: 700;
          font-size: 0.95rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          cursor: pointer;
          transition: all 0.25s ease;
          box-shadow: 0 8px 20px -4px rgba(0, 242, 254, 0.3);
        }

        .premium-submit-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 12px 24px -2px rgba(0, 242, 254, 0.45);
          filter: brightness(1.05);
        }

        .premium-submit-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .premium-submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .premium-back-link {
          text-align: center;
          color: rgba(255, 255, 255, 0.45);
          font-size: 0.8rem;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 0.2s ease;
          margin-top: 4px;
        }

        .premium-back-link:hover {
          color: #00f2fe;
          transform: translateX(-2px);
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {!showForm ? (
        <div className="intro-container">
          <span className="shimmer-eyebrow">SECURE SESSION LOGIN</span>
          <h1 className="shimmer-title">Mutil-Agent Resume Reviewer</h1>
          
          <button 
            className="premium-cta-btn" 
            onClick={() => setShowForm(true)}
            type="button"
          >
            <KeyRound size={18} />
            登录 & 游客
            <ArrowRight size={18} />
          </button>
        </div>
      ) : (
        <form className="premium-form-panel" onSubmit={handleSubmit}>
          {/* Back to intro/splash button */}
          <button 
            type="button" 
            className="premium-back-arrow" 
            onClick={() => setShowForm(false)}
            title="返回初始页面"
          >
            <ArrowLeft size={16} />
          </button>

          <div style={{ display: "flex", flexDirection: "column", gap: "2px", position: "relative" }}>
            <span className="eyebrow">SECURE SESSION LOGIN</span>
            <h2 style={{ fontSize: "1.8rem", fontWeight: "800", color: "#fff", margin: "4px 0 0 0" }}>身份验证</h2>
            <div className="title-neon-bar" />
          </div>

          <div className="premium-field" style={{ marginTop: "8px" }}>
            <span>用户名</span>
            <div className="premium-input-wrapper">
              <User className="input-icon" size={16} />
              <input
                className="premium-input"
                value={username}
                onChange={(event) => setUsername(event.currentTarget.value)}
                autoComplete="username"
                placeholder="管理员或成员账号"
                required
              />
            </div>
          </div>

          <div className="premium-field">
            <span>密码</span>
            <div className="premium-input-wrapper">
              <Lock className="input-icon" size={16} />
              <input
                className="premium-input"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                autoComplete="current-password"
                placeholder="请输入密码"
                type="password"
                required
              />
            </div>
          </div>

          {errorMessage ? (
            <div className="premium-error">
              <ShieldAlert size={16} />
              {errorMessage}
            </div>
          ) : null}

          <div className="form-divider" />

          <button className="premium-submit-btn" type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <LoaderCircle size={18} style={{ animation: "spin 1s linear infinite" }} />
            ) : (
              <LogIn size={18} />
            )}
            {isSubmitting ? "正在验证..." : "确认登录"}
          </button>

          <a className="premium-back-link" href="/">
            <Compass size={14} />
            游客模式体验一下
          </a>
        </form>
      )}
    </main>
  );
}
