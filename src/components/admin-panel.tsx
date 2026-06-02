"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Ban,
  LoaderCircle,
  RefreshCcw,
  Shield,
  UserPlus,
  ArrowLeft,
  Calendar,
  Users,
  Compass,
  Cpu,
  Clock,
  Key,
  LogOut,
  Activity,
} from "lucide-react";

type AdminUser = {
  id: string;
  username: string;
  role: "ADMIN" | "MEMBER";
  status: "ACTIVE" | "BLOCKED";
  lastLoginAt: string | null;
  createdAt: string;
  _count?: { sessions: number; reviewRuns: number };
};

type AdminGuest = {
  id: string;
  status: "ACTIVE" | "BLOCKED";
  trialUsedCount: number;
  maxTrialCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  _count?: { reviewRuns: number };
};

type AdminSession = {
  id: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  expiresAt: string;
  lastUsedAt: string | null;
  user: { username: string; role: "ADMIN" | "MEMBER"; status: "ACTIVE" | "BLOCKED" };
};

type AdminReviewRun = {
  id: string;
  actorType: "USER" | "GUEST";
  status: "STARTED" | "COMPLETED" | "FAILED";
  targetRole: string;
  startedAt: string;
  completedAt: string | null;
  user: { username: string } | null;
  guest: { id: string } | null;
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "请求失败。");
  }

  return payload as T;
}

