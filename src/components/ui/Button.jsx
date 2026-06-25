const variants = {
  primary:
    'bg-gold-500 hover:bg-gold-600 text-white shadow-sm',
  secondary:
    'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 shadow-sm',
  danger:
    'bg-red-500 hover:bg-red-600 text-white shadow-sm',
  ghost:
    'hover:bg-gray-100 text-gray-600',
}

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
  type = 'button',
  className = '',
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
        ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  )
}
