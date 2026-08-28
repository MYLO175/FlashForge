import Foundation

public struct BackupSummary: Equatable, Sendable {
    public let version: Int?
    public let folderCount: Int
    public let setCount: Int
    public let cardCount: Int
    public let imageCount: Int
    public let starredCount: Int
    public let setStatsCount: Int
    public let cardStatsCount: Int

    public init(
        version: Int?,
        folderCount: Int,
        setCount: Int,
        cardCount: Int,
        imageCount: Int,
        starredCount: Int,
        setStatsCount: Int,
        cardStatsCount: Int
    ) {
        self.version = version
        self.folderCount = folderCount
        self.setCount = setCount
        self.cardCount = cardCount
        self.imageCount = imageCount
        self.starredCount = starredCount
        self.setStatsCount = setStatsCount
        self.cardStatsCount = cardStatsCount
    }
}

public enum BackupInspectionError: LocalizedError, Equatable {
    case invalidJSON
    case missingFolders

    public var errorDescription: String? {
        switch self {
        case .invalidJSON:
            return "The selected file is not valid JSON."
        case .missingFolders:
            return "The selected file is not a FlashForge backup."
        }
    }
}

public enum BackupInspector {
    public static func inspect(_ data: Data) throws -> BackupSummary {
        let root: [String: Any]
        do {
            guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw BackupInspectionError.invalidJSON
            }
            root = value
        } catch let error as BackupInspectionError {
            throw error
        } catch {
            throw BackupInspectionError.invalidJSON
        }

        guard let folders = root["folders"] as? [[String: Any]] else {
            throw BackupInspectionError.missingFolders
        }

        var setCount = 0
        var cardCount = 0
        var imageCount = 0
        var starredCount = 0

        for folder in folders {
            let sets = folder["sets"] as? [[String: Any]] ?? []
            setCount += sets.count

            for set in sets {
                let cards = set["cards"] as? [[String: Any]] ?? []
                cardCount += cards.count

                for card in cards {
                    if nonemptyString(card["frontImg"]) { imageCount += 1 }
                    if nonemptyString(card["backImg"]) { imageCount += 1 }
                    if card["starred"] as? Bool == true { starredCount += 1 }
                }
            }
        }

        return BackupSummary(
            version: root["version"] as? Int,
            folderCount: folders.count,
            setCount: setCount,
            cardCount: cardCount,
            imageCount: imageCount,
            starredCount: starredCount,
            setStatsCount: (root["stats"] as? [String: Any])?.count ?? 0,
            cardStatsCount: (root["cardStats"] as? [String: Any])?.count ?? 0
        )
    }

    private static func nonemptyString(_ value: Any?) -> Bool {
        guard let string = value as? String else { return false }
        return !string.isEmpty
    }
}
