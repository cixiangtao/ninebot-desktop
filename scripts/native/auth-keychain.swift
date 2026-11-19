// Read-only, exact login-Keychain lookup. Never write secrets to stdout/stderr.
import Darwin
import Foundation
import Security

enum Failure: Int32, Error {
    case notFound = 20, ambiguous, cancelled, denied, unavailable, invalidInput, invalidResponse
}

struct Selector {
    let attributes: [String: Any]
    init(_ value: Any) throws {
        guard let object = value as? [String: Any],
              object["store"] as? String == "login",
              let kind = object["kind"] as? String,
              let account = object["account"] as? String,
              !account.isEmpty, account == account.trimmingCharacters(in: .whitespacesAndNewlines),
              account.utf8.count <= 1024,
              !account.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
        else { throw Failure.invalidInput }
        var attrs: [String: Any] = [kSecAttrAccount as String: account]
        var allowed: Set<String> = ["store", "kind", "account", "areaCode"]
        if let area = object["areaCode"] {
            guard let text = area as? String,
                  text.range(of: #"^\+?[0-9]{1,4}$"#, options: .regularExpression) != nil
            else { throw Failure.invalidInput }
        }
        switch kind {
        case "generic":
            allowed.insert("service")
            guard object["service"] as? String == "ninebot.com" else { throw Failure.invalidInput }
            attrs[kSecClass as String] = kSecClassGenericPassword
            attrs[kSecAttrService as String] = "ninebot.com"
        case "internet":
            allowed.formUnion(["server", "protocol", "path", "port"])
            guard object["server"] as? String == "ninebot.com",
                  let scheme = object["protocol"] as? String, ["https", "http"].contains(scheme)
            else { throw Failure.invalidInput }
            attrs[kSecClass as String] = kSecClassInternetPassword
            attrs[kSecAttrServer as String] = "ninebot.com"
            attrs[kSecAttrProtocol as String] = scheme == "https" ? kSecAttrProtocolHTTPS : kSecAttrProtocolHTTP
            if let path = object["path"] {
                guard let text = path as? String, text.utf8.count <= 2048,
                      (text.isEmpty || text.hasPrefix("/")),
                      !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
                else { throw Failure.invalidInput }
                attrs[kSecAttrPath as String] = text
            }
            if let port = object["port"] {
                guard let number = port as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                      number.doubleValue == Double(number.intValue), (0...65535).contains(number.intValue)
                else { throw Failure.invalidInput }
                attrs[kSecAttrPort as String] = number
            }
        default: throw Failure.invalidInput
        }
        guard Set(object.keys).isSubset(of: allowed) else { throw Failure.invalidInput }
        attributes = attrs
    }

    func matches(_ result: [String: Any]) -> Bool {
        attributes.allSatisfy { key, value in
            // Some file-based results omit the class. The query and persistent reference bind it.
            if key == kSecClass as String { return true }
            guard let actual = result[key] else { return false }
            return (actual as AnyObject).isEqual(value)
        }
    }
}

func checkStatus(_ status: OSStatus) throws {
    switch status {
    case errSecSuccess: return
    case errSecItemNotFound: throw Failure.notFound
    case errSecUserCanceled: throw Failure.cancelled
    case errSecAuthFailed, errSecInteractionNotAllowed, errSecInteractionRequired: throw Failure.denied
    default: throw Failure.unavailable
    }
}

func retrieve(_ selector: Selector, base: [String: Any], copy: ([String: Any]) throws -> Any) throws -> String {
    var query = base.merging(selector.attributes) { _, new in new }
    query[kSecMatchLimit as String] = kSecMatchLimitAll
    query[kSecReturnAttributes as String] = true
    query[kSecReturnPersistentRef as String] = true
    let metadata = try copy(query)
    guard let matches = metadata as? [[String: Any]] else { throw Failure.invalidResponse }
    guard !matches.isEmpty else { throw Failure.notFound }
    guard matches.count == 1 else { throw Failure.ambiguous }
    guard let match = matches.first, selector.matches(match),
          let reference = match[kSecValuePersistentRef as String] as? Data
    else { throw Failure.invalidResponse }
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    query[kSecReturnPersistentRef as String] = nil
    query[kSecMatchItemList as String] = [reference]
    query[kSecReturnData as String] = true
    guard let item = try copy(query) as? [String: Any], selector.matches(item),
          let data = item[kSecValueData as String] as? Data,
          let password = String(data: data, encoding: .utf8), !password.isEmpty
    else { throw Failure.invalidResponse }
    return password
}

#if KEYCHAIN_HELPER_TESTING
// This binary has no Keychain calls. Fixtures also assert metadata precedes secret access.
func passwordFor(_ selector: Selector) throws -> String {
    let fixture = selector.attributes[kSecAttrAccount as String] as! String
    var calls = 0
    return try retrieve(selector, base: [:]) { query in
        calls += 1
        if calls == 1 {
            guard query[kSecReturnData as String] == nil else { throw Failure.invalidResponse }
            switch fixture {
            case "missing": throw Failure.notFound
            case "cancelled": throw Failure.cancelled
            case "denied": throw Failure.denied
            default: break
            }
            var item = selector.attributes
            item[kSecValuePersistentRef as String] = Data([1, 2, 3])
            if fixture == "mismatch" { item[kSecAttrAccount as String] = "different" }
            return fixture == "duplicate" ? [item, item] : [item]
        }
        guard calls == 2, query[kSecMatchItemList as String] as? [Data] == [Data([1, 2, 3])],
              query[kSecReturnData as String] as? Bool == true else { throw Failure.invalidResponse }
        var item = selector.attributes
        if fixture == "changed" { item[kSecAttrAccount as String] = "different" }
        item[kSecValueData as String] = fixture == "invalid-utf8" ? Data([0xff]) : Data("fake-password-only".utf8)
        return item
    }
}
#else
func passwordFor(_ selector: Selector) throws -> String {
    var keychain: SecKeychain?
    let location = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Keychains/login.keychain-db").path
    try checkStatus(SecKeychainOpen(location, &keychain))
    guard let keychain else { throw Failure.unavailable }
    let base: [String: Any] = [
        kSecMatchSearchList as String: [keychain],
        kSecUseDataProtectionKeychain as String: false,
        kSecMatchCaseInsensitive as String: false,
    ]
    return try retrieve(selector, base: base) { query in
        var result: CFTypeRef?
        try checkStatus(SecItemCopyMatching(query as CFDictionary, &result))
        guard let result else { throw Failure.invalidResponse }
        return result
    }
}
#endif

func main() throws {
    var info = stat()
    guard fstat(3, &info) == 0,
          [mode_t(S_IFIFO), mode_t(S_IFSOCK)].contains(info.st_mode & mode_t(S_IFMT))
    else { throw Failure.invalidInput }
    var input = Data()
    while let chunk = try FileHandle.standardInput.read(upToCount: 16_385 - input.count), !chunk.isEmpty {
        input.append(chunk)
        guard input.count <= 16_384 else { throw Failure.invalidInput }
    }
    let selector = try Selector(JSONSerialization.jsonObject(with: input))
    let password = try passwordFor(selector)
    let response = try JSONSerialization.data(withJSONObject: ["password": password])
    guard response.count <= 16_384 else { throw Failure.invalidResponse }
    try FileHandle(fileDescriptor: 3, closeOnDealloc: false).write(contentsOf: response)
}

do { try main() } catch let failure as Failure { exit(failure.rawValue) } catch { exit(Failure.invalidResponse.rawValue) }
