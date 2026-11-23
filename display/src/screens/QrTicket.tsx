import { QRCodeSVG } from "qrcode.react";

/** The white ticket holding a QR: black on white always, ECC M, 4-module quiet zone. */
export function QrTicket({ value, label }: { value: string; label?: string }) {
  return (
    <div className="ticket" role="img" aria-label={label}>
      <QRCodeSVG value={value} level="M" marginSize={4} bgColor="#FFFFFF" fgColor="#000000" className="ticket-qr" />
    </div>
  );
}
