import {
  bootstrapUser,
  bootstrapUserSchema,
  WidgetClientConstructorParams,
  WidgetClientConstructorParamsSchema,
  WidgetContext,
  WidgetContextSchema,
  WidgetEventPayloads,
  WidgetEvents,
  WidgetMessage,
  WidgetMethodPayloads,
  WidgetMethods
} from "@/types/api"

export function createWidgetClient(params: WidgetClientConstructorParams): WidgetClient | null {
  try {
    WidgetClientConstructorParamsSchema.parse(params)
  } catch (e) {
    console.error("Invalid widget client params", e)
    return null
  }

  if (typeof window !== "undefined") {
    return new WidgetClient(params)
  }

  console.warn("WidgetClient can only be initialized in a browser environment.")
  return null
}

/**
 * The widget client
 */
class WidgetClient {
  private id: string
  private orgId: string
  private user: bootstrapUser
  private ready = false
  private context: WidgetContext | null = null
  private callQueue: Array<() => void> = []
  private onReady: (() => void) | null = null
  private onNavigate: ((url: string) => void) | null = null
  private onStateChange: ((widgetIsOpen: boolean) => void) | null = null
  private widgetIsOpen: boolean = false

  /**
   * Constructs a new WidgetClient instance.
   *
   * @param id - The ID of the iframe element.
   * @param orgId - The ID of the organization.
   * @param user - A user object to bootstrap the widget with.
   * @param context - Optional context data to associate with this widget instance.
   * @param onReady - Optional callback to execute when the widget is ready.
   * @param onNavigate - Optional callback to execute when the widget navigates.
   * @param onStateChange - Optional callback to execute when the widget's state changes.
   */
  constructor({
    id,
    orgId,
    user,
    context,
    onReady,
    onNavigate,
    onStateChange
  }: WidgetClientConstructorParams) {
    this.id = id
    this.orgId = orgId
    this.user = user || {}
    this.context = context || null
    this.onReady = onReady || null
    this.onNavigate = onNavigate || null
    this.onStateChange = onStateChange || null

    if (!id || !orgId) {
      throw new Error("Missing required parameters: both id and orgId are required.")
    }

    this.throwIfNotBrowser()
    this.setupListeners()
  }

  /**
   * Sends a resize event to the iframe.
   */
  private sendResizeEvent(): void {
    this.postToFrame({
      event: "resize",
      messageType: "event",
      payload: { height: window.innerHeight, width: window.innerWidth }
    })
  }

  /**
   * Sets up event listeners.
   */
  private setupListeners(): void {
    window.addEventListener("message", event => {
      if (event.data.type === "widget") {
        if (!this.ready && event.data.event === "ready") {
          this.bootstrap()
          this.flushQueue()
          this.sendResizeEvent()

          this.ready = true

          if (this?.onReady) {
            this.onReady()
          }
        }

        if (event.data.event === "navigate") {
          const newState = event.data?.pathname.includes("/open")

          if (newState !== this.widgetIsOpen) {
            this.toggle()
          }

          if (this?.onNavigate) {
            this.onNavigate(event.data?.pathname)
          }
        }
      }
    })

    window.addEventListener("resize", () => {
      this.sendResizeEvent()
    })
  }

  /**
   * Bootstraps the widget by sending initial data to the iframe.
   */
  private bootstrap(): void {
    if (this.ready) {
      throw new Error("Widget already bootstrapped")
    }

    this.postToFrame({
      method: "bootstrap",
      payload: { user: this.user, context: this.context, orgId: this.orgId },
      messageType: "method"
    })
  }

  /**
   * Throws an error if not running in a browser environment.
   */
  private throwIfNotBrowser(): void {
    if (typeof window === "undefined") {
      throw new Error("The widget API can only be used in the browser")
    }
  }

  /**
   * Retrieves the iframe element.
   * @returns The iframe element or null.
   */
  private getWidgetEl(): HTMLIFrameElement | null {
    this.throwIfNotBrowser()
    return document.getElementById(this.id) as HTMLIFrameElement
  }

  /**
   * Enqueues a method call.
   * @param fn - The function to enqueue.
   */
  private enqueue(fn: () => void): void {
    this.callQueue.push(fn)
  }

  /**
   * Flushes the queue, executing all enqueued method calls.
   */
  private flushQueue(): void {
    while (this.callQueue.length) {
      const fn = this.callQueue.shift()
      fn?.()
    }
  }

  /**
   * Posts a message to the iframe.
   * @param method - The method to call.
   */
  private postToFrame({
    method,
    event,
    messageType,
    payload
  }: {
    method?: WidgetMethods
    event?: WidgetEvents
    messageType: "method" | "event"
    payload?: WidgetMethodPayloads[WidgetMethods] | WidgetEventPayloads[WidgetEvents]
  }): void {
    const execute = () => {
      this.throwIfNotBrowser()
      const message: WidgetMessage = {
        type: "widget",
        messageType,
        event,
        method,
        payload
      }

      try {
        const $widget = this.getWidgetEl()
        $widget?.contentWindow?.postMessage(message, "*")
      } catch (error) {
        console.error("Failed to post message to iframe:", error)
      }
    }

    if (this.getWidgetEl()) {
      execute()
    } else {
      this.enqueue(execute)
    }
  }

  /**
   * Adjusts the iframe's height.
   * @param height - The new height.
   */
  private adjustFrameHeight({ height }: { height: string }): void {
    const $widget = this.getWidgetEl()
    if ($widget) {
      $widget.style.height = height
    }
  }

  /**
   * Checks if the widget is open.
   * @returns True if open, otherwise false.
   */
  isOpen(): boolean {
    return this.widgetIsOpen
  }

  /**
   * Opens the widget.
   */
  open(): void {
    this.postToFrame({ method: "open", messageType: "method" })
    this.adjustFrameHeight({ height: "100%" })
    this.widgetIsOpen = true

    if (this.onStateChange) {
      this.onStateChange(this.widgetIsOpen)
    }
  }

  /**
   * Closes the widget.
   */
  close(): void {
    this.postToFrame({ method: "close", messageType: "method" })
    this.adjustFrameHeight({ height: "0px" })
    this.widgetIsOpen = false

    if (this.onStateChange) {
      this.onStateChange(this.widgetIsOpen)
    }
  }

  /**
   * Toggles the widget's open state.
   */
  toggle(): void {
    if (this.widgetIsOpen) {
      this.close()
    } else {
      this.open()
    }
  }

  /**
   * Sets the UID and posts it to the iframe.
   * @param uid - The UID to set.
   */
  setUser(user: bootstrapUser): void {
    try {
      bootstrapUserSchema.parse(user)
    } catch (error) {
      console.error("Invalid user:", error)
      return
    }

    this.user = user
    this.postToFrame({ method: `setUser`, messageType: "method", payload: user })
  }

  /**
   * Gets the UID.
   * @returns The current UID or null.
   */
  getUser(): bootstrapUser | null {
    return this.user
  }

  /**
   * Sets the context object and posts it to the iframe.
   * @param context - The context object to set.
   */
  setContext(context: WidgetContext): void {
    try {
      WidgetContextSchema.parse(context)
    } catch (error) {
      console.error("Invalid context:", error)
      return
    }

    this.context = context
    this.postToFrame({ method: "setContext", payload: context, messageType: "method" })
  }

  /**
   * Gets the context object.
   * @returns The current context object or null.
   */
  getContext(): WidgetContext | null {
    return this.context
  }
}
