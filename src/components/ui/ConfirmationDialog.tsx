import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

export interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm Action',
  cancelLabel = 'Cancel',
  variant = 'primary',
  onConfirm,
  onCancel,
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 overflow-y-auto pt-10 sm:pt-16 pb-12 bg-[#292A25]/60 backdrop-blur-xs animate-page-enter"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-md bg-[#F8F7F3] border border-[#292A25]/20 shadow-xl p-6 md:p-7 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4 border-b border-[#292A25]/10 pb-4">
          <h3
            id="dialog-title"
            className="text-lg font-semibold text-[#292A25] tracking-tight"
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="p-1 text-[#292A25]/60 hover:text-[#292A25] rounded focus-visible:outline-2 focus-visible:outline-[#777B63]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <p
          id="dialog-description"
          className="text-sm text-[#292A25]/75 leading-relaxed"
        >
          {description}
        </p>

        {children && <div className="pt-1">{children}</div>}

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#292A25]/10">
          <Button variant="outline" size="md" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            size="md"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
