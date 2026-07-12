const protocolVersion = 1
const reconnectDelayMs = 900
const eventLogRowLimit = 160
const announcedEventKinds = new Set(["complete", "decision", "error"])

const elements = {
  activity: document.querySelector("#activity"),
  activityCount: document.querySelector("#activity-count"),
  activitySection: document.querySelector("#activity-section"),
  brief: document.querySelector("#brief"),
  briefSection: document.querySelector("#brief-section"),
  briefState: document.querySelector("#brief-state"),
  byteThreshold: document.querySelector("#byte-threshold"),
  bytesControl: document.querySelector("#bytes-control"),
  checkList: document.querySelector("#check-list"),
  connectionLabel: document.querySelector("#connection-label"),
  connectionState: document.querySelector("#connection-state"),
  decisionAction: document.querySelector("#decision-action"),
  decisionBranch: document.querySelector("#decision-branch"),
  decisionStrip: document.querySelector("#decision-strip"),
  elapsedTime: document.querySelector("#elapsed-time"),
  eventCounter: document.querySelector("#event-counter"),
  eventLog: document.querySelector("#event-log"),
  eventPanel: document.querySelector("#event-panel"),
  inputBytes: document.querySelector("#input-bytes"),
  inputChunks: document.querySelector("#input-chunks"),
  jsonSize: document.querySelector("#json-size"),
  jsonPanel: document.querySelector("#json-panel"),
  metrics: document.querySelector("#metrics"),
  metricsSection: document.querySelector("#metrics-section"),
  metricsState: document.querySelector("#metrics-state"),
  modeButtons: document.querySelectorAll(".mode-button"),
  nextAction: document.querySelector("#next-action"),
  nextActionSection: document.querySelector("#next-action-section"),
  openAiAvailability: document.querySelector("#openai-availability"),
  openAiMode: document.querySelector("#openai-mode"),
  panelToggles: document.querySelectorAll(".panel-toggle"),
  panelHeader: document.querySelector(".panel-header"),
  policyButtons: document.querySelectorAll(".policy-button"),
  previewTitle: document.querySelector("#preview-title"),
  progressBar: document.querySelector("#progress-bar"),
  prompt: document.querySelector("#prompt"),
  promptLabel: document.querySelector("#prompt-label"),
  readinessScore: document.querySelector("#readiness-score"),
  readinessSection: document.querySelector("#readiness-section"),
  readinessState: document.querySelector("#readiness-state"),
  rawJson: document.querySelector("#raw-json"),
  run: document.querySelector("#run"),
  runLabel: document.querySelector("#run-label"),
  snapshotCount: document.querySelector("#snapshot-count"),
  scoreBar: document.querySelector("#score-bar"),
  stageBadge: document.querySelector("#stage-badge"),
  statusAnnouncer: document.querySelector("#status-announcer"),
  stop: document.querySelector("#stop"),
  terminal: document.querySelector("#terminal")
}

const state = {
  eventCount: 0,
  mode: "fixture",
  runId: null,
  snapshotCount: 0,
  socket: null
}
let isOpenAiAvailable = false
let isRunning = false
const fixtureScenario = elements.prompt.value
let openAiRequest = elements.prompt.dataset.openaiRequest ?? elements.prompt.value
let selectedPolicy = "chunk"
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)")
const activeEntryAnimations = new Set()
const renderState = {
  titleReady: false
}

/** Applies one restrained spring-like entrance without introducing a frontend runtime. */
function animateEntry(element, delay = 0) {
  if (motionPreference.matches || typeof element.animate !== "function") {
    return
  }
  const animation = element.animate(
    [
      { opacity: 0, transform: "translateY(7px) scale(0.99)" },
      { opacity: 1, transform: "translateY(0) scale(1)" }
    ],
    {
      delay,
      duration: 220,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      fill: "backwards"
    }
  )
  activeEntryAnimations.add(animation)
  const forgetAnimation = () => activeEntryAnimations.delete(animation)
  animation.addEventListener("cancel", forgetAnimation, { once: true })
  animation.addEventListener("finish", forgetAnimation, { once: true })
}

