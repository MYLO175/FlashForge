import Foundation
import XCTest
@testable import FlashForgeCore

final class BackupInspectorTests: XCTestCase {
    func testSummarizesAFlashForgeBackup() throws {
        let data = Data(
            """
            {
              "version": 2,
              "folders": [{
                "sets": [{
                  "cards": [
                    {"frontImg": "data:image/jpeg;base64,abc", "backImg": null, "starred": true},
                    {"frontImg": null, "backImg": "data:image/jpeg;base64,def", "starred": false}
                  ]
                }]
              }],
              "stats": {"set-1": {}},
              "cardStats": {"card-1": {}, "card-2": {}}
            }
            """.utf8
        )

        let summary = try BackupInspector.inspect(data)

        XCTAssertEqual(summary.version, 2)
        XCTAssertEqual(summary.folderCount, 1)
        XCTAssertEqual(summary.setCount, 1)
        XCTAssertEqual(summary.cardCount, 2)
        XCTAssertEqual(summary.imageCount, 2)
        XCTAssertEqual(summary.starredCount, 1)
        XCTAssertEqual(summary.setStatsCount, 1)
        XCTAssertEqual(summary.cardStatsCount, 2)
    }

    func testRejectsJSONWithoutFolders() throws {
        let data = Data(#"{"version":2}"#.utf8)

        XCTAssertThrowsError(try BackupInspector.inspect(data)) { error in
            XCTAssertEqual(error as? BackupInspectionError, .missingFolders)
        }
    }

    func testRejectsMalformedJSON() throws {
        let data = Data("not-json".utf8)

        XCTAssertThrowsError(try BackupInspector.inspect(data)) { error in
            XCTAssertEqual(error as? BackupInspectionError, .invalidJSON)
        }
    }
}
