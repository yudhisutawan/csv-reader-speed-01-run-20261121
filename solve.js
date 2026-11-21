// csv-reader-speed: a faster drop-in for csv-reader 1.0.0.
//
// run(input) returns exactly what csv-reader 1.0.0's readCsv returns for the
// same {text, header}: {columns, rows, errors}. The reading rules are the
// reference's own, followed to the letter:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it one quote and each CRLF or lone CR inside it
//     read as LF; what follows its closing quote, up to the next comma or
//     line break, is appended as it stands (quote_junk, when the field
//     ends); a quote that never closes is a literal character, and the text
//     after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record
//     starts on (every LF, CRLF and lone CR inside a quoted field counted),
//     row its record's index in rows (null for the header), in the order
//     met, a field's quote_junk when the field ends and a record's
//     short_row or long_row when the record ends.
//
// Speed: the reference reads one character at a time and builds every field
// a character at a time. This reader instead takes the fast path for the
// common record -- no quote before its line break and no CR in its line --
// and splits that whole line on commas in one native call, then only falls
// back to a field-by-field reader (itself built on indexOf, never on a
// character loop over the whole text) for records that hold a quote or a
// stray CR. Pure: no clock, no randomness, no locale, nothing kept from one
// call to the next.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // The field just read by readUnquoted/readQuoted: its value, how it ended,
  // and (for an unquoted read) how many characters were kept onto the value
  // it started with. Shared out-variables, so no object is built per field.
  let outValue = '';
  let outEnded = END;
  let outAdded = 0;

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). The result lands in outValue/outEnded/outAdded; `added` counts the characters kept, not the `value`
  // it started with (a quote_junk check reads it, and an unterminated quote starts it with the literal '"').
  // One indexOf(',') over the text finds the field's end; a LF or CR hiding before it is found in the short
  // slice, never by a second scan of the text.
  function readUnquoted(value, added) {
    const ci = text.indexOf(',', pos);
    if (ci === -1) {
      // No comma left: the field ends at the next LF, or at the end of the text.
      const ni = text.indexOf('\n', pos);
      if (ni === -1) {
        // The rest of the text, minus any stray CRs.
        const rest = text.slice(pos);
        const r = rest.indexOf('\r');
        if (r === -1) {
          outValue = value + rest;
          outAdded = added + rest.length;
          pos = n;
          outEnded = END;
          return;
        }
        let p = 0;
        for (;;) {
          const k = rest.indexOf('\r', p);
          if (k === -1) {
            value += rest.slice(p);
            added += rest.length - p;
            break;
          }
          if (k > p) {
            value += rest.slice(p, k);
            added += k - p;
          }
          error('stray_cr');
          p = k + 1;
        }
        outValue = value;
        outAdded = added;
        pos = n;
        outEnded = END;
        return;
      }
      // A LF at ni ends the field; a CR right before it is CRLF, any other CR in the segment is stray.
      const seg = text.slice(pos, ni);
      const r = seg.indexOf('\r');
      if (r === -1) {
        outValue = value + seg;
        outAdded = added + seg.length;
      } else {
        let p = 0;
        for (;;) {
          const k = seg.indexOf('\r', p);
          if (k === -1) {
            value += seg.slice(p);
            added += seg.length - p;
            break;
          }
          if (k > p) {
            value += seg.slice(p, k);
            added += k - p;
          }
          if (k + 1 === seg.length) break; // CRLF: the CR is dropped silently
          error('stray_cr');
          p = k + 1;
        }
        outValue = value;
        outAdded = added;
      }
      pos = ni + 1;
      line += 1;
      outEnded = LINE_BREAK;
      return;
    }
    // A comma at ci: the field ends there, unless a LF comes first.
    const seg = text.slice(pos, ci);
    const ni = seg.indexOf('\n');
    if (ni === -1) {
      const r = seg.indexOf('\r');
      if (r === -1) {
        outValue = value + seg;
        outAdded = added + seg.length;
        pos = ci + 1;
        outEnded = COMMA;
        return;
      }
      // Every CR in the segment is stray: the comma ends the field.
      let p = 0;
      for (;;) {
        const k = seg.indexOf('\r', p);
        if (k === -1) {
          value += seg.slice(p);
          added += seg.length - p;
          break;
        }
        if (k > p) {
          value += seg.slice(p, k);
          added += k - p;
        }
        error('stray_cr');
        p = k + 1;
      }
      outValue = value;
      outAdded = added;
      pos = ci + 1;
      outEnded = COMMA;
      return;
    }
    // A LF inside the segment, at ni, ends the field instead of the comma.
    const head = seg.slice(0, ni);
    const r = head.indexOf('\r');
    if (r === -1) {
      outValue = value + head;
      outAdded = added + head.length;
    } else {
      // CRs in the head: the one at its end is CRLF, the rest are stray.
      let p = 0;
      for (;;) {
        const k = head.indexOf('\r', p);
        if (k === -1) {
          value += head.slice(p);
          added += head.length - p;
          break;
        }
        if (k > p) {
          value += head.slice(p, k);
          added += k - p;
        }
        if (k + 1 === head.length) break;
        error('stray_cr');
        p = k + 1;
      }
      outValue = value;
      outAdded = added;
    }
    pos = pos + ni + 1;
    line += 1;
    outEnded = LINE_BREAK;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let segStart = pos;
    // Appends text[a..b) to value, reading each CRLF or lone CR inside it as
    // LF and counting every line break it holds.
    const appendSegment = (a, b) => {
      if (a >= b) return;
      const seg = text.slice(a, b);
      if (seg.indexOf('\r') === -1) {
        value += seg;
        let p = seg.indexOf('\n');
        while (p !== -1) {
          line += 1;
          p = seg.indexOf('\n', p + 1);
        }
        return;
      }
      value += seg.replace(/\r\n|\r|\n/g, () => {
        line += 1;
        return '\n';
      });
    };
    for (;;) {
      const j = text.indexOf('"', pos);
      if (j === -1) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        readUnquoted('"', 0);
        return;
      }
      if (text.charCodeAt(j + 1) === 34) {
        appendSegment(segStart, j);
        value += '"';
        pos = j + 2;
        segStart = pos;
        continue;
      }
      appendSegment(segStart, j);
      pos = j + 1;
      if (pos >= n) {
        outValue = value;
        outEnded = END;
        return;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        outValue = value;
        outEnded = COMMA;
        return;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        outValue = value;
        outEnded = LINE_BREAK;
        return;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        outValue = value;
        outEnded = LINE_BREAK;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the next comma or line break.
      readUnquoted(value, 0);
      if (outAdded > 0) error('quote_junk');
      return;
    }
  }

  // Reads one record the slow way, field by field: only records that hold a
  // quote or a stray CR come here. Returns its fields and whether its last
  // field opened with a quote.
  function readRecordSlow() {
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('', 0);
      fields.push(outValue);
    } while (outEnded === COMMA);
    return { fields, quoted };
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const nl = text.indexOf('\n', pos);
    const q = text.indexOf('"', pos);
    const hasQuote = q !== -1 && (nl === -1 || q < nl);

    let fields;
    let lastQuoted = false;
    if (!hasQuote) {
      // Fast path: no quote in this record. A line with no CR at all is
      // plain fields split on commas; anything else goes the slow way.
      const lineEnd = nl === -1 ? n : nl;
      let s = text.slice(pos, lineEnd);
      if (nl !== -1 && s.charCodeAt(s.length - 1) === 13) s = s.slice(0, -1);
      if (s.indexOf('\r') === -1) {
        fields = s.split(',');
        pos = nl === -1 ? n : nl + 1;
        line += 1;
      } else {
        const r = readRecordSlow();
        fields = r.fields;
        lastQuoted = r.quoted;
      }
    } else {
      const r = readRecordSlow();
      fields = r.fields;
      lastQuoted = r.quoted;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
