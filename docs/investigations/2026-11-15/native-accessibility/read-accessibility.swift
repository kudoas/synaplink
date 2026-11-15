import AppKit
import ApplicationServices
import Foundation

// Reads only the explicitly identified test application; no AX actions or setters.
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
let arguments = CommandLine.arguments
if arguments.count != 3 { fail("Usage: read-accessibility.swift <pid> <expected-test-bundle-id>") }
guard let pid = Int32(arguments[1]), pid > 0 else { fail("Invalid PID") }
let expectedBundle = arguments[2]
guard expectedBundle.hasPrefix("com.kudoas.synaplink."),
      expectedBundle != "com.kudoas.synaplink" else { fail("Only a separate Synaplink test bundle is allowed") }
guard let running = NSRunningApplication(processIdentifier: pid),
      running.bundleIdentifier == expectedBundle else { fail("PID and test bundle identifier do not match") }
guard AXIsProcessTrusted() else { fail("This reader has no Accessibility permission; no prompt was requested") }

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var result: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success else { return nil }
    return result
}
var nodeCount = 0
var truncated = false
func readableAttributes(_ element: AXUIElement) -> [String: Any] {
    var result: [String: Any] = [:]
    for key in ["AXRole", "AXRoleDescription", "AXSubrole", "AXTitle", "AXDescription", "AXHelp", "AXEnabled", "AXFocused", "AXValue", "AXSelectedText"] {
        if let value = attribute(element, key) {
            let text = String(describing: value)
            result[key] = String(text.prefix(2048))
            if text.count > 2048 { truncated = true }
        }
    }
    if let rawRange = attribute(element, "AXSelectedTextRange"), CFGetTypeID(rawRange) == AXValueGetTypeID() {
        let value = rawRange as! AXValue
        var range = CFRange()
        if AXValueGetType(value) == .cfRange && AXValueGetValue(value, .cfRange, &range) {
            result["AXSelectedTextRange"] = ["length": range.length, "location": range.location]
        }
    }
    return result
}
func snapshot(_ element: AXUIElement, depth: Int) -> [String: Any] {
    nodeCount += 1
    var result = readableAttributes(element)
    if let children = attribute(element, "AXChildren") as? [AXUIElement], !children.isEmpty {
        if depth >= 12 || nodeCount >= 500 {
            truncated = true
        } else {
            var records: [[String: Any]] = []
            for child in children {
                if nodeCount >= 500 { truncated = true; break }
                records.append(snapshot(child, depth: depth + 1))
            }
            result["children"] = records
        }
    }
    return result
}
let application = AXUIElementCreateApplication(pid)
let tree = snapshot(application, depth: 0)
var focusedSnapshot: [String: Any]?
if let focused = attribute(application, "AXFocusedUIElement"), CFGetTypeID(focused) == AXUIElementGetTypeID() {
    focusedSnapshot = readableAttributes(focused as! AXUIElement)
}
var result: [String: Any] = [
    "bundleIdentifier": expectedBundle,
    "nodeCount": nodeCount,
    "pid": pid,
    "recordedAtUTC": ISO8601DateFormatter().string(from: Date()),
    "tree": tree,
    "truncated": truncated,
    "voiceOverEnabled": NSWorkspace.shared.isVoiceOverEnabled
]
if let focusedSnapshot { result["focusedElement"] = focusedSnapshot }
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
print(String(decoding: data, as: UTF8.self))
