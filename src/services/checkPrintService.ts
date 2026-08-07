import type { Check, CheckSettings, CompanyBank, CompanyInfo } from '../types/models';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALE = ['', ' Thousand', ' Million', ' Billion'];

const belowThousand = (n: number): string => {
  let out = '';
  if (n >= 100) {
    out += `${ONES[Math.floor(n / 100)]} Hundred`;
    n %= 100;
    if (n) out += ' ';
  }
  if (n >= 20) {
    out += TENS[Math.floor(n / 10)];
    if (n % 10) out += `-${ONES[n % 10]}`;
  } else if (n > 0) {
    out += ONES[n];
  }
  return out;
};

/** Convierte un monto USD a letras: 1250.5 -> "One Thousand Two Hundred Fifty and 50/100 Dollars" */
export function amountInWords(amount: number): string {
  const dollars = Math.floor(Math.abs(amount));
  const cents = Math.round((Math.abs(amount) - dollars) * 100);
  if (dollars === 0) return `Zero and ${String(cents).padStart(2, '0')}/100 Dollars`;
  const parts: string[] = [];
  let rest = dollars;
  let scale = 0;
  while (rest > 0) {
    const chunk = rest % 1000;
    if (chunk > 0) parts.unshift(belowThousand(chunk) + SCALE[scale]);
    rest = Math.floor(rest / 1000);
    scale += 1;
  }
  return `${parts.join(' ')} and ${String(cents).padStart(2, '0')}/100 Dollars`;
}

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtUsd = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtLongDate = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

