// Business Development tab — transforms over the same Tasks-sheet rows
// `transformData.js` already reads (via useTasks()/fetchTasks()). No new
// fetch layer: PROJECT/TASK LIST/CLIENT/TEAM are unpopulated for every row
// in the live sheet (verified directly against the Sheets API), so a
// Teamwork "Business Development" project + "Client" tasklist can't be
// filtered on. Instead a task counts as a BizDev Lead when it has a Tag, a
// Workflow Stage, AND at least one of the 4 BizDev custom fields set —
// confirmed against the live data with Noura as the right proxy for "this
// task belongs to the Business Development pipeline".

function splitList(value) {
  return (value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

// `CF: Proposal Status` values that read as "still being worked" per Noura,
// folded into the same "In Progress" KPI/donut bucket as the literal
// `in Progress` value (same green badge for all three in the UI layer).
export const IN_PROGRESS_STATUSES = new Set(['in Progress', 'Budget', 'Under review by Management'])
export const DISQUALIFIED_STATUSES = new Set(['Reject', 'Lost', 'Out of scope', 'No Response'])

export const TIERS = ['Tier A', 'Tier B', 'Tier C']

// Raw Tasks-sheet row -> shaped BizDev lead. Kept flat (no nested `row`)
// since every BizDev widget only ever needs these fields.
function shapeLeadTask(row) {
  return {
    taskId: row['TASK ID'],
    taskName: row['TASK NAME'] || 'Untitled Task',
    assignees: splitList(row['ASSIGNEE(S)']),
    assigneeLabel: row['ASSIGNEE(S)'] || '',
    tags: splitList(row['TAGS']),
    tagsLabel: row['TAGS'] || '',
    stage: (row['STAGE'] || '').trim(),
    proposalSource: (row['CF: Proposal Source'] || '').trim(),
    proposalStatus: (row['CF: Proposal Status'] || '').trim(),
    tiering: (row['CF: Tiering'] || '').trim(),
    meetings: row['CF: Meetings'] !== '' && row['CF: Meetings'] != null
      ? Number(row['CF: Meetings']) || 0
      : null,
  }
}

export function getBizDevLeadTasks(rawTasks) {
  return rawTasks
    .filter(row => {
      if (splitList(row['TAGS']).length === 0) return false
      if (!(row['STAGE'] || '').trim()) return false
      return Boolean(
        (row['CF: Proposal Source'] || '').trim() ||
        (row['CF: Proposal Status'] || '').trim() ||
        (row['CF: Tiering'] || '').trim() ||
        (row['CF: Meetings'] || '').trim()
      )
    })
    .map(shapeLeadTask)
}

// Data Scope enforcement — mirrors the `allowedNames` pattern used across
// transformData.js (e.g. filterTasksByAllowedNames). `allowedNames === null`
// means no restriction (Admin / "All Employees" scope).
export function filterLeadTasksByAllowedNames(leadTasks, allowedNames) {
  if (!allowedNames) return leadTasks
  return leadTasks.filter(t => t.assignees.some(n => allowedNames.has(n)))
}

export function calcBizDevKPIs(leadTasks) {
  let inProgress = 0
  let send = 0
  let disqualified = 0
  leadTasks.forEach(t => {
    if (IN_PROGRESS_STATUSES.has(t.proposalStatus)) inProgress += 1
    else if (t.proposalStatus === 'Send') send += 1
    else if (DISQUALIFIED_STATUSES.has(t.proposalStatus)) disqualified += 1
  })
  return { totalLeads: leadTasks.length, inProgress, send, disqualified }
}

function groupByField(leadTasks, field) {
  const counts = {}
  leadTasks.forEach(t => {
    const key = t[field]
    if (!key) return // blank values aren't a real slice for these donuts
    counts[key] = (counts[key] || 0) + 1
  })
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

export const groupByProposalStatus = leadTasks => groupByField(leadTasks, 'proposalStatus')
export const groupByProposalSource = leadTasks => groupByField(leadTasks, 'proposalSource')
export const groupByTiering = leadTasks => groupByField(leadTasks, 'tiering')

export function calcLeadsPerEmployee(leadTasks) {
  const counts = {}
  leadTasks.forEach(t => {
    t.assignees.forEach(name => { counts[name] = (counts[name] || 0) + 1 })
  })
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

export function calcTierByEmployee(leadTasks) {
  const byEmp = {}
  leadTasks.forEach(t => {
    if (!TIERS.includes(t.tiering)) return
    t.assignees.forEach(name => {
      if (!byEmp[name]) byEmp[name] = { name, 'Tier A': 0, 'Tier B': 0, 'Tier C': 0 }
      byEmp[name][t.tiering] += 1
    })
  })
  return Object.values(byEmp).sort(
    (a, b) => (b['Tier A'] + b['Tier B'] + b['Tier C']) - (a['Tier A'] + a['Tier B'] + a['Tier C'])
  )
}

export const getTasksByProposalStatus = (leadTasks, status) => leadTasks.filter(t => t.proposalStatus === status)
export const getTasksByProposalSource = (leadTasks, source) => leadTasks.filter(t => t.proposalSource === source)
export const getTasksByTier = (leadTasks, tier) => leadTasks.filter(t => t.tiering === tier)
export const getTasksByEmployee = (leadTasks, name) => leadTasks.filter(t => t.assignees.includes(name))
