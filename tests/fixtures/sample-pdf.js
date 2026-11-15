// Gera um PDF pequeno e válido para os testes: páginas com título e texto em
// Helvetica e um sumário (outline) com uma entrada por capítulo. Sem dependência
// externa; as posições da tabela xref são calculadas.

function escape(text) {
  return text.replace(/[\\()]/g, (char) => `\\${char}`);
}

export function samplePdf({ title = 'Apostila de teste', pages = [], chapters = [] } = {}) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null);
  const pagesRoot = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageIds = pages.map((page) => {
    const lines = [`BT /F1 20 Tf 72 740 Td (${escape(page.heading)}) Tj ET`];
    page.body.forEach((line, index) => lines.push(`BT /F1 11 Tf 72 ${700 - index * 16} Td (${escape(line)}) Tj ET`));
    const stream = lines.join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
  });
  objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let outlines = '';
  if (chapters.length) {
    const root = add(null);
    const items = chapters.map(() => add(null));
    chapters.forEach((chapter, index) => {
      objects[items[index] - 1] = `<< /Title (${escape(chapter.title)}) /Parent ${root} 0 R /Dest [${pageIds[chapter.page - 1]} 0 R /Fit]${index ? ` /Prev ${items[index - 1]} 0 R` : ''}${index < items.length - 1 ? ` /Next ${items[index + 1]} 0 R` : ''} >>`;
    });
    objects[root - 1] = `<< /Type /Outlines /First ${items[0]} 0 R /Last ${items.at(-1)} 0 R /Count ${items.length} >>`;
    outlines = ` /Outlines ${root} 0 R /PageMode /UseOutlines`;
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R${outlines} >>`;
  const info = add(`<< /Title (${escape(title)}) >>`);

  let output = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

// Digitalização sintética: páginas com uma imagem RGB crua (sem texto). O
// arquivo fica bem maior que a cota e a rasterização no navegador reduz de
// verdade. Usado só nos testes de compressão.
export function scannedPdf({ pages = 2, width = 1200, height = 1600 } = {}) {
  const chunks = [];
  let length = 0;
  const push = (value) => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'latin1');
    chunks.push(buffer);
    length += buffer.length;
  };
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const catalog = add(null);
  const pagesRoot = add(null);
  const pageIds = [];

  for (let page = 0; page < pages; page += 1) {
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 3;
        pixels[index] = Math.round((x / width) * 255);
        pixels[index + 1] = Math.round((y / height) * 255);
        pixels[index + 2] = 96 + Math.round((x / width) * 96);
      }
    }
    const image = add(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`, 'latin1'),
      pixels,
      Buffer.from('\nendstream', 'latin1'),
    ]));
    const content = Buffer.from(`q 612 0 0 792 0 0 cm /Im0 Do Q`, 'latin1');
    const stream = add(Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'),
      content,
      Buffer.from('\nendstream', 'latin1'),
    ]));
    pageIds.push(add(Buffer.from(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${stream} 0 R >>`, 'latin1')));
  }

  objects[pagesRoot - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`, 'latin1');
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`, 'latin1');
  const info = add(Buffer.from('<< /Title (Digitalizacao de teste) >>', 'latin1'));

  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(length);
    push(`${index + 1} 0 obj\n`);
    push(body);
    push('\nendobj\n');
  });
  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.forEach((offset) => push(`${String(offset).padStart(10, '0')} 00000 n \n`));
  push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

// Apostila de Direito Penal com 6 páginas e dois capítulos.
export function penalPdf() {
  const page = (heading, topic) => ({ heading, body: [
    `Estudo de ${topic} no processo penal brasileiro.`,
    `A ${topic} depende de fundamentos previstos em lei.`,
    `Resumo: ${topic}, requisitos e hipoteses de cabimento.`,
  ] });
  return samplePdf({
    title: 'Apostila de Processo Penal',
    pages: [
      page('Inquerito policial', 'investigacao'),
      page('Inquerito policial', 'investigacao'),
      page('Inquerito policial', 'investigacao'),
      page('Prisao preventiva', 'prisao preventiva'),
      page('Prisao preventiva', 'prisao preventiva'),
      page('Prisao preventiva', 'prisao preventiva'),
    ],
    chapters: [{ title: 'Capitulo 1 - Inquerito', page: 1 }, { title: 'Capitulo 2 - Prisao preventiva', page: 4 }],
  });
}
