export type TorItem = {
  particulars: string; // title + author + year, same as a PR line's description
  oum: string; // unit of measure (e.g. "copies")
  quantity: number;
};

export type TorData = {
  projectTitle: string;
  abc: number; // Approved Budget for the Contract
  sourceOfFund: string;
  proponent: string;
  preparedByName: string;
  preparedByTitle: string;
  deliveryDays: string;
  items: TorItem[];
};

/** Generates a Terms of Reference .docx matching PSU Library Services'
 *  real template (see the sample TOR this was built from: title page with
 *  RA 9184/GPPB legal basis, a numbered item list, then Delivery/Payment
 *  Terms/Warranty). Reuses the `docx` package the same way
 *  programBibliographyDocx does -- no new dependency. */
export async function generateTorDocx(data: TorData): Promise<Buffer> {
  const {
    Document, Packer, Paragraph, Table, TableCell, TableRow,
    HeadingLevel, WidthType, TextRun, AlignmentType,
  } = await import("docx");

  const COL_DXA = [700, 6300, 1200, 800]; // NO, PARTICULARS, OUM, QUANTITY
  const TOTAL_DXA = COL_DXA.reduce((a, c) => a + c, 0);

  const headerCell = (text: string, widthDxa: number) => new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
  });
  const bodyCell = (text: string, widthDxa: number, alignRight = false) => new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    children: [new Paragraph({ alignment: alignRight ? AlignmentType.RIGHT : undefined, children: [new TextRun({ text })] })],
  });

  const itemRows = data.items.map((item, i) => new TableRow({
    children: [
      bodyCell(String(i + 1), COL_DXA[0], true),
      bodyCell(item.particulars, COL_DXA[1]),
      bodyCell(item.oum, COL_DXA[2]),
      bodyCell(String(item.quantity), COL_DXA[3], true),
    ],
  }));

  const children: import("docx").FileChild[] = [];

  children.push(new Paragraph({ text: "Republic of the Philippines", alignment: AlignmentType.CENTER }));
  children.push(new Paragraph({ text: "PALAWAN STATE UNIVERSITY", heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }));
  children.push(new Paragraph({ text: "Puerto Princesa City", alignment: AlignmentType.CENTER }));
  children.push(new Paragraph({ text: "" }));
  children.push(new Paragraph({ text: "TERMS OF REFERENCE (TOR)", heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }));
  children.push(new Paragraph({ text: "For the Project", alignment: AlignmentType.CENTER }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: data.projectTitle.toUpperCase(), bold: true })],
  }));
  children.push(new Paragraph({ text: "" }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "ABC: ", bold: true }), new TextRun({ text: `PhP ${data.abc.toLocaleString("en-PH", { minimumFractionDigits: 2 })}` })],
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Source of Fund: ", bold: true }), new TextRun({ text: data.sourceOfFund || "—" })],
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Proponent: ", bold: true }), new TextRun({ text: data.proponent || "—" })],
  }));
  children.push(new Paragraph({ text: "" }));

  children.push(new Paragraph({ text: "I. INTRODUCTION", heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({ text: "1. Background and Overview", heading: HeadingLevel.HEADING_2 }));
  children.push(new Paragraph({
    text: "Every year, the library usually requested books for different programs and submitted approved PRs to the Supply Office.",
  }));
  children.push(new Paragraph({ text: "" }));
  children.push(new Paragraph({
    text: "As per issuance of GPPB Resolution 24-2014, Section 8.2.3(b) of the IRR of RA 9184 mandates that procuring entities "
      + "shall procure common-use goods, supplies, materials, and equipment from the Philippine Government Electronic Procurement "
      + "System's (PhilGEPS) Electronic Catalogue.",
  }));
  children.push(new Paragraph({ text: "" }));
  children.push(new Paragraph({
    text: "Section 4 of Administrative Order (AO) No. 17 likewise requires the procurement of common-use supplies directly from "
      + "the Procurement Service (PS) or its depots without need of public bidding as provided in Section 53.5 of the IRR of RA 9184.",
  }));
  children.push(new Paragraph({ text: "" }));
  children.push(new Paragraph({
    text: "However, those supplies, materials and equipment not available at DBM-PS must be procured through public bidding, as "
      + "per Section 10 of RA 9184 and its IRR: “All procurement shall be done through competitive bidding, except as provided "
      + "in Rule XVI of this IRR.” Thus, the BAC directed the Supply Office to consolidate the approved PRs subject for "
      + "commencement of bidding and issuance of BAC Resolution.",
  }));
  children.push(new Paragraph({ text: "" }));

  children.push(new Paragraph({ text: "II. LIST OF SUPPLIES AND MATERIALS", heading: HeadingLevel.HEADING_1 }));
  children.push(new Table({
    width: { size: TOTAL_DXA, type: WidthType.DXA },
    columnWidths: COL_DXA,
    rows: [
      new TableRow({ tableHeader: true, children: [headerCell("NO.", COL_DXA[0]), headerCell("PARTICULARS", COL_DXA[1]), headerCell("OUM", COL_DXA[2]), headerCell("QUANTITY", COL_DXA[3])] }),
      ...itemRows,
    ],
  }));
  children.push(new Paragraph({ text: "" }));

  children.push(new Paragraph({ text: "III. DELIVERY", heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({
    text: `The purchased items shall be delivered within ${data.deliveryDays || "60"} calendar days upon receipt of Purchase Order (P.O.) in case of goods.`,
  }));
  children.push(new Paragraph({ text: "" }));

  children.push(new Paragraph({ text: "IV. PAYMENT TERMS", heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({
    text: `For the ${data.projectTitle}, payment will be made in full after the final acceptance of the project.`,
  }));
  children.push(new Paragraph({ text: "" }));

  children.push(new Paragraph({ text: "V. WARRANTY", heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({
    text: "In case of semi-expendable supplies and equipment, a three (3) month warranty shall be provided by the winning bidder.",
  }));
  children.push(new Paragraph({ text: "" }));
  children.push(new Paragraph({ text: "" }));

  children.push(new Paragraph({ children: [new TextRun({ text: "Prepared by:" })] }));
  children.push(new Paragraph({ text: "" }));
  children.push(new Paragraph({ children: [new TextRun({ text: data.preparedByName.toUpperCase(), bold: true })] }));
  children.push(new Paragraph({ text: data.preparedByTitle }));

  const doc = new Document({ sections: [{ children }] });
  return await Packer.toBuffer(doc);
}
