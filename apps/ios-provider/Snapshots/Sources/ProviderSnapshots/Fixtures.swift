// Synthetic pictures for the snapshot tests: no photograph of a person is
// used anywhere. Drawn from design-token colours so the references change only
// when the app's look does.
// tier: test support · Layer 3.
import DesignSystem
import SwiftUI
import UIKit

public enum Fixtures {
    /// A portrait "photo": a dark stage with a lit oval, the shape a face fills in the frame.
    public static func portrait(shifted: Bool = false) -> UIImage {
        let size = CGSize(width: 300, height: 400)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor(DSColor.photoStage).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIColor(DSColor.highlight).setFill()
            let x: CGFloat = shifted ? 90 : 75
            context.cgContext.fillEllipse(in: CGRect(x: x, y: 70, width: 150, height: 210))
            UIColor(DSColor.accent).setFill()
            context.cgContext.fill(CGRect(x: 0, y: 330, width: size.width, height: 70))
        }
    }

    public static func jpeg(_ image: UIImage) -> Data {
        image.jpegData(compressionQuality: 0.9) ?? Data()
    }

    /// A fixed date, so dates in the pictures never change.
    public static let date = Date(timeIntervalSince1970: 1_790_000_000)
}
