// Small confirmation/error toast — bottom-right, brand-colored, auto-dismisses
// (the caller owns the timer) or closes on click. Defaults to the Refresh
// action's wording; pass `messages` to reuse it for another action (e.g. PDF export).
export default function Toast({ type = 'success', messages: messagesProp, onClose }) {
  const isSuccess = type === 'success'
  const messages = messagesProp || (isSuccess
    ? { en: 'Data refreshed successfully', ar: 'تم التحديث بنجاح' }
    : { en: 'Failed to refresh — please try again', ar: 'فشل التحديث، حاول مرة أخرى' })

  return (
    <div
      role="status"
      className={`fixed bottom-5 right-5 z-[200] flex items-start gap-3 pl-4 pr-2 py-3 rounded-xl shadow-2xl
                  border backdrop-blur-md animate-toast-in max-w-xs
                  dark:bg-brand-900/95 bg-white
                  ${isSuccess ? 'border-accent/40' : 'border-red-400/50'}`}
    >
      <span
        className={`flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 mt-0.5 text-sm font-bold
                    ${isSuccess ? 'bg-accent/20 text-accent' : 'bg-red-500/20 text-red-400'}`}
      >
        {isSuccess ? '✓' : '!'}
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold dark:text-white text-brand-900">{messages.en}</p>
        <p className="text-xs mt-0.5 dark:text-white/50 text-brand-500">{messages.ar}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        title="Close"
        className="p-1 rounded-md dark:hover:bg-white/10 hover:bg-brand-100 dark:text-white/40 text-brand-400 transition-colors"
      >
        ✕
      </button>
    </div>
  )
}
