//
//  AppleCalendarPlugin.swift
//  MYRA
//
//  Her iPhone's calendar, read on the phone. The app asks once for calendar
//  access, reads the next few months of events, and hands them to the site,
//  which keeps only the ones worth dressing for (lib/calendar/occasion.ts).
//  Nothing is written to her calendar and no token leaves the phone: the
//  events themselves are the only thing sent.
//

import Foundation
import Capacitor
import EventKit

@objc(AppleCalendarPlugin)
public class AppleCalendarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleCalendarPlugin"
    public let jsName = "AppleCalendar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "upcomingEvents", returnType: CAPPluginReturnPromise),
    ]

    private let store = EKEventStore()

    private func statusName() -> String {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .authorized: return "granted"
        case .fullAccess: return "granted"
        case .writeOnly: return "denied"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["status": statusName()])
    }

    @objc func requestAccess(_ call: CAPPluginCall) {
        let done: (Bool, Error?) -> Void = { granted, _ in
            call.resolve(["status": granted ? "granted" : "denied"])
        }
        if #available(iOS 17.0, *) {
            store.requestFullAccessToEvents(completion: done)
        } else {
            store.requestAccess(to: .event, completion: done)
        }
    }

    @objc func upcomingEvents(_ call: CAPPluginCall) {
        guard statusName() == "granted" else {
            call.reject("Calendar access has not been given")
            return
        }
        let days = max(1, min(call.getInt("days") ?? 90, 365))
        let start = Date()
        let end = Calendar.current.date(byAdding: .day, value: days, to: start) ?? start
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let events: [[String: Any]] = store.events(matching: predicate)
            .sorted { $0.startDate < $1.startDate }
            .prefix(400)
            .map { e in
                var row: [String: Any] = [
                    "id": e.eventIdentifier ?? "\(e.calendarItemIdentifier)",
                    "title": e.title ?? "",
                    "startsAt": iso.string(from: e.startDate),
                    "allDay": e.isAllDay,
                    "calendar": e.calendar?.title ?? "",
                ]
                if let endDate = e.endDate { row["endsAt"] = iso.string(from: endDate) }
                if let location = e.location, !location.isEmpty { row["location"] = location }
                return row
            }
        call.resolve(["events": events])
    }
}
