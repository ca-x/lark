import { useState } from "react";
import type { Settings } from "../types";
import { createT } from "../i18n";
import { LoadingStage } from "./LoadingStage";

export function AuthView({
  mode,
  settings,
  error,
  registrationEnabled = false,
  onSubmit,
}: {
  mode: "loading" | "setup" | "login";
  settings: Settings;
  error?: string;
  registrationEnabled?: boolean;
  onSubmit: (mode: "setup" | "login" | "register", username: string, password: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [registerMode, setRegisterMode] = useState(false);
  const isSetup = mode === "setup";
  const action = isSetup ? "setup" : registerMode ? "register" : "login";
  const zh = settings.language === "zh-CN";
  const title =
    mode === "loading"
      ? zh
        ? "正在进入百灵"
        : "Opening Lark"
      : isSetup
        ? zh
          ? "初始化百灵"
          : "Initialize Lark"
        : registerMode
          ? zh
            ? "创建你的账号"
            : "Create your account"
          : zh
            ? "欢迎回来"
            : "Welcome back";
  const subtitle = isSetup
    ? zh
      ? "首次运行需要创建管理员账号，用于管理曲库、注册和系统设置。"
      : "Create the first administrator account to manage the library and system settings."
    : zh
      ? "登录后可同步你的歌单、喜欢、收藏与播放历史。"
      : "Sign in to keep playlists, likes, albums, and history separate.";

  if (mode === "loading") {
    return (
      <div className="auth-shell" data-theme={settings.theme}>
        <LoadingStage t={createT(settings.language)} />
      </div>
    );
  }

  return (
    <div className="auth-shell" data-theme={settings.theme}>
      <div className="auth-card">
        <div className="brand auth-brand">
          <img src="/logo.png" alt={zh ? "百灵" : "Lark"} />
          <span>{zh ? "百灵" : "Lark"}</span>
        </div>
        <div>
          <p>{zh ? "私人音乐库" : "Private music library"}</p>
          <h1>{title}</h1>
          <span>{subtitle}</span>
        </div>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(action, username, password);
          }}
        >
          <label>
            {zh ? "账号" : "Username"}
            <input
              value={username}
              autoComplete="username"
              minLength={2}
              required
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            {zh ? "密码" : "Password"}
            <input
              value={password}
              type="password"
              autoComplete={isSetup || registerMode ? "new-password" : "current-password"}
              minLength={6}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <div className="auth-error">{error}</div> : null}
          <button className="primary" type="submit">
            {isSetup
              ? zh
                ? "创建管理员"
                : "Create admin"
              : registerMode
                ? zh
                  ? "注册并进入"
                  : "Register"
                : zh
                  ? "登录"
                  : "Sign in"}
          </button>
          {!isSetup && registrationEnabled ? (
            <button
              type="button"
              className="auth-link"
              onClick={() => setRegisterMode((value) => !value)}
            >
              {registerMode
                ? zh
                  ? "已有账号？返回登录"
                  : "Already have an account? Sign in"
                : zh
                  ? "没有账号？注册"
                  : "Need an account? Register"}
            </button>
          ) : null}
        </form>
      </div>
    </div>
  );
}
