// Post-capture motion blur (Bible §6.3 "post-capture quality checks";
// PHOTO_PROTOCOLS.md §7; ADR-0023 K2-12): the variance of the Laplacian of a
// small greyscale copy of the photo. A blurred photo has little edge energy,
// so a low variance suggests `RETAKE_MOTION_BLUR`. The photographer still
// decides; the value is recorded with the photo.
// Bible §6 · tier: feature · Layer 2.
import CoreGraphics
import Foundation
import ImageIO

public enum Sharpness {
    /// Below this variance (on the 256-pixel greyscale copy) the photo is flagged as blurred.
    public static let threshold = 40.0
    static let analysisWidth = 256

    /// The variance of the 4-neighbour Laplacian of an 8-bit greyscale image.
    public static func laplacianVariance(gray: [UInt8], width: Int, height: Int) -> Double {
        guard width >= 3, height >= 3, gray.count >= width * height else { return 0 }
        var sum = 0.0
        var sumSquares = 0.0
        var count = 0.0
        for y in 1..<(height - 1) {
            for x in 1..<(width - 1) {
                let i = y * width + x
                let value = Double(gray[i - width]) + Double(gray[i + width]) + Double(gray[i - 1]) + Double(gray[i + 1]) - 4 * Double(gray[i])
                sum += value
                sumSquares += value * value
                count += 1
            }
        }
        let mean = sum / count
        return sumSquares / count - mean * mean
    }

    /// Measures an encoded photo; nil when it cannot be decoded.
    public static func measure(_ encoded: Data) -> Double? {
        guard let source = CGImageSourceCreateWithData(encoded as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: analysisWidth,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let width = image.width
        let height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width,
                space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return drawn ? laplacianVariance(gray: pixels, width: width, height: height) : nil
    }

    /// The post-capture check, as stored in `qualityChecks`.
    public static func check(_ encoded: Data) -> QualityCheckResult? {
        guard let variance = measure(encoded) else { return nil }
        return QualityCheckResult(code: .retakeMotionBlur, passed: variance >= threshold, value: (variance * 100).rounded() / 100)
    }
}
