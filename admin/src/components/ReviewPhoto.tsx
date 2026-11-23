import { useEffect, useState } from "react";

/**
 * A photo from an application. iPhones save HEIC, which Chrome cannot show, so
 * those are converted to JPEG here in the browser. Clicking opens it full size.
 */
export function ReviewPhoto({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    (async () => {
      try {
        let blob = await (await fetch(url)).blob();
        if (/hei[cf]/i.test(blob.type) || (await sniffHeic(blob))) {
          const { default: heic2any } = await import("heic2any");
          const out = await heic2any({ blob, toType: "image/jpeg", quality: 0.85 });
          blob = Array.isArray(out) ? out[0] : out;
        }
        const objectUrl = URL.createObjectURL(blob);
        revoked = objectUrl;
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [url]);

  if (failed) return <div className="photo-missing">Could not show this photo</div>;
  if (!src) return <div className="photo-missing">Loading…</div>;
  return (
    <a href={src} target="_blank" rel="noreferrer noopener">
      <img src={src} alt={alt} />
    </a>
  );
}

/** HEIC files say "ftypheic" (or similar) at byte 4, whatever the stored type. */
async function sniffHeic(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const brand = String.fromCharCode(...head.slice(4, 12));
  return /^ftyp(heic|heix|hevc|mif1|msf1)/.test(brand);
}
