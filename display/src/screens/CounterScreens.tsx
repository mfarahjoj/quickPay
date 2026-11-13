/** The customer-facing screens once the tablet is paired (plan 7.2). */
import type { ReactNode } from "react";
import { QrTicket } from "./QrTicket";
import { formatAmount, formatCountdown, translate, type StringKey } from "../i18n";
import type { Screen } from "../state/viewModel";
import type { Lang } from "../types";

interface Props {
  view: Exclude<Screen, { screen: "unlinked" }>;
  lang: Lang;
  scannerOn: boolean;
  cameraOn: boolean;
  camera?: ReactNode;
}

export function CounterScreen({ view, lang, scannerOn, cameraOn, camera }: Props) {
  const t = (k: StringKey, p?: Record<string, string | number>) => translate(lang, k, p);

  switch (view.screen) {
    case "loading":
      return (
        <main className="screen center">
          <p className="muted">{t("loading")}</p>
        </main>
      );

    case "unavailable":
      return (
        <main className="screen center">
          <div className="badge badge-muted" aria-hidden>
            !
          </div>
          <h1>{t("unavailable")}</h1>
        </main>
      );

    case "flash": {
      const f = view.flash;
      if (f.kind === "paid") {
        return (
          <main className="screen center flash-paid">
            <div className="badge badge-paid" aria-hidden>
              ✓
            </div>
            <h1 className="flash-title">{t("flash.paid")}</h1>
            <p className="amount" dir="ltr">
              {formatAmount(f.amountCents)}
            </p>
            {f.receiptNumber && (
              <p className="muted" dir="ltr">
                {t("flash.receipt", { number: f.receiptNumber })}
              </p>
            )}
            <p className="lead">{t("flash.thanks")}</p>
          </main>
        );
      }
      return (
        <main className="screen center">
          <div className="badge badge-muted" aria-hidden>
            ✕
          </div>
          <h1>{t(f.kind === "declined" ? "flash.declined" : "flash.expired")}</h1>
          <p className="muted">{t("flash.askCashier")}</p>
        </main>
      );
    }

    case "approving":
      return (
        <main className="screen center">
          <div className="phone-pulse" aria-hidden />
          <h1>{t("approving.title", { name: view.request.customerFirstName, amount: formatAmount(view.request.amountCents) })}</h1>
          <p className="lead">{t("approving.hint")}</p>
          <p className="countdown">{t("countdown", { time: formatCountdown(view.secondsLeft) })}</p>
        </main>
      );

    case "sale":
      return (
        <main className="screen split">
          <section className="split-qr">
            <QrTicket value={view.sale.qrData} label={t("sale.payTo", { shop: view.merchantName })} />
          </section>
          <section className="split-info">
            <p className="payto">{t("sale.payTo", { shop: view.merchantName })}</p>
            <p className="amount" dir="ltr">
              {formatAmount(view.sale.amountCents)}
            </p>
            {view.sale.reference && (
              <p className="reference">
                <span className="label">{t("sale.reference")}</span> {view.sale.reference}
              </p>
            )}
            <p className="lead">{t("sale.hint")}</p>
            {scannerOn && <p className="muted">{t("sale.scannerHint")}</p>}
            {cameraOn && (
              <div className="camera">
                {camera}
                <p className="muted">{t("sale.cameraHint")}</p>
              </div>
            )}
            <p className="countdown">{t("countdown", { time: formatCountdown(view.secondsLeft) })}</p>
          </section>
        </main>
      );

    case "idle":
      return (
        <main className="screen split">
          <section className="split-qr">
            <QrTicket value={view.idleQr} label={t("sale.payTo", { shop: view.merchantName })} />
          </section>
          <section className="split-info">
            <h1>{t("sale.payTo", { shop: view.merchantName })}</h1>
            <p className="lead">{t("idle.hint")}</p>
          </section>
        </main>
      );
  }
}
