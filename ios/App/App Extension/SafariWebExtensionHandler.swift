//
//  SafariWebExtensionHandler.swift
//  MYRA Mirror Extension
//
//  One job: when she connects MYRA in Safari, the extension hands the Mirror
//  token across the native bridge, and we write it to the shared container.
//  The share sheet reads it from there, so holding on a piece and sharing it
//  to MYRA never asks her to sign in again. On disconnect the token is
//  cleared from the same place.
//

import SafariServices

private let appGroupId = "group.uk.co.myraassistant.app"

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any]

        if message?["type"] as? String == "mirrorToken" {
            let defaults = UserDefaults(suiteName: appGroupId)
            if let token = message?["token"] as? String, !token.isEmpty {
                defaults?.set(token, forKey: "mirrorToken")
                if let apiBase = message?["apiBase"] as? String, !apiBase.isEmpty {
                    defaults?.set(apiBase, forKey: "mirrorApiBase")
                }
            } else {
                defaults?.removeObject(forKey: "mirrorToken")
            }
        }

        context.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
