import { Link } from 'react-router-dom'
import Button from '../components/ui/Button'

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <p className="text-6xl mb-4">🤷</p>
      <h1 className="text-2xl font-bold text-gray-800 mb-2">העמוד לא נמצא</h1>
      <p className="text-gray-500 mb-6">הכתובת שחיפשת לא קיימת</p>
      <Link to="/">
        <Button>חזור לדשבורד</Button>
      </Link>
    </div>
  )
}
