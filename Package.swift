// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "FlashForge",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "FlashForge", targets: ["FlashForgeApp"]),
        .library(name: "FlashForgeCore", targets: ["FlashForgeCore"])
    ],
    targets: [
        .target(name: "FlashForgeCore"),
        .executableTarget(
            name: "FlashForgeApp",
            dependencies: ["FlashForgeCore"],
            resources: [.process("Resources")],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit")
            ]
        ),
        .testTarget(
            name: "FlashForgeCoreTests",
            dependencies: ["FlashForgeCore"]
        )
    ]
)