/** Gives an existing schema placeholder a stable, non-disappearing materialization cue. */
function animateMaterialization(element) {
  if (motionPreference.matches || typeof element.animate !== "function") {
    return
  }
  const animation = element.animate(
    [{ transform: "translateY(3px)" }, { transform: "translateY(0)" }],
    { duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
  )
  activeEntryAnimations.add(animation)
  const forgetAnimation = () => activeEntryAnimations.delete(animation)
  animation.addEventListener("cancel", forgetAnimation, { once: true })
  animation.addEventListener("finish", forgetAnimation, { once: true })
}

/** Cancels run-scoped entrances when a run resets or reduced motion is enabled. */
function cancelEntryAnimations() {
  for (const animation of activeEntryAnimations) {
    animation.cancel()
  }
  activeEntryAnimations.clear()
}

/** Responds immediately when the operating-system motion preference changes. */
function handleMotionPreferenceChange(event) {
  if (event.matches) {
    cancelEntryAnimations()
  }
}

motionPreference.addEventListener("change", handleMotionPreferenceChange)

/** Creates a text-only element so model output never enters an HTML parsing sink. */
function createTextElement({ className, tagName, text }) {
  const element = document.createElement(tagName)
  if (className) {
    element.className = className
  }
  element.textContent = text
  return element
}

/** Updates text children created by this module without reparsing or replacing their parent. */
function updateTextChildren({ element, texts }) {
  for (const [index, text] of texts.entries()) {
    const child = element.children.item(index)
    if (child) {
      child.textContent = text
    }
  }
}

/** Reconciles append-oriented model arrays so in-flight entrances survive later snapshots. */
function reconcileList({ container, createItem, items, updateItem }) {
  const previousLength = container.childElementCount
  for (const [index, value] of items.entries()) {
    let element = container.children.item(index)
    const isNew = element === null
    if (isNew) {
      element = createItem()
      container.append(element)
    }
    updateItem({ element, value })
    if (isNew) {
      animateEntry(element, Math.max(0, index - previousLength) * 70)
    }
  }
  while (container.childElementCount > items.length) {
    container.lastElementChild?.remove()
  }
}

/** Creates one stable metric node whose fields can fill in across cumulative snapshots. */
function createMetricItem() {
  const item = document.createElement("div")
  item.className = "metric"
  item.append(
    createTextElement({ className: "metric-label", tagName: "span", text: "Pending" }),
    createTextElement({ className: "metric-value", tagName: "strong", text: "Pending" }),
    createTextElement({ className: "metric-trend trend-steady", tagName: "span", text: "steady" })
  )
  return item
}

/** Applies a progressive metric value while preserving the existing animated node. */
function updateMetricItem({ element, value }) {
  const trend = value.trend ?? "steady"
  updateTextChildren({
    element,
    texts: [display(value.label), display(value.value), display(trend, "steady")]
  })
  const trendElement = element.children.item(2)
  if (trendElement) {
    trendElement.className = `metric-trend trend-${trend}`
  }
}

/** Creates one stable activity row for append-only timeline materialization. */
function createActivityItem() {
  const row = document.createElement("li")
  row.append(
    createTextElement({ className: "activity-time", tagName: "time", text: "Pending" }),
    createTextElement({ className: "activity-marker", tagName: "span", text: "" }),
    createTextElement({ className: "activity-label", tagName: "span", text: "Pending" }),
    createTextElement({ className: "activity-state", tagName: "span", text: "queued" })
  )
  return row
}

/** Applies a progressive activity value while preserving the existing animated row. */
function updateActivityItem({ element, value }) {
  element.dataset.state = value.state ?? "queued"
  updateTextChildren({
    element,
    texts: [display(value.time), "", display(value.label), display(value.state, "queued")]
  })
}

/** Creates one stable readiness check for progressive status updates. */
function createCheckItem() {
  const item = document.createElement("li")
  item.append(
    createTextElement({ className: "check-mark", tagName: "span", text: "" }),
    createTextElement({ className: "check-label", tagName: "span", text: "Pending" }),
    createTextElement({ className: "check-status", tagName: "span", text: "watch" })
  )
  return item
}

/** Applies a progressive readiness check while preserving the existing animated row. */
function updateCheckItem({ element, value }) {
  element.dataset.status = value.status ?? "watch"
  updateTextChildren({
    element,
    texts: ["", display(value.label), display(value.status, "watch")]
  })
}

/** Converts nullable progressive values into stable display text. */
function display(value, fallback = "Pending") {
  return typeof value === "string" && value.trim() ? value : fallback
}

/** Formats stream volume without hiding the exact byte count used by the bytes policy. */
function formatBytes(bytes) {
  return new Intl.NumberFormat("en-US").format(bytes)
}

/** Updates frequent progress indicators through compositor-friendly transforms. */
function setBarProgress({ element, percent }) {
  const normalized = Math.max(0, Math.min(100, percent)) / 100
  element.style.transform = `scaleX(${normalized})`
}

/** Marks a generated section as it moves from schema placeholder to materialized content. */
function setSectionState({ element, label, ready, readyText }) {
  const justUnlocked = ready && element.dataset.state !== "unlocked"
  element.dataset.state = ready ? "unlocked" : "locked"
  if (label) {
    label.textContent = ready ? readyText : "Locked"
  }
  if (justUnlocked) {
    animateMaterialization(element)
  }
}

/** Keeps source-chunk volume visible next to the selected snapshot cadence. */
function updateInputStats({ inputBytes, inputChunks }) {
  elements.inputBytes.textContent = formatBytes(inputBytes)
  elements.inputChunks.textContent = String(inputChunks)
}

/** Renders the complete JSON-equivalent snapshot received in the current WebSocket message. */
function renderRawJson(value) {
  const json = JSON.stringify(value, null, 2)
  elements.rawJson.value = json
  elements.jsonSize.textContent = `${formatBytes(new TextEncoder().encode(json).byteLength)} bytes`
}

/** Appends a compact protocol event without ever exposing raw model chunks. */
function appendEvent({ detail, kind, path }) {
  state.eventCount += 1
  const row = document.createElement("div")
  row.className = "event-row"
  row.append(
    createTextElement({ className: `event-kind event-kind-${kind}`, tagName: "span", text: kind }),
    createTextElement({
      className: "event-path",
      tagName: "span",
      text: path || "server"
    }),
    createTextElement({ className: "event-detail", tagName: "span", text: detail })
  )
  elements.eventLog.append(row)
  if (announcedEventKinds.has(kind)) {
    animateEntry(row)
  }
  while (elements.eventLog.childElementCount > eventLogRowLimit) {
    elements.eventLog.firstElementChild?.remove()
  }
  elements.eventLog.scrollTop = elements.eventLog.scrollHeight
  elements.eventCounter.textContent = String(state.eventCount)
  if (announcedEventKinds.has(kind)) {
    elements.statusAnnouncer.textContent = `${kind}: ${detail}`
  }
}

/** Updates connection and generation controls as a single state transition. */
function updateControls() {
  const connected = state.socket?.readyState === WebSocket.OPEN
  const isFixture = state.mode === "fixture"
  const selectedModeAvailable = isFixture || isOpenAiAvailable
  elements.run.disabled = !connected || isRunning || !selectedModeAvailable
  elements.stop.disabled = !(connected && isRunning)
  elements.prompt.disabled = isRunning || isFixture
  elements.promptLabel.textContent = isFixture ? "Fixture scenario" : "Dashboard request"
  elements.prompt.title = isFixture
    ? "Fixed input for the deterministic fixture"
    : "Describe the dashboard data to generate"
  elements.runLabel.textContent = isFixture ? "Replay" : "Generate"
  for (const button of elements.modeButtons) {
    const { mode } = button.dataset
    const unavailable = mode === "openai" && !isOpenAiAvailable
    button.disabled = isRunning
    button.classList.toggle("is-unavailable", unavailable)
    button.classList.toggle("is-active", mode === state.mode)
    button.setAttribute("aria-disabled", String(isRunning || unavailable))
    button.setAttribute("aria-pressed", String(mode === state.mode))
  }
  for (const button of elements.policyButtons) {
    const { policy } = button.dataset
    button.disabled = isRunning
    button.classList.toggle("is-active", policy === selectedPolicy)
    button.setAttribute("aria-pressed", String(policy === selectedPolicy))
  }
  elements.byteThreshold.disabled = isRunning || selectedPolicy !== "bytes"
  elements.bytesControl.hidden = selectedPolicy !== "bytes"
}

/** Preserves the editable OpenAI request while the deterministic fixture remains fixed. */
function selectMode(mode) {
  if (mode === state.mode) {
    return
  }
  if (state.mode === "openai") {
    openAiRequest = elements.prompt.value
  }
  state.mode = mode
  elements.prompt.value = mode === "fixture" ? fixtureScenario : openAiRequest
  updateControls()
}

/** Renders each cumulative schema-shaped snapshot into the dashboard surface. */
function renderSnapshot(snapshot) {
  renderRawJson(snapshot)
  const interfaceValue = snapshot.interface ?? {}
  const readiness = snapshot.readiness ?? {}
  const triage = snapshot.triage ?? {}
  elements.previewTitle.textContent = display(interfaceValue.title, "Materializing snapshot")
  elements.stageBadge.textContent = display(
    interfaceValue.status,
    display(triage.severity, "Parsing")
  )
  elements.stageBadge.dataset.accent = interfaceValue.accent ?? "green"
  elements.brief.textContent = display(snapshot.brief, "Receiving brief")
  elements.nextAction.textContent = display(snapshot.nextAction)
  const titleReady = typeof interfaceValue.title === "string" && interfaceValue.title.length > 0
  if (titleReady && !renderState.titleReady) {
    renderState.titleReady = true
    animateEntry(elements.previewTitle)
    animateEntry(elements.stageBadge, 50)
  }
  const briefReady = typeof snapshot.brief === "string" && snapshot.brief.length > 0
  const nextActionReady = typeof snapshot.nextAction === "string" && snapshot.nextAction.length > 0
  setSectionState({
    element: elements.briefSection,
    label: elements.briefState,
    ready: briefReady,
    readyText: "Ready"
  })
  setSectionState({
    element: elements.nextActionSection,
    ready: nextActionReady,
    readyText: "Ready"
  })

  const metrics = Array.isArray(interfaceValue.metrics) ? interfaceValue.metrics : []
  reconcileList({
    container: elements.metrics,
    createItem: createMetricItem,
    items: metrics,
    updateItem: updateMetricItem
  })
  setSectionState({
    element: elements.metricsSection,
    label: elements.metricsState,
    ready: metrics.length > 0,
    readyText: `${metrics.length} ready`
  })

  const activity = Array.isArray(interfaceValue.activity) ? interfaceValue.activity : []
  reconcileList({
    container: elements.activity,
    createItem: createActivityItem,
    items: activity,
    updateItem: updateActivityItem
  })
  elements.activityCount.textContent = `${activity.length} ${activity.length === 1 ? "event" : "events"}`
  setSectionState({
    element: elements.activitySection,
    ready: activity.length > 0,
    readyText: "Ready"
  })

  const score = typeof readiness.score === "number" ? readiness.score : null
  const checks = Array.isArray(readiness.checks) ? readiness.checks : []
  elements.readinessScore.textContent = score === null ? "--" : String(score)
  setBarProgress({ element: elements.scoreBar, percent: score ?? 0 })
  reconcileList({
    container: elements.checkList,
    createItem: createCheckItem,
    items: checks,
    updateItem: updateCheckItem
  })
  setSectionState({
    element: elements.readinessSection,
    label: elements.readinessState,
    ready: score !== null || checks.length > 0,
    readyText: score === null ? `${checks.length} checks` : `${score}%`
  })
}

/** Applies the conditional server branch as soon as its source value completes. */
function renderDecision(event) {
  elements.decisionStrip.hidden = false
  elements.decisionStrip.dataset.branch = event.branch
  elements.decisionBranch.textContent =
    event.branch === "approval-gate" ? "Approval gate" : "Auto-stage"
  elements.decisionAction.textContent = event.action
  animateEntry(elements.decisionStrip)
  appendEvent({ detail: event.rationale, kind: "decision", path: event.path.join(".") })
}

/** Collapses one inspection half and lets its sibling consume the remaining sidebar height. */
function toggleInspectionPanel(button) {
  const panelName = button.dataset.panelToggle
  const panel = panelName === "events" ? elements.eventPanel : elements.jsonPanel
  const content = panelName === "events" ? elements.eventLog : elements.rawJson
  const collapsed = panel.dataset.collapsed !== "true"
  const label = panelName === "events" ? "event log" : "raw snapshot JSON"

  panel.dataset.collapsed = String(collapsed)
  content.hidden = collapsed
  elements.terminal.dataset[`${panelName}Collapsed`] = String(collapsed)
  button.setAttribute("aria-expanded", String(!collapsed))
  button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${label}`)
  button.title = `${collapsed ? "Expand" : "Collapse"} ${label}`
  if (!collapsed) {
    animateEntry(content)
  }
}

/** Resets only run-scoped UI while preserving the socket session. */
function resetRun() {
  cancelEntryAnimations()
  renderState.titleReady = false
  state.eventCount = 0
  state.snapshotCount = 0
  elements.eventLog.replaceChildren()
  elements.statusAnnouncer.textContent = ""
  elements.eventCounter.textContent = "0"
  renderRawJson({})
  elements.snapshotCount.textContent = "0 snapshots"
  updateInputStats({ inputBytes: 0, inputChunks: 0 })
  elements.elapsedTime.textContent = "0 ms"
  setBarProgress({ element: elements.progressBar, percent: 2 })
  elements.decisionStrip.hidden = true
  elements.metrics.replaceChildren()
  elements.activity.replaceChildren()
  elements.checkList.replaceChildren()
  elements.activityCount.textContent = "0 events"
  elements.previewTitle.textContent = "Materializing snapshot"
  elements.brief.textContent = "Waiting for the first complete value."
  elements.nextAction.textContent = "Pending"
  elements.stageBadge.textContent = "Starting"
  elements.readinessScore.textContent = "--"
  setBarProgress({ element: elements.scoreBar, percent: 0 })
  setSectionState({
    element: elements.briefSection,
    label: elements.briefState,
    ready: false,
    readyText: "Ready"
  })
  setSectionState({
    element: elements.metricsSection,
    label: elements.metricsState,
    ready: false,
    readyText: "Ready"
  })
  setSectionState({
    element: elements.activitySection,
    ready: false,
    readyText: "Ready"
  })
  setSectionState({
    element: elements.nextActionSection,
    ready: false,
    readyText: "Ready"
  })
  setSectionState({
    element: elements.readinessSection,
    label: elements.readinessState,
    ready: false,
    readyText: "Ready"
  })
}

/** Returns whether a run-scoped message belongs to an older generation. */
function isStaleRunEvent(event) {
  return state.runId !== null && event.runId !== state.runId
}

/** Applies server capability metadata after the socket opens. */
function handleHelloEvent(event) {
  isOpenAiAvailable = event.openAiAvailable === true
  if (!isOpenAiAvailable && state.mode === "openai") {
    selectMode("fixture")
  }
  elements.openAiMode.title = isOpenAiAvailable
    ? `Generate with ${event.model}`
    : "OPENAI_API_KEY unavailable"
  elements.openAiAvailability.textContent = isOpenAiAvailable
    ? `OpenAI model ${event.model} is available.`
    : "OpenAI is unavailable because the server has no OPENAI_API_KEY."
  appendEvent({
    detail: isOpenAiAvailable
      ? `Fixture ready · OpenAI ${event.model} available`
      : "Fixture ready · OpenAI unavailable",
    kind: "ready"
  })
  updateControls()
}

/** Reconciles the optimistic run state with the server-assigned run identifier. */
function handleStatusEvent(event) {
  if (event.phase === "generating") {
    state.runId = event.runId
    isRunning = true
  } else if (!isStaleRunEvent(event)) {
    state.runId = null
    isRunning = false
  }
  elements.stageBadge.textContent = isRunning ? "Generating" : elements.stageBadge.textContent
  updateControls()
}

/** Renders one accepted cumulative snapshot and its completion summary. */
function handleSnapshotEvent(event) {
  if (isStaleRunEvent(event)) {
    return
  }
  state.snapshotCount = event.sequence
  renderSnapshot(event.snapshot)
  updateInputStats(event)
  elements.snapshotCount.textContent = `${event.sequence} snapshots`
  setBarProgress({
    element: elements.progressBar,
    percent: Math.min(94, 8 + event.completedValues * 5)
  })
  const completed = event.completedPaths.map(path => path.join(".")).filter(Boolean)
  appendEvent({
    detail: `${event.policy.mode} · ${completed.length} value${completed.length === 1 ? "" : "s"} · ${event.inputChunks} chunks in`,
    kind: "snapshot",
    path: completed.at(-1) ?? "root"
  })
}

/** Applies the authoritative final object for the active run. */
function handleCompleteEvent(event) {
  if (isStaleRunEvent(event)) {
    return
  }
  isRunning = false
  renderSnapshot(event.output)
  updateInputStats(event)
  setBarProgress({ element: elements.progressBar, percent: 100 })
  elements.elapsedTime.textContent = `${event.durationMs} ms`
  elements.stageBadge.textContent = "Complete"
  appendEvent({ detail: "Authoritative output matched final snapshot", kind: "complete" })
  updateControls()
}

/** Keeps busy responses attached to the active run and rejects stale run failures. */
function handleErrorEvent(event) {
  if (typeof event.runId === "number" && isStaleRunEvent(event)) {
    return
  }
  if (event.code === "busy" && typeof event.runId === "number") {
    state.runId = event.runId
    isRunning = true
    elements.stageBadge.textContent = "Generating"
  } else {
    state.runId = null
    isRunning = false
    elements.stageBadge.textContent = event.code === "cancelled" ? "Cancelled" : "Error"
  }
  appendEvent({ detail: event.message, kind: "error" })
  updateControls()
}

const serverEventHandlers = {
  complete: handleCompleteEvent,
  decision(event) {
    if (!isStaleRunEvent(event)) {
      renderDecision(event)
    }
  },
  error: handleErrorEvent,
  hello: handleHelloEvent,
  snapshot: handleSnapshotEvent,
  status: handleStatusEvent
}

/** Dispatches a versioned server message to its narrow UI update. */
function handleServerEvent(event) {
  const compatible =
    event &&
    typeof event === "object" &&
    event.version === protocolVersion &&
    typeof event.type === "string" &&
    Object.hasOwn(serverEventHandlers, event.type)
  if (!compatible) {
    appendEvent({ detail: "Ignored an incompatible protocol message", kind: "error" })
    return
  }
  serverEventHandlers[event.type](event)
}

/** Fetches the process-scoped capability required for an exact-origin WebSocket upgrade. */
async function readSessionToken() {
  const response = await fetch("/session", {
    cache: "no-store",
    headers: { Accept: "application/json" }
  })
  if (!response.ok) {
    throw new Error("Session capability request failed")
  }
  const payload = await response.json()
  if (!payload || typeof payload !== "object" || typeof payload.token !== "string") {
    throw new Error("Session capability response was invalid")
  }
  return payload.token
}

/** Sets the visible disconnected state shared by failed handshakes and closed sockets. */
function markReconnecting() {
  isRunning = false
  isOpenAiAvailable = false
  state.runId = null
  elements.openAiAvailability.textContent = "Checking OpenAI availability."
  elements.openAiMode.title = "Checking OpenAI availability"
  elements.connectionState.dataset.state = "disconnected"
  elements.connectionLabel.textContent = "Reconnecting"
  updateControls()
}

/** Starts a handled connection attempt so rejected session requests never become unhandled. */
function startConnection() {
  connect().catch(() => {
    markReconnecting()
    setTimeout(startConnection, reconnectDelayMs)
  })
}

/** Opens the capability-bound socket after obtaining the process-scoped browser token. */
async function connect() {
  const token = await readSessionToken()
  const protocol = location.protocol === "https:" ? "wss:" : "ws:"
  const socket = new WebSocket(
    `${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`
  )
  state.socket = socket
  elements.connectionState.dataset.state = "connecting"
  elements.connectionLabel.textContent = "Connecting"
  updateControls()

  socket.addEventListener("open", () => {
    elements.connectionState.dataset.state = "connected"
    elements.connectionLabel.textContent = "Connected"
    updateControls()
  })
  socket.addEventListener("message", message => {
    try {
      handleServerEvent(JSON.parse(message.data))
    } catch {
      appendEvent({ detail: "Rejected a malformed server message", kind: "error" })
    }
  })
  socket.addEventListener("close", () => {
    markReconnecting()
    setTimeout(startConnection, reconnectDelayMs)
  })
}

for (const button of elements.modeButtons) {
  button.addEventListener("click", () => {
    const { mode } = button.dataset
    const availableMode = mode === "fixture" || (mode === "openai" && isOpenAiAvailable)
    if (availableMode) {
      selectMode(mode)
    }
  })
}

elements.prompt.addEventListener("input", () => {
  if (state.mode === "openai") {
    openAiRequest = elements.prompt.value
  }
})

for (const button of elements.policyButtons) {
  button.addEventListener("click", () => {
    const { policy } = button.dataset
    if (policy) {
      selectedPolicy = policy
      updateControls()
    }
  })
}

for (const button of elements.panelToggles) {
  button.addEventListener("click", () => toggleInspectionPanel(button))
}

elements.run.addEventListener("click", () => {
  const prompt = elements.prompt.value.trim()
  if (!(prompt && !isRunning && state.socket?.readyState === WebSocket.OPEN)) {
    return
  }
  isRunning = true
  state.runId = null
  resetRun()
  updateControls()
  const snapshotPolicy =
    selectedPolicy === "bytes"
      ? { bytes: Number(elements.byteThreshold.value), mode: "bytes" }
      : { mode: selectedPolicy }
  state.socket.send(JSON.stringify({ mode: state.mode, prompt, snapshotPolicy, type: "start" }))
})

elements.stop.addEventListener("click", () => {
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({ type: "cancel" }))
  }
})

startConnection()
