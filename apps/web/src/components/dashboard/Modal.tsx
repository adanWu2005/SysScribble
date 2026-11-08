'use client';

import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  description?: string;
  /** While true the dialog cannot be dismissed, so a request in flight is not abandoned. */
  busy?: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  children?: ReactNode;
  footer: ReactNode;
}

/** A small accessible modal form: Esc and the backdrop close it, and focus goes back where it came from. */
export function Modal({ title, description, busy = false, onClose, onSubmit, children, footer }: ModalProps) {
  const headingId = useId();
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    form.current?.querySelector<HTMLElement>('input, button[type="submit"]')?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, busy]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        ref={form}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
      >
        <h2 id={headingId} className="text-lg font-semibold">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-neutral-500">{description}</p> : null}
        {children}
        <div className="mt-5 flex justify-end gap-2">{footer}</div>
      </form>
    </div>
  );
}
