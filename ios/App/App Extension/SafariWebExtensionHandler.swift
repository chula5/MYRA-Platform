//
//  SafariWebExtensionHandler.swift
//  MYRA Mirror Extension
//
//  The current extension uses browser runtime messaging only. Keep the native
//  bridge ready for future app-to-extension features without adding behavior
//  to the first TestFlight build.
//

import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
