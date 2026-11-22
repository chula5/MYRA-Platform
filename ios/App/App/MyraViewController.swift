//
//  MyraViewController.swift
//  MYRA
//
//  The app's one view controller: Capacitor's bridge, plus the plugins that
//  live in this project rather than in a package. Main.storyboard points here.
//

import UIKit
import Capacitor

class MyraViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MirrorBridgePlugin())
        bridge?.registerPluginInstance(AppleCalendarPlugin())
    }

    override open func viewDidLoad() {
        super.viewDidLoad()
        // The page is the only thing that scrolls. Without this the whole web
        // view rubber-bands at the top and the bottom of a page, carrying the
        // MYRA header, the tab bar and the clock strip down and up with it,
        // and showing the view's own colour beneath the page. Page-level
        // scrolling (and the inner sheets' own scrolling) is untouched.
        webView?.scrollView.bounces = false
        webView?.scrollView.alwaysBounceVertical = false
        webView?.scrollView.alwaysBounceHorizontal = false
        // Whatever ever shows through is the pearl, never white.
        let pearl = UIColor(red: 0.906, green: 0.906, blue: 0.914, alpha: 1)
        view.backgroundColor = pearl
        webView?.backgroundColor = pearl
        webView?.scrollView.backgroundColor = pearl
        webView?.isOpaque = false

        // When the keyboard goes away (after a search, a chat message) the web
        // view can be left scrolled past the top or the foot of the page, so
        // the header sits a band too low or the tab bar floats above the home
        // bar (Chloe, 2026-11-22, Browse "MAXMARA"). Put it back in bounds.
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardDidHide),
            name: UIResponder.keyboardDidHideNotification, object: nil
        )
    }

    @objc private func keyboardDidHide() {
        guard let sv = webView?.scrollView else { return }
        let inset = sv.adjustedContentInset
        let top = -inset.top
        let bottom = max(top, sv.contentSize.height - sv.bounds.height + inset.bottom)
        let y = min(max(sv.contentOffset.y, top), bottom)
        if abs(y - sv.contentOffset.y) > 0.5 || sv.contentOffset.x != -inset.left {
            sv.setContentOffset(CGPoint(x: -inset.left, y: y), animated: true)
        }
    }
}
