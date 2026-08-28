"use client";

import { ReactNode } from "react";

/** 认证表单输入组(图标 + 输入框 + 可选额外元素),login/register/forgot 共用 */
export function AuthInput({
  icon,
  type = "text",
  placeholder,
  value,
  onChange,
  maxLength,
  inputMode,
  pattern,
  onKeyDown,
  children,
}: {
  icon: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  inputMode?: "text" | "numeric";
  pattern?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  children?: ReactNode;
}) {
  return (
    <div className="auth-input-group">
      <span className="auth-icon"><i className={`fa fa-${icon}`}></i></span>
      <input
        type={type}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        pattern={pattern}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {children}
    </div>
  );
}
