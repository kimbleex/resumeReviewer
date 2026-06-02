"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Ban, LoaderCircle, RefreshCcw, Shield, UserPlus } from "lucide-react";

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
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, password, role: "MEMBER" }),
    });
    setUsername("");
    setPassword("");
    await refresh();
  }

  async function toggleUser(user: AdminUser) {
    await api(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: user.status === "ACTIVE" ? "BLOCKED" : "ACTIVE" }),
    });
    await refresh();
  }

  async function resetPassword(user: AdminUser) {
    const nextPassword = window.prompt(`为 ${user.username} 输入新密码（至少 8 位）`);
    if (!nextPassword) {
      return;
    }
    await api(`/api/admin/users/${user.id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password: nextPassword }),
    });
    await refresh();
  }

  async function revokeUserSessions(user: AdminUser) {
    await api(`/api/admin/users/${user.id}/revoke-sessions`, { method: "POST" });
    await refresh();
  }

  async function toggleGuest(guest: AdminGuest) {
    await api(`/api/admin/guests/${guest.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: guest.status === "ACTIVE" ? "BLOCKED" : "ACTIVE" }),
    });
    await refresh();
  }

  async function setGuestQuota(guest: AdminGuest) {
    const value = window.prompt("设置游客最大试用次数", String(guest.maxTrialCount));
    if (value === null) {
      return;
    }
    await api(`/api/admin/guests/${guest.id}`, {
      method: "PATCH",
      body: JSON.stringify({ maxTrialCount: Number(value) }),
    });
    await refresh();
  }

  async function revokeSession(session: AdminSession) {
    await api(`/api/admin/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "REVOKED" }),
    });
    await refresh();
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <span className="eyebrow">ADMIN CONTROL PANEL</span>
          <h1>访问控制面板</h1>
        </div>
        <div className="admin-header-actions">
          <a className="identity-link" href="/">
            返回工作台
          </a>
          <button className="identity-link" type="button" onClick={refresh}>
            <RefreshCcw size={14} />
            刷新
          </button>
        </div>
      </header>

      {message ? <div className="top-error-banner">{message}</div> : null}
      {isLoading ? (
        <div className="admin-loading">
          <LoaderCircle className="spin-icon" size={20} />
          正在加载后台数据...
        </div>
      ) : null}

      <section className="admin-section">
        <div className="admin-section-header">
          <h2>正式成员</h2>
          <form className="admin-create-form" onSubmit={handleCreateUser}>
            <input value={username} onChange={(event) => setUsername(event.currentTarget.value)} placeholder="用户名" />
            <input value={password} onChange={(event) => setPassword(event.currentTarget.value)} placeholder="初始密码" type="password" />
            <button className="primary-action" type="submit">
              <UserPlus size={15} />
              创建成员
            </button>
          </form>
        </div>
        <div className="admin-table">
          {users.map((user) => (
            <div className="admin-row" key={user.id}>
              <strong>{user.username}</strong>
              <span>{user.role}</span>
              <span className={`admin-status ${user.status.toLowerCase()}`}>{user.status}</span>
              <span>登录：{formatDate(user.lastLoginAt)}</span>
              <span>运行：{user._count?.reviewRuns ?? 0}</span>
              <button onClick={() => toggleUser(user)} type="button">{user.status === "ACTIVE" ? "禁用" : "启用"}</button>
              <button onClick={() => resetPassword(user)} type="button">重置密码</button>
              <button onClick={() => revokeUserSessions(user)} type="button">踢下线</button>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-header">
          <h2>游客身份</h2>
        </div>
        <div className="admin-table">
          {guests.map((guest) => (
            <div className="admin-row" key={guest.id}>
              <strong>{guest.id.slice(0, 10)}</strong>
              <span className={`admin-status ${guest.status.toLowerCase()}`}>{guest.status}</span>
              <span>次数：{guest.trialUsedCount}/{guest.maxTrialCount}</span>
              <span>最近：{formatDate(guest.lastSeenAt)}</span>
              <span>运行：{guest._count?.reviewRuns ?? 0}</span>
              <button onClick={() => toggleGuest(guest)} type="button">
                <Ban size={13} />
                {guest.status === "ACTIVE" ? "禁用" : "启用"}
              </button>
              <button onClick={() => setGuestQuota(guest)} type="button">调整额度</button>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-grid">
        <div className="admin-section">
          <div className="admin-section-header">
            <h2>会话</h2>
          </div>
          <div className="admin-table compact">
            {sessions.map((session) => (
              <div className="admin-row" key={session.id}>
                <Shield size={14} />
                <strong>{session.user.username}</strong>
                <span className={`admin-status ${session.status.toLowerCase()}`}>{session.status}</span>
                <span>过期：{formatDate(session.expiresAt)}</span>
                <button onClick={() => revokeSession(session)} disabled={session.status !== "ACTIVE"} type="button">撤销</button>
              </div>
            ))}
          </div>
        </div>

        <div className="admin-section">
          <div className="admin-section-header">
            <h2>运行记录</h2>
          </div>
          <div className="admin-table compact">
            {reviewRuns.map((run) => (
              <div className="admin-row" key={run.id}>
                <strong>{run.targetRole}</strong>
                <span>{run.user?.username ?? `游客 ${run.guest?.id.slice(0, 8) ?? "-"}`}</span>
                <span className={`admin-status ${run.status.toLowerCase()}`}>{run.status}</span>
                <span>{formatDate(run.startedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
