// Read-only LaunchServices query. This script never changes a handler or opens a URL.
import CoreServices
import Foundation

guard CommandLine.arguments.count == 2 else {
    fputs("usage: swift url-handler.swift <scheme>\n", stderr)
    exit(2)
}
let scheme = CommandLine.arguments[1]
if let handler = LSCopyDefaultHandlerForURLScheme(scheme as CFString)?.takeRetainedValue() {
    print("registered:\(handler)")
    exit(1)
}
print("unregistered")
