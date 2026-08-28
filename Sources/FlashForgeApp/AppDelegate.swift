import AppKit

@MainActor
@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windowController: MainWindowController?

    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMainMenu()
        showMainWindow()
        migrateLaunchBackupIfPresent()
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        windowController?.saveStudySessionIfNeeded()
        return .terminateNow
    }

    @objc private func showMainWindow() {
        if windowController == nil {
            windowController = MainWindowController()
        }
        windowController?.showWindow(nil)
    }

    @objc private func importQuizlet() {
        windowController?.runJavaScript("modalImport(null)")
    }

    @objc private func importSets() {
        windowController?.runJavaScript("importSetsFile()")
    }

    @objc private func exportSets() {
        windowController?.runJavaScript("exportSetsFile()")
    }

    @objc private func importBackup() {
        windowController?.presentBackupImporter()
    }

    @objc private func exportBackup() {
        windowController?.runJavaScript("exportBackup()")
    }

    @objc private func showSettings() {
        windowController?.runJavaScript("modalSettings()")
    }

    @objc private func goHome() {
        windowController?.runJavaScript("nav('home')")
    }

    private func migrateLaunchBackupIfPresent() {
        let arguments = CommandLine.arguments
        guard let flagIndex = arguments.firstIndex(of: "--migrate-backup"),
              arguments.indices.contains(flagIndex + 1) else {
            return
        }

        let url = URL(fileURLWithPath: arguments[flagIndex + 1])
        windowController?.migrateBackup(from: url)
    }

    private func configureMainMenu() {
        let mainMenu = NSMenu()
        NSApplication.shared.mainMenu = mainMenu

        let appItem = mainMenu.addItem(withTitle: "FlashForge", action: nil, keyEquivalent: "")
        let appMenu = NSMenu(title: "FlashForge")
        mainMenu.setSubmenu(appMenu, for: appItem)
        appMenu.addItem(
            withTitle: "About FlashForge",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Settings...", action: #selector(showSettings), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide FlashForge", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(
            withTitle: "Hide Others",
            action: #selector(NSApplication.hideOtherApplications(_:)),
            keyEquivalent: "h"
        )
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit FlashForge", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let fileItem = mainMenu.addItem(withTitle: "File", action: nil, keyEquivalent: "")
        let fileMenu = NSMenu(title: "File")
        mainMenu.setSubmenu(fileMenu, for: fileItem)
        fileMenu.addItem(withTitle: "Import Quizlet Text...", action: #selector(importQuizlet), keyEquivalent: "")
        fileMenu.addItem(withTitle: "Import Sets...", action: #selector(importSets), keyEquivalent: "")
        fileMenu.addItem(withTitle: "Export Sets...", action: #selector(exportSets), keyEquivalent: "")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Restore Backup...", action: #selector(importBackup), keyEquivalent: "o")
        fileMenu.addItem(withTitle: "Create Backup...", action: #selector(exportBackup), keyEquivalent: "s")

        let editItem = mainMenu.addItem(withTitle: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        mainMenu.setSubmenu(editMenu, for: editItem)
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let viewItem = mainMenu.addItem(withTitle: "View", action: nil, keyEquivalent: "")
        let viewMenu = NSMenu(title: "View")
        mainMenu.setSubmenu(viewMenu, for: viewItem)
        viewMenu.addItem(withTitle: "Home", action: #selector(goHome), keyEquivalent: "1")
        viewMenu.addItem(.separator())
        viewMenu.addItem(
            withTitle: "Enter Full Screen",
            action: #selector(NSWindow.toggleFullScreen(_:)),
            keyEquivalent: "f"
        ).keyEquivalentModifierMask = [.command, .control]

        let windowItem = mainMenu.addItem(withTitle: "Window", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "Window")
        mainMenu.setSubmenu(windowMenu, for: windowItem)
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        NSApplication.shared.windowsMenu = windowMenu
    }
}
