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
}
