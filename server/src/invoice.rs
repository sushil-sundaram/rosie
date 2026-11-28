//! Uploaded receipts and invoices: photos or PDFs.
//!
//! Most online-order invoices (Swiggy, BigBasket, Amazon…) are PDFs with a
//! text layer. Reading that text and giving it to a text model is faster and
//! far more accurate than asking a vision model to read a picture of a wide
//! GST table. A PDF without text (a scan saved as PDF) is turned into an
//! image of its first page and read like a photo.
//!
//! The PDF tools are poppler's `pdftotext`, `pdfinfo` and `pdftoppm`, run
//! with a time limit on a temporary copy of the upload.

use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;

/// An upload, after looking at what it really is.
pub enum Upload {
    /// Base64 image data, without any `data:` prefix.
    Image(String),
    Pdf(Vec<u8>),
}

const MAX_PDF_BYTES: usize = 15 * 1024 * 1024;
const MAX_TEXT: usize = 12_000;

/// Accepts a data URL or bare base64 holding an image or a PDF.
pub fn read_upload(raw: &str) -> Result<Upload, &'static str> {
    let trimmed = raw.trim();
    let (mime, data) = match trimmed.strip_prefix("data:") {
        Some(rest) => {
            let (meta, data) = rest.split_once(',').ok_or("invalid file data")?;
            let meta = meta.to_ascii_lowercase();
            if !meta.ends_with(";base64") {
                return Err("file must be base64-encoded");
            }
            (meta.trim_end_matches(";base64").to_string(), data.trim())
        }
        None => (String::new(), trimmed),
    };
    let is_pdf = mime == "application/pdf" || (mime.is_empty() && data.starts_with("JVBERi")); // "%PDF-"
    if is_pdf {
        if data.len() > MAX_PDF_BYTES * 4 / 3 + 4 {
            return Err("that PDF is too large");
        }
        let bytes = base64_decode(data).ok_or("invalid PDF data")?;
        if !bytes.starts_with(b"%PDF-") {
            return Err("that file isn't a PDF");
        }
        return Ok(Upload::Pdf(bytes));
    }
    if !(mime.is_empty() || mime.starts_with("image/")) {
        return Err("upload a photo or a PDF");
    }
    Ok(Upload::Image(data.to_string()))
}

/// A temporary copy of the PDF, removed when dropped.
struct TempPdf(PathBuf);

impl TempPdf {
    async fn new(bytes: &[u8]) -> std::io::Result<Self> {
        let n: u64 = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
        let path = std::env::temp_dir().join(format!("rosie-upload-{}-{n}.pdf", std::process::id()));
        tokio::fs::write(&path, bytes).await?;
        Ok(Self(path))
    }
}

impl Drop for TempPdf {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
        let _ = std::fs::remove_file(self.0.with_extension("png"));
    }
}

async fn run(cmd: &mut Command) -> Result<Vec<u8>, String> {
    let out = tokio::time::timeout(Duration::from_secs(30), cmd.kill_on_drop(true).output())
        .await
        .map_err(|_| "reading the PDF took too long".to_string())?
        .map_err(|e| format!("couldn't run the PDF reader: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).chars().take(200).collect());
    }
    Ok(out.stdout)
}

/// The document's title from its metadata ("Swiggy Invoice"), if any.
async fn pdf_title(path: &std::path::Path) -> Option<String> {
    let out = run(Command::new("pdfinfo").arg(path)).await.ok()?;
    String::from_utf8_lossy(&out)
        .lines()
        .find_map(|l| l.strip_prefix("Title:").map(|t| t.trim().to_string()))
        .filter(|t| !t.is_empty())
}

/// What a PDF holds: its text (first pages, as laid out) or, when it has
/// none, a PNG of the first page as base64.
pub enum PdfContent {
    /// `rows`: the product rows of a GST table, read straight from the layout
    /// (empty when the invoice isn't one).
    Text { title: Option<String>, text: String, rows: Vec<Row> },
    PageImage(String),
}

pub async fn read_pdf(bytes: &[u8]) -> Result<PdfContent, String> {
    let file = TempPdf::new(bytes).await.map_err(|e| format!("couldn't store the PDF: {e}"))?;
    let raw = run(Command::new("pdftotext").args(["-layout", "-l", "4", "-enc", "UTF-8"]).arg(&file.0).arg("-")).await?;
    let layout = String::from_utf8_lossy(&raw).into_owned();
    let text = collapse_blank_lines(&layout);
    if text.chars().filter(|c| c.is_alphanumeric()).count() >= 40 {
        let title = pdf_title(&file.0).await;
        let rows = gst_table(&layout);
        return Ok(PdfContent::Text { title, text: clip(&text, MAX_TEXT), rows });
    }
    // No text layer: render page 1 and read it as a photo.
    let png = file.0.with_extension("png");
    let prefix = png.with_extension("");
    run(Command::new("pdftoppm").args(["-png", "-r", "130", "-f", "1", "-l", "1", "-singlefile"]).arg(&file.0).arg(&prefix)).await?;
    let img = tokio::fs::read(&png).await.map_err(|e| format!("couldn't read the rendered page: {e}"))?;
    Ok(PdfContent::PageImage(base64_encode(&img)))
}

/// pdftotext -layout pads with many blank lines; keep at most one in a row and
/// trim the wide runs of spaces between columns down to three.
fn collapse_blank_lines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut blank = 0;
    for line in s.lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        let mut spaces = 0;
        for c in line.chars() {
            if c == ' ' {
                spaces += 1;
                if spaces > 3 {
                    continue;
                }
            } else {
                spaces = 0;
            }
            out.push(c);
        }
        out.push('\n');
    }
    out
}

