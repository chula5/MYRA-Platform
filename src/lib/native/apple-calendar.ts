'use client'

// HER IPHONE'S CALENDAR, from the web side. Inside the MYRA app a native
// plugin (ios/App/App/AppleCalendarPlugin.swift) reads EventKit; in a browser
// there is nothing here and `appleCalendarAvailable()` says so, so the Events
// page can offer the right door.

import { Capacitor, registerPlugin } from '@capacitor/core'

export interface DeviceCalendarEvent { id: string; title: string; startsAt: string; endsAt?: string; allDay: boolean; location?: string; calendar?: string }
type Access = 'granted' | 'denied' | 'prompt'

interface AppleCalendarPlugin {
  status(): Promise<{ status: Access }>
  requestAccess(): Promise<{ status: Access }>
  upcomingEvents(o: { days: number }): Promise<{ events: DeviceCalendarEvent[] }>
}

const AppleCalendar = registerPlugin<AppleCalendarPlugin>('AppleCalendar')

/** True only inside the iPhone app, on a build that carries the plugin. */
export function appleCalendarAvailable(): boolean {
  if (typeof window === 'undefined') return false
  try { return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AppleCalendar') } catch { return false }
}

/** Whether the phone has already said yes, without asking again. */
export async function appleCalendarGranted(): Promise<boolean> {
  if (!appleCalendarAvailable()) return false
  try { return (await AppleCalendar.status()).status === 'granted' } catch { return false }
}

/**
 * Ask the phone (once) and read the next `days` of events. `denied` means she
 * said no, or did once: Settings → MYRA → Calendars is the way back in.
 */
export async function readAppleCalendar(days = 90): Promise<{ events?: DeviceCalendarEvent[]; denied?: boolean; error?: string }> {
  if (!appleCalendarAvailable()) return { error: 'Open the MYRA iPhone app to connect Apple Calendar.' }
  try {
    let { status } = await AppleCalendar.status()
    if (status !== 'granted') status = (await AppleCalendar.requestAccess()).status
    if (status !== 'granted') return { denied: true }
    const { events } = await AppleCalendar.upcomingEvents({ days })
    return { events: events ?? [] }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read the calendar' }
  }
}
