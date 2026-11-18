// The official form chrome — the header and footer the college's FM-NBSC-CID-030
// (GRASPS Model) form carries, measured from the model document rather than
// estimated.
//
// The model form is A4 portrait with one-inch margins. Its header is the
// college seal beside a centred address block ("Republic of the Philippines /
// NORTHERN BUKIDNON STATE COLLEGE / Manolo Fortich, 8703 Bukidnon") in Times
// New Roman, the Latin motto under it in Regards Script gold, and a thin rule
// closing the band. Its footer is a thin rule over the Bagong Pilipinas seal,
// the college's Facebook page and its website in Poppins. The form defines no
// first-page or even-page variants, so both bands repeat on every page.
//
// The four artworks come from the model document itself (now in public/): the
// seal prints at 0.67 x 0.87in, the Bagong Pilipinas seal at 0.54in and the
// Facebook and envelope icons at 0.49in and 0.31in — the ImageRun pixel sizes
// below are those print sizes at 96dpi.
//
// The bands are built from real Word constructs (borderless tables, inline
// images, cell borders as the rules) rather than floating text boxes, so they
// survive every editor, stay editable, and Word pushes the body below the
// header on every page the way a growing header should.

type Docx = typeof import('docx')

/** The model form's own section numbers: A4 portrait (11906 x 16838 twips),
 *  one-inch margins, and the header/footer bands 0.49in (708 twips) from the
 *  paper edge. */
export const FORM_PAGE = {
  size: { width: 11906, height: 16838 },
  // The form declares 708 twips for its header band, but its floating
  // artwork renders ~0.2in lower than that. With an inline band we meet the
  // rendered position at 980, then a short spacer below the rule opens the
  // gap the form leaves before its first body line.
  margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 980, footer: 708, gutter: 0 },
} as const

/** The four artworks the form embeds, copied byte for byte out of the model
 *  document into public/. */
const IMAGES = {
  seal: { url: '/nbsc-seal.jpg', type: 'jpg', width: 64, height: 84 },
  bagongFilipinas: { url: '/bagong-pilipinas.png', type: 'png', width: 52, height: 52 },
  facebook: { url: '/nbsc-facebook-icon.png', type: 'png', width: 47, height: 47 },
  mail: { url: '/nbsc-mail-icon.png', type: 'png', width: 30, height: 30 },
} as const

/** Reads one artwork; a missing image drops out of its band but must not fail
 *  the export (the same graceful contract the letterhead kept). */
async function fetchFormImage(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

/** Builds the model form's repeating bands as the section's default header
 *  and footer. Takes the dynamically imported `docx` namespace — see the note
 *  in syllabusDocx.ts for why `docx` must never ride the main bundle. */
export async function buildFormChrome(
  d: Docx,
): Promise<{ header: InstanceType<Docx['Header']>; footer: InstanceType<Docx['Footer']> }> {
  const { AlignmentType, BorderStyle, Footer, Header, ImageRun, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType } = d

  // The thin rules that close the header band and open the footer band. The
  // model form's rules are hairline strokes; 1.5pt (size 12 in eighths) reads
  // the same on paper.
  const RULE = { style: BorderStyle.SINGLE, size: 12, color: '000000' }
  const NO_BORDER = { style: BorderStyle.NIL }
  // Borderless cells carry the band; the rule is one border on the shared
  // edge (the header cells' bottom, the footer cells' top).
  const CLEAR = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER }
  const pct = (v: number) => ({ size: v, type: WidthType.PERCENTAGE })

  const [seal, bagongFilipinas, facebook, mail] = await Promise.all([
    fetchFormImage(IMAGES.seal.url),
    fetchFormImage(IMAGES.bagongFilipinas.url),
    fetchFormImage(IMAGES.facebook.url),
    fetchFormImage(IMAGES.mail.url),
  ])

  const image = (
    bytes: Uint8Array | null,
    spec: { type: 'jpg' | 'png'; width: number; height: number },
  ) =>
    bytes
      ? [new ImageRun({ type: spec.type, data: bytes, transformation: { width: spec.width, height: spec.height } })]
      : []

  // ---- Header band --------------------------------------------------------
  // Seal left, the address block centred beside it, the motto under it, and
  // the rule across the band's full width. The form's cluster spans ~75% of
  // the text column (the rule ran 4.68in of a 6.27in column), so the table is
  // 75% wide and left-aligned rather than full width.
  const headerText = (text: string, o: { bold?: boolean; size?: number } = {}) =>
    new TextRun({ text, bold: o.bold, size: o.size ?? 24, color: '000000' })
  const centered = (children: ReturnType<typeof headerText>[], spacingBefore = 0) =>
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: spacingBefore, after: 0 }, children })

  const header = new Header({
    children: [
      new Table({
        width: pct(75),
        alignment: AlignmentType.LEFT,
        borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: pct(14),
                borders: { ...CLEAR, bottom: RULE },
                verticalAlign: VerticalAlign.TOP,
                margins: { top: 0, bottom: 80, left: 0, right: 0 },
                children: [new Paragraph({ children: image(seal, IMAGES.seal) })],
              }),
              new TableCell({
                width: pct(86),
                borders: { ...CLEAR, bottom: RULE },
                verticalAlign: VerticalAlign.TOP,
                margins: { top: 0, bottom: 80, left: 0, right: 0 },
                children: [
                  centered([headerText('Republic of the Philippines')]),
                  centered([headerText('NORTHERN BUKIDNON STATE COLLEGE', { bold: true, size: 28 })]),
                  centered([headerText('Manolo Fortich, 8703 Bukidnon')]),
                  // The form's motto: 6pt Regards Script in old gold.
                  centered(
                    [
                      new TextRun({
                        text: 'Creando Futura, Transformationis Vitae, Ductae a Deo',
                        font: 'Regards Script',
                        italics: true,
                        size: 12,
                        color: 'BF8F00',
                      }),
                    ],
                    60,
                  ),
                ],
              }),
            ],
          }),
        ],
      }),
      // The form's rule closes the band well above the first body line.
      new Paragraph({ spacing: { after: 240 }, children: [] }),
    ],
  })

  // ---- Footer band --------------------------------------------------------
  // A rule over three groups in the form's order and spacing: the Bagong
  // Pilipinas seal alone at the left, the Facebook icon beside the page
  // handle, and the envelope icon beside the website.
  const footerText = (text: string) =>
    new TextRun({ text, font: 'Poppins', size: 16, color: '000000' })
  const contact = (icon: ReturnType<typeof image>, text: string) =>
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 0 },
      children: [...icon, new TextRun({ text: ' ', size: 16 }), footerText(text)],
    })

  const footer = new Footer({
    children: [
      new Table({
        width: pct(100),
        borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: pct(22),
                borders: { ...CLEAR, top: RULE },
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 40, bottom: 0, left: 0, right: 0 },
                children: [new Paragraph({ children: image(bagongFilipinas, IMAGES.bagongFilipinas) })],
              }),
              new TableCell({
                width: pct(50),
                borders: { ...CLEAR, top: RULE },
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 40, bottom: 0, left: 0, right: 0 },
                children: [contact(image(facebook, IMAGES.facebook), 'NorthernBukidnonStateCollegeOfficial')],
              }),
              new TableCell({
                width: pct(28),
                borders: { ...CLEAR, top: RULE },
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 40, bottom: 0, left: 0, right: 0 },
                children: [contact(image(mail, IMAGES.mail), 'www.nbsc.edu.ph')],
              }),
            ],
          }),
        ],
      }),
    ],
  })

  return { header, footer }
}
