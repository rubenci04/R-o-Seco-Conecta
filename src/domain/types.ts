import type { z } from 'zod'
import type * as s from './schemas'

export type DayType = z.infer<typeof s.dayTypeSchema>
export type Direction = z.infer<typeof s.directionSchema>
export type Company = z.infer<typeof s.companySchema>
export type Stop = z.infer<typeof s.stopSchema>
export type Locality = z.infer<typeof s.localitySchema>
export type Service = z.infer<typeof s.serviceSchema>
export type Holiday = z.infer<typeof s.holidaySchema>
export type TransportData = z.infer<typeof s.transportDataSchema>
export type NewsItem = z.infer<typeof s.newsItemSchema>
export type AlertItem = z.infer<typeof s.alertSchema>
export type EventItem = z.infer<typeof s.eventSchema>
export type Obituary = z.infer<typeof s.obituarySchema>
export type Radio = z.infer<typeof s.radioSchema>
