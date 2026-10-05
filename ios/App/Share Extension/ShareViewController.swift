//
//  ShareViewController.swift
//  MYRA Share
//
//  Hold on a piece in Safari and hand it to MYRA — or share a brand's
//  Instagram and let MYRA find the shop behind it. The sheet asks the server
//  one question, "what is this?", and shows the answer in a sentence.
//
//  The token is written to the shared container by the app itself when she
//  is signed in (App/MirrorBridgePlugin.swift), or by the Safari extension
//  when she connects there. Either way this sheet never asks her to sign in.
//  Without it, the sheet says so plainly rather than failing silently.
//

import UIKit
import UniformTypeIdentifiers

/// The container the app, the Safari extension and this sheet all read.
private let appGroupId = "group.uk.co.myraassistant.app"
private let defaultApiBase = "https://www.myraassistant.co.uk"

final class ShareViewController: UIViewController {

    private let card = UIView()
    private let mark = UIImageView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let heading = UILabel()
    private let detail = UILabel()
    private let doneButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(white: 0, alpha: 0.35)
        buildCard()
        Task { await handleShare() }
    }

    // MARK: - The card

    private func buildCard() {
        card.backgroundColor = UIColor(red: 0.97, green: 0.97, blue: 0.98, alpha: 1)
        card.layer.cornerRadius = 22
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        mark.image = UIImage(systemName: "sparkles")
        mark.contentMode = .scaleAspectFit
        mark.tintColor = UIColor(white: 0.17, alpha: 1)
        mark.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(mark)

        spinner.color = UIColor(white: 0.4, alpha: 1)
        spinner.hidesWhenStopped = true
        spinner.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(spinner)

        heading.text = "MYRA"
        heading.font = .systemFont(ofSize: 11, weight: .semibold)
        heading.textColor = UIColor(white: 0.45, alpha: 1)
        heading.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(heading)

        detail.text = "Looking at this…"
        detail.font = .systemFont(ofSize: 16, weight: .medium)
        detail.textColor = UIColor(white: 0.17, alpha: 1)
        detail.numberOfLines = 0
        detail.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(detail)

        doneButton.setTitle("Close", for: .normal)
        doneButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        doneButton.tintColor = .white
        doneButton.backgroundColor = UIColor(white: 0.08, alpha: 1)
        doneButton.layer.cornerRadius = 18
        doneButton.addTarget(self, action: #selector(finish), for: .touchUpInside)
        doneButton.isHidden = true
        doneButton.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(doneButton)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 320),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            card.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),

            mark.topAnchor.constraint(equalTo: card.topAnchor, constant: 22),
            mark.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            mark.widthAnchor.constraint(equalToConstant: 26),
            mark.heightAnchor.constraint(equalToConstant: 26),

            spinner.centerYAnchor.constraint(equalTo: mark.centerYAnchor),
            spinner.leadingAnchor.constraint(equalTo: mark.trailingAnchor, constant: 10),

            heading.topAnchor.constraint(equalTo: mark.bottomAnchor, constant: 14),
            heading.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            heading.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22),

            detail.topAnchor.constraint(equalTo: heading.bottomAnchor, constant: 6),
            detail.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            detail.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22),

            doneButton.topAnchor.constraint(equalTo: detail.bottomAnchor, constant: 18),
            doneButton.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            doneButton.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -22),
        ])
        spinner.startAnimating()
    }

    // MARK: - What was shared

    /// The first web URL in the share, or a URL inside shared text.
    private func sharedURL() async -> URL? {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return nil }
        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    return url
                }
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                   let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String,
                   let found = firstURL(in: text) {
                    return found
                }
            }
        }
        return nil
    }

    private func firstURL(in text: String) -> URL? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        return detector.firstMatch(in: text, options: [], range: range)?.url
    }

    // MARK: - The work

    private func handleShare() async {
        guard let url = await sharedURL() else {
            await show("Nothing to keep", "MYRA could not find a link in what you shared.")
            return
        }
        let group = UserDefaults(suiteName: appGroupId)
        guard let token = group?.string(forKey: "mirrorToken"), !token.isEmpty else {
            await show("Not connected yet", "Open the MYRA app and sign in, then share again.")
            return
        }
        let base = group?.string(forKey: "mirrorApiBase") ?? defaultApiBase
        let path = base.hasSuffix("/") ? base + "api/mirror/share" : base + "/api/mirror/share"
        guard let endpoint = URL(string: path) else {
            await show("Something went wrong", "MYRA could not reach itself.")
            return
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 45
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["url": url.absoluteString])

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            if let message = json?["message"] as? String, !message.isEmpty {
                await show(code < 300 ? "Kept" : "Not this time", message)
            } else if let error = json?["error"] as? String {
                await show("Not this time", error)
            } else {
                await show("Not this time", "MYRA could not read that page.")
            }
        } catch {
            await show("Not this time", "MYRA could not reach the internet just then.")
        }
    }

    @MainActor
    private func show(_ title: String, _ body: String) {
        spinner.stopAnimating()
        heading.text = title.uppercased()
        detail.text = body
        doneButton.isHidden = false
    }

    @objc private func finish() {
        spinner.stopAnimating()
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
