import { invoiceTotals } from "../lib/finance.js";
export async function documentPdf(record, kind, client) {
  const { default: PDFDocument } = await import("pdfkit");
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
        margin: 48,
        size: "A4",
        info: {
          Title: `${kind === "invoices" ? "Invoice" : "Proposal"} ${record.number || record.title}`,
          Author: "Cosmobit Labs",
        },
      }),
      chunks = [];
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.fillColor("#2359bf").fontSize(22).text("Cosmobit Labs");
    pdf
      .moveDown(0.5)
      .fillColor("#142033")
      .fontSize(18)
      .text(kind === "invoices" ? "INVOICE" : "PROPOSAL");
    pdf
      .fontSize(10)
      .text(record.number || "")
      .text(record.title || "");
    if (client)
      pdf
        .moveDown()
        .text(`For: ${client.name}`)
        .text(client.companyName || "")
        .text(client.email || "");
    pdf.moveDown();
    if (record.issueDate) pdf.text(`Issued: ${record.issueDate}`);
    if (record.dueDate) pdf.text(`Due: ${record.dueDate}`);
    if (record.validUntil) pdf.text(`Valid until: ${record.validUntil}`);
    pdf.text(`Currency: ${record.currency}`);
    if (record.scope)
      pdf
        .moveDown()
        .fontSize(12)
        .text("Scope of work")
        .fontSize(10)
        .text(record.scope);
    if (record.deliverables)
      pdf
        .moveDown()
        .fontSize(12)
        .text("Deliverables")
        .fontSize(10)
        .text(record.deliverables);
    pdf.moveDown().fontSize(12).text("Line items");
    for (const item of record.items || []) {
      const amount = Math.round(item.quantity * item.unitPrice * 100) / 100;
      pdf
        .moveDown(0.5)
        .fontSize(10)
        .text(
          `${item.description}\n${item.quantity} × ${item.unitPrice.toFixed(2)} = ${amount.toFixed(2)} ${record.currency}${item.taxPercent ? ` · tax ${item.taxPercent}%` : ""}`,
        );
    }
    const totals = invoiceTotals(record);
    pdf
      .moveDown()
      .fontSize(11)
      .text(`Subtotal: ${totals.subtotal.toFixed(2)} ${record.currency}`)
      .text(`Tax: ${totals.tax.toFixed(2)} ${record.currency}`)
      .text(`Discount: ${totals.discount.toFixed(2)} ${record.currency}`)
      .fontSize(13)
      .text(`Total: ${totals.total.toFixed(2)} ${record.currency}`);
    if (kind === "invoices")
      pdf
        .fontSize(11)
        .text(`Paid: ${totals.paid.toFixed(2)} ${record.currency}`)
        .text(`Balance: ${totals.balance.toFixed(2)} ${record.currency}`);
    for (const [key, label] of [
      ["paymentTerms", "Payment terms"],
      ["revisionTerms", "Revisions"],
      ["exclusions", "Exclusions"],
      ["maintenancePlan", "Maintenance option"],
    ])
      if (record[key])
        pdf.moveDown().fontSize(12).text(label).fontSize(10).text(record[key]);
    pdf
      .moveDown()
      .fontSize(8)
      .fillColor("#64748b")
      .text(
        "Generated from the current document record. Internal notes and activity history are excluded.",
      );
    pdf.end();
  });
}
