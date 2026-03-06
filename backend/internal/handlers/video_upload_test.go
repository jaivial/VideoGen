package handlers

import (
	"strings"
	"testing"
)

func TestValidateDocumentUploadSizeAllowsFilesWithinLimit(t *testing.T) {
	t.Parallel()

	if err := validateDocumentUploadSize(maxDocumentUploadSize); err != nil {
		t.Fatalf("expected file at limit to be allowed: %v", err)
	}
}

func TestValidateDocumentUploadSizeRejectsFilesOverLimit(t *testing.T) {
	t.Parallel()

	err := validateDocumentUploadSize(maxDocumentUploadSize + 1)
	if err == nil {
		t.Fatal("expected oversized document to be rejected")
	}

	if !strings.Contains(err.Error(), "100MB") {
		t.Fatalf("expected error to mention the upload limit, got %v", err)
	}
}
