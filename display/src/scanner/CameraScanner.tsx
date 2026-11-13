/**
 * The tablet's front camera as a backup scanner. Runs only while mounted (the
 * Sale screen mounts it), and frames never leave the tablet.
 */
import { useEffect, useRef } from "react";
import QrScanner from "qr-scanner";

export function CameraScanner({ onText }: { onText: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onText);
  handler.current = onText;

  useEffect(() => {
    if (!video.current) return;
    const scanner = new QrScanner(video.current, (result) => handler.current(result.data), {
      preferredCamera: "user",
      maxScansPerSecond: 5,
      returnDetailedScanResult: true,
    });
    scanner.start().catch((err) => console.warn("camera:", err));
    return () => {
      scanner.stop();
      scanner.destroy();
    };
  }, []);

  return <video ref={video} className="camera-tile" muted playsInline />;
}