fn clip(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

/// GST unit codes (UQC) as printed on Indian tax invoices, and what they mean here.
fn uqc_unit(code: &str) -> Option<&'static str> {
    Some(match code.to_ascii_uppercase().trim_end_matches('.') {
        "NOS" | "PCS" | "UNT" | "UNITS" | "NO" | "EA" | "SET" | "PRS" => "pcs",
        "KGS" | "KG" => "kg",
        "GMS" | "GM" | "GRM" | "G" => "g",
        "LTR" | "L" | "LTRS" => "L",
        "MLT" | "ML" => "ml",
        "PAC" | "PKT" | "PACK" | "BOX" | "BTL" | "BAG" | "CAN" | "TIN" | "JAR" => "pack",
        _ => return None,
    })
}

/// One product row of a GST invoice table.
#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    /// The description as printed, wrapped lines joined ("Imported Crimson Red Grapes (Seedless) (Drakshi)").
    pub description: String,
    pub quantity: f64,
    pub unit: &'static str,
}

/// Where a row's quantity / unit code / HSN code sit on its line: the
/// byte offset where the quantity starts, plus the values.
fn row_match(line: &str) -> Option<(usize, f64, &'static str)> {
    let mut offsets = Vec::new();
    let mut in_word = false;
    for (i, c) in line.char_indices() {
        if !c.is_whitespace() && !in_word {
            offsets.push(i);
        }
        in_word = !c.is_whitespace();
    }
    let words: Vec<&str> = line.split_whitespace().collect();
    for k in 0..words.len().saturating_sub(2) {
        let (qty, code, hsn) = (words[k], words[k + 1], words[k + 2]);
        let Some(unit) = uqc_unit(code) else { continue };
        if !((4..=8).contains(&hsn.len()) && hsn.bytes().all(|b| b.is_ascii_digit())) {
            continue;
        }
        if let Ok(q) = qty.parse::<f64>() {
            if q > 0.0 && q < 10_000.0 {
                return Some((offsets[k], q, unit));
            }
        }
    }
    None
}

