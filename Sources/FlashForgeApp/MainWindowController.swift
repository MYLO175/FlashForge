import AppKit

final class MainWindowController: NSWindowController {
    private let webViewController = WebViewController()

    init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1_280, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "FlashForge"
        window.minSize = NSSize(width: 760, height: 560)
        window.contentViewController = webViewController
        window.setFrameAutosaveName("FlashForgeMainWindow")
        window.center()

        super.init(window: window)
        shouldCascadeWindows = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func runJavaScript(_ source: String) {
        showWindow(nil)
        webViewController.evaluate(source)
    }

    func presentBackupImporter() {
        showWindow(nil)
        webViewController.presentBackupImporter()
    }

    func migrateBackup(from url: URL) {
        showWindow(nil)
        webViewController.migrateBackup(from: url)
    }

    func saveStudySessionIfNeeded() {
        webViewController.evaluate(
            "if (typeof S !== 'undefined' && S.view === 'study' && S.study && !S.study.done && S.setId) { saveStudySession(S.setId); }"
        )
    }
}
