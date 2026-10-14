import AppKit
import SwiftUI

struct ContentView: View {
    @State private var path: [URL] = []
    @State private var items: [Item] = []
    @State private var isScanning = false
    @State private var isChoosing = false

    private var folder: URL? { path.last }
    private var total: Int64 { items.reduce(0) { $0 + $1.size } }

    var body: some View {
        Group {
            if folder == nil {
                ContentUnavailableView {
                    Label("DiskGarden", systemImage: "leaf")
                } description: {
                    Text("Pick a folder to see what's taking up space.")
                } actions: {
                    Button("Choose Folder…") { isChoosing = true }
                        .buttonStyle(.borderedProminent)
                }
            } else if isScanning {
                ProgressView("Measuring \(folder?.lastPathComponent ?? "")…")
            } else {
                list
            }
        }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button("Back", systemImage: "chevron.left") { path.removeLast() }
                    .disabled(path.count < 2)
            }
            ToolbarItem(placement: .primaryAction) {
                Button("Choose Folder…", systemImage: "folder") { isChoosing = true }
            }
        }
        .navigationTitle(folder?.lastPathComponent ?? "DiskGarden")
        .navigationSubtitle(folder == nil || isScanning ? "" : total.formatted(.byteCount(style: .file)))
        .fileImporter(isPresented: $isChoosing, allowedContentTypes: [.folder]) { result in
            if case .success(let url) = result { path = [url] }
        }
        .task(id: folder) {
            guard let folder else { return }
            isScanning = true
            items = await FolderScanner.items(of: folder)
            isScanning = false
        }
    }

    private var list: some View {
        List(items) { item in
            ItemRow(item: item, fraction: total > 0 ? Double(item.size) / Double(total) : 0)
                .contentShape(Rectangle())
                .onTapGesture(count: 2) { if item.isFolder { path.append(item.url) } }
                .contextMenu {
                    Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([item.url]) }
                }
        }
    }
}

/// A name, its size, and a bar showing its share of the folder.
struct ItemRow: View {
    let item: Item
    let fraction: Double

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.isFolder ? "folder.fill" : "doc")
                .foregroundStyle(item.isFolder ? Color.accentColor : .secondary)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.name).lineLimit(1).truncationMode(.middle)
                GeometryReader { geometry in
                    Capsule()
                        .fill(color.gradient)
                        .frame(width: max(2, geometry.size.width * fraction))
                }
                .frame(height: 5)
            }
            Text(item.size.formatted(.byteCount(style: .file)))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 90, alignment: .trailing)
        }
        .padding(.vertical, 3)
    }

    /// A stable color per name, so a folder keeps its color between visits.
    private var color: Color {
        let hash = item.name.unicodeScalars.reduce(UInt32(5381)) { ($0 &* 33) &+ $1.value }
        return Color(hue: Double(hash % 360) / 360, saturation: 0.55, brightness: 0.9)
    }
}
