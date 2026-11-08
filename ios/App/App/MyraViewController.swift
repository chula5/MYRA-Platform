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
        // and showing the view's own white beneath the page. Page-level
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
    }
}
