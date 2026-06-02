"use client";

import { useCallback, useEffect, useState, useRef, type FormEvent } from "react";
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
  Eye,
  X,
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [modalView, setModalView] = useState<"sessions" | "runs" | "guests" | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [newPasswordValue, setNewPasswordValue] = useState("");
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [editingQuotaValue, setEditingQuotaValue] = useState<number>(1);

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState<number>(5);
  const [currentPage, setCurrentPage] = useState<number>(1);

  useEffect(() => {
    const handleResize = () => {
      if (tableScrollRef.current) {
        const containerHeight = tableScrollRef.current.clientHeight;
        const rowHeight = 62; // Approximate height of each row in px (including gaps/borders)
        const capacity = Math.floor(containerHeight / rowHeight);
        const calculatedPageSize = Math.max(1, capacity + 1);
        setPageSize(calculatedPageSize);
      }
    };

    handleResize();

    const observer = new ResizeObserver(() => {
      handleResize();
    });
    if (tableScrollRef.current) {
      observer.observe(tableScrollRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  const totalPages = Math.ceil(users.length / pageSize) || 1;
  const activePage = Math.min(currentPage, totalPages);
  const paginatedUsers = users.slice((activePage - 1) * pageSize, activePage * pageSize);

  const [sessionPage, setSessionPage] = useState<number>(1);
  const [runPage, setRunPage] = useState<number>(1);
  const [guestPage, setGuestPage] = useState<number>(1);

  useEffect(() => {
    setSessionPage(1);
    setRunPage(1);
    setGuestPage(1);
  }, [modalView]);

  // Sessions pagination
  const sessionPageSize = 5;
  const sessionTotalPages = Math.ceil(sessions.length / sessionPageSize) || 1;
  const activeSessionPage = Math.min(sessionPage, sessionTotalPages);
  const paginatedSessions = sessions.slice((activeSessionPage - 1) * sessionPageSize, activeSessionPage * sessionPageSize);

  // Review Runs pagination
  const runPageSize = 5;
  const runTotalPages = Math.ceil(reviewRuns.length / runPageSize) || 1;
  const activeRunPage = Math.min(runPage, runTotalPages);
  const paginatedRuns = reviewRuns.slice((activeRunPage - 1) * runPageSize, activeRunPage * runPageSize);

  // Guests pagination
  const guestPageSize = 5;
  const guestTotalPages = Math.ceil(guests.length / guestPageSize) || 1;
  const activeGuestPage = Math.min(guestPage, guestTotalPages);
  const paginatedGuests = guests.slice((activeGuestPage - 1) * guestPageSize, activeGuestPage * guestPageSize);

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
    // Fetch identity of the current logged-in admin
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user?.id) setCurrentUserId(data.user.id);
      })
      .catch(() => { });
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

  async function submitResetPassword(userId: string) {
    if (newPasswordValue.length < 8) {
      setMessage("新密码至少 8 位。");
      return;
    }
    try {
      await api(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: newPasswordValue }),
      });
      setEditingUserId(null);
      setNewPasswordValue("");
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

  async function saveGuestQuota(guestId: string) {
    try {
      await api(`/api/admin/guests/${guestId}`, {
        method: "PATCH",
        body: JSON.stringify({ maxTrialCount: editingQuotaValue }),
      });
      setEditingGuestId(null);
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
            className="admin-btn"
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              textDecoration: "none",
              height: "36px",
              padding: "0 14px",
              borderColor: "rgba(0, 242, 254, 0.25)",
              background: "rgba(0, 242, 254, 0.05)",
              color: "var(--cyan)",
              fontSize: "0.82rem",
              borderRadius: "8px",
              transition: "all 0.2s ease"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 242, 254, 0.12)";
              e.currentTarget.style.borderColor = "rgba(0, 242, 254, 0.5)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0, 242, 254, 0.05)";
              e.currentTarget.style.borderColor = "rgba(0, 242, 254, 0.25)";
              e.currentTarget.style.transform = "none";
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
        <button className="admin-stat-card clickable" type="button" onClick={() => setModalView("guests")}>
          <div className="admin-stat-icon-wrapper visitor">
            <Compass size={20} />
          </div>
          <div className="admin-stat-info">
            <span className="admin-stat-label">游客试用</span>
            <strong className="admin-stat-number">{guests.length}</strong>
          </div>
          <Eye size={15} className="admin-stat-peek" />
        </button>
        <button className="admin-stat-card clickable" type="button" onClick={() => setModalView("sessions")}>
          <div className="admin-stat-icon-wrapper session">
            <Shield size={20} />
          </div>
          <div className="admin-stat-info">
            <span className="admin-stat-label">活动会话</span>
            <strong className="admin-stat-number">
              {sessions.filter((s) => s.status === "ACTIVE").length}
            </strong>
          </div>
          <Eye size={15} className="admin-stat-peek" />
        </button>
        <button className="admin-stat-card clickable" type="button" onClick={() => setModalView("runs")}>
          <div className="admin-stat-icon-wrapper run">
            <Cpu size={20} />
          </div>
          <div className="admin-stat-info">
            <span className="admin-stat-label">诊断运行</span>
            <strong className="admin-stat-number">{reviewRuns.length}</strong>
          </div>
          <Eye size={15} className="admin-stat-peek" />
        </button>
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
        <div className="admin-table-scroll" ref={tableScrollRef}>
          <div className="admin-table">
            {paginatedUsers.map((user) => (
              <div className="admin-row" key={user.id}>
                <div className="admin-user-profile">
                  <div className={`admin-user-avatar ${user.role === "ADMIN" ? "admin" : ""}`}>
                    {user.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="admin-user-details">
                    <span className="admin-user-name">
                      {user.username}
                      {user.id === currentUserId ? <span className="admin-self-tag">（自己）</span> : null}
                    </span>
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
                  {user.id !== currentUserId ? (
                    editingUserId === user.id ? (
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <input
                          type="password"
                          placeholder="新密码(≥8位)"
                          value={newPasswordValue}
                          onChange={(e) => setNewPasswordValue(e.target.value)}
                          style={{
                            height: "26px",
                            width: "110px",
                            fontSize: "0.72rem",
                            padding: "0 6px",
                            background: "rgba(0,0,0,0.3)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: "4px",
                            color: "#fff",
                          }}
                        />
                        <button
                          className="admin-btn success"
                          onClick={() => submitResetPassword(user.id)}
                          type="button"
                          style={{ height: "26px", padding: "0 8px", fontSize: "0.72rem" }}
                        >
                          确定
                        </button>
                        <button
                          className="admin-btn"
                          onClick={() => setEditingUserId(null)}
                          type="button"
                          style={{ height: "26px", padding: "0 8px", fontSize: "0.72rem" }}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          className={`admin-btn ${user.status === "ACTIVE" ? "danger" : "success"}`}
                          onClick={() => toggleUser(user)}
                          type="button"
                        >
                          <Ban size={12} />
                          {user.status === "ACTIVE" ? "禁用" : "启用"}
                        </button>
                        <button
                          className="admin-btn"
                          onClick={() => {
                            setEditingUserId(user.id);
                            setNewPasswordValue("");
                          }}
                          type="button"
                        >
                          <Key size={12} />
                          重置密码
                        </button>
                        <button className="admin-btn danger" onClick={() => revokeUserSessions(user)} type="button">
                          <LogOut size={12} />
                          踢下线
                        </button>
                      </>
                    )
                  ) : null}
                </div>
              </div>
            ))}
            {users.length === 0 && !isLoading && (
              <div style={{ padding: "20px", textAlign: "center", color: "var(--text-dim)", fontSize: "0.86rem" }}>
                暂无正式成员数据
              </div>
            )}
          </div>
        </div>

        {/* Pagination Bar */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: "12px",
          borderTop: "1px solid var(--line)",
          fontSize: "0.78rem",
          color: "var(--text-dim)",
          flexShrink: 0
        }}>
          <div>
            共 <strong>{users.length}</strong> 位成员
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <button
              className="admin-btn"
              disabled={activePage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              type="button"
              style={{
                height: "28px",
                padding: "0 12px",
                borderColor: activePage === 1 ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 242, 254, 0.35)",
                background: activePage === 1 ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 242, 254, 0.08)",
                color: activePage === 1 ? "rgba(255, 255, 255, 0.45)" : "#00f2fe",
                fontWeight: activePage === 1 ? undefined : "600",
                cursor: activePage === 1 ? "not-allowed" : "pointer"
              }}
            >
              上一页
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                className="admin-btn"
                onClick={() => setCurrentPage(p)}
                type="button"
                style={{
                  height: "28px",
                  width: "28px",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderColor: p === activePage ? "var(--cyan)" : undefined,
                  color: p === activePage ? "#fff" : undefined,
                  background: p === activePage ? "rgba(0, 242, 254, 0.16)" : undefined,
                  fontWeight: p === activePage ? "800" : undefined
                }}
              >
                {p}
              </button>
            ))}

            <button
              className="admin-btn"
              disabled={activePage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              type="button"
              style={{
                height: "28px",
                padding: "0 12px",
                borderColor: activePage === totalPages ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 242, 254, 0.35)",
                background: activePage === totalPages ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 242, 254, 0.08)",
                color: activePage === totalPages ? "rgba(255, 255, 255, 0.45)" : "#00f2fe",
                fontWeight: activePage === totalPages ? undefined : "600",
                cursor: activePage === totalPages ? "not-allowed" : "pointer"
              }}
            >
              下一页
            </button>
          </div>
        </div>
      </section>



      {/* Modal for Sessions / Runs / Guests */}
      {modalView !== null && (
        <div className="admin-modal-overlay" onClick={() => setModalView(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h2>
                {modalView === "sessions"
                  ? "活动会话"
                  : modalView === "runs"
                    ? "运行记录"
                    : "游客试用"}
              </h2>
              <button className="admin-modal-close" type="button" onClick={() => setModalView(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="admin-modal-body">
              {modalView === "sessions" ? (
                <div className="admin-table compact">
                  {paginatedSessions.map((session) => (
                    <div className="admin-row" key={session.id} style={{ flexDirection: "column", alignItems: "stretch", gap: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <Shield size={14} style={{ color: session.status === "ACTIVE" ? "var(--cyan)" : "var(--text-dim)", opacity: 0.8 }} />
                          <div className="admin-user-details" style={{ minWidth: 0 }}>
                            <span className="admin-user-name">{session.user.username}</span>
                            <span className="admin-user-meta">{session.user.role === "ADMIN" ? "管理员" : "正式成员"}</span>
                          </div>
                        </div>
                        <div className="admin-action-group" style={{ margin: 0 }}>
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
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "center", paddingTop: "8px", borderTop: "1px dashed rgba(255,255,255,0.05)", fontSize: "0.72rem" }}>
                        <span className={`admin-status ${session.status.toLowerCase()}`}>
                          {session.status === "ACTIVE" ? "活跃" : session.status === "REVOKED" ? "已撤销" : "已过期"}
                        </span>
                        <span className="admin-stat-item">
                          <Clock size={12} />
                          失效：{formatDate(session.expiresAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {sessions.length === 0 && (
                    <div style={{ padding: "24px", textAlign: "center", color: "var(--text-dim)", fontSize: "0.86rem" }}>
                      暂无会话数据
                    </div>
                  )}

                  {/* Pagination Bar for Sessions */}
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--line)",
                    fontSize: "0.74rem",
                    color: "var(--text-dim)",
                    marginTop: "12px",
                    flexShrink: 0
                  }}>
                    <div>
                      共 <strong>{sessions.length}</strong> 条记录，每页 <strong>{sessionPageSize}</strong> 条
                    </div>
                    <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                      <button
                        className="admin-btn"
                        disabled={activeSessionPage === 1}
                        onClick={() => setSessionPage((p) => Math.max(1, p - 1))}
                        type="button"
                        style={{
                          height: "26px",
                          padding: "0 8px",
                          fontSize: "0.72rem",
                          borderColor: activeSessionPage === 1 ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 242, 254, 0.35)",
                          background: activeSessionPage === 1 ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 242, 254, 0.08)",
                          color: activeSessionPage === 1 ? "rgba(255, 255, 255, 0.45)" : "#00f2fe",
                          fontWeight: activeSessionPage === 1 ? undefined : "600",
                          cursor: activeSessionPage === 1 ? "not-allowed" : "pointer"
                        }}
                      >
                        上一页
                      </button>
                      {Array.from({ length: sessionTotalPages }, (_, i) => i + 1).map((p) => (
                        <button
                          key={p}
                          className="admin-btn"
                          onClick={() => setSessionPage(p)}
                          type="button"
                          style={{
                            height: "26px",
                            width: "26px",
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.72rem",
                            borderColor: p === activeSessionPage ? "var(--cyan)" : undefined,
                            color: p === activeSessionPage ? "#fff" : undefined,
                            background: p === activeSessionPage ? "rgba(0, 242, 254, 0.16)" : undefined,
                            fontWeight: p === activeSessionPage ? "800" : undefined
                          }}
                        >
                          {p}
                        </button>
                      ))}
                      <button
                        className="admin-btn"
                        disabled={activeSessionPage === sessionTotalPages}
                        onClick={() => setSessionPage((p) => Math.min(sessionTotalPages, p + 1))}
                        type="button"
                        style={{
                          height: "26px",
                          padding: "0 8px",
                          fontSize: "0.72rem",
                          borderColor: activeSessionPage === sessionTotalPages ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 242, 254, 0.35)",
                          background: activeSessionPage === sessionTotalPages ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 242, 254, 0.08)",
                          color: activeSessionPage === sessionTotalPages ? "rgba(255, 255, 255, 0.45)" : "#00f2fe",
                          fontWeight: activeSessionPage === sessionTotalPages ? undefined : "600",
                          cursor: activeSessionPage === sessionTotalPages ? "not-allowed" : "pointer"
                        }}
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                </div>
              ) : modalView === "runs" ? (
                <div className="admin-table compact">
                  {paginatedRuns.map((run) => (
                    <div className="admin-row" key={run.id} style={{ flexDirection: "column", alignItems: "stretch", gap: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <Cpu size={14} style={{ color: "var(--cyan)", opacity: 0.8 }} />
                          <div className="admin-user-details" style={{ minWidth: 0 }}>
                            <span className="admin-user-name" style={{ fontSize: "0.78rem" }}>{run.targetRole}</span>
                            <span className="admin-user-meta">{run.user?.username ?? `游客 ${run.guest?.id.slice(0, 8) ?? "-"}`}</span>
                          </div>
                        </div>
                        <span className={`admin-status ${run.status.toLowerCase()}`} style={{ margin: 0 }}>
                          {run.status === "COMPLETED" ? "完成" : run.status === "FAILED" ? "失败" : "进行中"}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "center", paddingTop: "8px", borderTop: "1px dashed rgba(255,255,255,0.05)", fontSize: "0.72rem" }}>
                        <span className="admin-stat-item">
                          <Calendar size={12} />
                          开始于：{formatDate(run.startedAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {reviewRuns.length === 0 && (
                    <div style={{ padding: "24px", textAlign: "center", color: "var(--text-dim)", fontSize: "0.86rem" }}>
                      暂无诊断运行记录
                    </div>
                  )}

                  {/* Pagination Bar for Review Runs */}
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--line)",
                    fontSize: "0.74rem",
                    color: "var(--text-dim)",
                    marginTop: "12px",
                    flexShrink: 0
                  }}>
                    <div>
                      共 <strong>{reviewRuns.length}</strong> 条记录，每页 <strong>{runPageSize}</strong> 条
                    </div>
                    <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                      <button
                        className="admin-btn"
                        disabled={activeRunPage === 1}
                        onClick={() => setRunPage((p) => Math.max(1, p - 1))}
                        type="button"
                        style={{
                          height: "26px",
                          padding: "0 8px",
                          fontSize: "0.72rem",
                          borderColor: activeRunPage === 1 ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 242, 254, 0.35)",
                          background: activeRunPage === 1 ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 242, 254, 0.08)",
                          color: activeRunPage === 1 ? "rgba(255, 255, 255, 0.45)" : "#00f2fe",
                          fontWeight: activeRunPage === 1 ? undefined : "600",
                          cursor: activeRunPage === 1 ? "not-allowed" : "pointer"
                        }}
                      >
                        上一页
                      </button>
                      {Array.from({ length: runTotalPages }, (_, i) => i + 1).map((p) => (
                        <button
                          key={p}
                          className="admin-btn"
                          onClick={() => setRunPage(p)}
                          type="button"
                          style={{
                            height: "26px",
                            width: "26px",
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.72rem",
                            borderColor: p === activeRunPage ? "var(--cyan)" : undefined,
                            color: p === activeRunPage ? "#fff" : undefined,
                            background: p === activeRunPage ? "rgba(0, 242, 254, 0.16)" : undefined,
                            fontWeight: p === activeRunPage ? "800" : undefined
                          }}
                        >
                          {p}
                        </button>
                      ))}
                      <button
                        className="admin-btn"
                        disabled={activeRunPage === runTotalPages}
                        onClick={() => setRunPage((p) => Math.min(runTotalPages, p + 1))}
                        type="button"
                        style={{
                          height: "26px",
                          padding: "0 8px",
                          fontSize: "0.72rem",
                          borderColor: activeRunPage === runTotalPages ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 242, 254, 0.35)",
                          background: activeRunPage === runTotalPages ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 242, 254, 0.08)",
                          color: activeRunPage === runTotalPages ? "rgba(255, 255, 255, 0.45)" : "#00f2fe",
                          fontWeight: activeRunPage === runTotalPages ? undefined : "600",
                          cursor: activeRunPage === runTotalPages ? "not-allowed" : "pointer"
                        }}
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="admin-table compact">
                  {paginatedGuests.map((guest) => (
                    <div className="admin-row" key={guest.id} style={{ flexDirection: "column", alignItems: "stretch", gap: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: "8px" }}>
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
                        <div className="admin-action-group" style={{ margin: 0 }}>
                          {editingGuestId === guest.id ? (
                            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={editingQuotaValue}
                                onChange={(e) => setEditingQuotaValue(Number(e.target.value))}
                                style={{
                                  height: "26px",
                                  width: "50px",
                                  fontSize: "0.72rem",
                                  padding: "0 6px",
                                  background: "rgba(0,0,0,0.3)",
                                  border: "1px solid rgba(255,255,255,0.15)",
                                  borderRadius: "4px",
                                  color: "#fff",
                                }}
                              />
                              <button
                                className="admin-btn success"
                                onClick={() => saveGuestQuota(guest.id)}
                                type="button"
                                style={{ height: "26px", padding: "0 8px", fontSize: "0.72rem" }}
                              >
                                保存
                              </button>
                              <button
                                className="admin-btn"
                                onClick={() => setEditingGuestId(null)}
                                type="button"
                                style={{ height: "26px", padding: "0 8px", fontSize: "0.72rem" }}
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                className={`admin-btn ${guest.status === "ACTIVE" ? "danger" : "success"}`}
                                onClick={() => toggleGuest(guest)}
                                type="button"
                              >
                                <Ban size={12} />
                                {guest.status === "ACTIVE" ? "禁用" : "启用"}
                              </button>
                              <button
                                className="admin-btn"
                                onClick={() => {
                                  setEditingGuestId(guest.id);
                                  setEditingQuotaValue(guest.maxTrialCount);
                                }}
                                type="button"
                              >
                                <Compass size={12} />
                                调整额度
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "center", paddingTop: "8px", borderTop: "1px dashed rgba(255,255,255,0.05)", fontSize: "0.72rem" }}>
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
                      </div>
                    </div>
                  ))}
                  {guests.length === 0 && (
                    <div style={{ padding: "24px", textAlign: "center", color: "var(--text-dim)", fontSize: "0.86rem" }}>
                      暂无游客指纹数据
                    </div>
                  )}

                  {/* Pagination Bar for Guests */}
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--line)",
                    fontSize: "0.74rem",
                    color: "var(--text-dim)",
                    marginTop: "12px",
                    flexShrink: 0
                  }}>
                    <div>
                      共 <strong>{guests.length}</strong> 条记录，每页 <strong>{guestPageSize}</strong> 条
                    </div>
                    <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                      <button
                        className="admin-btn"
                        disabled={activeGuestPage === 1}
                        onClick={() => setGuestPage((p) => Math.max(1, p - 1))}
                        type="button"
                        style={{
                          height: "26px",
                          padding: "0 8px",
                          fontSize: "0.72rem",
                          borderColor: activeGuestPage === 1 ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 242, 254, 0.35)",
                          background: activeGuestPage === 1 ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 242, 254, 0.08)",
                          color: activeGuestPage === 1 ? "rgba(255, 255, 255, 0.45)" : "#00f2fe",
                          fontWeight: activeGuestPage === 1 ? undefined : "600",
                          cursor: activeGuestPage === 1 ? "not-allowed" : "pointer"
                        }}
                      >
                        上一页
                      </button>
                      {Array.from({ length: guestTotalPages }, (_, i) => i + 1).map((p) => (
                        <button
                          key={p}
                          className="admin-btn"
                          onClick={() => setGuestPage(p)}
                          type="button"
                          style={{
                            height: "26px",
                            width: "26px",
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.72rem",
                            borderColor: p === activeGuestPage ? "var(--cyan)" : undefined,
                            color: p === activeGuestPage ? "#fff" : undefined,
                            background: p === activeGuestPage ? "rgba(0, 242, 254, 0.16)" : undefined,
                            fontWeight: p === activeGuestPage ? "800" : undefined
                          }}
                        >
                          {p}
                        </button>
                      ))}
                      <button
                        className="admin-btn"
                        disabled={activeGuestPage === guestTotalPages}
                        onClick={() => setGuestPage((p) => Math.min(guestTotalPages, p + 1))}
                        type="button"
                        style={{
                          height: "26px",
                          padding: "0 8px",
                          fontSize: "0.72rem",
                          borderColor: activeGuestPage === guestTotalPages ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 242, 254, 0.35)",
                          background: activeGuestPage === guestTotalPages ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 242, 254, 0.08)",
                          color: activeGuestPage === guestTotalPages ? "rgba(255, 255, 255, 0.45)" : "#00f2fe",
                          fontWeight: activeGuestPage === guestTotalPages ? undefined : "600",
                          cursor: activeGuestPage === guestTotalPages ? "not-allowed" : "pointer"
                        }}
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
