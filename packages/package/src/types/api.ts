import { z } from "zod"

export const bootstrapUserSchema = z.object({
  uid: z.string().optional(),
  externalId: z.string().optional(),
  email: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional()
})

export const WidgetContextSchema = z.object({})

export const WidgetMethodPayloadsSchema = z
  .object({
    open: z.undefined(),
    close: z.undefined(),
    toggle: z.undefined(),
    setUser: z.object({ user: bootstrapUserSchema }),
    setContext: z.record(z.unknown()).optional(),
    bootstrap: z.object({
      user: bootstrapUserSchema.optional(),
      context: z.record(z.unknown()).optional()
    })
  })
  .catchall(z.unknown())

export const WidgetEventPayloadsSchema = z.object({
  resize: z.object({ height: z.number(), width: z.number() })
})

export const WidgetClientConstructorParamsSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  user: bootstrapUserSchema.optional(),
  context: WidgetContextSchema.optional(),
  onReady: z.function().optional(),
  onNavigate: z.function().optional(),
  onStateChange: z.function().optional()
})

export type WidgetClientConstructorParams = z.infer<typeof WidgetClientConstructorParamsSchema>
export type bootstrapUser = z.infer<typeof bootstrapUserSchema>
export type WidgetContext = z.infer<typeof WidgetContextSchema>
export type WidgetMethodPayloads = z.infer<typeof WidgetMethodPayloadsSchema>
export type WidgetEventPayloads = z.infer<typeof WidgetEventPayloadsSchema>

export type WidgetEvents = keyof WidgetEventPayloads
export type WidgetEventHandler<T> = (payload: T) => void | Promise<void>
export type WidgetEventHandlers = {
  [K in keyof WidgetEventPayloads]: WidgetEventHandler<WidgetEventPayloads[K]>
}

export type WidgetMethods = keyof WidgetMethodPayloads
export type WidgetMethodHandler<T> = (payload: T) => void | Promise<void>

export type WidgetMethodHandlers = {
  [K in keyof WidgetMethodPayloads]: WidgetMethodHandler<WidgetMethodPayloads[K]>
}

export interface WidgetMethodMessage {
  messageType: "method"
  method: WidgetMethods
  payload?: WidgetMethodPayloads[WidgetMethods]
}

export interface WidgetEventMessage {
  messageType: "event"
  event: WidgetEvents
  payload?: WidgetMethodPayloads[WidgetMethods] | WidgetEventPayloads[WidgetEvents]
}

export type WidgetMessage = {
  type: "widget"
} & (WidgetMethodMessage | WidgetEventMessage)