/** Abre una pestaña con el cheque listo para imprimir (cheque + talon). */
export function printCheck(
  check: Check,
  payeeName: string,
  company: CompanyInfo,
  bank: CompanyBank | null,
  settings: CheckSettings,
): void {
  const showLogo = settings.showLogo !== false && !!company.logo;
  const showAddress = settings.showAddress !== false;
  const showBank = settings.showBankInfo !== false && !!bank;
  const signature = settings.signatureText?.trim() || 'Authorized signature';
  const accountLast4 = bank?.account ? bank.account.slice(-4) : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Check #${check.CHECK_NUMBER}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #14251c; background: #f1f3f2; padding: 24px; }
  .sheet { max-width: 820px; margin: 0 auto; }
  .check { background: linear-gradient(135deg, #ffffff 0%, #f2f7f4 100%); border: 1.5px solid #1f7a4d; border-radius: 8px; padding: 26px 30px; position: relative; }
  .row-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .co { display: flex; gap: 14px; align-items: center; }
  .co img { max-height: 54px; max-width: 130px; object-fit: contain; }
  .co-name { font-size: 15px; font-weight: 700; letter-spacing: 0.02em; }
  .co-sub { font-size: 10.5px; color: #47584f; line-height: 1.45; }
  .num { text-align: right; }
  .num-label { font-size: 9px; letter-spacing: 0.14em; color: #47584f; text-transform: uppercase; }
  .num-value { font-size: 19px; font-weight: 700; color: #1f7a4d; font-family: 'Courier New', monospace; }
  .date-line { text-align: right; margin-top: 12px; font-size: 12px; }
  .date-line b { border-bottom: 1px solid #14251c; padding: 0 14px 2px; }
  .pay-row { display: flex; align-items: flex-end; gap: 14px; margin-top: 22px; }
  .pay-label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em; color: #47584f; width: 92px; line-height: 1.4; }
  .payee { flex: 1; border-bottom: 1.2px solid #14251c; font-size: 15px; font-weight: 600; padding: 0 4px 3px; }
  .amount-box { border: 1.5px solid #14251c; border-radius: 4px; padding: 7px 14px; font-size: 15px; font-weight: 700; font-family: 'Courier New', monospace; background: #ffffff; }
  .words-row { display: flex; align-items: flex-end; gap: 10px; margin-top: 18px; }
  .words { flex: 1; border-bottom: 1.2px solid #14251c; font-size: 12.5px; padding: 0 4px 3px; font-style: italic; }
  .bottom { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 30px; gap: 20px; }
  .memo { flex: 1; font-size: 11px; }
  .memo b { border-bottom: 1px solid #14251c; padding: 0 8px 2px; font-weight: 400; }
  .sig { width: 250px; border-top: 1.2px solid #14251c; text-align: center; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em; color: #47584f; padding-top: 4px; }
  .micr { margin-top: 20px; font-family: 'Courier New', monospace; font-size: 13px; letter-spacing: 0.16em; color: #14251c; }
  .stub { background: #ffffff; border: 1px dashed #9aa8a0; border-radius: 8px; margin-top: 22px; padding: 18px 24px; font-size: 12px; }
  .stub h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #1f7a4d; margin-bottom: 10px; }
  .stub-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 20px; }
  .stub-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #47584f; }
  .stub-value { font-weight: 600; }
  .print-bar { text-align: center; margin: 18px 0; }
  .print-bar button { background: #1f7a4d; color: #ffffff; border: none; padding: 10px 26px; border-radius: 8px; font-size: 14px; cursor: pointer; font-family: inherit; }
  @media print { body { background: #ffffff; padding: 0; } .print-bar { display: none; } .stub { border-style: solid; } }
</style>
</head>
<body>
<div class="sheet">
  <div class="print-bar"><button onclick="window.print()">Print check</button></div>
  <div class="check">
    <div class="row-top">
      <div class="co">
        ${showLogo ? `<img src="${company.logo}" alt="logo" />` : ''}
        <div>
          <div class="co-name">${esc(company.name || 'Company name')}</div>
          ${showAddress ? `<div class="co-sub">${esc(company.address)}<br />${esc(company.cityStateZip)}${company.phone ? ` · ${esc(company.phone)}` : ''}</div>` : ''}
        </div>
      </div>
      <div class="num">
        <div class="num-label">Check No.</div>
        <div class="num-value">${check.CHECK_NUMBER}</div>
        ${showBank ? `<div class="co-sub" style="margin-top:6px">${esc(bank?.bankName ?? '')}${accountLast4 ? ` · ****${esc(accountLast4)}` : ''}</div>` : ''}
      </div>
    </div>

    <div class="date-line">Date <b>${esc(fmtLongDate(check.DATE))}</b></div>

    <div class="pay-row">
      <div class="pay-label">Pay to the order of</div>
      <div class="payee">${esc(payeeName)}</div>
      <div class="amount-box">$ ${fmtUsd(check.AMOUNT)}</div>
    </div>

    <div class="words-row">
      <div class="words">${esc(amountInWords(check.AMOUNT))}</div>
    </div>

    <div class="bottom">
      <div class="memo">Memo <b>${esc(check.MEMO || ' ')}</b></div>
      <div class="sig">${esc(signature)}</div>
    </div>

    ${showBank && bank?.routing ? `<div class="micr">⑆${esc(bank.routing)}⑆ ${esc(bank.account)}⑈ ${check.CHECK_NUMBER}</div>` : ''}
  </div>

  <div class="stub">
    <h3>Check stub — ${esc(company.name || '')}</h3>
    <div class="stub-grid">
      <div><div class="stub-label">Check #</div><div class="stub-value">${check.CHECK_NUMBER}</div></div>
      <div><div class="stub-label">Date</div><div class="stub-value">${esc(fmtLongDate(check.DATE))}</div></div>
      <div><div class="stub-label">Amount</div><div class="stub-value">$ ${fmtUsd(check.AMOUNT)}</div></div>
      <div><div class="stub-label">Payee</div><div class="stub-value">${esc(payeeName)}</div></div>
      <div><div class="stub-label">Ref #</div><div class="stub-value">${esc(check.REF || '—')}</div></div>
      <div><div class="stub-label">Memo</div><div class="stub-value">${esc(check.MEMO || '—')}</div></div>
    </div>
  </div>
</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    alert('Your browser blocked the print window. Allow pop-ups for this site.');
    return;
  }
  win.document.write(html);
  win.document.close();
}
