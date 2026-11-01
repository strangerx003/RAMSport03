"use client";

import { useState } from "react";

type Props = {
  id: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  autoComplete?: string;
};

function EyeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.2 12S5.6 5.8 12 5.8 21.8 12 21.8 12 18.4 18.2 12 18.2 2.2 12 2.2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 4l16 16" />
      <path d="M9.9 5.1A10.6 10.6 0 0 1 12 4.9c6.4 0 9.8 7.1 9.8 7.1a17 17 0 0 1-2.7 3.7" />
      <path d="M6.2 6.8A16.8 16.8 0 0 0 2.2 12s3.4 7.1 9.8 7.1a9.9 9.9 0 0 0 4-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export default function AuthPasswordField({
  id,
  name,
  defaultValue,
  placeholder,
  autoComplete = "current-password",
}: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="auth-input">
      <span className="auth-input-icon" aria-hidden="true">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          <rect x="4" y="10.5" width="16" height="9.5" rx="2.2" />
          <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
        </svg>
      </span>
      <input
        className="input"
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required
      />
      <button
        className="auth-eye"
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
