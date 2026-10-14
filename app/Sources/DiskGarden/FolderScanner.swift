import Foundation

/// One item of a folder and the space it takes on disk.
struct Item: Identifiable, Sendable {
    let url: URL
    let isFolder: Bool
    let size: Int64

    var id: URL { url }
    var name: String { url.lastPathComponent }
}

/// Measures the items of a folder. Sizes are the space allocated on disk, so sparse and compressed files count
/// what they really use. Symbolic links aren't followed.
enum FolderScanner {
    private static let keys: [URLResourceKey] = [.isDirectoryKey, .isSymbolicLinkKey, .totalFileAllocatedSizeKey]

    static func items(of folder: URL) async -> [Item] {
        let children = (try? FileManager.default.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: keys, options: [])) ?? []
        // Measure the children in parallel: each folder is walked on its own task.
        return await withTaskGroup(of: Item.self) { group in
            for child in children {
                group.addTask { measure(child) }
            }
            var items: [Item] = []
            for await item in group { items.append(item) }
            return items.sorted { $0.size > $1.size }
        }
    }

    private static func measure(_ url: URL) -> Item {
        let values = try? url.resourceValues(forKeys: Set(keys))
        let isFolder = values?.isDirectory == true && values?.isSymbolicLink != true
        guard isFolder else {
            return Item(url: url, isFolder: false, size: Int64(values?.totalFileAllocatedSize ?? 0))
        }
        var total: Int64 = 0
        let walker = FileManager.default.enumerator(at: url, includingPropertiesForKeys: keys, options: [],
                                                    errorHandler: { _, _ in true }) // skip what can't be read
        while let file = walker?.nextObject() as? URL {
            total += Int64((try? file.resourceValues(forKeys: [.totalFileAllocatedSizeKey]))?.totalFileAllocatedSize ?? 0)
        }
        return Item(url: url, isFolder: true, size: total)
    }
}
