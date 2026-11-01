import React from 'react';

export interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  title?: string;
  description?: string;
  footer?: React.ReactNode;
}

export const Form: React.FC<FormProps> = ({
  title,
  description,
  footer,
  children,
  className = '',
  noValidate = true,
  ...rest
}) => {
  return (
    <form
      noValidate={noValidate}
      className={`flex flex-col gap-6 ${className}`}
      {...rest}
    >
      {(title || description) && (
        <div className="border-b border-[#292A25]/10 pb-4">
          {title && (
            <h3 className="text-lg font-semibold text-[#292A25] tracking-tight">
              {title}
            </h3>
          )}
          {description && (
            <p className="text-sm text-[#292A25]/70 mt-1 leading-relaxed">
              {description}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-5">{children}</div>

      {footer && (
        <div className="pt-4 border-t border-[#292A25]/10 flex flex-wrap items-center justify-end gap-3">
          {footer}
        </div>
      )}
    </form>
  );
};
