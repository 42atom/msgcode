// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "msgcode-desktopctl",
    platforms: [
        .macOS(.v14)
    ],
    dependencies: [
        // 使用 ArgumentParser 解析命令行参数
        .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.3.0")
    ],
    targets: [
        .executableTarget(
            name: "msgcode-desktopctl",
            dependencies: [
                .product(name: "ArgumentParser", package: "swift-argument-parser")
            ]
        )
    ]
)
