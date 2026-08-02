// Teamwork task URLs are keyed by the Tasks sheet's "TASK ID" column (a
// plain numeric Teamwork task ID, e.g. 40590302 — verified against the
// "Raw Tasks" sheet/API response, not a compound or project-scoped ID).
const TEAMWORK_TASK_URL = taskId => `https://maznexa.teamwork.com/#/tasks/${taskId}`

// Small "open in Teamwork" icon-link placed next to a task name — separate
// from any in-dashboard click target (e.g. a modal-opening button) so it
// never intercepts that click; it only ever opens Teamwork in a new tab.
// Shared across every tab that displays a task name (Task Details, Tags,
// Weekly Report, etc.) so any future change to the link's shape/behavior
// only needs to happen here. Renders nothing if `taskId` is missing.
export default function TeamworkLink({ taskId }) {
  if (!taskId) return null
  return (
    <a
      href={TEAMWORK_TASK_URL(taskId)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title="Open in Teamwork"
      aria-label="Open task in Teamwork"
      className="shrink-0 dark:text-white/40 text-brand-400 hover:dark:text-accent hover:text-brand-600"
    >
      ↗
    </a>
  )
}
