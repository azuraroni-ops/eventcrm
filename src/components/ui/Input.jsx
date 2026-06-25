export default function Input({ label, error, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-700">{label}</label>
      )}
      <input
        className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors
          placeholder:text-gray-400
          ${error ? 'border-red-400 focus:border-red-500' : 'border-gray-300 focus:border-gold-400'}
          focus:ring-2 focus:ring-gold-100`}
        {...props}
      />
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
