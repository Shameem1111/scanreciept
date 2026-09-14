import ExpoModulesCore
import Foundation
import CryptoKit

// Apple APIs are confined to this provider bridge. No account credentials leave it.
public final class ReceiptMindICloudModule: Module {
  private let io = DispatchQueue(label: "receiptmind.icloud", qos: .utility)
  private let fm = FileManager.default
  private var container: String { "iCloud." + (Bundle.main.bundleIdentifier ?? "") }
  private func failure() -> NSError { NSError(domain: "ReceiptMindICloud", code: 1) }

  private func account() throws -> String {
    guard let token = fm.ubiquityIdentityToken else { throw failure() }
    let data = try NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: false)
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  private func root() throws -> URL {
    guard fm.ubiquityIdentityToken != nil,
          let url = fm.url(forUbiquityContainerIdentifier: container) else { throw failure() }
    let directory = url.resolvingSymlinksInPath().appendingPathComponent("Documents/Receipts", isDirectory: true)
    guard directory.resolvingSymlinksInPath().path == directory.standardizedFileURL.path else { throw failure() }
    return directory
  }

  private func resolve(_ reference: String) throws -> URL {
    // Strict grammar blocks traversal, foreign containers, and references from another account.
    let prefix = "icloud://\(container)/\(try account())/"
    guard reference.hasPrefix(prefix) else { throw failure() }
    let name = String(reference.dropFirst(prefix.count))
    guard name.range(of: "^[A-Fa-f0-9-]{36}\\.(pdf|jpg|png|heic|webp)$", options: .regularExpression) != nil,
          UUID(uuidString: String(name.prefix(36))) != nil else { throw failure() }
    let directory = try root()
    let url = directory.appendingPathComponent(name)
    // Reject symlinks introduced through Files rather than following them outside our directory.
    guard url.resolvingSymlinksInPath().path == url.standardizedFileURL.path else { throw failure() }
    return url
  }

  private func coordinate(_ url: URL, writing: Bool, deleting: Bool = false, action: @escaping (URL) throws -> Void) throws {
    var coordinationError: NSError?
    var actionError: Error?
    let accessor: (URL) -> Void = { coordinated in
      do { try action(coordinated) } catch { actionError = error }
    }
    let coordinator = NSFileCoordinator(filePresenter: nil)
    if writing {
      coordinator.coordinate(writingItemAt: url, options: deleting ? .forDeleting : [], error: &coordinationError, byAccessor: accessor)
    } else {
      coordinator.coordinate(readingItemAt: url, options: [], error: &coordinationError, byAccessor: accessor)
    }
    if let error = coordinationError { throw error }
    if let error = actionError { throw error }
  }

  public func definition() -> ModuleDefinition {
    Name("ReceiptMindICloud")

    AsyncFunction("status") { () -> String in
      guard self.fm.ubiquityIdentityToken != nil else { return "signed-out" }
      return (try? self.root()) == nil ? "unavailable" : "available"
    }.runOnQueue(io)

    AsyncFunction("prepare") { (ext: String) -> String in
      guard ["pdf", "jpg", "png", "heic", "webp"].contains(ext) else { throw self.failure() }
      _ = try self.root()
      return "icloud://\(self.container)/\(try self.account())/\(UUID().uuidString).\(ext)"
    }.runOnQueue(io)

    AsyncFunction("exists") { (reference: String) -> Bool in
      let url = try self.resolve(reference)
      let values = try url.resourceValues(forKeys: [.isUbiquitousItemKey])
      return values.isUbiquitousItem == true
    }.runOnQueue(io)

    AsyncFunction("save") { (source: String, reference: String) in
      let destination = try self.resolve(reference)
      guard let input = URL(string: source), input.isFileURL else { throw self.failure() }
      let scoped = input.startAccessingSecurityScopedResource()
      defer { if scoped { input.stopAccessingSecurityScopedResource() } }
      try self.fm.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
      try self.coordinate(destination, writing: true) { url in
        _ = try self.resolve(reference) // Recheck account after waiting for coordination.
        // Copy never overwrites an existing original. The journal owns this unique destination.
        try self.fm.copyItem(at: input, to: url)
      }
    }.runOnQueue(io)

    AsyncFunction("read") { (reference: String) -> String in
      let url = try self.resolve(reference)
      try self.fm.startDownloadingUbiquitousItem(at: url)
      let deadline = Date().addingTimeInterval(30)
      while true {
        _ = try self.resolve(reference)
        let values = try url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey, .ubiquitousItemDownloadingErrorKey])
        if values.ubiquitousItemDownloadingError != nil { throw self.failure() }
        if values.ubiquitousItemDownloadingStatus == .current || values.ubiquitousItemDownloadingStatus == .downloaded { break }
        guard Date() < deadline else { throw self.failure() }
        Thread.sleep(forTimeInterval: 0.25)
      }
      let directory = try self.fm.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        .appendingPathComponent("ReceiptMindICloudPreviews", isDirectory: true)
      try self.fm.createDirectory(at: directory, withIntermediateDirectories: true)
      let preview = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(url.pathExtension)
      do {
        try self.coordinate(url, writing: false) { coordinated in
          _ = try self.resolve(reference)
          try self.fm.copyItem(at: coordinated, to: preview)
        }
        return preview.absoluteString
      } catch {
        if self.fm.fileExists(atPath: preview.path) { try self.fm.removeItem(at: preview) }
        throw error
      }
    }.runOnQueue(io)

    AsyncFunction("remove") { (reference: String) in
      let url = try self.resolve(reference)
      try self.coordinate(url, writing: true, deleting: true) { coordinated in
        _ = try self.resolve(reference)
        do { try self.fm.removeItem(at: coordinated) }
        catch let error as NSError where error.domain == NSCocoaErrorDomain &&
          [NSFileNoSuchFileError, NSFileReadNoSuchFileError].contains(error.code) { }
      }
    }.runOnQueue(io)
  }
}
