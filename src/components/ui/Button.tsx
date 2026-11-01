import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[#292A25] text-[#F8F7F3] border border-[#292A25] shadow-xs hover:bg-[#777B63] hover:border-[#777B63] active:bg-[#292A25] active:translate-y-[0.5px]',
  secondary:
    'bg-[#777B63] text-[#F8F7F3] border border-[#777B63] shadow-xs hover:bg-[#292A25] hover:border-[#292A25] active:translate-y-[0.5px]',
  outline:
    'bg-[#F8F7F3] text-[#292A25] border border-[#292A25]/25 hover:border-[#292A25] hover:bg-[#E8E4DC]/65 active:translate-y-[0.5px]',
  ghost:
    'bg-transparent text-[#292A25] border border-transparent hover:bg-[#E8E4DC]/75',
  danger:
    'bg-[#7A3B32] text-[#F8F7F3] border border-[#7A3B32] hover:bg-[#5E2C25] hover:border-[#5E2C25]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-1.5 text-xs min-h-[36px]',
  md: 'px-4 py-2.5 text-sm min-h-[42px]',
  lg: 'px-6 py-3 text-sm min-h-[46px]',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  leftIcon,
  rightIcon,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}) => {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all duration-150 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#777B63] disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {leftIcon && <span className="shrink-0" aria-hidden="true">{leftIcon}</span>}
      <span>{children}</span>
      {rightIcon && <span className="shrink-0" aria-hidden="true">{rightIcon}</span>}
    </button>
  );
};
