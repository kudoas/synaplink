import AppKit
import ApplicationServices
import Foundation
import Carbon
let webKit = Bundle(path: "/System/Library/Frameworks/WebKit.framework")
let inputSource = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
let inputSourceId: String
if let pointer = TISGetInputSourceProperty(inputSource, kTISPropertyInputSourceID) {
  inputSourceId = Unmanaged<CFString>.fromOpaque(pointer).takeUnretainedValue() as String
} else {
  inputSourceId = "unavailable"
}
let result: [String: Any] = [
  "inputSourceId": inputSourceId,
  "accessibilityTrusted": AXIsProcessTrusted(),
  "recordedAtUTC": ISO8601DateFormatter().string(from: Date()),
  "operatingSystem": ProcessInfo.processInfo.operatingSystemVersionString,
  "voiceOverEnabled": NSWorkspace.shared.isVoiceOverEnabled,
  "webKitBundleVersion": webKit?.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unavailable",
  "webKitShortVersion": webKit?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unavailable"
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
print(String(decoding: data, as: UTF8.self))
