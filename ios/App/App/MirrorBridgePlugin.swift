//
//  MirrorBridgePlugin.swift
//  MYRA
//
//  The app hands its sign-in to the share sheet. When she is signed in to
//  MYRA inside the app, the site mints her Mirror token and passes it here;
//  it is written to the shared container the share sheet reads, so holding
//  on a piece in Safari and choosing MYRA works without ever opening the
//  Safari extension. Signing out clears it.
//
//  This is the same key the Safari extension writes
//  (App Extension/SafariWebExtensionHandler.swift) — whichever connected
//  last wins, and both carry the same member.
//

import Foundation
import Capacitor

private let appGroupId = "group.uk.co.myraassistant.app"

@objc(MirrorBridgePlugin)
public class MirrorBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MirrorBridgePlugin"
    public let jsName = "MirrorBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasToken", returnType: CAPPluginReturnPromise),
    ]

    @objc func setToken(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("token required")
            return
        }
        let defaults = UserDefaults(suiteName: appGroupId)
        defaults?.set(token, forKey: "mirrorToken")
        if let apiBase = call.getString("apiBase"), !apiBase.isEmpty {
            defaults?.set(apiBase, forKey: "mirrorApiBase")
        }
        call.resolve(["ok": true])
    }

    @objc func clearToken(_ call: CAPPluginCall) {
        let defaults = UserDefaults(suiteName: appGroupId)
        defaults?.removeObject(forKey: "mirrorToken")
        call.resolve(["ok": true])
    }

    @objc func hasToken(_ call: CAPPluginCall) {
        let token = UserDefaults(suiteName: appGroupId)?.string(forKey: "mirrorToken") ?? ""
        call.resolve(["connected": !token.isEmpty])
    }
}
