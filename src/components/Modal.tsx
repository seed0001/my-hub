"use client";

import { useEffect } from "react";

export default function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-start sm:overflow-y-auto sm:p-4"
      onMouseDown={onClose}
    >
      <div
        className="card animate-sheet-up max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-b-none rounded-t-2xl p-5 pb-safe-lg shadow-2xl sm:mt-16 sm:max-w-lg sm:rounded-xl sm:p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Drag-handle affordance on mobile */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-hub-border sm:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-hub-muted hover:bg-hub-border/50 hover:text-white"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
