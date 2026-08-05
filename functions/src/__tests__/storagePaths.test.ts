import { parseStorageRef, isKycPathFor } from "../utils/storagePaths";

const BUCKET = "quickpay-485417.appspot.com";

describe("parseStorageRef", () => {
  it("parses a Firebase download URL, decoding the path", () => {
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/` +
      "kyc%2Fabc123%2Ffront_1699.jpg?alt=media&token=8c7e-4b21";
    expect(parseStorageRef(url)).toEqual({
      bucket: BUCKET,
      path: "kyc/abc123/front_1699.jpg",
    });
  });

  it("handles a download URL with no query string", () => {
    const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/kyc%2Fu1%2Fselfie.jpg`;
    expect(parseStorageRef(url)?.path).toBe("kyc/u1/selfie.jpg");
  });

  it("parses a plain GCS URL and drops its query", () => {
    expect(
      parseStorageRef(`https://storage.googleapis.com/${BUCKET}/kyc/u1/back.jpg?x=1`)
    ).toEqual({ bucket: BUCKET, path: "kyc/u1/back.jpg" });
  });

  it("parses a gs:// URI", () => {
    expect(parseStorageRef(`gs://${BUCKET}/kyc/u1/front.jpg`)).toEqual({
      bucket: BUCKET,
      path: "kyc/u1/front.jpg",
    });
  });

  it("accepts a bare object path and trims leading slashes", () => {
    expect(parseStorageRef("kyc/u1/front.jpg")).toEqual({ path: "kyc/u1/front.jpg" });
    expect(parseStorageRef("/kyc/u1/front.jpg")).toEqual({ path: "kyc/u1/front.jpg" });
  });

  it("refuses values it cannot resolve", () => {
    // Falling back to the raw URL would defeat the point of signing.
    expect(parseStorageRef("https://evil.example/kyc/u1/front.jpg")).toBeNull();
    expect(parseStorageRef("data:image/png;base64,AAAA")).toBeNull();
    expect(parseStorageRef("")).toBeNull();
    expect(parseStorageRef("   ")).toBeNull();
    expect(parseStorageRef(undefined)).toBeNull();
    expect(parseStorageRef(null)).toBeNull();
    expect(parseStorageRef(42)).toBeNull();
  });

  it("rejects scheme-prefixed values with no authority", () => {
    // These have no "://" so an earlier version let them through as paths.
    expect(parseStorageRef("data:image/png;base64,AAAA")).toBeNull();
    expect(parseStorageRef("javascript:alert(1)")).toBeNull();
    expect(parseStorageRef("file:/etc/passwd")).toBeNull();
  });

  it("still accepts a path containing a colon after the first slash", () => {
    expect(parseStorageRef("kyc/u1/scan:2.jpg")).toEqual({
      path: "kyc/u1/scan:2.jpg",
    });
  });

  it("returns null on a malformed percent-encoding rather than throwing", () => {
    const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/%E0%A4%A`;
    expect(parseStorageRef(url)).toBeNull();
  });
});

describe("isKycPathFor", () => {
  it("accepts a path in the user's own KYC folder", () => {
    expect(isKycPathFor("kyc/abc123/front.jpg", "abc123")).toBe(true);
  });

  // The path originates from a document the user once influenced, so it must
  // not be usable to sign arbitrary objects in the bucket.
  it("rejects another user's folder", () => {
    expect(isKycPathFor("kyc/victim/front.jpg", "attacker")).toBe(false);
  });

  it("rejects paths outside the KYC area", () => {
    expect(isKycPathFor("profiles/abc123/avatar.jpg", "abc123")).toBe(false);
    expect(isKycPathFor("receipts/tx1/receipt.pdf", "abc123")).toBe(false);
  });

  it("rejects traversal attempts", () => {
    expect(isKycPathFor("kyc/abc123/../../secrets/key.json", "abc123")).toBe(false);
  });
});
