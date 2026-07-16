export default function LoadingSpinner({ message = 'Loading data...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-10 h-10 rounded-full border-4 border-brand-600/30 border-t-brand-600 animate-spin" />
      <p className="text-sm dark:text-white/50 text-brand-500">{message}</p>
    </div>
  )
}
