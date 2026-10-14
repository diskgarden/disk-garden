import AppKit
import SwiftUI

/// A minimal disk space viewer: pick a folder, see what's inside it by size, click a folder to dig in.
@main
struct DiskGardenApp: App {
    init() {
        // Run as a regular app (Dock icon, menu bar) when launched with `swift run`.
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate()
    }

    var body: some Scene {
        WindowGroup("DiskGarden") {
            ContentView()
                .frame(minWidth: 560, minHeight: 420)
        }
    }
}
