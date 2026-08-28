import AppKit
import FlashForgeCore
import UniformTypeIdentifiers
import WebKit

final class WebViewController: NSViewController {
    private var webView: WKWebView!
    private var hasFinishedInitialLoad = false
    private var pendingMigrationURL: URL?

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.isElementFullscreenEnabled = true
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: "window.flashForgeNative = { platform: 'macOS', version: '2.0.0' };",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsLinkPreview = false
        webView.allowsMagnification = true
        webView.setValue(false, forKey: "drawsBackground")

        view = webView
        loadApplication()
    }

    func evaluate(_ source: String) {
        guard isViewLoaded else { return }
        webView.evaluateJavaScript(source) { _, error in
            if let error {
                NSLog("FlashForge JavaScript error: %@", error.localizedDescription)
            }
        }
    }

    func presentBackupImporter() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "Choose a FlashForge backup"

        guard let window = view.window else { return }
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            self?.loadBackup(from: url, restoreIfEmpty: false)
        }
    }

    func migrateBackup(from url: URL) {
        pendingMigrationURL = url
        if hasFinishedInitialLoad {
            schedulePendingMigration()
        }
    }

    private func loadApplication() {
        guard let indexURL = Bundle.module.url(forResource: "index", withExtension: "html") else {
            presentLoadError("The bundled interface is missing.")
            return
        }
        webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
    }

    private func presentLoadError(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "FlashForge could not start"
        alert.informativeText = message
        alert.runModal()
    }

    private func offerFirstLaunchRestore() {
        guard !UserDefaults.standard.bool(forKey: "didOfferFirstLaunchRestore") else { return }
        UserDefaults.standard.set(true, forKey: "didOfferFirstLaunchRestore")

        webView.evaluateJavaScript("typeof S !== 'undefined' ? S.folders.length : -1") { [weak self] result, _ in
            guard let self, (result as? NSNumber)?.intValue == 0, let window = self.view.window else { return }

            let alert = NSAlert()
            alert.messageText = "Bring your FlashForge cards with you"
            alert.informativeText = "Restore a FlashForge backup to keep your folders, cards, images, study history, and mastery statistics."
            alert.addButton(withTitle: "Restore Backup")
            alert.addButton(withTitle: "Start Fresh")
            alert.beginSheetModal(for: window) { [weak self] response in
                if response == .alertFirstButtonReturn {
                    self?.presentBackupImporter()
                }
            }
        }
    }

    private func loadBackup(from url: URL, restoreIfEmpty: Bool) {
        do {
            let data = try Data(contentsOf: url, options: .mappedIfSafe)
            _ = try BackupInspector.inspect(data)
            guard let json = String(data: data, encoding: .utf8) else {
                throw BackupInspectionError.invalidJSON
            }
            if restoreIfEmpty {
                runValidatedMigration(json)
            } else {
                webView.callAsyncJavaScript(
                    "_showBackupPreview(JSON.parse(json)); return true;",
                    arguments: ["json": json],
                    in: nil,
                    in: .page
                ) { result in
                    if case .failure(let error) = result {
                        NSLog("FlashForge backup preview error: %@", error.localizedDescription)
                    }
                }
            }
        } catch {
            let alert = NSAlert(error: error)
            if let window = view.window {
                alert.beginSheetModal(for: window)
            }
        }
    }

    private func handleDownload(_ download: WKDownload) {
        download.delegate = self
    }

    private func runValidatedMigration(_ json: String) {
        let body = """
        const data = JSON.parse(json);
        if (S.folders.length !== 0) {
            _showBackupPreview(data);
            return { mode: 'preview', existingFolders: S.folders.length };
        }
        _doFullRestore(data);
        await _saveImages();
        return { mode: 'restored', ..._backupSummary(data) };
        """

        webView.callAsyncJavaScript(
            body,
            arguments: ["json": json],
            in: nil,
            in: .page
        ) { result in
            switch result {
            case .success(let summary):
                NSLog("FlashForge backup migration complete: %@", String(describing: summary))
            case .failure(let error):
                NSLog("FlashForge backup migration error: %@", error.localizedDescription)
            }
        }
    }

    private func schedulePendingMigration() {
        guard pendingMigrationURL != nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            guard let self, let url = self.pendingMigrationURL else { return }
            self.pendingMigrationURL = nil
            self.loadBackup(from: url, restoreIfEmpty: true)
        }
    }
}

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !hasFinishedInitialLoad else { return }
        hasFinishedInitialLoad = true
        if pendingMigrationURL != nil {
            schedulePendingMigration()
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
                self?.offerFirstLaunchRestore()
            }
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        preferences: WKWebpagePreferences,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download, preferences)
            return
        }

        if let url = navigationAction.request.url,
           let scheme = url.scheme?.lowercased(),
           ["http", "https"].contains(scheme) {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel, preferences)
            return
        }

        decisionHandler(.allow, preferences)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        handleDownload(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        handleDownload(download)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        presentLoadError(error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        presentLoadError(error.localizedDescription)
    }
}

extension WebViewController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories

        guard let window = view.window else {
            completionHandler(nil)
            return
        }

        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
}

extension WebViewController: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping @MainActor @Sendable (URL?) -> Void
    ) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true

        guard let window = view.window else {
            completionHandler(nil)
            return
        }

        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.url : nil)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let alert = NSAlert(error: error)
        if let window = view.window {
            alert.beginSheetModal(for: window)
        }
    }
}