export function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [guests, setGuests] = useState<AdminGuest[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [reviewRuns, setReviewRuns] = useState<AdminReviewRun[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setMessage("");
    try {
      const [userData, guestData, sessionData, reviewRunData] = await Promise.all([
        api<{ users: AdminUser[] }>("/api/admin/users"),
        api<{ guests: AdminGuest[] }>("/api/admin/guests"),
        api<{ sessions: AdminSession[] }>("/api/admin/sessions"),
        api<{ reviewRuns: AdminReviewRun[] }>("/api/admin/review-runs"),
      ]);

      setUsers(userData.users);
      setGuests(guestData.guests);
      setSessions(sessionData.sessions);
      setReviewRuns(reviewRunData.reviewRuns);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "后台数据加载失败。");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ username, password, role: "MEMBER" }),
      });
      setUsername("");
      setPassword("");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建成员失败。");
    }
  }

  async function toggleUser(user: AdminUser) {
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: user.status === "ACTIVE" ? "BLOCKED" : "ACTIVE" }),
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "状态更新失败。");
    }
  }

  async function resetPassword(user: AdminUser) {
    const nextPassword = window.prompt(`为 ${user.username} 输入新密码（至少 8 位）`);
    if (!nextPassword) {
      return;
    }
    try {
      await api(`/api/admin/users/${user.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: nextPassword }),
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重置密码失败。");
    }
  }

  async function revokeUserSessions(user: AdminUser) {
    try {
      await api(`/api/admin/users/${user.id}/revoke-sessions`, { method: "POST" });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "撤销会话失败。");
    }
  }

  async function toggleGuest(guest: AdminGuest) {
    try {
      await api(`/api/admin/guests/${guest.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: guest.status === "ACTIVE" ? "BLOCKED" : "ACTIVE" }),
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "状态更新失败。");
    }
  }

  async function setGuestQuota(guest: AdminGuest) {
    const value = window.prompt("设置游客最大试用次数", String(guest.maxTrialCount));
    if (value === null) {
      return;
    }
    try {
      await api(`/api/admin/guests/${guest.id}`, {
        method: "PATCH",
        body: JSON.stringify({ maxTrialCount: Number(value) }),
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新额度失败。");
    }
  }

  async function revokeSession(session: AdminSession) {
    try {
      await api(`/api/admin/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "REVOKED" }),
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "撤销会话失败。");
    }
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <span className="eyebrow">ADMIN CONTROL PANEL</span>
          <h1 style={{ margin: "4px 0 0", fontSize: "1.6rem", fontWeight: 800 }}>访问控制面板</h1>
        </div>
        <div className="admin-header-actions" style={{ display: "flex", gap: "10px" }}>
          <a
            className="secondary-action"
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              textDecoration: "none",
              height: "36px",
            }}
          >
            <ArrowLeft size={14} />
            返回工作台
          </a>
          <button className="primary-action" type="button" onClick={refresh} style={{ height: "36px" }}>
            <RefreshCcw size={14} className={isLoading ? "spin-icon" : ""} />
            刷新数据
          </button>
        </div>
      </header>

      {message ? <div className="top-error-banner">{message}</div> : null}

      {/* Stats Summary Panel */}
      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-icon-wrapper">
            <Users size={20} />
          </div>
          <div className="admin-stat-info">
            <span className="admin-stat-label">正式成员</span>
            <strong className="admin-stat-number">{users.length}</strong>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon-wrapper visitor">
            <Compass size={20} />
          </div>
          <div className="admin-stat-info">
            <span className="admin-stat-label">游客试用</span>
            <strong className="admin-stat-number">{guests.length}</strong>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon-wrapper session">
            <Shield size={20} />
          </div>
          <div className="admin-stat-info">
            <span className="admin-stat-label">活动会话</span>
            <strong className="admin-stat-number">
              {sessions.filter((s) => s.status === "ACTIVE").length}
            </strong>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-icon-wrapper run">
            <Cpu size={20} />
          </div>
          <div className="admin-stat-info">
            <span className="admin-stat-label">诊断运行</span>
            <strong className="admin-stat-number">{reviewRuns.length}</strong>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="admin-loading">
          <LoaderCircle className="spin-icon" size={20} />
          正在加载后台数据...
        </div>
      )}

      <section className="admin-section">
        <div className="admin-section-header">
          <h2>正式成员</h2>
          <form className="admin-create-form" onSubmit={handleCreateUser}>
            <input
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
              placeholder="用户名"
              required
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              placeholder="初始密码"
              type="password"
              required
            />
            <button className="primary-action" type="submit" style={{ height: "36px" }}>
              <UserPlus size={15} />
              创建成员
            </button>
          </form>
        </div>
        <div className="admin-table">
          {users.map((user) => (
            <div className="admin-row" key={user.id}>
              <div className="admin-user-profile">
                <div className={`admin-user-avatar ${user.role === "ADMIN" ? "admin" : ""}`}>
                  {user.username.slice(0, 2).toUpperCase()}
                </div>
                <div className="admin-user-details">
                  <span className="admin-user-name">{user.username}</span>
                  <span className="admin-user-meta">{user.role === "ADMIN" ? "系统管理员" : "正式成员"}</span>
                </div>
              </div>
              <span className={`admin-status ${user.status.toLowerCase()}`}>
                {user.status === "ACTIVE" ? "正常" : "已禁用"}
              </span>
              <span className="admin-stat-item">
                <Clock size={13} />
                登录：{formatDate(user.lastLoginAt)}
              </span>
              <span className="admin-stat-item">
                <Cpu size={13} />
                运行：{user._count?.reviewRuns ?? 0} 次
              </span>
              <div className="admin-action-group">
                <button
                  className={`admin-btn ${user.status === "ACTIVE" ? "danger" : "success"}`}
                  onClick={() => toggleUser(user)}
                  type="button"
                >
                  <Ban size={12} />
                  {user.status === "ACTIVE" ? "禁用" : "启用"}
                </button>
                <button className="admin-btn" onClick={() => resetPassword(user)} type="button">
                  <Key size={12} />
                  重置密码
                </button>
                <button className="admin-btn danger" onClick={() => revokeUserSessions(user)} type="button">
                  <LogOut size={12} />
                  踢下线
                </button>
              </div>
            </div>
          ))}
          {users.length === 0 && !isLoading && (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-dim)", fontSize: "0.86rem" }}>
              暂无正式成员数据
            </div>
          )}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-header">
          <h2>游客身份</h2>
        </div>
        <div className="admin-table">
          {guests.map((guest) => (
            <div className="admin-row" key={guest.id}>
              <div className="admin-user-profile">
                <div
                  className="admin-user-avatar"
                  style={{
                    background: "linear-gradient(135deg, rgba(167, 139, 250, 0.12), rgba(139, 92, 246, 0.12))",
                    borderColor: "rgba(139, 92, 246, 0.25)",
                    color: "#a78bfa",
                  }}
                >
                  G
                </div>
                <div className="admin-user-details">
                  <span className="admin-user-name">游客 {guest.id.slice(0, 8)}</span>
                  <span className="admin-user-meta">临时指纹会话</span>
                </div>
              </div>
              <span className={`admin-status ${guest.status.toLowerCase()}`}>
                {guest.status === "ACTIVE" ? "正常" : "已禁用"}
              </span>
              <span className="admin-stat-item">
                <Activity size={13} />
                额度：{guest.trialUsedCount} / {guest.maxTrialCount}
              </span>
              <span className="admin-stat-item">
                <Clock size={13} />
                最近：{formatDate(guest.lastSeenAt)}
              </span>
              <span className="admin-stat-item">
                <Cpu size={13} />
                运行：{guest._count?.reviewRuns ?? 0} 次
              </span>
              <div className="admin-action-group">
                <button
                  className={`admin-btn ${guest.status === "ACTIVE" ? "danger" : "success"}`}
                  onClick={() => toggleGuest(guest)}
                  type="button"
                >
                  <Ban size={12} />
                  {guest.status === "ACTIVE" ? "禁用" : "启用"}
                </button>
                <button className="admin-btn" onClick={() => setGuestQuota(guest)} type="button">
                  <Compass size={12} />
                  调整额度
                </button>
              </div>
            </div>
          ))}
          {guests.length === 0 && !isLoading && (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-dim)", fontSize: "0.86rem" }}>
              暂无游客指纹数据
            </div>
          )}
        </div>
      </section>

      <div className="admin-grid">
        <section className="admin-section">
          <div className="admin-section-header">
            <h2>活动会话</h2>
          </div>
          <div className="admin-table compact">
            {sessions.map((session) => (
              <div className="admin-row" key={session.id}>
                <Shield size={14} style={{ color: session.status === "ACTIVE" ? "var(--cyan)" : "var(--text-dim)", opacity: 0.8 }} />
                <div className="admin-user-details" style={{ minWidth: 0 }}>
                  <span className="admin-user-name">{session.user.username}</span>
                  <span className="admin-user-meta">{session.user.role === "ADMIN" ? "管理员" : "正式成员"}</span>
                </div>
                <span className={`admin-status ${session.status.toLowerCase()}`}>
                  {session.status === "ACTIVE" ? "活跃" : session.status === "REVOKED" ? "已撤销" : "已过期"}
                </span>
                <span className="admin-stat-item" style={{ fontSize: "0.72rem" }}>
                  <Clock size={12} />
                  失效：{formatDate(session.expiresAt)}
                </span>
                <div className="admin-action-group">
                  <button
                    className="admin-btn danger"
                    onClick={() => revokeSession(session)}
                    disabled={session.status !== "ACTIVE"}
                    type="button"
                    style={{ height: "26px", padding: "0 8px", fontSize: "0.72rem" }}
                  >
                    <Ban size={11} />
                    撤销
                  </button>
                </div>
              </div>
            ))}
            {sessions.length === 0 && !isLoading && (
              <div style={{ padding: "20px", textAlign: "center", color: "var(--text-dim)", fontSize: "0.86rem" }}>
                暂无会话数据
              </div>
            )}
          </div>
        </section>

        <section className="admin-section">
          <div className="admin-section-header">
            <h2>运行记录</h2>
          </div>
          <div className="admin-table compact">
            {reviewRuns.map((run) => (
              <div className="admin-row" key={run.id}>
                <Cpu size={14} style={{ color: "var(--cyan)", opacity: 0.8 }} />
                <div className="admin-user-details" style={{ minWidth: 0 }}>
                  <span className="admin-user-name" style={{ fontSize: "0.78rem" }}>{run.targetRole}</span>
                  <span className="admin-user-meta">{run.user?.username ?? `游客 ${run.guest?.id.slice(0, 8) ?? "-"}`}</span>
                </div>
                <span className={`admin-status ${run.status.toLowerCase()}`}>
                  {run.status === "COMPLETED" ? "完成" : run.status === "FAILED" ? "失败" : "进行中"}
                </span>
                <span className="admin-stat-item" style={{ fontSize: "0.72rem" }}>
                  <Calendar size={12} />
                  {formatDate(run.startedAt)}
                </span>
              </div>
            ))}
            {reviewRuns.length === 0 && !isLoading && (
              <div style={{ padding: "20px", textAlign: "center", color: "var(--text-dim)", fontSize: "0.86rem" }}>
                暂无诊断运行记录
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
