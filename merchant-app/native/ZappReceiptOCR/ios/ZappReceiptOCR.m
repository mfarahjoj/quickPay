#import "ZappReceiptOCR.h"

#import <ImageIO/ImageIO.h>
#import <UIKit/UIKit.h>
#import <Vision/Vision.h>

// Vision takes the EXIF orientation, UIImage reports its own enum, and the two
// are numbered differently. A camera photo is stored sideways with an
// orientation flag, so passing the wrong one reads the receipt rotated and
// finds nothing.
static CGImagePropertyOrientation ZappCGOrientation(UIImageOrientation orientation) {
  switch (orientation) {
    case UIImageOrientationUp: return kCGImagePropertyOrientationUp;
    case UIImageOrientationDown: return kCGImagePropertyOrientationDown;
    case UIImageOrientationLeft: return kCGImagePropertyOrientationLeft;
    case UIImageOrientationRight: return kCGImagePropertyOrientationRight;
    case UIImageOrientationUpMirrored: return kCGImagePropertyOrientationUpMirrored;
    case UIImageOrientationDownMirrored: return kCGImagePropertyOrientationDownMirrored;
    case UIImageOrientationLeftMirrored: return kCGImagePropertyOrientationLeftMirrored;
    case UIImageOrientationRightMirrored: return kCGImagePropertyOrientationRightMirrored;
  }
  return kCGImagePropertyOrientationUp;
}

@implementation ZappReceiptOCR

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

/// Resolves with one entry per recognised line: { text, frame: { left, top,
/// width, height }, corners: { topLeft, topRight, bottomLeft, bottomRight } },
/// in pixels of the upright image with the origin at the top left. `corners`
/// follow the line as printed, so a receipt photographed at an angle can be
/// straightened by the caller. The photo never leaves the device.
RCT_EXPORT_METHOD(recognize:(nonnull NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSString *filePath = path;
    if ([path hasPrefix:@"file://"]) {
      NSURL *url = [NSURL URLWithString:path];
      filePath = url.path ?: [path substringFromIndex:7];
    }

    UIImage *image = [UIImage imageWithContentsOfFile:filePath];
    CGImageRef cgImage = image.CGImage;
    if (cgImage == NULL) {
      reject(@"receipt_ocr_image", @"Could not load the photo", nil);
      return;
    }

    CGImagePropertyOrientation orientation = ZappCGOrientation(image.imageOrientation);
    BOOL sideways = orientation == kCGImagePropertyOrientationLeft ||
                    orientation == kCGImagePropertyOrientationRight ||
                    orientation == kCGImagePropertyOrientationLeftMirrored ||
                    orientation == kCGImagePropertyOrientationRightMirrored;
    CGFloat rawWidth = (CGFloat)CGImageGetWidth(cgImage);
    CGFloat rawHeight = (CGFloat)CGImageGetHeight(cgImage);
    CGFloat width = sideways ? rawHeight : rawWidth;
    CGFloat height = sideways ? rawWidth : rawHeight;

    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    // Language correction "fixes" invoice numbers and totals into words.
    request.usesLanguageCorrection = NO;

    VNImageRequestHandler *handler =
        [[VNImageRequestHandler alloc] initWithCGImage:cgImage orientation:orientation options:@{}];

    NSError *error = nil;
    if (![handler performRequests:@[request] error:&error] || error != nil) {
      reject(@"receipt_ocr_failed", @"Text recognition failed", error);
      return;
    }

    NSMutableArray<NSDictionary *> *lines = [NSMutableArray array];
    for (VNRecognizedTextObservation *observation in request.results) {
      VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
      if (candidate == nil || candidate.string.length == 0) {
        continue;
      }
      // Vision's geometry is normalised with the origin at the bottom left.
      CGRect box = observation.boundingBox;
      NSDictionary * (^point)(CGPoint) = ^NSDictionary *(CGPoint p) {
        return @{ @"x": @(p.x * width), @"y": @((1.0 - p.y) * height) };
      };
      [lines addObject:@{
        @"text": candidate.string,
        @"corners": @{
          @"topLeft": point(observation.topLeft),
          @"topRight": point(observation.topRight),
          @"bottomLeft": point(observation.bottomLeft),
          @"bottomRight": point(observation.bottomRight),
        },
        @"frame": @{
          @"left": @(box.origin.x * width),
          @"top": @((1.0 - box.origin.y - box.size.height) * height),
          @"width": @(box.size.width * width),
          @"height": @(box.size.height * height),
        },
      }];
    }

    resolve(lines);
  });
}

@end