/// The product rows of a GST invoice, from pdftotext's -layout output. A long
/// description wraps onto lines above and below its row (centred), so each
/// text-only line within three lines of a row is given to the nearest row,
/// taking only the description column (left of the quantity).
pub fn gst_table(layout: &str) -> Vec<Row> {
    let lines: Vec<&str> = layout.lines().collect();
    let found: Vec<(usize, usize, f64, &'static str)> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, l)| row_match(l).map(|(at, q, u)| (i, at, q, u)))
        .collect();
    if found.is_empty() {
        return Vec::new();
    }
    let mut parts: Vec<Vec<(usize, String)>> = vec![Vec::new(); found.len()];
    // Text on the row line itself, after the serial number ("1." / "1").
    for (r, &(i, at, _, _)) in found.iter().enumerate() {
        let head = &lines[i][..at];
        let head = head.trim_start();
        let head = head.split_once(char::is_whitespace).map_or("", |(first, rest)| {
            if first.trim_end_matches('.').bytes().all(|b| b.is_ascii_digit()) { rest } else { head }
        });
        parts[r].push((i, head.trim().to_string()));
    }
    for (j, line) in lines.iter().enumerate() {
        if line.trim().is_empty() || found.iter().any(|&(i, ..)| i == j) {
            continue;
        }
        // Nearest row, within three lines; the description column ends where that row's quantity starts.
        let Some((r, &(i, at, _, _))) = found.iter().enumerate().min_by_key(|(_, (i, ..))| i.abs_diff(j)) else { continue };
        if i.abs_diff(j) > 3 {
            continue;
        }
        let end = line.char_indices().map(|(k, _)| k).take_while(|&k| k < at).last().map_or(0, |k| k + 1);
        // A wrapped name has nothing in the other columns; headings and totals do.
        if line.get(end..).is_some_and(|rest| !rest.trim().is_empty()) {
            continue;
        }
        let piece = line.get(..end).unwrap_or(line).trim();
        // Only words: a fragment with figures belongs to another column or a total.
        if piece.is_empty() || piece.chars().any(|c| c.is_ascii_digit()) {
            continue;
        }
        parts[r].push((j, piece.to_string()));
    }
    found
        .iter()
        .zip(parts)
        .map(|(&(_, _, quantity, unit), mut p)| {
            p.sort_by_key(|(line, _)| *line);
            let description = p.into_iter().map(|(_, t)| t).filter(|t| !t.is_empty()).collect::<Vec<_>>().join(" ");
            Row { description: description.split_whitespace().collect::<Vec<_>>().join(" "), quantity, unit }
        })
        .collect()
}

/// The invoice date from a labelled line ("Date of Invoice: 28-11-2026",
/// "Invoice Date 28/11/2026"), day first as Indian invoices print it.
pub fn labelled_date(text: &str) -> Option<String> {
    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        let Some(at) = lower.find("date") else { continue };
        if lower.contains("due") || lower.contains("order date") && lower.contains("invoice date") {
            continue;
        }
        let rest = &line[at..];
        for token in rest.split_whitespace() {
            let t = token.trim_matches(|c: char| !c.is_ascii_digit());
            let parts: Vec<&str> = t.split(['-', '/', '.']).collect();
            if parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())) {
                return Some(t.to_string());
            }
        }
    }
    None
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(B64[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' | b'\n' | b'\r' | b' ' => continue,
            _ => return None,
        };
        buf = (buf << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trip() {
        for s in ["", "a", "ab", "abc", "%PDF-1.4 hello\n\u{20b9}"] {
            assert_eq!(base64_decode(&base64_encode(s.as_bytes())).unwrap(), s.as_bytes());
        }
        assert_eq!(base64_encode(b"%PDF-"), "JVBERi0=");
    }

    #[test]
    fn recognises_pdfs_and_images() {
        let pdf = format!("data:application/pdf;base64,{}", base64_encode(b"%PDF-1.7\n..."));
        assert!(matches!(read_upload(&pdf), Ok(Upload::Pdf(_))));
        assert!(matches!(read_upload(&base64_encode(b"%PDF-1.7\n...")), Ok(Upload::Pdf(_))));
        assert!(matches!(read_upload("data:image/jpeg;base64,/9j/4AAQ"), Ok(Upload::Image(_))));
        assert!(read_upload("data:application/pdf;base64,aGVsbG8=").is_err(), "not really a PDF");
        assert!(read_upload("data:text/html;base64,PGh0bWw+").is_err());
    }

    #[test]
    fn reads_gst_table_quantities_and_dates() {
        let text = "Date of Invoice:   28-11-2026   Category: B2C\n\
            1.   1   NOS   12024210   85.71   8.57\n\
            2.   Grapes (Seedless)   2   NOS   08039010   408   90\n\
            3.   Rice   0.5   KGS   10063020   40\n\
            Invoice Value   947\n";
        let rows: Vec<(f64, &str)> = gst_table(text).iter().map(|r| (r.quantity, r.unit)).collect();
        assert_eq!(rows, vec![(1.0, "pcs"), (2.0, "pcs"), (0.5, "kg")]);
        assert_eq!(labelled_date(text).as_deref(), Some("28-11-2026"));
    }

    #[test]
    fn reads_wrapped_descriptions() {
        let layout = "\
Sr                                                             Taxable
         Description of Goods     Quantity UQC      /SAC                    (Excluding
           Rajaram's Roasted
1.                                  1      NOS     12024210        85.71       8.57
            Peanuts (Plain)


         Imported Crimson Red

2.         Grapes (Seedless)        2      NOS     08039010         408           90

               (Drakshi)


3.          Colocasia (Arvi)        2      NOS     07031010         58            16


                                                                     Invoice Value         947
";
        let rows = gst_table(layout);
        let d: Vec<&str> = rows.iter().map(|r| r.description.as_str()).collect();
        assert_eq!(d, ["Rajaram's Roasted Peanuts (Plain)", "Imported Crimson Red Grapes (Seedless) (Drakshi)", "Colocasia (Arvi)"]);
        assert_eq!(rows.iter().map(|r| r.quantity).collect::<Vec<_>>(), [1.0, 2.0, 2.0]);
    }

    #[test]
    fn layout_text_is_compacted() {
        let t = collapse_blank_lines("a        b\n\n\n\nc\n");
        assert_eq!(t, "a   b\n\nc\n");
    }
}
