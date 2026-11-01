import React, { useState, useId } from 'react';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';

interface BaseFieldProps {
  label: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  id?: string;
}

export interface InputFieldProps
  extends BaseFieldProps,
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {}

export const InputField: React.FC<InputFieldProps> = ({
  label,
  error,
  helperText,
  required,
  id,
  type = 'text',
  className = '',
  ...rest
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;
  const [showPassword, setShowPassword] = useState(false);

  const isPassword = type === 'password';
  const effectiveType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label
        htmlFor={inputId}
        className="text-sm font-medium text-[#292A25] flex items-center justify-between"
      >
        <span>
          {label}
          {required && (
            <span className="text-[#777B63] ml-1" aria-hidden="true">
              *
            </span>
          )}
        </span>
      </label>

      <div className="relative">
        <input
          id={inputId}
          type={effectiveType}
          aria-invalid={Boolean(error)}
          aria-describedby={
            error ? errorId : helperText ? helperId : undefined
          }
          className={`w-full rounded-md bg-[#F8F7F3] px-3.5 py-2.5 text-sm text-[#292A25] placeholder:text-[#292A25]/45 border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[#777B63] min-h-[42px] ${
            isPassword ? 'pr-11' : ''
          } ${
            error
              ? 'border-[#7A3B32] bg-[#7A3B32]/[0.04]'
              : 'border-[#292A25]/20 hover:border-[#292A25]/40 focus:border-[#777B63]'
          }`}
          {...rest}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={
              showPassword ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`
            }
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#292A25]/65 hover:text-[#292A25] rounded focus-visible:outline-2 focus-visible:outline-[#777B63]"
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Eye className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {helperText && !error && (
        <p id={helperId} className="text-xs text-[#292A25]/65 leading-relaxed">
          {helperText}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-[#7A3B32] flex items-center gap-1.5 mt-0.5"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps
  extends BaseFieldProps,
    Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  options: SelectOption[];
  placeholder?: string;
}

export const SelectField: React.FC<SelectFieldProps> = ({
  label,
  error,
  helperText,
  required,
  id,
  options,
  placeholder,
  className = '',
  ...rest
}) => {
  const generatedId = useId();
  const selectId = id || generatedId;
  const errorId = `${selectId}-error`;
  const helperId = `${selectId}-helper`;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={selectId} className="text-sm font-medium text-[#292A25]">
        {label}
        {required && (
          <span className="text-[#777B63] ml-1" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <select
        id={selectId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : helperText ? helperId : undefined}
        className={`w-full rounded-md bg-[#F8F7F3] px-3.5 py-2.5 text-sm text-[#292A25] border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[#777B63] min-h-[42px] ${
          error
            ? 'border-[#7A3B32] bg-[#7A3B32]/[0.04]'
            : 'border-[#292A25]/20 hover:border-[#292A25]/40 focus:border-[#777B63]'
        }`}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {helperText && !error && (
        <p id={helperId} className="text-xs text-[#292A25]/65 leading-relaxed">
          {helperText}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-[#7A3B32] flex items-center gap-1.5 mt-0.5"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};

export interface TextAreaFieldProps
  extends BaseFieldProps,
    Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {}

export const TextAreaField: React.FC<TextAreaFieldProps> = ({
  label,
  error,
  helperText,
  required,
  id,
  rows = 4,
  className = '',
  ...rest
}) => {
  const generatedId = useId();
  const textareaId = id || generatedId;
  const errorId = `${textareaId}-error`;
  const helperId = `${textareaId}-helper`;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={textareaId} className="text-sm font-medium text-[#292A25]">
        {label}
        {required && (
          <span className="text-[#777B63] ml-1" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <textarea
        id={textareaId}
        rows={rows}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : helperText ? helperId : undefined}
        className={`w-full rounded-md bg-[#F8F7F3] px-3.5 py-2.5 text-sm text-[#292A25] placeholder:text-[#292A25]/45 border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[#777B63] ${
          error
            ? 'border-[#7A3B32] bg-[#7A3B32]/[0.04]'
            : 'border-[#292A25]/20 hover:border-[#292A25]/40 focus:border-[#777B63]'
        }`}
        {...rest}
      />

      {helperText && !error && (
        <p id={helperId} className="text-xs text-[#292A25]/65 leading-relaxed">
          {helperText}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-[#7A3B32] flex items-center gap-1.5 mt-0.5"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};

export const TextareaField = TextAreaField;

export interface CheckboxFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: React.ReactNode;
  error?: string;
  id?: string;
}

export const CheckboxField: React.FC<CheckboxFieldProps> = ({
  label,
  error,
  id,
  className = '',
  ...rest
}) => {
  const generatedId = useId();
  const checkboxId = id || generatedId;
  const errorId = `${checkboxId}-error`;

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label
        htmlFor={checkboxId}
        className="inline-flex items-start gap-2.5 text-sm text-[#292A25]/85 cursor-pointer select-none"
      >
        <input
          id={checkboxId}
          type="checkbox"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="mt-1 h-4 w-4 rounded border-[#292A25]/30 text-[#777B63] focus:ring-[#777B63] accent-[#777B63]"
          {...rest}
        />
        <span className="leading-relaxed">{label}</span>
      </label>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-[#7A3B32] flex items-center gap-1.5 mt-0.5"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};
