const SOMQR_ACQUIRER_ID = "so.sps.quickpay";

export interface EmvMerchantQR {
  pointOfInitiation: "11" | "12";
  merchantId: string;
  qrCodeId?: string;
  merchantCategoryCode: string;
  currencyCode: string;
  amount?: number;
  countryCode: string;
  merchantName: string;
  merchantCity: string;
}

function tlvEncode(tag: string, value: string): string {
  const len = value.length.toString().padStart(2, "0");
  return `${tag}${len}${value}`;
}

function tlvEncodeNested(tag: string, subtlvs: string): string {
  return tlvEncode(tag, subtlvs);
}

function crc16ccitt(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function generateEmvQRPayload(params: EmvMerchantQR): string {
  let payload = "";

  payload += tlvEncode("00", "01");
  payload += tlvEncode("01", params.pointOfInitiation);

  let merchantSubTlvs = tlvEncode("00", SOMQR_ACQUIRER_ID);
  merchantSubTlvs += tlvEncode("01", params.merchantId);
  if (params.qrCodeId) {
    merchantSubTlvs += tlvEncode("02", params.qrCodeId);
  }
  payload += tlvEncodeNested("26", merchantSubTlvs);

  payload += tlvEncode("52", params.merchantCategoryCode);
  payload += tlvEncode("53", params.currencyCode);

  if (params.amount !== undefined) {
    payload += tlvEncode("54", params.amount.toFixed(2));
  }

  payload += tlvEncode("58", params.countryCode);
  payload += tlvEncode("59", params.merchantName);
  payload += tlvEncode("60", params.merchantCity);

  payload += "6304";
  const checksum = crc16ccitt(payload);
  payload += checksum;

  return payload;
}

export function parseEmvQRPayload(payload: string): EmvMerchantQR | null {
  try {
    const fields = parseTlv(payload);
    if (!fields["00"] || fields["00"] !== "01") return null;

    const crcField = fields["63"];
    if (!crcField) return null;

    const crcIndex = payload.lastIndexOf("6304");
    if (crcIndex === -1) return null;
    const dataForCrc = payload.substring(0, crcIndex + 4);
    const expectedCrc = crc16ccitt(dataForCrc);
    if (expectedCrc !== crcField) return null;

    const merchantAccountRaw = fields["26"];
    if (!merchantAccountRaw) return null;
    const subFields = parseTlv(merchantAccountRaw);

    const pointOfInitiation = fields["01"] as "11" | "12";
    if (pointOfInitiation !== "11" && pointOfInitiation !== "12") return null;

    return {
      pointOfInitiation,
      merchantId: subFields["01"] || "",
      qrCodeId: subFields["02"],
      merchantCategoryCode: fields["52"] || "",
      currencyCode: fields["53"] || "",
      amount: fields["54"] ? parseFloat(fields["54"]) : undefined,
      countryCode: fields["58"] || "",
      merchantName: fields["59"] || "",
      merchantCity: fields["60"] || "",
    };
  } catch {
    return null;
  }
}

function parseTlv(data: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let pos = 0;
  while (pos + 4 <= data.length) {
    const tag = data.substring(pos, pos + 2);
    const len = parseInt(data.substring(pos + 2, pos + 4), 10);
    if (isNaN(len) || pos + 4 + len > data.length) break;
    fields[tag] = data.substring(pos + 4, pos + 4 + len);
    pos += 4 + len;
  }
  return fields;
}
