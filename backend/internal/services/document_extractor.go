package services

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	pdf "rsc.io/pdf"
)

var errScannedPDF = errors.New("scanned PDFs are not supported yet; please upload a text-based PDF")

var (
	pdfTextShowRegex      = regexp.MustCompile(`(?s)\(((?:\\.|[^\\)])*)\)\s*Tj`)
	pdfTextArrayRegex     = regexp.MustCompile(`(?s)\[(.*?)\]\s*TJ`)
	pdfLiteralStringRegex = regexp.MustCompile(`\(((?:\\.|[^\\)])*)\)`)
)

func ExtractDocumentText(filename string, content []byte) (string, error) {
	ext := strings.ToLower(filepath.Ext(filename))

	text, err := extractDocumentSafely(filename, func() (string, error) {
		switch ext {
		case ".txt", ".md":
			return normalizeExtractedText(string(content)), nil
		case ".docx":
			return extractDOCXText(content)
		case ".pdf":
			return extractPDFText(content)
		default:
			return "", fmt.Errorf("unsupported document type %q", ext)
		}
	})

	if err != nil {
		return "", err
	}

	text = normalizeExtractedText(text)
	if text == "" {
		if ext == ".pdf" {
			return "", errScannedPDF
		}
		return "", errors.New("the uploaded document is empty")
	}

	return text, nil
}

func extractDocumentSafely(filename string, extractor func() (string, error)) (text string, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("failed to extract %s: %v", filepath.Ext(filename), recovered)
			text = ""
		}
	}()

	return extractor()
}

func extractDOCXText(content []byte) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return "", fmt.Errorf("failed to read docx file: %w", err)
	}

	for _, file := range reader.File {
		if file.Name != "word/document.xml" {
			continue
		}

		rc, err := file.Open()
		if err != nil {
			return "", fmt.Errorf("failed to open docx document.xml: %w", err)
		}
		defer rc.Close()

		decoder := xml.NewDecoder(rc)
		var paragraphs []string
		var paragraph strings.Builder

		for {
			token, err := decoder.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				return "", fmt.Errorf("failed to parse docx XML: %w", err)
			}

			switch element := token.(type) {
			case xml.StartElement:
				switch element.Name.Local {
				case "t":
					var value string
					if err := decoder.DecodeElement(&value, &element); err != nil {
						return "", fmt.Errorf("failed to decode docx text: %w", err)
					}
					paragraph.WriteString(value)
				case "tab":
					paragraph.WriteString("\t")
				case "br":
					paragraph.WriteString("\n")
				}
			case xml.EndElement:
				if element.Name.Local == "p" {
					value := strings.TrimSpace(paragraph.String())
					if value != "" {
						paragraphs = append(paragraphs, value)
					}
					paragraph.Reset()
				}
			}
		}

		if value := strings.TrimSpace(paragraph.String()); value != "" {
			paragraphs = append(paragraphs, value)
		}

		return strings.Join(paragraphs, "\n\n"), nil
	}

	return "", errors.New("invalid docx file")
}

func extractPDFText(content []byte) (string, error) {
	if text, err := extractPDFTextWithCommand(content); err == nil {
		return text, nil
	}

	return extractPDFTextWithGoParser(content)
}

func extractPDFTextWithCommand(content []byte) (string, error) {
	tmpFile, err := os.CreateTemp("", "document-*.pdf")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write(content); err != nil {
		tmpFile.Close()
		return "", err
	}
	if err := tmpFile.Close(); err != nil {
		return "", err
	}

	output, err := exec.Command("pdftotext", "-layout", "-nopgbrk", tmpFile.Name(), "-").Output()
	if err != nil {
		return "", err
	}

	return string(output), nil
}

func extractPDFTextWithGoParser(content []byte) (string, error) {
	reader, err := pdf.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return "", fmt.Errorf("failed to open PDF: %w", err)
	}

	pages := make([]string, 0, reader.NumPage())
	for pageNumber := 1; pageNumber <= reader.NumPage(); pageNumber++ {
		page := reader.Page(pageNumber)
		if page.V.IsNull() {
			continue
		}

		content := page.Content()
		sort.Sort(pdf.TextVertical(content.Text))
		pageText := rebuildPDFText(content.Text)

		if text := strings.TrimSpace(pageText.String()); text != "" {
			pages = append(pages, text)
		}
	}

	structuredText := strings.Join(pages, "\n\n")
	rawText := extractRawPDFText(content)

	if scorePDFText(rawText) > scorePDFText(structuredText) {
		return rawText, nil
	}

	return structuredText, nil
}

func rebuildPDFText(fragments []pdf.Text) strings.Builder {
	var builder strings.Builder
	var previous *pdf.Text

	for i := range fragments {
		fragment := fragments[i]
		if previous != nil {
			lineBreakThreshold := math.Max(previous.FontSize, fragment.FontSize) * 0.8
			if math.Abs(previous.Y-fragment.Y) > lineBreakThreshold {
				builder.WriteByte('\n')
			} else {
				gap := fragment.X - (previous.X + previous.W)
				spaceThreshold := math.Max(previous.FontSize, fragment.FontSize) * 0.2
				if gap > spaceThreshold {
					builder.WriteByte(' ')
				}
			}
		}

		builder.WriteString(fragment.S)
		previous = &fragment
	}

	return builder
}

func extractRawPDFText(content []byte) string {
	var parts []string

	for _, match := range pdfTextShowRegex.FindAllSubmatch(content, -1) {
		if len(match) < 2 {
			continue
		}
		if decoded := strings.TrimSpace(decodePDFLiteralString(string(match[1]))); decoded != "" {
			parts = append(parts, decoded)
		}
	}

	for _, match := range pdfTextArrayRegex.FindAllSubmatch(content, -1) {
		if len(match) < 2 {
			continue
		}

		var segment strings.Builder
		for _, literal := range pdfLiteralStringRegex.FindAllSubmatch(match[1], -1) {
			if len(literal) < 2 {
				continue
			}
			segment.WriteString(decodePDFLiteralString(string(literal[1])))
		}

		if decoded := strings.TrimSpace(segment.String()); decoded != "" {
			parts = append(parts, decoded)
		}
	}

	return strings.Join(parts, "\n")
}

func decodePDFLiteralString(value string) string {
	var builder strings.Builder

	for i := 0; i < len(value); i++ {
		if value[i] != '\\' {
			builder.WriteByte(value[i])
			continue
		}

		i++
		if i >= len(value) {
			break
		}

		switch value[i] {
		case 'n':
			builder.WriteByte('\n')
		case 'r':
			builder.WriteByte('\r')
		case 't':
			builder.WriteByte('\t')
		case 'b':
			builder.WriteByte('\b')
		case 'f':
			builder.WriteByte('\f')
		case '(', ')', '\\':
			builder.WriteByte(value[i])
		case '\n', '\r':
			if value[i] == '\r' && i+1 < len(value) && value[i+1] == '\n' {
				i++
			}
		default:
			if value[i] >= '0' && value[i] <= '7' {
				end := i + 1
				for end < len(value) && end-i < 3 && value[end] >= '0' && value[end] <= '7' {
					end++
				}
				octal, err := strconv.ParseInt(value[i:end], 8, 32)
				if err == nil {
					builder.WriteByte(byte(octal))
					i = end - 1
					continue
				}
			}

			builder.WriteByte(value[i])
		}
	}

	return builder.String()
}

func scorePDFText(text string) int {
	return len(strings.Fields(normalizeExtractedText(text)))
}

func normalizeExtractedText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}

	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimRight(line, " \t")
	}

	return strings.TrimSpace(strings.Join(lines, "\n"))
}
