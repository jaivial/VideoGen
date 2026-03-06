package services

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
	"testing"
)

func TestExtractDocumentTextExtractsPlainTextFiles(t *testing.T) {
	t.Parallel()

	text, err := ExtractDocumentText("transcript.txt", []byte("First line\n\nSecond line"))
	if err != nil {
		t.Fatalf("expected txt extraction to succeed: %v", err)
	}

	if text != "First line\n\nSecond line" {
		t.Fatalf("expected plain text to be preserved, got %q", text)
	}

	markdown, err := ExtractDocumentText("notes.md", []byte("# Heading\n\nBody copy"))
	if err != nil {
		t.Fatalf("expected markdown extraction to succeed: %v", err)
	}

	if markdown != "# Heading\n\nBody copy" {
		t.Fatalf("expected markdown text to be preserved, got %q", markdown)
	}
}

func TestExtractDocumentTextExtractsDOCXText(t *testing.T) {
	t.Parallel()

	content := createDOCX(t,
		"Hello from DOCX",
		"Second paragraph",
	)

	text, err := ExtractDocumentText("transcript.docx", content)
	if err != nil {
		t.Fatalf("expected docx extraction to succeed: %v", err)
	}

	if !strings.Contains(text, "Hello from DOCX") {
		t.Fatalf("expected extracted docx text to contain first paragraph, got %q", text)
	}
	if !strings.Contains(text, "Second paragraph") {
		t.Fatalf("expected extracted docx text to contain second paragraph, got %q", text)
	}
}

func TestExtractDocumentTextExtractsPDFText(t *testing.T) {
	t.Parallel()

	text, err := ExtractDocumentText("transcript.pdf", createPDF(t, "Hello PDF transcript"))
	if err != nil {
		t.Fatalf("expected pdf extraction to succeed: %v", err)
	}

	if !strings.Contains(text, "Hello PDF transcript") {
		t.Fatalf("expected extracted pdf text to contain source text, got %q", text)
	}
}

func TestExtractDocumentTextRejectsUnsupportedFileTypes(t *testing.T) {
	t.Parallel()

	_, err := ExtractDocumentText("legacy.doc", []byte("binary"))
	if err == nil {
		t.Fatal("expected unsupported file type to fail")
	}

	if !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("expected unsupported file type error, got %v", err)
	}
}

func TestExtractDocumentTextRejectsPDFsWithoutSelectableText(t *testing.T) {
	t.Parallel()

	_, err := ExtractDocumentText("scan.pdf", createPDF(t, ""))
	if err == nil {
		t.Fatal("expected empty pdf text extraction to fail")
	}

	if !strings.Contains(strings.ToLower(err.Error()), "scanned") {
		t.Fatalf("expected scanned pdf guidance, got %v", err)
	}
}

func TestExtractDocumentSafelyRecoversPanics(t *testing.T) {
	t.Parallel()

	text, err := extractDocumentSafely("broken.pdf", func() (string, error) {
		panic("bad Tj operator")
	})
	if err == nil {
		t.Fatal("expected panic to be converted into an error")
	}
	if text != "" {
		t.Fatalf("expected no text on panic, got %q", text)
	}
	if !strings.Contains(err.Error(), "bad Tj operator") {
		t.Fatalf("expected panic details in error, got %v", err)
	}
}

func createDOCX(t *testing.T, paragraphs ...string) []byte {
	t.Helper()

	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)

	document, err := writer.Create("word/document.xml")
	if err != nil {
		t.Fatalf("failed to create docx document.xml: %v", err)
	}

	var body strings.Builder
	body.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`)
	body.WriteString(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`)
	for _, paragraph := range paragraphs {
		body.WriteString(`<w:p><w:r><w:t>`)
		body.WriteString(paragraph)
		body.WriteString(`</w:t></w:r></w:p>`)
	}
	body.WriteString(`</w:body></w:document>`)

	if _, err := document.Write([]byte(body.String())); err != nil {
		t.Fatalf("failed to write docx content: %v", err)
	}

	if err := writer.Close(); err != nil {
		t.Fatalf("failed to finalize docx archive: %v", err)
	}

	return archive.Bytes()
}

func createPDF(t *testing.T, text string) []byte {
	t.Helper()

	escapedText := strings.NewReplacer(`\`, `\\`, `(`, `\(`, `)`, `\)`).Replace(text)
	stream := fmt.Sprintf("BT\n/F1 24 Tf\n72 720 Td\n(%s) Tj\nET", escapedText)
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}

	var pdf bytes.Buffer
	pdf.WriteString("%PDF-1.4\n")

	offsets := make([]int, 0, len(objects)+1)
	offsets = append(offsets, 0)
	for index, object := range objects {
		offsets = append(offsets, pdf.Len())
		fmt.Fprintf(&pdf, "%d 0 obj\n%s\nendobj\n", index+1, object)
	}

	xrefOffset := pdf.Len()
	fmt.Fprintf(&pdf, "xref\n0 %d\n", len(objects)+1)
	pdf.WriteString("0000000000 65535 f \n")
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&pdf, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&pdf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xrefOffset)

	return pdf.Bytes()
}
