"use client";

import type { ReactNode } from "react";

type ServerAction = (formData: FormData) => void | Promise<void>;

export function ConfirmForm({
  action,
  confirm,
  children,
  className,
  style,
}: {
  action: ServerAction;
  confirm: string;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <form
      action={action}
      className={className}
      style={style}
      onSubmit={(event) => {
        if (!window.confirm(confirm)) event.preventDefault();
      }}
    >
      {children}
    </form>
  );
}

export function ConfirmButton({
  confirm,
  children,
  className = "btn btn-sm btn-danger",
  name,
  value,
  formAction,
  title,
}: {
  confirm?: string;
  children: ReactNode;
  className?: string;
  name?: string;
  value?: string;
  formAction: ServerAction;
  title?: string;
}) {
  return (
    <button
      className={className}
      type="submit"
      formAction={formAction}
      title={title}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) {
          event.preventDefault();
          return;
        }
        // React rewrites the name/value of a submitter that carries formAction, so
        // the row id is supplied as a hidden field at submit time instead. That keeps
        // every row inside one form without duplicating hidden inputs.
        const form = event.currentTarget.form;
        if (!form || !name) return;
        form.querySelectorAll("input[data-confirm-target]").forEach((input) => input.remove());
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value ?? "";
        input.dataset.confirmTarget = "1";
        form.appendChild(input);
      }}
    >
      {children}
    </button>
  );
}
