import { ButtonHTMLAttributes, forwardRef } from 'react'

interface CardButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'filled' | 'outlined'
}

/**
 * Outfit card action button — pill shape exception.
 * Only used on: SOURCE ITEMS / SIMILAR LOOKS / EXPLORE STYLES.
 * Per design system: pill shape is acceptable for the outfit card context.
 */
const CardButton = forwardRef<HTMLButtonElement, CardButtonProps>(
  ({ variant = 'filled', children, className = '', ...props }, ref) => {
    const base = `
      inline-flex items-center justify-center
      text-[10px] tracking-[0.18em]
      rounded-full
      px-3 py-1.5
      transition-all duration-400
      cursor-pointer whitespace-nowrap
      disabled:opacity-40
    `

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
        className={`${base} ${variants[variant]} ${className}`}
        {...props}
      >
        {children}
      </button>
    )
  }
)

CardButton.displayName = 'CardButton'
export default CardButton
