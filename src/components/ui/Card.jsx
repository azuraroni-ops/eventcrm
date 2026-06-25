export default function Card({ children, className = '' }) {
  return (
    <div
      className={`bg-white rounded-xl border border-gray-100 shadow-sm p-6 ${className}`}
    >
      {children}
    </div>
  )
}
