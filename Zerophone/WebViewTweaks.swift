import ObjectiveC
import UIKit
import WebKit

extension WKWebView {
    /// Haalt de balk met pijltjes en "Gereed" boven het toetsenbord weg. WebKit toont die bij
    /// elk invoerveld; geen enkele echte app heeft hem. Werkt door de binnenste view van de
    /// webview (WKContentView) een subklasse te geven zonder `inputAccessoryView`. Dezelfde
    /// aanpak gebruiken Capacitor en Cordova. Lukt het niet (andere iOS-versie), dan blijft
    /// de balk gewoon staan; er gaat niets stuk.
    func zp_hideInputAccessoryBar() {
        guard let content = scrollView.subviews.first(where: {
            String(describing: type(of: $0)).hasPrefix("WKContent")
        }) else { return }
        let base: AnyClass = type(of: content)
        let name = NSStringFromClass(base) + "_ZerophoneNoAccessory"
        if let existing = NSClassFromString(name) {
            _ = object_setClass(content, existing)
            return
        }
        guard let subclass = objc_allocateClassPair(base, name, 0) else { return }
        let getter: @convention(block) (AnyObject) -> UIView? = { _ in nil }
        class_addMethod(subclass,
                        #selector(getter: UIResponder.inputAccessoryView),
                        imp_implementationWithBlock(getter),
                        "@@:")
        objc_registerClassPair(subclass)
        _ = object_setClass(content, subclass)
    }
}
