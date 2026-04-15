import { ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'filled' | 'outlined'
  size?: 'sm' | 'md'
  arrow?: boolean
}

/**
 * MYRA button — Style A (filled dark) or Style B (outlined light).
 * Rectangular with 2–4px border radius. All caps, wide tracking.
 * Used everywhere EXCEPT outfit card action buttons (which use pill shape).
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'filled', size = 'md', arrow = false, children, className = '', ...props }, ref) => {
    const base = `
      inline-flex items-center justify-center gap-2
      text-[11px] tracking-[0.20em]
      rounded-[3px]
      transition-all duration-400
      cursor-pointer
      disabled:opacity-40 disabled:cursor-not-allowed
    `

    const sizes = {
      sm: 'px-6 py-3',
      md: 'px-8 py-3.5',
    }

    const variants = {
      filled: `
        bg-[#0A0A0A] text-white border border-[#0A0A0A]
        hover:opacity-85
      `,
      outlined: `
        bg-transparent text-[#0A0A0A] border border-[#0A0A0A]
        hover:bg-[#F2F2F2]
      `,
    }

    return (
      <button
        ref={ref}
        className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
        {...props}
      >
        {children}
        {arrow && <span className="text-sm leading-none">↗</span>}
      </button>
    )
  }
)

Button.displayName = 'Button'
export default Button
