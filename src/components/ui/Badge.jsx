const styles = {
  pending: 'bg-yellow-100 text-yellow-700',
  attending: 'bg-green-100 text-green-700',
  not_attending: 'bg-red-100 text-red-700',
  sent: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
}

const labels = {
  pending: 'ממתין',
  attending: 'מגיע',
  not_attending: 'לא מגיע',
  sent: 'נשלח',
  failed: 'נכשל',
}

export default function Badge({ status }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-700'}`}
    >
      {labels[status] || status}
    </span>
  )
}
