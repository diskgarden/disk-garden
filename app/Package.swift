// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DiskGarden",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(name: "DiskGarden", path: "Sources/DiskGarden"),
    ]
)
